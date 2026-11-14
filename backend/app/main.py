from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from .config import settings
from .database import engine, init_db
from .routers import auth, blood, common, deliveries, medicine


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if settings.seed_demo:
        from .seed import seed

        with Session(engine) as s:
            if seed(s):
                print("LifeLink: demo data created (password for all demo accounts: demo1234)")
    yield


app = FastAPI(title="LifeLink API", version="0.1.0",
              description="Emergency Health & Medicine Network - academic prototype", lifespan=lifespan)

for r in (auth.router, blood.router, medicine.router, deliveries.router, common.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(settings.frontend_dir / "index.html")


app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
