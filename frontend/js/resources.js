// Resources page: data-driven cards with search, category filters and reveal animations.

const scholar = (title) => `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${title}"`)}`;

const ICONS = {
  oss: '<svg viewBox="0 0 24 24"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>',
  paper: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  data: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  guide: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  docs: '<svg viewBox="0 0 24 24"><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/></svg>',
};

const CATEGORIES = [
  {
    id: 'oss', title: 'Open source', blurb: 'The projects LifeLink is built on, plus open health and crisis platforms worth studying.', accent: 'var(--c-oss)',
    items: [
      { t: 'FastAPI', tag: 'Backend', d: 'Modern, high-performance Python web framework with automatic OpenAPI docs.', why: 'Powers every LifeLink API endpoint.', url: 'https://github.com/fastapi/fastapi' },
      { t: 'SQLModel', tag: 'ORM', d: 'SQL databases in Python, designed for simplicity, compatibility and robustness.', why: 'Our models for donors, requests and deliveries.', url: 'https://github.com/fastapi/sqlmodel' },
      { t: 'Leaflet', tag: 'Maps', d: 'The leading open-source JavaScript library for mobile-friendly interactive maps.', why: 'Draws the "Near you" and tracking maps.', url: 'https://github.com/Leaflet/Leaflet' },
      { t: 'OSRM', tag: 'Routing', d: 'Open Source Routing Machine: high-performance routing engine for OpenStreetMap road networks.', why: 'Estimates volunteer delivery times.', url: 'https://github.com/Project-OSRM/osrm-backend' },
      { t: 'Nominatim', tag: 'Geocoding', d: 'Open-source geocoding with OpenStreetMap data: turn addresses into coordinates and back.', url: 'https://github.com/osm-search/Nominatim' },
      { t: 'HAPI FHIR', tag: 'Interoperability', d: 'Complete Java implementation of the HL7 FHIR standard for healthcare data exchange.', url: 'https://github.com/hapifhir/hapi-fhir' },
      { t: 'OpenMRS', tag: 'Health records', d: 'Open-source medical record system platform used across low-resource settings worldwide.', url: 'https://github.com/openmrs/openmrs-core' },
      { t: 'DHIS2', tag: 'Health data', d: 'Open-source health information platform used by national health systems in 70+ countries.', url: 'https://github.com/dhis2' },
      { t: 'Ushahidi', tag: 'Crisis mapping', d: 'Crowdsourced crisis information and mapping platform born out of emergency response.', url: 'https://github.com/ushahidi/platform' },
      { t: 'Sahana Eden', tag: 'Disaster mgmt', d: 'Open-source humanitarian platform for disaster preparedness and response.', url: 'https://github.com/sahana/eden' },
    ],
  },
  {
    id: 'paper', title: 'Research papers', blurb: 'Foundational and applied work on matching, routing and blood supply chains.', accent: 'var(--c-paper)',
    items: [
      { t: 'A note on two problems in connexion with graphs', meta: 'E. W. Dijkstra · Numerische Mathematik, 1959', d: 'The classic shortest-path algorithm at the heart of nearly every routing engine.', why: 'Underpins route-based ETA estimates.', url: 'https://doi.org/10.1007/BF01386390' },
      { t: 'Contraction Hierarchies: Faster and Simpler Hierarchical Routing in Road Networks', meta: 'Geisberger, Sanders, Schultes, Delling · WEA, 2008', d: 'Preprocessing technique that makes continent-scale shortest-path queries take milliseconds.', why: 'The speed-up OSRM uses.', url: scholar('Contraction Hierarchies: Faster and Simpler Hierarchical Routing in Road Networks') },
      { t: 'The Hungarian method for the assignment problem', meta: 'H. W. Kuhn · Naval Research Logistics Quarterly, 1955', d: 'Optimal one-to-one assignment of agents to tasks at minimum total cost.', why: 'Theory behind volunteer-to-delivery assignment.', url: 'https://doi.org/10.1002/nav.3800020109' },
      { t: 'College Admissions and the Stability of Marriage', meta: 'D. Gale, L. S. Shapley · American Mathematical Monthly, 1962', d: 'Introduces stable matching, the basis of two-sided matching markets.', why: 'A lens on donor ↔ request matching.', url: 'https://www.jstor.org/stable/2312726' },
      { t: 'The Truck Dispatching Problem', meta: 'G. B. Dantzig, J. H. Ramser · Management Science, 1959', d: 'The paper that defined the Vehicle Routing Problem.', url: 'https://doi.org/10.1287/mnsc.6.1.80' },
      { t: 'Supply chain management of blood products: A literature review', meta: 'J. Beliën, H. Forcé · European Journal of Operational Research, 2012', d: 'Survey of operations research on collecting, storing and distributing blood.', url: scholar('Supply chain management of blood products: A literature review') },
      { t: 'A structured review of quantitative models in the blood supply chain', meta: 'Osorio, Brailsford, Smith · Int. Journal of Production Research, 2015', d: 'Taxonomic framework for decision-making models across the blood supply chain.', url: scholar('A structured review of quantitative models in the blood supply chain') },
      { t: 'The Vehicle Routing Problem with Occasional Drivers', meta: 'Archetti, Savelsbergh, Speranza · EJOR, 2016', d: 'Routing when ordinary people make deliveries alongside a fleet: crowdsourced logistics.', why: 'Closest model to volunteer delivery.', url: scholar('The Vehicle Routing Problem with Occasional Drivers') },
      { t: 'Virtues of the Haversine', meta: 'R. W. Sinnott · Sky and Telescope, 1984', d: 'The note that popularised the haversine formula for great-circle distance.', why: 'How LifeLink measures "nearby".', url: scholar('Virtues of the Haversine') },
    ],
  },
  {
    id: 'data', title: 'Open data', blurb: 'Public datasets and registries for maps, blood banks and medicines.', accent: 'var(--c-data)',
    items: [
      { t: 'OpenStreetMap', tag: 'Geo', d: 'The free, editable map of the world, built by a community of mappers.', why: 'Our map tiles and road network.', url: 'https://www.openstreetmap.org' },
      { t: 'e-RaktKosh', tag: 'Blood banks · India', d: 'National blood bank management portal with blood stock availability across India.', url: 'https://eraktkosh.mohfw.gov.in' },
      { t: 'Open Government Data India', tag: 'Gov data', d: 'Datasets from Indian ministries, including hospital and health facility directories.', url: 'https://data.gov.in' },
      { t: 'WHO Global Health Observatory', tag: 'Global health', d: 'WHO\'s gateway to health statistics for its 194 member states.', url: 'https://www.who.int/data/gho' },
      { t: 'openFDA', tag: 'Medicines', d: 'Open APIs for drug labels, adverse events and recalls from the US FDA.', url: 'https://open.fda.gov' },
      { t: 'RxNorm', tag: 'Drug names', d: 'Normalized names for clinical drugs, linking many drug vocabularies.', url: 'https://www.nlm.nih.gov/research/umls/rxnorm/' },
    ],
  },
  {
    id: 'guide', title: 'Guidelines & organisations', blurb: 'Authoritative sources on blood safety, donation and emergency care.', accent: 'var(--c-guide)',
    items: [
      { t: 'WHO: Blood safety and availability', tag: 'Fact sheet', d: 'Key facts on global blood supply, safe donation and transfusion.', url: 'https://www.who.int/news-room/fact-sheets/detail/blood-safety-and-availability' },
      { t: 'National Blood Transfusion Council', tag: 'India', d: 'Policy, guidelines and standards for blood transfusion services in India.', url: 'https://nbtc.naco.gov.in' },
      { t: 'Indian Red Cross Society', tag: 'Humanitarian', d: 'Blood banks, disaster response and first-aid training across India.', url: 'https://www.indianredcross.org' },
      { t: 'Pradhan Mantri Bhartiya Janaushadhi Pariyojana', tag: 'Medicines', d: 'Affordable generic medicines through Jan Aushadhi Kendras nationwide.', url: 'https://janaushadhi.gov.in' },
      { t: 'CDSCO', tag: 'Regulator', d: 'India\'s national regulator for drugs, medical devices and blood banks.', url: 'https://cdsco.gov.in' },
      { t: 'American Red Cross: Blood', tag: 'Donor education', d: 'Eligibility, blood types and what to expect when donating.', url: 'https://www.redcrossblood.org' },
    ],
  },
  {
    id: 'docs', title: 'Developer docs', blurb: 'Documentation for the stack, so you can extend LifeLink yourself.', accent: 'var(--c-docs)',
    items: [
      { t: 'FastAPI documentation', tag: 'Tutorial', d: 'Step-by-step user guide, from first endpoint to security and deployment.', url: 'https://fastapi.tiangolo.com' },
      { t: 'SQLModel documentation', tag: 'Tutorial', d: 'Learn to model, query and relate data with SQLModel.', url: 'https://sqlmodel.tiangolo.com' },
      { t: 'Leaflet API reference', tag: 'Reference', d: 'Every map, layer, marker and event in Leaflet.', url: 'https://leafletjs.com/reference.html' },
      { t: 'OSRM HTTP API', tag: 'Reference', d: 'Route, table, nearest and trip services of the OSRM server.', url: 'https://project-osrm.org/docs/v5.24.0/api/' },
      { t: 'HL7 FHIR specification', tag: 'Standard', d: 'The modern standard for exchanging healthcare information electronically.', url: 'https://hl7.org/fhir/' },
      { t: 'MDN Web Docs', tag: 'Web platform', d: 'The reference for HTML, CSS and JavaScript.', url: 'https://developer.mozilla.org' },
    ],
  },
];

const ARROW = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

const state = { cat: 'all', q: '' };
const $sections = document.getElementById('res-sections');
const $chips = document.getElementById('res-chips');
const $q = document.getElementById('res-q');
const $empty = document.getElementById('res-empty');

function card(item, cat) {
  const isScholar = item.url.includes('scholar.google');
  return `
    <a class="rcard" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" style="--accent:${cat.accent}">
      <div class="rc-top"><span class="rc-tag">${esc(item.tag || cat.title)}</span><span class="rc-arrow">${ARROW}</span></div>
      <h3>${esc(item.t)}</h3>
      ${item.meta ? `<p class="rc-meta">${esc(item.meta)}</p>` : ''}
      <p class="desc">${esc(item.d)}</p>
      ${item.why ? `<div class="rc-why"><b>In LifeLink:</b> ${esc(item.why)}</div>` : ''}
      <div class="rc-foot"><span class="host">${isScholar ? 'Find on Google Scholar' : esc(host(item.url))}</span></div>
    </a>`;
}

function matches(item, q) {
  if (!q) return true;
  return [item.t, item.d, item.meta, item.tag, item.why].filter(Boolean).join(' ').toLowerCase().includes(q);
}

function render() {
  const q = state.q.trim().toLowerCase();
  let total = 0;
  $sections.innerHTML = CATEGORIES
    .filter((c) => state.cat === 'all' || c.id === state.cat)
    .map((c) => {
      const items = c.items.filter((i) => matches(i, q));
      total += items.length;
      if (!items.length) return '';
      return `
        <section class="res-section" style="--accent:${c.accent}">
          <div class="sec-head">
            <div class="sec-icon">${ICONS[c.id]}</div>
            <div><h2>${esc(c.title)}</h2><p>${esc(c.blurb)}</p></div>
          </div>
          <div class="cards">${items.map((i) => card(i, c)).join('')}</div>
        </section>`;
    }).join('');
  $empty.classList.toggle('hidden', total > 0);
  observeCards();
}

function renderChips() {
  const all = CATEGORIES.reduce((n, c) => n + c.items.length, 0);
  const chips = [{ id: 'all', title: 'All', n: all }, ...CATEGORIES.map((c) => ({ id: c.id, title: c.title, n: c.items.length }))];
  $chips.innerHTML = chips.map((c) =>
    `<button class="chip" role="tab" data-cat="${c.id}" aria-selected="${c.id === state.cat}">${esc(c.title)}<span class="ct">${c.n}</span></button>`
  ).join('');
}

function renderStats() {
  const stats = CATEGORIES.slice(0, 4).map((c) => ({ n: c.items.length, l: c.title }));
  document.getElementById('res-stats').innerHTML = stats.map((s) =>
    `<div class="stat-pill"><div class="n" data-to="${s.n}">0</div><div class="l">${esc(s.l)}</div></div>`
  ).join('');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.stat-pill .n').forEach((el) => {
    const to = +el.dataset.to;
    if (reduce) { el.textContent = to; return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 1200);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.08 })
  : null;

function observeCards() {
  document.querySelectorAll('.rcard').forEach((el, i) => {
    el.style.transitionDelay = `${(i % 6) * 40}ms`;
    if (io) io.observe(el); else el.classList.add('in');
  });
}

// Spotlight that follows the cursor inside a card
$sections.addEventListener('pointermove', (e) => {
  const c = e.target.closest('.rcard');
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', `${e.clientX - r.left}px`);
  c.style.setProperty('--my', `${e.clientY - r.top}px`);
});
// Clear the stagger delay after reveal so hover feels instant
$sections.addEventListener('transitionend', (e) => {
  if (e.target.classList?.contains('rcard')) e.target.style.transitionDelay = '';
});

$chips.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.cat = b.dataset.cat;
  renderChips();
  render();
});
$q.addEventListener('input', () => { state.q = $q.value; render(); });

const hashCat = location.hash.slice(1);
if (CATEGORIES.some((c) => c.id === hashCat)) state.cat = hashCat;

renderStats();
renderChips();
render();
