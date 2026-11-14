"""Volunteer selection for deliveries: offer to the nearest eligible volunteer, move on when declined or expired."""
from datetime import timedelta

from sqlmodel import Session, select

from ..config import settings
from ..models import Delivery, DeliveryOffer, Facility, MedicineOrder, Volunteer, utcnow
from . import eta
from .geo import haversine
from .notify import notify, notify_admins
from .status import transition

ACTIVE_DELIVERY = ("accepted", "collected", "out_for_delivery")


def busy_volunteer_ids(session: Session) -> set[int]:
    busy = {d.volunteer_id for d in session.exec(select(Delivery).where(Delivery.status.in_(ACTIVE_DELIVERY)))}
    busy |= {o.volunteer_id for o in session.exec(select(DeliveryOffer).where(DeliveryOffer.status == "offered"))}
    return {b for b in busy if b}


def eligible_volunteers(session: Session, delivery: Delivery) -> list[tuple[Volunteer, float]]:
    tried = {o.volunteer_id for o in session.exec(select(DeliveryOffer).where(DeliveryOffer.delivery_id == delivery.id))}
    busy = busy_volunteer_ids(session)
    out = []
    for v in session.exec(select(Volunteer).where(Volunteer.verification_status == "approved",
                                                  Volunteer.is_available == True)):  # noqa: E712
        if v.id in tried or v.id in busy:
            continue
        dist = haversine(v.lat, v.lng, delivery.pickup_lat, delivery.pickup_lng)
        if dist <= v.service_radius_km:
            out.append((v, dist))
    out.sort(key=lambda t: t[1])
    return out


def make_offer(session: Session, delivery: Delivery, volunteer: Volunteer, by_user_id: int | None) -> DeliveryOffer:
    offer = DeliveryOffer(delivery_id=delivery.id, volunteer_id=volunteer.id)
    session.add(offer)
    delivery.volunteer_id = None
    transition(session, "delivery", delivery, "offered", by_user_id, f"Offered to volunteer #{volunteer.id}")
    dist = haversine(volunteer.lat, volunteer.lng, delivery.pickup_lat, delivery.pickup_lng)
    notify(session, volunteer.user_id, "New delivery offer",
           f"Pickup about {dist:.1f} km from you. Please accept or decline.", "#vol-offers")
    return offer


def offer_next(session: Session, delivery: Delivery, by_user_id: int | None = None) -> bool:
    candidates = eligible_volunteers(session, delivery)
    if candidates:
        make_offer(session, delivery, candidates[0][0], by_user_id)
        return True
    if delivery.status != "unassigned":
        transition(session, "delivery", delivery, "unassigned", by_user_id, "No eligible volunteer available")
    order = session.get(MedicineOrder, delivery.order_id)
    pharmacy = session.get(Facility, order.pharmacy_id)
    notify(session, pharmacy.user_id, f"No volunteer found for order {order.code}",
           "An admin can assign one manually, or the patient can collect.", "#ph-orders")
    notify_admins(session, f"Delivery for {order.code} needs manual assignment", "", "#admin-deliveries")
    return False


def expire_stale_offers(session: Session) -> None:
    cutoff = utcnow() - timedelta(minutes=settings.offer_timeout_minutes)
    stale = session.exec(select(DeliveryOffer).where(DeliveryOffer.status == "offered",
                                                     DeliveryOffer.offered_at < cutoff)).all()
    for offer in stale:
        offer.status, offer.responded_at = "expired", utcnow()
        session.add(offer)
        session.flush()
        delivery = session.get(Delivery, offer.delivery_id)
        if delivery.status == "offered":
            offer_next(session, delivery)
    if stale:
        session.commit()


def compute_eta(session: Session, delivery: Delivery, from_point: tuple[float, float] | None) -> None:
    """from_point = volunteer position before pickup; None once the order is collected."""
    points = [(delivery.pickup_lat, delivery.pickup_lng), (delivery.drop_lat, delivery.drop_lng)]
    if from_point:
        points.insert(0, from_point)
    r = eta.estimate(points)
    delivery.distance_km, delivery.eta_minutes, delivery.eta_source = r["distance_km"], r["eta_minutes"], r["source"]
    delivery.eta_computed_at = utcnow()
    session.add(delivery)
