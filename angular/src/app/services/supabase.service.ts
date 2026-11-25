import { Injectable, inject, signal } from '@angular/core';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import {
  Advisory,
  AdvisorySeverity,
  EvacuationCenter,
  EvacuationStatus,
  HazardReport,
  ModeratorProfile,
  NewEvacuationCenterDraft,
  ReportDraft,
  ReportStatus,
} from '../models/alert.models';
import { OfflineSyncService } from './offline-sync.service';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly offline = inject(OfflineSyncService);
  private readonly client: SupabaseClient | null;
  private realtimeChannel: RealtimeChannel | null = null;

  readonly reports = signal<HazardReport[]>([]);
  readonly centers = signal<EvacuationCenter[]>([]);
  readonly advisories = signal<Advisory[]>([]);
  readonly moderator = signal<ModeratorProfile | null>(null);
  readonly isSyncing = signal<boolean>(false);

  constructor() {
    const configured =
      environment.supabaseUrl.startsWith('https://') &&
      !environment.supabaseUrl.includes('YOUR_PROJECT_ID') &&
      environment.supabaseAnonKey.length > 20;

    this.client = configured
      ? createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true },
          realtime: { params: { eventsPerSecond: 4 } },
        })
      : null;
  }

  async initialize(): Promise<void> {
    this.reports.set(this.offline.getCachedReports([]));
    this.centers.set(this.offline.getCachedCenters([]));
    this.advisories.set(this.offline.getCachedAdvisories([]));

    if (!this.client || this.offline.isOffline()) return;

    await Promise.all([this.refreshAll(), this.restoreModeratorSession()]);
    this.subscribeRealtime();
  }

  async refreshAll(): Promise<void> {
    if (!this.client || this.offline.isOffline()) return;

    const [repRes, cenRes, advRes] = await Promise.all([
      this.client
        .from('hazard_reports')
        .select('*')
        .neq('status', 'dismissed')
        .order('created_at', { ascending: false })
        .limit(50),
      this.client
        .from('evacuation_centers')
        .select('*')
        .order('city', { ascending: true })
        .order('barangay', { ascending: true })
        .limit(80),
      this.client
        .from('advisories')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    if (!repRes.error && repRes.data) {
      const data = repRes.data as HazardReport[];
      this.reports.set(data);
      this.offline.cacheReports(data);
    }
    if (!cenRes.error && cenRes.data) {
      const data = cenRes.data as EvacuationCenter[];
      this.centers.set(data);
      this.offline.cacheCenters(data);
    }
    if (!advRes.error && advRes.data) {
      const data = advRes.data as Advisory[];
      this.advisories.set(data);
      this.offline.cacheAdvisories(data);
    }
  }

  async submitReport(draft: ReportDraft): Promise<{ queued: boolean }> {
    if (!this.client || this.offline.isOffline()) {
      this.offline.enqueueReport(draft);
      return { queued: true };
    }

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

    let { data, error } = await this.client
      .from('hazard_reports')
      .insert({
        ...basePayload,
        region: draft.region.trim(),
        municipality: draft.municipality.trim(),
      })
      .select()
      .single();

    if (error?.code === '42703') {
      const retry = await this.client
        .from('hazard_reports')
        .insert(basePayload)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      this.offline.enqueueReport(draft);
      return { queued: true };
    }

    this.reports.update((prev) => [data as HazardReport, ...prev]);
    this.offline.cacheReports(this.reports());
    return { queued: false };
  }

  async syncPendingQueue(): Promise<number> {
    const queue = this.offline.pendingQueue();
    if (!this.client || this.offline.isOffline() || queue.length === 0) return 0;

    this.isSyncing.set(true);
    let syncedCount = 0;
    const remaining: HazardReport[] = [];

    try {
      for (const item of queue) {
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
        let { data, error } = await this.client
          .from('hazard_reports')
          .insert({
            ...basePayload,
            region: item.region || null,
            municipality: item.municipality || null,
          })
          .select()
          .single();

        if (error?.code === '42703') {
          const retry = await this.client
            .from('hazard_reports')
            .insert(basePayload)
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }

        if (error || !data) {
          remaining.push(item);
        } else {
          syncedCount += 1;
          this.reports.update((prev) => [data as HazardReport, ...prev]);
        }
      }
      this.offline.replaceQueue(remaining);
      this.offline.cacheReports(this.reports());
      return syncedCount;
    } finally {
      this.isSyncing.set(false);
    }
  }

  async confirmReport(reportId: string): Promise<void> {
    if (this.offline.confirmedIds().has(reportId)) return;
    this.offline.markConfirmed(reportId);

    if (!this.client || this.offline.isOffline() || !UUID_REGEX.test(reportId)) return;
    const { data } = await this.client.rpc('confirm_hazard_report', {
      report_id: reportId,
    });

    if (typeof data === 'number') {
      this.reports.update((list) =>
        list.map((r) => (r.id === reportId ? { ...r, confirmations_count: data } : r))
      );
    }
  }

  async signInModerator(email: string, password: string): Promise<void> {
    if (!this.client) throw new Error('Supabase credentials are not configured.');

    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user || !data.session) {
      throw new Error(error?.message || 'Sign in failed.');
    }

    await this.client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });

    let { data: profile, error: profErr } = await this.client
      .from('moderator_profiles')
      .select('id, full_name, role, barangay_assigned, municipality_assigned')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profErr?.code === '42703') {
      ({ data: profile, error: profErr } = await this.client
        .from('moderator_profiles')
        .select('id, full_name, role, barangay_assigned')
        .eq('id', data.user.id)
        .maybeSingle());
    }

    if (profErr) {
      await this.client.auth.signOut();
      throw new Error(`Profile query error: ${profErr.message}`);
    }

    if (!profile) {
      await this.client.auth.signOut();
      throw new Error(`No moderator_profiles row found for UID ${data.user.id}.`);
    }

    this.moderator.set(profile as ModeratorProfile);
  }

  async signOutModerator(): Promise<void> {
    if (this.client) await this.client.auth.signOut();
    this.moderator.set(null);
  }

  async moderateReport(
    reportId: string,
    updates: { is_verified?: boolean; status?: ReportStatus }
  ): Promise<void> {
    if (!this.client) return;
    if (!UUID_REGEX.test(reportId)) {
      throw new Error(`Invalid UUID (${reportId}); refresh from Supabase first.`);
    }
    const payload: Record<string, unknown> = { ...updates };
    if (updates.is_verified) {
      payload['verified_at'] = new Date().toISOString();
      payload['verified_by'] = this.moderator()?.id ?? null;
    }
    const { data, error } = await this.client
      .from('hazard_reports')
      .update(payload)
      .eq('id', reportId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('Update blocked by RLS or row not found.');
    await this.refreshAll();
  }

  async updateCenter(
    centerId: string,
    updates: { status: EvacuationStatus; current_occupancy: number; notes: string }
  ): Promise<void> {
    if (!this.client) return;
    if (!UUID_REGEX.test(centerId)) {
      throw new Error(`Invalid UUID (${centerId}); refresh from Supabase first.`);
    }
    const { data, error } = await this.client
      .from('evacuation_centers')
      .update(updates)
      .eq('id', centerId)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Update blocked by RLS or row not found.');
    await this.refreshAll();
  }

  async createCenter(draft: NewEvacuationCenterDraft): Promise<void> {
    if (!this.client) return;
    const basePayload = {
      name: draft.name.trim(),
      barangay: draft.barangay.trim(),
      city: draft.city.trim(),
      address: draft.address.trim(),
      latitude: draft.latitude,
      longitude: draft.longitude,
      status: draft.status,
      current_occupancy: draft.current_occupancy,
      max_capacity: draft.max_capacity,
      notes: draft.notes.trim(),
      contact_info: draft.contact_info.trim(),
    };

    let { error } = await this.client
      .from('evacuation_centers')
      .insert({ ...basePayload, region: draft.region.trim() });

    if (error?.code === '42703') {
      const retry = await this.client
        .from('evacuation_centers')
        .insert(basePayload);
      error = retry.error;
    }

    if (error) throw new Error(error.message);
    await this.refreshAll();
  }

  async publishAdvisory(input: {
    title: string;
    message: string;
    severity: AdvisorySeverity;
    region?: string;
    municipality?: string;
    barangay: string;
  }): Promise<void> {
    if (!this.client) return;
    const basePayload = {
      title: input.title,
      message: input.message,
      severity: input.severity,
      barangay: input.barangay,
      is_active: true,
      created_by: this.moderator()?.id ?? null,
    };

    let { error } = await this.client.from('advisories').insert({
      ...basePayload,
      region: input.region || null,
      municipality: input.municipality || null,
    });

    if (error?.code === '42703') {
      const retry = await this.client.from('advisories').insert(basePayload);
      error = retry.error;
    }

    if (error) throw new Error(error.message);
    await this.refreshAll();
  }

  private async restoreModeratorSession(): Promise<void> {
    if (!this.client) return;
    const { data } = await this.client.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;

    let { data: profile, error } = await this.client
      .from('moderator_profiles')
      .select('id, full_name, role, barangay_assigned, municipality_assigned')
      .eq('id', userId)
      .maybeSingle();

    if (error?.code === '42703') {
      ({ data: profile } = await this.client
        .from('moderator_profiles')
        .select('id, full_name, role, barangay_assigned')
        .eq('id', userId)
        .maybeSingle());
    }

    if (profile) this.moderator.set(profile as ModeratorProfile);
  }

  private subscribeRealtime(): void {
    if (!this.client || this.realtimeChannel) return;
    this.realtimeChannel = this.client
      .channel('bayanihan-ng-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hazard_reports' }, () => {
        void this.refreshAll();
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evacuation_centers' },
        () => {
          void this.refreshAll();
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'advisories' }, () => {
        void this.refreshAll();
      })
      .subscribe();
  }
}
