import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Backpack,
  Check,
  CheckCircle2,
  Copy,
  Crosshair,
  Database,
  MessageSquareWarning,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  EvacuationCenter,
  SafetyCheckin,
  SafetyCheckinDraft,
  SafetyCheckinStatus,
} from '../types/alert';
import {
  buildSafeGoogleMapsUrl,
  buildSafeSmsHref,
  formatRelativeTime,
} from '../utils/formatters';
import { requestBestEffortGeolocation } from '../utils/geolocation';

const GOBAG_STORAGE_KEY = 'bayanihan:gobag_checklist_v1';

interface GoBagItem {
  id: string;
  en: string;
  tl: string;
  group: 'Water & Food' | 'Medical & Hygiene' | 'Docs & Comms' | 'Tools & Gear';
}

const GO_BAG_ITEMS: GoBagItem[] = [
  {
    id: 'water',
    en: 'Drinking water (3L per person for 3 days)',
    tl: 'Inuming tubig (3 litro bawat tao)',
    group: 'Water & Food',
  },
  {
    id: 'food',
    en: 'Ready-to-eat canned goods, biscuits & infant formula',
    tl: 'De-lata, biskwit at gatas ng sanggol',
    group: 'Water & Food',
  },
  {
    id: 'meds',
    en: 'Maintenance medicines & first-aid kit',
    tl: 'Mga gamot at first-aid kit',
    group: 'Medical & Hygiene',
  },
  {
    id: 'hygiene',
    en: 'Soap, alcohol, sanitary napkins & face masks',
    tl: 'Sabon, alcohol, sanitary supplies at mask',
    group: 'Medical & Hygiene',
  },
  {
    id: 'docs',
    en: 'IDs, birth certificates & cash in waterproof pouch',
    tl: 'Mga ID, papeles at cash sa waterproof pouch',
    group: 'Docs & Comms',
  },
  {
    id: 'power',
    en: 'Fully charged powerbank & charging cables',
    tl: 'Naka-charge na powerbank at cable',
    group: 'Docs & Comms',
  },
  {
    id: 'contacts',
    en: 'Written list of family & LGU emergency numbers',
    tl: 'Nakasulat na emergency numbers ng pamilya/LGU',
    group: 'Docs & Comms',
  },
  {
    id: 'light',
    en: 'Flashlight / headlamp & spare batteries',
    tl: 'Flashlight at reserbang baterya',
    group: 'Tools & Gear',
  },
  {
    id: 'whistle',
    en: 'Loud emergency whistle (for rescue signaling)',
    tl: 'Pito (whistle) para sa paghingi ng tulong',
    group: 'Tools & Gear',
  },
  {
    id: 'clothes',
    en: 'Dry clothes, raincoat & compact blanket',
    tl: 'Tuyong damit, kapote at kumot',
    group: 'Tools & Gear',
  },
];

function loadCheckedGoBag(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GOBAG_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const SAFETY_CHECKINS_SQL = `CREATE TABLE IF NOT EXISTS public.safety_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  status TEXT NOT NULL CHECK (status IN ('Evacuated to Shelter', 'Safe at Home', 'Needs Contact')) DEFAULT 'Evacuated to Shelter',
  municipality TEXT NOT NULL DEFAULT 'Quezon City',
  barangay TEXT NOT NULL CHECK (char_length(barangay) BETWEEN 2 AND 100),
  evacuation_center TEXT DEFAULT NULL CHECK (evacuation_center IS NULL OR char_length(evacuation_center) <= 160),
  household_count INTEGER NOT NULL DEFAULT 1 CHECK (household_count BETWEEN 1 AND 50),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 280),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.safety_checkins ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.safety_checkins TO anon, authenticated;
GRANT DELETE ON public.safety_checkins TO authenticated;
DROP POLICY IF EXISTS "Public read safety check-ins" ON public.safety_checkins;
CREATE POLICY "Public read safety check-ins" ON public.safety_checkins FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public insert safety check-ins" ON public.safety_checkins;
CREATE POLICY "Public insert safety check-ins" ON public.safety_checkins FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Moderators delete safety check-ins" ON public.safety_checkins;
CREATE POLICY "Moderators delete safety check-ins" ON public.safety_checkins FOR DELETE TO authenticated USING (public.can_manage_municipality(municipality));`;

interface SafetyToolsViewProps {
  checkins: SafetyCheckin[];
  queuedCheckins: SafetyCheckin[];
  centers: EvacuationCenter[];
  isOffline: boolean;
  isSyncing: boolean;
  isRefreshing: boolean;
  supabaseConfigured: boolean;
  usingSupabaseCheckins: boolean;
  checkinSyncError: string | null;
  onSubmitCheckin: (
    draft: SafetyCheckinDraft
  ) => Promise<{ queued: boolean; syncError?: string }>;
  onSyncCheckins: () => void;
  onRefreshCheckins: () => void;
}

const CHECKIN_STATUSES: SafetyCheckinStatus[] = [
  'Evacuated to Shelter',
  'Safe at Home',
  'Needs Contact',
];

export function SafetyToolsView({
  checkins,
  queuedCheckins,
  centers,
  isOffline,
  isSyncing,
  isRefreshing,
  supabaseConfigured,
  usingSupabaseCheckins,
  checkinSyncError,
  onSubmitCheckin,
  onSyncCheckins,
  onRefreshCheckins,
}: SafetyToolsViewProps) {
  // 1. One-Tap SOS SMS & Share Location state
  const [sosMode, setSosMode] = useState<'rescue' | 'safe'>('rescue');
  const [sosRecipient, setSosRecipient] = useState('911');
  const [customPhone, setCustomPhone] = useState('');
  const [sosName, setSosName] = useState('');
  const [sosArea, setSosArea] = useState('Quezon City');
  const [sosCount, setSosCount] = useState(2);
  const [sosNeeds, setSosNeeds] = useState<string[]>([]);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locatingGps, setLocatingGps] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [copiedSms, setCopiedSms] = useState(false);

  // 2. Family "I'm Safe" Check-in state
  const [checkinQuery, setCheckinQuery] = useState('');
  const [fullName, setFullName] = useState('');
  const [checkinStatus, setCheckinStatus] =
    useState<SafetyCheckinStatus>('Evacuated to Shelter');
  const [municipality, setMunicipality] = useState('Quezon City');
  const [barangay, setBarangay] = useState('');
  const [evacuationCenter, setEvacuationCenter] = useState('');
  const [householdCount, setHouseholdCount] = useState(1);
  const [checkinNote, setCheckinNote] = useState('');
  const [submittingCheckin, setSubmittingCheckin] = useState(false);
  const [checkinFeedback, setCheckinFeedback] = useState<{
    tone: 'success' | 'warning';
    text: string;
  } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // 3. Go-Bag Checklist state
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(
    () => loadCheckedGoBag()
  );

  const sosMessageText = useMemo(() => {
    const header =
      sosMode === 'rescue'
        ? '[SOS RESCUE NEEDED - BAYANIHAN]'
        : '[I AM SAFE CHECK-IN - BAYANIHAN]';
    const who = sosName.trim() ? `Name: ${sosName.trim()}` : null;
    const loc = gpsCoords
      ? `GPS: ${gpsCoords.lat.toFixed(5)},${gpsCoords.lng.toFixed(5)} (${buildSafeGoogleMapsUrl(gpsCoords.lat, gpsCoords.lng)})`
      : null;
    const area = sosArea.trim() ? `Area/Landmark: ${sosArea.trim()}` : null;
    const people =
      sosMode === 'rescue' ? `People: ${Math.max(1, sosCount)}` : null;
    const urgent =
      sosMode === 'rescue' && sosNeeds.length > 0
        ? `Urgent: ${sosNeeds.join(', ')}`
        : null;
    return [header, who, area, loc, people, urgent]
      .filter(Boolean)
      .join('\n');
  }, [sosMode, sosName, sosArea, gpsCoords, sosCount, sosNeeds]);

  const targetSmsNumber =
    sosRecipient === 'custom' ? customPhone.trim() : sosRecipient;

  async function handleGrabGps() {
    setLocatingGps(true);
    setGpsNote(null);
    const res = await requestBestEffortGeolocation();
    setLocatingGps(false);
    if (res.ok) {
      setGpsCoords(res.coords);
      setGpsNote(
        `GPS locked (${res.coords.lat.toFixed(5)}, ${res.coords.lng.toFixed(5)}).`
      );
    } else {
      setGpsNote(
        `${res.message} Type your street/barangay in Area/Landmark so rescue knows where to go.`
      );
    }
  }

  function toggleNeed(need: string) {
    setSosNeeds((prev) =>
      prev.includes(need) ? prev.filter((n) => n !== need) : [...prev, need]
    );
  }

  async function handleCopySosMessage() {
    try {
      await navigator.clipboard.writeText(sosMessageText);
      setCopiedSms(true);
      setTimeout(() => setCopiedSms(false), 2000);
    } catch {
      // Clipboard blocked
    }
  }

  async function handleShareSosMessage() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: 'Bayanihan Emergency Status',
          text: sosMessageText,
        });
        return;
      } catch {
        // User cancelled or share unsupported
      }
    }
    await handleCopySosMessage();
  }

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(SAFETY_CHECKINS_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      // Clipboard blocked
    }
  }

  async function handleCheckinSubmit(e: FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      setCheckinFeedback({
        tone: 'warning',
        text: 'Please enter a full name or family name.',
      });
      return;
    }
    if (barangay.trim().length < 2) {
      setCheckinFeedback({
        tone: 'warning',
        text: 'Please enter your barangay.',
      });
      return;
    }

    setSubmittingCheckin(true);
    setCheckinFeedback(null);
    try {
      const result = await onSubmitCheckin({
        full_name: fullName.trim(),
        status: checkinStatus,
        municipality: municipality.trim() || 'Quezon City',
        barangay: barangay.trim(),
        evacuation_center: evacuationCenter.trim() || undefined,
        household_count: householdCount,
        note: checkinNote.trim(),
      });
      setFullName('');
      setCheckinNote('');
      if (result.queued) {
        setCheckinFeedback({
          tone: 'warning',
          text: result.syncError
            ? `Saved locally in queue, but live Supabase insert failed: ${result.syncError}`
            : 'Saved locally to your offline queue. It will auto-sync once signal returns.',
        });
      } else {
        setCheckinFeedback({
          tone: 'success',
          text: 'Saved to live Supabase database so relatives can find your status across devices.',
        });
      }
    } catch (err) {
      setCheckinFeedback({
        tone: 'warning',
        text: err instanceof Error ? err.message : 'Unable to save check-in.',
      });
    } finally {
      setSubmittingCheckin(false);
    }
  }

  function toggleGoBagItem(id: string) {
    setCheckedItems((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(GOBAG_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage error
      }
      return next;
    });
  }

  function resetGoBagChecklist() {
    setCheckedItems({});
    try {
      localStorage.removeItem(GOBAG_STORAGE_KEY);
    } catch {
      // Ignore storage error
    }
  }

  const allCheckins = [...queuedCheckins, ...checkins];
  const normalizedCheckinSearch = checkinQuery.trim().toLowerCase();
  const filteredCheckins = allCheckins.filter((c) => {
    if (!normalizedCheckinSearch) return true;
    return (
      c.full_name.toLowerCase().includes(normalizedCheckinSearch) ||
      c.barangay.toLowerCase().includes(normalizedCheckinSearch) ||
      c.municipality.toLowerCase().includes(normalizedCheckinSearch) ||
      (c.evacuation_center || '').toLowerCase().includes(normalizedCheckinSearch)
    );
  });

  const packedCount = GO_BAG_ITEMS.filter((i) => checkedItems[i.id]).length;
  const packedPct = Math.round((packedCount / GO_BAG_ITEMS.length) * 100);

  return (
    <div className="space-y-8">
      {/* 1. One-Tap SOS SMS & Share Location Card */}
      <section
        aria-label="One-Tap SOS SMS and Safe Location Share"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareWarning
                className="h-5 w-5 text-red-600"
                aria-hidden="true"
              />
              <h1 className="font-display text-lg font-bold text-slate-900">
                One-Tap SOS SMS &amp; Safe Location Card
              </h1>
            </div>
            <p className="mt-1 text-xs text-slate-600 sm:text-sm">
              Works even with zero mobile data — prepares an SMS with your exact coordinates and urgent needs for 911, Red Cross, or family.
            </p>
          </div>

          <div
            role="group"
            aria-label="Choose SMS message mode"
            className="inline-flex shrink-0 rounded-md border border-slate-300 bg-slate-100 p-0.5 text-xs font-medium"
          >
            <button
              type="button"
              onClick={() => setSosMode('rescue')}
              className={`cursor-pointer rounded px-3 py-1.5 transition-colors ${
                sosMode === 'rescue'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Need Rescue (SOS)
            </button>
            <button
              type="button"
              onClick={() => setSosMode('safe')}
              className={`cursor-pointer rounded px-3 py-1.5 transition-colors ${
                sosMode === 'safe'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              I Am Safe
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="sos-recipient"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Send SMS To
                </label>
                <select
                  id="sos-recipient"
                  value={sosRecipient}
                  onChange={(e) => setSosRecipient(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:text-sm"
                >
                  <option value="911">911 National Emergency</option>
                  <option value="143">143 Philippine Red Cross</option>
                  <option value="122">122 QC Helpline</option>
                  <option value="161">161 Marikina Rescue</option>
                  <option value="custom">Custom Family / Barangay Number</option>
                </select>
              </div>

              {sosRecipient === 'custom' ? (
                <div>
                  <label
                    htmlFor="sos-custom-phone"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Recipient Mobile Number
                  </label>
                  <input
                    id="sos-custom-phone"
                    type="tel"
                    value={customPhone}
                    onChange={(e) => setCustomPhone(e.target.value)}
                    placeholder="e.g. 09171234567"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:text-sm"
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="sos-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Your Name (optional)
                  </label>
                  <input
                    id="sos-name"
                    type="text"
                    value={sosName}
                    onChange={(e) => setSosName(e.target.value)}
                    placeholder="e.g. Juan Dela Cruz"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:text-sm"
                  />
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="sos-area"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Street / Barangay / Landmark
                </label>
                <input
                  id="sos-area"
                  type="text"
                  value={sosArea}
                  onChange={(e) => setSosArea(e.target.value)}
                  placeholder="e.g. Sitio Veterans, Brgy. Bagong Silangan"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:text-sm"
                />
              </div>

              {sosMode === 'rescue' && (
                <div>
                  <label
                    htmlFor="sos-count"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    People Needing Help
                  </label>
                  <input
                    id="sos-count"
                    type="number"
                    min={1}
                    max={50}
                    value={sosCount}
                    onChange={(e) => setSosCount(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:text-sm"
                  />
                </div>
              )}
            </div>

            {sosMode === 'rescue' && (
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  Special Needs (select any that apply)
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {[
                    'Senior Citizen',
                    'Infant / Child',
                    'Medical / Wheelchair',
                    'Rising Roof/2nd Floor Water',
                    'Rubber Boat Needed',
                  ].map((need) => {
                    const active = sosNeeds.includes(need);
                    return (
                      <button
                        key={need}
                        type="button"
                        onClick={() => toggleNeed(need)}
                        className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          active
                            ? 'border-red-600 bg-red-50 text-red-800'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {need}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleGrabGps()}
                disabled={locatingGps}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                <Crosshair className="h-3.5 w-3.5 text-sky-700" aria-hidden="true" />
                <span>
                  {locatingGps
                    ? 'Locking GPS...'
                    : gpsCoords
                      ? 'Refresh GPS Pin'
                      : 'Attach GPS Coordinates'}
                </span>
              </button>
              {gpsNote && (
                <span className="text-xs text-slate-600">{gpsNote}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                SMS &amp; Share Preview
              </p>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800">
                {sosMessageText}
              </pre>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={buildSafeSmsHref(targetSmsNumber, sosMessageText)}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3.5 py-2.5 text-xs font-semibold text-white transition-colors ${
                  sosMode === 'rescue'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Open SMS App</span>
              </a>

              <button
                type="button"
                onClick={() => void handleShareSosMessage()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={() => void handleCopySosMessage()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                {copiedSms ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Family "I'm Safe" Check-In & Person Finder */}
      <section
        aria-label="Family I Am Safe Check-In and Person Finder"
        className="grid gap-6 lg:grid-cols-12"
      >
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Log Family &ldquo;I&rsquo;m Safe&rdquo; Check-In
              </h2>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                usingSupabaseCheckins
                  ? 'text-emerald-700'
                  : 'text-amber-700'
              }`}
            >
              <Database className="h-3 w-3" aria-hidden="true" />
              <span>
                {isOffline
                  ? 'Offline Queue'
                  : usingSupabaseCheckins
                    ? 'Live DB Ready'
                    : 'Local Fallback'}
              </span>
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {isOffline
              ? 'Offline mode active — your check-in will queue on-device and sync when signal returns.'
              : usingSupabaseCheckins
                ? 'Connected to live Supabase DB — check-ins save online and appear across devices.'
                : 'Currently saving locally because live Supabase check-in sync is unavailable.'}
          </p>

          {checkinSyncError && !isOffline && (
            <div
              role="alert"
              className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                <span>{checkinSyncError}</span>
              </div>
              {supabaseConfigured && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopySql()}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-100"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    <span>{copiedSql ? 'Copied SQL!' : 'Copy safety_checkins SQL'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onRefreshCheckins}
                    disabled={isRefreshing}
                    className="inline-flex cursor-pointer items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>Test Connection</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleCheckinSubmit} className="mt-4 space-y-3">
            {checkinFeedback && (
              <div
                role="status"
                className={`rounded-md border px-3 py-2 text-xs font-medium ${
                  checkinFeedback.tone === 'warning'
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                }`}
              >
                {checkinFeedback.text}
              </div>
            )}

            <div>
              <label
                htmlFor="chk-name"
                className="block text-xs font-semibold text-slate-700"
              >
                Full Name or Family Name
              </label>
              <input
                id="chk-name"
                required
                maxLength={120}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Elena Reyes & Family"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="chk-status"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Safety Status
                </label>
                <select
                  id="chk-status"
                  value={checkinStatus}
                  onChange={(e) =>
                    setCheckinStatus(e.target.value as SafetyCheckinStatus)
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:text-sm"
                >
                  {CHECKIN_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="chk-count"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Household Count
                </label>
                <input
                  id="chk-count"
                  type="number"
                  min={1}
                  max={50}
                  value={householdCount}
                  onChange={(e) =>
                    setHouseholdCount(Number(e.target.value) || 1)
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="chk-muni"
                  className="block text-xs font-semibold text-slate-700"
                >
                  City / Municipality
                </label>
                <input
                  id="chk-muni"
                  required
                  maxLength={100}
                  value={municipality}
                  onChange={(e) => setMunicipality(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="chk-brgy"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Barangay
                </label>
                <input
                  id="chk-brgy"
                  required
                  maxLength={100}
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  placeholder="e.g. Brgy. Tatalon"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            {checkinStatus === 'Evacuated to Shelter' && (
              <div>
                <label
                  htmlFor="chk-center"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Evacuation Center (optional)
                </label>
                <select
                  id="chk-center"
                  value={evacuationCenter}
                  onChange={(e) => setEvacuationCenter(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none sm:text-sm"
                >
                  <option value="">Select evacuation center...</option>
                  {centers.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} ({c.barangay})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor="chk-note"
                className="block text-xs font-semibold text-slate-700"
              >
                Short Note for Relatives (optional)
              </label>
              <textarea
                id="chk-note"
                rows={2}
                maxLength={280}
                value={checkinNote}
                onChange={(e) => setCheckinNote(e.target.value)}
                placeholder="e.g. Safe on 2nd floor, saving phone battery..."
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submittingCheckin}
              className="w-full cursor-pointer rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {submittingCheckin ? 'Saving Check-In...' : 'Post Safety Check-In'}
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Person Finder &amp; Recent Safe Check-Ins
              </h2>
              <p className="text-xs text-slate-600">
                Search by family name, barangay, municipality, or shelter name.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {queuedCheckins.length > 0 && !isOffline && (
                <button
                  type="button"
                  onClick={onSyncCheckins}
                  disabled={isSyncing}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>
                    {isSyncing
                      ? 'Syncing...'
                      : `Sync ${queuedCheckins.length} Local to DB`}
                  </span>
                </button>
              )}
              <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-slate-600">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{filteredCheckins.length} listed</span>
              </span>
            </div>
          </div>

          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={checkinQuery}
              onChange={(e) => setCheckinQuery(e.target.value)}
              placeholder="Search name, barangay, or evacuation center..."
              aria-label="Search safety check-ins"
              className="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="mt-4 max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
            {filteredCheckins.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                No matching safety check-ins found.
              </p>
            ) : (
              filteredCheckins.map((item) => (
                <article
                  key={item.id}
                  className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-bold text-slate-900">
                        {item.full_name}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          item.status === 'Needs Contact'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        · {item.status}
                      </span>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-slate-500">
                      {formatRelativeTime(item.created_at)}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-600">
                    {item.barangay}, {item.municipality} · Household of{' '}
                    <span className="font-mono font-semibold">
                      {item.household_count}
                    </span>
                    {item.evacuation_center ? ` · At ${item.evacuation_center}` : ''}
                    {item.queued_offline ? ' · Queued Offline' : ''}
                  </p>

                  {item.note && (
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-800">
                      {item.note}
                    </p>
                  )}
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      {/* 7. Interactive Go-Bag & Pre-Evacuation Checklist */}
      <section
        aria-label="Go-Bag and Pre-Evacuation Checklist"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Backpack className="h-5 w-5 text-slate-800" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Go-Bag &amp; Pre-Evacuation Checklist
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Saved locally on your device for offline readiness (English &amp; Tagalog).
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                {packedCount} / {GO_BAG_ITEMS.length} packed ({packedPct}%)
              </p>
              <div className="mt-1 h-1.5 w-36 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${packedPct}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={resetGoBagChecklist}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {GO_BAG_ITEMS.map((item) => {
            const isChecked = Boolean(checkedItems[item.id]);
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                  isChecked
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleGoBagItem(item.id)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-semibold sm:text-sm ${
                      isChecked
                        ? 'text-emerald-900 line-through'
                        : 'text-slate-900'
                    }`}
                  >
                    {item.en}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {item.tl} · <span className="text-slate-500">{item.group}</span>
                  </p>
                </div>
                {isChecked && (
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                )}
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}
