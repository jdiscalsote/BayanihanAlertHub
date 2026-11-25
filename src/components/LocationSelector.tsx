import { useEffect, useId, useState } from 'react';
import {
  FALLBACK_REGIONS,
  fetchBarangaysByMunicipality,
  fetchMunicipalitiesByRegion,
  fetchPhilippineRegions,
  findMunicipalityByName,
} from '../services/psgcService';
import type {
  PsgcBarangay,
  PsgcMunicipality,
  PsgcRegion,
} from '../types/alert';

interface LocationSelectorProps {
  region: string;
  municipality: string;
  barangay: string;
  allowAllBarangayOption?: boolean;
  lockedMunicipality?: string;
  syncVersion?: number;
  onChange: (next: {
    region: string;
    municipality: string;
    barangay: string;
  }) => void;
}

export function LocationSelector({
  region,
  municipality,
  barangay,
  allowAllBarangayOption = false,
  lockedMunicipality,
  syncVersion = 0,
  onChange,
}: LocationSelectorProps) {
  const baseId = useId();
  const [regions, setRegions] = useState<PsgcRegion[]>(FALLBACK_REGIONS);
  const [municipalities, setMunicipalities] = useState<PsgcMunicipality[]>([]);
  const [barangays, setBarangays] = useState<PsgcBarangay[]>([]);

  const [selectedRegionCode, setSelectedRegionCode] = useState<string>('130000000');
  const [selectedMuniCode, setSelectedMuniCode] = useState<string>('137404000');
  const [loadingMunis, setLoadingMunis] = useState(false);
  const [loadingBrgys, setLoadingBrgys] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);

  // Sync external auto-filled municipality/region (e.g. from map reverse geocoding)
  useEffect(() => {
    if (!syncVersion || lockedMunicipality || !municipality.trim()) return;
    let active = true;
    void (async () => {
      const resolved = await findMunicipalityByName(municipality);
      if (!active) return;
      if (resolved) {
        setManualFallback(false);
        setSelectedRegionCode(resolved.regionCode);
        setSelectedMuniCode(resolved.municipality.code);
      } else {
        setManualFallback(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [syncVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load all 17 Philippine regions (and lock to assigned municipality if provided)
  useEffect(() => {
    let active = true;
    void (async () => {
      const { regions: loaded } = await fetchPhilippineRegions();
      if (!active) return;
      setRegions(loaded);

      if (lockedMunicipality) {
        const resolved = await findMunicipalityByName(lockedMunicipality);
        if (!active) return;
        if (resolved) {
          setSelectedRegionCode(resolved.regionCode);
          setSelectedMuniCode(resolved.municipality.code);
          onChange({
            region: resolved.regionName,
            municipality: resolved.municipality.name,
            barangay: allowAllBarangayOption ? 'Citywide' : barangay,
          });
        } else {
          onChange({
            region,
            municipality: lockedMunicipality,
            barangay: allowAllBarangayOption ? 'Citywide' : barangay,
          });
        }
        return;
      }

      const match = loaded.find(
        (r) =>
          r.name.toLowerCase() === region.toLowerCase() ||
          `${r.regionName} — ${r.name}`.toLowerCase() === region.toLowerCase()
      );
      if (match) {
        setSelectedRegionCode(match.code);
      }
    })();
    return () => {
      active = false;
    };
  }, [lockedMunicipality]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load cities/municipalities whenever selectedRegionCode changes
  useEffect(() => {
    let active = true;
    if (!selectedRegionCode) {
      setMunicipalities([]);
      return;
    }
    setLoadingMunis(true);
    void fetchMunicipalitiesByRegion(selectedRegionCode).then(
      ({ municipalities: loaded }) => {
        if (!active) return;
        setMunicipalities(loaded);
        setLoadingMunis(false);

        const match = loaded.find(
          (m) => m.name.toLowerCase() === municipality.toLowerCase()
        );
        if (match) {
          setSelectedMuniCode(match.code);
        } else if (loaded.length > 0 && !manualFallback) {
          const first = loaded[0];
          setSelectedMuniCode(first.code);
          const regObj = regions.find((r) => r.code === selectedRegionCode);
          onChange({
            region: regObj?.name || region,
            municipality: first.name,
            barangay: allowAllBarangayOption ? 'Citywide' : '',
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [selectedRegionCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load barangays whenever selectedMuniCode changes
  useEffect(() => {
    let active = true;
    if (!selectedMuniCode) {
      setBarangays([]);
      return;
    }
    setLoadingBrgys(true);
    void fetchBarangaysByMunicipality(selectedMuniCode).then(
      ({ barangays: loaded }) => {
        if (!active) return;
        setBarangays(loaded);
        setLoadingBrgys(false);

        if (allowAllBarangayOption && barangay === 'Citywide') return;
        const normalizedCurrent = barangay.replace(/^Brgy\.\s*/i, '').toLowerCase();
        const match = loaded.find(
          (b) => b.name.toLowerCase() === normalizedCurrent
        );
        if (!match && loaded.length > 0 && !manualFallback) {
          onChange({
            region,
            municipality,
            barangay: `Brgy. ${loaded[0].name}`,
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [selectedMuniCode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">
          {lockedMunicipality
            ? `Barangay inside ${lockedMunicipality}`
            : 'Philippine Location (Region → City / Municipality → Barangay)'}
        </span>
        {!lockedMunicipality && (
          <button
            type="button"
            onClick={() => setManualFallback((prev) => !prev)}
            className="cursor-pointer text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            {manualFallback ? 'Use PSGC Dropdowns' : 'Type manually'}
          </button>
        )}
      </div>

      {manualFallback ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Region
            </label>
            <input
              type="text"
              required
              value={region}
              onChange={(e) =>
                onChange({ region: e.target.value, municipality, barangay })
              }
              placeholder="e.g. Region IV-A (CALABARZON)"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              City / Municipality
            </label>
            <input
              type="text"
              required
              value={municipality}
              onChange={(e) =>
                onChange({ region, municipality: e.target.value, barangay })
              }
              placeholder="e.g. Antipolo City"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Barangay
            </label>
            <input
              type="text"
              required
              value={barangay}
              onChange={(e) =>
                onChange({ region, municipality, barangay: e.target.value })
              }
              placeholder="e.g. Brgy. Dela Paz"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label
              htmlFor={`${baseId}-region`}
              className="block text-xs font-medium text-slate-600"
            >
              Region
            </label>
            <select
              id={`${baseId}-region`}
              disabled={Boolean(lockedMunicipality)}
              value={selectedRegionCode}
              onChange={(e) => {
                const nextCode = e.target.value;
                const regObj = regions.find((r) => r.code === nextCode);
                setSelectedRegionCode(nextCode);
                setSelectedMuniCode('');
                setBarangays([]);
                onChange({
                  region: regObj?.name || region,
                  municipality: '',
                  barangay: allowAllBarangayOption ? 'Citywide' : '',
                });
              }}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 disabled:text-slate-600"
            >
              {regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.regionName ? `${r.regionName} — ${r.name}` : r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`${baseId}-muni`}
              className="block text-xs font-medium text-slate-600"
            >
              City / Municipality
            </label>
            {municipalities.length > 0 ? (
              <select
                id={`${baseId}-muni`}
                disabled={loadingMunis || Boolean(lockedMunicipality)}
                value={selectedMuniCode}
                onChange={(e) => {
                  const nextCode = e.target.value;
                  const muniObj = municipalities.find((m) => m.code === nextCode);
                  setSelectedMuniCode(nextCode);
                  onChange({
                    region,
                    municipality: muniObj?.name || '',
                    barangay: allowAllBarangayOption ? 'Citywide' : '',
                  });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 disabled:text-slate-600"
              >
                {municipalities.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${baseId}-muni`}
                type="text"
                required
                value={municipality}
                onChange={(e) =>
                  onChange({ region, municipality: e.target.value, barangay })
                }
                placeholder={
                  loadingMunis ? 'Loading...' : 'Enter City / Municipality'
                }
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            )}
          </div>

          <div>
            <label
              htmlFor={`${baseId}-brgy`}
              className="block text-xs font-medium text-slate-600"
            >
              Barangay
            </label>
            {barangays.length > 0 ? (
              <select
                id={`${baseId}-brgy`}
                disabled={loadingBrgys}
                value={barangay}
                onChange={(e) =>
                  onChange({ region, municipality, barangay: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none disabled:opacity-60"
              >
                {allowAllBarangayOption && (
                  <option value="Citywide">Citywide (All Barangays)</option>
                )}
                {barangays.map((b) => {
                  const formatted = `Brgy. ${b.name}`;
                  return (
                    <option key={b.code} value={formatted}>
                      {formatted}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                id={`${baseId}-brgy`}
                type="text"
                required
                value={barangay}
                onChange={(e) =>
                  onChange({ region, municipality, barangay: e.target.value })
                }
                placeholder={loadingBrgys ? 'Loading...' : 'Enter Barangay'}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
