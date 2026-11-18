// Resources page: renders the reference lists, a contents sidebar and a simple filter.

const scholar = (title) => `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${title}"`)}`;

const SECTIONS = [
  {
    id: 'software', title: 'Open-source software',
    intro: 'Libraries LifeLink is built on, and open health or crisis-response platforms we looked at for ideas.',
    items: [
      { t: 'FastAPI', url: 'https://github.com/fastapi/fastapi', d: 'Python web framework with automatic OpenAPI docs.', used: 'All backend API endpoints.' },
      { t: 'SQLModel', url: 'https://github.com/fastapi/sqlmodel', d: 'SQL databases in Python, built on SQLAlchemy and Pydantic.', used: 'Database models (donors, requests, deliveries).' },
      { t: 'Leaflet', url: 'https://github.com/Leaflet/Leaflet', d: 'JavaScript library for interactive maps.', used: 'The "Near you" map and the location picker.' },
      { t: 'OSRM', url: 'https://github.com/Project-OSRM/osrm-backend', d: 'Routing engine for OpenStreetMap road networks.', used: 'Delivery time estimates.' },
      { t: 'Nominatim', url: 'https://github.com/osm-search/Nominatim', d: 'Geocoding (address ↔ coordinates) using OpenStreetMap data.' },
      { t: 'HAPI FHIR', url: 'https://github.com/hapifhir/hapi-fhir', d: 'Java implementation of the HL7 FHIR standard for health data exchange.' },
      { t: 'OpenMRS', url: 'https://github.com/openmrs/openmrs-core', d: 'Open-source medical record system used in many low-resource settings.' },
      { t: 'DHIS2', url: 'https://github.com/dhis2', d: 'Health information platform used by national health ministries.' },
      { t: 'Ushahidi', url: 'https://github.com/ushahidi/platform', d: 'Crowdsourced crisis reporting and mapping.' },
      { t: 'Sahana Eden', url: 'https://github.com/sahana/eden', d: 'Humanitarian platform for disaster preparedness and response.' },
    ],
  },
  {
    id: 'papers', title: 'Research papers', type: 'paper',
    intro: 'Background reading on shortest paths, assignment and matching, and blood supply chains.',
    items: [
      { a: 'Dijkstra, E. W.', y: 1959, t: 'A note on two problems in connexion with graphs', v: 'Numerische Mathematik, 1, 269–271', url: 'https://doi.org/10.1007/BF01386390', used: 'Shortest-path basis of route-based ETAs.' },
      { a: 'Geisberger, R., Sanders, P., Schultes, D., & Delling, D.', y: 2008, t: 'Contraction hierarchies: Faster and simpler hierarchical routing in road networks', v: 'Experimental Algorithms (WEA 2008), LNCS 5038', scholar: true, used: 'The speed-up technique OSRM uses.' },
      { a: 'Kuhn, H. W.', y: 1955, t: 'The Hungarian method for the assignment problem', v: 'Naval Research Logistics Quarterly, 2, 83–97', url: 'https://doi.org/10.1002/nav.3800020109', used: 'Background for assigning volunteers to deliveries.' },
      { a: 'Gale, D., & Shapley, L. S.', y: 1962, t: 'College admissions and the stability of marriage', v: 'The American Mathematical Monthly, 69(1), 9–15', url: 'https://www.jstor.org/stable/2312726' },
      { a: 'Dantzig, G. B., & Ramser, J. H.', y: 1959, t: 'The truck dispatching problem', v: 'Management Science, 6(1), 80–91', url: 'https://doi.org/10.1287/mnsc.6.1.80' },
      { a: 'Archetti, C., Savelsbergh, M., & Speranza, M. G.', y: 2016, t: 'The vehicle routing problem with occasional drivers', v: 'European Journal of Operational Research', scholar: true },
      { a: 'Beliën, J., & Forcé, H.', y: 2012, t: 'Supply chain management of blood products: A literature review', v: 'European Journal of Operational Research', scholar: true },
      { a: 'Osorio, A. F., Brailsford, S. C., & Smith, H. K.', y: 2015, t: 'A structured review of quantitative models in the blood supply chain: a taxonomic framework for decision-making', v: 'International Journal of Production Research', scholar: true },
      { a: 'Sinnott, R. W.', y: 1984, t: 'Virtues of the haversine', v: 'Sky and Telescope, 68(2), 159', scholar: true, used: 'Distance formula behind "nearby" results.' },
    ],
  },
  {
    id: 'data', title: 'Open data',
    intro: 'Public datasets and registries for maps, blood banks and medicines.',
    items: [
      { t: 'OpenStreetMap', url: 'https://www.openstreetmap.org', d: 'Community-built map of the world.', used: 'Map tiles and road data.' },
      { t: 'e-RaktKosh', url: 'https://eraktkosh.mohfw.gov.in', d: 'Government of India blood bank portal with stock availability.' },
      { t: 'Open Government Data (OGD) Platform India', url: 'https://data.gov.in', d: 'Government datasets, including hospital and health facility directories.' },
      { t: 'WHO Global Health Observatory', url: 'https://www.who.int/data/gho', d: 'Health statistics for WHO member states.' },
      { t: 'openFDA', url: 'https://open.fda.gov', d: 'APIs for US drug labels, adverse events and recalls.' },
      { t: 'RxNorm', url: 'https://www.nlm.nih.gov/research/umls/rxnorm/', d: 'Normalised names for clinical drugs (US National Library of Medicine).' },
    ],
  },
  {
    id: 'guidelines', title: 'Guidelines and organisations',
    intro: 'Official sources on blood donation, transfusion and medicines.',
    items: [
      { t: 'WHO: Blood safety and availability', url: 'https://www.who.int/news-room/fact-sheets/detail/blood-safety-and-availability', d: 'Fact sheet on global blood supply and safe transfusion.' },
      { t: 'National Blood Transfusion Council (NBTC)', url: 'https://nbtc.naco.gov.in', d: 'Policy and guidelines for blood transfusion services in India.' },
      { t: 'Indian Red Cross Society', url: 'https://www.indianredcross.org', d: 'Blood banks, disaster response and first-aid training.' },
      { t: 'Jan Aushadhi (PMBJP)', url: 'https://janaushadhi.gov.in', d: 'Government scheme for affordable generic medicines.' },
      { t: 'CDSCO', url: 'https://cdsco.gov.in', d: 'India\'s regulator for drugs, medical devices and blood banks.' },
      { t: 'American Red Cross: Blood donation', url: 'https://www.redcrossblood.org', d: 'Donor eligibility, blood types and what to expect.' },
    ],
  },
  {
    id: 'docs', title: 'Documentation',
    intro: 'Reference docs for the stack, if you want to work on the code.',
    items: [
      { t: 'FastAPI docs', url: 'https://fastapi.tiangolo.com' },
      { t: 'SQLModel docs', url: 'https://sqlmodel.tiangolo.com' },
      { t: 'Leaflet API reference', url: 'https://leafletjs.com/reference.html' },
      { t: 'OSRM HTTP API', url: 'https://project-osrm.org/docs/v5.24.0/api/' },
      { t: 'HL7 FHIR specification', url: 'https://hl7.org/fhir/' },
      { t: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
    ],
  },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const ext = 'target="_blank" rel="noopener noreferrer"';

const $sections = document.getElementById('res-sections');
const $toc = document.getElementById('res-toc');
const $q = document.getElementById('res-q');
const $empty = document.getElementById('res-empty');

const usedLine = (i) => (i.used ? `<p class="res-used"><strong>Used for:</strong> ${esc(i.used)}</p>` : '');

function linkItem(i) {
  return `<li>
    <div class="res-item-head"><a href="${esc(i.url)}" ${ext}>${esc(i.t)}</a><span class="host">${esc(host(i.url))}</span></div>
    ${i.d ? `<p>${esc(i.d)}</p>` : ''}
    ${usedLine(i)}
  </li>`;
}

function paperItem(p) {
  const href = p.scholar ? scholar(p.t) : p.url;
  const label = p.scholar ? 'Google Scholar' : p.url.includes('doi.org') ? 'DOI' : host(p.url);
  return `<li>
    <div class="cite">${esc(p.a)} (${p.y}). <span class="title">${esc(p.t)}</span>. <span class="venue">${esc(p.v)}</span>.</div>
    ${usedLine(p)}
    <div class="cite-links"><a href="${esc(href)}" ${ext}>${esc(label)} ↗</a></div>
  </li>`;
}

const text = (i) => [i.t, i.d, i.a, i.v, i.used].filter(Boolean).join(' ').toLowerCase();

function render() {
  const q = $q.value.trim().toLowerCase();
  let total = 0;
  const visible = [];
  $sections.innerHTML = SECTIONS.map((s) => {
    const items = s.items.filter((i) => !q || text(i).includes(q));
    if (!items.length) return '';
    total += items.length;
    visible.push({ ...s, n: items.length });
    const row = s.type === 'paper' ? paperItem : linkItem;
    return `<section class="res-sec" id="${s.id}">
      <h2>${esc(s.title)}</h2>
      <p class="intro">${esc(s.intro)}</p>
      <ul class="res-list">${items.map(row).join('')}</ul>
    </section>`;
  }).join('');
  $toc.innerHTML = visible.map((s) => `<li><a href="#${s.id}">${esc(s.title)} <span>${s.n}</span></a></li>`).join('');
  $empty.classList.toggle('hidden', total > 0);
  watchSections();
}

// Highlight the section currently in view in the sidebar
let io;
function watchSections() {
  if (!('IntersectionObserver' in window)) return;
  io?.disconnect();
  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      $toc.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
    });
  }, { rootMargin: '-80px 0px -65% 0px' });
  $sections.querySelectorAll('.res-sec').forEach((s) => io.observe(s));
}

$q.addEventListener('input', render);
render();
