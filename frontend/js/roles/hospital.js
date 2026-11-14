import { renderRequestDetail, renderRequestForm, renderRequestList } from "../blood.js";

export default {
  tabs: [
    { id: "hosp-requests", label: "Blood requests", render: (el) => renderRequestList(el), poll: true },
    { id: "hosp-new", label: "New request", render: (el, ctx) => renderRequestForm(el, ctx, {
        defaults: { lat: ctx.me.profile?.lat, lng: ctx.me.profile?.lng, city: ctx.me.profile?.city } }) },
  ],
  async route(hash, el) {
    const m = hash.match(/^req-(\d+)$/);
    if (!m) return false;
    await renderRequestDetail(el, Number(m[1]));
    return "hosp-requests";
  },
};
