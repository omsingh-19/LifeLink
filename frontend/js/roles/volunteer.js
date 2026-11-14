import { action, ago, api, badge, clock, esc, toast, when } from "../api.js";
import { locationPicker } from "../map.js";

const osm = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
const NEXT = { accepted: ["collected", "Collected from pharmacy"], collected: ["out_for_delivery", "Out for delivery"],
  out_for_delivery: ["delivered", "Delivered"] };

async function renderOffers(el, ctx) {
  const p = ctx.me.profile;
  const offers = await api("/volunteers/me/offers");
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Delivery offers</h2>
        <label class="row" style="margin:0"><input type="checkbox" id="avail" ${p.is_available ? "checked" : ""}> Available for deliveries</label></div>
      ${offers.length ? `<ul class="list">${offers.map((o) => `
        <li><div class="row"><strong>${esc(o.order_code)}</strong> ${esc(o.medicine)} × ${o.quantity} ${badge(o.urgency)}
          <span class="small muted">offered ${ago(o.offered_at)}</span></div>
          <div class="small">Pickup: <strong>${esc(o.pickup.name)}</strong>, ${esc(o.pickup.address)} (${o.distance_to_pickup_km} km from you)
            · trip to recipient about ${o.trip_km} km</div>
          <div class="row" style="margin-top:.4rem"><button class="btn sm ok" data-accept="${o.offer_id}">Accept</button>
            <button class="btn sm" data-decline="${o.offer_id}">Decline</button></div></li>`).join("")}</ul>`
        : `<p class="empty">No offers right now. Offers expire if not answered in 10 minutes.</p>`}
    </div>`;
  el.querySelector("#avail").addEventListener("change", async (e) => {
    try {
      await api("/volunteers/me", { method: "PATCH", body: { is_available: e.target.checked } });
      ctx.me.profile.is_available = e.target.checked;
      toast(e.target.checked ? "You will receive delivery offers" : "Offers paused");
    } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  });
  el.querySelectorAll("[data-accept],[data-decline]").forEach((b) => b.addEventListener("click", action(b, async () => {
    const accept = !!b.dataset.accept;
    await api(`/offers/${b.dataset.accept || b.dataset.decline}/respond`, { method: "POST", body: { accept } });
    toast(accept ? "Accepted: see My deliveries" : "Declined");
    if (accept) ctx.go("vol-tasks"); else await renderOffers(el, ctx);
  })));
}

async function renderTasks(el) {
  const tasks = await api("/volunteers/me/deliveries");
  const active = tasks.filter((t) => NEXT[t.status]);
  const past = tasks.filter((t) => !NEXT[t.status]);
  el.innerHTML = `
    <div class="card"><h2>Active deliveries</h2>
      ${active.length ? active.map((t) => {
        const arrive = t.eta_minutes ? new Date(new Date(t.eta_computed_at).getTime() + t.eta_minutes * 60000) : null;
        return `<div data-id="${t.delivery_id}" style="padding:.6rem 0;border-top:1px solid var(--border)">
          <div class="row"><strong>${esc(t.order_code)}</strong> ${esc(t.medicine)} × ${t.quantity} ${badge(t.status)}
            ${arrive ? `<span class="small muted">ETA to recipient ~${clock(arrive)} (${t.eta_source === "osrm" ? "road route" : "estimate"})</span>` : ""}</div>
          <div class="small">1. Pickup: <strong>${esc(t.pickup.name)}</strong>, ${esc(t.pickup.address)} · 📞 ${esc(t.pickup.contact)} · <a target="_blank" rel="noopener" href="${osm(t.pickup.lat, t.pickup.lng)}">map</a></div>
          <div class="small">2. Deliver to: <strong>${esc(t.drop.name)}</strong>, ${esc(t.drop.address)} · 📞 <a href="tel:${esc(t.drop.phone)}">${esc(t.drop.phone)}</a> · <a target="_blank" rel="noopener" href="${osm(t.drop.lat, t.drop.lng)}">map</a></div>
          <div class="row" style="margin-top:.4rem">
            <button class="btn sm ok" data-s="${NEXT[t.status][0]}">${NEXT[t.status][1]}</button>
            <button class="btn sm danger" data-fail>Report failed</button></div></div>`;
      }).join("") : `<p class="empty">No active deliveries.</p>`}
    </div>
    <div class="card"><h3>History</h3>
      ${past.length ? `<div class="table-wrap"><table><tbody>${past.map((t) => `<tr><td>${esc(t.order_code)}</td><td>${esc(t.medicine)}</td>
        <td>${badge(t.status)}</td><td class="small">${esc(t.failure_reason || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty small">None yet.</p>`}
    </div>`;
  el.querySelectorAll("[data-id]").forEach((row) => {
    const id = row.dataset.id;
    const send = async (status, note = "") => {
      await api(`/deliveries/${id}/status`, { method: "PATCH", body: { status, note } });
      toast("Status updated");
      await renderTasks(el);
    };
    const b = row.querySelector("[data-s]");
    b.addEventListener("click", action(b, () => send(b.dataset.s)));
    const f = row.querySelector("[data-fail]");
    f.addEventListener("click", action(f, async () => {
      const reason = prompt("What went wrong? (e.g. recipient not reachable)");
      if (reason) await send("failed", reason);
    }));
  });
}

async function renderProfile(el, ctx) {
  const p = ctx.me.profile;
  el.innerHTML = `<div class="card"><h2>Service area</h2>
    <form id="vp-form"><div class="form-grid">
      <div class="field"><label>Service radius (km)</label><input name="service_radius_km" type="number" min="1" max="100" value="${p.service_radius_km}"></div>
      <div class="field"><label>Vehicle</label><input name="vehicle" value="${esc(p.vehicle)}"></div></div>
      <div class="field"><label>Base location (where you usually start; used for offers and ETA)</label><div id="vp-loc"></div></div>
      <button class="btn primary">Save</button></form>
    <p class="disclaimer">LifeLink does not track you live. Your location is only what you save here.</p></div>`;
  const picker = locationPicker(el.querySelector("#vp-loc"), { lat: p.lat, lng: p.lng });
  const form = el.querySelector("#vp-form");
  form.addEventListener("submit", action(form.querySelector("button.primary"), async () => {
    ctx.me.profile = await api("/volunteers/me", { method: "PATCH", body: {
      service_radius_km: Number(form.service_radius_km.value), vehicle: form.vehicle.value, lat: picker.value.lat, lng: picker.value.lng } });
    toast("Saved");
  }));
}

export default {
  tabs: [
    { id: "vol-offers", label: "Offers", render: renderOffers, poll: true },
    { id: "vol-tasks", label: "My deliveries", render: renderTasks },
    { id: "vol-profile", label: "Service area", render: renderProfile },
  ],
};
