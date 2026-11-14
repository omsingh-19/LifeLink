// Blood request views shared by the hospital and patient dashboards.
import { action, ago, api, badge, esc, formData, groupOptions, label, toast, when } from "./api.js";
import { dot, facilityPopup, legend, locationPicker, makeMap } from "./map.js";

export function renderRequestForm(el, ctx, { defaults = {} } = {}) {
  el.innerHTML = `
    <div class="card">
      <h2>New emergency blood request</h2>
      <form id="br-form">
        <div class="form-grid">
          <div class="field"><label>Patient name</label><input name="patient_name" required minlength="2" value="${esc(defaults.patient_name || "")}"></div>
          <div class="field"><label>Blood group needed</label><select name="blood_group" required>${groupOptions()}</select></div>
          <div class="field"><label>Units</label><input name="units" type="number" min="1" max="20" value="1" required></div>
          <div class="field"><label>Urgency</label><select name="urgency"><option value="critical">Critical</option><option value="high" selected>High</option><option value="normal">Normal</option></select></div>
          <div class="field"><label>Contact phone</label><input name="contact" required value="${esc(ctx.me.phone)}"></div>
          <div class="field"><label>City</label><input name="city" required value="${esc(defaults.city || "Indore")}"></div>
        </div>
        <div class="field"><label>Notes (ward, hospital, timing)</label><textarea name="notes" maxlength="500"></textarea></div>
        <div class="field"><label>Where is the blood needed?</label><div id="br-loc"></div></div>
        <button class="btn primary">Submit request</button>
      </form>
      <p class="disclaimer">Matching donors are notified. Their contact details are shared with you only after they accept. The donor or blood bank confirms suitability through proper medical procedures.</p>
    </div>`;
  const picker = locationPicker(el.querySelector("#br-loc"), defaults.lat ? { lat: defaults.lat, lng: defaults.lng } : {});
  const form = el.querySelector("#br-form");
  form.addEventListener("submit", action(form.querySelector("button.primary"), async () => {
    if (!picker.value.lat) throw new Error("Please set the location on the map");
    const body = { ...formData(form), units: Number(form.units.value), lat: picker.value.lat, lng: picker.value.lng };
    const r = await api("/blood-requests", { method: "POST", body });
    toast(`Request ${r.code} created: ${r.donors_notified} donor(s) notified`);
    ctx.go(`req-${r.id}`);
  }));
}

export async function renderRequestList(el) {
  const rows = await api("/blood-requests/mine");
  el.innerHTML = `
    <div class="card">
      <h2>My blood requests</h2>
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Need</th><th>Urgency</th><th>Donors</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td><strong>${esc(r.code)}</strong></td>
          <td><span class="blood">${esc(r.blood_group)}</span> × ${r.units}<br><span class="small muted">${esc(r.patient_name)}</span></td>
          <td>${badge(r.urgency)}</td>
          <td>${r.donors_accepted} accepted / ${r.donors_notified} notified</td>
          <td>${badge(r.status)}</td>
          <td class="small">${ago(r.created_at)}</td>
          <td><a class="btn sm" href="#req-${r.id}">Open</a></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="empty">No requests yet.</p>`}
    </div>`;
}

const NEXT = { open: ["in_progress", "fulfilled", "cancelled"], in_progress: ["fulfilled", "cancelled"], fulfilled: ["closed"], cancelled: ["closed"], closed: [] };

export async function renderRequestDetail(el, id) {
  const r = await api(`/blood-requests/${id}`);
  const accepted = r.donors.filter((d) => d.status === "accepted");
  el.innerHTML = `
    <p><a href="#" data-back>← Back to my requests</a></p>
    <div class="card">
      <div class="card-head">
        <h2>Request ${esc(r.code)} · <span class="blood">${esc(r.blood_group)}</span> × ${r.units}</h2>
        <div>${badge(r.urgency)} ${badge(r.status)}</div>
      </div>
      <p class="small muted">Patient: ${esc(r.patient_name)} · ${esc(r.city)} · created ${when(r.created_at)} · Share tracking code <strong>${esc(r.code)}</strong></p>
      <div class="row">
        ${NEXT[r.status].map((s) => `<button class="btn sm ${s === "fulfilled" ? "ok" : s === "cancelled" ? "danger" : ""}" data-status="${s}">Mark ${label(s)}</button>`).join("")}
        ${["open", "in_progress"].includes(r.status) ? `<button class="btn sm" data-rematch>Find more donors</button>` : ""}
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card">
        <h3>Donors (${accepted.length} accepted of ${r.donors.length} notified)</h3>
        ${r.donors.length ? `<ul class="list">${r.donors.map((d) => `
          <li><div class="row"><span class="blood">${esc(d.blood_group)}</span>
            ${d.exact_match ? "" : '<span class="badge info">compatible</span>'}
            <span class="small muted">${d.distance_km} km</span><span class="spacer"></span>${badge(d.status)}</div>
            ${d.status === "accepted" ? `<div class="small">👤 ${esc(d.name)} · 📞 <a href="tel:${esc(d.phone)}">${esc(d.phone)}</a></div>` : ""}
          </li>`).join("")}</ul>` : `<p class="empty">No matching donors yet. Try “Find more donors” later, or contact the blood banks.</p>`}
      </div>
      <div class="card">
        <h3>Blood bank responses</h3>
        ${r.bank_responses.length ? `<ul class="list">${r.bank_responses.map((b) => `
          <li><strong>${esc(b.name)}</strong> ${badge(b.status)}<br>
            <span class="small">${b.status === "confirmed_available" ? `${b.units_confirmed} unit(s) confirmed · ` : ""}📞 ${esc(b.contact)} ${b.note ? "· " + esc(b.note) : ""}</span></li>`).join("")}</ul>`
          : `<p class="empty small">No blood bank has responded yet.</p>`}
        <h3 style="margin-top:1rem">Nearby blood banks (reported stock)</h3>
        <ul class="list">${r.nearby_bloodbanks.slice(0, 6).map((b) => `
          <li><strong>${esc(b.name)}</strong> <span class="small muted">${b.distance_km} km</span><br>
            <span class="small">${esc(r.blood_group)}: <strong>${b.exact_units}</strong> · compatible: ${b.compatible_units} · 📞 ${esc(b.contact)}
            · updated ${ago(b.stock.map((s) => s.reported_at).sort().pop())}${b.stock.some((s) => s.stale) ? ' <span class="badge warn">may be outdated</span>' : ""}</span></li>`).join("") || `<li class="empty">None within 50 km.</li>`}</ul>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card"><h3>Map</h3><div class="map" id="req-map"></div>${legend(["target", "bloodbank"])}</div>
      <div class="card"><h3>Timeline</h3><ul class="timeline">${r.timeline.map((t) => `
        <li><strong>${esc(label(t.to))}</strong> <span class="small muted">${when(t.at)}</span>${t.note ? `<div class="small">${esc(t.note)}</div>` : ""}</li>`).join("")}</ul></div>
    </div>`;
  el.querySelector("[data-back]").addEventListener("click", (e) => { e.preventDefault(); history.back(); });
  const map = makeMap(el.querySelector("#req-map"), [r.lat, r.lng], 12);
  dot("target", r.lat, r.lng, "Request location", 10).addTo(map);
  r.nearby_bloodbanks.forEach((b) => dot("bloodbank", b.lat, b.lng, facilityPopup(b)).addTo(map));
  el.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", action(b, async () => {
    const note = b.dataset.status === "cancelled" ? prompt("Reason for cancelling (optional)") ?? "" : "";
    await api(`/blood-requests/${id}/status`, { method: "PATCH", body: { status: b.dataset.status, note } });
    toast("Status updated");
    await renderRequestDetail(el, id);
  })));
  el.querySelector("[data-rematch]")?.addEventListener("click", action(el.querySelector("[data-rematch]"), async () => {
    const res = await api(`/blood-requests/${id}/rematch`, { method: "POST" });
    toast(res.donors_notified ? `${res.donors_notified} more donor(s) notified` : "No new donors found right now");
    await renderRequestDetail(el, id);
  }));
}
