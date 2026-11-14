from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, func, select

from ..database import get_session
from ..deps import latest_verification
from ..models import (iso, utcnow, VERIFY_STATUSES, BloodRequest, BloodStock, Delivery, DonationCamp, Donor, DonorResponse,
                      Facility, MedicineOrder, Notification, User, Verification, Volunteer)
from ..security import get_current_user, require_role
from ..services.geo import haversine
from ..services.matching import facility_public, stock_public
from ..services.notify import notify
from .blood import timeline
from .medicine import delivery_public

router = APIRouter(prefix="/api", tags=["common"])

IST = timezone(timedelta(hours=5, minutes=30))
SUBJECTS = {"donor": Donor, "facility": Facility, "volunteer": Volunteer}


# ---------- Notifications ----------

@router.get("/notifications")
def list_notifications(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(Notification).where(Notification.user_id == user.id)
                        .order_by(Notification.created_at.desc()).limit(50)).all()
    unread = session.exec(select(func.count()).select_from(Notification)
                          .where(Notification.user_id == user.id, Notification.is_read == False)).one()  # noqa: E712
    return {"unread": unread, "items": [{"id": n.id, "title": n.title, "body": n.body, "link": n.link,
                                         "is_read": n.is_read, "created_at": iso(n.created_at)}
                                        for n in rows]}


@router.post("/notifications/read-all")
def read_all(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    for n in session.exec(select(Notification).where(Notification.user_id == user.id, Notification.is_read == False)):  # noqa: E712
        n.is_read = True
        session.add(n)
    session.commit()
    return {"ok": True}


# ---------- Admin: physical verification ----------

def _subject_view(session: Session, stype: str, obj) -> dict:
    u = session.get(User, obj.user_id)
    v = latest_verification(session, stype, obj.id)
    role = obj.kind if stype == "facility" else stype
    info = {"donor": lambda: f"{obj.blood_group} · {obj.city} {obj.pincode}",
            "facility": lambda: f"{obj.address}, {obj.city} · Licence {obj.license_no}",
            "volunteer": lambda: f"{obj.city} · {obj.vehicle} · {obj.service_radius_km:g} km radius"}[stype]()
    return {"subject_type": stype, "subject_id": obj.id, "role": role, "name": u.name, "email": u.email,
            "phone": u.phone, "details": info, "status": obj.verification_status,
            "last_remarks": v.remarks if v else "", "registered_at": iso(u.created_at)}


@router.get("/admin/verifications")
def verification_queue(status: str = "pending", user: User = Depends(require_role("admin")),
                       session: Session = Depends(get_session)):
    statuses = ["pending", "needs_correction"] if status == "pending" else [status]
    out = []
    for stype, model in SUBJECTS.items():
        for obj in session.exec(select(model).where(model.verification_status.in_(statuses))):
            out.append(_subject_view(session, stype, obj))
    out.sort(key=lambda x: x["registered_at"])
    return out


class DecisionIn(BaseModel):
    status: str
    documents_checked: str = Field(default="", max_length=500)
    remarks: str = Field(default="", max_length=500)


@router.post("/admin/verifications/{stype}/{sid}")
def decide(stype: str, sid: int, data: DecisionIn, user: User = Depends(require_role("admin")),
           session: Session = Depends(get_session)):
    model = SUBJECTS.get(stype)
    if not model or data.status not in VERIFY_STATUSES or data.status == "pending":
        raise HTTPException(422, "Invalid subject or decision")
    if data.status != "approved" and not data.remarks.strip():
        raise HTTPException(422, "Add remarks explaining the rejection or correction needed")
    obj = session.get(model, sid)
    if not obj:
        raise HTTPException(404, "Not found")
    obj.verification_status = data.status
    session.add(obj)
    session.add(Verification(subject_type=stype, subject_id=sid, status=data.status,
                             documents_checked=data.documents_checked, remarks=data.remarks, verified_by=user.id))
    notify(session, obj.user_id, f"Verification: {data.status.replace('_', ' ')}", data.remarks, "#home")
    session.commit()
    return _subject_view(session, stype, obj)


@router.get("/admin/users")
def all_users(user: User = Depends(require_role("admin")), session: Session = Depends(get_session)):
    out = []
    for stype, model in SUBJECTS.items():
        for obj in session.exec(select(model)):
            out.append(_subject_view(session, stype, obj))
    return out


@router.get("/admin/stats")
def stats(user: User = Depends(require_role("admin")), session: Session = Depends(get_session)):
    def count(model, *where):
        return session.exec(select(func.count()).select_from(model).where(*where)).one()

    reqs = session.exec(select(BloodRequest)).all()
    done = [r for r in reqs if r.status in ("fulfilled", "closed")]
    responses = session.exec(select(DonorResponse).where(DonorResponse.responded_at != None)).all()  # noqa: E711
    resp_minutes = []
    for resp in responses:
        r = session.get(BloodRequest, resp.request_id)
        resp_minutes.append((resp.responded_at - r.created_at).total_seconds() / 60)
    return {
        "donors_approved": count(Donor, Donor.verification_status == "approved"),
        "donors_available": count(Donor, Donor.verification_status == "approved", Donor.is_available == True),  # noqa: E712
        "facilities_approved": count(Facility, Facility.verification_status == "approved"),
        "volunteers_approved": count(Volunteer, Volunteer.verification_status == "approved"),
        "pending_verifications": sum(count(m, m.verification_status.in_(["pending", "needs_correction"]))
                                     for m in SUBJECTS.values()),
        "blood_requests_total": len(reqs),
        "blood_requests_open": sum(1 for r in reqs if r.status in ("open", "in_progress")),
        "blood_fulfilment_rate": round(len(done) / len(reqs) * 100, 1) if reqs else None,
        "avg_donor_response_min": round(sum(resp_minutes) / len(resp_minutes), 1) if resp_minutes else None,
        "orders_total": count(MedicineOrder),
        "orders_delivered": count(MedicineOrder, MedicineOrder.status.in_(["delivered", "collected", "closed"])),
        "deliveries_active": count(Delivery, Delivery.status.in_(["offered", "accepted", "collected", "out_for_delivery"])),
        "deliveries_unassigned": count(Delivery, Delivery.status.in_(["unassigned", "failed"])),
    }


@router.get("/admin/blood-requests")
def admin_requests(user: User = Depends(require_role("admin")), session: Session = Depends(get_session)):
    from .blood import request_summary
    return [request_summary(r) for r in session.exec(select(BloodRequest).order_by(BloodRequest.created_at.desc()))]


# ---------- Donation camps ----------

class CampIn(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    organizer: str = Field(min_length=2, max_length=150)
    address: str = Field(min_length=3, max_length=250)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    starts_at: datetime
    ends_at: datetime
    contact: str = ""

    @field_validator("starts_at", "ends_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        return v if v.tzinfo else v.replace(tzinfo=IST)  # form times without a zone are Indian Standard Time


def camp_public(c: DonationCamp) -> dict:
    return {**c.model_dump(), "starts_at": iso(c.starts_at), "ends_at": iso(c.ends_at)}


@router.get("/camps")
def camps(lat: Optional[float] = None, lng: Optional[float] = None, session: Session = Depends(get_session)):
    rows = session.exec(select(DonationCamp).where(DonationCamp.ends_at >= utcnow())
                        .order_by(DonationCamp.starts_at)).all()
    out = [camp_public(c) for c in rows]
    if lat is not None and lng is not None:
        for c in out:
            c["distance_km"] = round(haversine(lat, lng, c["lat"], c["lng"]), 2)
    return out


@router.post("/camps")
def add_camp(data: CampIn, user: User = Depends(require_role("admin")), session: Session = Depends(get_session)):
    if data.ends_at <= data.starts_at:
        raise HTTPException(422, "End time must be after start time")
    c = DonationCamp(**data.model_dump())
    session.add(c)
    session.commit()
    session.refresh(c)
    return camp_public(c)


@router.delete("/camps/{cid}")
def delete_camp(cid: int, user: User = Depends(require_role("admin")), session: Session = Depends(get_session)):
    c = session.get(DonationCamp, cid)
    if not c:
        raise HTTPException(404, "Not found")
    session.delete(c)
    session.commit()
    return {"ok": True}


# ---------- Public map + tracking ----------

@router.get("/map/facilities")
def map_facilities(kinds: str = Query(default="bloodbank,pharmacy"), session: Session = Depends(get_session)):
    wanted = [k for k in kinds.split(",") if k in ("bloodbank", "pharmacy", "hospital")]
    out = []
    for f in session.exec(select(Facility).where(Facility.kind.in_(wanted), Facility.verification_status == "approved")):
        item = facility_public(f)
        if f.kind == "bloodbank":
            item["stock"] = [stock_public(s) for s in session.exec(select(BloodStock).where(BloodStock.facility_id == f.id))]
        out.append(item)
    return out


@router.get("/track/{code}")
def track(code: str, session: Session = Depends(get_session)):
    """Public, limited view: status and timeline only, no personal data."""
    code = code.strip().upper()
    if code.startswith("B-"):
        r = session.exec(select(BloodRequest).where(BloodRequest.code == code)).first()
        if r:
            return {"type": "blood", "code": r.code, "status": r.status, "summary": f"{r.blood_group} x{r.units} · {r.city}",
                    "timeline": timeline(session, "blood_request", r.id), "delivery": None}
    if code.startswith("M-"):
        o = session.exec(select(MedicineOrder).where(MedicineOrder.code == code)).first()
        if o:
            d = session.exec(select(Delivery).where(Delivery.order_id == o.id)).first()
            ph = session.get(Facility, o.pharmacy_id)
            dp = delivery_public(session, d, full=False)
            return {"type": "medicine", "code": o.code, "status": o.status,
                    "summary": f"{o.medicine_name} {o.strength} · {ph.name}",
                    "timeline": timeline(session, "order", o.id), "delivery": dp}
    raise HTTPException(404, "No request found with this code")
