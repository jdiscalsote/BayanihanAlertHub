import { useCallback, useEffect, useState } from 'react';
import { AdvisoryStrip } from './components/AdvisoryStrip';
import { BayanihanAssistantDrawer } from './components/BayanihanAssistantDrawer';
import { EvacuationDirectoryView } from './components/EvacuationDirectoryView';
import { HotlinesView } from './components/HotlinesView';
import { LiveFeedView } from './components/LiveFeedView';
import { ModeratorConsoleView } from './components/ModeratorConsoleView';
import { QuickReportModal } from './components/QuickReportModal';
import { TopBar } from './components/TopBar';
import {
  SEED_ADVISORIES,
  SEED_EVACUATION_CENTERS,
  SEED_HAZARD_REPORTS,
} from './data/seedData';
import {
  getConfirmedReportIds,
  loadCachedSnapshot,
  markReportConfirmedLocally,
  saveCachedAdvisories,
  saveCachedCenters,
  saveCachedReports,
} from './services/offlineSync';
import {
  archiveOfficialAdvisory,
  confirmActiveReport,
  createEvacuationCenter,
  createOfficialAdvisory,
  fetchAllLiveData,
  getActiveModeratorSession,
  isSupabaseConfigured,
  isUuid,
  moderateHazardReport,
  signInModerator,
  signOutModerator,
  submitHazardReport,
  subscribeToEmergencyUpdates,
  syncPendingReports,
  updateEvacuationCenterStatus,
} from './services/supabaseClient';
import type {
  ActiveTab,
  Advisory,
  AdvisorySeverity,
  EvacuationCenter,
  EvacuationStatus,
  FeedFilter,
  HazardReport,
  ModeratorProfile,
  NewEvacuationCenterDraft,
  ReportDraft,
  ReportStatus,
} from './types/alert';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('feed');
  const [filter, setFilter] = useState<FeedFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const [reports, setReports] = useState<HazardReport[]>(SEED_HAZARD_REPORTS);
  const [queuedReports, setQueuedReports] = useState<HazardReport[]>([]);
  const [centers, setCenters] = useState<EvacuationCenter[]>(SEED_EVACUATION_CENTERS);
  const [advisories, setAdvisories] = useState<Advisory[]>(SEED_ADVISORIES);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(() =>
    getConfirmedReportIds()
  );

  const [browserOffline, setBrowserOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const isOffline = browserOffline || simulatedOffline;

  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [bannerFeedback, setBannerFeedback] = useState<string | null>(null);
  const [moderator, setModerator] = useState<ModeratorProfile | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    };
  }, []);

  const notify = useCallback((msg: string) => {
    setBannerFeedback(msg);
    setTimeout(() => {
      setBannerFeedback((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  const refreshFromRemote = useCallback(async () => {
    if (isOffline || !isSupabaseConfigured) return;
    setIsRefreshing(true);
    try {
      const bundle = await fetchAllLiveData();
      if (bundle) {
        setReports(bundle.reports);
        setCenters(bundle.centers);
        setAdvisories(bundle.advisories);
        setLastSyncedAt(bundle.syncedAt);
        setLastSyncError(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error';
      setLastSyncError(msg);
      notify(`Supabase sync failed (${msg}). Showing cached data.`);
    } finally {
      setIsRefreshing(false);
    }
  }, [isOffline, notify]);

  const handleSyncQueue = useCallback(async () => {
    if (isOffline) return;
    setIsSyncing(true);
    try {
      const { synced, remaining } = await syncPendingReports(isOffline);
      setQueuedReports(remaining);
      if (synced.length > 0) {
        setReports((prev) => {
          const updated = [...synced, ...prev];
          void saveCachedReports(updated);
          return updated;
        });
        notify(
          `Synced ${synced.length} queued ${synced.length === 1 ? 'report' : 'reports'} to the live feed.`
        );
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isOffline, notify]);

  // Initial hydrate from IndexedDB/localStorage, then Supabase live fetch & session check
  useEffect(() => {
    let active = true;
    (async () => {
      const cached = await loadCachedSnapshot();
      if (!active) return;
      setReports(cached.reports);
      setCenters(cached.centers);
      setAdvisories(cached.advisories);
      setQueuedReports(cached.queue);
      setLastSyncedAt(cached.lastSyncedAt ?? new Date().toISOString());

      if (isSupabaseConfigured && !isOffline) {
        const [session] = await Promise.all([
          getActiveModeratorSession(),
          refreshFromRemote(),
        ]);
        if (active && session) {
          setModerator(session);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [isOffline, refreshFromRemote]);

  // Listen to browser connectivity changes
  useEffect(() => {
    const handleOnline = () => setBrowserOffline(false);
    const handleOffline = () => setBrowserOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Auto-sync pending queue whenever connectivity returns
  useEffect(() => {
    if (!isOffline && queuedReports.length > 0) {
      void handleSyncQueue();
    }
  }, [isOffline, queuedReports.length, handleSyncQueue]);

  // Selective Supabase Realtime subscription (free-tier friendly)
  useEffect(() => {
    if (isOffline || !isSupabaseConfigured) return;
    return subscribeToEmergencyUpdates({
      onReportChange: () => void refreshFromRemote(),
      onCenterChange: () => void refreshFromRemote(),
      onAdvisoryChange: () => void refreshFromRemote(),
    });
  }, [isOffline, refreshFromRemote]);

  // Refresh when returning to the browser tab or switching primary views
  useEffect(() => {
    if (isOffline || !isSupabaseConfigured) return;
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void refreshFromRemote();
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [isOffline, refreshFromRemote]);

  useEffect(() => {
    if (isOffline || !isSupabaseConfigured) return;
    if (activeTab === 'feed' || activeTab === 'evacuation' || activeTab === 'moderator') {
      void refreshFromRemote();
    }
  }, [activeTab, isOffline, refreshFromRemote]);

  async function handleSubmitReport(
    draft: ReportDraft
  ): Promise<{ queued: boolean }> {
    const result = await submitHazardReport(draft, isOffline);
    if (result.queued) {
      setQueuedReports((prev) => [result.report, ...prev]);
      notify('Report saved to your offline sync queue. It will auto-upload once online.');
    } else {
      setReports((prev) => {
        const updated = [result.report, ...prev];
        void saveCachedReports(updated);
        return updated;
      });
      notify('Community report published and queued for barangay verification.');
    }
    return { queued: result.queued };
  }

  async function handleConfirmReport(reportId: string) {
    if (confirmedIds.has(reportId)) return;
    const nextConfirmed = markReportConfirmedLocally(reportId);
    setConfirmedIds(nextConfirmed);

    // Optimistic update
    setReports((prev) => {
      const updated = prev.map((r) =>
        r.id === reportId
          ? { ...r, confirmations_count: r.confirmations_count + 1 }
          : r
      );
      void saveCachedReports(updated);
      return updated;
    });

    if (!isOffline && isSupabaseConfigured) {
      const serverCount = await confirmActiveReport(reportId);
      if (typeof serverCount === 'number') {
        setReports((prev) =>
          prev.map((r) =>
            r.id === reportId ? { ...r, confirmations_count: serverCount } : r
          )
        );
      }
    }
  }

  async function handleModerateReport(
    reportId: string,
    updates: { is_verified?: boolean; status?: ReportStatus }
  ) {
    if (isSupabaseConfigured && !isOffline) {
      await moderateHazardReport(reportId, {
        ...updates,
        moderatorId: moderator?.id,
      });
    }

    setReports((prev) => {
      const updated = prev
        .map((r) => {
          if (r.id !== reportId) return r;
          return {
            ...r,
            is_verified:
              typeof updates.is_verified === 'boolean'
                ? updates.is_verified
                : r.is_verified,
            status: updates.status ?? r.status,
            verified_at:
              updates.is_verified === true
                ? new Date().toISOString()
                : r.verified_at,
          };
        })
        .filter((r) => r.status !== 'dismissed');
      void saveCachedReports(updated);
      return updated;
    });
  }

  async function handleUpdateCenter(
    centerId: string,
    updates: {
      status: EvacuationStatus;
      current_occupancy: number;
      notes: string;
    }
  ) {
    if (isSupabaseConfigured && !isOffline) {
      await updateEvacuationCenterStatus(centerId, updates);
    }

    setCenters((prev) => {
      const updated = prev.map((c) =>
        c.id === centerId
          ? {
              ...c,
              status: updates.status,
              current_occupancy: updates.current_occupancy,
              notes: updates.notes,
              updated_at: new Date().toISOString(),
            }
          : c
      );
      void saveCachedCenters(updated);
      return updated;
    });
  }

  async function handleCreateCenter(draft: NewEvacuationCenterDraft) {
    let created: EvacuationCenter | null = null;
    if (isSupabaseConfigured && !isOffline) {
      created = await createEvacuationCenter(draft);
    }

    const newCenter: EvacuationCenter = created ?? {
      id: `ec-${Date.now().toString(36)}`,
      ...draft,
      updated_at: new Date().toISOString(),
    };

    setCenters((prev) => {
      const updated = [newCenter, ...prev];
      void saveCachedCenters(updated);
      return updated;
    });
  }

  async function handleCreateAdvisory(input: {
    title: string;
    message: string;
    severity: AdvisorySeverity;
    region: string;
    municipality: string;
    barangay: string;
  }) {
    let created: Advisory | null = null;
    if (isSupabaseConfigured && !isOffline) {
      created = await createOfficialAdvisory({
        ...input,
        createdBy: moderator?.id,
      });
    }

    const advisoryItem: Advisory = created ?? {
      id: `adv-${Date.now().toString(36)}`,
      title: input.title,
      message: input.message,
      severity: input.severity,
      region: input.region,
      municipality: input.municipality,
      barangay: input.barangay,
      is_active: true,
      created_at: new Date().toISOString(),
      created_by: moderator?.id ?? null,
    };

    setAdvisories((prev) => {
      const updated = [advisoryItem, ...prev];
      void saveCachedAdvisories(updated);
      return updated;
    });
  }

  async function handleArchiveAdvisory(advisoryId: string) {
    if (isSupabaseConfigured && !isOffline) {
      await archiveOfficialAdvisory(advisoryId);
    }
    setAdvisories((prev) => {
      const updated = prev.filter((a) => a.id !== advisoryId);
      void saveCachedAdvisories(updated);
      return updated;
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenReportModal={() => setIsReportModalOpen(true)}
      />

      <AdvisoryStrip advisories={advisories} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {bannerFeedback && (
          <div
            role="status"
            className="mb-5 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-900"
          >
            {bannerFeedback}
          </div>
        )}

        {activeTab === 'feed' && (
          <LiveFeedView
            reports={reports}
            queuedReports={queuedReports}
            centers={centers}
            filter={filter}
            searchQuery={searchQuery}
            confirmedIds={confirmedIds}
            isOffline={isOffline}
            simulatedOffline={simulatedOffline}
            isSyncing={isSyncing}
            isRefreshing={isRefreshing}
            lastSyncedAt={lastSyncedAt}
            lastSyncError={lastSyncError}
            usingSupabase={
              isSupabaseConfigured &&
              !isOffline &&
              !lastSyncError &&
              (centers.some((c) => isUuid(c.id)) ||
                reports.some((r) => isUuid(r.id)))
            }
            supabaseConfigured={isSupabaseConfigured}
            onFilterChange={setFilter}
            onSearchChange={setSearchQuery}
            onConfirmReport={(id) => void handleConfirmReport(id)}
            onToggleSimulatedOffline={() =>
              setSimulatedOffline((prev) => !prev)
            }
            onSyncNow={() => void handleSyncQueue()}
            onManualRefresh={() => void refreshFromRemote()}
            onOpenReportModal={() => setIsReportModalOpen(true)}
            onJumpToShelters={() => setActiveTab('evacuation')}
          />
        )}

        {activeTab === 'evacuation' && (
          <EvacuationDirectoryView
            centers={centers}
            reports={[...queuedReports, ...reports]}
            isOffline={isOffline}
            isRefreshing={isRefreshing}
            usingSupabase={
              isSupabaseConfigured &&
              !isOffline &&
              !lastSyncError &&
              centers.some((c) => isUuid(c.id))
            }
            supabaseConfigured={isSupabaseConfigured}
            lastSyncError={lastSyncError}
            onRefresh={() => void refreshFromRemote()}
          />
        )}

        {activeTab === 'hotlines' && <HotlinesView />}

        {activeTab === 'moderator' && (
          <ModeratorConsoleView
            moderator={moderator}
            reports={reports}
            centers={centers}
            advisories={advisories}
            onSignIn={async (email, password) => {
              const profile = await signInModerator(email, password);
              setModerator(profile);
              await refreshFromRemote();
            }}
            onDemoSignIn={() =>
              setModerator({
                id: 'demo-moderator',
                full_name: 'Capt. Ramon Villanueva',
                role: 'admin',
                barangay_assigned: 'Brgy. Tatalon DRRMO (Preview)',
                municipality_assigned: 'All Municipalities',
              })
            }
            onSignOut={async () => {
              await signOutModerator();
              setModerator(null);
            }}
            onModerateReport={handleModerateReport}
            onUpdateCenter={handleUpdateCenter}
            onCreateCenter={handleCreateCenter}
            onCreateAdvisory={handleCreateAdvisory}
            onArchiveAdvisory={handleArchiveAdvisory}
            onRefreshLiveData={refreshFromRemote}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 px-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            Bayanihan Alert Hub — Community Typhoon, Flood &amp; Evacuation Tracker
          </p>
          <p>
            No account needed for residents · Offline cache enabled for low-signal readiness
          </p>
        </div>
      </footer>

      <QuickReportModal
        isOpen={isReportModalOpen}
        isOffline={isOffline}
        onClose={() => setIsReportModalOpen(false)}
        onSubmit={handleSubmitReport}
      />

      <BayanihanAssistantDrawer
        reports={[...queuedReports, ...reports]}
        centers={centers}
        advisories={advisories}
        isOffline={isOffline}
      />
    </div>
  );
}
