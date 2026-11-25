import { useState } from 'react';
import { Check, Copy, Phone } from 'lucide-react';
import { EMERGENCY_HOTLINES } from '../data/seedData';
import { buildSafeTelHref } from '../utils/formatters';

export function HotlinesView() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
        <h1 className="font-display text-xl font-bold text-slate-900">
          Emergency Hotlines & Rescue Dispatch
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Stored offline on your device. Tap any number on mobile to dial directly.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {EMERGENCY_HOTLINES.map((hotline) => {
          const isCopied = copiedId === hotline.id;
          return (
            <article
              key={hotline.id}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5"
            >
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {hotline.coverage}
                </p>
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
    </div>
  );
}
