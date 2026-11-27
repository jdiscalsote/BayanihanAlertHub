import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkRateLimit,
  clearRateLimitStoreForTests,
  handleAdminResponders,
  handleAssistantChat,
  handleReverseGeocode,
} from '../server/apiHandlers';
import { sanitizePostgrestFilterTerm } from '../src/services/supabaseClient';

describe('server apiHandlers & PostgREST query hardening', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.VITE_GOOGLE_MAPS_API_KEY;
  });

  it('enforces sliding-window rate limits per bucket key', () => {
    const first = checkRateLimit('test:1.2.3.4', 2, 60_000);
    const second = checkRateLimit('test:1.2.3.4', 2, 60_000);
    const third = checkRateLimit('test:1.2.3.4', 2, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid coordinates on handleReverseGeocode with HTTP 400 and enforces rate limit 429', async () => {
    const badRes = await handleReverseGeocode('not-a-number', '121.0', '10.0.0.1');
    expect(badRes.status).toBe(400);

    for (let i = 0; i < 29; i += 1) {
      await handleReverseGeocode('14.6', '121.0', '10.0.0.1');
    }
    const limited = await handleReverseGeocode('14.6', '121.0', '10.0.0.1');
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });

  it('enforces per-IP rate limiting on handleAssistantChat', async () => {
    for (let i = 0; i < 15; i += 1) {
      await handleAssistantChat({ messages: [] }, '192.0.2.55');
    }
    const limited = await handleAssistantChat(
      { messages: [{ role: 'user', text: 'Baha ba sa Tatalon?' }] },
      '192.0.2.55'
    );
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });

  it('returns explicit SERVICE_ROLE_MISSING when server admin key is absent', async () => {
    const res = await handleAdminResponders({ method: 'GET' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVICE_ROLE_MISSING');
  });

  it('strips PostgREST operator characters from search terms', () => {
    expect(sanitizePostgrestFilterTerm('Tatalon,id.eq.1,()%;*')).toBe(
      'Tatalon id.eq.1'
    );
  });
});
