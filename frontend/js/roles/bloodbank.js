import { action, ago, api, badge, esc, toast } from "../api.js";

async function renderStock(el) {
  const stock = await api("/bloodbanks/me/stock");
  el.innerHTML = `
    <div class="card">
      <h2>Reported blood stock</h2>
      <p class="small muted">Update units whenever stock changes. Requesters see the time of your last update.</p>
      <form id="stock-form">
        <div class="stock-grid">${stock.map((s) => `
          <div class="stock-cell"><div class="g">${esc(s.blood_group)}</div>
            <input name="${esc(s.blood_group)}" type="number" min="0" max="10000" value="${s.units}" aria-label="${esc(s.blood_group)} units" style="text-align:center">
            <div class="small muted">${s.reported_at ? ago(s.reported_at) : "not reported"}${s.stale && s.reported_at ? ' <span class="badge warn">stale</span>' : ""}</div></div>`).join("")}
        </div>
        <button class="btn primary" style="margin-top:1rem">Save stock</button>
      </form>
    </div>`;
  const form = el.querySelector("#stock-form");
  form.addEventListener("submit", action(form.querySelector("button"), async () => {
    const body = { stock: {} };
    form.querySelectorAll("input").forEach((i) => { body.stock[i.name] = Number(i.value || 0); });
    await api("/bloodbanks/me/stock", { method: "PUT", body });
    toast("Stock updated");
    await renderStock(el);
  }));
}

async function renderRequests(el) {
  const rows = await api("/bloodbanks/me/requests");
  el.innerHTML = `
    <div class="card">
      <h2>Blood requests within 50 km</h2>
      ${rows.length ? `<ul class="list">${rows.map((r) => `
        <li><div class="row"><strong>${esc(r.code)}</strong> <span class="blood">${esc(r.blood_group)}</span> × ${r.units}
            ${badge(r.urgency)} ${badge(r.status)} <span class="small muted">${esc(r.city)} · ${r.distance_km} km · ${ago(r.created_at)}</span></div>
          <div class="small">Requester contact: 📞 <a href="tel:${esc(r.contact)}">${esc(r.contact)}</a></div>
          ${r.my_response ? `<div class="small">Your response: ${badge(r.my_response.status)} ${r.my_response.units_confirmed ? `${r.my_response.units_confirmed} unit(s)` : ""} ${esc(r.my_response.note)}</div>` : ""}
          ${["open", "in_progress"].includes(r.status) ? `<form class="row" data-id="${r.id}" style="margin-top:.4rem">
            <input name="units_confirmed" type="number" min="0" max="100" value="${r.units}" style="width:90px" aria-label="Units">
            <input name="note" class="grow" placeholder="Note (e.g. collect from counter 2)">
            <button class="btn sm ok" data-s="confirmed_available">Confirm available</button>
            <button class="btn sm" data-s="not_available">Not available</button></form>` : ""}
        </li>`).join("")}</ul>` : `<p class="empty">No active requests nearby.</p>`}
    </div>`;
  el.querySelectorAll("form[data-id]").forEach((f) => f.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", action(b, async () => {
      await api(`/bloodbanks/me/requests/${f.dataset.id}/respond`, { method: "POST",
        body: { status: b.dataset.s, units_confirmed: Number(f.units_confirmed.value || 0), note: f.note.value } });
      toast("Response sent to requester");
      await renderRequests(el);
    }))));
}

export default {
  tabs: [
    { id: "bb-requests", label: "Requests", render: renderRequests, poll: true },
    { id: "bb-stock", label: "Stock", render: renderStock },
  ],
};
