import { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  List,
  Map as MapIcon,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Users,
  XCircle,
} from 'lucide-react';
import type {
  EvacuationCenter,
  EvacuationStatus,
  HazardReport,
} from '../types/alert';
import {
  buildSafeGoogleMapsUrl,
  formatRelativeTime,
} from '../utils/formatters';
import { EmergencyMapView } from './EmergencyMapView';

interface EvacuationDirectoryViewProps {
  centers: EvacuationCenter[];
  reports?: HazardReport[];
  isOffline: boolean;
  batterySaver?: boolean;
  isRefreshing: boolean;
  usingSupabase: boolean;
  supabaseConfigured: boolean;
  lastSyncError: string | null;
  onRefresh: () => void;
}

type StatusFilter = 'All' | EvacuationStatus;

const STATUS_FILTERS: StatusFilter[] = [
  'All',
  'Open',
  'Near Full',
  'Full',
  'Closed',
];

function StatusIndicator({ status }: { status: EvacuationStatus }) {
  switch (status) {
    case 'Open':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Open</span>
        </span>
      );
    case 'Near Full':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Near Full</span>
        </span>
      );
    case 'Full':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Full</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Closed</span>
        </span>
      );
  }
}

export function EvacuationDirectoryView({
  centers,
  reports = [],
  isOffline,
  batterySaver = false,
  isRefreshing,
  usingSupabase,
  supabaseConfigured,
  lastSyncError,
  onRefresh,
}: EvacuationDirectoryViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [routeCenterId, setRouteCenterId] = useState<string | null>(null);

  const availableMunicipalities = Array.from(
    new Set(centers.map((c) => c.city).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const normalized = query.trim().toLowerCase();
  const filtered = centers.filter((c) => {
    if (selectedMunicipality !== 'All' && c.city !== selectedMunicipality) {
      return false;
    }
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (!normalized) return true;
    return (
      c.name.toLowerCase().includes(normalized) ||
      c.barangay.toLowerCase().includes(normalized) ||
      c.city.toLowerCase().includes(normalized) ||
      (c.region || '').toLowerCase().includes(normalized) ||
      c.address.toLowerCase().includes(normalized)
    );
  });

  const totalOccupancy = centers.reduce((acc, c) => acc + c.current_occupancy, 0);
  const totalCapacity = centers.reduce((acc, c) => acc + c.max_capacity, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Evacuation Centers & Capacity Directory
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Verified local shelters cached offline for uninterrupted access during signal drops.
          </p>
          <p
            className={`mt-1.5 font-mono text-xs ${
              !isOffline && lastSyncError
                ? 'text-red-700'
                : usingSupabase
                  ? 'text-emerald-700'
                  : 'text-slate-500'
            }`}
          >
            {isOffline
              ? 'Source: Offline Cache'
              : !supabaseConfigured
                ? 'Source: Local Seed Mode (VITE_SUPABASE_* not set)'
                : lastSyncError
                  ? `Database Error: ${lastSyncError}`
                  : usingSupabase
                    ? 'Source: Supabase Live Connected'
                    : 'Source: Local Seed Cache'}
          </p>
        </div>

        <div className="flex items-baseline gap-6 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
          <div>
            <p className="text-xs text-slate-500">Total Evacuees</p>
            <p className="font-mono text-lg font-semibold tabular-nums text-slate-900">
              {totalOccupancy.toLocaleString()} / {totalCapacity.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Shelters Open</p>
            <p className="font-mono text-lg font-semibold tabular-nums text-emerald-700">
              {centers.filter((c) => c.status === 'Open' || c.status === 'Near Full').length}
            </p>
          </div>
        </div>
      </div>

      {/* Search & Status Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by shelter name, municipality, barangay, or street..."
              aria-label="Filter evacuation centers"
              className="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <select
            value={selectedMunicipality}
            onChange={(e) => setSelectedMunicipality(e.target.value)}
            aria-label="Filter evacuation centers by municipality"
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
            aria-label="Toggle shelter view mode"
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

          <div
            role="tablist"
            aria-label="Filter evacuation centers by availability"
            className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1"
          >
            {STATUS_FILTERS.map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(status)}
                  className={`cursor-pointer whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onRefresh}
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

      {viewMode === 'map' ? (
        <EmergencyMapView
          centers={filtered}
          reports={reports.filter((r) =>
            selectedMunicipality === 'All'
              ? true
              : (r.municipality || 'Quezon City') === selectedMunicipality
          )}
          isOffline={isOffline}
          batterySaver={batterySaver}
          selectedMunicipality={selectedMunicipality}
          initialRouteCenterId={routeCenterId}
          onClearInitialRoute={() => setRouteCenterId(null)}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
          <p className="font-display text-base font-semibold text-slate-900">
            No evacuation centers match this filter
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Select &ldquo;All&rdquo; to view full barangay shelter availability.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((center) => {
            const pct = Math.min(
              100,
              Math.round((center.current_occupancy / center.max_capacity) * 100)
            );
            const barColor =
              center.status === 'Full' || center.status === 'Closed'
                ? 'bg-red-600'
                : center.status === 'Near Full'
                  ? 'bg-amber-500'
                  : 'bg-emerald-600';

            return (
              <article
                key={center.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusIndicator status={center.status} />
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-medium text-slate-800">
                        {center.barangay} · {center.city}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-500">
                      Updated {formatRelativeTime(center.updated_at)}
                    </span>
                  </div>

                  <h2 className="font-display mt-2 text-base font-semibold text-slate-900">
                    {center.name}
                  </h2>

                  <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
                    <MapPin
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                    <span>{center.address}</span>
                  </p>

                  {/* Occupancy bar */}
                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600">
                        Current Occupancy
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900">
                        {center.current_occupancy} / {center.max_capacity} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {center.notes && (
                    <p className="mt-3 text-xs leading-relaxed text-slate-700">
                      {center.notes}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
                  <span className="font-mono text-slate-600">
                    {center.contact_info}
                  </span>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRouteCenterId(center.id);
                        setViewMode('map');
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                    >
                      <Navigation className="h-3 w-3" aria-hidden="true" />
                      <span>Find Safe Route</span>
                    </button>

                    <a
                      href={buildSafeGoogleMapsUrl(
                        center.latitude,
                        center.longitude
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900"
                    >
                      <span>Google Maps</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
