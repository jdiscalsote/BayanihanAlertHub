import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  LogOut,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { isSupabaseConfigured, isUuid } from '../services/supabaseClient';
import type {
  Advisory,
  AdvisorySeverity,
  EvacuationCenter,
  EvacuationStatus,
  HazardReport,
  ModeratorProfile,
  NewEvacuationCenterDraft,
  ReportStatus,
  SafetyCheckin,
} from '../types/alert';
import { formatRelativeTime } from '../utils/formatters';
import { LocationSelector } from './LocationSelector';

interface ModeratorConsoleViewProps {
  moderator: ModeratorProfile | null;
  reports: HazardReport[];
  centers: EvacuationCenter[];
  advisories: Advisory[];
  checkins: SafetyCheckin[];
  checkinSyncError: string | null;
  onSignIn: (email: string, password: string) => Promise<void>;
  onDemoSignIn: () => void;
  onSignOut: () => Promise<void>;
  onModerateReport: (
    reportId: string,
    updates: { is_verified?: boolean; status?: ReportStatus }
  ) => Promise<void>;
  onDeleteReport: (reportId: string) => Promise<void>;
  onUpdateCenter: (
    centerId: string,
    updates: {
      status: EvacuationStatus;
      current_occupancy: number;
      notes: string;
    }
  ) => Promise<void>;
  onCreateCenter: (draft: NewEvacuationCenterDraft) => Promise<void>;
  onDeleteCenter: (centerId: string) => Promise<void>;
  onCreateAdvisory: (input: {
    title: string;
    message: string;
    severity: AdvisorySeverity;
    region: string;
    municipality: string;
    barangay: string;
  }) => Promise<void>;
  onArchiveAdvisory: (advisoryId: string) => Promise<void>;
  onDeleteAdvisory: (advisoryId: string) => Promise<void>;
  onDeleteCheckin: (checkinId: string) => Promise<void>;
  onRefreshLiveData: () => Promise<void>;
}

type ConsoleTab = 'triage' | 'shelters' | 'advisories' | 'checkins';

export function ModeratorConsoleView({
  moderator,
  reports,
  centers,
  advisories,
  checkins,
  checkinSyncError,
  onSignIn,
  onDemoSignIn,
  onSignOut,
  onModerateReport,
  onDeleteReport,
  onUpdateCenter,
  onCreateCenter,
  onDeleteCenter,
  onCreateAdvisory,
  onArchiveAdvisory,
  onDeleteAdvisory,
  onDeleteCheckin,
  onRefreshLiveData,
}: ModeratorConsoleViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('triage');
  const [managedMunicipality, setManagedMunicipality] = useState<string>('All');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [checkinSearch, setCheckinSearch] = useState('');

  // Shelter edit draft state keyed by center id
  const [editingCenterId, setEditingCenterId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<EvacuationStatus>('Open');
  const [draftOccupancy, setDraftOccupancy] = useState<number>(0);
  const [draftNotes, setDraftNotes] = useState<string>('');

  // Add new shelter state
  const [showAddCenter, setShowAddCenter] = useState(false);
  const [newCenterName, setNewCenterName] = useState('');
  const [newCenterRegion, setNewCenterRegion] = useState(
    'National Capital Region (NCR)'
  );
  const [newCenterMunicipality, setNewCenterMunicipality] =
    useState('Quezon City');
  const [newCenterBarangay, setNewCenterBarangay] = useState(
    'Brgy. Bagong Silangan'
  );
  const [newCenterAddress, setNewCenterAddress] = useState('');
  const [newCenterCapacity, setNewCenterCapacity] = useState<number>(250);
  const [newCenterOccupancy, setNewCenterOccupancy] = useState<number>(0);
  const [newCenterStatus, setNewCenterStatus] =
    useState<EvacuationStatus>('Open');
  const [newCenterContact, setNewCenterContact] = useState('');
  const [newCenterNotes, setNewCenterNotes] = useState('');
  const [newCenterLat, setNewCenterLat] = useState<string>('14.6760');
  const [newCenterLng, setNewCenterLng] = useState<string>('121.0437');

  // Advisory compose state
  const [advTitle, setAdvTitle] = useState('');
  const [advSeverity, setAdvSeverity] = useState<AdvisorySeverity>('Warning');
  const [advAllMunicipalities, setAdvAllMunicipalities] = useState(false);
  const [advRegion, setAdvRegion] = useState('National Capital Region (NCR)');
  const [advMunicipality, setAdvMunicipality] = useState('Quezon City');
  const [advBarangay, setAdvBarangay] = useState('Citywide');
  const [advMessage, setAdvMessage] = useState('');

  useEffect(() => {
    const assigned = moderator?.municipality_assigned?.trim();
    if (assigned && assigned !== 'All Municipalities') {
      setManagedMunicipality(assigned);
      setNewCenterMunicipality(assigned);
      setAdvMunicipality(assigned);
      setAdvAllMunicipalities(false);
    } else {
      setManagedMunicipality('All');
    }
  }, [moderator?.id, moderator?.municipality_assigned]);

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setSigningIn(true);
    try {
      await onSignIn(email, password);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to authenticate.'
      );
    } finally {
      setSigningIn(false);
    }
  }

  function showToast(msg: string) {
    setActionError(null);
    setActionNotice(msg);
    setTimeout(() => {
      setActionNotice((curr) => (curr === msg ? null : curr));
    }, 3000);
  }

  async function runAction(task: () => Promise<void>, successMessage: string) {
    setActionError(null);
    setIsSaving(true);
    try {
      await task();
      setConfirmDeleteKey(null);
      showToast(successMessage);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to save moderator update.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  function renderDeleteControl(
    deleteKey: string,
    onConfirm: () => Promise<void>,
    successMessage: string,
    label = 'Delete'
  ) {
    if (confirmDeleteKey === deleteKey) {
      return (
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void runAction(onConfirm, successMessage)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Confirm Delete</span>
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => setConfirmDeleteKey(null)}
            className="cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        disabled={isSaving}
        onClick={() => setConfirmDeleteKey(deleteKey)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }

  if (!moderator) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2.5">
          <Shield className="h-5 w-5 text-slate-900" aria-hidden="true" />
          <h1 className="font-display text-lg font-bold text-slate-900">
            Barangay Responder & Moderator Login
          </h1>
        </div>
        <p className="mt-1.5 text-sm text-slate-600">
          Residents do not need an account to view alerts or report hazards. Sign in only if you are an authorized barangay or DRRMO moderator.
        </p>

        {authError && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
          >
            {authError}
          </div>
        )}

        <form onSubmit={handleLoginSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="mod-email"
              className="block text-xs font-semibold text-slate-700"
            >
              Responder Email
            </label>
            <input
              id="mod-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="responder@barangay.gov.ph"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="mod-password"
              className="block text-xs font-semibold text-slate-700"
            >
              Password
            </label>
            <input
              id="mod-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={signingIn}
            className="w-full cursor-pointer rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {signingIn ? 'Verifying...' : 'Sign In with Supabase Auth'}
          </button>
        </form>

        {!isSupabaseConfigured && (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="text-xs text-slate-600">
              Supabase environment keys are not configured in this preview yet. You can inspect the responder console in local preview mode:
            </p>
            <button
              type="button"
              onClick={onDemoSignIn}
              className="mt-2.5 w-full cursor-pointer rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
            >
              Enter Local Preview Responder Session
            </button>
          </div>
        )}
      </div>
    );
  }

  const assignedMuni = moderator.municipality_assigned?.trim();
  const hasSpecificAssignment =
    Boolean(assignedMuni) && assignedMuni !== 'All Municipalities';
  const isMunicipalityLocked =
    moderator.role !== 'admin' && hasSpecificAssignment;
  const effectiveMunicipality = isMunicipalityLocked
    ? (assignedMuni as string)
    : managedMunicipality;

  const availableMunicipalities = Array.from(
    new Set([
      ...(hasSpecificAssignment && assignedMuni ? [assignedMuni] : []),
      ...reports.map((r) => r.municipality || 'Quezon City'),
      ...centers.map((c) => c.city),
      ...checkins.map((c) => c.municipality || 'Quezon City'),
      ...advisories
        .map((a) => a.municipality || '')
        .filter((m) => m && m !== 'All Municipalities'),
    ])
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const scopedReports =
    effectiveMunicipality === 'All'
      ? reports
      : reports.filter(
          (r) =>
            (r.municipality || 'Quezon City').toLowerCase() ===
            effectiveMunicipality.toLowerCase()
        );

  const scopedCenters =
    effectiveMunicipality === 'All'
      ? centers
      : centers.filter(
          (c) => c.city.toLowerCase() === effectiveMunicipality.toLowerCase()
        );

  const scopedAdvisories =
    effectiveMunicipality === 'All'
      ? advisories
      : advisories.filter((a) => {
          const advMuni = (a.municipality || 'Quezon City').toLowerCase();
          if (isMunicipalityLocked) {
            return advMuni === effectiveMunicipality.toLowerCase();
          }
          return (
            a.municipality === 'All Municipalities' ||
            advMuni === effectiveMunicipality.toLowerCase()
          );
        });

  const scopedCheckins = (
    effectiveMunicipality === 'All'
      ? checkins
      : checkins.filter(
          (c) =>
            (c.municipality || 'Quezon City').toLowerCase() ===
            effectiveMunicipality.toLowerCase()
        )
  ).filter((c) => {
    const q = checkinSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.full_name.toLowerCase().includes(q) ||
      c.barangay.toLowerCase().includes(q) ||
      c.municipality.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q) ||
      (c.evacuation_center || '').toLowerCase().includes(q)
    );
  });

  const pendingReports = scopedReports.filter(
    (r) => !r.is_verified && r.status === 'active'
  );
  const verifiedOrResolved = scopedReports.filter(
    (r) => r.is_verified || r.status === 'resolved'
  );

  return (
    <div className="space-y-6">
      {/* Authenticated Moderator Header */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-medium text-emerald-700">
            Authenticated {moderator.role.toUpperCase()} ·{' '}
            {moderator.barangay_assigned}
            {hasSpecificAssignment ? ` · Assigned to ${assignedMuni}` : ''}
          </p>
          <h1 className="font-display mt-0.5 text-xl font-bold text-slate-900">
            Responder Console — {moderator.full_name}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isMunicipalityLocked ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800">
              Jurisdiction: {effectiveMunicipality}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label
                htmlFor="console-muni-scope"
                className="text-xs font-semibold text-slate-600"
              >
                Municipality Scope
              </label>
              <select
                id="console-muni-scope"
                value={effectiveMunicipality}
                onChange={(e) => setManagedMunicipality(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-slate-900 focus:outline-none"
              >
                <option value="All">All Municipalities</option>
                {availableMunicipalities.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => void onSignOut()}
            className="inline-flex cursor-pointer items-center gap-1.5 self-start whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800"
        >
          {actionError}
        </div>
      )}

      {actionNotice && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900"
        >
          {actionNotice}
        </div>
      )}

      {/* Console Sub-Navigation */}
      <div
        role="tablist"
        aria-label="Responder Console Sections"
        className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={consoleTab === 'triage'}
          onClick={() => setConsoleTab('triage')}
          className={`cursor-pointer rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
            consoleTab === 'triage'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Report Triage ({pendingReports.length} pending)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={consoleTab === 'shelters'}
          onClick={() => setConsoleTab('shelters')}
          className={`cursor-pointer rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
            consoleTab === 'shelters'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Evacuation Capacity ({scopedCenters.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={consoleTab === 'advisories'}
          onClick={() => setConsoleTab('advisories')}
          className={`cursor-pointer rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
            consoleTab === 'advisories'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Official Advisories ({scopedAdvisories.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={consoleTab === 'checkins'}
          onClick={() => setConsoleTab('checkins')}
          className={`cursor-pointer rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
            consoleTab === 'checkins'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Family Check-Ins ({scopedCheckins.length})
        </button>
      </div>

      {/* TAB 1: REPORT TRIAGE */}
      {consoleTab === 'triage' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Unverified Community Reports ({pendingReports.length})
              </h2>
            </div>

            {pendingReports.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                All active community reports have been reviewed.
              </p>
            ) : (
              <div className="divide-y divide-slate-200">
                {pendingReports.map((rep) => (
                  <div
                    key={rep.id}
                    className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-900">
                          {rep.severity}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{rep.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {rep.barangay}
                          {rep.municipality ? `, ${rep.municipality}` : ''}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatRelativeTime(rep.created_at)}
                        </span>
                      </div>
                      <p className="font-display text-sm font-semibold text-slate-900">
                        {rep.street_or_landmark}
                      </p>
                      <p className="text-xs text-slate-700">{rep.description}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            () => onModerateReport(rep.id, { is_verified: true }),
                            `Verified report at ${rep.street_or_landmark}.`
                          )
                        }
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Verify</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            () =>
                              onModerateReport(rep.id, {
                                is_verified: true,
                                status: 'resolved',
                              }),
                            'Marked report resolved.'
                          )
                        }
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Resolve</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            () => onModerateReport(rep.id, { status: 'dismissed' }),
                            'Dismissed report from public feed.'
                          )
                        }
                        className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Dismiss
                      </button>
                      {renderDeleteControl(
                        `report:${rep.id}`,
                        () => onDeleteReport(rep.id),
                        `Permanently deleted report at ${rep.street_or_landmark}.`
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verified / Active Management */}
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Verified & Resolved Reports ({verifiedOrResolved.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-200">
              {verifiedOrResolved.map((rep) => (
                <div
                  key={rep.id}
                  className="flex flex-col justify-between gap-3 px-5 py-3.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {rep.barangay}
                      {rep.municipality ? `, ${rep.municipality}` : ''} —{' '}
                      {rep.street_or_landmark}
                    </p>
                    <p className="text-xs text-slate-500">
                      {rep.category} · {rep.status === 'resolved' ? 'Resolved' : 'Verified Active'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {rep.status !== 'resolved' && (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            () => onModerateReport(rep.id, { status: 'resolved' }),
                            'Report marked as resolved.'
                          )
                        }
                        className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Mark Resolved
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () => onModerateReport(rep.id, { status: 'dismissed' }),
                          'Report archived.'
                        )
                      }
                      className="cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Archive
                    </button>
                    {renderDeleteControl(
                      `report:${rep.id}`,
                      () => onDeleteReport(rep.id),
                      `Permanently deleted report at ${rep.street_or_landmark}.`
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: EVACUATION CAPACITY */}
      {consoleTab === 'shelters' && (
        <div className="space-y-4">
          {isSupabaseConfigured && centers.some((c) => !isUuid(c.id)) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
              <span>
                Local seed shelters are currently loaded. Sync live Supabase rows before saving changes.
              </span>
              <button
                type="button"
                onClick={() =>
                  void runAction(onRefreshLiveData, 'Loaded live Supabase records.')
                }
                className="cursor-pointer rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Load Live Records
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              Showing {scopedCenters.length} evacuation{' '}
              {scopedCenters.length === 1 ? 'center' : 'centers'}
              {effectiveMunicipality !== 'All'
                ? ` in ${effectiveMunicipality}`
                : ''}
              .
            </p>
            <button
              type="button"
              onClick={() => setShowAddCenter((prev) => !prev)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {showAddCenter ? 'Close New Shelter Form' : 'Add Evacuation Center'}
              </span>
            </button>
          </div>

          {showAddCenter && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !newCenterName.trim() ||
                  !newCenterMunicipality.trim() ||
                  !newCenterBarangay.trim() ||
                  !newCenterAddress.trim()
                ) {
                  setActionError(
                    'Please select a region, municipality, and barangay, and enter shelter name and address.'
                  );
                  return;
                }
                const parsedLat = Number.parseFloat(newCenterLat);
                const parsedLng = Number.parseFloat(newCenterLng);
                void runAction(async () => {
                  await onCreateCenter({
                    name: newCenterName.trim(),
                    region: newCenterRegion.trim(),
                    city: isMunicipalityLocked
                      ? effectiveMunicipality
                      : newCenterMunicipality.trim(),
                    barangay: newCenterBarangay.trim(),
                    address: newCenterAddress.trim(),
                    latitude: Number.isFinite(parsedLat) ? parsedLat : 14.5995,
                    longitude: Number.isFinite(parsedLng) ? parsedLng : 120.9842,
                    status: newCenterStatus,
                    current_occupancy: Math.max(0, Math.round(newCenterOccupancy)),
                    max_capacity: Math.max(1, Math.round(newCenterCapacity)),
                    notes: newCenterNotes.trim(),
                    contact_info: newCenterContact.trim() || 'Local DRRMO',
                  });
                  setNewCenterName('');
                  setNewCenterAddress('');
                  setNewCenterContact('');
                  setNewCenterNotes('');
                  setNewCenterOccupancy(0);
                  setShowAddCenter(false);
                }, `Added ${newCenterName.trim()} (${isMunicipalityLocked ? effectiveMunicipality : newCenterMunicipality.trim()}).`);
              }}
              className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Register New Evacuation Center
              </h2>

              <LocationSelector
                region={newCenterRegion}
                municipality={
                  isMunicipalityLocked
                    ? effectiveMunicipality
                    : newCenterMunicipality
                }
                barangay={newCenterBarangay}
                lockedMunicipality={
                  isMunicipalityLocked ? effectiveMunicipality : undefined
                }
                onChange={(next) => {
                  setNewCenterRegion(next.region);
                  setNewCenterMunicipality(next.municipality);
                  setNewCenterBarangay(next.barangay);
                }}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Shelter Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCenterName}
                    onChange={(e) => setNewCenterName(e.target.value)}
                    placeholder="e.g. Marikina Sports Center Gymnasium"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Street Address *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCenterAddress}
                    onChange={(e) => setNewCenterAddress(e.target.value)}
                    placeholder="e.g. Sumulong Highway, Sto. Niño"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Initial Status
                  </label>
                  <select
                    value={newCenterStatus}
                    onChange={(e) =>
                      setNewCenterStatus(e.target.value as EvacuationStatus)
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="Open">Open</option>
                    <option value="Near Full">Near Full</option>
                    <option value="Full">Full</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Max Capacity *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={newCenterCapacity}
                    onChange={(e) =>
                      setNewCenterCapacity(
                        e.target.value === '' ? 1 : Number(e.target.value)
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Current Evacuees
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newCenterOccupancy}
                    onChange={(e) =>
                      setNewCenterOccupancy(
                        e.target.value === '' ? 0 : Number(e.target.value)
                      )
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Contact Desk / Number
                  </label>
                  <input
                    type="text"
                    value={newCenterContact}
                    onChange={(e) => setNewCenterContact(e.target.value)}
                    placeholder="e.g. CDRRMO 161"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Access / Supply Notes
                  </label>
                  <input
                    type="text"
                    value={newCenterNotes}
                    onChange={(e) => setNewCenterNotes(e.target.value)}
                    placeholder="e.g. Elevated courts open, generator power online"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Latitude
                  </label>
                  <input
                    type="text"
                    value={newCenterLat}
                    onChange={(e) => setNewCenterLat(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Longitude
                  </label>
                  <input
                    type="text"
                    value={newCenterLng}
                    onChange={(e) => setNewCenterLng(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="cursor-pointer rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {isSaving ? 'Creating...' : 'Save Evacuation Center'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddCenter(false)}
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {scopedCenters.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No evacuation centers found for {effectiveMunicipality}. Use &ldquo;Add Evacuation Center&rdquo; above to register one.
              </p>
            ) : (
              scopedCenters.map((center) => {
                const isEditing = editingCenterId === center.id;
                return (
                  <div key={center.id} className="p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div>
                        <p className="text-xs font-medium text-slate-500">
                          {center.barangay} · {center.city} · {center.status}
                        </p>
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          {center.name}
                        </h3>
                        <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-600">
                          Occupancy: {center.current_occupancy} / {center.max_capacity}
                        </p>
                      </div>

                    {!isEditing && (
                      <div className="flex flex-wrap items-center gap-2 self-start">
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setEditingCenterId(center.id);
                            setDraftStatus(center.status);
                            setDraftOccupancy(center.current_occupancy);
                            setDraftNotes(center.notes);
                          }}
                          className="cursor-pointer rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          Update Status & Headcount
                        </button>
                        {renderDeleteControl(
                          `center:${center.id}`,
                          () => onDeleteCenter(center.id),
                          `Deleted evacuation center ${center.name}.`
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const safeOccupancy = Number.isFinite(draftOccupancy)
                          ? Math.max(0, Math.round(draftOccupancy))
                          : 0;
                        void runAction(async () => {
                          await onUpdateCenter(center.id, {
                            status: draftStatus,
                            current_occupancy: safeOccupancy,
                            notes: draftNotes,
                          });
                          setEditingCenterId(null);
                        }, `Updated ${center.name}.`);
                      }}
                      className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3"
                    >
                      {actionError && (
                        <div
                          role="alert"
                          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 sm:col-span-3"
                        >
                          {actionError}
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Shelter Status
                        </label>
                        <select
                          value={draftStatus}
                          onChange={(e) =>
                            setDraftStatus(e.target.value as EvacuationStatus)
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="Open">Open</option>
                          <option value="Near Full">Near Full</option>
                          <option value="Full">Full</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Current Evacuees (Max {center.max_capacity})
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={draftOccupancy}
                          onChange={(e) =>
                            setDraftOccupancy(
                              e.target.value === '' ? 0 : Number(e.target.value)
                            )
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-xs font-semibold text-slate-700">
                          Access / Supply Notes
                        </label>
                        <input
                          type="text"
                          value={draftNotes}
                          onChange={(e) => setDraftNotes(e.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="flex items-center gap-2 sm:col-span-3">
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="cursor-pointer rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {isSaving ? 'Saving...' : 'Save Shelter Update'}
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => {
                            setActionError(null);
                            setEditingCenterId(null);
                          }}
                          className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: OFFICIAL ADVISORIES */}
      {consoleTab === 'advisories' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (advTitle.trim().length < 4 || advMessage.trim().length < 10) {
                return;
              }
              const targetRegion =
                !isMunicipalityLocked && advAllMunicipalities
                  ? 'Philippines (Nationwide)'
                  : advRegion;
              const targetMunicipality = isMunicipalityLocked
                ? effectiveMunicipality
                : advAllMunicipalities
                  ? 'All Municipalities'
                  : advMunicipality.trim() || 'All Municipalities';
              const targetBarangay =
                !isMunicipalityLocked && advAllMunicipalities
                  ? 'All Barangays'
                  : advBarangay.trim() || 'Citywide';
              void runAction(async () => {
                await onCreateAdvisory({
                  title: advTitle.trim(),
                  message: advMessage.trim(),
                  severity: advSeverity,
                  region: targetRegion,
                  municipality: targetMunicipality,
                  barangay: targetBarangay,
                });
                setAdvTitle('');
                setAdvMessage('');
              }, 'Official advisory published to live banner.');
            }}
            className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-6"
          >
            <h2 className="font-display text-base font-semibold text-slate-900">
              Publish Official Advisory
            </h2>

            <div>
              <label
                htmlFor="adv-title"
                className="block text-xs font-semibold text-slate-700"
              >
                Headline
              </label>
              <input
                id="adv-title"
                required
                minLength={4}
                maxLength={160}
                value={advTitle}
                onChange={(e) => setAdvTitle(e.target.value)}
                placeholder="e.g. Pre-Emptive Evacuation Notice"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="adv-severity"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Level
                </label>
                <select
                  id="adv-severity"
                  value={advSeverity}
                  onChange={(e) =>
                    setAdvSeverity(e.target.value as AdvisorySeverity)
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="Advisory">Advisory</option>
                  <option value="Warning">Warning</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>

              {!isMunicipalityLocked && (
                <div className="flex items-end pb-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={advAllMunicipalities}
                      onChange={(e) => setAdvAllMunicipalities(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900"
                    />
                    <span>All Municipalities (Nationwide / Regional)</span>
                  </label>
                </div>
              )}
            </div>

            {(isMunicipalityLocked || !advAllMunicipalities) && (
              <LocationSelector
                region={advRegion}
                municipality={
                  isMunicipalityLocked ? effectiveMunicipality : advMunicipality
                }
                barangay={advBarangay}
                allowAllBarangayOption={true}
                lockedMunicipality={
                  isMunicipalityLocked ? effectiveMunicipality : undefined
                }
                onChange={(next) => {
                  setAdvRegion(next.region);
                  setAdvMunicipality(next.municipality);
                  setAdvBarangay(next.barangay || 'Citywide');
                }}
              />
            )}

            <div>
              <label
                htmlFor="adv-message"
                className="block text-xs font-semibold text-slate-700"
              >
                Bulletin Details
              </label>
              <textarea
                id="adv-message"
                required
                minLength={10}
                maxLength={800}
                rows={4}
                value={advMessage}
                onChange={(e) => setAdvMessage(e.target.value)}
                placeholder="Provide clear evacuation routes, river gauge thresholds, or road closures..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full cursor-pointer rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isSaving ? 'Publishing...' : 'Publish Advisory'}
            </button>
          </form>

          <div className="space-y-3 lg:col-span-6">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Active Advisories ({scopedAdvisories.length})
            </h2>
            {scopedAdvisories.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
                No active official advisories for this scope.
              </div>
            ) : (
              scopedAdvisories.map((adv) => (
                <article
                  key={adv.id}
                  className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-start"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      {adv.severity} ·{' '}
                      {adv.municipality
                        ? `${adv.barangay}, ${adv.municipality}`
                        : adv.barangay}{' '}
                      ·{' '}
                      <span className="font-mono tabular-nums">
                        {formatRelativeTime(adv.created_at)}
                      </span>
                    </p>
                    <h3 className="font-display mt-1 text-sm font-semibold text-slate-900">
                      {adv.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600">{adv.message}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () => onArchiveAdvisory(adv.id),
                          'Advisory archived.'
                        )
                      }
                      className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Deactivate
                    </button>
                    {renderDeleteControl(
                      `advisory:${adv.id}`,
                      () => onDeleteAdvisory(adv.id),
                      `Deleted advisory "${adv.title}".`
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: FAMILY CHECK-INS */}
      {consoleTab === 'checkins' && (
        <div className="space-y-4">
          {checkinSyncError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <span>{checkinSyncError}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  void runAction(onRefreshLiveData, 'Refreshed live records.')
                }
                className="cursor-pointer rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Retry Connection
              </button>
            </div>
          )}

          <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-700" aria-hidden="true" />
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Family &ldquo;I&rsquo;m Safe&rdquo; Check-Ins ({scopedCheckins.length})
              </h2>
            </div>

            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={checkinSearch}
                onChange={(e) => setCheckinSearch(e.target.value)}
                placeholder="Filter by name, barangay, shelter..."
                aria-label="Filter family check-ins"
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {scopedCheckins.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No family safety check-ins match the current filter.
              </p>
            ) : (
              scopedCheckins.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-semibold text-slate-900">
                        {item.full_name}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          item.status === 'Needs Contact'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        · {item.status}
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        · {isUuid(item.id) ? 'Live DB' : item.queued_offline ? 'Local Queue' : 'Local Seed'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">
                      {item.barangay}, {item.municipality} · Household of{' '}
                      <span className="font-mono font-semibold">
                        {item.household_count}
                      </span>
                      {item.evacuation_center ? ` · ${item.evacuation_center}` : ''} ·{' '}
                      <span className="font-mono tabular-nums">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </p>
                    {item.note && (
                      <p className="text-xs text-slate-700">{item.note}</p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {renderDeleteControl(
                      `checkin:${item.id}`,
                      () => onDeleteCheckin(item.id),
                      `Deleted check-in for ${item.full_name}.`
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
