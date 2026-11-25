import { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Info,
  List,
  Map as MapIcon,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  ThumbsUp,
  UploadCloud,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { EMERGENCY_HOTLINES } from '../data/seedData';
import { EmergencyMapView } from './EmergencyMapView';
import { OfficialBulletinsPanel } from './OfficialBulletinsPanel';
import type {
  EvacuationCenter,
  FeedFilter,
  HazardReport,
  HazardSeverity,
} from '../types/alert';
import {
  buildSafeTelHref,
  formatClockTime,
  formatRelativeTime,
} from '../utils/formatters';

interface LiveFeedViewProps {
  reports: HazardReport[];
  queuedReports: HazardReport[];
  centers: EvacuationCenter[];
  filter: FeedFilter;
  searchQuery: string;
  confirmedIds: Set<string>;
  isOffline: boolean;
  simulatedOffline: boolean;
  isSyncing: boolean;
  isRefreshing: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  usingSupabase: boolean;
  supabaseConfigured: boolean;
  onFilterChange: (filter: FeedFilter) => void;
  onSearchChange: (q: string) => void;
  onConfirmReport: (reportId: string) => void;
  onToggleSimulatedOffline: () => void;
  onSyncNow: () => void;
  onManualRefresh: () => void;
  onOpenReportModal: () => void;
  onJumpToShelters: () => void;
}

const FILTER_OPTIONS: FeedFilter[] = [
  'All',
  'Flooded Roads',
  'Power/Comms',
  'Evacuation Update',
  'Relief/Rescue Needed',
  'Verified Only',
];

function SeverityLabel({ severity }: { severity: HazardSeverity }) {
  switch (severity) {
    case 'Critical':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
          <AlertOctagon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Critical</span>
        </span>
      );
    case 'Severe':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Severe</span>
        </span>
      );
    case 'Moderate':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Moderate</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Low</span>
        </span>
      );
  }
}

export function LiveFeedView({
  reports,
  queuedReports,
  centers,
  filter,
  searchQuery,
  confirmedIds,
  isOffline,
  simulatedOffline,
  isSyncing,
  isRefreshing,
  lastSyncedAt,
  lastSyncError,
  usingSupabase,
  supabaseConfigured,
  onFilterChange,
  onSearchChange,
  onConfirmReport,
  onToggleSimulatedOffline,
  onSyncNow,
  onManualRefresh,
  onOpenReportModal,
  onJumpToShelters,
}: LiveFeedViewProps) {
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const combinedReports = [...queuedReports, ...reports];
  const availableMunicipalities = Array.from(
    new Set([
      ...combinedReports.map((r) => r.municipality || 'Quezon City'),
      ...centers.map((c) => c.city),
    ])
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredReports = combinedReports.filter((item) => {
    const itemMuni = item.municipality || 'Quezon City';
    if (selectedMunicipality !== 'All' && itemMuni !== selectedMunicipality) {
      return false;
    }
    if (filter === 'Verified Only' && !item.is_verified) return false;
    if (
      filter !== 'All' &&
      filter !== 'Verified Only' &&
      item.category !== filter
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    return (
      item.barangay.toLowerCase().includes(normalizedQuery) ||
      itemMuni.toLowerCase().includes(normalizedQuery) ||
      (item.region || '').toLowerCase().includes(normalizedQuery) ||
      item.street_or_landmark.toLowerCase().includes(normalizedQuery) ||
      item.description.toLowerCase().includes(normalizedQuery) ||
      item.category.toLowerCase().includes(normalizedQuery)
    );
  });

  const activeCount = combinedReports.filter((r) => r.status === 'active').length;
  const verifiedCount = combinedReports.filter(
    (r) => r.is_verified && r.status === 'active'
  ).length;
  const openSheltersCount = centers.filter(
    (c) => c.status === 'Open' || c.status === 'Near Full'
  ).length;

  const filteredCenters = centers.filter((c) =>
    selectedMunicipality === 'All' ? true : c.city === selectedMunicipality
  );

  return (
    <div className="space-y-6">
      {/* Quick Emergency Hotlines Strip + Summary Metrics */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="grid grid-cols-2 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-white sm:grid-cols-4 lg:col-span-7">
          <div className="p-4">
            <p className="text-xs font-medium text-slate-500">Active Reports</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {activeCount}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs font-medium text-slate-500">Verified Alerts</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-700">
              {verifiedCount}
            </p>
          </div>
          <button
            type="button"
            onClick={onJumpToShelters}
            className="cursor-pointer p-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            <p className="text-xs font-medium text-slate-500">
              Available Shelters
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {openSheltersCount}
              <span className="text-sm font-normal text-slate-500">
                /{centers.length}
              </span>
            </p>
          </button>
          <div className="p-4">
            <p className="text-xs font-medium text-slate-500">Offline Queue</p>
            <p
              className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
                queuedReports.length > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {queuedReports.length}
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-slate-700">
              Quick Emergency Hotlines
            </h2>
            <span className="text-xs text-slate-500">Tap to call</span>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {EMERGENCY_HOTLINES.slice(0, 3).map((hl) => (
              <a
                key={hl.id}
                href={buildSafeTelHref(hl.number)}
                className="flex flex-col rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 transition-colors hover:border-slate-300 hover:bg-slate-100"
              >
                <span className="truncate text-[11px] font-medium text-slate-600">
                  {hl.shortLabel}
                </span>
                <span className="mt-0.5 inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums text-red-700">
                  <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{hl.number}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Official Weather & LGU Bulletins (Gemini + Google Search Grounding) */}
      <OfficialBulletinsPanel
        selectedMunicipality={selectedMunicipality}
        isOffline={isOffline}
      />

      {/* Workspace Toolbar: Search, Filter Tabs, Connectivity & Sync Controls */}
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search municipality, barangay, street, or landmark..."
                aria-label="Search alerts by municipality, barangay, street, or landmark"
                className="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <select
              value={selectedMunicipality}
              onChange={(e) => setSelectedMunicipality(e.target.value)}
              aria-label="Filter alerts by municipality"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-slate-900 focus:outline-none sm:w-52"
            >
              <option value="All">All Municipalities</option>
              {availableMunicipalities.map((muni) => (
                <option key={muni} value={muni}>
                  {muni}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Toggle feed display mode"
              className="inline-flex items-center rounded-md border border-slate-300 bg-slate-100 p-0.5"
            >
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                <span>List</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('map')}
                aria-pressed={viewMode === 'map'}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'map'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Map View</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleSimulatedOffline}
              className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                isOffline
                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
              title="Toggle offline simulation to test local cache and report sync queue"
            >
              {isOffline ? (
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              )}
              <span>
                {simulatedOffline
                  ? 'Simulated Offline (Go Online)'
                  : isOffline
                    ? 'Device Offline'
                    : 'Simulate Offline'}
              </span>
            </button>

            {queuedReports.length > 0 && (
              <button
                type="button"
                onClick={onSyncNow}
                disabled={isOffline || isSyncing}
                className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {isSyncing
                    ? 'Syncing...'
                    : `Sync Now (${queuedReports.length})`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onManualRefresh}
              disabled={isOffline || isRefreshing}
              className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Segmented Category Filter Tabs */}
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="tablist"
            aria-label="Filter reports by category"
            className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1"
          >
            {FILTER_OPTIONS.map((option) => {
              const active = filter === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onFilterChange(option)}
                  className={`cursor-pointer whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>

          <p
            className={`font-mono text-xs tabular-nums ${
              !isOffline && lastSyncError
                ? 'text-red-700'
                : usingSupabase
                  ? 'text-emerald-700'
                  : 'text-slate-500'
            }`}
          >
            {isOffline
              ? `Offline Cache · Synced ${formatClockTime(lastSyncedAt)}`
              : !supabaseConfigured
                ? 'Local Seed Mode (VITE_SUPABASE_* not set)'
                : lastSyncError
                  ? `Supabase Error: ${lastSyncError}`
                  : usingSupabase
                    ? `Supabase Live Connected · Synced ${formatClockTime(lastSyncedAt)}`
                    : `Supabase Configured (Awaiting Live Sync) · ${formatClockTime(lastSyncedAt)}`}
          </p>
        </div>
      </div>

      {/* Offline Resilience Notice when Offline */}
      {isOffline && (
        <div
          role="status"
          className="flex flex-col justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-2.5">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                Offline Cache Active — Shelters, hotlines, and recent alerts remain available.
              </p>
              <p className="text-xs text-amber-800">
                Any new hazard report you submit will be saved to your device queue and auto-synced when signal returns.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Map View OR Feed List */}
      {viewMode === 'map' ? (
        <EmergencyMapView
          centers={filteredCenters}
          reports={filteredReports}
          isOffline={isOffline}
          selectedMunicipality={selectedMunicipality}
        />
      ) : filteredReports.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="font-display text-base font-semibold text-slate-900">
            No matching alerts in this view
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Try clearing your barangay search or filter, or submit a community flood or hazard update right away without signing in.
          </p>
          <button
            type="button"
            onClick={onOpenReportModal}
            className="mt-4 cursor-pointer rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Submit Quick Report
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReports.map((report) => {
            const isConfirmed = confirmedIds.has(report.id);
            const isResolved = report.status === 'resolved';

            return (
              <article
                key={report.id}
                className={`rounded-lg border bg-white p-4 transition-colors sm:p-5 ${
                  report.queued_offline
                    ? 'border-amber-300 bg-amber-50/30'
                    : isResolved
                      ? 'border-slate-200 bg-slate-50/70'
                      : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Clean unboxed metadata row */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
                      <SeverityLabel severity={report.severity} />
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-medium text-slate-800">
                        {report.category}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span>
                        {report.barangay}
                        {report.municipality ? `, ${report.municipality}` : ''}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {formatRelativeTime(report.created_at)}
                      </span>
                    </div>

                    {/* Primary location headline */}
                    <h3 className="font-display flex items-start gap-1.5 text-base font-semibold text-slate-900">
                      <MapPin
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
                        aria-hidden="true"
                      />
                      <span>{report.street_or_landmark}</span>
                    </h3>

                    <p className="text-sm leading-relaxed text-slate-700">
                      {report.description}
                    </p>

                    {/* Structured details row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs">
                      {report.flood_level !== 'Not Applicable' && (
                        <span className="font-medium text-slate-700">
                          Depth:{' '}
                          <span className="font-mono text-slate-900">
                            {report.flood_level}
                          </span>
                        </span>
                      )}

                      {report.queued_offline ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-800">
                          <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Queued Offline · Will auto-sync</span>
                        </span>
                      ) : isResolved ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Resolved / Road Cleared</span>
                        </span>
                      ) : report.is_verified ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Verified by Barangay/Responder</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          Unverified Community Report · Pending responder review
                        </span>
                      )}

                      {report.contact_optional && (
                        <span className="font-mono tabular-nums text-slate-600">
                          Callback: {report.contact_optional}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick Confirmation Action */}
                  {!report.queued_offline && !isResolved && (
                    <div className="shrink-0 sm:pl-4">
                      <button
                        type="button"
                        onClick={() => onConfirmReport(report.id)}
                        disabled={isConfirmed}
                        className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                          isConfirmed
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {isConfirmed ? 'Confirmed Active' : 'Mark Still Active'}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500">
                          ({report.confirmations_count})
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
