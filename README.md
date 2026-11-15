# LifeLink

**Emergency Health & Medicine Network**: an academic prototype that brings emergency blood assistance and medicine enquiries into one web platform.

> **Status:** working prototype. See [plan.md](plan.md) for the design and roadmap.

## What it does

LifeLink connects patients and hospitals with blood donors, blood banks, pharmacies, and delivery volunteers.

- **Blood help:** match donors by blood group, location, and availability; find nearby blood banks with the stock they report.
- **Medicine help:** search participating pharmacies, confirm availability and prescriptions, and arrange volunteer delivery.
- **Tracking:** request-status notifications and an estimated arrival time for deliveries (no live tracking).
- **Trust:** providers and donors are physically verified before they appear in results.

LifeLink does not decide medical suitability and does not guarantee availability. Providers confirm both.

## Modules

| Module | Role |
|---|---|
| Donor | Register, set availability, accept or decline requests |
| Hospital | Raise blood requests, coordinate, update status |
| Patient | Request blood or medicine, track progress |
| Blood Bank | Report stock, respond to requests |
| Pharmacy | Keep a medicine catalogue, process orders, request delivery |
| Volunteer | Accept and complete deliveries |
| Admin | Record verification decisions, assign deliveries |

## Tech stack

FastAPI · SQLModel · SQLite · HTML/CSS/JavaScript · Leaflet + OpenStreetMap · Haversine distance · OSRM (delivery-time estimates)

## How to run

You need **Python 3.11 or newer**. Run these commands from the project folder.

**Windows (PowerShell)**
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
If PowerShell blocks the `activate` script, skip activation and use the environment's Python directly:
`.venv\Scripts\python -m pip install -r requirements.txt`, then `.venv\Scripts\python -m uvicorn app.main:app --reload`.

**macOS / Linux**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then open **http://localhost:8000** in your browser.

The first run creates the database (`backend/lifelink.db`) and fills it with demo data around Indore. Next time, only the last two commands are needed: activate the environment and start the server.

## Demo accounts

All demo accounts use the password **`demo1234`**. On the login page, open "Demo accounts" and click one to fill it in.

| Role | Email |
|---|---|
| Admin | admin@lifelink.demo |
| Patient | patient@lifelink.demo |
| Hospital | hospital@lifelink.demo |
| Donor | donor1@lifelink.demo … donor16@lifelink.demo |
| Blood bank | bloodbank1@lifelink.demo … bloodbank3@lifelink.demo |
| Pharmacy | pharmacy1@lifelink.demo … pharmacy4@lifelink.demo |
| Volunteer | volunteer1@lifelink.demo … volunteer3@lifelink.demo |

**Try the blood flow:** log in as the hospital and create a B+ request. Then log in as a donor (for example donor3) and accept it. The hospital now sees the donor's contact details.

**Try the medicine flow:** log in as the patient, search "Paracetamol" and request it with volunteer delivery. Then, as the pharmacy that received it: confirm → start preparing → mark ready → request volunteer delivery. Finally, as the volunteer who got the offer: accept → collected → out for delivery → delivered.

## Useful extras

- **API docs:** http://localhost:8000/docs
- **Run tests:** run `pytest` inside `backend/` with the environment activated.
- **Reset the data:** stop the server, delete `backend/lifelink.db`, then start the server again.
- **Settings (optional):** copy `backend/.env.example` to `backend/.env`. You can set a secret key there, or turn off the online route service (`OSRM_ENABLED=false`) to use offline distance estimates.

## Project structure

```
backend/app/       FastAPI app: models.py, routers/ (API), services/ (matching, ETA, assignment)
backend/tests/     pytest tests for both end-to-end flows
frontend/          HTML/CSS/JS pages; js/roles/ holds one dashboard per role
```

## Code by

Alivia Hossain
School of Data Science and Forecasting, Devi Ahilya Vishwavidyalaya, Indore
