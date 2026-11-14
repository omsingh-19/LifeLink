from conftest import login


def test_register_and_verification_gate(client):
    r = client.post("/api/auth/register", json={
        "role": "donor", "name": "Test Donor", "email": "t.donor@example.com", "phone": "9876543210",
        "password": "secret12", "blood_group": "B-", "city": "Indore", "pincode": "452001", "lat": 22.72, "lng": 75.86})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    me = client.get("/api/auth/me", headers=h).json()
    assert me["verification"]["status"] == "pending"
    # Pending donors cannot respond to requests
    assert client.post("/api/donors/me/requests/1/respond", json={"accept": True}, headers=h).status_code == 403
    # Admin approves after physical check
    admin = login(client, "admin@lifelink.demo")
    queue = client.get("/api/admin/verifications", headers=admin).json()
    item = next(x for x in queue if x["email"] == "t.donor@example.com")
    r = client.post(f"/api/admin/verifications/donor/{item['subject_id']}", headers=admin,
                    json={"status": "approved", "documents_checked": "Aadhaar"})
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=h).json()["verification"]["status"] == "approved"


def test_duplicate_email_and_validation(client):
    body = {"role": "patient", "name": "X", "email": "bad", "phone": "1", "password": "123"}
    assert client.post("/api/auth/register", json=body).status_code == 422
    body = {"role": "patient", "name": "Dup", "email": "patient@lifelink.demo", "phone": "9876543210",
            "password": "secret12"}
    assert client.post("/api/auth/register", json=body).status_code == 409


def test_flow_a_blood_request(client):
    hosp = login(client, "hospital@lifelink.demo")
    r = client.post("/api/blood-requests", headers=hosp, json={
        "patient_name": "Test Patient", "blood_group": "B+", "units": 2, "urgency": "critical",
        "city": "Indore", "lat": 22.7230, "lng": 75.8820, "contact": "9000000002"})
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["donors_notified"] > 0
    assert all(d["blood_group"] in ("B+", "B-", "O+", "O-") for d in req["donors"])
    assert all("phone" not in d for d in req["donors"])  # contact hidden before accept
    assert req["nearby_bloodbanks"]

    # Find a matched donor, log in as them and accept
    donor_email = None
    for i in range(1, 17):
        h = login(client, f"donor{i}@lifelink.demo")
        items = [x for x in client.get("/api/donors/me/requests", headers=h).json() if x["code"] == req["code"]]
        if items:
            donor_email, item = f"donor{i}@lifelink.demo", items[0]
            assert "contact" not in item
            r = client.post(f"/api/donors/me/requests/{item['response_id']}/respond", headers=h, json={"accept": True})
            assert r.status_code == 200
            break
    assert donor_email

    detail = client.get(f"/api/blood-requests/{req['id']}", headers=hosp).json()
    assert detail["status"] == "in_progress"
    assert any(d["status"] == "accepted" and d.get("phone") for d in detail["donors"])

    # Patient cannot read the hospital's request
    pat = login(client, "patient@lifelink.demo")
    assert client.get(f"/api/blood-requests/{req['id']}", headers=pat).status_code == 403

    # Invalid transition is refused, valid one works
    assert client.patch(f"/api/blood-requests/{req['id']}/status", headers=hosp,
                        json={"status": "closed"}).status_code == 409
    assert client.patch(f"/api/blood-requests/{req['id']}/status", headers=hosp,
                        json={"status": "fulfilled"}).json()["status"] == "fulfilled"
    assert client.get(f"/api/track/{req['code']}").json()["status"] == "fulfilled"


def test_flow_b_medicine_delivery(client):
    pat = login(client, "patient@lifelink.demo")
    results = client.get("/api/pharmacies/search", params={"q": "para", "lat": 22.72, "lng": 75.88}).json()
    ph = next((p for p in results if any(i["status"] != "out_of_stock" for i in p["items"])), None)
    if ph is None:  # seed is random per pharmacy; fall back to any non-prescription item
        results = client.get("/api/pharmacies/search", params={"q": "e", "lat": 22.72, "lng": 75.88}).json()
        ph = results[0]
    item = next(i for i in ph["items"] if not i["requires_prescription"])
    r = client.post("/api/orders", headers=pat, data={
        "pharmacy_id": ph["id"], "stock_id": item["stock_id"], "medicine_name": item["name"],
        "strength": item["strength"], "quantity": 1, "fulfilment": "delivery",
        "delivery_address": "12 Test Street, Indore", "lat": 22.70, "lng": 75.87, "contact": "9000000001"})
    assert r.status_code == 200, r.text
    order = r.json()

    phh = None
    for p in range(1, 5):
        h = login(client, f"pharmacy{p}@lifelink.demo")
        if any(o["code"] == order["code"] for o in client.get("/api/pharmacies/me/orders", headers=h).json()):
            phh = h
            break
    assert phh
    for st in ("confirmed", "preparing", "ready"):
        r = client.post(f"/api/orders/{order['id']}/pharmacy-action", headers=phh, json={"status": st, "price": 40})
        assert r.status_code == 200, r.text
    r = client.post(f"/api/orders/{order['id']}/request-delivery", headers=phh)
    assert r.status_code == 200, r.text
    assert r.json()["delivery"]["status"] == "offered"

    # The offered volunteer accepts and completes the delivery
    for v in range(1, 4):
        vh = login(client, f"volunteer{v}@lifelink.demo")
        offers = client.get("/api/volunteers/me/offers", headers=vh).json()
        if offers:
            assert "drop" not in offers[0]  # recipient hidden until accepted
            assert client.post(f"/api/offers/{offers[0]['offer_id']}/respond", headers=vh,
                               json={"accept": True}).status_code == 200
            break
    else:
        raise AssertionError("no volunteer received the offer")
    task = client.get("/api/volunteers/me/deliveries", headers=vh).json()[0]
    assert task["eta_minutes"] and task["eta_source"] == "estimate"
    for st in ("collected", "out_for_delivery", "delivered"):
        r = client.patch(f"/api/deliveries/{task['delivery_id']}/status", headers=vh, json={"status": st})
        assert r.status_code == 200, r.text
    final = client.get(f"/api/orders/{order['id']}", headers=pat).json()
    assert final["status"] == "delivered"
    notes = client.get("/api/notifications", headers=pat).json()
    assert notes["unread"] >= 3


def test_prescription_required(client):
    pat = login(client, "patient@lifelink.demo")
    results = client.get("/api/pharmacies/search", params={"q": "in", "lat": 22.72, "lng": 75.88, "radius": 50}).json()
    assert results, "expected seeded pharmacies"
    for ph in results:
        rx = [i for i in ph["items"] if i["requires_prescription"]]
        if rx:
            r = client.post("/api/orders", headers=pat, data={
                "pharmacy_id": ph["id"], "stock_id": rx[0]["stock_id"], "medicine_name": rx[0]["name"],
                "lat": 22.7, "lng": 75.87, "contact": "9000000001"})
            assert r.status_code == 422 and "prescription" in r.text.lower()
            return
    raise AssertionError("no prescription-only medicine in seed data")
