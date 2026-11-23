/**
 * Скачивает открытые данные SIGÉOM (Министерство природных ресурсов Квебека, лицензия CC-BY 4.0)
 * через WFS и сохраняет урезанные GeoJSON в public/data/.
 *
 *   npm run fetch-data
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WFS = 'https://servicesvectoriels.atlas.gouv.qc.ca/IDS_SGM_EN_WFS/service.svc/get';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

type Feature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
};

async function fetchLayer(typeName: string): Promise<Feature[]> {
  // Сервер не поддерживает startIndex, поэтому берём слой целиком одним запросом.
  const url =
    `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=SGM_EN:${typeName}` +
    `&outputFormat=application/json&srsName=EPSG:4326&count=100000`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { features?: Feature[] };
      const features = json.features ?? [];
      console.log(`  ${typeName}: ${features.length} объектов`);
      return features;
    } catch (e) {
      console.warn(`  ${typeName}: попытка ${attempt} не удалась (${(e as Error).message})`);
      if (attempt === 3) throw e;
    }
  }
}

/** "<a href=...>Name</a>" -> href */
function href(v: unknown): string | undefined {
  const m = typeof v === 'string' ? v.match(/href="([^"]+)"/) : null;
  return m?.[1];
}

function round(coords: unknown): unknown {
  if (typeof coords === 'number') return Math.round(coords * 1e5) / 1e5;
  return Array.isArray(coords) ? coords.map(round) : coords;
}

/** Ищет первое непустое значение среди вариантов имён полей. */
function pick(p: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (p[k] !== undefined && p[k] !== null && p[k] !== '') return p[k];
  return undefined;
}

function slimDeposit(f: Feature, kind: 'metal' | 'nonmetal'): Feature | null {
  if (!f.geometry) return null;
  const p = f.properties;
  return {
    type: 'Feature',
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
    properties: {
      kind,
      name: pick(p, 'NOM_CORPS_MINR', 'NOM_GISM'),
      status: pick(p, 'ETAT_CORPS_MINR_EN', 'ETAT_GISM_EN'),
      statusCode: pick(p, 'CODE_ETAT_CORPS_MINR', 'CODE_ETAT_GISM'),
      substance: pick(p, 'SUBST_PRINC_EN', 'ELMN_CHIM_PERD_EN', 'MINR_EN'),
      element: pick(p, 'CODE_ELMN_CHIM_PERD', 'CODE_MINR'),
      rocks: pick(p, 'CODE_TYPE_ROCH_LITH_EN'),
      discovery: pick(p, 'COMN_DECV_EN'),
      year: pick(p, 'AN_DECV'),
      color: pick(p, 'COUL_REMPL_HEXA'),
      url: href(pick(p, 'URL_NOM_CORPS_MINR_EN', 'URL_NOM_GISM_EN')),
    },
  };
}

function slimGeneric(f: Feature): Feature | null {
  if (!f.geometry) return null;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f.properties)) {
    if (v === null || v === '') continue;
    if (typeof v === 'string' && v.includes('href=')) props[k] = href(v);
    else props[k] = v;
  }
  return { type: 'Feature', geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }, properties: props };
}

async function save(name: string, features: (Feature | null)[]) {
  const fc = { type: 'FeatureCollection', features: features.filter(Boolean) };
  const file = join(OUT, name);
  await writeFile(file, JSON.stringify(fc));
  console.log(`  -> ${file} (${fc.features.length})`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('SIGÉOM WFS: загрузка (сервер медленный, может занять несколько минут)…');

  const metal = await fetchLayer('Metallic_deposits');
  await save('metallic.geojson', metal.map((f) => slimDeposit(f, 'metal')));

  const nonmetal = await fetchLayer('Non_metal_deposits');
  await save('nonmetal.geojson', nonmetal.map((f) => slimDeposit(f, 'nonmetal')));

  const sites = await fetchLayer('Outstanding_geological_sites');
  await save('geosites.geojson', sites.map(slimGeneric));

  const mines = await fetchLayer('Mines_projects_en');
  await save('mines.geojson', mines.map(slimGeneric));

  await writeFile(join(OUT, 'meta.json'), JSON.stringify({ fetchedAt: new Date().toISOString() }));
  console.log('Готово.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
