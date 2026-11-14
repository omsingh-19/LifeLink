from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..config import settings
from ..database import get_session
from ..deps import approved_profile, own_profile, profile_of
from ..models import (iso, BLOOD_GROUPS, BloodBankResponse, BloodRequest, BloodStock, Donor, DonorResponse, Facility,
                      StatusHistory, User, utcnow)
from ..security import get_current_user, require_role
from ..services.geo import haversine
from ..services.matching import (COMPATIBLE_DONORS, donor_public, facility_public, match_and_notify,
                                 nearby_bloodbanks, stock_public)
from ..services.notify import notify
from ..services.status import new_code, record_created, transition

router = APIRouter(prefix="/api", tags=["blood"])

BANK_ALERT_RADIUS_KM = 25
BANK_QUEUE_RADIUS_KM = 50


class BloodRequestIn(BaseModel):
    patient_name: str = Field(min_length=2, max_length=120)
    blood_group: str
    units: int = Field(ge=1, le=20)
    urgency: str = "high"
    city: str = Field(min_length=2)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    contact: str = Field(min_length=7, max_length=20)
    notes: str = Field(default="", max_length=500)


class StatusIn(BaseModel):
    status: str
    note: str = Field(default="", max_length=500)


def requester(user: User = Depends(require_role("hospital", "patient")), session: Session = Depends(get_session)):
    if user.role == "hospital":
        prof = profile_of(session, user)
        if not prof or prof.verification_status != "approved":
            raise HTTPException(403, "Hospital account is awaiting verification")
    return user


def timeline(session: Session, entity: str, eid: int) -> list[dict]:
    rows = session.exec(select(StatusHistory).where(StatusHistory.entity == entity, StatusHistory.entity_id == eid)
                        .order_by(StatusHistory.at)).all()
    return [{"from": r.from_status, "to": r.to_status, "note": r.note, "at": iso(r.at)} for r in rows]


def request_summary(r: BloodRequest) -> dict:
    return {"id": r.id, "code": r.code, "blood_group": r.blood_group, "units": r.units, "urgency": r.urgency,
            "city": r.city, "status": r.status, "created_at": iso(r.created_at),
            "patient_name": r.patient_name, "lat": r.lat, "lng": r.lng}


def request_detail(session: Session, r: BloodRequest) -> dict:
    donors = []
    for resp in session.exec(select(DonorResponse).where(DonorResponse.request_id == r.id)
                             .order_by(DonorResponse.exact_match.desc(), DonorResponse.distance_km)):
        d = session.get(Donor, resp.donor_id)
        donors.append({**donor_public(session, d, resp.status == "accepted"), "status": resp.status,
                       "distance_km": resp.distance_km, "exact_match": resp.exact_match})
    banks = []
    for br in session.exec(select(BloodBankResponse).where(BloodBankResponse.request_id == r.id)):
        f = session.get(Facility, br.facility_id)
        banks.append({**facility_public(f), "status": br.status, "units_confirmed": br.units_confirmed,
                      "note": br.note, "responded_at": iso(br.responded_at)})
    return {**request_summary(r), "contact": r.contact, "notes": r.notes, "donors": donors,
            "bank_responses": banks, "nearby_bloodbanks": nearby_bloodbanks(session, r.lat, r.lng, 50, r.blood_group),
            "timeline": timeline(session, "blood_request", r.id)}


def alert_bloodbanks(session: Session, r: BloodRequest) -> None:
    groups = COMPATIBLE_DONORS[r.blood_group]
    for bank in nearby_bloodbanks(session, r.lat, r.lng, BANK_ALERT_RADIUS_KM, r.blood_group):
        if any(s["units"] > 0 and s["blood_group"] in groups for s in bank["stock"]):
            f = session.get(Facility, bank["id"])
            notify(session, f.user_id, f"Blood request {r.code}: {r.blood_group} x{r.units}",
                   f"{r.urgency.title()} urgency, {bank['distance_km']} km away.", "#bb-requests")


# ---------- Blood requests (hospital / patient) ----------

@router.post("/blood-requests")
def create_request(data: BloodRequestIn, user: User = Depends(requester), session: Session = Depends(get_session)):
    if data.blood_group not in BLOOD_GROUPS:
        raise HTTPException(422, "Invalid blood group")
    if data.urgency not in ("critical", "high", "normal"):
        raise HTTPException(422, "Invalid urgency")
    r = BloodRequest(**data.model_dump(), code=new_code("B"), requester_user_id=user.id, requester_role=user.role)
    session.add(r)
    session.flush()
    record_created(session, "blood_request", r, user.id)
    matched = match_and_notify(session, r)
    alert_bloodbanks(session, r)
    session.commit()
    session.refresh(r)
    return {**request_detail(session, r), "donors_notified": matched}


@router.get("/blood-requests/mine")
def my_requests(user: User = Depends(require_role("hospital", "patient")), session: Session = Depends(get_session)):
    rows = session.exec(select(BloodRequest).where(BloodRequest.requester_user_id == user.id)
                        .order_by(BloodRequest.created_at.desc())).all()
    out = []
    for r in rows:
        resps = session.exec(select(DonorResponse).where(DonorResponse.request_id == r.id)).all()
        out.append({**request_summary(r), "donors_notified": len(resps),
                    "donors_accepted": sum(1 for x in resps if x.status == "accepted")})
    return out


def _owned_request(session: Session, rid: int, user: User) -> BloodRequest:
    r = session.get(BloodRequest, rid)
    if not r:
        raise HTTPException(404, "Request not found")
    if user.role != "admin" and r.requester_user_id != user.id:
        raise HTTPException(403, "You can only view your own requests")
    return r


@router.get("/blood-requests/{rid}")
def get_request(rid: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return request_detail(session, _owned_request(session, rid, user))


@router.post("/blood-requests/{rid}/rematch")
def rematch(rid: int, user: User = Depends(requester), session: Session = Depends(get_session)):
    r = _owned_request(session, rid, user)
    if r.status not in ("open", "in_progress"):
        raise HTTPException(409, "Request is no longer active")
    n = match_and_notify(session, r)
    session.commit()
    return {"donors_notified": n}


@router.patch("/blood-requests/{rid}/status")
def update_request_status(rid: int, data: StatusIn, user: User = Depends(get_current_user),
                          session: Session = Depends(get_session)):
    r = _owned_request(session, rid, user)
    transition(session, "blood_request", r, data.status, user.id, data.note)
    for resp in session.exec(select(DonorResponse).where(DonorResponse.request_id == r.id,
                                                         DonorResponse.status == "accepted")):
        d = session.get(Donor, resp.donor_id)
        notify(session, d.user_id, f"Request {r.code} is now {data.status.replace('_', ' ')}", data.note, "#donor-requests")
    session.commit()
    return request_detail(session, r)


# ---------- Donor ----------

class DonorUpdate(BaseModel):
    is_available: Optional[bool] = None
    last_donation_date: Optional[date] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)


@router.patch("/donors/me")
def update_donor(data: DonorUpdate, ctx=Depends(own_profile("donor")), session: Session = Depends(get_session)):
    _, donor = ctx
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(donor, k, v)
    session.add(donor)
    session.commit()
    return donor.model_dump()


@router.get("/donors/me/requests")
def donor_requests(ctx=Depends(own_profile("donor")), session: Session = Depends(get_session)):
    _, donor = ctx
    out = []
    for resp in session.exec(select(DonorResponse).where(DonorResponse.donor_id == donor.id)
                             .order_by(DonorResponse.id.desc())):
        r = session.get(BloodRequest, resp.request_id)
        item = {"response_id": resp.id, "response": resp.status, "distance_km": resp.distance_km,
                "code": r.code, "blood_group": r.blood_group, "units": r.units, "urgency": r.urgency,
                "city": r.city, "request_status": r.status, "created_at": iso(r.created_at)}
        if resp.status == "accepted":  # contact shared only after the donor accepts
            item.update(patient_name=r.patient_name, contact=r.contact, lat=r.lat, lng=r.lng, notes=r.notes)
        out.append(item)
    return out


class RespondIn(BaseModel):
    accept: bool


@router.post("/donors/me/requests/{response_id}/respond")
def donor_respond(response_id: int, data: RespondIn, ctx=Depends(approved_profile("donor")),
                  session: Session = Depends(get_session)):
    user, donor = ctx
    resp = session.get(DonorResponse, response_id)
    if not resp or resp.donor_id != donor.id:
        raise HTTPException(404, "Request not found")
    r = session.get(BloodRequest, resp.request_id)
    if r.status not in ("open", "in_progress"):
        raise HTTPException(409, "This request is no longer active")
    if resp.status != "notified":
        raise HTTPException(409, "You have already responded")
    resp.status, resp.responded_at = ("accepted" if data.accept else "declined"), utcnow()
    session.add(resp)
    if data.accept:
        if r.status == "open":
            transition(session, "blood_request", r, "in_progress", user.id, f"Donor {user.name} accepted")
        notify(session, r.requester_user_id, f"A donor accepted request {r.code}",
               f"{user.name} ({donor.blood_group}) is willing to help. Contact: {user.phone}", "#req-" + str(r.id))
    session.commit()
    return {"ok": True, "status": resp.status}


# ---------- Blood bank ----------

class StockIn(BaseModel):
    stock: dict[str, int]


@router.get("/bloodbanks/me/stock")
def get_stock(ctx=Depends(own_profile("bloodbank")), session: Session = Depends(get_session)):
    _, bank = ctx
    rows = {s.blood_group: s for s in session.exec(select(BloodStock).where(BloodStock.facility_id == bank.id))}
    return [stock_public(rows[g]) if g in rows else {"blood_group": g, "units": 0, "reported_at": None, "stale": True}
            for g in BLOOD_GROUPS]


@router.put("/bloodbanks/me/stock")
def put_stock(data: StockIn, ctx=Depends(approved_profile("bloodbank")), session: Session = Depends(get_session)):
    _, bank = ctx
    for group, units in data.stock.items():
        if group not in BLOOD_GROUPS or not (0 <= units <= 10000):
            raise HTTPException(422, f"Invalid entry for {group}")
        row = session.exec(select(BloodStock).where(BloodStock.facility_id == bank.id,
                                                    BloodStock.blood_group == group)).first()
        row = row or BloodStock(facility_id=bank.id, blood_group=group)
        row.units, row.reported_at = units, utcnow()
        session.add(row)
    session.commit()
    return get_stock((None, bank), session)


@router.get("/bloodbanks/me/requests")
def bank_requests(ctx=Depends(approved_profile("bloodbank")), session: Session = Depends(get_session)):
    _, bank = ctx
    mine = {br.request_id: br for br in session.exec(select(BloodBankResponse)
                                                      .where(BloodBankResponse.facility_id == bank.id))}
    out = []
    for r in session.exec(select(BloodRequest).order_by(BloodRequest.created_at.desc())):
        dist = haversine(bank.lat, bank.lng, r.lat, r.lng)
        if r.id not in mine and (r.status not in ("open", "in_progress") or dist > BANK_QUEUE_RADIUS_KM):
            continue
        item = {**request_summary(r), "distance_km": round(dist, 2), "contact": r.contact, "my_response": None}
        if r.id in mine:
            br = mine[r.id]
            item["my_response"] = {"status": br.status, "units_confirmed": br.units_confirmed, "note": br.note}
        out.append(item)
    return out


class BankRespondIn(BaseModel):
    status: str
    units_confirmed: int = Field(default=0, ge=0, le=100)
    note: str = Field(default="", max_length=300)


@router.post("/bloodbanks/me/requests/{rid}/respond")
def bank_respond(rid: int, data: BankRespondIn, ctx=Depends(approved_profile("bloodbank")),
                 session: Session = Depends(get_session)):
    user, bank = ctx
    if data.status not in ("confirmed_available", "not_available"):
        raise HTTPException(422, "Invalid response")
    r = session.get(BloodRequest, rid)
    if not r or r.status not in ("open", "in_progress"):
        raise HTTPException(409, "Request is not active")
    br = session.exec(select(BloodBankResponse).where(BloodBankResponse.request_id == rid,
                                                      BloodBankResponse.facility_id == bank.id)).first()
    br = br or BloodBankResponse(request_id=rid, facility_id=bank.id, status=data.status)
    br.status, br.units_confirmed, br.note, br.responded_at = data.status, data.units_confirmed, data.note, utcnow()
    session.add(br)
    if data.status == "confirmed_available" and r.status == "open":
        transition(session, "blood_request", r, "in_progress", user.id, f"{bank.name} confirmed availability")
    msg = (f"{bank.name} confirmed {data.units_confirmed} unit(s). Call {bank.contact}."
           if data.status == "confirmed_available" else f"{bank.name} reports no availability.")
    notify(session, r.requester_user_id, f"Blood bank response for {r.code}", msg, "#req-" + str(r.id))
    session.commit()
    return {"ok": True}


@router.get("/bloodbanks/nearby")
def bloodbanks_nearby(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180),
                      group: Optional[str] = None, radius: float = Query(default=25, gt=0, le=200),
                      session: Session = Depends(get_session)):
    if group and group not in BLOOD_GROUPS:
        raise HTTPException(422, "Invalid blood group")
    return nearby_bloodbanks(session, lat, lng, radius, group)


@router.get("/blood-groups")
def blood_groups():
    return {"groups": BLOOD_GROUPS, "compatible_donors": COMPATIBLE_DONORS,
            "min_donation_gap_days": settings.min_donation_gap_days}
