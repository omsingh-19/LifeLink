import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..deps import approved_profile, own_profile
from ..models import iso, Delivery, Facility, MedicineOrder, PharmacyStock, User, Volunteer, utcnow
from ..security import get_current_user, require_role
from ..services.assignment import offer_next
from ..services.geo import bounding_box, haversine
from ..services.matching import facility_public
from ..services.notify import notify
from ..services.status import new_code, record_created, transition
from .blood import timeline

router = APIRouter(prefix="/api", tags=["medicine"])

ALLOWED_RX_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf"}
MAX_RX_BYTES = 5 * 1024 * 1024


def stock_public(s: PharmacyStock) -> dict:
    age_h = (utcnow() - s.reported_at).total_seconds() / 3600
    return {"stock_id": s.id, "name": s.name, "strength": s.strength, "form": s.form,
            "requires_prescription": s.requires_prescription, "status": s.status, "price": s.price,
            "reported_at": iso(s.reported_at), "stale": age_h > settings.stale_stock_hours}


# ---------- Search (public) ----------

@router.get("/pharmacies/search")
def search(q: str = Query(min_length=2, max_length=80), lat: float = Query(ge=-90, le=90),
           lng: float = Query(ge=-180, le=180), radius: float = Query(default=15, gt=0, le=100),
           session: Session = Depends(get_session)):
    min_lat, max_lat, min_lng, max_lng = bounding_box(lat, lng, radius)
    rows = session.exec(
        select(PharmacyStock, Facility).join(Facility, Facility.id == PharmacyStock.facility_id).where(
            Facility.kind == "pharmacy", Facility.verification_status == "approved",
            PharmacyStock.name.ilike(f"%{q.strip()}%"),
            Facility.lat.between(min_lat, max_lat), Facility.lng.between(min_lng, max_lng))
    ).all()
    by_pharmacy: dict[int, dict] = {}
    for stock, ph in rows:
        dist = haversine(lat, lng, ph.lat, ph.lng)
        if dist > radius:
            continue
        entry = by_pharmacy.setdefault(ph.id, {**facility_public(ph), "distance_km": round(dist, 2), "items": []})
        entry["items"].append(stock_public(stock))
    out = list(by_pharmacy.values())
    for e in out:
        e["in_stock"] = any(i["status"] != "out_of_stock" for i in e["items"])
    out.sort(key=lambda e: (not e["in_stock"], e["distance_km"]))
    return out


# ---------- Pharmacy catalogue ----------

class StockIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    strength: str = Field(default="", max_length=40)
    form: str = Field(default="tablet", max_length=30)
    requires_prescription: bool = False
    status: str = "in_stock"
    price: Optional[float] = Field(default=None, ge=0)


def _check_status(s: str) -> None:
    if s not in ("in_stock", "low", "out_of_stock"):
        raise HTTPException(422, "Invalid stock status")


@router.get("/pharmacies/me/catalogue")
def catalogue(ctx=Depends(own_profile("pharmacy")), session: Session = Depends(get_session)):
    _, ph = ctx
    return [stock_public(s) for s in session.exec(select(PharmacyStock).where(PharmacyStock.facility_id == ph.id)
                                                  .order_by(PharmacyStock.name))]


@router.post("/pharmacies/me/catalogue")
def add_item(data: StockIn, ctx=Depends(approved_profile("pharmacy")), session: Session = Depends(get_session)):
    _, ph = ctx
    _check_status(data.status)
    s = PharmacyStock(facility_id=ph.id, **data.model_dump())
    session.add(s)
    session.commit()
    session.refresh(s)
    return stock_public(s)


def _own_item(session: Session, ph: Facility, sid: int) -> PharmacyStock:
    s = session.get(PharmacyStock, sid)
    if not s or s.facility_id != ph.id:
        raise HTTPException(404, "Item not found")
    return s


@router.put("/pharmacies/me/catalogue/{sid}")
def update_item(sid: int, data: StockIn, ctx=Depends(approved_profile("pharmacy")),
                session: Session = Depends(get_session)):
    _, ph = ctx
    _check_status(data.status)
    s = _own_item(session, ph, sid)
    for k, v in data.model_dump().items():
        setattr(s, k, v)
    s.reported_at = utcnow()
    session.add(s)
    session.commit()
    return stock_public(s)


@router.delete("/pharmacies/me/catalogue/{sid}")
def delete_item(sid: int, ctx=Depends(approved_profile("pharmacy")), session: Session = Depends(get_session)):
    _, ph = ctx
    s = _own_item(session, ph, sid)
    for o in session.exec(select(MedicineOrder).where(MedicineOrder.stock_id == sid)):
        o.stock_id = None
        session.add(o)
    session.delete(s)
    session.commit()
    return {"ok": True}


# ---------- Orders ----------

def delivery_public(session: Session, d: Delivery | None, full: bool = True) -> dict | None:
    if not d:
        return None
    out = {"id": d.id, "status": d.status, "eta_minutes": d.eta_minutes, "eta_source": d.eta_source,
           "eta_computed_at": iso(d.eta_computed_at) if d.eta_computed_at else None,
           "distance_km": d.distance_km, "failure_reason": d.failure_reason}
    if full and d.volunteer_id:
        v = session.get(Volunteer, d.volunteer_id)
        u = session.get(User, v.user_id)
        out["volunteer"] = {"name": u.name, "phone": u.phone, "vehicle": v.vehicle}
    return out


def order_public(session: Session, o: MedicineOrder, detail: bool = False) -> dict:
    ph = session.get(Facility, o.pharmacy_id)
    d = session.exec(select(Delivery).where(Delivery.order_id == o.id)).first()
    out = {"id": o.id, "code": o.code, "medicine_name": o.medicine_name, "strength": o.strength,
           "quantity": o.quantity, "urgency": o.urgency, "requires_prescription": o.requires_prescription,
           "has_prescription": bool(o.prescription_file), "prescription_verified": o.prescription_verified,
           "fulfilment": o.fulfilment, "status": o.status, "price_quoted": o.price_quoted,
           "patient_note": o.patient_note, "pharmacy_note": o.pharmacy_note,
           "created_at": iso(o.created_at), "pharmacy": facility_public(ph),
           "delivery": delivery_public(session, d)}
    if detail:
        patient = session.get(User, o.patient_user_id)
        out.update(patient={"name": patient.name, "phone": o.contact}, delivery_address=o.delivery_address,
                   lat=o.lat, lng=o.lng, timeline=timeline(session, "order", o.id))
    return out


@router.post("/orders")
async def create_order(
    pharmacy_id: int = Form(...), stock_id: Optional[int] = Form(None),
    medicine_name: str = Form(..., min_length=2, max_length=120), strength: str = Form(""),
    quantity: int = Form(1, ge=1, le=100), urgency: str = Form("normal"), fulfilment: str = Form("pickup"),
    delivery_address: str = Form(""), lat: float = Form(..., ge=-90, le=90), lng: float = Form(..., ge=-180, le=180),
    contact: str = Form(..., min_length=7, max_length=20), patient_note: str = Form("", max_length=500),
    requires_prescription: bool = Form(False), prescription: Optional[UploadFile] = File(None),
    user: User = Depends(require_role("patient")), session: Session = Depends(get_session),
):
    ph = session.get(Facility, pharmacy_id)
    if not ph or ph.kind != "pharmacy" or ph.verification_status != "approved":
        raise HTTPException(404, "Pharmacy not found")
    if urgency not in ("critical", "high", "normal") or fulfilment not in ("pickup", "delivery"):
        raise HTTPException(422, "Invalid urgency or fulfilment option")
    if fulfilment == "delivery" and len(delivery_address.strip()) < 5:
        raise HTTPException(422, "Delivery address is required for delivery")
    if stock_id is not None:
        s = session.get(PharmacyStock, stock_id)
        if not s or s.facility_id != ph.id:
            raise HTTPException(404, "Medicine not found at this pharmacy")
        requires_prescription = s.requires_prescription
    rx_path = None
    if prescription is not None and prescription.filename:
        ext = ALLOWED_RX_TYPES.get(prescription.content_type or "")
        if not ext:
            raise HTTPException(422, "Prescription must be a JPG, PNG or PDF")
        content = await prescription.read()
        if len(content) > MAX_RX_BYTES:
            raise HTTPException(422, "Prescription file is larger than 5 MB")
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        rx_path = uuid.uuid4().hex + ext
        (settings.upload_dir / rx_path).write_bytes(content)
    if requires_prescription and not rx_path:
        raise HTTPException(422, "This medicine needs a prescription. Please upload it.")
    o = MedicineOrder(code=new_code("M"), patient_user_id=user.id, pharmacy_id=ph.id, stock_id=stock_id,
                      medicine_name=medicine_name.strip(), strength=strength.strip(), quantity=quantity,
                      urgency=urgency, requires_prescription=requires_prescription, prescription_file=rx_path,
                      fulfilment=fulfilment, delivery_address=delivery_address.strip(), lat=lat, lng=lng,
                      contact=contact.strip(), patient_note=patient_note.strip())
    session.add(o)
    session.flush()
    record_created(session, "order", o, user.id)
    notify(session, ph.user_id, f"New medicine request {o.code}", f"{o.medicine_name} {o.strength} x{o.quantity}",
           "#ph-orders")
    session.commit()
    session.refresh(o)
    return order_public(session, o, detail=True)


@router.get("/orders/mine")
def my_orders(user: User = Depends(require_role("patient")), session: Session = Depends(get_session)):
    rows = session.exec(select(MedicineOrder).where(MedicineOrder.patient_user_id == user.id)
                        .order_by(MedicineOrder.created_at.desc())).all()
    return [order_public(session, o) for o in rows]


def _can_view(session: Session, o: MedicineOrder, user: User) -> bool:
    if user.role == "admin" or o.patient_user_id == user.id:
        return True
    if user.role == "pharmacy":
        return session.get(Facility, o.pharmacy_id).user_id == user.id
    if user.role == "volunteer":
        d = session.exec(select(Delivery).where(Delivery.order_id == o.id)).first()
        v = session.exec(select(Volunteer).where(Volunteer.user_id == user.id)).first()
        return bool(d and v and d.volunteer_id == v.id)
    return False


def _get_order(session: Session, oid: int, user: User) -> MedicineOrder:
    o = session.get(MedicineOrder, oid)
    if not o or not _can_view(session, o, user):
        raise HTTPException(404, "Order not found")
    return o


@router.get("/orders/{oid}")
def get_order(oid: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return order_public(session, _get_order(session, oid, user), detail=True)


@router.get("/orders/{oid}/prescription")
def get_prescription(oid: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    o = _get_order(session, oid, user)
    if user.role == "volunteer" or not o.prescription_file:
        raise HTTPException(404, "No prescription available")
    path = (settings.upload_dir / o.prescription_file).resolve()
    if settings.upload_dir.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "No prescription available")
    return FileResponse(path)


class PatientActionIn(BaseModel):
    action: str  # cancel | resubmit
    note: str = Field(default="", max_length=500)


@router.post("/orders/{oid}/patient-action")
def patient_action(oid: int, data: PatientActionIn, user: User = Depends(require_role("patient")),
                   session: Session = Depends(get_session)):
    o = _get_order(session, oid, user)
    ph = session.get(Facility, o.pharmacy_id)
    if data.action == "cancel":
        if o.status not in ("requested", "needs_clarification", "confirmed", "preparing", "ready"):
            raise HTTPException(409, "This order can no longer be cancelled")
        transition(session, "order", o, "cancelled", user.id, data.note or "Cancelled by patient")
    elif data.action == "resubmit":
        o.patient_note = data.note
        transition(session, "order", o, "requested", user.id, data.note or "Clarification provided")
    else:
        raise HTTPException(422, "Unknown action")
    notify(session, ph.user_id, f"Order {o.code}: {o.status.replace('_', ' ')}", data.note, "#ph-orders")
    session.commit()
    return order_public(session, o, detail=True)


@router.get("/pharmacies/me/orders")
def pharmacy_orders(ctx=Depends(own_profile("pharmacy")), session: Session = Depends(get_session)):
    _, ph = ctx
    rows = session.exec(select(MedicineOrder).where(MedicineOrder.pharmacy_id == ph.id)
                        .order_by(MedicineOrder.created_at.desc())).all()
    return [order_public(session, o, detail=True) for o in rows]


class PharmacyActionIn(BaseModel):
    status: str
    note: str = Field(default="", max_length=500)
    price: Optional[float] = Field(default=None, ge=0)
    prescription_verified: Optional[bool] = None


PHARMACY_STATUSES = {"needs_clarification", "rejected", "unavailable", "confirmed", "preparing", "ready",
                     "collected", "closed", "cancelled"}


@router.post("/orders/{oid}/pharmacy-action")
def pharmacy_action(oid: int, data: PharmacyActionIn, ctx=Depends(approved_profile("pharmacy")),
                    session: Session = Depends(get_session)):
    user, ph = ctx
    o = session.get(MedicineOrder, oid)
    if not o or o.pharmacy_id != ph.id:
        raise HTTPException(404, "Order not found")
    if data.status not in PHARMACY_STATUSES:
        raise HTTPException(422, "Use the delivery actions for delivery statuses")
    if data.prescription_verified is not None:
        o.prescription_verified = data.prescription_verified
    if data.status == "confirmed" and o.requires_prescription and not o.prescription_verified:
        raise HTTPException(422, "Check and verify the prescription before confirming this order")
    if data.price is not None:
        o.price_quoted = data.price
    if data.note:
        o.pharmacy_note = data.note
    transition(session, "order", o, data.status, user.id, data.note)
    notify(session, o.patient_user_id, f"Order {o.code}: {data.status.replace('_', ' ')}",
           data.note or f"Update from {ph.name}", "#order-" + str(o.id))
    session.commit()
    return order_public(session, o, detail=True)


@router.post("/orders/{oid}/request-delivery")
def request_delivery(oid: int, ctx=Depends(approved_profile("pharmacy")), session: Session = Depends(get_session)):
    user, ph = ctx
    o = session.get(MedicineOrder, oid)
    if not o or o.pharmacy_id != ph.id:
        raise HTTPException(404, "Order not found")
    if o.status not in ("ready", "delivery_failed"):
        raise HTTPException(409, "Mark the order ready before requesting delivery")
    if not o.delivery_address:
        raise HTTPException(422, "The patient did not give a delivery address")
    transition(session, "order", o, "delivery_requested", user.id, "Volunteer delivery requested")
    d = session.exec(select(Delivery).where(Delivery.order_id == o.id)).first()
    if d is None:
        d = Delivery(order_id=o.id, pickup_lat=ph.lat, pickup_lng=ph.lng, drop_lat=o.lat, drop_lng=o.lng)
        session.add(d)
        session.flush()
        record_created(session, "delivery", d, user.id)
    found = offer_next(session, d, user.id)
    notify(session, o.patient_user_id, f"Order {o.code}: delivery requested",
           "Looking for a volunteer." if found else "No volunteer free right now; we will keep trying.",
           "#order-" + str(o.id))
    session.commit()
    return order_public(session, o, detail=True)
