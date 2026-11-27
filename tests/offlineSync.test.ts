import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCheckinFingerprint,
  buildReportFingerprint,
  CHECKIN_COOLDOWN_MS,
  DUPLICATE_SUBMISSION_WINDOW_MS,
  getRemainingCheckinCooldownSeconds,
  getRemainingCooldownSeconds,
  isDuplicateSubmission,
  recordCheckinSubmissionTimestamp,
  recordReportSubmissionTimestamp,
  recordSubmissionFingerprint,
  REPORT_COOLDOWN_MS,
} from '../src/services/offlineSync';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('offlineSync anti-spam cooldowns and duplicate guards', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('enforces 15s hazard report cooldown', () => {
    const t0 = 1_700_000_000_000;
    expect(getRemainingCooldownSeconds(t0)).toBe(0);
    recordReportSubmissionTimestamp(t0);
    expect(getRemainingCooldownSeconds(t0 + 5_000)).toBe(10);
    expect(getRemainingCooldownSeconds(t0 + REPORT_COOLDOWN_MS)).toBe(0);
  });

  it('enforces 30s family check-in cooldown', () => {
    const t0 = 1_700_000_000_000;
    expect(getRemainingCheckinCooldownSeconds(t0)).toBe(0);
    recordCheckinSubmissionTimestamp(t0);
    expect(getRemainingCheckinCooldownSeconds(t0 + 10_000)).toBe(20);
    expect(getRemainingCheckinCooldownSeconds(t0 + CHECKIN_COOLDOWN_MS)).toBe(0);
  });

  it('detects duplicate hazard reports within 5-minute window and expires afterward', () => {
    const t0 = 1_700_000_000_000;
    const fp1 = buildReportFingerprint({
      category: 'Flooded Roads',
      municipality: 'Quezon City',
      barangay: 'Brgy. Tatalon',
      street_or_landmark: 'Araneta Ave cor Maria Clara',
      description: 'Waist-deep flood impassable to sedans',
    });
    const fpNormalized = buildReportFingerprint({
      category: 'Flooded Roads',
      municipality: '  quezon city ',
      barangay: 'brgy. tatalon',
      street_or_landmark: 'araneta ave   cor maria clara',
      description: 'Waist-deep flood impassable to sedans',
    });

    expect(fp1).toBe(fpNormalized);
    expect(isDuplicateSubmission(fp1, t0)).toBe(false);

    recordSubmissionFingerprint(fp1, t0);
    expect(isDuplicateSubmission(fpNormalized, t0 + 60_000)).toBe(true);
    expect(
      isDuplicateSubmission(fpNormalized, t0 + DUPLICATE_SUBMISSION_WINDOW_MS + 1)
    ).toBe(false);
  });

  it('builds consistent check-in fingerprints', () => {
    const fp = buildCheckinFingerprint({
      full_name: '  Elena   Reyes ',
      status: 'Safe at Home',
      municipality: 'Marikina City',
      barangay: 'Brgy. Tumana',
    });
    expect(fp).toBe('checkin|elena reyes|safe at home|marikina city|brgy. tumana');
  });
});
