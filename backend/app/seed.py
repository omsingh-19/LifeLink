"""Demo data around Indore. All facility names are fictional. Every demo account uses password `demo1234`."""
import random
from datetime import date, datetime, timedelta, timezone

from sqlmodel import Session, select

from .models import (BLOOD_GROUPS, BloodStock, DonationCamp, Donor, Facility, PharmacyStock, User, Verification, utcnow,
                     Volunteer)
from .security import hash_password

PASSWORD = "demo1234"

AREAS = [  # (area, lat, lng)
    ("Rajwada", 22.7186, 75.8547), ("Vijay Nagar", 22.7533, 75.8937), ("Palasia", 22.7244, 75.8839),
    ("Bhawarkuan", 22.6926, 75.8682), ("Sudama Nagar", 22.6985, 75.8343), ("Rajendra Nagar", 22.6766, 75.8340),
    ("Sapna Sangeeta", 22.7006, 75.8689), ("Khajrana", 22.7360, 75.9090), ("Rau", 22.6378, 75.8113),
    ("Annapurna", 22.6955, 75.8385), ("Bengali Square", 22.7210, 75.9050), ("Navlakha", 22.7010, 75.8780),
]

MEDICINES = [  # name, strength, form, prescription
    ("Paracetamol", "500 mg", "tablet", False), ("Cetirizine", "10 mg", "tablet", False),
    ("ORS", "21 g", "sachet", False), ("Amoxicillin", "500 mg", "capsule", True),
    ("Azithromycin", "500 mg", "tablet", True), ("Insulin Glargine", "100 IU/ml", "injection", True),
    ("Salbutamol Inhaler", "100 mcg", "inhaler", True), ("Metformin", "500 mg", "tablet", True),
    ("Pantoprazole", "40 mg", "tablet", False), ("Ibuprofen", "400 mg", "tablet", False),
]


def _user(session: Session, email: str, name: str, role: str, phone: str) -> User:
    u = User(email=email, name=name, role=role, phone=phone, password_hash=hash_password(PASSWORD))
    session.add(u)
    session.flush()
    return u


def _approve(session: Session, stype: str, sid: int, admin_id: int) -> None:
    session.add(Verification(subject_type=stype, subject_id=sid, status="approved", verified_by=admin_id,
                             documents_checked="Demo seed: ID proof, licence", remarks="Seeded demo account"))


def seed(session: Session) -> bool:
    if session.exec(select(User)).first():
        return False
    rng = random.Random(42)
    admin = _user(session, "admin@lifelink.demo", "LifeLink Admin", "admin", "9000000000")

    _user(session, "patient@lifelink.demo", "Demo Patient", "patient", "9000000001")

    h = _user(session, "hospital@lifelink.demo", "City Care Hospital (Demo)", "hospital", "9000000002")
    hf = Facility(user_id=h.id, kind="hospital", name=h.name, address="MG Road, Palasia", city="Indore",
                  contact=h.phone, license_no="HOSP-DEMO-01", lat=22.7230, lng=75.8820, verification_status="approved")
    session.add(hf)
    session.flush()
    _approve(session, "facility", hf.id, admin.id)

    banks = [("Central Blood Centre (Demo)", "Rajwada", 22.7160, 75.8560),
             ("Vijay Nagar Blood Bank (Demo)", "Vijay Nagar", 22.7510, 75.8950),
             ("South Indore Blood Bank (Demo)", "Rajendra Nagar", 22.6790, 75.8360)]
    for i, (name, area, lat, lng) in enumerate(banks, 1):
        u = _user(session, f"bloodbank{i}@lifelink.demo", name, "bloodbank", f"90000001{i:02d}")
        f = Facility(user_id=u.id, kind="bloodbank", name=name, address=f"{area}, Indore", city="Indore",
                     contact=u.phone, license_no=f"BB-DEMO-0{i}", lat=lat, lng=lng, verification_status="approved")
        session.add(f)
        session.flush()
        _approve(session, "facility", f.id, admin.id)
        for g in BLOOD_GROUPS:
            units = rng.choice([0, 1, 2, 3, 5, 8, 12]) if "-" in g else rng.choice([2, 4, 6, 10, 15, 20])
            session.add(BloodStock(facility_id=f.id, blood_group=g, units=units,
                                   reported_at=utcnow() - timedelta(hours=rng.choice([1, 3, 6, 30]))))

    pharmacies = [("Rajwada Medicals (Demo)", 22.7195, 75.8530), ("Vijay Nagar Pharmacy (Demo)", 22.7545, 75.8920),
                  ("Palasia Chemists (Demo)", 22.7250, 75.8850), ("Bhawarkuan Medical Store (Demo)", 22.6935, 75.8670)]
    for i, (name, lat, lng) in enumerate(pharmacies, 1):
        u = _user(session, f"pharmacy{i}@lifelink.demo", name, "pharmacy", f"90000002{i:02d}")
        f = Facility(user_id=u.id, kind="pharmacy", name=name, address=name.split(" (")[0] + ", Indore",
                     city="Indore", contact=u.phone, license_no=f"DL-DEMO-0{i}", lat=lat, lng=lng,
                     verification_status="approved")
        session.add(f)
        session.flush()
        _approve(session, "facility", f.id, admin.id)
        for med, strength, form, rx in rng.sample(MEDICINES, 7):
            session.add(PharmacyStock(facility_id=f.id, name=med, strength=strength, form=form,
                                      requires_prescription=rx, status=rng.choice(["in_stock"] * 3 + ["low", "out_of_stock"]),
                                      price=rng.choice([25, 40, 65, 120, 250, 480])))

    groups = ["O+", "O+", "B+", "B+", "A+", "A+", "AB+", "O-", "A-", "B-", "AB-", "O+", "B+", "A+", "O-", "B+"]
    for i, g in enumerate(groups, 1):
        area, lat, lng = AREAS[i % len(AREAS)]
        u = _user(session, f"donor{i}@lifelink.demo", f"Demo Donor {i}", "donor", f"90000003{i:02d}")
        last = date.today() - timedelta(days=rng.choice([30, 120, 200, 400])) if i % 3 else None
        d = Donor(user_id=u.id, blood_group=g, city="Indore", pincode="4520" + f"{i:02d}",
                  lat=lat + rng.uniform(-0.008, 0.008), lng=lng + rng.uniform(-0.008, 0.008),
                  is_available=i % 7 != 0, last_donation_date=last, verification_status="approved")
        session.add(d)
        session.flush()
        _approve(session, "donor", d.id, admin.id)

    # Two registrations left pending so the admin verification queue has something in it.
    u = _user(session, "newdonor@lifelink.demo", "New Donor (pending)", "donor", "9000000400")
    session.add(Donor(user_id=u.id, blood_group="A+", city="Indore", pincode="452010", lat=22.72, lng=75.86))
    u = _user(session, "newpharmacy@lifelink.demo", "New Pharmacy (pending)", "pharmacy", "9000000401")
    session.add(Facility(user_id=u.id, kind="pharmacy", name=u.name, address="Khajrana, Indore", city="Indore",
                         contact=u.phone, license_no="DL-DEMO-PENDING", lat=22.736, lng=75.909))

    for i, (area, lat, lng) in enumerate([AREAS[2], AREAS[3], AREAS[1]], 1):
        u = _user(session, f"volunteer{i}@lifelink.demo", f"Demo Volunteer {i}", "volunteer", f"90000005{i:02d}")
        v = Volunteer(user_id=u.id, city="Indore", lat=lat, lng=lng, service_radius_km=12,
                      vehicle=["two-wheeler", "bicycle", "car"][i - 1], verification_status="approved")
        session.add(v)
        session.flush()
        _approve(session, "volunteer", v.id, admin.id)

    start = datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=3)
    session.add(DonationCamp(title="Community Blood Donation Camp", organizer="LifeLink Volunteers (Demo)",
                             address="Community Hall, Vijay Nagar, Indore", lat=22.7520, lng=75.8900,
                             starts_at=start, ends_at=start + timedelta(hours=7), contact="9000000600"))
    session.add(DonationCamp(title="University Blood Drive", organizer="Student Council (Demo)",
                             address="University Campus, Khandwa Road, Indore", lat=22.6866, lng=75.8728,
                             starts_at=start + timedelta(days=7), ends_at=start + timedelta(days=7, hours=6)))
    session.commit()
    return True
