import { action, ago, api, auth, badge, esc, label, toast, when } from "../api.js";

// Pharmacy-side actions available for each order status.
const ACTIONS = {
  requested: [["confirmed", "Confirm order", "ok"], ["needs_clarification", "Ask for clarification"], ["unavailable", "Not available"], ["rejected", "Reject", "danger"]],
  needs_clarification: [["rejected", "Reject", "danger"]],
  confirmed: [["preparing", "Start preparing"]],
  preparing: [["ready", "Mark ready", "ok"]],
  ready: [["collected", "Collected by patient", "ok"]],
  collected: [["closed", "Close"]],
  delivered: [["closed", "Close"]],
  delivery_failed: [["ready", "Back to ready (patient collects)"]],
};

async function openPrescription(id) {
  const res = await fetch(`/api/orders/${id}/prescription`, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) return toast("Could not open prescription", true);
  window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
}

async function renderOrders(el) {
  const orders = await api("/pharmacies/me/orders");
  const active = orders.filter((o) => !["closed", "cancelled", "rejected", "unavailable"].includes(o.status));
  const done = orders.filter((o) => !active.includes(o));
  const card = (o) => `
    <li data-id="${o.id}">
      <div class="row"><strong>${esc(o.code)}</strong> ${esc(o.medicine_name)} ${esc(o.strength)} × ${o.quantity}
        ${badge(o.urgency)} ${badge(o.status)} <span class="small muted">${ago(o.created_at)}</span></div>
      <div class="small">👤 ${esc(o.patient.name)} · 📞 <a href="tel:${esc(o.patient.phone)}">${esc(o.patient.phone)}</a> ·
        ${o.fulfilment === "delivery" ? `Delivery to ${esc(o.delivery_address)}` : "Patient will collect"}
        ${o.patient_note ? `<br>Note: ${esc(o.patient_note)}` : ""}</div>
      ${o.requires_prescription ? `<div class="small">Prescription: ${o.has_prescription ? `<a href="#" data-rx="${o.id}">view file</a>` : "missing"}
        · ${o.prescription_verified ? badge("approved") : `<label style="display:inline"><input type="checkbox" data-rxok> I have checked the prescription</label>`}</div>` : ""}
      ${o.delivery ? `<div class="small">Delivery: ${badge(o.delivery.status)} ${o.delivery.volunteer ? `🛵 ${esc(o.delivery.volunteer.name)} · ${esc(o.delivery.volunteer.phone)}` : ""}
        ${o.delivery.failure_reason ? ` · ${esc(o.delivery.failure_reason)}` : ""}</div>` : ""}
      ${(ACTIONS[o.status] || o.status === "ready" || o.status === "delivery_failed") ? `
      <div class="row" style="margin-top:.4rem">
        ${o.status === "requested" ? `<input name="price" type="number" min="0" step="0.5" placeholder="Price ₹" style="width:110px" value="${o.price_quoted ?? ""}">` : ""}
        <input name="note" class="grow" placeholder="Note to patient (required for clarification/rejection)">
        ${(ACTIONS[o.status] || []).map(([s, txt, cls]) => `<button class="btn sm ${cls || ""}" data-s="${s}">${txt}</button>`).join("")}
        ${(o.status === "ready" || o.status === "delivery_failed") && o.fulfilment === "delivery" ? `<button class="btn sm primary" data-delivery>Request volunteer delivery</button>` : ""}
      </div>` : ""}
    </li>`;
  el.innerHTML = `
    <div class="card"><h2>Active requests (${active.length})</h2>
      ${active.length ? `<ul class="list">${active.map(card).join("")}</ul>` : `<p class="empty">No active requests.</p>`}</div>
    <div class="card"><h3>Completed / closed</h3>
      ${done.length ? `<div class="table-wrap"><table><tbody>${done.map((o) => `<tr><td>${esc(o.code)}</td><td>${esc(o.medicine_name)} ${esc(o.strength)}</td>
        <td>${esc(o.patient.name)}</td><td>${badge(o.status)}</td><td class="small">${when(o.created_at)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="empty small">Nothing yet.</p>`}</div>`;
  el.querySelectorAll("[data-rx]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openPrescription(a.dataset.rx); }));
  el.querySelectorAll("li[data-id]").forEach((li) => {
    const id = li.dataset.id;
    li.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", action(b, async () => {
      const note = li.querySelector("[name=note]")?.value.trim() || "";
      const s = b.dataset.s;
      if (["needs_clarification", "rejected"].includes(s) && !note) throw new Error("Please add a note explaining why");
      const body = { status: s, note };
      const price = li.querySelector("[name=price]")?.value;
      if (price) body.price = Number(price);
      const rxok = li.querySelector("[data-rxok]");
      if (rxok) body.prescription_verified = rxok.checked;
      await api(`/orders/${id}/pharmacy-action`, { method: "POST", body });
      toast(`Order ${label(s)}`);
      await renderOrders(el);
    })));
    const del = li.querySelector("[data-delivery]");
    del?.addEventListener("click", action(del, async () => {
      const o = await api(`/orders/${id}/request-delivery`, { method: "POST" });
      toast(o.delivery?.status === "offered" ? "Offered to the nearest available volunteer" : "No volunteer free right now. An admin has been notified.");
      await renderOrders(el);
    }));
  });
}

async function renderCatalogue(el) {
  const items = await api("/pharmacies/me/catalogue");
  el.innerHTML = `
    <div class="card"><h2>Add medicine</h2>
      <form id="cat-form" class="form-grid">
        <div class="field"><label>Name</label><input name="name" required minlength="2"></div>
        <div class="field"><label>Strength</label><input name="strength" placeholder="500 mg"></div>
        <div class="field"><label>Form</label><select name="form"><option>tablet</option><option>capsule</option><option>syrup</option><option>injection</option><option>inhaler</option><option>sachet</option><option>other</option></select></div>
        <div class="field"><label>Price (₹)</label><input name="price" type="number" min="0" step="0.5"></div>
        <div class="field"><label>Stock</label><select name="status"><option value="in_stock">In stock</option><option value="low">Low</option><option value="out_of_stock">Out of stock</option></select></div>
        <div class="field"><label><input type="checkbox" name="requires_prescription"> Prescription required</label><button class="btn primary">Add</button></div>
      </form></div>
    <div class="card"><h2>Catalogue (${items.length})</h2>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Medicine</th><th>Rx</th><th>Price</th><th>Stock</th><th>Updated</th><th></th></tr></thead>
      <tbody>${items.map((i) => `<tr data-sid="${i.stock_id}">
        <td>${esc(i.name)} ${esc(i.strength)} <span class="small muted">${esc(i.form)}</span></td>
        <td>${i.requires_prescription ? "Yes" : "No"}</td><td>${i.price != null ? "₹" + i.price : "-"}</td>
        <td><select data-status style="width:auto">${["in_stock", "low", "out_of_stock"].map((s) => `<option value="${s}" ${s === i.status ? "selected" : ""}>${label(s)}</option>`).join("")}</select></td>
        <td class="small">${ago(i.reported_at)}</td><td><button class="btn sm danger" data-del>Remove</button></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="empty">Add the medicines you stock so patients can find them.</p>`}</div>`;
  const form = el.querySelector("#cat-form");
  form.addEventListener("submit", action(form.querySelector("button"), async () => {
    await api("/pharmacies/me/catalogue", { method: "POST", body: { name: form.name.value, strength: form.strength.value,
      form: form.form.value, status: form.status.value, requires_prescription: form.requires_prescription.checked,
      price: form.price.value ? Number(form.price.value) : null } });
    toast("Added");
    await renderCatalogue(el);
  }));
  el.querySelectorAll("tr[data-sid]").forEach((tr) => {
    const item = items.find((i) => String(i.stock_id) === tr.dataset.sid);
    tr.querySelector("[data-status]").addEventListener("change", async (e) => {
      try {
        await api(`/pharmacies/me/catalogue/${item.stock_id}`, { method: "PUT", body: { ...item, status: e.target.value } });
        toast("Stock status updated");
      } catch (err) { toast(err.message, true); }
    });
    tr.querySelector("[data-del]").addEventListener("click", action(tr.querySelector("[data-del]"), async () => {
      if (!confirm(`Remove ${item.name}?`)) return;
      await api(`/pharmacies/me/catalogue/${item.stock_id}`, { method: "DELETE" });
      await renderCatalogue(el);
    }));
  });
}

export default {
  tabs: [
    { id: "ph-orders", label: "Medicine requests", render: renderOrders },
    { id: "ph-catalogue", label: "Catalogue", render: renderCatalogue },
  ],
};
