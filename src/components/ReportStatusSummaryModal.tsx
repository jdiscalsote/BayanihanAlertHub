import { useEffect, useState } from 'react';
import { PieChart, X } from 'lucide-react';
import type { HazardReport } from '../types/alert';

interface ReportStatusSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  reports: HazardReport[];
  scopeLabel: string;
}

interface StatusSlice {
  key: 'pending' | 'verified' | 'dismissed';
  label: string;
  description: string;
  count: number;
  color: string;
  dotClass: string;
  badgeClass: string;
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number
): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function buildPieSlicePath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    'M',
    cx,
    cy,
    'L',
    start.x,
    start.y,
    'A',
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    'Z',
  ].join(' ');
}

export function ReportStatusSummaryModal({
  isOpen,
  onClose,
  reports,
  scopeLabel,
}: ReportStatusSummaryModalProps) {
  const [hoveredKey, setHoveredKey] = useState<StatusSlice['key'] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const dismissedCount = reports.filter((r) => r.status === 'dismissed').length;
  const verifiedCount = reports.filter(
    (r) => r.status !== 'dismissed' && (r.is_verified || r.status === 'resolved')
  ).length;
  const pendingCount = reports.filter(
    (r) => r.status === 'active' && !r.is_verified
  ).length;

  const total = pendingCount + verifiedCount + dismissedCount;

  const slices: StatusSlice[] = [
    {
      key: 'pending',
      label: 'Pending',
      description: 'Active community reports awaiting moderator verification',
      count: pendingCount,
      color: '#d97706',
      dotClass: 'bg-amber-600',
      badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
    },
    {
      key: 'verified',
      label: 'Verified',
      description: 'Verified active alerts and resolved hazard reports',
      count: verifiedCount,
      color: '#059669',
      dotClass: 'bg-emerald-600',
      badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    },
    {
      key: 'dismissed',
      label: 'Dismissed',
      description: 'Archived or dismissed reports hidden from the public feed',
      count: dismissedCount,
      color: '#64748b',
      dotClass: 'bg-slate-500',
      badgeClass: 'border-slate-200 bg-slate-100 text-slate-700',
    },
  ];

  const nonZeroSlices = slices.filter((s) => s.count > 0);
  const activeSlice = hoveredKey
    ? slices.find((s) => s.key === hoveredKey) ?? null
    : null;

  let cumulativeAngle = 0;
  const pieSegments = nonZeroSlices.map((slice) => {
    const sweepAngle = total > 0 ? (slice.count / total) * 360 : 0;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + sweepAngle;
    cumulativeAngle = endAngle;
    return {
      ...slice,
      startAngle,
      endAngle,
      percentage: total > 0 ? (slice.count / total) * 100 : 0,
    };
  });

  const cx = 110;
  const cy = 110;
  const radius = 92;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-summary-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-5 sm:rounded-xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-700">
              <PieChart className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="status-summary-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                Report Status Summary
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Scope:{' '}
                <span className="font-semibold text-slate-800">
                  {scopeLabel === 'All' ? 'All Municipalities' : scopeLabel}
                </span>{' '}
                ·{' '}
                <span className="font-mono tabular-nums">
                  {total} {total === 1 ? 'report' : 'reports'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close status summary"
            className="cursor-pointer rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {total === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-slate-700">
              No hazard reports available in this scope yet.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Switch Municipality Scope or refresh live records to view report
              status distribution.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid items-center gap-6 sm:grid-cols-12">
            {/* SVG Pie Chart */}
            <div className="flex flex-col items-center sm:col-span-5">
              <svg
                viewBox="0 0 220 220"
                className="h-52 w-52 overflow-visible"
                role="img"
                aria-label={`Pie chart of report statuses: Pending ${pendingCount}, Verified ${verifiedCount}, Dismissed ${dismissedCount}`}
              >
                {pieSegments.length === 1 ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={pieSegments[0].color}
                    stroke="var(--card-surface, #ffffff)"
                    strokeWidth={2}
                    className="cursor-pointer transition-opacity"
                    onMouseEnter={() => setHoveredKey(pieSegments[0].key)}
                    onMouseLeave={() => setHoveredKey(null)}
                  />
                ) : (
                  pieSegments.map((seg) => {
                    const isActive = hoveredKey === seg.key;
                    const isDimmed = hoveredKey !== null && !isActive;
                    return (
                      <path
                        key={seg.key}
                        d={buildPieSlicePath(
                          cx,
                          cy,
                          isActive ? radius + 4 : radius,
                          seg.startAngle,
                          seg.endAngle
                        )}
                        fill={seg.color}
                        stroke="var(--card-surface, #ffffff)"
                        strokeWidth={2}
                        opacity={isDimmed ? 0.55 : 1}
                        className="cursor-pointer transition-all"
                        onMouseEnter={() => setHoveredKey(seg.key)}
                        onMouseLeave={() => setHoveredKey(null)}
                      />
                    );
                  })
                )}
              </svg>

              <p className="mt-2 min-h-5 text-center text-xs font-medium text-slate-600">
                {activeSlice ? (
                  <span>
                    <span className="font-semibold text-slate-900">
                      {activeSlice.label}:
                    </span>{' '}
                    <span className="font-mono tabular-nums">
                      {activeSlice.count} (
                      {((activeSlice.count / total) * 100).toFixed(1)}%)
                    </span>
                  </span>
                ) : (
                  'Hover a slice or status row for details'
                )}
              </p>
            </div>

            {/* Breakdown Legend */}
            <div className="space-y-2.5 sm:col-span-7">
              {slices.map((slice) => {
                const pct =
                  total > 0 ? ((slice.count / total) * 100).toFixed(1) : '0.0';
                const isHighlighted = hoveredKey === slice.key;
                return (
                  <div
                    key={slice.key}
                    onMouseEnter={() => setHoveredKey(slice.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                    className={`rounded-md border p-3 transition-colors ${
                      isHighlighted
                        ? 'border-slate-300 bg-slate-100'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-3 w-3 shrink-0 rounded-full ${slice.dotClass}`}
                          aria-hidden="true"
                        />
                        <span className="text-sm font-semibold text-slate-900">
                          {slice.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
                          {slice.count}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${slice.badgeClass}`}
                        >
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {slice.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
