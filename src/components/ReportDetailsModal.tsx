import { useEffect } from 'react';
import {
  Archive,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import type { HazardReport, ModeratorProfile } from '../types/alert';
import {
  buildSafeGoogleMapsUrl,
  formatExactTimestamp,
  formatRelativeTime,
} from '../utils/formatters';

interface ReportDetailsModalProps {
  report: HazardReport | null;
  onClose: () => void;
  currentModerator: ModeratorProfile | null;
  responders: ModeratorProfile[];
}

interface TimelineEvent {
  id: string;
  title: string;
  timestamp: string;
  detail: string;
  tone: 'neutral' | 'emerald' | 'amber' | 'slate';
}

export function ReportDetailsModal({
  report,
  onClose,
  currentModerator,
  responders,
}: ReportDetailsModalProps) {
  useEffect(() => {
    if (!report) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [report, onClose]);

  if (!report) return null;

  const resolveModeratorLabel = (
    modId?: string | null,
    modName?: string | null,
    fallback = 'Recorded Responder'
  ): string => {
    if (modName && modName.trim()) {
      return modName.trim();
    }
    if (modId) {
      if (currentModerator && currentModerator.id === modId) {
        return `${currentModerator.full_name} (${currentModerator.barangay_assigned})`;
      }
      const matched = responders.find((r) => r.id === modId);
      if (matched) {
        return `${matched.full_name} (${matched.barangay_assigned})`;
      }
      return `Moderator ID: ${modId.slice(0, 8)}…`;
    }
    return fallback;
  };

  const lastUpdatedIso =
    report.updated_at ||
    report.dismissed_at ||
    report.verified_at ||
    report.created_at;

  const timelineEvents: TimelineEvent[] = [
    {
      id: 'created',
      title: 'Report Created',
      timestamp: report.created_at,
      detail: report.queued_offline
        ? 'Submitted while offline (queued locally)'
        : 'Submitted from community hazard reporter',
      tone: 'neutral',
    },
  ];

  if (report.is_verified || report.verified_at) {
    const verifier = resolveModeratorLabel(
      report.verified_by,
      report.verified_by_name,
      'Verified Moderator'
    );
    timelineEvents.push({
      id: 'verified',
      title: 'Verified by Moderator',
      timestamp:
        report.verified_at || report.updated_at || report.created_at,
      detail: `Verified by ${verifier}`,
      tone: 'emerald',
    });
  }

  if (report.status === 'resolved') {
    const resolver = resolveModeratorLabel(
      report.verified_by,
      report.verified_by_name,
      'Responder Team'
    );
    timelineEvents.push({
      id: 'resolved',
      title: 'Marked Resolved',
      timestamp:
        report.updated_at || report.verified_at || report.created_at,
      detail: `Resolved under ${resolver}`,
      tone: 'emerald',
    });
  }

  if (report.status === 'dismissed') {
    const dismisser = resolveModeratorLabel(
      report.dismissed_by,
      report.dismissed_by_name,
      'Moderator'
    );
    timelineEvents.push({
      id: 'dismissed',
      title: 'Dismissed / Archived',
      timestamp:
        report.dismissed_at || report.updated_at || report.created_at,
      detail: `Dismissed by ${dismisser}`,
      tone: 'slate',
    });
  }

  const currentStatusLabel =
    report.status === 'dismissed'
      ? 'Dismissed'
      : report.status === 'resolved'
        ? 'Resolved'
        : report.is_verified
          ? 'Verified Active'
          : 'Pending Verification';

  timelineEvents.push({
    id: 'last-updated',
    title: 'Last Updated',
    timestamp: lastUpdatedIso,
    detail: `Current status: ${currentStatusLabel}`,
    tone:
      report.status === 'dismissed'
        ? 'slate'
        : report.is_verified || report.status === 'resolved'
          ? 'emerald'
          : 'amber',
  });

  const statusBadgeClass =
    report.status === 'dismissed'
      ? 'border-slate-300 bg-slate-100 text-slate-700'
      : report.status === 'resolved' || report.is_verified
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-amber-200 bg-amber-50 text-amber-800';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-details-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-5 sm:rounded-xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-semibold ${statusBadgeClass}`}
              >
                {report.status === 'dismissed' ? (
                  <Archive className="h-3 w-3" aria-hidden="true" />
                ) : report.is_verified || report.status === 'resolved' ? (
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Clock className="h-3 w-3" aria-hidden="true" />
                )}
                <span>{currentStatusLabel}</span>
              </span>
              <span className="font-semibold text-slate-800">
                {report.severity}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-600">{report.category}</span>
            </div>
            <h2
              id="report-details-title"
              className="font-display mt-2 text-lg font-bold text-slate-900"
            >
              {report.street_or_landmark}
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {report.barangay}
              {report.municipality ? `, ${report.municipality}` : ''}
              {report.region ? ` · ${report.region}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close report details"
            className="cursor-pointer rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Report Details Metadata */}
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-xs font-semibold text-slate-700">
              Report Description
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-800">
              {report.description}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-medium text-slate-500">
                Flood Level
              </p>
              <p className="mt-0.5 text-xs font-semibold text-slate-900">
                {report.flood_level}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-medium text-slate-500">
                Community Confirmations
              </p>
              <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-slate-900">
                {report.confirmations_count}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-medium text-slate-500">
                Reporter Contact
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-slate-900">
                {report.contact_optional ? (
                  <>
                    <Phone className="h-3 w-3 text-slate-500" aria-hidden="true" />
                    <span className="font-mono tabular-nums">
                      {report.contact_optional}
                    </span>
                  </>
                ) : (
                  'Not provided'
                )}
              </p>
            </div>
          </div>

          {typeof report.latitude === 'number' &&
            typeof report.longitude === 'number' && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-700">
                  <MapPin className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  <span>
                    {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                  </span>
                </span>
                <a
                  href={buildSafeGoogleMapsUrl(
                    report.latitude,
                    report.longitude
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-700"
                >
                  Open in Google Maps
                </a>
              </div>
            )}

          {/* Timeline Log */}
          <section
            aria-labelledby="report-timeline-heading"
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <h3
                id="report-timeline-heading"
                className="font-display inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900"
              >
                <Clock className="h-4 w-4 text-slate-600" aria-hidden="true" />
                <span>Timeline</span>
              </h3>
              <span className="font-mono text-[11px] tabular-nums text-slate-500">
                ID: {report.id.slice(0, 8)}
              </span>
            </div>

            <ol className="mt-3.5 space-y-3.5">
              {timelineEvents.map((evt, index) => {
                const isLast = index === timelineEvents.length - 1;
                const dotColorClass =
                  evt.tone === 'emerald'
                    ? 'bg-emerald-600'
                    : evt.tone === 'amber'
                      ? 'bg-amber-600'
                      : evt.tone === 'slate'
                        ? 'bg-slate-500'
                        : 'bg-slate-700';

                return (
                  <li key={evt.id} className="relative flex gap-3 pl-1">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotColorClass}`}
                        aria-hidden="true"
                      />
                      {!isLast && (
                        <span
                          className="mt-1 h-full w-px bg-slate-200"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="text-xs font-semibold text-slate-900">
                          {evt.title}
                        </p>
                        <p className="font-mono text-[11px] tabular-nums text-slate-600">
                          {formatExactTimestamp(evt.timestamp)} (
                          {formatRelativeTime(evt.timestamp)})
                        </p>
                      </div>
                      <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-slate-600">
                        {(evt.id === 'verified' || evt.id === 'dismissed') && (
                          <UserCheck
                            className="h-3.5 w-3.5 shrink-0 text-slate-500"
                            aria-hidden="true"
                          />
                        )}
                        {evt.id === 'resolved' && (
                          <CheckCircle2
                            className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                            aria-hidden="true"
                          />
                        )}
                        <span>{evt.detail}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

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
