import { action, api, auth, badge, esc, formData, groupOptions, toast, when } from "./api.js";
import { dot, facilityPopup, INDORE, legend, locationPicker, makeMap } from "./map.js";

if (auth.token) {
  api("/auth/me").then(() => (location.href = "/dashboard.html")).catch(() => auth.clear());
}

// ----- Login / register tabs -----
const loginForm = document.getElementById("login-form");
const regForm = document.getElementById("register-form");
let picker = null;

function showTab(which) {
  document.querySelectorAll("[data-auth-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.authTab === which)));
  loginForm.classList.toggle("hidden", which !== "login");
  regForm.classList.toggle("hidden", which !== "register");
  if (which === "register") updateRoleFields();
}
document.querySelectorAll("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.authTab)));

const DEMO = [
  ["Admin", "admin@lifelink.demo"], ["Patient", "patient@lifelink.demo"], ["Hospital", "hospital@lifelink.demo"],
  ["Donor", "donor1@lifelink.demo"], ["Blood bank", "bloodbank1@lifelink.demo"], ["Pharmacy", "pharmacy1@lifelink.demo"],
  ["Volunteer", "volunteer1@lifelink.demo"],
];
document.getElementById("demo-accounts").innerHTML = DEMO.map(([r, e]) =>
  `<div><a href="#" data-demo="${e}">${r}</a>: ${e}</div>`).join("");
document.querySelectorAll("[data-demo]").forEach((a) => a.addEventListener("click", (ev) => {
  ev.preventDefault();
  loginForm.email.value = a.dataset.demo;
  loginForm.password.value = "demo1234";
}));

loginForm.addEventListener("submit", action(loginForm.querySelector("button"), async () => {
  const res = await api("/auth/login", { method: "POST", body: formData(loginForm) });
  auth.set(res.token);
  location.href = "/dashboard.html";
}));

document.getElementById("r-bg").innerHTML = groupOptions();
const roleSel = document.getElementById("r-role");
function updateRoleFields() {
  const role = roleSel.value;
  regForm.querySelectorAll("[data-for]").forEach((el) => {
    const on = el.dataset.for.split(" ").includes(role);
    el.classList.toggle("hidden", !on);
    el.querySelectorAll("input,select").forEach((i) => {
      i.disabled = !on;
      if (["pincode", "address", "license_no", "city"].includes(i.name)) i.required = on;
    });
  });
  const facility = ["hospital", "bloodbank", "pharmacy"].includes(role);
  document.getElementById("r-name-label").textContent = facility ? "Facility name" : "Full name";
  if (role !== "patient" && !picker) picker = locationPicker(document.getElementById("r-loc"));
  if (picker) setTimeout(() => picker.map.invalidateSize(), 50);
}
roleSel.addEventListener("change", updateRoleFields);

regForm.addEventListener("submit", action(regForm.querySelector("button[class~=primary]"), async () => {
  const body = formData(regForm);
  for (const k of Object.keys(body)) if (body[k] === "") delete body[k];
  if (body.role !== "patient") {
    if (!picker?.value.lat) throw new Error("Please set your location on the map");
    Object.assign(body, { lat: picker.value.lat, lng: picker.value.lng });
  }
  if (body.service_radius_km) body.service_radius_km = Number(body.service_radius_km);
  const res = await api("/auth/register", { method: "POST", body });
  auth.set(res.token);
  location.href = "/dashboard.html";
}));

document.getElementById("go-login").addEventListener("click", () => showTab("login"));

// ----- Public map -----
const map = makeMap(document.getElementById("public-map"));
document.getElementById("public-legend").innerHTML = legend(["bloodbank", "pharmacy", "camp"]);
const bounds = [];
api("/map/facilities?kinds=bloodbank,pharmacy").then((list) => {
  for (const f of list) { dot(f.kind, f.lat, f.lng, facilityPopup(f)).addTo(map); bounds.push([f.lat, f.lng]); }
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
}).catch(() => {});

api("/camps").then((camps) => {
  const ul = document.getElementById("camps");
  ul.innerHTML = camps.length ? camps.map((c) => `
    <li><strong>${esc(c.title)}</strong><br>
      <span class="small">${esc(when(c.starts_at))} – ${esc(new Date(c.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span><br>
      <span class="small muted">${esc(c.address)} · ${esc(c.organizer)}</span></li>`).join("")
    : `<li class="empty">No upcoming camps listed.</li>`;
  for (const c of camps) dot("camp", c.lat, c.lng, `<strong>${esc(c.title)}</strong><br>${esc(when(c.starts_at))}<br>${esc(c.address)}`).addTo(map);
}).catch(() => {});

// ----- Medicine search -----
const searchForm = document.getElementById("med-search");
searchForm.addEventListener("submit", action(searchForm.querySelector("button"), async () => {
  const q = searchForm.q.value.trim();
  const center = map.getCenter() || { lat: INDORE[0], lng: INDORE[1] };
  const res = await api(`/pharmacies/search?q=${encodeURIComponent(q)}&lat=${center.lat}&lng=${center.lng}&radius=30`);
  const out = document.getElementById("med-results");
  if (!res.length) { out.innerHTML = `<p class="empty">No participating pharmacy lists “${esc(q)}”.</p>`; return; }
  out.innerHTML = `<ul class="list">${res.map((p) => `
    <li><strong>${esc(p.name)}</strong> <span class="small muted">${p.distance_km} km · ${esc(p.contact)}</span>
      <div class="small">${p.items.map((i) => `${esc(i.name)} ${esc(i.strength)} ${badge(i.status)}${i.requires_prescription ? ' <span class="badge info">Rx</span>' : ""}`).join("<br>")}</div>
    </li>`).join("")}</ul>`;
  toast(`${res.length} pharmacies found`);
}));
