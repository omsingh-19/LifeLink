// Leaflet + OpenStreetMap helpers. Leaflet is loaded globally (window.L) from the page.
import { ago, esc } from "./api.js";

export const INDORE = [22.7196, 75.8577];
const COLORS = { bloodbank: "#c62839", pharmacy: "#1e7a46", hospital: "#1f5fa8", camp: "#9a5b00", me: "#1c2430", target: "#6d28d9" };

export function makeMap(el, center = INDORE, zoom = 12) {
  const map = L.map(el).setView(center, zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

export function dot(kind, lat, lng, popupHtml, radius = 8) {
  const m = L.circleMarker([lat, lng], { radius, color: "#fff", weight: 2, fillColor: COLORS[kind] || "#555", fillOpacity: 0.95 });
  if (popupHtml) m.bindPopup(popupHtml);
  return m;
}

export function facilityPopup(f) {
  let html = `<strong>${esc(f.name)}</strong><br>${esc(f.address)}<br>📞 ${esc(f.contact)}`;
  if (f.distance_km != null) html += `<br>${f.distance_km} km away`;
  if (f.stock) {
    const s = f.stock.filter((x) => x.units > 0).map((x) => `${esc(x.blood_group)}: ${x.units}`).join(", ") || "No stock reported";
    const latest = f.stock.map((x) => x.reported_at).sort().pop();
    html += `<br><small>Reported: ${s}<br>Updated ${ago(latest)} · confirm by phone</small>`;
  }
  return html;
}

export function legend(kinds) {
  const names = { bloodbank: "Blood bank", pharmacy: "Pharmacy", hospital: "Hospital", camp: "Donation camp", me: "You", target: "Request location" };
  return `<div class="legend">${kinds.map((k) => `<span><span class="dot" style="background:${COLORS[k]}"></span>${names[k]}</span>`).join("")}</div>`;
}

// Click-to-pick location with "use my location". Calls onChange({lat,lng}).
export function locationPicker(container, { lat, lng, onChange } = {}) {
  container.innerHTML = `
    <div class="row" style="margin-bottom:.4rem">
      <button type="button" class="btn sm" data-geo>📍 Use my location</button>
      <span class="small muted" data-coords>Click the map to set the location</span>
    </div>
    <div class="map picker"></div>`;
  const map = makeMap(container.querySelector(".map"), lat != null ? [lat, lng] : INDORE, 12);
  let marker = null;
  const value = { lat: lat ?? null, lng: lng ?? null };
  const set = (la, ln, pan = false) => {
    value.lat = +la.toFixed(6); value.lng = +ln.toFixed(6);
    if (marker) marker.setLatLng([la, ln]); else marker = L.marker([la, ln]).addTo(map);
    if (pan) map.setView([la, ln], 14);
    container.querySelector("[data-coords]").textContent = `Selected: ${value.lat}, ${value.lng}`;
    onChange?.(value);
  };
  if (lat != null) set(lat, lng);
  map.on("click", (e) => set(e.latlng.lat, e.latlng.lng));
  container.querySelector("[data-geo]").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => set(p.coords.latitude, p.coords.longitude, true),
      () => { container.querySelector("[data-coords]").textContent = "Location permission denied: click the map instead"; },
      { timeout: 8000 },
    );
  });
  return { value, map };
}
