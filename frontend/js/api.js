// Shared helpers: API calls, auth token, HTML escaping, formatting, toasts.

const TOKEN_KEY = "lifelink_token";

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage blocked */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    auth.clear();
    if (!location.pathname.endsWith("index.html") && location.pathname !== "/") location.href = "/index.html";
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(errorText(data) || `Request failed (${res.status})`);
  return data;
}

function errorText(data) {
  if (!data) return "";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) {
    return data.detail.map((e) => {
      const field = (e.loc || []).filter((x) => x !== "body").join(".");
      return `${field ? field + ": " : ""}${String(e.msg).replace(/^Value error, /, "")}`;
    }).join("; ");
  }
  return "";
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
export const clock = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const label = (s) => String(s ?? "").replace(/_/g, " ");

const GOOD = ["approved", "fulfilled", "delivered", "collected", "closed", "accepted", "confirmed_available", "in_stock", "confirmed", "ready"];
const BAD = ["rejected", "cancelled", "declined", "failed", "delivery_failed", "unavailable", "not_available", "out_of_stock", "critical", "expired"];
const WARN = ["pending", "needs_correction", "needs_clarification", "low", "high", "unassigned", "notified", "offered", "requested"];

export function badge(status) {
  const cls = GOOD.includes(status) ? "ok" : BAD.includes(status) ? "bad" : WARN.includes(status) ? "warn" : "info";
  return `<span class="badge ${cls}">${esc(label(status))}</span>`;
}

export function toast(msg, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), error ? 5000 : 3000);
}

// Wrap an async handler: disables the button while running, shows errors as toasts.
export function action(btn, fn) {
  return async (ev) => {
    ev?.preventDefault?.();
    if (btn) btn.disabled = true;
    try { await fn(ev); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
  };
}

export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) if (!(v instanceof File)) out[k] = v;
  return out;
}

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
export const groupOptions = (selected = "") =>
  BLOOD_GROUPS.map((g) => `<option ${g === selected ? "selected" : ""}>${g}</option>`).join("");
