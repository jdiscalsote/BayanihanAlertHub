import { useEffect, useState } from 'react';
import {
  CloudRain,
  ExternalLink,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import type { OfficialBulletinResult } from '../types/alert';
import { formatClockTime } from '../utils/formatters';

const BULLETIN_CACHE_KEY = 'bayanihan:cached_bulletins_v1';

interface OfficialBulletinsPanelProps {
  selectedMunicipality: string;
  isOffline: boolean;
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function loadCachedBulletin(): OfficialBulletinResult | null {
  try {
    const raw = localStorage.getItem(BULLETIN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfficialBulletinResult;
    if (parsed && typeof parsed.summary === 'string' && parsed.fetchedAt) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveCachedBulletin(data: OfficialBulletinResult): void {
  try {
    localStorage.setItem(BULLETIN_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

export function OfficialBulletinsPanel({
  selectedMunicipality,
  isOffline,
}: OfficialBulletinsPanelProps) {
  const defaultCity =
    selectedMunicipality && selectedMunicipality !== 'All'
      ? selectedMunicipality
      : 'Quezon City';

  const [targetCity, setTargetCity] = useState(defaultCity);
  const [targetBarangay, setTargetBarangay] = useState('');
  const [bulletin, setBulletin] = useState<OfficialBulletinResult | null>(() =>
    loadCachedBulletin()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(() => Boolean(loadCachedBulletin()));

  useEffect(() => {
    if (selectedMunicipality && selectedMunicipality !== 'All') {
      setTargetCity(selectedMunicipality);
    }
  }, [selectedMunicipality]);

  async function handleFetchBulletins() {
    if (isOffline) {
      setError('Device is offline — showing your last cached official bulletin summary below.');
      return;
    }

    setLoading(true);
    setError(null);
    setExpanded(true);

    try {
      const res = await fetch('/api/bulletins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          municipality: targetCity.trim() || 'Quezon City',
          barangay: targetBarangay.trim(),
          region: 'Metro Manila / Philippines',
        }),
      });

      const payload = (await res.json()) as Partial<OfficialBulletinResult> & {
        error?: string;
      };

      if (!res.ok) {
        throw new Error(payload.error || `Request failed (${res.status})`);
      }

      if (!payload.summary || !payload.fetchedAt) {
        throw new Error('Empty bulletin response received.');
      }

      const result: OfficialBulletinResult = {
        locationLabel: payload.locationLabel || targetCity,
        summary: payload.summary,
        sources: Array.isArray(payload.sources)
          ? payload.sources.filter((s) => s?.url && isSafeHttpUrl(s.url))
          : [],
        fetchedAt: payload.fetchedAt,
      };

      setBulletin(result);
      saveCachedBulletin(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to fetch official weather and LGU bulletins.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-label="Official Weather and LGU Bulletins"
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CloudRain className="h-4 w-4 text-sky-700" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-slate-900">
              Official Weather &amp; LGU Bulletins
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Live search-grounded updates from PAGASA, NDRRMC, MMDA, and local LGU channels. Cached locally for offline reading.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={targetCity}
            onChange={(e) => setTargetCity(e.target.value)}
            placeholder="City / Municipality (e.g. Quezon City)"
            aria-label="City or municipality for official weather bulletins"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:w-44"
          />
          <input
            type="text"
            value={targetBarangay}
            onChange={(e) => setTargetBarangay(e.target.value)}
            placeholder="Barangay (optional)"
            aria-label="Barangay for official weather bulletins"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:w-36"
          />
          <button
            type="button"
            onClick={() => void handleFetchBulletins()}
            disabled={loading || isOffline}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{loading ? 'Checking PAGASA & LGU...' : 'Fetch Live Bulletins'}</span>
          </button>
          {bulletin && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {expanded ? 'Collapse' : 'View Cached'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
        >
          {error}
        </div>
      )}

      {expanded && bulletin && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">
              Area: {bulletin.locationLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-500">
              {isOffline && <WifiOff className="h-3 w-3 text-amber-600" aria-hidden="true" />}
              <span>
                {isOffline ? 'Offline Cached · ' : 'Updated '}
                {formatClockTime(bulletin.fetchedAt)} ({new Date(bulletin.fetchedAt).toLocaleDateString()})
              </span>
            </span>
          </div>

          <div className="whitespace-pre-line rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-800 sm:text-sm">
            {bulletin.summary}
          </div>

          {bulletin.sources.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Verified Grounding Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {bulletin.sources.map((src) => (
                  <a
                    key={src.url}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                  >
                    <span className="max-w-[220px] truncate">{src.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
