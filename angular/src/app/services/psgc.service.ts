import { Injectable } from '@angular/core';
import {
  PsgcBarangay,
  PsgcMunicipality,
  PsgcRegion,
} from '../models/alert.models';

const PSGC_BASE = 'https://psgc.gitlab.io/api';
const CACHE_PREFIX = 'bayanihan:psgc:';

export const FALLBACK_REGIONS: PsgcRegion[] = [
  { code: '130000000', name: 'NCR', regionName: 'National Capital Region' },
  { code: '140000000', name: 'CAR', regionName: 'Cordillera Administrative Region' },
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
  { code: '190000000', name: 'BARMM', regionName: 'BARMM' },
];

const FALLBACK_NCR_CITIES: PsgcMunicipality[] = [
  { code: '137404000', name: 'Quezon City', regionCode: '130000000', isCity: true },
  { code: '133900000', name: 'City of Manila', regionCode: '130000000', isCity: true },
  { code: '137402000', name: 'City of Marikina', regionCode: '130000000', isCity: true },
  { code: '137403000', name: 'City of Pasig', regionCode: '130000000', isCity: true },
  { code: '137602000', name: 'City of Makati', regionCode: '130000000', isCity: true },
  { code: '137607000', name: 'City of Taguig', regionCode: '130000000', isCity: true },
];

const FALLBACK_QC_BARANGAYS: PsgcBarangay[] = [
  { code: '137404008', name: 'Bagong Silangan' },
  { code: '137404015', name: 'Batasan Hills' },
  { code: '137404026', name: 'Commonwealth' },
  { code: '137404056', name: 'Loyola Heights' },
  { code: '137404076', name: 'Novaliches Proper' },
  { code: '137404088', name: 'Payatas' },
  { code: '137404095', name: 'Roxas' },
  { code: '137404114', name: 'Santo Domingo' },
  { code: '137404127', name: 'Tatalon' },
];

@Injectable({ providedIn: 'root' })
export class PsgcService {
  async fetchRegions(): Promise<PsgcRegion[]> {
    const cached = this.readCache<PsgcRegion[]>('regions');
    if (cached && cached.length > 0) return cached;

    try {
      const res = await fetch(`${PSGC_BASE}/regions/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as Array<{
        code: string;
        name: string;
        regionName?: string;
      }>;
      const mapped = raw
        .map((r) => ({ code: r.code, name: r.name, regionName: r.regionName }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.writeCache('regions', mapped);
      return mapped;
    } catch {
      return FALLBACK_REGIONS;
    }
  }

  async fetchMunicipalitiesByRegion(
    regionCode: string
  ): Promise<PsgcMunicipality[]> {
    if (!regionCode) return [];
    const key = `munis:${regionCode}`;
    const cached = this.readCache<PsgcMunicipality[]>(key);
    if (cached && cached.length > 0) return cached;

    try {
      const res = await fetch(
        `${PSGC_BASE}/regions/${encodeURIComponent(regionCode)}/cities-municipalities/`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as Array<{
        code: string;
        name: string;
        regionCode?: string;
        isCity?: boolean;
      }>;
      const mapped = raw
        .map((m) => ({
          code: m.code,
          name: m.name,
          regionCode: m.regionCode || regionCode,
          isCity: m.isCity,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.writeCache(key, mapped);
      return mapped;
    } catch {
      return regionCode === '130000000' ? FALLBACK_NCR_CITIES : [];
    }
  }

  async fetchBarangaysByMunicipality(
    municipalityCode: string
  ): Promise<PsgcBarangay[]> {
    if (!municipalityCode) return [];
    const key = `brgys:${municipalityCode}`;
    const cached = this.readCache<PsgcBarangay[]>(key);
    if (cached && cached.length > 0) return cached;

    try {
      const res = await fetch(
        `${PSGC_BASE}/cities-municipalities/${encodeURIComponent(municipalityCode)}/barangays/`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as Array<{ code: string; name: string }>;
      const mapped = raw
        .map((b) => ({ code: b.code, name: b.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this.writeCache(key, mapped);
      return mapped;
    } catch {
      return municipalityCode === '137404000' ? FALLBACK_QC_BARANGAYS : [];
    }
  }

  private readCache<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private writeCache<T>(key: string, value: T): void {
    try {
      localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
    } catch {
      // Ignore quota issues
    }
  }
}
