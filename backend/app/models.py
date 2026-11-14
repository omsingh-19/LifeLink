"""SQLModel tables. Hospitals, blood banks and pharmacies share the Facility table (kind column)."""
from datetime import date, datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel, UniqueConstraint

BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
ROLES = ["donor", "hospital", "patient", "bloodbank", "pharmacy", "volunteer", "admin"]
FACILITY_ROLES = ["hospital", "bloodbank", "pharmacy"]
VERIFY_STATUSES = ["pending", "approved", "rejected", "needs_correction"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    """ISO-8601 in UTC with a trailing Z, for the frontend."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    phone: str
    name: str
    password_hash: str
    role: str = Field(index=True)
    is_active: bool = True
    created_at: datetime = Field(default_factory=utcnow)


class Donor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True)
    blood_group: str = Field(index=True)
    city: str
    pincode: str
    lat: float
    lng: float
    is_available: bool = True
    last_donation_date: Optional[date] = None
    verification_status: str = "pending"


class Facility(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True)
    kind: str = Field(index=True)  # hospital | bloodbank | pharmacy
    name: str
    address: str
    city: str
    contact: str
    license_no: str
    lat: float
    lng: float
    verification_status: str = "pending"


class Volunteer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True)
    city: str
    lat: float
    lng: float
    service_radius_km: float = 10
    vehicle: str = "two-wheeler"
    is_available: bool = True
    verification_status: str = "pending"


class Verification(SQLModel, table=True):
    """History of physical document checks. The latest row per subject is the current decision."""

    id: Optional[int] = Field(default=None, primary_key=True)
    subject_type: str  # donor | facility | volunteer
    subject_id: int
    status: str
    documents_checked: str = ""
    remarks: str = ""
    verified_by: int = Field(foreign_key="user.id")
    verified_at: datetime = Field(default_factory=utcnow)


class BloodStock(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("facility_id", "blood_group"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    facility_id: int = Field(foreign_key="facility.id", index=True)
    blood_group: str
    units: int = 0
    reported_at: datetime = Field(default_factory=utcnow)


class PharmacyStock(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    facility_id: int = Field(foreign_key="facility.id", index=True)
    name: str = Field(index=True)
    strength: str = ""
    form: str = "tablet"
    requires_prescription: bool = False
    status: str = "in_stock"  # in_stock | low | out_of_stock
    price: Optional[float] = None
    reported_at: datetime = Field(default_factory=utcnow)


class BloodRequest(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    requester_user_id: int = Field(foreign_key="user.id", index=True)
    requester_role: str  # hospital | patient
    patient_name: str
    blood_group: str
    units: int
    urgency: str  # critical | high | normal
    city: str
    lat: float
    lng: float
    contact: str
    notes: str = ""
    status: str = "open"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class DonorResponse(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("request_id", "donor_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    request_id: int = Field(foreign_key="bloodrequest.id", index=True)
    donor_id: int = Field(foreign_key="donor.id", index=True)
    status: str = "notified"  # notified | accepted | declined
    distance_km: float
    exact_match: bool
    responded_at: Optional[datetime] = None


class BloodBankResponse(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("request_id", "facility_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    request_id: int = Field(foreign_key="bloodrequest.id", index=True)
    facility_id: int = Field(foreign_key="facility.id")
    status: str  # confirmed_available | not_available
    units_confirmed: int = 0
    note: str = ""
    responded_at: datetime = Field(default_factory=utcnow)


class MedicineOrder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    patient_user_id: int = Field(foreign_key="user.id", index=True)
    pharmacy_id: int = Field(foreign_key="facility.id", index=True)
    stock_id: Optional[int] = Field(default=None, foreign_key="pharmacystock.id")
    medicine_name: str
    strength: str = ""
    quantity: int = 1
    urgency: str = "normal"
    requires_prescription: bool = False
    prescription_file: Optional[str] = None
    prescription_verified: bool = False
    fulfilment: str = "pickup"  # pickup | delivery
    delivery_address: str = ""
    lat: float
    lng: float
    contact: str
    patient_note: str = ""
    pharmacy_note: str = ""
    price_quoted: Optional[float] = None
    status: str = "requested"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Delivery(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="medicineorder.id", unique=True)
    volunteer_id: Optional[int] = Field(default=None, foreign_key="volunteer.id")
    status: str = "searching"
    pickup_lat: float
    pickup_lng: float
    drop_lat: float
    drop_lng: float
    distance_km: Optional[float] = None
    eta_minutes: Optional[int] = None
    eta_source: Optional[str] = None  # osrm | estimate
    eta_computed_at: Optional[datetime] = None
    failure_reason: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class DeliveryOffer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    delivery_id: int = Field(foreign_key="delivery.id", index=True)
    volunteer_id: int = Field(foreign_key="volunteer.id", index=True)
    status: str = "offered"  # offered | accepted | declined | expired | withdrawn
    offered_at: datetime = Field(default_factory=utcnow)
    responded_at: Optional[datetime] = None


class StatusHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity: str = Field(index=True)  # blood_request | order | delivery
    entity_id: int = Field(index=True)
    from_status: Optional[str] = None
    to_status: str
    by_user_id: Optional[int] = None
    note: str = ""
    at: datetime = Field(default_factory=utcnow)


class Notification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    title: str
    body: str = ""
    link: str = ""
    is_read: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class DonationCamp(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    organizer: str
    address: str
    lat: float
    lng: float
    starts_at: datetime
    ends_at: datetime
    contact: str = ""
