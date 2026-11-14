from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..database import get_session
from ..deps import approved_profile, own_profile
from ..models import iso, Delivery, DeliveryOffer, Facility, MedicineOrder, User, Volunteer, utcnow
from ..security import require_role
from ..services.assignment import compute_eta, eligible_volunteers, expire_stale_offers, make_offer, offer_next
from ..services.geo import haversine
from ..services.notify import notify, notify_admins
from ..services.status import transition
from .medicine import delivery_public

router = APIRouter(prefix="/api", tags=["volunteer"])


class VolunteerUpdate(BaseModel):
    is_available: Optional[bool] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    service_radius_km: Optional[float] = Field(default=None, gt=0, le=100)
    vehicle: Optional[str] = None


@router.patch("/volunteers/me")
def update_volunteer(data: VolunteerUpdate, ctx=Depends(own_profile("volunteer")),
                     session: Session = Depends(get_session)):
    _, v = ctx
    for k, val in data.model_dump(exclude_unset=True).items():
        setattr(v, k, val)
    session.add(v)
    session.commit()
    return v.model_dump()


def _task_view(session: Session, d: Delivery, full: bool) -> dict:
    o = session.get(MedicineOrder, d.order_id)
    ph = session.get(Facility, o.pharmacy_id)
    out = {"delivery_id": d.id, "order_code": o.code, "status": d.status, "medicine": f"{o.medicine_name} {o.strength}",
           "quantity": o.quantity, "urgency": o.urgency, "pickup": {"name": ph.name, "address": ph.address,
                                                                    "lat": ph.lat, "lng": ph.lng, "contact": ph.contact},
           "trip_km": round(haversine(d.pickup_lat, d.pickup_lng, d.drop_lat, d.drop_lng), 2),
           **{k: v for k, v in delivery_public(session, d, full=False).items() if k.startswith("eta")}}
    if full:  # recipient details only after the volunteer accepts
        patient = session.get(User, o.patient_user_id)
        out["drop"] = {"name": patient.name, "phone": o.contact, "address": o.delivery_address,
                       "lat": d.drop_lat, "lng": d.drop_lng}
        out["failure_reason"] = d.failure_reason
    return out


@router.get("/volunteers/me/offers")
def my_offers(ctx=Depends(own_profile("volunteer")), session: Session = Depends(get_session)):
    _, v = ctx
    expire_stale_offers(session)
    out = []
    for offer in session.exec(select(DeliveryOffer).where(DeliveryOffer.volunteer_id == v.id,
                                                          DeliveryOffer.status == "offered")):
        d = session.get(Delivery, offer.delivery_id)
        out.append({"offer_id": offer.id, "offered_at": iso(offer.offered_at),
                    "distance_to_pickup_km": round(haversine(v.lat, v.lng, d.pickup_lat, d.pickup_lng), 2),
                    **_task_view(session, d, full=False)})
    return out


class RespondIn(BaseModel):
    accept: bool


@router.post("/offers/{offer_id}/respond")
def respond_offer(offer_id: int, data: RespondIn, ctx=Depends(approved_profile("volunteer")),
                  session: Session = Depends(get_session)):
    user, v = ctx
    expire_stale_offers(session)
    offer = session.get(DeliveryOffer, offer_id)
    if not offer or offer.volunteer_id != v.id:
        raise HTTPException(404, "Offer not found")
    if offer.status != "offered":
        raise HTTPException(409, f"This offer has {offer.status}")
    d = session.get(Delivery, offer.delivery_id)
    o = session.get(MedicineOrder, d.order_id)
    offer.responded_at = utcnow()
    if data.accept:
        offer.status = "accepted"
        d.volunteer_id = v.id
        transition(session, "delivery", d, "accepted", user.id, f"Accepted by {user.name}")
        compute_eta(session, d, (v.lat, v.lng))
        ph = session.get(Facility, o.pharmacy_id)
        msg = f"{user.name} will deliver. Estimated arrival ~{d.eta_minutes} min ({d.eta_source})."
        notify(session, o.patient_user_id, f"Volunteer assigned for {o.code}", msg, "#order-" + str(o.id))
        notify(session, ph.user_id, f"Volunteer assigned for {o.code}", f"{user.name} ({user.phone}) is on the way.",
               "#ph-orders")
    else:
        offer.status = "declined"
        session.add(offer)
        session.flush()
        offer_next(session, d, user.id)
    session.add(offer)
    session.commit()
    return {"ok": True, "status": offer.status}


@router.get("/volunteers/me/deliveries")
def my_deliveries(ctx=Depends(own_profile("volunteer")), session: Session = Depends(get_session)):
    _, v = ctx
    rows = session.exec(select(Delivery).where(Delivery.volunteer_id == v.id).order_by(Delivery.updated_at.desc()))
    return [_task_view(session, d, full=True) for d in rows]


class DeliveryStatusIn(BaseModel):
    status: str  # collected | out_for_delivery | delivered | failed
    note: str = Field(default="", max_length=300)


ORDER_SYNC = {"out_for_delivery": "out_for_delivery", "delivered": "delivered", "failed": "delivery_failed"}


@router.patch("/deliveries/{did}/status")
def update_delivery(did: int, data: DeliveryStatusIn, ctx=Depends(approved_profile("volunteer")),
                    session: Session = Depends(get_session)):
    user, v = ctx
    d = session.get(Delivery, did)
    if not d or d.volunteer_id != v.id:
        raise HTTPException(404, "Delivery not found")
    if data.status not in ("collected", "out_for_delivery", "delivered", "failed"):
        raise HTTPException(422, "Invalid delivery status")
    if data.status == "failed" and len(data.note.strip()) < 3:
        raise HTTPException(422, "Please give a reason for the failed delivery")
    transition(session, "delivery", d, data.status, user.id, data.note)
    o = session.get(MedicineOrder, d.order_id)
    ph = session.get(Facility, o.pharmacy_id)
    if data.status == "collected":
        compute_eta(session, d, None)
    if data.status in ORDER_SYNC:
        transition(session, "order", o, ORDER_SYNC[data.status], user.id, data.note)
    if data.status == "failed":
        d.failure_reason = data.note
        session.add(d)
        notify_admins(session, f"Delivery failed for {o.code}", data.note, "#admin-deliveries")
    label = data.status.replace("_", " ")
    extra = f" Estimated arrival ~{d.eta_minutes} min." if data.status in ("collected", "out_for_delivery") else ""
    notify(session, o.patient_user_id, f"Order {o.code}: {label}", (data.note + extra).strip(), "#order-" + str(o.id))
    notify(session, ph.user_id, f"Order {o.code}: {label}", data.note, "#ph-orders")
    session.commit()
    return _task_view(session, d, full=True)


# ---------- Admin coordination ----------

@router.get("/deliveries")
def all_deliveries(user: User = Depends(require_role("admin")), session: Session = Depends(get_session)):
    expire_stale_offers(session)
    out = []
    for d in session.exec(select(Delivery).order_by(Delivery.updated_at.desc())):
        out.append({**_task_view(session, d, full=True),
                    "volunteer": delivery_public(session, d).get("volunteer"),
                    "candidates": [{"volunteer_id": c.id, "name": session.get(User, c.user_id).name,
                                    "distance_km": round(dist, 2)}
                                   for c, dist in eligible_volunteers(session, d)][:5]
                    if d.status in ("unassigned", "failed", "offered") else []})
    return out


class AssignIn(BaseModel):
    volunteer_id: int


@router.post("/deliveries/{did}/assign")
def assign(did: int, data: AssignIn, user: User = Depends(require_role("admin")),
           session: Session = Depends(get_session)):
    d = session.get(Delivery, did)
    if not d or d.status not in ("unassigned", "failed", "offered"):
        raise HTTPException(409, "Delivery cannot be reassigned now")
    v = session.get(Volunteer, data.volunteer_id)
    if not v or v.verification_status != "approved":
        raise HTTPException(404, "Volunteer not found or not verified")
    for off in session.exec(select(DeliveryOffer).where(DeliveryOffer.delivery_id == d.id,
                                                        DeliveryOffer.status == "offered")):
        off.status, off.responded_at = "withdrawn", utcnow()
        session.add(off)
    o = session.get(MedicineOrder, d.order_id)
    if o.status == "delivery_failed":
        transition(session, "order", o, "delivery_requested", user.id, "Reassigned by admin")
    d.failure_reason = ""
    make_offer(session, d, v, user.id)
    session.commit()
    return {"ok": True}
