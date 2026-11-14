"""Estimated arrival time from route information (OSRM), with a straight-line fallback.
No live tracking: the ETA is computed at fixed points (volunteer accepts, order collected)."""
from functools import lru_cache

import httpx

from ..config import settings
from .geo import haversine

Point = tuple[float, float]  # (lat, lng)


@lru_cache(maxsize=512)
def _osrm(points: tuple[Point, ...]) -> tuple[float, float] | None:
    coords = ";".join(f"{lng:.5f},{lat:.5f}" for lat, lng in points)
    url = f"{settings.osrm_url}/route/v1/driving/{coords}?overview=false"
    try:
        r = httpx.get(url, timeout=settings.osrm_timeout_s, headers={"User-Agent": "LifeLink-prototype"})
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        route = data["routes"][0]
        return route["distance"] / 1000.0, route["duration"] / 60.0
    except (httpx.HTTPError, ValueError, KeyError):
        return None


def fallback(points: list[Point]) -> tuple[float, float]:
    km = sum(haversine(*points[i], *points[i + 1]) for i in range(len(points) - 1)) * settings.road_factor
    return km, km / settings.fallback_speed_kmh * 60


def estimate(points: list[Point]) -> dict:
    """Returns {distance_km, eta_minutes, source} for a route through the given points."""
    result = _osrm(tuple(points)) if settings.osrm_enabled else None
    source = "osrm"
    if result is None:
        result, source = fallback(points), "estimate"
    km, minutes = result
    return {"distance_km": round(km, 2), "eta_minutes": max(1, round(minutes)), "source": source}
