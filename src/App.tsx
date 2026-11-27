import { useCallback, useEffect, useState } from 'react';
import { AdvisoryStrip } from './components/AdvisoryStrip';
import { BayanihanAssistantDrawer } from './components/BayanihanAssistantDrawer';
import { EvacuationDirectoryView } from './components/EvacuationDirectoryView';
import { HotlinesView } from './components/HotlinesView';
import { LiveFeedView } from './components/LiveFeedView';
import { ModeratorConsoleView } from './components/ModeratorConsoleView';
import { QuickReportModal } from './components/QuickReportModal';
import { SafetyToolsView } from './components/SafetyToolsView';
import { TopBar } from './components/TopBar';
import {
  SEED_ADVISORIES,
  SEED_EVACUATION_CENTERS,
  SEED_HAZARD_REPORTS,
  SEED_SAFETY_CHECKINS,
} from './data/seedData';
import {
  getConfirmedReportIds,
  loadCachedCheckins,
  loadCachedSnapshot,
  markReportConfirmedLocally,
  replacePendingCheckinQueue,
  replacePendingQueue,
  saveCachedAdvisories,
  saveCachedCenters,
  saveCachedCheckins,
  saveCachedReports,
} from './services/offlineSync';
import {
  archiveOfficialAdvisory,
  confirmActiveReport,
  createEvacuationCenter,
  createOfficialAdvisory,
  deleteEvacuationCenter,
  deleteHazardReport,
  deleteOfficialAdvisory,
  deleteSafetyCheckin,
  fetchAllLiveData,
  fetchEvacuationCentersPage,
  fetchHazardReportsPage,
  fetchSafetyCheckins,
  getActiveModeratorSession,
  isSupabaseConfigured,
  isUuid,
  moderateHazardReport,
  signInModerator,
  signOutModerator,
  submitHazardReport,
  submitSafetyCheckin,
  subscribeToEmergencyUpdates,
  syncPendingCheckins,
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
  SafetyCheckin,
  SafetyCheckinDraft,
} from './types/alert';

const BATTERY_SAVER_KEY = 'bayanihan:battery_saver_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('feed');
  const [filter, setFilter] = useState<FeedFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [batterySaver, setBatterySaver] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BATTERY_SAVER_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [reports, setReports] = useState<HazardReport[]>(SEED_HAZARD_REPORTS);
  const [queuedReports, setQueuedReports] = useState<HazardReport[]>([]);
  const [centers, setCenters] = useState<EvacuationCenter[]>(SEED_EVACUATION_CENTERS);
  const [advisories, setAdvisories] = useState<Advisory[]>(SEED_ADVISORIES);
  const [checkins, setCheckins] = useState<SafetyCheckin[]>(SEED_SAFETY_CHECKINS);
  const [queuedCheckins, setQueuedCheckins] = useState<SafetyCheckin[]>([]);
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
  const [checkinSyncError, setCheckinSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMoreReports, setHasMoreReports] = useState(false);
  const [hasMoreCenters, setHasMoreCenters] = useState(false);
  const [hasMoreCheckins, setHasMoreCheckins] = useState(false);
  const [loadingMoreReports, setLoadingMoreReports] = useState(false);
  const [loadingMoreCenters, setLoadingMoreCenters] = useState(false);
  const [loadingMoreCheckins, setLoadingMoreCheckins] = useState(false);
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

  useEffect(() => {
    const canonicalUrl = `${window.location.origin}${window.location.pathname}`;
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);

    let ogUrlMeta = document.querySelector('meta[property="og:url"]');
    if (!ogUrlMeta) {
      ogUrlMeta = document.createElement('meta');
      ogUrlMeta.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrlMeta);
    }
    ogUrlMeta.setAttribute('content', canonicalUrl);
  }, []);

  const notify = useCallback((msg: string) => {
    setBannerFeedback(msg);
    setTimeout(() => {
      setBannerFeedback((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('battery-saver', batterySaver);
    try {
      localStorage.setItem(BATTERY_SAVER_KEY, String(batterySaver));
    } catch {
      // Ignore storage error
    }
  }, [batterySaver]);

  const refreshFromRemote = useCallback(async () => {
    if (isOffline || !isSupabaseConfigured) return;
    setIsRefreshing(true);
    try {
      const [bundle, checkinsResult] = await Promise.all([
        fetchAllLiveData(),
        fetchSafetyCheckins(),
      ]);
      if (bundle) {
        setReports(bundle.reports);
        setCenters(bundle.centers);
        setAdvisories(bundle.advisories);
        setHasMoreReports(bundle.hasMoreReports);
        setHasMoreCenters(bundle.hasMoreCenters);
        setLastSyncedAt(bundle.syncedAt);
        setLastSyncError(null);
      }
      if (checkinsResult.checkins) {
        setCheckins(checkinsResult.checkins);
        setHasMoreCheckins(checkinsResult.hasMore);
        setCheckinSyncError(null);
      } else if (checkinsResult.error) {
        setCheckinSyncError(checkinsResult.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error';
      setLastSyncError(msg);
      notify(`Supabase sync failed (${msg}). Showing cached data.`);
    } finally {
      setIsRefreshing(false);
    }
  }, [isOffline, notify]);

  const handleLoadMoreReports = useCallback(async () => {
    if (isOffline || !isSupabaseConfigured || loadingMoreReports) return;
    setLoadingMoreReports(true);
    try {
      const page = await fetchHazardReportsPage({
        offset: reports.length,
      });
      setReports((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const appended = page.reports.filter((r) => !seen.has(r.id));
        return [...prev, ...appended];
      });
      setHasMoreReports(page.hasMore);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Unable to load additional reports.'
      );
    } finally {
      setLoadingMoreReports(false);
    }
  }, [isOffline, loadingMoreReports, reports.length, notify]);

  const handleLoadMoreCenters = useCallback(async () => {
    if (isOffline || !isSupabaseConfigured || loadingMoreCenters) return;
    setLoadingMoreCenters(true);
    try {
      const page = await fetchEvacuationCentersPage({
        offset: centers.length,
      });
      setCenters((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const appended = page.centers.filter((c) => !seen.has(c.id));
        return [...prev, ...appended];
      });
      setHasMoreCenters(page.hasMore);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Unable to load additional shelters.'
      );
    } finally {
      setLoadingMoreCenters(false);
    }
  }, [isOffline, loadingMoreCenters, centers.length, notify]);

  const handleLoadMoreCheckins = useCallback(async () => {
    if (isOffline || !isSupabaseConfigured || loadingMoreCheckins) return;
    setLoadingMoreCheckins(true);
    try {
      const page = await fetchSafetyCheckins({
        offset: checkins.length,
      });
      if (page.checkins) {
        setCheckins((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          const appended = page.checkins!.filter((c) => !seen.has(c.id));
          return [...prev, ...appended];
        });
        setHasMoreCheckins(page.hasMore);
      }
    } finally {
      setLoadingMoreCheckins(false);
    }
  }, [isOffline, loadingMoreCheckins, checkins.length]);

  const handleSyncQueue = useCallback(async () => {
    if (isOffline) return;
    setIsSyncing(true);
    try {
      const [reportRes, checkinRes] = await Promise.all([
        syncPendingReports(isOffline),
        syncPendingCheckins(isOffline),
      ]);
      setQueuedReports(reportRes.remaining);
      setQueuedCheckins(checkinRes.remaining);

      if (reportRes.synced.length > 0) {
        setReports((prev) => {
          const updated = [...reportRes.synced, ...prev];
          void saveCachedReports(updated);
          return updated;
        });
      }
      if (checkinRes.synced.length > 0) {
        setCheckins((prev) => {
          const updated = [...checkinRes.synced, ...prev];
          void saveCachedCheckins(updated);
          return updated;
        });
      }
      if (checkinRes.error) {
        setCheckinSyncError(checkinRes.error);
      } else if (checkinRes.remaining.length === 0) {
        setCheckinSyncError(null);
      }
      const totalSynced = reportRes.synced.length + checkinRes.synced.length;
      if (totalSynced > 0) {
        notify(
          `Synced ${totalSynced} queued ${totalSynced === 1 ? 'update' : 'updates'} to the live hub.`
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
      const [cached, cachedCheckins] = await Promise.all([
        loadCachedSnapshot(),
        loadCachedCheckins(),
      ]);
      if (!active) return;
      setReports(cached.reports);
      setCenters(cached.centers);
      setAdvisories(cached.advisories);
      setQueuedReports(cached.queue);
      setCheckins(cachedCheckins.checkins);
      setQueuedCheckins(cachedCheckins.queue);
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
    if (!isOffline && (queuedReports.length > 0 || queuedCheckins.length > 0)) {
      void handleSyncQueue();
    }
  }, [isOffline, queuedReports.length, queuedCheckins.length, handleSyncQueue]);

  // Selective Supabase Realtime subscription (paused in Battery Saver mode)
  useEffect(() => {
    if (isOffline || batterySaver || !isSupabaseConfigured) return;
    return subscribeToEmergencyUpdates({
      onReportChange: () => void refreshFromRemote(),
      onCenterChange: () => void refreshFromRemote(),
      onAdvisoryChange: () => void refreshFromRemote(),
      onCheckinChange: () => void refreshFromRemote(),
    });
  }, [isOffline, batterySaver, refreshFromRemote]);

  // Refresh when returning to the browser tab (paused in Battery Saver mode)
  useEffect(() => {
    if (isOffline || batterySaver || !isSupabaseConfigured) return;
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
  }, [isOffline, batterySaver, refreshFromRemote]);

  useEffect(() => {
    if (isOffline || batterySaver || !isSupabaseConfigured) return;
    if (
      activeTab === 'feed' ||
      activeTab === 'evacuation' ||
      activeTab === 'safety' ||
      activeTab === 'moderator'
    ) {
      void refreshFromRemote();
    }
  }, [activeTab, isOffline, batterySaver, refreshFromRemote]);

  async function handleSubmitCheckin(
    draft: SafetyCheckinDraft
  ): Promise<{ queued: boolean; syncError?: string }> {
    const result = await submitSafetyCheckin(draft, isOffline);
    if (result.queued) {
      setQueuedCheckins((prev) => [result.checkin, ...prev]);
      if (result.syncError) {
        setCheckinSyncError(result.syncError);
      }
    } else {
      setCheckinSyncError(null);
      setCheckins((prev) => {
        const updated = [result.checkin, ...prev];
        void saveCachedCheckins(updated);
        return updated;
      });
    }
    return { queued: result.queued, syncError: result.syncError };
  }

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
        moderatorName: moderator?.full_name,
      });
    }

    const nowIso = new Date().toISOString();
    setReports((prev) => {
      const updated = prev.map((r) => {
        if (r.id !== reportId) return r;
        const nextStatus = updates.status ?? r.status;
        return {
          ...r,
          is_verified:
            typeof updates.is_verified === 'boolean'
              ? updates.is_verified
              : r.is_verified,
          status: nextStatus,
          updated_at: nowIso,
          verified_at:
            typeof updates.is_verified === 'boolean'
              ? updates.is_verified
                ? nowIso
                : null
              : r.verified_at,
          verified_by:
            typeof updates.is_verified === 'boolean'
              ? updates.is_verified
                ? moderator?.id ?? null
                : null
              : r.verified_by,
          verified_by_name:
            typeof updates.is_verified === 'boolean'
              ? updates.is_verified
                ? moderator?.full_name ?? null
                : null
              : r.verified_by_name,
          dismissed_at:
            updates.status === 'dismissed'
              ? nowIso
              : updates.status === 'active'
                ? null
                : r.dismissed_at,
          dismissed_by:
            updates.status === 'dismissed'
              ? moderator?.id ?? null
              : updates.status === 'active'
                ? null
                : r.dismissed_by,
          dismissed_by_name:
            updates.status === 'dismissed'
              ? moderator?.full_name ?? null
              : updates.status === 'active'
                ? null
                : r.dismissed_by_name,
        };
      });
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

  async function handleDeleteReport(reportId: string) {
    if (moderator?.role !== 'admin') {
      throw new Error('Only admin accounts can permanently delete records.');
    }
    if (isSupabaseConfigured && !isOffline && isUuid(reportId)) {
      await deleteHazardReport(reportId);
    }
    setQueuedReports((prev) => {
      const updated = prev.filter((r) => r.id !== reportId);
      if (updated.length !== prev.length) {
        void replacePendingQueue(updated);
      }
      return updated;
    });
    setReports((prev) => {
      const updated = prev.filter((r) => r.id !== reportId);
      void saveCachedReports(updated);
      return updated;
    });
  }

  async function handleDeleteCenter(centerId: string) {
    if (moderator?.role !== 'admin') {
      throw new Error('Only admin accounts can permanently delete records.');
    }
    if (isSupabaseConfigured && !isOffline && isUuid(centerId)) {
      await deleteEvacuationCenter(centerId);
    }
    setCenters((prev) => {
      const updated = prev.filter((c) => c.id !== centerId);
      void saveCachedCenters(updated);
      return updated;
    });
  }

  async function handleDeleteAdvisory(advisoryId: string) {
    if (moderator?.role !== 'admin') {
      throw new Error('Only admin accounts can permanently delete records.');
    }
    if (isSupabaseConfigured && !isOffline && isUuid(advisoryId)) {
      await deleteOfficialAdvisory(advisoryId);
    }
    setAdvisories((prev) => {
      const updated = prev.filter((a) => a.id !== advisoryId);
      void saveCachedAdvisories(updated);
      return updated;
    });
  }

  async function handleDeleteCheckin(checkinId: string) {
    if (moderator?.role !== 'admin') {
      throw new Error('Only admin accounts can permanently delete records.');
    }
    if (isSupabaseConfigured && !isOffline && isUuid(checkinId)) {
      await deleteSafetyCheckin(checkinId);
    }
    setQueuedCheckins((prev) => {
      const updated = prev.filter((c) => c.id !== checkinId);
      if (updated.length !== prev.length) {
        void replacePendingCheckinQueue(updated);
      }
      return updated;
    });
    setCheckins((prev) => {
      const updated = prev.filter((c) => c.id !== checkinId);
      void saveCachedCheckins(updated);
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
        batterySaver={batterySaver}
        onSelectTab={setActiveTab}
        onToggleBatterySaver={() => setBatterySaver((prev) => !prev)}
        onOpenReportModal={() => setIsReportModalOpen(true)}
      />

      <AdvisoryStrip advisories={advisories} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {batterySaver && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-700/60 bg-emerald-950/60 px-4 py-2.5 text-xs text-emerald-200"
          >
            <span>
              <strong>Battery-Saver Mode Active</strong> — Low-glare dark surface enabled, live background polling and map tiles paused.
            </span>
            <button
              type="button"
              onClick={() => setBatterySaver(false)}
              className="cursor-pointer font-semibold underline hover:text-white"
            >
              Turn Off
            </button>
          </div>
        )}

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
            reports={reports.filter((r) => r.status !== 'dismissed')}
            queuedReports={queuedReports}
            centers={centers}
            filter={filter}
            searchQuery={searchQuery}
            confirmedIds={confirmedIds}
            isOffline={isOffline}
            batterySaver={batterySaver}
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
            hasMoreReports={hasMoreReports}
            loadingMoreReports={loadingMoreReports}
            onFilterChange={setFilter}
            onSearchChange={setSearchQuery}
            onConfirmReport={(id) => void handleConfirmReport(id)}
            onToggleSimulatedOffline={() =>
              setSimulatedOffline((prev) => !prev)
            }
            onSyncNow={() => void handleSyncQueue()}
            onManualRefresh={() => void refreshFromRemote()}
            onLoadMoreReports={() => void handleLoadMoreReports()}
            onOpenReportModal={() => setIsReportModalOpen(true)}
            onJumpToShelters={() => setActiveTab('evacuation')}
          />
        )}

        {activeTab === 'evacuation' && (
          <EvacuationDirectoryView
            centers={centers}
            reports={[
              ...queuedReports,
              ...reports.filter((r) => r.status !== 'dismissed'),
            ]}
            isOffline={isOffline}
            batterySaver={batterySaver}
            isRefreshing={isRefreshing}
            usingSupabase={
              isSupabaseConfigured &&
              !isOffline &&
              !lastSyncError &&
              centers.some((c) => isUuid(c.id))
            }
            supabaseConfigured={isSupabaseConfigured}
            lastSyncError={lastSyncError}
            hasMoreCenters={hasMoreCenters}
            loadingMoreCenters={loadingMoreCenters}
            onRefresh={() => void refreshFromRemote()}
            onLoadMoreCenters={() => void handleLoadMoreCenters()}
          />
        )}

        {activeTab === 'safety' && (
          <SafetyToolsView
            checkins={checkins}
            queuedCheckins={queuedCheckins}
            centers={centers}
            isOffline={isOffline}
            isSyncing={isSyncing}
            isRefreshing={isRefreshing}
            hasMoreCheckins={hasMoreCheckins}
            loadingMoreCheckins={loadingMoreCheckins}
            supabaseConfigured={isSupabaseConfigured}
            usingSupabaseCheckins={
              isSupabaseConfigured && !isOffline && !checkinSyncError
            }
            checkinSyncError={checkinSyncError}
            onSubmitCheckin={handleSubmitCheckin}
            onSyncCheckins={() => void handleSyncQueue()}
            onRefreshCheckins={() => void refreshFromRemote()}
            onLoadMoreCheckins={() => void handleLoadMoreCheckins()}
          />
        )}

        {activeTab === 'hotlines' && <HotlinesView />}

        {activeTab === 'moderator' && (
          <ModeratorConsoleView
            moderator={moderator}
            reports={reports}
            centers={centers}
            advisories={advisories}
            checkins={[...queuedCheckins, ...checkins]}
            checkinSyncError={checkinSyncError}
            onSignIn={async (email, password) => {
              const profile = await signInModerator(email, password);
              setModerator(profile);
              await refreshFromRemote();
            }}
            onDemoSignIn={
              import.meta.env.DEV
                ? () =>
                    setModerator({
                      id: 'demo-moderator',
                      email: 'admin@bayanihan.local',
                      full_name: 'Capt. Ramon Villanueva',
                      role: 'admin',
                      barangay_assigned: 'Brgy. Tatalon DRRMO (Preview)',
                      municipality_assigned: 'All Municipalities',
                    })
                : undefined
            }
            onSignOut={async () => {
              await signOutModerator();
              setModerator(null);
            }}
            onOwnProfileUpdated={setModerator}
            onModerateReport={handleModerateReport}
            onDeleteReport={handleDeleteReport}
            onUpdateCenter={handleUpdateCenter}
            onCreateCenter={handleCreateCenter}
            onDeleteCenter={handleDeleteCenter}
            onCreateAdvisory={handleCreateAdvisory}
            onArchiveAdvisory={handleArchiveAdvisory}
            onDeleteAdvisory={handleDeleteAdvisory}
            onDeleteCheckin={handleDeleteCheckin}
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
