import { action, ago, api, badge, esc, label, toast, when } from "../api.js";
import { locationPicker } from "../map.js";

async function renderOverview(el) {
  const s = await api("/admin/stats");
  const tile = (n, l) => `<div class="card stat"><div class="num">${n ?? "–"}</div><div class="lbl">${l}</div></div>`;
  const reqs = await api("/admin/blood-requests");
  el.innerHTML = `
    <div class="grid grid-3">
      ${tile(s.pending_verifications, "Pending verifications")}
      ${tile(s.blood_requests_open, "Open blood requests")}
      ${tile(s.blood_fulfilment_rate != null ? s.blood_fulfilment_rate + "%" : null, "Blood requests fulfilled")}
      ${tile(s.avg_donor_response_min != null ? s.avg_donor_response_min + " min" : null, "Avg. donor response time")}
      ${tile(`${s.donors_available} / ${s.donors_approved}`, "Donors available / verified")}
      ${tile(s.facilities_approved, "Verified facilities")}
      ${tile(s.volunteers_approved, "Verified volunteers")}
      ${tile(`${s.orders_delivered} / ${s.orders_total}`, "Medicine orders completed")}
      ${tile(s.deliveries_unassigned, "Deliveries needing a volunteer")}
    </div>
    <div class="card" style="margin-top:1rem"><h2>All blood requests</h2>
      ${reqs.length ? `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Need</th><th>City</th><th>Urgency</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>${reqs.map((r) => `<tr><td>${esc(r.code)}</td><td><span class="blood">${esc(r.blood_group)}</span> × ${r.units}</td><td>${esc(r.city)}</td>
        <td>${badge(r.urgency)}</td><td>${badge(r.status)}</td><td class="small">${ago(r.created_at)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">None yet.</p>`}
    </div>`;
}

async function renderVerify(el) {
  const filter = el.dataset.filter || "pending";
  const rows = await api(`/admin/verifications?status=${filter}`);
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Physical verification</h2>
        <select id="vf" style="width:auto">${["pending", "approved", "rejected"].map((s) => `<option value="${s}" ${s === filter ? "selected" : ""}>${s === "pending" ? "Pending / needs correction" : label(s)}</option>`).join("")}</select></div>
      <p class="small muted">Record the outcome after checking the original documents in person (ID proof, licence, registration certificate).</p>
      ${rows.length ? `<ul class="list">${rows.map((r) => `
        <li data-type="${r.subject_type}" data-id="${r.subject_id}">
          <div class="row"><strong>${esc(r.name)}</strong> <span class="badge info">${esc(label(r.role))}</span> ${badge(r.status)}
            <span class="small muted">registered ${ago(r.registered_at)}</span></div>
          <div class="small">${esc(r.details)} · ${esc(r.email)} · ${esc(r.phone)}</div>
          ${r.last_remarks ? `<div class="small muted">Last remarks: ${esc(r.last_remarks)}</div>` : ""}
          <div class="row" style="margin-top:.4rem">
            <input name="docs" class="grow" placeholder="Documents checked (e.g. Aadhaar, drug licence)">
            <input name="remarks" class="grow" placeholder="Remarks (required to reject / request correction)">
            <button class="btn sm ok" data-d="approved">Approve</button>
            <button class="btn sm" data-d="needs_correction">Needs correction</button>
            <button class="btn sm danger" data-d="rejected">Reject</button></div>
        </li>`).join("")}</ul>` : `<p class="empty">Nothing here.</p>`}
    </div>`;
  el.querySelector("#vf").addEventListener("change", (e) => { el.dataset.filter = e.target.value; renderVerify(el); });
  el.querySelectorAll("li[data-type]").forEach((li) => li.querySelectorAll("[data-d]").forEach((b) =>
    b.addEventListener("click", action(b, async () => {
      await api(`/admin/verifications/${li.dataset.type}/${li.dataset.id}`, { method: "POST", body: {
        status: b.dataset.d, documents_checked: li.querySelector("[name=docs]").value, remarks: li.querySelector("[name=remarks]").value } });
      toast(`Marked ${label(b.dataset.d)}`);
      await renderVerify(el);
    }))));
}

async function renderDeliveries(el) {
  const rows = await api("/deliveries");
  el.innerHTML = `
    <div class="card"><h2>Deliveries</h2>
      ${rows.length ? `<ul class="list">${rows.map((d) => `
        <li data-id="${d.delivery_id}"><div class="row"><strong>${esc(d.order_code)}</strong> ${esc(d.medicine)} ${badge(d.status)}
          ${d.volunteer ? `<span class="small">🛵 ${esc(d.volunteer.name)} · ${esc(d.volunteer.phone)}</span>` : ""}</div>
          <div class="small muted">${esc(d.pickup.name)} → ${esc(d.drop.address)} (${d.trip_km} km)${d.failure_reason ? ` · Failed: ${esc(d.failure_reason)}` : ""}</div>
          ${d.candidates.length ? `<div class="row" style="margin-top:.4rem"><select name="vol" style="width:auto">${d.candidates.map((c) =>
            `<option value="${c.volunteer_id}">${esc(c.name)} (${c.distance_km} km)</option>`).join("")}</select>
            <button class="btn sm primary" data-assign>Offer to volunteer</button></div>`
          : ["unassigned", "failed"].includes(d.status) ? `<div class="small" style="margin-top:.3rem">No eligible volunteer available nearby.</div>` : ""}
        </li>`).join("")}</ul>` : `<p class="empty">No deliveries yet.</p>`}
    </div>`;
  el.querySelectorAll("[data-assign]").forEach((b) => b.addEventListener("click", action(b, async () => {
    const li = b.closest("li");
    await api(`/deliveries/${li.dataset.id}/assign`, { method: "POST", body: { volunteer_id: Number(li.querySelector("[name=vol]").value) } });
    toast("Offer sent");
    await renderDeliveries(el);
  })));
}

async function renderCamps(el) {
  const camps = await api("/camps");
  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card"><h2>Add donation camp</h2>
        <form id="camp-form">
          <div class="field"><label>Title</label><input name="title" required minlength="3"></div>
          <div class="form-grid">
            <div class="field"><label>Organizer</label><input name="organizer" required></div>
            <div class="field"><label>Contact</label><input name="contact"></div>
            <div class="field"><label>Starts</label><input name="starts_at" type="datetime-local" required></div>
            <div class="field"><label>Ends</label><input name="ends_at" type="datetime-local" required></div>
          </div>
          <div class="field"><label>Address</label><input name="address" required></div>
          <div class="field"><label>Location</label><div id="camp-loc"></div></div>
          <button class="btn primary">Add camp</button>
        </form></div>
      <div class="card"><h2>Upcoming camps</h2>
        <ul class="list">${camps.map((c) => `<li><div class="row"><strong class="grow">${esc(c.title)}</strong><button class="btn sm danger" data-del="${c.id}">Delete</button></div>
          <div class="small">${when(c.starts_at)} · ${esc(c.address)} · ${esc(c.organizer)}</div></li>`).join("") || `<li class="empty">None.</li>`}</ul></div>
    </div>`;
  const picker = locationPicker(el.querySelector("#camp-loc"));
  const form = el.querySelector("#camp-form");
  form.addEventListener("submit", action(form.querySelector("button.primary"), async () => {
    if (!picker.value.lat) throw new Error("Set the camp location on the map");
    await api("/camps", { method: "POST", body: { title: form.title.value, organizer: form.organizer.value, contact: form.contact.value,
      address: form.address.value, lat: picker.value.lat, lng: picker.value.lng,
      starts_at: new Date(form.starts_at.value).toISOString(), ends_at: new Date(form.ends_at.value).toISOString() } });
    toast("Camp added");
    await renderCamps(el);
  }));
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", action(b, async () => {
    if (!confirm("Delete this camp?")) return;
    await api(`/camps/${b.dataset.del}`, { method: "DELETE" });
    await renderCamps(el);
  })));
}

export default {
  tabs: [
    { id: "admin-overview", label: "Overview", render: renderOverview, poll: true },
    { id: "admin-verify", label: "Verification", render: renderVerify },
    { id: "admin-deliveries", label: "Deliveries", render: renderDeliveries, poll: true },
    { id: "admin-camps", label: "Donation camps", render: renderCamps },
  ],
};
