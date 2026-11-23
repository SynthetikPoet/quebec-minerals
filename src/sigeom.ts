/** Работа с WMS-сервисом SIGÉOM (Министерство природных ресурсов и лесов Квебека). */
import * as L from 'leaflet';

const HOST = 'https://servicesvectoriels.atlas.gouv.qc.ca';
const WMS_PATH = '/IDS_SGM_EN_WMS/service.svc/get';

/** Тайлы WMS. Картинки грузятся напрямую (без Origin сервер их отдаёт). */
export function sigeomWms(layers: string, opts: L.WMSOptions = {}) {
  return L.tileLayer.wms(HOST + WMS_PATH, {
    layers,
    format: 'image/png',
    transparent: true,
    version: '1.1.1',
    tileSize: 512, // меньше запросов к медленному серверу
    attribution: 'Géologie © <a href="https://sigeom.mines.gouv.qc.ca">SIGÉOM, MRNF Québec</a>',
    ...opts,
  });
}

export interface WmsFeature {
  id?: string;
  properties: Record<string, unknown>;
}

/** GetFeatureInfo через прокси Vite (/sigeom → сервер без заголовка Origin). */
export async function featureInfo(map: L.Map, latlng: L.LatLng, layers: string[]): Promise<WmsFeature[]> {
  const size = 101;
  const p = map.project(latlng, map.getZoom());
  const sw = map.unproject(p.add([-size / 2, size / 2]), map.getZoom());
  const ne = map.unproject(p.add([size / 2, -size / 2]), map.getZoom());
  const a = L.CRS.EPSG3857.project(sw);
  const b = L.CRS.EPSG3857.project(ne);
  const params = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetFeatureInfo',
    layers: layers.join(','), query_layers: layers.join(','), styles: '',
    srs: 'EPSG:3857', bbox: [a.x, a.y, b.x, b.y].join(','),
    width: String(size), height: String(size), x: String(Math.floor(size / 2)), y: String(Math.floor(size / 2)),
    info_format: 'application/json', feature_count: '4', format: 'image/png',
  });
  const res = await fetch(`/sigeom${WMS_PATH}?${params}`, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`SIGÉOM HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text) as { features?: WmsFeature[] };
  // Порядок: сначала перспективные зоны, потом геология; без дублей.
  const seen = new Set<string>();
  return (json.features ?? [])
    .filter((f) => !f.id || (!seen.has(f.id) && seen.add(f.id)))
    .sort((x, y) => Number(!x.id?.startsWith('Prospective')) - Number(!y.id?.startsWith('Prospective')));
}
