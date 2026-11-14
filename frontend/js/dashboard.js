import { ago, api, auth, esc, label } from "./api.js";

const ROLE_NAMES = { donor: "Donor", hospital: "Hospital", patient: "Patient", bloodbank: "Blood bank",
  pharmacy: "Pharmacy", volunteer: "Volunteer", admin: "Admin" };

if (!auth.token) location.href = "/index.html";

const view = document.getElementById("view");
const tabsEl = document.getElementById("tabs");
let me, mod, current, pollTimer;

async function loadMe() {
  me = await api("/auth/me");
  document.getElementById("role-badge").textContent = ROLE_NAMES[me.role];
  document.getElementById("who").textContent = me.name;
  const v = me.verification;
  const banner = document.getElementById("verify-banner");
  if (!v || v.status === "approved") banner.innerHTML = "";
  else if (v.status === "pending") banner.innerHTML = `<div class="banner warn"><strong>Awaiting verification.</strong> An administrator will check your documents in person. Until then you can view your dashboard, but you cannot take part in requests.</div>`;
  else banner.innerHTML = `<div class="banner bad"><strong>Verification: ${esc(label(v.status))}.</strong> ${esc(v.remarks || "")}</div>`;
  return me;
}

function renderTabs() {
  tabsEl.innerHTML = mod.tabs.map((t) =>
    `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === current?.id}">${esc(t.label)}</button>`).join("");
  tabsEl.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
}

async function route() {
  const hash = location.hash.slice(1);
  clearInterval(pollTimer);
  const tab = mod.tabs.find((t) => t.id === hash);
  const ctx = { me, refreshMe: loadMe, go: (h) => { location.hash = h; } };
  if (!tab && hash && mod.route) {
    const handled = await mod.route(hash, view, ctx);
    if (handled) { current = mod.tabs.find((t) => t.id === handled) || current; renderTabs(); return; }
  }
  current = tab || mod.tabs[0];
  renderTabs();
  view.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    await current.render(view, ctx);
  } catch (e) {
    view.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`;
  }
  if (current.poll) pollTimer = setInterval(() => current.render(view, ctx).catch(() => {}), 30000);
}

// ----- Notifications -----
const panel = document.getElementById("notif-panel");
async function pollNotifications() {
  try {
    const n = await api("/notifications");
    const c = document.getElementById("bell-count");
    c.textContent = n.unread;
    c.classList.toggle("hidden", !n.unread);
    panel.innerHTML = `<div class="card-head" style="padding:.6rem .9rem;margin:0"><strong>Notifications</strong>
        <button class="btn sm" id="read-all">Mark all read</button></div>` +
      (n.items.length ? n.items.map((i) => `
        <div class="item ${i.is_read ? "" : "unread"}">
          <a href="${esc(i.link || "#")}" data-close><strong>${esc(i.title)}</strong></a>
          ${i.body ? `<div class="small">${esc(i.body)}</div>` : ""}
          <div class="small muted">${ago(i.created_at)}</div>
        </div>`).join("") : `<p class="empty">No notifications yet.</p>`);
    panel.querySelector("#read-all").onclick = async () => { await api("/notifications/read-all", { method: "POST" }); pollNotifications(); };
    panel.querySelectorAll("[data-close]").forEach((a) => a.addEventListener("click", () => panel.classList.add("hidden")));
  } catch { /* offline; try again later */ }
}
document.getElementById("bell").addEventListener("click", () => {
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) pollNotifications();
});
document.getElementById("logout").addEventListener("click", () => { auth.clear(); location.href = "/index.html"; });

// ----- Boot -----
try {
  await loadMe();
  mod = (await import(`./roles/${me.role}.js`)).default;
  window.addEventListener("hashchange", route);
  await route();
  pollNotifications();
  setInterval(pollNotifications, 15000);
} catch (e) {
  view.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`;
}
