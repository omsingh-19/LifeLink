# LifeLink

**Emergency Health & Medicine Network**: an academic prototype that brings emergency blood assistance and medicine enquiries into one web platform.

> **Status:** planning. Development has not started yet. See [plan.md](plan.md) for the full design and roadmap.

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

## Getting started

Setup steps will be added once the backend skeleton is in place (Phase 0 in [plan.md](plan.md)).

## Team

Alivia Hossain, Om Singh Lodhi, Saksham Gupta, Shikhar Tiwari, Sayan Bera
School of Data Science and Forecasting, Devi Ahilya Vishwavidyalaya, Indore
