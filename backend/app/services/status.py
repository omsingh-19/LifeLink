"""Allowed status transitions per entity, with an audit trail."""
import secrets

from fastapi import HTTPException
from sqlmodel import Session

from ..models import StatusHistory, utcnow

BLOOD_REQUEST = {
    "open": {"in_progress", "fulfilled", "cancelled"},
    "in_progress": {"fulfilled", "cancelled"},
    "fulfilled": {"closed"},
    "cancelled": {"closed"},
    "closed": set(),
}

ORDER = {
    "requested": {"needs_clarification", "rejected", "unavailable", "confirmed", "cancelled"},
    "needs_clarification": {"requested", "rejected", "cancelled"},
    "confirmed": {"preparing", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"collected", "delivery_requested", "cancelled"},
    "delivery_requested": {"out_for_delivery", "delivery_failed", "cancelled"},
    "out_for_delivery": {"delivered", "delivery_failed"},
    "delivery_failed": {"delivery_requested", "ready", "cancelled"},
    "collected": {"closed"},
    "delivered": {"closed"},
    "rejected": set(),
    "unavailable": set(),
    "cancelled": set(),
    "closed": set(),
}

DELIVERY = {
    "searching": {"offered", "unassigned", "cancelled"},
    "unassigned": {"offered", "cancelled"},
    "offered": {"accepted", "offered", "unassigned", "cancelled"},
    "accepted": {"collected", "failed", "cancelled"},
    "collected": {"out_for_delivery", "failed"},
    "out_for_delivery": {"delivered", "failed"},
    "failed": {"offered", "unassigned", "cancelled"},
    "delivered": set(),
    "cancelled": set(),
}

MACHINES = {"blood_request": BLOOD_REQUEST, "order": ORDER, "delivery": DELIVERY}


def transition(session: Session, entity: str, obj, to_status: str, by_user_id: int | None, note: str = "") -> None:
    """Move obj.status to to_status if allowed; records StatusHistory. Raises 409 otherwise."""
    current = obj.status
    if to_status == current:
        return
    if to_status not in MACHINES[entity].get(current, set()):
        raise HTTPException(409, f"Cannot change status from '{current}' to '{to_status}'")
    obj.status = to_status
    if hasattr(obj, "updated_at"):
        obj.updated_at = utcnow()
    session.add(obj)
    session.add(StatusHistory(entity=entity, entity_id=obj.id, from_status=current,
                              to_status=to_status, by_user_id=by_user_id, note=note))


def record_created(session: Session, entity: str, obj, by_user_id: int | None) -> None:
    session.add(StatusHistory(entity=entity, entity_id=obj.id, to_status=obj.status, by_user_id=by_user_id,
                              note="Created"))


def new_code(prefix: str) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return prefix + "-" + "".join(secrets.choice(alphabet) for _ in range(6))
