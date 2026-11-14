# LifeLink — Implementation Plan

Emergency Health & Medicine Network — academic prototype.
Source: *LifeLink_MST3.pdf* (Literature Review & Proposed System).

---

## 1. Goal and scope

Build one web platform that brings together **emergency blood help** and **medicine enquiries with volunteer delivery**, for six roles: **Donor, Hospital, Patient, Blood Bank, Pharmacy, Volunteer**, plus an **Admin / Verifier** role for physical document checks.

### In scope
- Donor registration, availability, and matching (blood group + location + availability)
- Hospital blood requests and tracking
- Patient blood requests and medicine enquiries in one interface
- Blood-bank discovery with reported stock per blood group (with "last updated" timestamp)
- Pharmacy medicine catalogue, enquiries, prescription check, order preparation
- Volunteer delivery assignment and status updates
- Map discovery (Leaflet + OpenStreetMap), Haversine distance search
- ETA for accepted deliveries from route information (no live tracking)
- In-app notifications and request-status updates
- Physical verification records, changed only by authorized admins
- Donation-camp information (listed in the comparison table)

### Out of scope (stated in the PDF)
- Continuous live-location tracking
- Doctor consultation, diagnostics, digital health records
- Deciding medical suitability or guaranteeing medicine/blood availability
- Online payment
- Replacing e-RaktKosh: LifeLink complements it

### Design principles from the PDF
1. **Reported vs confirmed**: every availability value shows its source and timestamp. The UI labels it "reported" until a provider confirms it.
2. **Verification gate**: donors, hospitals, blood banks, pharmacies, and volunteers start as `pending`. Only `approved` accounts take part in matching or show on the map.
3. **Privacy**: donor contact details are hidden until the donor accepts a request. The request flow handles contact ("coordinate contact through approved workflow").
4. **Prescription rules**: when a medicine needs a prescription, the order cannot be confirmed until the pharmacy marks the prescription as checked.

---

## 2. Tech stack

**From the PDF (fixed):** FastAPI · SQLModel (on SQLAlchemy) · SQLite · HTML/CSS/JavaScript · Leaflet · OpenStreetMap · Haversine · route-based ETA.
**Added by us (the PDF doesn't name these):** a routing engine for the ETA, an auth library, a test framework, and small helpers. The table marks each one.

| Layer | Choice | Source | Notes |
|---|---|---|---|
| Backend | **FastAPI** (Python 3.11+) | PDF | REST API, Pydantic v2 validation, OpenAPI docs at `/docs` |
| ORM / models | **SQLModel** (on SQLAlchemy 2.x) | PDF | One model file per domain; `table=True` models + separate read/create schemas |
| Database | **SQLite** | PDF | Enable WAL mode + foreign keys (`PRAGMA`); the PDF notes production would need a stronger DB |
| Frontend | **HTML, CSS, vanilla JavaScript** | PDF | One page per role, shared `api.js` and `auth.js`; no build step |
| Maps | **Leaflet 1.9.4** (CDN, pinned) + **OpenStreetMap** tiles | PDF | Markers for blood banks, pharmacies, camps; OSM attribution required |
| Distance | **Haversine** formula | PDF | Straight-line km for "nearby" search |
| Routing / ETA | **OSRM** HTTP API | Added | The PDF only says "available routing information". The public demo server (`router.project-osrm.org`) is fine for low-volume prototype use; the URL is configurable for a self-hosted OSRM. Fallback: Haversine × 1.3 road factor ÷ 20 km/h city speed |
| Geocoding (optional) | Nominatim, or an offline PIN-code → lat/lng table | Added | Respect the Nominatim policy (1 req/s, real User-Agent); cache the results |
| Auth | JWT via **PyJWT**, password hashing with **pwdlib[bcrypt]** (or `bcrypt` directly) | Added | Follows the current FastAPI security tutorial; avoids `passlib`, which is unmaintained and breaks with new `bcrypt` releases. OAuth2 password flow + `require_role()` |
| File upload | `python-multipart` | Added | Needed by FastAPI for prescription uploads and form login |
| Config | `pydantic-settings` + `.env` | Added | DB URL, JWT secret, OSRM URL, matching thresholds |
| Notifications | DB-backed in-app notifications + polling (every 15 s) | Added | Meets the PDF's "notification module"; later: email/SMS, WebSocket |
| HTTP client | `httpx` | Added | OSRM/Nominatim calls with a timeout |
| Testing | `pytest` + FastAPI `TestClient` | Added | Seed script for demo data; `locust` optional for load tests |
| Server | `uvicorn` | Added | `uvicorn app.main:app --reload` |

---

## 3. Repository layout

```
LifeLink/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, routers, static mount
│   │   ├── config.py            # settings (DB URL, JWT secret, OSRM URL)
│   │   ├── database.py          # engine, session dependency, create_all
│   │   ├── security.py          # hashing, JWT, get_current_user, require_role()
│   │   ├── models/              # SQLModel tables (section 4)
│   │   ├── schemas/             # request/response models
│   │   ├── routers/             # auth, admin, donors, hospitals, patients,
│   │   │                        # bloodbanks, pharmacies, volunteers,
│   │   │                        # blood_requests, medicine, deliveries,
│   │   │                        # notifications, map, camps
│   │   ├── services/
│   │   │   ├── geo.py           # haversine(), bounding-box prefilter
│   │   │   ├── matching.py      # donor + blood-bank matching
│   │   │   ├── compatibility.py # ABO/Rh compatibility table
│   │   │   ├── pharmacy_search.py
│   │   │   ├── assignment.py    # volunteer selection
│   │   │   ├── eta.py           # OSRM call + fallback
│   │   │   ├── notify.py        # create notifications
│   │   │   └── status.py        # allowed status transitions
│   │   └── seed.py              # demo data (Indore)
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── index.html               # landing page, role picker, login/register
│   ├── css/styles.css
│   ├── js/ (api.js, auth.js, map.js, notifications.js, ui.js)
│   └── pages/ (donor, hospital, patient, bloodbank, pharmacy,
│               volunteer, admin, track).html
├── docs/                        # diagrams, API notes, test report
├── plan.md
└── README.md
```

FastAPI serves `frontend/` as static files, so `uvicorn app.main:app` runs everything from one origin.

---

## 4. Data model (SQLModel / SQLite)

Common fields on every table: `id`, `created_at`, `updated_at`.

### Accounts and verification
- **User**: `email` (unique), `phone`, `password_hash`, `role` (`donor | hospital | patient | bloodbank | pharmacy | volunteer | admin`), `is_active`
- **Verification**: `subject_type`, `subject_id`, `status` (`pending | approved | rejected | needs_correction`), `documents_checked` (text list), `remarks`, `verified_by` (admin user id), `verified_at`. Keep the full history; the latest row is the current status.

### Profiles (one-to-one with User)
- **Donor**: `name`, `blood_group` (enum of 8), `city`, `pincode`, `lat`, `lng`, `is_available`, `last_donation_date`, `verification_status`
- **Hospital**: `name`, `address`, `contact`, `lat`, `lng`, `registration_no`, `verification_status`
- **HospitalStaff**: `hospital_id`, `user_id`, `is_approved` (admin-approved staff access)
- **Patient**: `name`, `phone`, `city`, `pincode`, `lat`, `lng` (no verification needed)
- **BloodBank**: `name`, `address`, `contact`, `lat`, `lng`, `license_no`, `verification_status`
- **Pharmacy**: `name`, `address`, `contact`, `lat`, `lng`, `drug_license_no`, `verification_status`
- **Volunteer**: `name`, `phone`, `service_area` (city/pincode + radius km), `lat`, `lng`, `vehicle_type`, `is_available`, `verification_status`

### Inventory
- **BloodStock**: `bloodbank_id`, `blood_group`, `units_reported`, `reported_at`, `reported_by`
- **Medicine**: `name`, `generic_name`, `strength`, `form`, `requires_prescription`
- **PharmacyStock**: `pharmacy_id`, `medicine_id`, `status` (`in_stock | low | out_of_stock`), `price`, `reported_at`

### Requests
- **BloodRequest**: `requester_type` (`hospital | patient`), `requester_id`, `patient_name`, `blood_group`, `units`, `urgency` (`critical | high | normal`), `lat`, `lng`, `city`, `pincode`, `contact`, `status` (`open | in_progress | fulfilled | cancelled | closed`), `public_code` (short code for tracking)
- **DonorResponse**: `request_id`, `donor_id`, `status` (`notified | accepted | declined | donated | no_show`), `responded_at`
- **BloodBankResponse**: `request_id`, `bloodbank_id`, `status` (`contacted | confirmed_available | not_available`), `units_confirmed`
- **MedicineEnquiry**: `patient_id`, `medicine_id` or free-text `medicine_name` + `strength`, `quantity`, `urgency`, `lat`, `lng`, `delivery_address`, `prescription_ref` (file upload path, optional), `status`
- **PharmacyOrder**: `enquiry_id`, `pharmacy_id`, `status` (`requested | prescription_check | rejected | needs_clarification | unavailable | confirmed | preparing | ready | collected | delivery_requested | delivered | closed`), `price_quoted`, `fulfilment` (`pickup | delivery`)
- **Delivery**: `order_id`, `volunteer_id`, `status` (`unassigned | offered | assigned | accepted | collected | out_for_delivery | delivered | failed | cancelled`), `pickup_lat/lng`, `drop_lat/lng`, `route_distance_km`, `eta_minutes`, `eta_source` (`osrm | estimate`), `eta_computed_at`, `failure_reason`
- **DeliveryOffer**: `delivery_id`, `volunteer_id`, `status` (`offered | accepted | declined | expired`): supports "offer to the next eligible volunteer"

### Supporting tables
- **StatusHistory**: `entity_type`, `entity_id`, `from_status`, `to_status`, `changed_by`, `note`, `at` (audit trail for every status change)
- **Notification**: `user_id`, `type`, `title`, `body`, `link`, `is_read`
- **DonationCamp**: `organizer`, `title`, `address`, `lat`, `lng`, `starts_at`, `ends_at`, `contact`

---

## 5. Core algorithms

### 5.1 Haversine distance (`services/geo.py`)
`d = 2R · asin(√(sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)))`, with R = 6371 km.
First filter with a lat/lng bounding box in SQL, then compute the exact Haversine distance in Python and sort.

### 5.2 Donor matching (`services/matching.py`)
Input: a blood request. Steps:
1. Find compatible donor groups for the recipient group (red-cell compatibility table, e.g. AB+ can receive from all groups, O- only from O-). Make "exact match only" a setting (`MATCH_MODE=exact|compatible`). Default is **exact first, then compatible**.
2. Filter: `verification_status = approved`, `is_available = true`, and `last_donation_date` older than the minimum gap (default 90 days, configurable; Indian NBTC guidance is 90 days for men and 120 days for women for whole blood). Show this as an eligibility *hint*, not a medical decision.
3. Search radius: start at 5 km, widen to 10, 25, then 50 km until at least N (default 10) candidates are found.
4. Rank by `exact_group_match DESC, distance ASC, urgency weighting`.
5. Create `DonorResponse(status=notified)` and a Notification for each donor.
6. Show the requester only an anonymised list (group, distance, response status). The donor's contact details appear **only after the donor accepts**.

### 5.3 Blood-bank discovery
Find approved blood banks within the radius. Join the latest `BloodStock` for the requested (or compatible) group. Sort by distance, and show `units_reported` with a "reported X hours ago" label. Mark stock older than 24 h as "stale".

### 5.4 Pharmacy search (`services/pharmacy_search.py`)
Match by medicine name or generic name (case-insensitive `LIKE`; optional fuzzy match with `rapidfuzz`), filter to approved pharmacies, sort by `in_stock` first and then by distance. Every result is labelled "reported availability; confirm with pharmacy".

### 5.5 Volunteer assignment (`services/assignment.py`)
Eligible volunteers are approved and available, have the pickup point inside their service radius, and have no active delivery. Rank by distance to the pharmacy. Offer the task to the top volunteer. If the volunteer declines, or does not respond within a timeout (default 10 min, checked on poll or by a background task), the offer expires and the next volunteer gets it. An admin or coordinator can also assign a volunteer manually.

### 5.6 ETA (`services/eta.py`)
Compute the ETA when the volunteer accepts, and again at `collected`:
- Primary: OSRM `/route/v1/driving/{pickup};{drop}` gives duration and distance. Timeout 3 s; cache by coordinates.
- Fallback: `haversine × 1.3 / 20 km/h`.
- Store `eta_minutes`, `eta_source`, and `eta_computed_at`. The UI shows "Estimated arrival ~HH:MM (estimate, not live tracking)".

### 5.7 Status state machines (`services/status.py`)
Each entity has an allowed-transitions map and a list of the roles that may make each transition. Any other transition returns HTTP 409. Every change writes `StatusHistory` and notifies the affected users.

---

## 6. Module features (from each module's workflow in the PDF)

### 6.1 Donor
- Register with name, contact, blood group, city, PIN code, and availability. Validated on the client (HTML/JS) and on the server (FastAPI).
- Profile saved as `pending`. The dashboard shows the verification state and any admin remarks (rejected / needs correction).
- Availability toggle, plus last donation date.
- Inbox of matching requests (group, urgency, distance; no patient identity until accepted) with **Accept / Decline** buttons.
- On accept: show the requester's contact and the hospital or location. Record the response and update the request.
- History of responses and donations.

### 6.2 Hospital
- Facility registration (name, address, contact, registration number). An admin verifies the facility and approves staff accounts. Unauthorized accounts see "Access denied".
- Create a blood requirement: group, units, urgency, location, contact. Validated, then saved with a unique ID and `public_code`.
- Matching results: potential donors (with response status) and nearby blood banks with reported stock, in a list and on a map.
- Contact or notify the relevant parties. Record blood-bank responses (confirmed or not available).
- Change the request status: `open → in_progress → fulfilled / cancelled / closed`. A timeline shows the status history.
- List of all requests from the hospital, with filters.

### 6.3 Patient / authorized requester
- One "I need…" screen with two tabs: **Blood assistance** and **Medicine enquiry**.
- Blood: group, units, urgency, location (pick on map, use browser geolocation once, or enter PIN code), contact. Returns a request ID. Shows matching donors (anonymised), nearby blood banks, and nearby donation camps.
- Medicine: name, strength, quantity, urgency, delivery address, prescription upload when needed. Returns an enquiry ID. Shows matching pharmacies on a list and map.
- Select a pharmacy to send the order request, or contact it directly.
- Track page `/track/{public_code}` shows status, a timeline, and the delivery ETA.
- Prescription notice is shown for prescription-only medicines.

### 6.4 Blood Bank
- Facility registration with supporting documents, saved as `pending`. After physical verification and admin approval, the dashboard is unlocked.
- Stock editor: a grid of the 8 blood groups with units; saving records `reported_at`.
- Appears on the public map with the contact details it allows.
- Incoming request queue (nearby requests for groups it holds). Respond with confirmed units or not available.
- Status updates on the requests it handled.

### 6.5 Pharmacy
- Registration with drug licence. Verified by an admin, then the account is activated.
- Medicine catalogue: add or edit medicines, stock status, price, and the prescription-required flag. CSV bulk upload is optional.
- Order queue for each enquiry. Flow: review → (prescription needed? check it: approve / reject / ask for clarification) → availability check → confirm and prepare → **pickup** or **request delivery**.
- "Request delivery" creates a Delivery and starts volunteer assignment.
- Statuses are updated manually. The final outcome is stored.

### 6.6 Volunteer
- Register with name, contact, service area, and vehicle. Verified by an admin, then the account is activated.
- Availability toggle.
- Offer inbox: pickup and drop distances and an estimated time. **Accept / Decline**.
- Active task view: pharmacy address and map. Buttons in order: `Collected → Out for delivery → Delivered`, or `Failed` with a reason.
- Failed delivery notifies the pharmacy, the patient, and the admin, who can reassign or resolve it.
- Delivery history.

### 6.7 Admin / Verifier (cross-cutting)
- Queue of pending registrations by role.
- Record the physical document check: list of documents checked, decision (approve / reject / needs correction), and remarks. Saved in `Verification` with history.
- Approve hospital staff accounts.
- Reassign deliveries manually; view all requests.
- Manage donation camps and the medicine master list.
- Simple dashboard: counts of open requests, fulfilment rate, average response time (useful for the evaluation in section 10).

### 6.8 Shared services
- **Notifications**: a bell icon with an unread count, polled every 15 s. Triggered by new matching requests, donor accept/decline, order status changes, delivery offers, status changes, and verification decisions.
- **Map**: Leaflet with OpenStreetMap tiles and OSM attribution. Layers for blood banks, pharmacies, camps, and the user's location. Popups show details and the stock-freshness label.
- **Validation and access control**: Pydantic schemas, a `require_role()` dependency, an approval check for provider actions, and owner checks (a user only sees their own requests).

---

## 7. REST API outline

Every endpoint is under `/api`. "Auth" means a JWT is required; the role is shown in brackets.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` (role + profile), `POST /auth/login`, `GET /auth/me` |
| Admin | `GET /admin/verifications?status=pending`, `POST /admin/verifications/{type}/{id}` [admin], `POST /admin/hospital-staff/{id}/approve`, `GET /admin/stats` |
| Donor | `GET/PATCH /donors/me`, `PATCH /donors/me/availability`, `GET /donors/me/requests`, `POST /donors/me/requests/{id}/respond` |
| Hospital | `GET/PATCH /hospitals/me`, `GET /hospitals/me/requests` |
| Blood requests | `POST /blood-requests`, `GET /blood-requests/{id}`, `GET /blood-requests/{id}/matches`, `PATCH /blood-requests/{id}/status`, `POST /blood-requests/{id}/bloodbank-response` |
| Blood banks | `GET /bloodbanks/nearby?lat&lng&group&radius`, `GET/PUT /bloodbanks/me/stock`, `GET /bloodbanks/me/requests` |
| Medicine | `GET /medicines/search?q`, `POST /medicine-enquiries`, `GET /medicine-enquiries/{id}`, `GET /pharmacies/nearby?lat&lng&medicine&radius` |
| Pharmacy | `GET/PUT /pharmacies/me/catalogue`, `POST /orders` (patient picks pharmacy), `GET /pharmacies/me/orders`, `PATCH /orders/{id}/status`, `POST /orders/{id}/prescription-decision`, `POST /orders/{id}/request-delivery` |
| Volunteer | `PATCH /volunteers/me/availability`, `GET /volunteers/me/offers`, `POST /offers/{id}/respond`, `GET /volunteers/me/deliveries`, `PATCH /deliveries/{id}/status` |
| Delivery | `GET /deliveries/{id}` (includes ETA), `POST /deliveries/{id}/assign` [admin] |
| Tracking | `GET /track/{public_code}` (limited public view) |
| Notifications | `GET /notifications?unread=true`, `POST /notifications/{id}/read`, `POST /notifications/read-all` |
| Map / camps | `GET /map/facilities?bbox&types`, `GET /camps/nearby`, `POST /camps` [admin] |

---

## 8. End-to-end flows (the PDF's example workflows)

**A. Emergency blood request**
Patient or hospital submits a request → validated and saved → matching finds donors and blood banks → donors get a notification and the requester sees contact options → a donor accepts, or a blood bank confirms → the provider follows its own procedure to check suitability → the requester updates the status to `fulfilled` or `closed` → authorized users see the new status.

**B. Medicine enquiry with supported delivery**
Patient submits an enquiry → pharmacies found from the listings → patient selects a pharmacy and sends an order → pharmacy checks the prescription, stock, and price → confirms and prepares the order → requests delivery → a volunteer is offered the task and accepts → ETA computed → `collected → out_for_delivery → delivered` → order closed and the outcome stored.

---

## 9. Implementation phases (milestones)

| Phase | Deliverable | Key tasks |
|---|---|---|
| **0. Setup** (1–2 days) | Skeleton runs | Repo layout, venv, `requirements.txt`, FastAPI app serving the static frontend, SQLite `create_all`, README run steps |
| **1. Auth and roles** (3 days) | Login and registration for all 7 roles | User model, bcrypt, JWT, `require_role`, role-based register forms, `auth.js` token storage, redirect to the role dashboard |
| **2. Verification** (2 days) | Admin console | Verification model and history, pending queue UI, approve/reject/correction, approval gate on provider endpoints |
| **3. Geo and map** (2 days) | Map page | `geo.py` Haversine with tests, `map.js` Leaflet component, `/map/facilities`, location picker (click map / geolocate / PIN code) |
| **4. Blood module** (5 days) | Flow A works end to end | Donor profile and availability, BloodRequest CRUD, compatibility table, matching with widening radius, DonorResponse accept/decline, blood-bank stock grid and nearby search, hospital and patient dashboards, status machine |
| **5. Medicine module** (5 days) | Pharmacy flow works | Medicine master list, pharmacy catalogue, enquiry, pharmacy search, order queue, prescription decision, status machine |
| **6. Volunteer and delivery** (4 days) | Flow B works end to end | Delivery and offer models, assignment service with timeout and reassignment, volunteer UI, OSRM ETA with fallback, failed-delivery handling |
| **7. Notifications and tracking** (2 days) | Live-ish updates | Notification service hooked into every transition, bell UI with polling, public `/track/{code}` page with timeline |
| **8. Extras** (2 days) | Remaining features | Donation camps, admin stats, stale-stock labels, seed data for Indore |
| **9. Testing and evaluation** (4 days) | Test report | Unit, API, and end-to-end scripted scenarios; metrics (section 10); bug fixes |
| **10. Docs and demo** (2 days) | Final submission | Updated diagrams, API docs (OpenAPI export), user guide, demo script and recording |

The team has five members, so phases 4, 5, and 6 can run in parallel once phases 1–3 are done. Suggested split:
- 1 member: Auth, Admin, Notifications
- 1 member: Donor and Hospital
- 1 member: Patient and Blood Bank
- 1 member: Pharmacy
- 1 member: Volunteer, ETA, Map

---

## 10. Testing and evaluation (the PDF's evaluation criteria)

| Criterion | How we measure it |
|---|---|
| **Usability** | Task-based test with 5–10 users (e.g. "request O- blood", "find paracetamol 500 mg"); time on task, success rate, SUS questionnaire |
| **Donor-search relevance** | Seeded dataset with known correct answers; precision of the top 10 (right group, available, approved, within radius); check the ordering by distance |
| **Request-processing performance** | Measure API latency (p50/p95) for create + match with 1k / 10k seeded donors, using `locust` or a simple timing script |
| **Notification reliability** | Every state transition in the scripted scenarios creates the expected notifications (automated assertion); delivered / expected ratio |
| **ETA accuracy** | Compare OSRM and fallback ETAs with recorded actual times on simulated or real test deliveries; mean absolute error in minutes |

Automated tests:
- Unit: Haversine, compatibility table, matching ranking, status transitions (allowed and forbidden), ETA fallback.
- API: each router, including the auth/role/approval gates (forbidden access returns 403, wrong transition returns 409).
- Scenario: flows A and B scripted through `TestClient`.

---

## 11. Security, privacy and compliance

- Passwords hashed with bcrypt. JWT expires after 60 min. Secrets read from `.env`, never committed.
- Least privilege: providers act only on their own records; the public tracking page shows status only.
- Donor phone number and address are revealed only after the donor accepts. Exact donor locations are never placed on the map.
- Prescription uploads stored outside the static folder, served only to the assigned pharmacy, with file type and size limits.
- Disclaimers in the UI: "LifeLink does not determine medical suitability"; "Availability is reported by providers and must be confirmed."
- OSM tile and Nominatim usage policies: show attribution, set a proper User-Agent, cache results, apply rate limits.
- Audit trail through `StatusHistory` and `Verification`.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Outdated stock data | `reported_at` timestamps, stale labels, confirm-before-use workflow |
| OSRM demo server down or rate-limited | 3 s timeout, cache, Haversine fallback with `eta_source` shown |
| SQLite write locking under load | WAL mode, short transactions; document the move to PostgreSQL |
| Fake registrations | Physical verification gate before matching or map visibility |
| No response from volunteers | Offer timeout, automatic offer to the next volunteer, admin manual assignment |
| Scope creep | Out-of-scope list in section 1 |

---

## 13. Future work (beyond the prototype)

PostgreSQL + PostGIS, WebSocket push, SMS/WhatsApp notifications, e-RaktKosh data integration (if an API is available), PWA/mobile app, multilingual UI (Hindi), live pharmacy inventory integration.

---

## 14. Definition of done

- [ ] All 7 roles can register and log in; providers are gated by verification
- [ ] Flow A (blood) and Flow B (medicine + delivery) run end to end on seeded data
- [ ] Map shows approved blood banks, pharmacies, and camps with freshness labels
- [ ] ETA shown for accepted deliveries, marked as an estimate
- [ ] Notifications fire on every status change
- [ ] Automated tests pass; evaluation metrics recorded in `docs/test-report.md`
- [ ] README has setup and run steps and a demo walkthrough
