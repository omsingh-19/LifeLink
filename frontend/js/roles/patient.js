import { action, ago, api, badge, clock, esc, label, toast, when } from "../api.js";
import { renderRequestDetail, renderRequestForm, renderRequestList } from "../blood.js";
import { dot, facilityPopup, legend, locationPicker, makeMap } from "../map.js";

// ----- Medicine search + order -----
async function renderMedicine(el, ctx) {
  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <h2>Find a medicine</h2>
        <form id="ms-form">
          <div class="row"><input class="grow" name="q" placeholder="Medicine name, e.g. Paracetamol" required minlength="2">
            <select name="radius" style="width:auto"><option value="5">5 km</option><option value="15" selected>15 km</option><option value="30">30 km</option></select>
            <button class="btn primary">Search</button></div>
          <div class="field" style="margin-top:.75rem"><label>Your location</label><div id="ms-loc"></div></div>
        </form>
        <p class="disclaimer">Stock is reported by pharmacies and may not be real-time. The pharmacy confirms availability, price and any prescription requirement.</p>
      </div>
      <div class="card"><h2>Results</h2><div id="ms-results"><p class="empty">Search to see participating pharmacies.</p></div>
        <div class="map hidden" id="ms-map"></div></div>
    </div>
    <div id="order-box"></div>`;
  const picker = locationPicker(el.querySelector("#ms-loc"));
  const form = el.querySelector("#ms-form");
  let map;
  form.addEventListener("submit", action(form.querySelector("button.primary"), async () => {
    if (!picker.value.lat) throw new Error("Set your location first (map click or “Use my location”)");
    const { lat, lng } = picker.value;
    const res = await api(`/pharmacies/search?q=${encodeURIComponent(form.q.value.trim())}&lat=${lat}&lng=${lng}&radius=${form.radius.value}`);
    const out = el.querySelector("#ms-results");
    out.innerHTML = res.length ? `<ul class="list">${res.map((p) => `
      <li><div class="row"><strong>${esc(p.name)}</strong><span class="small muted">${p.distance_km} km · 📞 ${esc(p.contact)}</span></div>
        ${p.items.map((i) => `<div class="row small" style="margin-top:.3rem">
          <span class="grow">${esc(i.name)} ${esc(i.strength)} <span class="muted">${esc(i.form)}</span>
            ${i.requires_prescription ? '<span class="badge info">Prescription</span>' : ""} ${badge(i.status)}
            ${i.price != null ? `₹${i.price}` : ""} <span class="muted">· updated ${ago(i.reported_at)}</span></span>
          <button class="btn sm" data-order='${esc(JSON.stringify({ p: { id: p.id, name: p.name }, i }))}' ${i.status === "out_of_stock" ? "disabled" : ""}>Request</button>
        </div>`).join("")}
      </li>`).join("")}</ul>` : `<p class="empty">No participating pharmacy lists this medicine nearby.</p>`;
    const mapEl = el.querySelector("#ms-map");
    mapEl.classList.remove("hidden");
    if (!map) map = makeMap(mapEl, [lat, lng], 13); else map.eachLayer((l) => { if (l instanceof L.CircleMarker) map.removeLayer(l); });
    dot("me", lat, lng, "You").addTo(map);
    res.forEach((p) => dot("pharmacy", p.lat, p.lng, facilityPopup(p)).addTo(map));
    out.querySelectorAll("[data-order]").forEach((b) => b.addEventListener("click", () =>
      orderForm(el.querySelector("#order-box"), JSON.parse(b.dataset.order), picker.value, ctx)));
  }));
}

function orderForm(box, { p, i }, loc, ctx) {
  box.innerHTML = `
    <div class="card" style="margin-top:1rem">
      <h2>Request ${esc(i.name)} ${esc(i.strength)} from ${esc(p.name)}</h2>
      <form id="order-form">
        <div class="form-grid">
          <div class="field"><label>Quantity</label><input name="quantity" type="number" min="1" max="100" value="1" required></div>
          <div class="field"><label>Urgency</label><select name="urgency"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></div>
          <div class="field"><label>How to receive</label><select name="fulfilment"><option value="pickup">I will collect</option><option value="delivery">Volunteer delivery</option></select></div>
          <div class="field"><label>Contact phone</label><input name="contact" required value="${esc(ctx.me.phone)}"></div>
        </div>
        <div class="field hidden" id="addr-field"><label>Delivery address (the map location is used for the route)</label><input name="delivery_address"></div>
        ${i.requires_prescription ? `<div class="field"><label>Prescription (JPG, PNG or PDF, max 5 MB): required</label><input name="prescription" type="file" accept=".jpg,.jpeg,.png,.pdf" required></div>` : ""}
        <div class="field"><label>Note to pharmacy (optional)</label><textarea name="patient_note" maxlength="500"></textarea></div>
        <div class="row"><button class="btn primary">Send request</button><button type="button" class="btn" data-cancel>Cancel</button></div>
      </form>
    </div>`;
  box.scrollIntoView({ behavior: "smooth" });
  const form = box.querySelector("form");
  form.fulfilment.addEventListener("change", () => {
    const d = form.fulfilment.value === "delivery";
    box.querySelector("#addr-field").classList.toggle("hidden", !d);
    form.delivery_address.required = d;
  });
  box.querySelector("[data-cancel]").addEventListener("click", () => (box.innerHTML = ""));
  form.addEventListener("submit", action(form.querySelector("button.primary"), async () => {
    const fd = new FormData(form);
    fd.append("pharmacy_id", p.id);
    fd.append("stock_id", i.stock_id);
    fd.append("medicine_name", i.name);
    fd.append("strength", i.strength);
    fd.append("lat", loc.lat);
    fd.append("lng", loc.lng);
    const o = await api("/orders", { method: "POST", form: fd });
    toast(`Request ${o.code} sent to ${p.name}`);
    ctx.go(`order-${o.id}`);
  }));
}

// ----- My requests -----
async function renderMine(el) {
  el.innerHTML = `<div id="mine-blood"></div><div id="mine-orders" style="margin-top:1rem"></div>`;
  await renderRequestList(el.querySelector("#mine-blood"));
  const orders = await api("/orders/mine");
  el.querySelector("#mine-orders").innerHTML = `
    <div class="card"><h2>My medicine requests</h2>
      ${orders.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Medicine</th><th>Pharmacy</th><th>Receive</th><th>Status</th><th></th></tr></thead>
        <tbody>${orders.map((o) => `<tr><td><strong>${esc(o.code)}</strong></td>
          <td>${esc(o.medicine_name)} ${esc(o.strength)} × ${o.quantity}</td><td>${esc(o.pharmacy.name)}</td>
          <td>${esc(o.fulfilment)}</td><td>${badge(o.status)}${o.delivery?.eta_minutes && ["accepted", "collected", "out_for_delivery"].includes(o.delivery.status) ? `<div class="small">ETA ~${o.delivery.eta_minutes} min</div>` : ""}</td>
          <td><a class="btn sm" href="#order-${o.id}">Open</a></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="empty">No medicine requests yet.</p>`}
    </div>`;
}

export function etaHtml(d) {
  if (!d || !d.eta_minutes || !["accepted", "collected", "out_for_delivery"].includes(d.status)) return "";
  const arrive = new Date(new Date(d.eta_computed_at).getTime() + d.eta_minutes * 60000);
  return `<div class="banner info"><strong>Estimated arrival ~${clock(arrive)}</strong> (${d.eta_minutes} min from ${when(d.eta_computed_at)},
    ${d.eta_source === "osrm" ? "road route" : "distance estimate"}). This is an estimate, not live tracking.</div>`;
}

async function renderOrder(el, id, ctx) {
  const o = await api(`/orders/${id}`);
  const d = o.delivery;
  el.innerHTML = `
    <p><a href="#pat-requests">← Back to my requests</a></p>
    <div class="card">
      <div class="card-head"><h2>${esc(o.code)} · ${esc(o.medicine_name)} ${esc(o.strength)} × ${o.quantity}</h2>${badge(o.status)}</div>
      ${etaHtml(d)}
      <p><strong>${esc(o.pharmacy.name)}</strong> · ${esc(o.pharmacy.address)} · 📞 <a href="tel:${esc(o.pharmacy.contact)}">${esc(o.pharmacy.contact)}</a></p>
      <p class="small">Receive by: ${esc(o.fulfilment)}${o.delivery_address ? ` · ${esc(o.delivery_address)}` : ""}
        ${o.price_quoted != null ? ` · Price quoted: ₹${o.price_quoted}` : ""}
        ${o.requires_prescription ? ` · Prescription ${o.prescription_verified ? badge("approved") : badge("pending")}` : ""}</p>
      ${o.pharmacy_note ? `<div class="banner warn"><strong>Pharmacy note:</strong> ${esc(o.pharmacy_note)}</div>` : ""}
      ${d?.volunteer ? `<p>🛵 Volunteer: <strong>${esc(d.volunteer.name)}</strong> (${esc(d.volunteer.vehicle)}) · 📞 <a href="tel:${esc(d.volunteer.phone)}">${esc(d.volunteer.phone)}</a></p>` : ""}
      ${d?.failure_reason ? `<div class="banner bad">Delivery failed: ${esc(d.failure_reason)}</div>` : ""}
      <div class="row">
        ${o.status === "needs_clarification" ? `<button class="btn primary" data-resubmit>Reply to pharmacy</button>` : ""}
        ${["requested", "needs_clarification", "confirmed", "preparing", "ready"].includes(o.status) ? `<button class="btn danger" data-cancel>Cancel request</button>` : ""}
      </div>
    </div>
    <div class="card"><h3>Timeline</h3><ul class="timeline">${o.timeline.map((t) => `
      <li><strong>${esc(label(t.to))}</strong> <span class="small muted">${when(t.at)}</span>${t.note ? `<div class="small">${esc(t.note)}</div>` : ""}</li>`).join("")}</ul></div>`;
  el.querySelector("[data-cancel]")?.addEventListener("click", action(el.querySelector("[data-cancel]"), async () => {
    if (!confirm("Cancel this request?")) return;
    await api(`/orders/${id}/patient-action`, { method: "POST", body: { action: "cancel" } });
    await renderOrder(el, id, ctx);
  }));
  el.querySelector("[data-resubmit]")?.addEventListener("click", action(el.querySelector("[data-resubmit]"), async () => {
    const note = prompt("Your reply / clarification for the pharmacy");
    if (!note) return;
    await api(`/orders/${id}/patient-action`, { method: "POST", body: { action: "resubmit", note } });
    await renderOrder(el, id, ctx);
  }));
}

async function renderNearby(el) {
  el.innerHTML = `<div class="card"><h2>Blood banks, pharmacies and camps</h2><div class="map tall" id="nb-map"></div>
    ${legend(["bloodbank", "pharmacy", "camp"])}<p class="disclaimer">Stock shown is as reported by the facility. Call to confirm before travelling.</p></div>`;
  const map = makeMap(el.querySelector("#nb-map"));
  const [fac, camps] = await Promise.all([api("/map/facilities?kinds=bloodbank,pharmacy"), api("/camps")]);
  fac.forEach((f) => dot(f.kind, f.lat, f.lng, facilityPopup(f)).addTo(map));
  camps.forEach((c) => dot("camp", c.lat, c.lng, `<strong>${esc(c.title)}</strong><br>${when(c.starts_at)}<br>${esc(c.address)}`).addTo(map));
}

export default {
  tabs: [
    { id: "pat-blood", label: "Need blood", render: (el, ctx) => renderRequestForm(el, ctx) },
    { id: "pat-medicine", label: "Need medicine", render: renderMedicine },
    { id: "pat-requests", label: "My requests", render: renderMine, poll: true },
    { id: "pat-nearby", label: "Nearby map", render: renderNearby },
  ],
  async route(hash, el, ctx) {
    let m = hash.match(/^req-(\d+)$/);
    if (m) { await renderRequestDetail(el, Number(m[1])); return "pat-requests"; }
    m = hash.match(/^order-(\d+)$/);
    if (m) { await renderOrder(el, Number(m[1]), ctx); return "pat-requests"; }
    return false;
  },
};
