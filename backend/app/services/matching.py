"""Donor matching and nearby-facility search."""
from datetime import date, timedelta

from sqlmodel import Session, select

from ..config import settings
from ..models import iso, BloodRequest, BloodStock, Donor, DonorResponse, Facility, User, utcnow
from .geo import bounding_box, haversine
from .notify import notify

# Recipient group -> donor groups whose red cells are compatible.
COMPATIBLE_DONORS = {
    "O-": ["O-"],
    "O+": ["O+", "O-"],
    "A-": ["A-", "O-"],
    "A+": ["A+", "A-", "O+", "O-"],
    "B-": ["B-", "O-"],
    "B+": ["B+", "B-", "O+", "O-"],
    "AB-": ["AB-", "A-", "B-", "O-"],
    "AB+": ["AB+", "AB-", "A+", "A-", "B+", "B-", "O+", "O-"],
}


def donation_gap_ok(d: Donor) -> bool:
    if not d.last_donation_date:
        return True
    return d.last_donation_date <= date.today() - timedelta(days=settings.min_donation_gap_days)


def find_donors(session: Session, req: BloodRequest) -> list[tuple[Donor, float, bool]]:
    """Approved, available, compatible donors; radius widens until enough are found.
    Ranked exact-group first, then by distance."""
    groups = COMPATIBLE_DONORS[req.blood_group]
    found: list[tuple[Donor, float, bool]] = []
    for radius in settings.match_radii_km:
        min_lat, max_lat, min_lng, max_lng = bounding_box(req.lat, req.lng, radius)
        rows = session.exec(
            select(Donor).where(
                Donor.verification_status == "approved",
                Donor.is_available == True,  # noqa: E712
                Donor.blood_group.in_(groups),
                Donor.user_id != req.requester_user_id,
                Donor.lat.between(min_lat, max_lat),
                Donor.lng.between(min_lng, max_lng),
            )
        ).all()
        found = []
        for d in rows:
            dist = haversine(req.lat, req.lng, d.lat, d.lng)
            if dist <= radius and donation_gap_ok(d):
                found.append((d, dist, d.blood_group == req.blood_group))
        if len(found) >= settings.match_target:
            break
    found.sort(key=lambda t: (not t[2], t[1]))
    return found[: settings.match_target * 2]


def match_and_notify(session: Session, req: BloodRequest) -> int:
    """Create DonorResponse rows for new matches and notify those donors. Returns number notified."""
    existing = {r.donor_id for r in session.exec(select(DonorResponse).where(DonorResponse.request_id == req.id))}
    count = 0
    for donor, dist, exact in find_donors(session, req):
        if donor.id in existing:
            continue
        session.add(DonorResponse(request_id=req.id, donor_id=donor.id, distance_km=round(dist, 2), exact_match=exact))
        notify(session, donor.user_id, f"{req.urgency.title()} need: {req.blood_group} blood",
               f"{req.units} unit(s) needed in {req.city}, about {dist:.1f} km from you.", "#donor-requests")
        count += 1
    return count


def nearby_bloodbanks(session: Session, lat: float, lng: float, radius: float, group: str | None = None) -> list[dict]:
    min_lat, max_lat, min_lng, max_lng = bounding_box(lat, lng, radius)
    banks = session.exec(
        select(Facility).where(
            Facility.kind == "bloodbank", Facility.verification_status == "approved",
            Facility.lat.between(min_lat, max_lat), Facility.lng.between(min_lng, max_lng),
        )
    ).all()
    groups = COMPATIBLE_DONORS.get(group, []) if group else None
    out = []
    for b in banks:
        dist = haversine(lat, lng, b.lat, b.lng)
        if dist > radius:
            continue
        stock = session.exec(select(BloodStock).where(BloodStock.facility_id == b.id)).all()
        out.append({**facility_public(b), "distance_km": round(dist, 2),
                    "stock": [stock_public(s) for s in stock],
                    "exact_units": sum(s.units for s in stock if s.blood_group == group) if group else None,
                    "compatible_units": sum(s.units for s in stock if groups and s.blood_group in groups) if group else None})
    out.sort(key=lambda x: (-(x["exact_units"] or 0) if group else 0, x["distance_km"]))
    return out


def facility_public(f: Facility) -> dict:
    return {"id": f.id, "kind": f.kind, "name": f.name, "address": f.address, "city": f.city,
            "contact": f.contact, "lat": f.lat, "lng": f.lng}


def stock_public(s: BloodStock) -> dict:
    age_h = (utcnow() - s.reported_at).total_seconds() / 3600
    return {"blood_group": s.blood_group, "units": s.units, "reported_at": iso(s.reported_at),
            "stale": age_h > settings.stale_stock_hours}


def donor_public(session: Session, d: Donor, reveal_contact: bool) -> dict:
    out = {"donor_id": d.id, "blood_group": d.blood_group, "city": d.city}
    if reveal_contact:
        u = session.get(User, d.user_id)
        out.update(name=u.name, phone=u.phone, email=u.email)
    return out
