import { action, ago, api, badge, esc, toast } from "../api.js";
import { locationPicker } from "../map.js";

async function renderRequests(el, ctx) {
  const rows = await api("/donors/me/requests");
  const active = rows.filter((r) => r.response === "notified" && ["open", "in_progress"].includes(r.request_status));
  const p = ctx.me.profile;
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Requests matching <span class="blood">${esc(p.blood_group)}</span></h2>
        <label class="row" style="margin:0"><input type="checkbox" id="avail" ${p.is_available ? "checked" : ""}> Available for requests</label>
      </div>
      ${active.length ? `<ul class="list">${active.map((r) => `
        <li><div class="row"><span class="blood">${esc(r.blood_group)}</span> × ${r.units} ${badge(r.urgency)}
          <span class="small muted">${esc(r.city)} · ${r.distance_km} km away · ${ago(r.created_at)}</span>
          <span class="spacer"></span>
          <button class="btn sm ok" data-accept="${r.response_id}">Accept</button>
          <button class="btn sm" data-decline="${r.response_id}">Decline</button></div></li>`).join("")}</ul>`
        : `<p class="empty">No open requests for you right now. We'll notify you when one matches.</p>`}
      <p class="disclaimer">Accepting shares your name and phone with the requester. Final eligibility is decided by the blood bank or hospital after screening.</p>
    </div>
    <div class="card"><h3>My responses</h3>
      ${rows.filter((r) => r.response !== "notified").map((r) => `
        <div style="padding:.5rem 0;border-top:1px solid var(--border)">
          <div class="row"><strong>${esc(r.code)}</strong> <span class="blood">${esc(r.blood_group)}</span> × ${r.units} ${badge(r.response)}
          <span class="small muted">request ${esc(r.request_status.replace("_", " "))}</span></div>
          ${r.response === "accepted" ? `<div class="small">Patient: ${esc(r.patient_name)} · 📞 <a href="tel:${esc(r.contact)}">${esc(r.contact)}</a>${r.notes ? ` · ${esc(r.notes)}` : ""}
            · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=16/${r.lat}/${r.lng}">Open location</a></div>` : ""}
        </div>`).join("") || `<p class="empty small">None yet.</p>`}
    </div>`;
  el.querySelector("#avail").addEventListener("change", async (e) => {
    try {
      await api("/donors/me", { method: "PATCH", body: { is_available: e.target.checked } });
      ctx.me.profile.is_available = e.target.checked;
      toast(e.target.checked ? "You are available for requests" : "You will not receive new requests");
    } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  });
  el.querySelectorAll("[data-accept],[data-decline]").forEach((b) => b.addEventListener("click", action(b, async () => {
    const accept = !!b.dataset.accept;
    await api(`/donors/me/requests/${b.dataset.accept || b.dataset.decline}/respond`, { method: "POST", body: { accept } });
    toast(accept ? "Thank you! The requester has your contact." : "Declined");
    await renderRequests(el, ctx);
  })));
}

async function renderProfile(el, ctx) {
  const p = ctx.me.profile;
  el.innerHTML = `
    <div class="card"><h2>My donor profile</h2>
      <p>${esc(ctx.me.name)} · ${esc(ctx.me.email)} · ${esc(ctx.me.phone)} · Blood group <span class="blood">${esc(p.blood_group)}</span>
        · Verification ${badge(p.verification_status)}</p>
      <form id="dp-form">
        <div class="form-grid">
          <div class="field"><label>City</label><input name="city" value="${esc(p.city)}" required></div>
          <div class="field"><label>PIN code</label><input name="pincode" value="${esc(p.pincode)}" pattern="\\d{6}" required></div>
          <div class="field"><label>Last donation date</label><input name="last_donation_date" type="date" value="${esc(p.last_donation_date || "")}"></div>
        </div>
        <div class="field"><label>Location (used for matching; never shown on the map)</label><div id="dp-loc"></div></div>
        <button class="btn primary">Save</button>
      </form>
    </div>`;
  const picker = locationPicker(el.querySelector("#dp-loc"), { lat: p.lat, lng: p.lng });
  const form = el.querySelector("#dp-form");
  form.addEventListener("submit", action(form.querySelector("button.primary"), async () => {
    const body = { city: form.city.value, pincode: form.pincode.value, lat: picker.value.lat, lng: picker.value.lng,
      last_donation_date: form.last_donation_date.value || null };
    ctx.me.profile = await api("/donors/me", { method: "PATCH", body });
    toast("Profile saved");
  }));
}

export default {
  tabs: [
    { id: "donor-requests", label: "Requests", render: renderRequests, poll: true },
    { id: "donor-profile", label: "Profile", render: renderProfile },
  ],
};
