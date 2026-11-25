import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import type { Advisory } from '../types/alert';
import { formatRelativeTime } from '../utils/formatters';

interface AdvisoryStripProps {
  advisories: Advisory[];
}

function formatAdvisoryScope(adv: Advisory): string {
  if (!adv.municipality || adv.municipality === 'All Municipalities') {
    return adv.municipality || adv.barangay;
  }
  if (!adv.barangay || adv.barangay === 'Citywide') {
    return `${adv.municipality} (Citywide)`;
  }
  return `${adv.barangay}, ${adv.municipality}`;
}

export function AdvisoryStrip({ advisories }: AdvisoryStripProps) {
  const [expanded, setExpanded] = useState(false);

  if (advisories.length === 0) return null;

  const primary = advisories[0];
  const remaining = advisories.slice(1);

  return (
    <section
      aria-label="Official LGU and PAGASA Advisories"
      className="border-b border-slate-800 bg-slate-900 text-slate-100"
    >
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide text-slate-300">
              {primary.severity === 'Critical' ? (
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              )}
              <span
                className={
                  primary.severity === 'Critical'
                    ? 'font-semibold text-red-300'
                    : primary.severity === 'Warning'
                      ? 'font-semibold text-amber-300'
                      : 'font-semibold text-sky-300'
                }
              >
                {primary.severity} Official Advisory
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatAdvisoryScope(primary)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-400">
                {formatRelativeTime(primary.created_at)}
              </span>
            </div>

            <h2 className="font-display text-base font-semibold text-white">
              {primary.title}
            </h2>
            <p className="max-w-4xl text-sm leading-relaxed text-slate-300">
              {primary.message}
            </p>
          </div>

          {remaining.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex cursor-pointer items-center gap-1.5 self-start whitespace-nowrap shrink-0 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <span>
                {expanded
                  ? 'Hide other advisories'
                  : `${remaining.length} more ${remaining.length === 1 ? 'advisory' : 'advisories'}`}
              </span>
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {expanded && remaining.length > 0 && (
          <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 md:grid-cols-2">
            {remaining.map((adv) => (
              <article
                key={adv.id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span
                    className={
                      adv.severity === 'Critical'
                        ? 'font-semibold text-red-300'
                        : adv.severity === 'Warning'
                          ? 'font-semibold text-amber-300'
                          : 'font-semibold text-sky-300'
                    }
                  >
                    {adv.severity}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatAdvisoryScope(adv)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {formatRelativeTime(adv.created_at)}
                  </span>
                </div>
                <h3 className="mt-1 text-sm font-semibold text-white">
                  {adv.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  {adv.message}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
