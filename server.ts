import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = 'gemini-4-hydrogen';

interface GroundedLink {
  title: string;
  url: string;
}

function getGeminiClient(): GoogleGenAI | null {
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

function getMapsApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();
}

function sanitizeShortText(value: unknown, maxLen: number): string {
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

  const selectedLocation = sanitizeShortText(ctx.location, 120) || 'Quezon City / Metro Manila';

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(getGeminiClient()),
      mapsConfigured: Boolean(getMapsApiKey()),
    });
  });

  // 1. Official Weather & LGU Bulletins via Gemini + Google Search Grounding
  app.post('/api/bulletins', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server (GEMINI_API_KEY).',
      });
      return;
    }

    const municipality =
      sanitizeShortText(req.body?.municipality, 100) || 'Quezon City';
    const region =
      sanitizeShortText(req.body?.region, 100) ||
      'National Capital Region (NCR)';
    const barangay = sanitizeShortText(req.body?.barangay, 100);

    const locationLabel = barangay
      ? `${barangay}, ${municipality}`
      : `${municipality}, ${region}`;

    try {
      const prompt = [
        `Search for the latest official Philippine weather, typhoon, flood, and traffic updates affecting ${locationLabel}.`,
        'Prioritize official Philippine sources: DOST-PAGASA (tropical cyclone wind signals, heavy rainfall warnings, river basin alerts), NDRRMC, MMDA (flooded major thoroughfares and road passability), and the local LGU / DRRMO announcements.',
        'Format the response in plain, crisp mobile-friendly text with 3 short sections:',
        '1. PAGASA Weather & Rainfall Warning',
        '2. NDRRMC & MMDA Road Passability / Flood Updates',
        `3. ${municipality} LGU / DRRMO Announcements`,
        'Keep each bullet concise and factual. State clearly if no active typhoon signal or severe flood alert is currently posted.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a Philippine disaster-response information synthesizer for Bayanihan Alert Hub. Summarize only verifiable information returned by Google Search grounding from PAGASA, NDRRMC, MMDA, PIA, or official LGU channels. Never invent alerts, wind signal numbers, or road closures.',
          tools: [{ googleSearch: {} }],
        },
      });

      const summary = (response.text || '').trim();
      const sources = extractGroundingLinks(response);

      res.json({
        locationLabel,
        summary:
          summary ||
          `No recent weather or flood advisory text was returned for ${locationLabel}. Check the official PAGASA and NDRRMC links below.`,
        sources,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to fetch grounded bulletins.';
      console.error('Error in POST /api/bulletins:', message);
      res.status(502).json({
        error: `Failed to retrieve live official bulletins: ${message}`,
      });
    }
  });

  // 2. Context-Aware Bayanihan Assistant Chat (Supabase + Google Search Grounding)
  app.post('/api/assistant/chat', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server (GEMINI_API_KEY).',
      });
      return;
    }

    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
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
      res.status(400).json({ error: 'Please provide a message to Bayanihan Assistant.' });
      return;
    }

    const latestMessage = cleanedMessages[cleanedMessages.length - 1];
    if (latestMessage.role !== 'user') {
      res.status(400).json({ error: 'The latest message must come from the user.' });
      return;
    }

    const history = cleanedMessages
      .slice(0, -1)
      .map((m: { role: 'user' | 'assistant'; text: string }) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.text }],
      }));

    const liveContextBlock = buildLiveContextBlock(req.body?.context);

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
      const chat = ai.chats.create({
        model: GEMINI_MODEL,
        history,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
      });

      const response = await chat.sendMessage({
        message: latestMessage.text,
      });

      const reply = (response.text || '').trim();
      const sources = extractGroundingLinks(response);
      const needsEmergencyHotlines = detectRescueNeed(latestMessage.text, reply);

      res.json({
        reply:
          reply ||
          'Pasensya na, hindi ako nakakuha ng kumpletong sagot. Tingnan ang Evacuation Centers tab o tumawag sa 911 / Red Cross 143 kung emergency.',
        sources,
        needsEmergencyHotlines,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to reach Bayanihan Assistant.';
      console.error('Error in POST /api/assistant/chat:', message);
      res.status(502).json({
        error: `Assistant request failed: ${message}`,
      });
    }
  });

  // 3. Reverse Geocoding Server Proxy (prevents browser CORS issues & legacy JS Geocoder usage)
  app.get('/api/geocode/reverse', async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
      return;
    }

    const mapsKey = getMapsApiKey();
    if (!mapsKey) {
      res.status(503).json({
        error: 'Google Maps API key is not configured on the server.',
      });
      return;
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
        res.status(429).json({
          error: 'Google Maps reverse geocoding quota reached.',
          status: 'RESOURCE_EXHAUSTED',
        });
        return;
      }

      const payload = (await geoRes.json()) as {
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
      };

      if (payload.status === 'OVER_QUERY_LIMIT') {
        res.status(429).json({
          error: payload.error_message || 'Quota reached.',
          status: 'RESOURCE_EXHAUSTED',
        });
        return;
      }

      if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
        res.status(502).json({
          error: payload.error_message || `Geocoding failed (${payload.status || geoRes.status}).`,
        });
        return;
      }

      const first = payload.results?.[0];
      if (!first) {
        res.json({
          formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          streetOrLandmark: '',
          barangay: '',
          municipality: '',
          region: '',
        });
        return;
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

      res.json({
        formattedAddress: first.formatted_address || '',
        streetOrLandmark,
        barangay: rawBarangay ? normalizePhilippineBarangay(rawBarangay) : '',
        municipality,
        region,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Reverse geocoding failed.';
      console.error('Error in GET /api/geocode/reverse:', message);
      res.status(502).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bayanihan Alert Hub server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
