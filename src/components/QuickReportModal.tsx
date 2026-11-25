import { useState, type FormEvent } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
} from '@vis.gl/react-google-maps';
import { Crosshair, MapPin, X } from 'lucide-react';
import {
  getRemainingCooldownSeconds,
  recordReportSubmissionTimestamp,
} from '../services/offlineSync';
import type {
  FloodLevel,
  HazardCategory,
  HazardSeverity,
  ReportDraft,
  ReverseGeocodeResult,
} from '../types/alert';
import { LocationSelector } from './LocationSelector';

const MAPS_API_KEY = (
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || ''
).trim();

const DEFAULT_PIN_CENTER = { lat: 14.676, lng: 121.0437 };

interface QuickReportModalProps {
  isOpen: boolean;
  isOffline: boolean;
  onClose: () => void;
  onSubmit: (draft: ReportDraft) => Promise<{ queued: boolean }>;
}

const CATEGORIES: HazardCategory[] = [
  'Flooded Roads',
  'Power/Comms',
  'Evacuation Update',
  'Relief/Rescue Needed',
];

const SEVERITIES: HazardSeverity[] = ['Low', 'Moderate', 'Severe', 'Critical'];

const FLOOD_LEVELS: FloodLevel[] = [
  'Not Applicable',
  'Ankle-deep',
  'Knee-deep',
  'Waist-deep',
  'Chest-deep+',
];

export function QuickReportModal({
  isOpen,
  isOffline,
  onClose,
  onSubmit,
}: QuickReportModalProps) {
  const [category, setCategory] = useState<HazardCategory>('Flooded Roads');
  const [severity, setSeverity] = useState<HazardSeverity>('Moderate');
  const [region, setRegion] = useState('National Capital Region (NCR)');
  const [municipality, setMunicipality] = useState('Quezon City');
  const [barangay, setBarangay] = useState('Brgy. Tatalon');
  const [streetOrLandmark, setStreetOrLandmark] = useState('');
  const [floodLevel, setFloodLevel] = useState<FloodLevel>('Knee-deep');
  const [description, setDescription] = useState('');
  const [contactOptional, setContactOptional] = useState('');
  const [pinnedCoords, setPinnedCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  async function reverseGeocodeCoordinates(lat: number, lng: number) {
    setPinnedCoords({ lat, lng });
    if (isOffline) {
      setGeocodeNote(
        `Coordinates pinned (${lat.toFixed(5)}, ${lng.toFixed(5)}). Address auto-fill skipped while offline.`
      );
      return;
    }

    setGeocoding(true);
    setGeocodeNote(null);
    try {
      const res = await fetch(
        `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
      );
      const data = (await res.json()) as Partial<ReverseGeocodeResult> & {
        error?: string;
        status?: string;
      };

      if (res.status === 429 || data.status === 'RESOURCE_EXHAUSTED') {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        throw new Error(data.error || 'Maps geocoding quota reached.');
      }

      if (!res.ok) {
        throw new Error(data.error || 'Unable to reverse-geocode spot.');
      }

      if (data.streetOrLandmark) {
        setStreetOrLandmark(data.streetOrLandmark);
      }
      if (data.region) {
        setRegion(data.region);
      }
      if (data.municipality) {
        setMunicipality(data.municipality);
      }
      if (data.barangay) {
        setBarangay(data.barangay);
      }
      if (data.municipality || data.barangay) {
        setSyncVersion((v) => v + 1);
      }

      setGeocodeNote(
        data.formattedAddress
          ? `Pinned: ${data.formattedAddress}`
          : `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}`
      );
    } catch (err) {
      setGeocodeNote(
        err instanceof Error
          ? `Coordinates saved (${lat.toFixed(5)}, ${lng.toFixed(5)}), but address auto-fill failed: ${err.message}`
          : `Coordinates saved (${lat.toFixed(5)}, ${lng.toFixed(5)}).`
      );
    } finally {
      setGeocoding(false);
    }
  }

  function handleUseCurrentGps() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this browser.');
      return;
    }
    setGeocoding(true);
    setGeocodeNote('Detecting your GPS location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setShowMapPicker(true);
        void reverseGeocodeCoordinates(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setGeocoding(false);
        setGeocodeNote(
          'Unable to access GPS. Tap the map below to drop a pin manually.'
        );
        setShowMapPicker(true);
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const cooldown = getRemainingCooldownSeconds();
    if (cooldown > 0) {
      setError(
        `Please wait ${cooldown}s before submitting another report to prevent duplicate flooding.`
      );
      return;
    }

    if (municipality.trim().length < 2) {
      setError('Please select or enter a City / Municipality.');
      return;
    }
    if (barangay.trim().length < 2) {
      setError('Please select or enter a Barangay.');
      return;
    }
    if (streetOrLandmark.trim().length < 3) {
      setError('Please enter a street name or nearby landmark.');
      return;
    }
    if (description.trim().length < 6) {
      setError('Please enter a brief status note (at least 6 characters).');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        category,
        severity,
        region: region.trim(),
        municipality: municipality.trim(),
        barangay: barangay.trim(),
        street_or_landmark: streetOrLandmark.trim(),
        flood_level: floodLevel,
        description: description.trim(),
        contact_optional: contactOptional.trim() || undefined,
        latitude: pinnedCoords?.lat ?? null,
        longitude: pinnedCoords?.lng ?? null,
      });
      recordReportSubmissionTimestamp();
      setStreetOrLandmark('');
      setDescription('');
      setContactOptional('');
      setPinnedCoords(null);
      setGeocodeNote(null);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to save report. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-report-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-5 sm:rounded-xl sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2
              id="quick-report-title"
              className="font-display text-lg font-bold text-slate-900"
            >
              Submit Quick Hazard Report
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              No account required.{' '}
              {isOffline
                ? 'You are offline — this report will be queued locally and auto-synced once signal returns.'
                : 'Pin your spot on the map to auto-fill your street/barangay or select your PSGC location below.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report form"
            className="cursor-pointer rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-800"
            >
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="report-category"
                className="block text-xs font-semibold text-slate-700"
              >
                Category
              </label>
              <select
                id="report-category"
                value={category}
                onChange={(e) => {
                  const next = e.target.value as HazardCategory;
                  setCategory(next);
                  if (next === 'Power/Comms') setFloodLevel('Not Applicable');
                }}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="report-severity"
                className="block text-xs font-semibold text-slate-700"
              >
                Severity
              </label>
              <select
                id="report-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as HazardSeverity)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {SEVERITIES.map((sev) => (
                  <option key={sev} value={sev}>
                    {sev}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="report-depth"
                className="block text-xs font-semibold text-slate-700"
              >
                Flood Depth
              </label>
              <select
                id="report-depth"
                value={floodLevel}
                onChange={(e) => setFloodLevel(e.target.value as FloodLevel)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {FLOOD_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Interactive Map Pin Picker & Auto-Fill Reverse Geocoding */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <MapPin className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                <span>Pin Exact Spot &amp; Auto-Fill Location</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseCurrentGps}
                  disabled={geocoding}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60"
                >
                  <Crosshair className="h-3.5 w-3.5 text-sky-700" aria-hidden="true" />
                  <span>{geocoding ? 'Locating...' : 'Use My GPS'}</span>
                </button>

                {MAPS_API_KEY && !isOffline && (
                  <button
                    type="button"
                    onClick={() => setShowMapPicker((prev) => !prev)}
                    className="cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                  >
                    {showMapPicker ? 'Hide Map Picker' : 'Pick on Map'}
                  </button>
                )}
              </div>
            </div>

            {showMapPicker && MAPS_API_KEY && !isOffline && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-600">
                  Tap anywhere on the map to drop your hazard pin and auto-fill the street &amp; barangay.
                </p>
                <div className="h-52 w-full overflow-hidden rounded-md border border-slate-300">
                  <APIProvider
                    apiKey={MAPS_API_KEY}
                    language="en"
                    region="PH"
                  >
                    <GoogleMap
                      defaultCenter={pinnedCoords || DEFAULT_PIN_CENTER}
                      defaultZoom={14}
                      mapId="DEMO_MAP_ID"
                      gestureHandling="greedy"
                      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                      onClick={(ev) => {
                        const latLng = ev.detail.latLng;
                        if (latLng) {
                          void reverseGeocodeCoordinates(latLng.lat, latLng.lng);
                        }
                      }}
                      style={{ width: '100%', height: '100%' }}
                    >
                      {pinnedCoords && (
                        <AdvancedMarker position={pinnedCoords}>
                          <Pin
                            background="#dc2626"
                            borderColor="#7f1d1d"
                            glyphColor="#ffffff"
                            glyphText="!"
                          />
                        </AdvancedMarker>
                      )}
                    </GoogleMap>
                  </APIProvider>
                </div>
              </div>
            )}

            {geocodeNote && (
              <p className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
                {geocodeNote}
              </p>
            )}

            <LocationSelector
              region={region}
              municipality={municipality}
              barangay={barangay}
              syncVersion={syncVersion}
              onChange={(next) => {
                setRegion(next.region);
                setMunicipality(next.municipality);
                setBarangay(next.barangay);
              }}
            />
          </div>

          <div>
            <label
              htmlFor="report-street"
              className="block text-xs font-semibold text-slate-700"
            >
              Street / Exact Landmark
            </label>
            <input
              id="report-street"
              required
              maxLength={200}
              value={streetOrLandmark}
              onChange={(e) => setStreetOrLandmark(e.target.value)}
              placeholder="e.g. Araneta Ave. cor. Maria Clara St., near footbridge"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="report-notes"
              className="block text-xs font-semibold text-slate-700"
            >
              Situation &amp; Passability Note
            </label>
            <textarea
              id="report-notes"
              required
              rows={3}
              maxLength={600}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe water flow, vehicle passability, downed lines, or specific rescue needs..."
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="report-contact"
              className="block text-xs font-semibold text-slate-700"
            >
              Optional Callback Number (only if requesting rescue/callback)
            </label>
            <input
              id="report-contact"
              type="tel"
              maxLength={40}
              value={contactOptional}
              onChange={(e) => setContactOptional(e.target.value)}
              placeholder="e.g. 0917-XXX-XXXX (leave blank if reporting road/power only)"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="cursor-pointer rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {submitting
                ? 'Saving...'
                : isOffline
                  ? 'Queue Report Offline'
                  : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
