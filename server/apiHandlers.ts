import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const GEMINI_PRIMARY_MODEL = 'gemini-4-hydrogen';
const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface GroundedLink {
  title: string;
  url: string;
}

export interface ApiHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

interface ParsedGeminiError {
  httpStatus: number;
  apiStatus: string;
  rawMessage: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getMapsApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();
}

export function sanitizeShortText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function isSafeHttpUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function extractGroundingLinks(response: unknown): GroundedLink[] {
  const candidate = (response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  })?.candidates?.[0];

  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const seenUrls: Record<string, boolean> = {};
  const links: GroundedLink[] = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (!isSafeHttpUrl(uri)) continue;
    if (seenUrls[uri]) continue;
    seenUrls[uri] = true;

    let title = sanitizeShortText(chunk?.web?.title, 120);
    if (!title) {
      try {
        title = new URL(uri).hostname;
      } catch {
        title = 'Official Source';
      }
    }
    links.push({ title, url: uri });
    if (links.length >= 8) break;
  }

  return links;
}

function detectRescueNeed(userText: string, replyText: string): boolean {
  const combined = `${userText} ${replyText}`.toLowerCase();
  const urgencyTerms = [
    'rescue',
    'trapped',
    'stranded',
    'saklolo',
    'tulong',
    'na-trap',
    'bubong',
    'roof',
    'chest-deep',
    'dibdib',
    'leeg',
    'drowning',
    'lunod',
    'ambulance',
    'rubber boat',
    'medical emergency',
    'immediate danger',
    '911',
    'ndrrmc',
    'red cross',
    'evacuate immediately',
  ];
  return urgencyTerms.some((term) => combined.includes(term));
}

function normalizePhilippineBarangay(raw: string): string {
  const cleaned = sanitizeShortText(raw, 100);
  if (!cleaned) return '';
  if (/^(brgy\.?|barangay)\s+/i.test(cleaned)) {
    return `Brgy. ${cleaned.replace(/^(brgy\.?|barangay)\s+/i, '').trim()}`;
  }
  return `Brgy. ${cleaned}`;
}

function extractGeminiErrorDetails(err: unknown): ParsedGeminiError {
  const errObj = (err && typeof err === 'object' ? err : {}) as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };

  let httpStatus =
    typeof errObj.status === 'number'
      ? errObj.status
      : typeof errObj.code === 'number'
        ? errObj.code
        : 502;
  let apiStatus = '';
  let rawMessage =
    err instanceof Error
      ? err.message
      : typeof errObj.message === 'string'
        ? errObj.message
        : 'Upstream Gemini request failed.';

  const jsonStart = rawMessage.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
        error?: {
          code?: number;
          status?: string;
          message?: string;
        };
      };
      if (parsed?.error) {
        if (typeof parsed.error.code === 'number') {
          httpStatus = parsed.error.code;
        }
        if (typeof parsed.error.status === 'string') {
          apiStatus = parsed.error.status;
        }
        if (typeof parsed.error.message === 'string' && parsed.error.message.trim()) {
          rawMessage = parsed.error.message.trim();
        }
      }
    } catch {
      // Keep original rawMessage when embedded string is not valid JSON
    }
  }

  return { httpStatus, apiStatus, rawMessage };
}

function isRetryableQuotaOrTransient(details: ParsedGeminiError): boolean {
  return (
    details.httpStatus === 429 ||
    details.httpStatus === 503 ||
    details.apiStatus === 'RESOURCE_EXHAUSTED' ||
    details.apiStatus === 'UNAVAILABLE'
  );
}

function formatGeminiErrorResponse(err: unknown): ApiHandlerResult {
  const details = extractGeminiErrorDetails(err);

  if (
    details.httpStatus === 429 ||
    details.apiStatus === 'RESOURCE_EXHAUSTED'
  ) {
    return {
      status: 429,
      body: {
        error:
          'Gemini API quota or rate limit was reached for live search updates. Please wait a moment and try again, or select a billing-enabled API key in Settings > Secrets.',
        code: 'RESOURCE_EXHAUSTED',
        status: 429,
      },
    };
  }

  if (
    details.httpStatus === 403 ||
    details.httpStatus === 400 ||
    details.apiStatus === 'PERMISSION_DENIED' ||
    details.apiStatus === 'API_KEY_INVALID'
  ) {
    return {
      status: details.httpStatus === 400 ? 400 : 403,
      body: {
        error:
          'The configured Gemini API key could not be authorized. Please verify or select an active API key in Settings > Secrets.',
        code: details.apiStatus || 'PERMISSION_DENIED',
      },
    };
  }

  if (details.httpStatus === 404 || details.apiStatus === 'NOT_FOUND') {
    return {
      status: 404,
      body: {
        error:
          'The requested Gemini model is unavailable right now. Please try again shortly.',
        code: 'NOT_FOUND',
      },
    };
  }

  return {
    status: 502,
    body: {
      error:
        'Unable to retrieve live updates from Gemini right now. Please try again in a moment.',
      code: details.apiStatus || 'UPSTREAM_ERROR',
    },
  };
}

async function runWithRetryAndFallback<T>(
  operation: (model: string) => Promise<T>
): Promise<T> {
  try {
    return await operation(GEMINI_PRIMARY_MODEL);
  } catch (primaryErr) {
    const primaryDetails = extractGeminiErrorDetails(primaryErr);
    if (!isRetryableQuotaOrTransient(primaryDetails)) {
      throw primaryErr;
    }

    // Backoff before falling back to the lighter model
    await delay(750);
    try {
      return await operation(GEMINI_FALLBACK_MODEL);
    } catch (fallbackErr) {
      const fallbackDetails = extractGeminiErrorDetails(fallbackErr);
      if (!isRetryableQuotaOrTransient(fallbackDetails)) {
        throw fallbackErr;
      }

      // One final brief backoff retry on transient rate limits
      await delay(1500);
      return await operation(GEMINI_FALLBACK_MODEL);
    }
  }
}

interface LiveContextReport {
  category?: unknown;
  severity?: unknown;
  municipality?: unknown;
  barangay?: unknown;
  street_or_landmark?: unknown;
  flood_level?: unknown;
  description?: unknown;
  is_verified?: unknown;
  status?: unknown;
  confirmations_count?: unknown;
  created_at?: unknown;
}

interface LiveContextCenter {
  name?: unknown;
  city?: unknown;
  barangay?: unknown;
  address?: unknown;
  status?: unknown;
  current_occupancy?: unknown;
  max_capacity?: unknown;
  contact_info?: unknown;
  notes?: unknown;
}

interface LiveContextAdvisory {
  title?: unknown;
  message?: unknown;
  severity?: unknown;
  municipality?: unknown;
  barangay?: unknown;
}

function buildLiveContextBlock(contextRaw: unknown): string {
  if (!contextRaw || typeof contextRaw !== 'object') {
    return 'No live local report context provided.';
  }
  const ctx = contextRaw as {
    location?: unknown;
    reports?: unknown;
    centers?: unknown;
    advisories?: unknown;
  };

  const selectedLocation =
    sanitizeShortText(ctx.location, 120) || 'Quezon City / Metro Manila';

  const advisories = Array.isArray(ctx.advisories)
    ? (ctx.advisories as LiveContextAdvisory[]).slice(0, 6)
    : [];
  const centers = Array.isArray(ctx.centers)
    ? (ctx.centers as LiveContextCenter[]).slice(0, 14)
    : [];
  const reports = Array.isArray(ctx.reports)
    ? (ctx.reports as LiveContextReport[]).slice(0, 18)
    : [];

  const advisoryLines = advisories.length
    ? advisories
        .map(
          (a) =>
            `- [${sanitizeShortText(a.severity, 20)}] ${sanitizeShortText(a.title, 120)} (${sanitizeShortText(a.barangay, 60)}, ${sanitizeShortText(a.municipality, 60)}): ${sanitizeShortText(a.message, 220)}`
        )
        .join('\n')
    : '- None active in local feed.';

  const centerLines = centers.length
    ? centers
        .map(
          (c) =>
            `- [${sanitizeShortText(c.status, 20)}] ${sanitizeShortText(c.name, 100)} (${sanitizeShortText(c.barangay, 60)}, ${sanitizeShortText(c.city, 60)}) | Occupancy: ${Number(c.current_occupancy) || 0}/${Number(c.max_capacity) || 0} | Addr: ${sanitizeShortText(c.address, 120)} | Contact: ${sanitizeShortText(c.contact_info, 60)}`
        )
        .join('\n')
    : '- No evacuation centers loaded.';

  const verifiedReports = reports.filter((r) => r.is_verified === true);
  const unverifiedReports = reports.filter((r) => r.is_verified !== true);

  const formatReportLine = (r: LiveContextReport, label: string) =>
    `- [${label} | ${sanitizeShortText(r.severity, 20)} | ${sanitizeShortText(r.status, 20)}] ${sanitizeShortText(r.category, 40)} at ${sanitizeShortText(r.street_or_landmark, 100)} (${sanitizeShortText(r.barangay, 60)}, ${sanitizeShortText(r.municipality, 60)}) | Depth: ${sanitizeShortText(r.flood_level, 30)} | Confirmations: ${Number(r.confirmations_count) || 1} | Note: ${sanitizeShortText(r.description, 180)}`;

  const verifiedLines = verifiedReports.length
    ? verifiedReports.map((r) => formatReportLine(r, 'VERIFIED')).join('\n')
    : '- No verified hazard reports currently active.';

  const unverifiedLines = unverifiedReports.length
    ? unverifiedReports
        .slice(0, 8)
        .map((r) => formatReportLine(r, 'UNVERIFIED COMMUNITY'))
        .join('\n')
    : '- None.';

  return [
    `Active Location Scope: ${selectedLocation}`,
    '',
    'OFFICIAL LGU / SUPABASE ADVISORIES:',
    advisoryLines,
    '',
    'EVACUATION CENTERS (LIVE SUPABASE / CACHED SNAPSHOT):',
    centerLines,
    '',
    'VERIFIED HAZARD REPORTS:',
    verifiedLines,
    '',
    'UNVERIFIED COMMUNITY REPORTS (treat with caution and label clearly as unverified):',
    unverifiedLines,
  ].join('\n');
}

export function handleHealth(): ApiHandlerResult {
  return {
    status: 200,
    body: {
      ok: true,
      geminiConfigured: Boolean(getGeminiClient()),
      mapsConfigured: Boolean(getMapsApiKey()),
    },
  };
}


export async function handleAssistantChat(rawBody: unknown): Promise<ApiHandlerResult> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      status: 503,
      body: {
        error:
          'Gemini API key is not configured on the server (GEMINI_API_KEY). Add one in Settings > Secrets.',
      },
    };
  }

  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as {
    messages?: unknown;
    context?: unknown;
  };

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const cleanedMessages: Array<{ role: 'user' | 'assistant'; text: string }> =
    rawMessages
      .filter(
        (m: unknown): m is { role: 'user' | 'assistant'; text: string } =>
          Boolean(m) &&
          typeof m === 'object' &&
          ((m as { role?: unknown }).role === 'user' ||
            (m as { role?: unknown }).role === 'assistant') &&
          typeof (m as { text?: unknown }).text === 'string' &&
          (m as { text: string }).text.trim().length > 0
      )
      .slice(-16)
      .map((m: { role: 'user' | 'assistant'; text: string }) => ({
        role: m.role,
        text: m.text.trim().slice(0, 2000),
      }));

  if (cleanedMessages.length === 0) {
    return {
      status: 400,
      body: { error: 'Please provide a message to Bayanihan Assistant.' },
    };
  }

  const latestMessage = cleanedMessages[cleanedMessages.length - 1];
  if (latestMessage.role !== 'user') {
    return {
      status: 400,
      body: { error: 'The latest message must come from the user.' },
    };
  }

  const history = cleanedMessages
    .slice(0, -1)
    .map((m: { role: 'user' | 'assistant'; text: string }) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.text }],
    }));

  const liveContextBlock = buildLiveContextBlock(body.context);

  const systemInstruction = [
    'You are "Bayanihan Assistant", the calm, concise emergency response assistant for Bayanihan Alert Hub in the Philippines.',
    'Language rule: Reply naturally in English, Tagalog, or Taglish matching the resident’s message.',
    'Source priority rule (CRITICAL):',
    '1. Prioritize VERIFIED Supabase hazard reports, official evacuation center records, official advisories below, and live Google Search results from PAGASA, NDRRMC, MMDA, or LGU sources.',
    '2. Treat UNVERIFIED COMMUNITY reports as unconfirmed leads — always explicitly label them as "(unverified community report)" when mentioning them.',
    '3. Never invent evacuation center names, road conditions, coordinates, or phone numbers.',
    'Formatting rule: Keep responses short, calm, and action-oriented (bullet points, clear next steps) for low-bandwidth mobile users.',
    'Safety rule: If the user indicates immediate danger, rising floodwater trapping people, medical crisis, or urgent rescue need, clearly tell them to contact 911, NDRRMC, or Red Cross 143 immediately and keep instructions brief.',
    '',
    '--- LIVE APP CONTEXT ---',
    liveContextBlock,
  ].join('\n');

  try {
    const response = await runWithRetryAndFallback(async (model) => {
      const chat = ai.chats.create({
        model,
        history,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
      });
      return chat.sendMessage({
        message: latestMessage.text,
      });
    });

    const reply = (response.text || '').trim();
    const sources = extractGroundingLinks(response);
    const needsEmergencyHotlines = detectRescueNeed(latestMessage.text, reply);

    return {
      status: 200,
      body: {
        reply:
          reply ||
          'Pasensya na, hindi ako nakakuha ng kumpletong sagot. Tingnan ang Evacuation Centers tab o tumawag sa 911 / Red Cross 143 kung emergency.',
        sources,
        needsEmergencyHotlines,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const details = extractGeminiErrorDetails(err);
    console.error('Error in POST /api/assistant/chat:', details.httpStatus, details.apiStatus, details.rawMessage);
    return formatGeminiErrorResponse(err);
  }
}

export async function handleReverseGeocode(
  latRaw: unknown,
  lngRaw: unknown
): Promise<ApiHandlerResult> {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return {
      status: 400,
      body: { error: 'Valid lat and lng query parameters are required.' },
    };
  }

  const mapsKey = getMapsApiKey();
  if (!mapsKey) {
    return {
      status: 503,
      body: { error: 'Google Maps API key is not configured on the server.' },
    };
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('language', 'en');
    url.searchParams.set('region', 'ph');
    url.searchParams.set('key', mapsKey);

    const geoRes = await fetch(url.toString(), {
      headers: {
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
    });

    if (geoRes.status === 429) {
      return {
        status: 429,
        body: {
          error: 'Google Maps reverse geocoding quota reached.',
          status: 'RESOURCE_EXHAUSTED',
        },
      };
    }

    const rawText = await geoRes.text();
    let payload: {
      status?: string;
      error_message?: string;
      results?: Array<{
        formatted_address?: string;
        address_components?: Array<{
          long_name: string;
          short_name: string;
          types: string[];
        }>;
      }>;
    } = {};

    try {
      payload = rawText ? (JSON.parse(rawText) as typeof payload) : {};
    } catch {
      return {
        status: 502,
        body: { error: `Geocoding upstream returned non-JSON (${geoRes.status}).` },
      };
    }

    if (payload.status === 'OVER_QUERY_LIMIT') {
      return {
        status: 429,
        body: {
          error: payload.error_message || 'Quota reached.',
          status: 'RESOURCE_EXHAUSTED',
        },
      };
    }

    if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
      return {
        status: 502,
        body: {
          error:
            payload.error_message ||
            `Geocoding failed (${payload.status || geoRes.status}).`,
        },
      };
    }

    const first = payload.results?.[0];
    if (!first) {
      return {
        status: 200,
        body: {
          formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          streetOrLandmark: '',
          barangay: '',
          municipality: '',
          region: '',
        },
      };
    }

    const components = first.address_components || [];
    const findComp = (...wantedTypes: string[]) =>
      components.find((c) => wantedTypes.some((t) => c.types.includes(t)))
        ?.long_name || '';

    const streetNumber = findComp('street_number');
    const route = findComp('route');
    const premise = findComp('premise', 'point_of_interest', 'establishment');
    const rawBarangay = findComp(
      'sublocality_level_2',
      'sublocality_level_1',
      'sublocality',
      'neighborhood'
    );
    const municipality = findComp('locality', 'administrative_area_level_2');
    const region = findComp('administrative_area_level_1');

    const streetParts = [streetNumber, route].filter(Boolean).join(' ').trim();
    const streetOrLandmark =
      streetParts ||
      premise ||
      (first.formatted_address ? first.formatted_address.split(',')[0].trim() : '');

    return {
      status: 200,
      body: {
        formattedAddress: first.formatted_address || '',
        streetOrLandmark,
        barangay: rawBarangay ? normalizePhilippineBarangay(rawBarangay) : '',
        municipality,
        region,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Reverse geocoding failed.';
    console.error('Error in GET /api/geocode/reverse:', message);
    return {
      status: 502,
      body: { error: message },
    };
  }
}

// ----------------------------------------------------------------------------
// ADMIN RESPONDER ACCOUNT MANAGEMENT (SERVER-SIDE SERVICE ROLE + JWT ADMIN CHECK)
// ----------------------------------------------------------------------------

function detectNonServiceRoleKey(key: string): string | null {
  if (key.startsWith('sb_publishable_')) {
    return 'publishable key (sb_publishable_...)';
  }
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as { role?: string };
      if (payload.role && payload.role !== 'service_role') {
        return `JWT with role "${payload.role}"`;
      }
    } catch {
      // Non-JWT or malformed token; let Supabase validate it
    }
  }
  return null;
}

function getSupabaseAdminClient():
  | { client: SupabaseClient }
  | { errorResult: ApiHandlerResult } {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) {
    return {
      errorResult: {
        status: 503,
        body: {
          error:
            'Server admin key (SUPABASE_SERVICE_ROLE_KEY) is not configured. Add SUPABASE_SERVICE_ROLE_KEY to your server environment variables (Vercel or Settings > Secrets) to create, reset passwords for, or delete responder accounts.',
          code: 'SERVICE_ROLE_MISSING',
        },
      },
    };
  }

  const wrongKeyType = detectNonServiceRoleKey(serviceRoleKey);
  if (wrongKeyType) {
    return {
      errorResult: {
        status: 503,
        body: {
          error: `SUPABASE_SERVICE_ROLE_KEY is currently set to a public ${wrongKeyType} instead of your secret service_role key. Copy the "service_role" (or "sb_secret_...") key from Supabase Project Settings -> API Keys and redeploy.`,
          code: 'INVALID_SERVICE_ROLE_KEY',
        },
      },
    };
  }

  return {
    client: createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }),
  };
}

function generateDefaultPassword(length = 14): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;

  const chars = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  while (chars.length < length) {
    chars.push(all[crypto.randomInt(all.length)]);
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

async function verifyAdminCaller(
  adminClient: SupabaseClient,
  authHeader: string | undefined
): Promise<{ userId: string } | ApiHandlerResult> {
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

  if (!token) {
    return {
      status: 401,
      body: { error: 'Authentication required. Sign in as an admin first.' },
    };
  }

  const { data: userData, error: userError } =
    await adminClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return {
      status: 401,
      body: { error: 'Invalid or expired responder session. Please sign in again.' },
    };
  }

  const { data: profile, error: profileError } = await adminClient
    .from('moderator_profiles')
    .select('id, role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) {
    const isPermDenied = profileError.message
      .toLowerCase()
      .includes('permission denied');
    return {
      status: 500,
      body: {
        error: isPermDenied
          ? `Permission denied reading moderator_profiles (${profileError.message}). Make sure SUPABASE_SERVICE_ROLE_KEY is your secret service_role key (not the anon key) and run the latest GRANT statements in supabase/schema.sql.`
          : `Unable to verify admin privileges: ${profileError.message}`,
      },
    };
  }

  if (!profile || profile.role !== 'admin') {
    return {
      status: 403,
      body: { error: 'Admin privileges are required to manage responder accounts.' },
    };
  }

  return { userId: userData.user.id };
}

export async function handleAdminResponders(params: {
  method: string;
  authHeader?: string;
  queryId?: string;
  body?: unknown;
}): Promise<ApiHandlerResult> {
  const adminInit = getSupabaseAdminClient();
  if ('errorResult' in adminInit) {
    return adminInit.errorResult;
  }
  const adminClient = adminInit.client;

  const authCheck = await verifyAdminCaller(adminClient, params.authHeader);
  if ('status' in authCheck) {
    return authCheck;
  }

  const method = (params.method || 'GET').toUpperCase();

  if (method === 'GET') {
    try {
      const [{ data: profiles, error: profilesErr }, usersRes] = await Promise.all([
        adminClient
          .from('moderator_profiles')
          .select('*')
          .order('municipality_assigned', { ascending: true })
          .order('full_name', { ascending: true }),
        adminClient.auth.admin.listUsers({ page: 1, perPage: 200 }),
      ]);

      if (profilesErr) {
        return { status: 500, body: { error: profilesErr.message } };
      }

      const authById = new Map<
        string,
        { email?: string; last_sign_in_at?: string | null }
      >();
      if (!usersRes.error && usersRes.data?.users) {
        for (const u of usersRes.data.users) {
          authById.set(u.id, {
            email: u.email,
            last_sign_in_at: u.last_sign_in_at ?? null,
          });
        }
      }

      const responders = (profiles ?? []).map((p) => {
        const authMeta = authById.get(String(p.id));
        return {
          ...p,
          email: authMeta?.email || p.email || '',
          last_sign_in_at: authMeta?.last_sign_in_at ?? null,
        };
      });

      return { status: 200, body: { responders } };
    } catch (err) {
      return {
        status: 500,
        body: {
          error: err instanceof Error ? err.message : 'Unable to list responders.',
        },
      };
    }
  }

  const body = (
    params.body && typeof params.body === 'object' ? params.body : {}
  ) as Record<string, unknown>;

  if (method === 'POST') {
    const email = sanitizeShortText(body.email, 160).toLowerCase();
    const fullName = sanitizeShortText(body.full_name, 120);
    const role = body.role === 'admin' ? 'admin' : 'moderator';
    const municipalityAssigned =
      sanitizeShortText(body.municipality_assigned, 100) ||
      (role === 'admin' ? 'All Municipalities' : '');
    const barangayAssigned =
      sanitizeShortText(body.barangay_assigned, 120) ||
      (municipalityAssigned ? `${municipalityAssigned} DRRMO` : '');

    if (!EMAIL_REGEX.test(email)) {
      return { status: 400, body: { error: 'A valid responder email is required.' } };
    }
    if (fullName.length < 2) {
      return { status: 400, body: { error: 'Full name must be at least 2 characters.' } };
    }
    if (municipalityAssigned.length < 2) {
      return { status: 400, body: { error: 'Assigned municipality is required.' } };
    }
    if (barangayAssigned.length < 2) {
      return { status: 400, body: { error: 'Assigned office/barangay label is required.' } };
    }

    const generatedPassword = generateDefaultPassword(14);
    const { data: createdAuth, error: authErr } =
      await adminClient.auth.admin.createUser({
        email,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    if (authErr || !createdAuth?.user) {
      return {
        status: 400,
        body: {
          error: authErr?.message || 'Unable to create Supabase Auth user.',
        },
      };
    }

    const newUserId = createdAuth.user.id;
    let { data: profile, error: profErr } = await adminClient
      .from('moderator_profiles')
      .upsert({
        id: newUserId,
        email,
        full_name: fullName,
        role,
        municipality_assigned: municipalityAssigned,
        barangay_assigned: barangayAssigned,
      })
      .select('*')
      .single();

    if (profErr && (profErr.code === '42703' || profErr.message.includes('column'))) {
      ({ data: profile, error: profErr } = await adminClient
        .from('moderator_profiles')
        .upsert({
          id: newUserId,
          full_name: fullName,
          role,
          municipality_assigned: municipalityAssigned,
          barangay_assigned: barangayAssigned,
        })
        .select('*')
        .single());
    }

    if (profErr || !profile) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return {
        status: 500,
        body: {
          error: profErr?.message || 'Failed to save responder assignment profile.',
        },
      };
    }

    return {
      status: 201,
      body: {
        responder: {
          ...profile,
          email,
          last_sign_in_at: null,
        },
        generatedPassword,
      },
    };
  }

  if (method === 'PATCH') {
    const targetId = sanitizeShortText(body.id ?? params.queryId, 60);
    if (!UUID_REGEX.test(targetId)) {
      return { status: 400, body: { error: 'Valid responder ID is required.' } };
    }

    const fullName = sanitizeShortText(body.full_name, 120);
    const role = body.role === 'admin' ? 'admin' : 'moderator';
    const municipalityAssigned = sanitizeShortText(body.municipality_assigned, 100);
    const barangayAssigned = sanitizeShortText(body.barangay_assigned, 120);
    const resetPassword = body.reset_password === true;

    if (targetId === authCheck.userId && role !== 'admin') {
      return {
        status: 400,
        body: {
          error: 'You cannot remove admin privileges from your own active account.',
        },
      };
    }

    if (fullName.length < 2 || municipalityAssigned.length < 2 || barangayAssigned.length < 2) {
      return {
        status: 400,
        body: {
          error: 'Full name, assigned municipality, and office/barangay are required.',
        },
      };
    }

    const { data: updatedProfile, error: updateErr } = await adminClient
      .from('moderator_profiles')
      .update({
        full_name: fullName,
        role,
        municipality_assigned: municipalityAssigned,
        barangay_assigned: barangayAssigned,
      })
      .eq('id', targetId)
      .select('*')
      .maybeSingle();

    if (updateErr) {
      return { status: 500, body: { error: updateErr.message } };
    }
    if (!updatedProfile) {
      return { status: 404, body: { error: 'Responder profile not found.' } };
    }

    let generatedPassword: string | undefined;
    if (resetPassword) {
      generatedPassword = generateDefaultPassword(14);
      const { error: pwdErr } = await adminClient.auth.admin.updateUserById(
        targetId,
        { password: generatedPassword }
      );
      if (pwdErr) {
        return {
          status: 500,
          body: {
            error: `Profile updated, but password reset failed: ${pwdErr.message}`,
          },
        };
      }
    }

    const { data: authUserRes } = await adminClient.auth.admin.getUserById(targetId);

    return {
      status: 200,
      body: {
        responder: {
          ...updatedProfile,
          email: authUserRes?.user?.email || updatedProfile.email || '',
          last_sign_in_at: authUserRes?.user?.last_sign_in_at ?? null,
        },
        ...(generatedPassword ? { generatedPassword } : {}),
      },
    };
  }

  if (method === 'DELETE') {
    const targetId = sanitizeShortText(params.queryId ?? body.id, 60);
    if (!UUID_REGEX.test(targetId)) {
      return { status: 400, body: { error: 'Valid responder ID is required.' } };
    }
    if (targetId === authCheck.userId) {
      return {
        status: 400,
        body: { error: 'You cannot delete your own active admin account.' },
      };
    }

    const { error: deleteAuthErr } =
      await adminClient.auth.admin.deleteUser(targetId);
    if (deleteAuthErr) {
      return { status: 500, body: { error: deleteAuthErr.message } };
    }

    await adminClient.from('moderator_profiles').delete().eq('id', targetId);

    return {
      status: 200,
      body: { deletedId: targetId },
    };
  }

  return {
    status: 405,
    body: { error: `Method ${method} not allowed.` },
  };
}
