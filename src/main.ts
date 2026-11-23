import * as L from 'leaflet';
import { HeatLayer } from 'leaflet.heat';
import 'leaflet/dist/leaflet.css';
import './style.css';

import { LOCALITIES, type Locality } from './data/localities';
import { OSM_CATEGORIES, OSM_MIN_ZOOM, OsmInterestLayer, type OsmStatus } from './osm';
import { featureInfo, sigeomWms } from './sigeom';
import { esc, linkify } from './util';

// ───────────────────────── Карта и подложки ─────────────────────────

const map = L.map('map', { zoomControl: false, preferCanvas: true, worldCopyJump: true }).setView([47.2, -71.5], 6);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

const basemaps: Record<string, L.TileLayer> = {
  'Рельеф (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, subdomains: 'abc',
    attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
  }),
  'Спутник (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  }),
  'Улицы (OSM)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors',
  }),
};
basemaps['Рельеф (OpenTopoMap)'].addTo(map);
L.control.layers(basemaps, undefined, { position: 'topright' }).addTo(map);

// ───────────────────────── Растровые слои ─────────────────────────

const overlays: Record<string, L.Layer> = {
  prospective: sigeomWms('SGM_EN:Prospective_zones', { opacity: 0.55 }),
  geology: sigeomWms('SGM_EN:General_geology', { opacity: 0.5 }),
  faults: sigeomWms('SGM_EN:General_faults', { opacity: 0.8 }),
  outcrops: sigeomWms('SGM_EN:Compilation_outcrops_CO,SGM_EN:Geofiche_outcrops_GO', { minZoom: 10 }),
  gravel: sigeomWms('SGM_EN:Sand_gravel_deposits', { opacity: 0.6 }),
  macrostrat: L.tileLayer('https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png', {
    opacity: 0.55, maxZoom: 18, attribution: 'Geology © Macrostrat (CC-BY 4.0)',
  }),
};

// ───────────────────────── Проявления SIGÉOM ─────────────────────────

interface DepositProps {
  kind: 'metal' | 'nonmetal';
  name?: string;
  status?: string;
  statusCode?: string;
  substance?: string;
  element?: string;
  rocks?: string;
  discovery?: string;
  year?: number;
  url?: string;
}
type Deposit = { lat: number; lon: number; p: DepositProps };

const STATUS_RU: Record<string, string> = {
  'Active mine': 'Действующий рудник',
  'Closed mine': 'Закрытый рудник',
  'Worked deposit': 'Месторождение с выработками',
  'Deposit with estimated tonnage': 'Месторождение с оценкой запасов',
  'Showing, no work': 'Проявление (без работ)',
};
const STATUS_WEIGHT: Record<string, number> = {
  'Active mine': 1, 'Closed mine': 0.9, 'Deposit with estimated tonnage': 0.85,
  'Worked deposit': 0.6, 'Showing, no work': 0.35,
};
const SUBSTANCE_RU: Record<string, string> = {
  Gold: 'Золото', Silver: 'Серебро', Copper: 'Медь', Zinc: 'Цинк', Lead: 'Свинец', Iron: 'Железо',
  Nickel: 'Никель', Cobalt: 'Кобальт', Uranium: 'Уран', Thorium: 'Торий', Molybdenum: 'Молибден',
  'Rare earth elements (REE)': 'Редкие земли (РЗЭ)', Lithium: 'Литий', Titanium: 'Титан',
  Chromium: 'Хром', Niobium: 'Ниобий', Tantalum: 'Тантал', Vanadium: 'Ванадий', Tungsten: 'Вольфрам',
  Manganese: 'Марганец', 'Platinum group elements (PGE)': 'Платиноиды', Graphite: 'Графит', Mica: 'Слюда',
  Chrysotile: 'Хризотил', Apatite: 'Апатит', Feldspar: 'Полевой шпат', Quartz: 'Кварц', Talc: 'Тальк',
  Garnet: 'Гранат', Diamond: 'Алмаз', Beryl: 'Берилл', Fluorite: 'Флюорит', Labradorite: 'Лабрадорит',
  Amazonite: 'Амазонит', Spodumene: 'Сподумен', Wollastonite: 'Волластонит', Barytine: 'Барит',
  Sillimanite: 'Силлиманит', Kyanite: 'Кианит', Magnesite: 'Магнезит', Brucite: 'Брусит', Ochre: 'Охра',
  Nepheline: 'Нефелин', Gypsum: 'Гипс', Halite: 'Галит', Calcite: 'Кальцит', Dolomite: 'Доломит',
  Zircon: 'Циркон', Olivine: 'Оливин', Phlogopite: 'Флогопит', Pyrite: 'Пирит', Diopside: 'Диопсид',
};
const ru = (s?: string) => (s ? s.split('; ').map((x) => SUBSTANCE_RU[x] ?? x).join(', ') : '—');

const SUBSTANCE_COLOR: Record<string, string> = {
  Gold: '#f2b705', Silver: '#adb5bd', Copper: '#e8590c', Zinc: '#748ffc', Lead: '#495057',
  Iron: '#a61e4d', Nickel: '#2f9e44', Cobalt: '#1c7ed6', Uranium: '#82c91e', Thorium: '#94d82d',
  'Rare earth elements (REE)': '#d6336c', Lithium: '#cc5de8', Molybdenum: '#868e96', Titanium: '#5c7cfa',
};
function depositColor(p: DepositProps) {
  if (p.kind === 'nonmetal') return '#4dabf7';
  const first = p.substance?.split('; ')[0] ?? '';
  return SUBSTANCE_COLOR[first] ?? '#f59f00';
}

const deposits: Deposit[] = [];
const depositLayers = { metal: L.layerGroup(), nonmetal: L.layerGroup() };
const canvas = L.canvas({ padding: 0.5 });
const heat = new HeatLayer([], {
  radius: 22, blur: 18, maxZoom: 10, minOpacity: 0.25,
  gradient: { 0.2: '#3b5bdb', 0.4: '#12b886', 0.6: '#fab005', 0.8: '#f76707', 1: '#e03131' },
});
let osmHeatPoints: [number, number, number][] = [];

function depositPopup(d: Deposit) {
  const p = d.p;
  return `<div class="pop">
    <div class="pop-kicker" style="color:${depositColor(p)}">${p.kind === 'metal' ? 'Металлическое' : 'Неметаллическое'} · ${esc(STATUS_RU[p.status ?? ''] ?? p.status ?? '')}</div>
    <div class="pop-title">${esc(p.name ?? 'Без названия')}</div>
    <table class="pop-table">
      <tr><th>Вещество</th><td>${esc(ru(p.substance))}</td></tr>
      ${p.rocks ? `<tr><th>Породы</th><td>${esc(p.rocks)}</td></tr>` : ''}
      ${p.year ? `<tr><th>Открыто</th><td>${p.year}</td></tr>` : ''}
      ${p.discovery ? `<tr><th>Как</th><td>${esc(p.discovery)}</td></tr>` : ''}
    </table>
    ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Карточка SIGÉOM ↗</a> · ` : ''}
    <a href="https://www.mindat.org/search.php?search=${encodeURIComponent(p.name ?? '')}" target="_blank" rel="noopener">Mindat ↗</a>
  </div>`;
}

function renderDeposits() {
  const substance = (document.getElementById('substance') as HTMLSelectElement).value;
  const onlyWorked = (document.getElementById('only-worked') as HTMLInputElement).checked;
  depositLayers.metal.clearLayers();
  depositLayers.nonmetal.clearLayers();
  const heatPts: [number, number, number][] = [];
  const counts = { metal: 0, nonmetal: 0 };

  for (const d of deposits) {
    if (substance && !(d.p.substance ?? '').split('; ').includes(substance)) continue;
    if (onlyWorked && d.p.status === 'Showing, no work') continue;
    const weight = STATUS_WEIGHT[d.p.status ?? ''] ?? 0.5;
    const m = L.circleMarker([d.lat, d.lon], {
      renderer: canvas, radius: 3 + weight * 3, weight: 1, color: '#212529',
      fillColor: depositColor(d.p), fillOpacity: 0.9,
    }).bindPopup(() => depositPopup(d), { maxWidth: 340 });
    depositLayers[d.p.kind].addLayer(m);
    counts[d.p.kind]++;
    heatPts.push([d.lat, d.lon, weight]);
  }
  heat.setLatLngs(substance ? heatPts : [...heatPts, ...osmHeatPoints]);
  document.getElementById('cnt-metal')!.textContent = `(${counts.metal})`;
  document.getElementById('cnt-nonmetal')!.textContent = `(${counts.nonmetal})`;
}

async function loadJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

type FC<P> = { features: { geometry: { coordinates: [number, number] }; properties: P }[] };

async function loadDeposits() {
  const [metal, nonmetal, meta] = await Promise.all([
    loadJson<FC<DepositProps>>('metallic.geojson'),
    loadJson<FC<DepositProps>>('nonmetal.geojson'),
    loadJson<{ fetchedAt: string }>('meta.json'),
  ]);
  if (!metal && !nonmetal) {
    alert('Нет данных SIGÉOM. Запустите: npm run fetch-data');
    return;
  }
  for (const fc of [metal, nonmetal]) {
    for (const f of fc?.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      deposits.push({ lat, lon, p: f.properties });
    }
  }
  if (meta) {
    document.getElementById('data-date')!.textContent = `Выгрузка SIGÉOM: ${new Date(meta.fetchedAt).toLocaleDateString('ru-RU')}.`;
  }

  // Список веществ, по убыванию частоты
  const freq = new Map<string, number>();
  for (const d of deposits) for (const s of (d.p.substance ?? '').split('; ')) if (s) freq.set(s, (freq.get(s) ?? 0) + 1);
  const select = document.getElementById('substance') as HTMLSelectElement;
  for (const [s, n] of [...freq].sort((a, b) => b[1] - a[1])) {
    if (n < 3) continue;
    select.add(new Option(`${ru(s)} (${n})`, s));
  }
  renderDeposits();
}

// ───────────────────────── Геосайты, рудники, Mindat ─────────────────────────

const geositesLayer = L.layerGroup();
const minesLayer = L.layerGroup();
const mindatLayer = L.layerGroup();

async function loadExtras() {
  const sites = await loadJson<FC<Record<string, string>>>('geosites.geojson');
  for (const f of sites?.features ?? []) {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;
    L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#2f9e44', fillOpacity: 1 })
      .bindPopup(`<div class="pop"><div class="pop-kicker" style="color:#2f9e44">Выдающийся геосайт · ${esc(p.CATG_SITE_EXCP_EN ?? '')}</div>
        <div class="pop-title">${esc(p.NOM_SITE_EXCP ?? '')}</div><p>${esc(p.COMN_SITE_EXCP ?? '')}</p></div>`, { maxWidth: 360 })
      .addTo(geositesLayer);
  }
  const mines = await loadJson<FC<Record<string, string>>>('mines.geojson');
  for (const f of mines?.features ?? []) {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;
    L.marker([lat, lon], { icon: L.divIcon({ className: 'mine-icon', html: '⚒', iconSize: [20, 20] }) })
      .bindPopup(`<div class="pop"><div class="pop-kicker">${esc(p.SIGN_STAT_MINE_PROJE_ANG ?? '')}</div>
        <div class="pop-title">${esc(p.NOM_MINE_PROJE ?? '')}</div>
        <table class="pop-table"><tr><th>Минерал</th><td>${esc(ru(p.SIGN_MINR_ANG))}</td></tr>
        <tr><th>Компания</th><td>${esc(p.NOM_SOCIE ?? '')}</td></tr></table>
        <p class="warn">Действующее предприятие — частная территория, вход запрещён.</p></div>`)
      .addTo(minesLayer);
  }
}

const ACCESS_RU: Record<Locality['access'], string> = {
  open: 'Свободный доступ (уточняйте у владельцев земли)',
  restricted: 'Ограниченный доступ / нужно разрешение',
  closed: 'Закрыто для сбора',
};
for (const loc of LOCALITIES) {
  L.marker([loc.lat, loc.lon], {
    icon: L.divIcon({ className: `star-icon ${loc.access}`, html: '★', iconSize: [24, 24] }),
    zIndexOffset: 1000,
  })
    .bindPopup(`<div class="pop"><div class="pop-kicker" style="color:#7048e8">Известное место · Mindat</div>
      <div class="pop-title">${esc(loc.name)}</div>
      <table class="pop-table"><tr><th>Минералы</th><td>${esc(loc.minerals)}</td></tr>
      <tr><th>Доступ</th><td>${ACCESS_RU[loc.access]}</td></tr></table>
      <p>${esc(loc.note)}</p>
      <a href="https://www.mindat.org/search.php?search=${encodeURIComponent(loc.mindat)}" target="_blank" rel="noopener">Искать на Mindat ↗</a>
      <p class="hint">Координаты приблизительные.</p></div>`, { maxWidth: 340 })
    .addTo(mindatLayer);
}

// ───────────────────────── OSM-зоны ─────────────────────────

const osmStatusEl = document.getElementById('osm-status')!;
const osmLegend = document.getElementById('osm-legend')!;
const osm = new OsmInterestLayer(
  map,
  (s: OsmStatus) => {
    const text: Record<OsmStatus['state'], string> = {
      idle: '', zoom: `приблизьте до ${OSM_MIN_ZOOM}+`, loading: 'загрузка…',
      ok: `${s.count ?? 0} объектов`, error: 'Overpass недоступен, попробуйте позже',
    };
    osmStatusEl.textContent = text[s.state];
    osmStatusEl.dataset.state = s.state;
    for (const c of OSM_CATEGORIES) {
      const el = document.getElementById(`cnt-osm-${c.id}`);
      if (el) el.textContent = osm?.counts.get(c.id) ? `(${osm.counts.get(c.id)})` : '';
    }
  },
  (pts) => {
    osmHeatPoints = osmHeatPoints.concat(pts);
    renderDeposits();
  },
);
osmLegend.innerHTML = OSM_CATEGORIES.map(
  (c) => `<label class="row" title="${esc(c.hint)}"><input type="checkbox" data-osm="${c.id}" checked />
    <span class="sw" style="background:${c.color}55;border-color:${c.color}"></span> ${c.label} <small id="cnt-osm-${c.id}"></small></label>`,
).join('');
for (const c of OSM_CATEGORIES) osm.groups.get(c.id)!.addTo(map);
osmLegend.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const g = osm.groups.get(input.dataset.osm!);
  if (g) input.checked ? g.addTo(map) : g.remove();
});

// ───────────────────────── Переключатели слоёв ─────────────────────────

const toggles: Record<string, L.Layer> = {
  ...overlays,
  // типы leaflet.heat описаны под Leaflet 2; в рантайме плагин поддерживает 1.9
  heat: heat as unknown as L.Layer,
  metal: depositLayers.metal,
  nonmetal: depositLayers.nonmetal,
  geosites: geositesLayer,
  mines: minesLayer,
  mindat: mindatLayer,
};
// Точки проявлений показываем только с этого масштаба: на мелком масштабе ~10 000 точек
// закрывают тепловую карту, и «где искать» читается именно по ней.
const DEPOSIT_MIN_ZOOM = 8;
const ZOOM_GATED = new Set(['metal', 'nonmetal']);

const layerInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-layer]')];
function syncLayers() {
  for (const input of layerInputs) {
    const id = input.dataset.layer!;
    const visible = input.checked && (!ZOOM_GATED.has(id) || map.getZoom() >= DEPOSIT_MIN_ZOOM);
    const layer = toggles[id];
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    if (!visible && map.hasLayer(layer)) layer.remove();
  }
}
layerInputs.forEach((input) => input.addEventListener('change', syncLayers));
map.on('zoomend', syncLayers);
syncLayers();
document.getElementById('substance')!.addEventListener('change', renderDeposits);
document.getElementById('only-worked')!.addEventListener('change', renderDeposits);

// Тепловая карта уступает место точкам на крупных масштабах.
map.on('zoomend', () => {
  const el = (map.getPane('overlayPane')!.querySelector('canvas.leaflet-heatmap-layer') as HTMLCanvasElement | null);
  if (el) el.style.opacity = map.getZoom() >= 11 ? '0.35' : '0.75';
});

// ───────────────────────── Клик по карте: что под ногами ─────────────────────────

const info = document.getElementById('info')!;
const infoBody = document.getElementById('info-body')!;
document.getElementById('info-close')!.addEventListener('click', () => (info.hidden = true));

const FIELD_RU: Record<string, string> = {
  ZGQ_DESCR_EN: 'Породы', AGE_EN: 'Возраст', ZGQ_CODE_SUPER_STRAT_EN: 'Супергруппа',
  ZGQ_CODE_SUITE_GROUP_STRAT_EN: 'Группа', ZGQ_CODE_ETIQU_STRAT_1_EN: 'Формация',
  ZFA_VAL_IDENT: 'Зона', ZFA_TYPOL_EN: 'Тип ожидаемых месторождений', ZFA_DESCR_ANGLA: 'Описание',
  PRO_NOM_PROJE: 'Проект', BG_ADR_LIEN_URL_EN: 'Бюллетень',
};

map.on('click', async (e: L.LeafletMouseEvent) => {
  info.hidden = false;
  infoBody.innerHTML = `<div class="pop-kicker">${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}</div><p class="hint">Запрашиваю SIGÉOM…</p>`;
  const layers = ['SGM_EN:Prospective_zones', 'SGM_EN:General_geology'];
  try {
    const feats = await featureInfo(map, e.latlng, layers);
    const parts: string[] = [];
    for (const f of feats) {
      const isZone = f.id?.startsWith('Prospective_zones');
      const rows = Object.entries(FIELD_RU)
        .filter(([k]) => typeof f.properties[k] === 'string' && (f.properties[k] as string).trim())
        .map(([k, label]) => `<tr><th>${label}</th><td>${linkify(f.properties[k] as string)}</td></tr>`)
        .join('');
      parts.push(`<h3 class="${isZone ? 'zone' : ''}">${isZone ? '🎯 Перспективная зона MRNF' : '🪨 Коренные породы'}</h3><table class="pop-table">${rows}</table>`);
    }
    if (!parts.length) parts.push('<p class="hint">Нет данных SIGÉOM в этой точке (вне Квебека или без покрытия).</p>');
    infoBody.innerHTML = `<div class="pop-kicker">${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}</div>${parts.join('')}`;
  } catch (err) {
    infoBody.innerHTML = `<p class="warn">Не удалось получить данные: ${esc((err as Error).message)}</p>`;
  }
});

// ───────────────────────── Поиск города (Nominatim) ─────────────────────────

const searchInput = document.getElementById('search') as HTMLInputElement;
const results = document.getElementById('search-results') as HTMLUListElement;
let searchTimer: number | undefined;
let searchAbort: AbortController | undefined;
let searchMarker: L.Marker | undefined;

type Place = { display_name: string; lat: string; lon: string; boundingbox: [string, string, string, string]; type: string };

async function search(q: string) {
  searchAbort?.abort();
  searchAbort = new AbortController();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q, format: 'jsonv2', limit: '8', countrycodes: 'ca,us', 'accept-language': 'ru,fr,en',
    viewbox: '-80,63,-57,42', bounded: '0',
  }).toString();
  const res = await fetch(url, { signal: searchAbort.signal });
  const places = (await res.json()) as Place[];
  results.innerHTML = places.length
    ? places.map((p, i) => `<li data-i="${i}">${esc(p.display_name)}</li>`).join('')
    : '<li class="empty">Ничего не найдено</li>';
  results.hidden = false;
  results.onclick = (ev) => {
    const li = (ev.target as HTMLElement).closest('li');
    const p = li?.dataset.i !== undefined ? places[Number(li.dataset.i)] : undefined;
    if (!p) return;
    const [s, n, w, e] = p.boundingbox.map(Number);
    map.fitBounds([[s, w], [n, e]], { maxZoom: 12 });
    searchMarker?.remove();
    searchMarker = L.marker([Number(p.lat), Number(p.lon)]).addTo(map).bindPopup(esc(p.display_name)).openPopup();
    results.hidden = true;
    searchInput.value = p.display_name.split(',')[0];
    closeSidebarOnMobile();
  };
}
searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    results.hidden = true;
    return;
  }
  searchTimer = window.setTimeout(() => search(q).catch(() => {}), 450); // Nominatim: не чаще 1 запроса/с
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (results.querySelector('li[data-i]') as HTMLElement | null)?.click();
  if (e.key === 'Escape') results.hidden = true;
});

// ───────────────────────── Мобильная боковая панель ─────────────────────────

const sidebar = document.getElementById('sidebar')!;
document.getElementById('toggle-sidebar')!.addEventListener('click', () => sidebar.classList.toggle('open'));
function closeSidebarOnMobile() {
  if (window.innerWidth < 800) sidebar.classList.remove('open');
}

loadDeposits();
loadExtras();
