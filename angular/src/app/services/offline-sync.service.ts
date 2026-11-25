import { Injectable, signal } from '@angular/core';
import {
  Advisory,
  EvacuationCenter,
  HazardReport,
  ReportDraft,
} from '../models/alert.models';

const CACHE_KEYS = {
  REPORTS: 'bayanihan_ng_reports',
  CENTERS: 'bayanihan_ng_centers',
  ADVISORIES: 'bayanihan_ng_advisories',
  QUEUE: 'bayanihan_ng_pending_queue',
  CONFIRMED: 'bayanihan_ng_confirmed_ids',
  LAST_SUBMIT: 'bayanihan_ng_last_submit',
} as const;

const COOLDOWN_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  readonly isOffline = signal<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  readonly pendingQueue = signal<HazardReport[]>(this.readJson(CACHE_KEYS.QUEUE, []));
  readonly confirmedIds = signal<Set<string>>(
    new Set(this.readJson<string[]>(CACHE_KEYS.CONFIRMED, []))
  );

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.isOffline.set(false));
      window.addEventListener('offline', () => this.isOffline.set(true));
    }
  }

  cacheReports(reports: HazardReport[]): void {
    this.writeJson(CACHE_KEYS.REPORTS, reports.slice(0, 80));
  }

  getCachedReports(fallback: HazardReport[]): HazardReport[] {
    const cached = this.readJson<HazardReport[]>(CACHE_KEYS.REPORTS, []);
    return cached.length > 0 ? cached : fallback;
  }

  cacheCenters(centers: EvacuationCenter[]): void {
    this.writeJson(CACHE_KEYS.CENTERS, centers);
  }

  getCachedCenters(fallback: EvacuationCenter[]): EvacuationCenter[] {
    const cached = this.readJson<EvacuationCenter[]>(CACHE_KEYS.CENTERS, []);
    return cached.length > 0 ? cached : fallback;
  }

  cacheAdvisories(advisories: Advisory[]): void {
    this.writeJson(CACHE_KEYS.ADVISORIES, advisories);
  }

  getCachedAdvisories(fallback: Advisory[]): Advisory[] {
    const cached = this.readJson<Advisory[]>(CACHE_KEYS.ADVISORIES, []);
    return cached.length > 0 ? cached : fallback;
  }

  enqueueReport(draft: ReportDraft): HazardReport {
    const queued: HazardReport = {
      id: `offline-${Date.now().toString(36)}`,
      ...draft,
      region: draft.region.trim(),
      municipality: draft.municipality.trim(),
      barangay: draft.barangay.trim(),
      street_or_landmark: draft.street_or_landmark.trim(),
      description: draft.description.trim(),
      contact_optional: draft.contact_optional?.trim() || null,
      is_verified: false,
      status: 'active',
      confirmations_count: 1,
      created_at: new Date().toISOString(),
      queued_offline: true,
    };
    const next = [queued, ...this.pendingQueue()];
    this.pendingQueue.set(next);
    this.writeJson(CACHE_KEYS.QUEUE, next);
    return queued;
  }

  replaceQueue(queue: HazardReport[]): void {
    this.pendingQueue.set(queue);
    this.writeJson(CACHE_KEYS.QUEUE, queue);
  }

  markConfirmed(reportId: string): void {
    const updated = new Set(this.confirmedIds());
    updated.add(reportId);
    this.confirmedIds.set(updated);
    this.writeJson(CACHE_KEYS.CONFIRMED, Array.from(updated).slice(-200));
  }

  getCooldownSeconds(): number {
    const last = Number(localStorage.getItem(CACHE_KEYS.LAST_SUBMIT) || '0');
    const remaining = COOLDOWN_MS - (Date.now() - last);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  recordSubmission(): void {
    localStorage.setItem(CACHE_KEYS.LAST_SUBMIT, String(Date.now()));
  }

  private readJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private writeJson<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore quota errors
    }
  }
}
