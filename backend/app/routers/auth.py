import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from ..database import get_session
from ..deps import latest_verification, profile_of, subject_type
from ..models import iso, BLOOD_GROUPS, FACILITY_ROLES, Donor, Facility, User, Volunteer
from ..security import create_token, get_current_user, hash_password, verify_password
from ..services.notify import notify_admins

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[0-9 \-]{7,15}$")


class RegisterIn(BaseModel):
    role: str
    name: str = Field(min_length=2, max_length=120)
    email: str
    phone: str
    password: str = Field(min_length=6, max_length=128)
    city: Optional[str] = None
    pincode: Optional[str] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    blood_group: Optional[str] = None
    last_donation_date: Optional[date] = None
    address: Optional[str] = None
    license_no: Optional[str] = None
    service_radius_km: Optional[float] = Field(default=None, gt=0, le=100)
    vehicle: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        if not PHONE_RE.match(v.strip()):
            raise ValueError("Enter a valid phone number")
        return v.strip()


class LoginIn(BaseModel):
    email: str
    password: str


def _need(data: RegisterIn, *fields: str) -> None:
    missing = [f for f in fields if getattr(data, f) in (None, "")]
    if missing:
        raise HTTPException(422, f"Missing required fields: {', '.join(missing)}")


@router.post("/register")
def register(data: RegisterIn, session: Session = Depends(get_session)):
    if data.role not in ("donor", "hospital", "patient", "bloodbank", "pharmacy", "volunteer"):
        raise HTTPException(422, "Choose a valid role")
    if session.exec(select(User).where(User.email == data.email)).first():
        raise HTTPException(409, "An account with this email already exists")

    if data.role == "donor":
        _need(data, "blood_group", "city", "pincode", "lat", "lng")
        if data.blood_group not in BLOOD_GROUPS:
            raise HTTPException(422, "Invalid blood group")
        if not re.fullmatch(r"\d{6}", data.pincode or ""):
            raise HTTPException(422, "PIN code must be 6 digits")
    elif data.role in FACILITY_ROLES:
        _need(data, "address", "city", "license_no", "lat", "lng")
    elif data.role == "volunteer":
        _need(data, "city", "lat", "lng")

    user = User(email=data.email, phone=data.phone, name=data.name.strip(),
                password_hash=hash_password(data.password), role=data.role)
    session.add(user)
    session.flush()

    if data.role == "donor":
        session.add(Donor(user_id=user.id, blood_group=data.blood_group, city=data.city, pincode=data.pincode,
                          lat=data.lat, lng=data.lng, last_donation_date=data.last_donation_date))
    elif data.role in FACILITY_ROLES:
        session.add(Facility(user_id=user.id, kind=data.role, name=data.name.strip(), address=data.address,
                             city=data.city, contact=data.phone, license_no=data.license_no, lat=data.lat, lng=data.lng))
    elif data.role == "volunteer":
        session.add(Volunteer(user_id=user.id, city=data.city, lat=data.lat, lng=data.lng,
                              service_radius_km=data.service_radius_km or 10, vehicle=data.vehicle or "two-wheeler"))
    if data.role != "patient":
        notify_admins(session, f"New {data.role} registration awaiting verification", data.name, "#admin-verify")
    session.commit()
    return {"token": create_token(user), "role": user.role}


@router.post("/login")
def login(data: LoginIn, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == data.email.strip().lower())).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {"token": create_token(user), "role": user.role}


@router.get("/me")
def me(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    prof = profile_of(session, user)
    out = {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone, "role": user.role,
           "profile": prof.model_dump() if prof else None, "verification": None}
    st = subject_type(user)
    if prof is not None and st:
        v = latest_verification(session, st, prof.id)
        out["verification"] = {"status": prof.verification_status,
                               "remarks": v.remarks if v else "",
                               "verified_at": iso(v.verified_at) if v else None}
    return out
