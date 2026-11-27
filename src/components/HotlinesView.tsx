import { useState } from 'react';
import { Check, Copy, ExternalLink, Phone, ShieldAlert } from 'lucide-react';
import { EMERGENCY_HOTLINES, OFFICIAL_WEATHER_PORTALS } from '../data/seedData';
import type { HotlineCategory } from '../types/alert';
import { buildSafeTelHref } from '../utils/formatters';

type CategoryFilter = 'All' | HotlineCategory;

const CATEGORIES: CategoryFilter[] = [
  'All',
  'National',
  'Local LGU',
  'Utility & Weather',
];

export function HotlinesView() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [municipalityFilter, setMunicipalityFilter] = useState<string>('All');

  const municipalities = Array.from(
    new Set(
      EMERGENCY_HOTLINES.map((h) => h.municipality).filter(
        (m): m is string => Boolean(m)
      )
    )
  ).sort((a, b) => a.localeCompare(b));

  const filteredHotlines = EMERGENCY_HOTLINES.filter((hl) => {
    if (categoryFilter !== 'All' && hl.category !== categoryFilter) {
      return false;
    }
    if (municipalityFilter !== 'All') {
      // Keep nationwide/utility hotlines visible alongside selected LGU
      if (hl.category === 'Local LGU' && hl.municipality !== municipalityFilter) {
        return false;
      }
    }
    return true;
  });

  async function handleCopy(id: string, number: string) {
    try {
      await navigator.clipboard.writeText(number);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              Emergency Hotlines &amp; Official Weather Portals
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              National rescue, local LGU DRRMOs, and utility outage hotlines cached offline. Tap any number on mobile to dial directly.
            </p>
          </div>

          <select
            value={municipalityFilter}
            onChange={(e) => setMunicipalityFilter(e.target.value)}
            aria-label="Filter local LGU hotlines by city or municipality"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-slate-900 focus:outline-none sm:w-52"
          >
            <option value="All">All LGU Municipalities</option>
            {municipalities.map((muni) => (
              <option key={muni} value={muni}>
                {muni} + National
              </option>
            ))}
          </select>
        </div>

        <div
          role="tablist"
          aria-label="Filter emergency hotlines by category"
          className="mt-4 flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1"
        >
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategoryFilter(cat)}
                className={`cursor-pointer whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Hotlines Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredHotlines.map((hotline) => {
          const isCopied = copiedId === hotline.id;
          return (
            <article
              key={hotline.id}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-500">
                    {hotline.coverage}
                  </span>
                  <span className="font-semibold text-slate-700">
                    {hotline.category}
                  </span>
                </div>
                <h2 className="font-display mt-1 text-base font-semibold text-slate-900">
                  {hotline.agency}
                </h2>
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-red-700">
                  {hotline.number}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {hotline.description}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
                <a
                  href={buildSafeTelHref(hotline.number)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Call Now</span>
                </a>
                <button
                  type="button"
                  onClick={() => handleCopy(hotline.id, hotline.number)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Quota-Free Official Philippine Weather & Hazard Portals */}
      <section
        aria-label="Official Philippine Weather and Hazard Portals"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-sky-700" aria-hidden="true" />
          <h2 className="font-display text-base font-bold text-slate-900">
            Direct Official Weather &amp; Hazard Portals (No API Quota)
          </h2>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          Open verified DOST-PAGASA, UP Project NOAH, NDRRMC, and MMDA portals directly in a new tab.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {OFFICIAL_WEATHER_PORTALS.map((portal) => (
            <a
              key={portal.id}
              href={portal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3.5 transition-colors hover:border-slate-300 hover:bg-slate-100"
            >
              <div>
                <p className="font-display text-sm font-semibold text-slate-900">
                  {portal.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {portal.description}
                </p>
              </div>
              <ExternalLink
                className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
                aria-hidden="true"
              />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
