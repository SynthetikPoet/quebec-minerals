/**
 * «Интересные зоны» из OpenStreetMap через Overpass API:
 * выходы коренных пород, обрывы, осыпи/оползни, галечные пляжи, карьеры и шахты.
 */
import * as L from 'leaflet';

export interface OsmCategory {
  id: string;
  label: string;
  color: string;
  hint: string;
  match: (t: Record<string, string>) => boolean;
}

const rockyBeach = /pebble|shingle|gravel|stone|rock|cobble/;

export const OSM_CATEGORIES: OsmCategory[] = [
  {
    id: 'outcrop', label: 'Выходы пород', color: '#e8590c',
    hint: 'natural=bare_rock / rock / stone, geological=outcrop',
    match: (t) => ['bare_rock', 'rock', 'stone'].includes(t.natural) || t.geological === 'outcrop',
  },
  {
    id: 'cliff', label: 'Обрывы и скалы', color: '#c92a2a',
    hint: 'natural=cliff, natural=arete — свежие сколы породы',
    match: (t) => t.natural === 'cliff' || t.natural === 'arete',
  },
  {
    id: 'landslide', label: 'Осыпи и оползни', color: '#9c36b5',
    hint: 'natural=scree, hazard=landslide, natural=landslide',
    match: (t) => t.natural === 'scree' || t.hazard === 'landslide' || t.natural === 'landslide' || t.landslide !== undefined,
  },
  {
    id: 'beach', label: 'Каменистые пляжи', color: '#0c8599',
    hint: 'natural=shingle, natural=beach с галечным/каменным покрытием',
    match: (t) => t.natural === 'shingle' || (t.natural === 'beach' && rockyBeach.test(t.surface ?? '')),
  },
  {
    id: 'quarry', label: 'Карьеры, шахты, отвалы', color: '#795548',
    hint: 'landuse=quarry, historic=mine, man_made=mineshaft/adit, spoil heaps',
    match: (t) =>
      t.landuse === 'quarry' || t.historic === 'mine' || t.historic === 'quarry' ||
      ['mineshaft', 'adit', 'spoil_heap'].includes(t.man_made) || t.landuse === 'spoil_heap' ||
      t['disused:man_made'] === 'mineshaft',
  },
  {
    id: 'fossil', label: 'Палеонтология / геосайты', color: '#2f9e44',
    hint: 'geological=palaeontological_site, tourism с geological=*',
    match: (t) => t.geological === 'palaeontological_site' || t.geological === 'volcanic_caldera_rim' || t.geological === 'meteor_crater',
  },
];

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const OSM_MIN_ZOOM = 11;

function buildQuery(b: L.LatLngBounds): string {
  const bb = `(${b.getSouth().toFixed(4)},${b.getWest().toFixed(4)},${b.getNorth().toFixed(4)},${b.getEast().toFixed(4)})`;
  return `[out:json][timeout:30];(
    nwr["natural"~"^(bare_rock|rock|stone|cliff|arete|scree|shingle|landslide)$"]${bb};
    nwr["natural"="beach"]["surface"~"pebble|shingle|gravel|stone|rock|cobble"]${bb};
    nwr["geological"]${bb};
    nwr["hazard"="landslide"]${bb};
    nwr["landuse"~"^(quarry|spoil_heap)$"]${bb};
    nwr["historic"~"^(mine|quarry)$"]${bb};
    nwr["man_made"~"^(mineshaft|adit|spoil_heap)$"]${bb};
  );out geom qt 4000;`;
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

/**
 * Публичные серверы Overpass часто перегружены (502/504) или медленные.
 * «Хеджируем»: запускаем следующее зеркало, если текущее упало или молчит дольше HEDGE_MS;
 * побеждает первый успешный ответ, остальные запросы отменяются.
 */
const HEDGE_MS = 8_000;

function overpass(query: string, signal: AbortSignal): Promise<OsmElement[]> {
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [];
    let next = 0;
    let failed = 0;
    let done = false;
    let hedgeTimer: number | undefined;
    let lastErr: unknown = new Error('Overpass недоступен');

    const finish = () => {
      done = true;
      window.clearTimeout(hedgeTimer);
      controllers.forEach((c) => c.abort());
    };
    signal.addEventListener('abort', () => {
      finish();
      reject(signal.reason);
    });

    const launch = () => {
      if (done || next >= ENDPOINTS.length) return;
      const url = ENDPOINTS[next++];
      const ctrl = new AbortController();
      controllers.push(ctrl);
      window.clearTimeout(hedgeTimer);
      hedgeTimer = window.setTimeout(launch, HEDGE_MS);
      fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(60_000)]),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { elements: OsmElement[] };
          if (done) return;
          finish();
          resolve(json.elements);
        })
        .catch((e) => {
          if (done) return;
          lastErr = e;
          if (++failed === ENDPOINTS.length) {
            finish();
            reject(lastErr);
          } else {
            launch(); // упал — сразу пробуем следующее зеркало
          }
        });
    };
    launch();
  });
}

function osmLink(el: OsmElement) {
  return `https://www.openstreetmap.org/${el.type}/${el.id}`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function popup(el: OsmElement, cat: OsmCategory) {
  const t = el.tags ?? {};
  const rows = Object.entries(t)
    .filter(([k]) => !k.startsWith('source') && !k.startsWith('name:'))
    .slice(0, 12)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('');
  return `<div class="pop"><div class="pop-kicker" style="color:${cat.color}">${cat.label}</div>
    <div class="pop-title">${esc(t.name ?? t['name:fr'] ?? t['name:en'] ?? 'Без названия')}</div>
    <table class="pop-table">${rows}</table>
    <a href="${osmLink(el)}" target="_blank" rel="noopener">Открыть в OpenStreetMap ↗</a></div>`;
}

export type OsmStatus = { state: 'idle' | 'zoom' | 'loading' | 'ok' | 'error'; count?: number; message?: string };

/**
 * Слой с подгрузкой по видимой области. Объекты кэшируются по id,
 * поэтому возврат к уже просмотренному району не требует запросов.
 */
export class OsmInterestLayer {
  readonly groups = new Map<string, L.LayerGroup>();
  private seen = new Set<string>();
  private loadedBounds: L.LatLngBounds[] = [];
  private abort?: AbortController;
  private timer?: number;
  private renderer = L.canvas({ padding: 0.5 });
  counts = new Map<string, number>();

  constructor(
    private map: L.Map,
    private onStatus: (s: OsmStatus) => void,
    /** Точки для тепловой карты «перспективности». */
    private onPoints: (pts: [number, number, number][]) => void,
  ) {
    for (const c of OSM_CATEGORIES) {
      this.groups.set(c.id, L.layerGroup());
      this.counts.set(c.id, 0);
    }
    map.on('moveend', () => this.schedule());
    this.schedule();
  }

  private schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.load(), 600);
  }

  private async load() {
    if (this.map.getZoom() < OSM_MIN_ZOOM) {
      this.onStatus({ state: 'zoom' });
      return;
    }
    const view = this.map.getBounds();
    if (this.loadedBounds.some((b) => b.contains(view))) {
      this.onStatus({ state: 'ok', count: this.seen.size });
      return;
    }
    const b = view.pad(0.25);
    this.abort?.abort();
    this.abort = new AbortController();
    this.onStatus({ state: 'loading' });
    try {
      const els = await overpass(buildQuery(b), this.abort.signal);
      this.add(els);
      this.loadedBounds.push(b);
      this.onStatus({ state: 'ok', count: this.seen.size });
    } catch (e) {
      if (this.abort.signal.aborted) return;
      this.onStatus({ state: 'error', message: (e as Error).message });
    }
  }

  private add(els: OsmElement[]) {
    const pts: [number, number, number][] = [];
    for (const el of els) {
      const key = `${el.type}/${el.id}`;
      if (this.seen.has(key) || !el.tags) continue;
      const cat = OSM_CATEGORIES.find((c) => c.match(el.tags!));
      if (!cat) continue;
      this.seen.add(key);
      this.counts.set(cat.id, (this.counts.get(cat.id) ?? 0) + 1);

      const style = { color: cat.color, weight: 2, fillColor: cat.color, fillOpacity: 0.35, renderer: this.renderer };
      let layer: L.Layer | undefined;
      let center: L.LatLng | undefined;

      if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
        center = L.latLng(el.lat, el.lon);
        layer = L.circleMarker(center, { ...style, radius: 6, weight: 1.5, fillOpacity: 0.8 });
      } else if (el.geometry?.length) {
        const ll = el.geometry.map((g) => L.latLng(g.lat, g.lon));
        const closed = ll.length > 3 && ll[0].equals(ll[ll.length - 1]);
        const isLine = cat.id === 'cliff' || !closed;
        layer = isLine ? L.polyline(ll, { ...style, weight: 3 }) : L.polygon(ll, style);
        center = L.latLngBounds(ll).getCenter();
      } else if (el.members?.length) {
        const rings = el.members.filter((m) => m.geometry?.length && m.role !== 'inner')
          .map((m) => m.geometry!.map((g) => L.latLng(g.lat, g.lon)));
        if (rings.length) {
          layer = L.polygon(rings, style);
          center = L.latLngBounds(rings.flat()).getCenter();
        }
      }
      if (!layer || !center) continue;
      layer.bindPopup(popup(el, cat), { maxWidth: 320 });
      this.groups.get(cat.id)!.addLayer(layer);
      const w = cat.id === 'quarry' ? 0.6 : cat.id === 'beach' || cat.id === 'outcrop' ? 0.45 : 0.3;
      pts.push([center.lat, center.lng, w]);
    }
    if (pts.length) this.onPoints(pts);
  }
}
