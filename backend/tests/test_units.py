from app.services import eta
from app.services.geo import haversine
from app.services.matching import COMPATIBLE_DONORS
from app.services.status import ORDER, BLOOD_REQUEST


def test_haversine_known_distance():
    # Indore (Rajwada) to Bhopal is roughly 170 km in a straight line
    assert 165 < haversine(22.7186, 75.8547, 23.2599, 77.4126) < 176
    assert haversine(22.7, 75.8, 22.7, 75.8) == 0


def test_compatibility_table():
    assert COMPATIBLE_DONORS["O-"] == ["O-"]
    assert set(COMPATIBLE_DONORS["AB+"]) == {"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"}
    for recipient, donors in COMPATIBLE_DONORS.items():
        assert recipient in donors and "O-" in donors


def test_eta_fallback():
    r = eta.estimate([(22.7186, 75.8547), (22.7533, 75.8937)])
    assert r["source"] == "estimate" and r["eta_minutes"] > 0 and r["distance_km"] > 5


def test_terminal_states_have_no_exits():
    assert BLOOD_REQUEST["closed"] == set()
    assert ORDER["cancelled"] == set() and ORDER["rejected"] == set()
