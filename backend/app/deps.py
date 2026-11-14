"""Profile lookups and the verification gate shared by routers."""
from fastapi import Depends, HTTPException
from sqlmodel import Session, select

from .database import get_session
from .models import Donor, Facility, User, Verification, Volunteer
from .security import require_role


def profile_of(session: Session, user: User):
    if user.role == "donor":
        return session.exec(select(Donor).where(Donor.user_id == user.id)).first()
    if user.role in ("hospital", "bloodbank", "pharmacy"):
        return session.exec(select(Facility).where(Facility.user_id == user.id)).first()
    if user.role == "volunteer":
        return session.exec(select(Volunteer).where(Volunteer.user_id == user.id)).first()
    return None


def subject_type(user: User) -> str | None:
    return {"donor": "donor", "volunteer": "volunteer", "hospital": "facility",
            "bloodbank": "facility", "pharmacy": "facility"}.get(user.role)


def latest_verification(session: Session, stype: str, sid: int) -> Verification | None:
    return session.exec(select(Verification).where(Verification.subject_type == stype, Verification.subject_id == sid)
                        .order_by(Verification.verified_at.desc())).first()


def approved_profile(*roles: str):
    """Dependency: user has one of roles AND their profile passed physical verification."""

    def dep(user: User = Depends(require_role(*roles)), session: Session = Depends(get_session)):
        prof = profile_of(session, user)
        if prof is None or prof.verification_status != "approved":
            raise HTTPException(403, "Your account is awaiting verification by an administrator")
        return user, prof

    return dep


def own_profile(*roles: str):
    """Dependency: profile regardless of verification state (for viewing/editing own data)."""

    def dep(user: User = Depends(require_role(*roles)), session: Session = Depends(get_session)):
        prof = profile_of(session, user)
        if prof is None:
            raise HTTPException(404, "Profile not found")
        return user, prof

    return dep
