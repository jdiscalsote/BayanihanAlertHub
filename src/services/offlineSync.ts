import {
  SEED_ADVISORIES,
  SEED_EVACUATION_CENTERS,
  SEED_HAZARD_REPORTS,
} from '../data/seedData';
import type {
  Advisory,
  EvacuationCenter,
  HazardReport,
  ReportDraft,
} from '../types/alert';

const DB_NAME = 'bayanihan_alert_hub_db';
const DB_VERSION = 1;
const STORE_KV = 'kv_cache';

const KEYS = {
  REPORTS: 'cached_hazard_reports',
  CENTERS: 'cached_evacuation_centers',
  ADVISORIES: 'cached_advisories',
  QUEUE: 'pending_offline_queue',
  CONFIRMED_IDS: 'confirmed_report_ids',
  LAST_SUBMIT_AT: 'last_report_submit_at',
  LAST_SYNCED_AT: 'last_synced_at',
} as const;

const REPORT_COOLDOWN_MS = 15_000;

function openIDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openIDB();
  if (db) {
    try {
      const value = await new Promise<T | null>((resolve) => {
        const tx = db.transaction(STORE_KV, 'readonly');
        const store = tx.objectStore(STORE_KV);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      });
      db.close();
      if (value !== null) return value;
    } catch {
      db.close();
    }
  }
  try {
    const raw = localStorage.getItem(`bayanihan:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    localStorage.setItem(`bayanihan:${key}`, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }

  const db = await openIDB();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_KV, 'readwrite');
        tx.objectStore(STORE_KV).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  }
}

export interface CachedSnapshot {
  reports: HazardReport[];
  centers: EvacuationCenter[];
  advisories: Advisory[];
  queue: HazardReport[];
  lastSyncedAt: string | null;
}

export async function loadCachedSnapshot(): Promise<CachedSnapshot> {
  const [reports, centers, advisories, queue, lastSyncedAt] = await Promise.all([
    idbGet<HazardReport[]>(KEYS.REPORTS),
    idbGet<EvacuationCenter[]>(KEYS.CENTERS),
    idbGet<Advisory[]>(KEYS.ADVISORIES),
    idbGet<HazardReport[]>(KEYS.QUEUE),
    idbGet<string>(KEYS.LAST_SYNCED_AT),
  ]);

  return {
    reports: reports && reports.length > 0 ? reports : SEED_HAZARD_REPORTS,
    centers: centers && centers.length > 0 ? centers : SEED_EVACUATION_CENTERS,
    advisories: advisories && advisories.length > 0 ? advisories : SEED_ADVISORIES,
    queue: queue ?? [],
    lastSyncedAt: lastSyncedAt ?? null,
  };
}

export async function saveCachedReports(reports: HazardReport[]): Promise<void> {
  await idbSet(KEYS.REPORTS, reports.slice(0, 80));
}

export async function saveCachedCenters(centers: EvacuationCenter[]): Promise<void> {
  await idbSet(KEYS.CENTERS, centers);
}

export async function saveCachedAdvisories(advisories: Advisory[]): Promise<void> {
  await idbSet(KEYS.ADVISORIES, advisories);
}

export async function saveLastSyncedAt(iso: string): Promise<void> {
  await idbSet(KEYS.LAST_SYNCED_AT, iso);
}

export async function getPendingQueue(): Promise<HazardReport[]> {
  return (await idbGet<HazardReport[]>(KEYS.QUEUE)) ?? [];
}

export async function enqueueOfflineReport(draft: ReportDraft): Promise<HazardReport> {
  const queuedItem: HazardReport = {
    id: `offline-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`,
    category: draft.category,
    severity: draft.severity,
    region: draft.region.trim(),
    municipality: draft.municipality.trim(),
    barangay: draft.barangay.trim(),
    street_or_landmark: draft.street_or_landmark.trim(),
    description: draft.description.trim(),
    flood_level: draft.flood_level,
    contact_optional: draft.contact_optional?.trim() || null,
    is_verified: false,
    status: 'active',
    confirmations_count: 1,
    created_at: new Date().toISOString(),
    verified_at: null,
    verified_by: null,
    queued_offline: true,
  };

  const current = await getPendingQueue();
  const updated = [queuedItem, ...current];
  await idbSet(KEYS.QUEUE, updated);
  return queuedItem;
}

export async function replacePendingQueue(queue: HazardReport[]): Promise<void> {
  await idbSet(KEYS.QUEUE, queue);
}

export function getConfirmedReportIds(): Set<string> {
  try {
    const raw = localStorage.getItem(`bayanihan:${KEYS.CONFIRMED_IDS}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markReportConfirmedLocally(reportId: string): Set<string> {
  const set = getConfirmedReportIds();
  set.add(reportId);
  try {
    localStorage.setItem(
      `bayanihan:${KEYS.CONFIRMED_IDS}`,
      JSON.stringify(Array.from(set).slice(-200))
    );
  } catch {
    // Ignore storage error
  }
  return set;
}

export function getRemainingCooldownSeconds(): number {
  try {
    const raw = localStorage.getItem(`bayanihan:${KEYS.LAST_SUBMIT_AT}`);
    if (!raw) return 0;
    const elapsed = Date.now() - Number(raw);
    if (elapsed >= REPORT_COOLDOWN_MS) return 0;
    return Math.ceil((REPORT_COOLDOWN_MS - elapsed) / 1000);
  } catch {
    return 0;
  }
}

export function recordReportSubmissionTimestamp(): void {
  try {
    localStorage.setItem(`bayanihan:${KEYS.LAST_SUBMIT_AT}`, String(Date.now()));
  } catch {
    // Ignore storage error
  }
}
