from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_KM = 6371.0


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle (straight-line) distance in km between two coordinates."""
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlmb = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    """Cheap SQL prefilter: (min_lat, max_lat, min_lng, max_lng) enclosing the radius."""
    dlat = radius_km / 111.0
    dlng = radius_km / (111.0 * max(cos(radians(lat)), 0.01))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng
