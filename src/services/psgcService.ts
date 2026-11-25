import type {
  PsgcBarangay,
  PsgcMunicipality,
  PsgcRegion,
} from '../types/alert';

const PSGC_BASE = 'https://psgc.gitlab.io/api';
const CACHE_PREFIX = 'bayanihan:psgc:';

/**
 * Fallback list of all 17 Philippine Regions so the Region selector works
 * immediately even when completely offline before the first API fetch.
 */
export const FALLBACK_REGIONS: PsgcRegion[] = [
  { code: '130000000', name: 'National Capital Region (NCR)', regionName: 'NCR' },
  { code: '140000000', name: 'Cordillera Administrative Region (CAR)', regionName: 'CAR' },
  { code: '010000000', name: 'Ilocos Region', regionName: 'Region I' },
  { code: '020000000', name: 'Cagayan Valley', regionName: 'Region II' },
  { code: '030000000', name: 'Central Luzon', regionName: 'Region III' },
  { code: '040000000', name: 'CALABARZON', regionName: 'Region IV-A' },
  { code: '170000000', name: 'MIMAROPA Region', regionName: 'MIMAROPA' },
  { code: '050000000', name: 'Bicol Region', regionName: 'Region V' },
  { code: '060000000', name: 'Western Visayas', regionName: 'Region VI' },
  { code: '070000000', name: 'Central Visayas', regionName: 'Region VII' },
  { code: '080000000', name: 'Eastern Visayas', regionName: 'Region VIII' },
  { code: '090000000', name: 'Zamboanga Peninsula', regionName: 'Region IX' },
  { code: '100000000', name: 'Northern Mindanao', regionName: 'Region X' },
  { code: '110000000', name: 'Davao Region', regionName: 'Region XI' },
  { code: '120000000', name: 'SOCCSKSARGEN', regionName: 'Region XII' },
  { code: '160000000', name: 'Caraga', regionName: 'Region XIII' },
  { code: '150000000', name: 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)', regionName: 'BARMM' },
];

const FALLBACK_NCR_MUNIS: PsgcMunicipality[] = [
  { code: '137404000', name: 'Quezon City', regionCode: '130000000', isCity: true },
  { code: '133900000', name: 'City of Manila', regionCode: '130000000', isCity: true },
  { code: '137402000', name: 'City of Marikina', regionCode: '130000000', isCity: true },
  { code: '137403000', name: 'City of Pasig', regionCode: '130000000', isCity: true },
  { code: '137501000', name: 'City of Caloocan', regionCode: '130000000', isCity: true },
  { code: '137602000', name: 'City of Makati', regionCode: '130000000', isCity: true },
  { code: '137607000', name: 'City of Taguig', regionCode: '130000000', isCity: true },
];

const FALLBACK_QC_BARANGAYS: PsgcBarangay[] = [
  { code: '137404007', name: 'Bagong Silangan' },
  { code: '137404012', name: 'Batasan Hills' },
  { code: '137404020', name: 'Commonwealth' },
  { code: '137404047', name: 'Loyola Heights' },
  { code: '137404073', name: 'Novaliches Proper' },
  { code: '137404080', name: 'Payatas' },
  { code: '137404092', name: 'Roxas' },
  { code: '137404109', name: 'Santo Domingo' },
  { code: '137404125', name: 'Tatalon' },
];

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

export async function fetchPhilippineRegions(): Promise<{
  regions: PsgcRegion[];
  fromCache: boolean;
}> {
  const cached = readCache<PsgcRegion[]>('regions');
  if (cached && cached.length > 0) {
    return { regions: cached, fromCache: true };
  }

  try {
    const res = await fetch(`${PSGC_BASE}/regions/`);
    if (!res.ok) throw new Error('PSGC regions unavailable');
    const raw = (await res.json()) as Array<{
      code: string;
      name: string;
      regionName: string;
    }>;
    const regions: PsgcRegion[] = raw
      .map((r) => ({
        code: r.code,
        name: r.name,
        regionName: r.regionName,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    writeCache('regions', regions);
    return { regions, fromCache: false };
  } catch {
    return { regions: FALLBACK_REGIONS, fromCache: true };
  }
}

export async function fetchMunicipalitiesByRegion(
  regionCode: string
): Promise<{ municipalities: PsgcMunicipality[]; fromCache: boolean }> {
  if (!regionCode) return { municipalities: [], fromCache: true };

  const cacheKey = `munis:${regionCode}`;
  const cached = readCache<PsgcMunicipality[]>(cacheKey);
  if (cached && cached.length > 0) {
    return { municipalities: cached, fromCache: true };
  }

  try {
    const res = await fetch(
      `${PSGC_BASE}/regions/${encodeURIComponent(regionCode)}/cities-municipalities/`
    );
    if (!res.ok) throw new Error('PSGC municipalities unavailable');
    const raw = (await res.json()) as Array<{
      code: string;
      name: string;
      regionCode: string;
      isCity: boolean;
    }>;
    const municipalities: PsgcMunicipality[] = raw
      .map((m) => ({
        code: m.code,
        name: m.name,
        regionCode: m.regionCode,
        isCity: Boolean(m.isCity),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    writeCache(cacheKey, municipalities);
    return { municipalities, fromCache: false };
  } catch {
    if (regionCode === '130000000') {
      return { municipalities: FALLBACK_NCR_MUNIS, fromCache: true };
    }
    return { municipalities: [], fromCache: true };
  }
}

export async function fetchBarangaysByMunicipality(
  cityMuniCode: string
): Promise<{ barangays: PsgcBarangay[]; fromCache: boolean }> {
  if (!cityMuniCode) return { barangays: [], fromCache: true };

  const cacheKey = `brgys:${cityMuniCode}`;
  const cached = readCache<PsgcBarangay[]>(cacheKey);
  if (cached && cached.length > 0) {
    return { barangays: cached, fromCache: true };
  }

  try {
    const res = await fetch(
      `${PSGC_BASE}/cities-municipalities/${encodeURIComponent(cityMuniCode)}/barangays/`
    );
    if (!res.ok) throw new Error('PSGC barangays unavailable');
    const raw = (await res.json()) as Array<{ code: string; name: string }>;
    const barangays: PsgcBarangay[] = raw
      .map((b) => ({ code: b.code, name: b.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    writeCache(cacheKey, barangays);
    return { barangays, fromCache: false };
  } catch {
    if (cityMuniCode === '137404000') {
      return { barangays: FALLBACK_QC_BARANGAYS, fromCache: true };
    }
    return { barangays: [], fromCache: true };
  }
}

export async function findMunicipalityByName(
  municipalityName: string
): Promise<{
  regionCode: string;
  regionName: string;
  municipality: PsgcMunicipality;
} | null> {
  const target = municipalityName.trim().toLowerCase();
  if (!target || target === 'all municipalities') return null;

  const { regions } = await fetchPhilippineRegions();
  const ncrMatch = FALLBACK_NCR_MUNIS.find(
    (m) => m.name.toLowerCase() === target
  );
  if (ncrMatch) {
    const reg = regions.find((r) => r.code === ncrMatch.regionCode);
    return {
      regionCode: ncrMatch.regionCode,
      regionName: reg?.name || 'National Capital Region (NCR)',
      municipality: ncrMatch,
    };
  }

  let allMunis = readCache<PsgcMunicipality[]>('all-munis');
  if (!allMunis || allMunis.length === 0) {
    try {
      const res = await fetch(`${PSGC_BASE}/cities-municipalities/`);
      if (!res.ok) throw new Error('PSGC all municipalities unavailable');
      const raw = (await res.json()) as Array<{
        code: string;
        name: string;
        regionCode: string;
        isCity: boolean;
      }>;
      allMunis = raw.map((m) => ({
        code: m.code,
        name: m.name,
        regionCode: m.regionCode,
        isCity: Boolean(m.isCity),
      }));
      writeCache('all-munis', allMunis);
    } catch {
      return null;
    }
  }

  const found =
    allMunis.find((m) => m.name.toLowerCase() === target) ||
    allMunis.find((m) => m.name.toLowerCase().includes(target));
  if (!found) return null;

  const reg = regions.find((r) => r.code === found.regionCode);
  return {
    regionCode: found.regionCode,
    regionName: reg?.name || 'Philippines',
    municipality: found,
  };
}
