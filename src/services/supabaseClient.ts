import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Advisory,
  AdvisorySeverity,
  EvacuationCenter,
  EvacuationStatus,
  HazardReport,
  ModeratorProfile,
  NewEvacuationCenterDraft,
  ReportDraft,
  ReportStatus,
  SafetyCheckin,
  SafetyCheckinDraft,
} from '../types/alert';
import {
  enqueueOfflineCheckin,
  enqueueOfflineReport,
  getPendingCheckinQueue,
  getPendingQueue,
  replacePendingCheckinQueue,
  replacePendingQueue,
  saveCachedAdvisories,
  saveCachedCenters,
  saveCachedCheckins,
  saveCachedReports,
  saveLastSyncedAt,
} from './offlineSync';

const env = import.meta.env as Record<string, string | undefined>;
const SUPABASE_URL = (
  env.VITE_SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).trim();
const SUPABASE_ANON_KEY = (
  env.VITE_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  ''
).trim();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_URL.startsWith('https://') &&
    SUPABASE_ANON_KEY.length > 20
);

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }
  if (!clientInstance) {
    clientInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
      realtime: {
        params: {
          eventsPerSecond: 4, // Respect Free Tier realtime message budget
        },
      },
    });
  }
  return clientInstance;
}

export interface LiveDataBundle {
  reports: HazardReport[];
  centers: EvacuationCenter[];
  advisories: Advisory[];
  fromSupabase: boolean;
  syncedAt: string;
}

/**
 * Fetches lightweight, indexed slices optimized for Supabase Free Tier:
 * - Latest 40 non-dismissed hazard reports
 * - Evacuation centers ordered by barangay
 * - Active advisories ordered by recency
 */
export async function fetchAllLiveData(): Promise<LiveDataBundle | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const [reportsRes, centersRes, advisoriesRes] = await Promise.all([
    supabase
      .from('hazard_reports')
      .select('*')
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('evacuation_centers')
      .select('*')
      .order('city', { ascending: true })
      .order('barangay', { ascending: true })
      .limit(80),
    supabase
      .from('advisories')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(15),
  ]);

  if (reportsRes.error || centersRes.error || advisoriesRes.error) {
    throw new Error(
      reportsRes.error?.message ||
        centersRes.error?.message ||
        advisoriesRes.error?.message ||
        'Unable to reach Supabase.'
    );
  }

  const nowIso = new Date().toISOString();
  const reports = (reportsRes.data ?? []) as HazardReport[];
  const centers = (centersRes.data ?? []) as EvacuationCenter[];
  const advisories = (advisoriesRes.data ?? []) as Advisory[];

  await Promise.all([
    saveCachedReports(reports),
    saveCachedCenters(centers),
    saveCachedAdvisories(advisories),
    saveLastSyncedAt(nowIso),
  ]);

  return {
    reports,
    centers,
    advisories,
    fromSupabase: true,
    syncedAt: nowIso,
  };
}

/**
 * Submits a hazard report directly to Supabase when online, or falls back to
 * the IndexedDB/localStorage queue if offline or Supabase is unconfigured.
 */
export async function submitHazardReport(
  draft: ReportDraft,
  isOffline: boolean
): Promise<{ report: HazardReport; queued: boolean }> {
  const supabase = getSupabaseClient();

  if (isOffline || !supabase) {
    const queuedItem = await enqueueOfflineReport(draft);
    return { report: queuedItem, queued: true };
  }

  try {
    const basePayload = {
      category: draft.category,
      severity: draft.severity,
      barangay: draft.barangay.trim(),
      street_or_landmark: draft.street_or_landmark.trim(),
      description: draft.description.trim(),
      flood_level: draft.flood_level,
      contact_optional: draft.contact_optional?.trim() || null,
      is_verified: false,
      status: 'active',
    };

    const extendedPayload: Record<string, unknown> = {
      ...basePayload,
      region: draft.region.trim(),
      municipality: draft.municipality.trim(),
    };
    if (
      typeof draft.latitude === 'number' &&
      Number.isFinite(draft.latitude) &&
      typeof draft.longitude === 'number' &&
      Number.isFinite(draft.longitude)
    ) {
      extendedPayload.latitude = draft.latitude;
      extendedPayload.longitude = draft.longitude;
    }

    let { data, error } = await supabase
      .from('hazard_reports')
      .insert(extendedPayload)
      .select()
      .single();

    if (error && (error.code === '42703' || error.message.includes('column'))) {
      ({ data, error } = await supabase
        .from('hazard_reports')
        .insert(basePayload)
        .select()
        .single());
    }

    if (error || !data) {
      throw error ?? new Error('Insert failed');
    }

    return { report: data as HazardReport, queued: false };
  } catch {
    // Graceful resilience: never lose an emergency report when signal drops mid-submit
    const queuedItem = await enqueueOfflineReport(draft);
    return { report: queuedItem, queued: true };
  }
}

/**
 * Flushes queued_offline reports to Supabase (or simulates local merge when in demo mode).
 */
export async function syncPendingReports(isOffline: boolean): Promise<{
  synced: HazardReport[];
  remaining: HazardReport[];
}> {
  const queue = await getPendingQueue();
  if (queue.length === 0 || isOffline) {
    return { synced: [], remaining: queue };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    // Preview fallback mode (no Supabase keys configured): promote queued items into local active feed
    const promoted = queue.map((item) => ({
      ...item,
      id: `local-${item.id}`,
      queued_offline: false,
    }));
    await replacePendingQueue([]);
    return { synced: promoted, remaining: [] };
  }

  const synced: HazardReport[] = [];
  const remaining: HazardReport[] = [];

  for (const item of queue) {
    try {
      const basePayload = {
        category: item.category,
        severity: item.severity,
        barangay: item.barangay,
        street_or_landmark: item.street_or_landmark,
        description: item.description,
        flood_level: item.flood_level,
        contact_optional: item.contact_optional ?? null,
        is_verified: false,
        status: 'active',
      };

      const extendedPayload: Record<string, unknown> = {
        ...basePayload,
        region: item.region ?? 'National Capital Region (NCR)',
        municipality: item.municipality ?? 'Quezon City',
      };
      if (
        typeof item.latitude === 'number' &&
        Number.isFinite(item.latitude) &&
        typeof item.longitude === 'number' &&
        Number.isFinite(item.longitude)
      ) {
        extendedPayload.latitude = item.latitude;
        extendedPayload.longitude = item.longitude;
      }

      let { data, error } = await supabase
        .from('hazard_reports')
        .insert(extendedPayload)
        .select()
        .single();

      if (error && (error.code === '42703' || error.message.includes('column'))) {
        ({ data, error } = await supabase
          .from('hazard_reports')
          .insert(basePayload)
          .select()
          .single());
      }

      if (error || !data) {
        remaining.push(item);
      } else {
        synced.push(data as HazardReport);
      }
    } catch {
      remaining.push(item);
    }
  }

  await replacePendingQueue(remaining);
  return { synced, remaining };
}

export async function confirmActiveReport(reportId: string): Promise<number | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !isUuid(reportId)) {
    return null;
  }
  const { data, error } = await supabase.rpc('confirm_hazard_report', {
    report_id: reportId,
  });
  if (error) return null;
  return typeof data === 'number' ? data : null;
}

/**
 * Selective Realtime subscription for active feed, shelters, and advisories.
 */
export function subscribeToEmergencyUpdates(handlers: {
  onReportChange: () => void;
  onCenterChange: () => void;
  onAdvisoryChange: () => void;
}): () => void {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const channel: RealtimeChannel = supabase
    .channel('bayanihan-live-hub')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'hazard_reports' },
      handlers.onReportChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'evacuation_centers' },
      handlers.onCenterChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'advisories' },
      handlers.onAdvisoryChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ----------------------------------------------------------------------------
// FAMILY "I'M SAFE" CHECK-INS (WITH GRACEFUL OFFLINE / SCHEMA FALLBACK)
// ----------------------------------------------------------------------------

export async function fetchSafetyCheckins(): Promise<SafetyCheckin[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('safety_checkins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    // Gracefully fall back if safety_checkins table hasn't been migrated yet
    return null;
  }

  const checkins = (data ?? []) as SafetyCheckin[];
  await saveCachedCheckins(checkins);
  return checkins;
}

export async function submitSafetyCheckin(
  draft: SafetyCheckinDraft,
  isOffline: boolean
): Promise<{ checkin: SafetyCheckin; queued: boolean }> {
  const supabase = getSupabaseClient();
  if (isOffline || !supabase) {
    const queuedItem = await enqueueOfflineCheckin(draft);
    return { checkin: queuedItem, queued: true };
  }

  try {
    const { data, error } = await supabase
      .from('safety_checkins')
      .insert({
        full_name: draft.full_name.trim(),
        status: draft.status,
        municipality: draft.municipality.trim() || 'Quezon City',
        barangay: draft.barangay.trim(),
        evacuation_center: draft.evacuation_center?.trim() || null,
        household_count: Math.max(
          1,
          Math.min(50, Math.round(draft.household_count || 1))
        ),
        note: draft.note.trim(),
      })
      .select()
      .single();

    if (error || !data) {
      throw error ?? new Error('Insert failed');
    }

    return { checkin: data as SafetyCheckin, queued: false };
  } catch {
    const queuedItem = await enqueueOfflineCheckin(draft);
    return { checkin: queuedItem, queued: true };
  }
}

export async function syncPendingCheckins(isOffline: boolean): Promise<{
  synced: SafetyCheckin[];
  remaining: SafetyCheckin[];
}> {
  const queue = await getPendingCheckinQueue();
  if (queue.length === 0 || isOffline) {
    return { synced: [], remaining: queue };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    const promoted = queue.map((item) => ({
      ...item,
      id: `local-${item.id}`,
      queued_offline: false,
    }));
    await replacePendingCheckinQueue([]);
    return { synced: promoted, remaining: [] };
  }

  const synced: SafetyCheckin[] = [];
  const remaining: SafetyCheckin[] = [];

  for (const item of queue) {
    try {
      const { data, error } = await supabase
        .from('safety_checkins')
        .insert({
          full_name: item.full_name,
          status: item.status,
          municipality: item.municipality,
          barangay: item.barangay,
          evacuation_center: item.evacuation_center ?? null,
          household_count: item.household_count,
          note: item.note,
        })
        .select()
        .single();

      if (error || !data) {
        remaining.push(item);
      } else {
        synced.push(data as SafetyCheckin);
      }
    } catch {
      remaining.push(item);
    }
  }

  await replacePendingCheckinQueue(remaining);
  return { synced, remaining };
}

// ----------------------------------------------------------------------------
// MODERATOR AUTH & CONSOLE MUTATIONS
// ----------------------------------------------------------------------------

export async function signInModerator(
  email: string,
  password: string
): Promise<ModeratorProfile> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      'Supabase environment variables are not configured. Use Preview Responder Demo below or add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user || !data.session) {
    throw new Error(error?.message || 'Invalid moderator credentials.');
  }

  await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  let { data: profile, error: profileErr } = await supabase
    .from('moderator_profiles')
    .select('id, full_name, role, barangay_assigned, municipality_assigned')
    .eq('id', data.user.id)
    .maybeSingle();

  if (
    profileErr &&
    (profileErr.code === '42703' || profileErr.message.includes('column'))
  ) {
    ({ data: profile, error: profileErr } = await supabase
      .from('moderator_profiles')
      .select('id, full_name, role, barangay_assigned')
      .eq('id', data.user.id)
      .maybeSingle());
  }

  if (profileErr) {
    await supabase.auth.signOut();
    throw new Error(
      `Moderator profile query failed (${profileErr.code ?? 'error'}): ${profileErr.message}`
    );
  }

  if (!profile) {
    await supabase.auth.signOut();
    throw new Error(
      `Account authenticated (UID: ${data.user.id}), but no matching row exists in moderator_profiles for this UID.`
    );
  }

  return {
    ...(profile as ModeratorProfile),
    email: data.user.email,
  };
}

export async function getActiveModeratorSession(): Promise<ModeratorProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;

  let { data: profile, error } = await supabase
    .from('moderator_profiles')
    .select('id, full_name, role, barangay_assigned, municipality_assigned')
    .eq('id', user.id)
    .maybeSingle();

  if (error && (error.code === '42703' || error.message.includes('column'))) {
    ({ data: profile } = await supabase
      .from('moderator_profiles')
      .select('id, full_name, role, barangay_assigned')
      .eq('id', user.id)
      .maybeSingle());
  }

  if (!profile) return null;
  return {
    ...(profile as ModeratorProfile),
    email: user.email,
  };
}

export async function signOutModerator(): Promise<void> {
  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
}

export async function moderateHazardReport(
  reportId: string,
  updates: {
    is_verified?: boolean;
    status?: ReportStatus;
    moderatorId?: string;
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  if (!isUuid(reportId)) {
    throw new Error(
      `Cannot update local seed/offline report (${reportId}) in Supabase. Click Refresh on Live Alerts to load live database rows.`
    );
  }

  const payload: Record<string, unknown> = {};
  if (typeof updates.is_verified === 'boolean') {
    payload.is_verified = updates.is_verified;
    payload.verified_at = updates.is_verified ? new Date().toISOString() : null;
    payload.verified_by =
      updates.is_verified && updates.moderatorId && isUuid(updates.moderatorId)
        ? updates.moderatorId
        : null;
  }
  if (updates.status) {
    payload.status = updates.status;
  }

  const { data, error } = await supabase
    .from('hazard_reports')
    .update(payload)
    .eq('id', reportId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      'Database update affected 0 rows. Confirm your user has a moderator_profiles row and UPDATE permissions.'
    );
  }
}

export async function updateEvacuationCenterStatus(
  centerId: string,
  updates: {
    status: EvacuationStatus;
    current_occupancy: number;
    notes: string;
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  if (!isUuid(centerId)) {
    throw new Error(
      `Cannot update local seed shelter (${centerId}) in Supabase. Click Refresh on Live Alerts to load live database rows.`
    );
  }

  const { data, error } = await supabase
    .from('evacuation_centers')
    .update({
      status: updates.status,
      current_occupancy: Math.max(0, Math.round(updates.current_occupancy)),
      notes: updates.notes.trim(),
    })
    .eq('id', centerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      'Database update affected 0 rows. Confirm your user has a moderator_profiles row and UPDATE permissions.'
    );
  }
}

export async function createOfficialAdvisory(input: {
  title: string;
  message: string;
  severity: AdvisorySeverity;
  region?: string;
  municipality?: string;
  barangay: string;
  createdBy?: string;
}): Promise<Advisory | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const basePayload = {
    title: input.title.trim(),
    message: input.message.trim(),
    severity: input.severity,
    barangay: input.barangay.trim() || 'Citywide',
    is_active: true,
    created_by: input.createdBy ?? null,
  };

  let { data, error } = await supabase
    .from('advisories')
    .insert({
      ...basePayload,
      region: input.region?.trim() || 'National Capital Region (NCR)',
      municipality: input.municipality?.trim() || 'All Municipalities',
    })
    .select()
    .single();

  if (error && (error.code === '42703' || error.message.includes('column'))) {
    ({ data, error } = await supabase
      .from('advisories')
      .insert(basePayload)
      .select()
      .single());
  }

  if (error) throw new Error(error.message);
  return data as Advisory;
}

export async function createEvacuationCenter(
  draft: NewEvacuationCenterDraft
): Promise<EvacuationCenter | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const basePayload = {
    name: draft.name.trim(),
    city: draft.city.trim(),
    barangay: draft.barangay.trim(),
    address: draft.address.trim(),
    latitude: Number.isFinite(draft.latitude) ? draft.latitude : 14.5995,
    longitude: Number.isFinite(draft.longitude) ? draft.longitude : 120.9842,
    status: draft.status,
    current_occupancy: Math.max(0, Math.round(draft.current_occupancy)),
    max_capacity: Math.max(1, Math.round(draft.max_capacity)),
    notes: draft.notes.trim(),
    contact_info: draft.contact_info.trim(),
  };

  let { data, error } = await supabase
    .from('evacuation_centers')
    .insert({
      ...basePayload,
      region: draft.region.trim(),
    })
    .select()
    .single();

  if (error && (error.code === '42703' || error.message.includes('column'))) {
    ({ data, error } = await supabase
      .from('evacuation_centers')
      .insert(basePayload)
      .select()
      .single());
  }

  if (error) throw new Error(error.message);
  return data as EvacuationCenter;
}

export async function archiveOfficialAdvisory(advisoryId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  if (!isUuid(advisoryId)) {
    throw new Error(
      `Cannot archive local seed advisory (${advisoryId}) in Supabase. Click Refresh on Live Alerts to load live database rows.`
    );
  }

  const { data, error } = await supabase
    .from('advisories')
    .update({ is_active: false })
    .eq('id', advisoryId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      'Database update affected 0 rows. Confirm your user has a moderator_profiles row and UPDATE permissions.'
    );
  }
}
