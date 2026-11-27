import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Building2,
  Crosshair,
  ExternalLink,
  Hospital,
  MapPin,
  Navigation,
  Route as RouteIcon,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { BARANGAY_COORDINATE_HINTS } from '../data/seedData';
import type {
  EvacuationCenter,
  HazardReport,
  NearbySafePlace,
} from '../types/alert';
import { buildSafeGoogleMapsUrl, formatRelativeTime } from '../utils/formatters';
import { requestBestEffortGeolocation } from '../utils/geolocation';

const MAPS_API_KEY = (
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || ''
).trim();

const DEFAULT_CENTER = { lat: 14.676, lng: 121.0437 }; // Quezon City / Metro Manila

interface EmergencyMapViewProps {
  centers: EvacuationCenter[];
  reports: HazardReport[];
  isOffline: boolean;
  selectedMunicipality?: string;
  initialRouteCenterId?: string | null;
  onClearInitialRoute?: () => void;
}

type MapSelection =
  | { kind: 'center'; item: EvacuationCenter }
  | { kind: 'report'; item: HazardReport; approx: boolean; lat: number; lng: number }
  | { kind: 'place'; item: NearbySafePlace };

interface ResolvedReportPin {
  report: HazardReport;
  lat: number;
  lng: number;
  isApprox: boolean;
}

function hashOffset(seed: string): { dLat: number; dLng: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const angle = ((Math.abs(h) % 360) * Math.PI) / 180;
  const dist = 0.002 + (Math.abs(h >> 4) % 10) * 0.0003;
  return {
    dLat: Math.sin(angle) * dist,
    dLng: Math.cos(angle) * dist,
  };
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

function checkQuotaErrorAndDispatch(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('429') ||
    msg.includes('Quota')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    return true;
  }
  return false;
}

function getCenterPinColors(status: EvacuationCenter['status']) {
  switch (status) {
    case 'Open':
      return { background: '#059669', borderColor: '#065f46', glyphColor: '#ffffff' };
    case 'Near Full':
      return { background: '#d97706', borderColor: '#92400e', glyphColor: '#ffffff' };
    default:
      return { background: '#dc2626', borderColor: '#991b1b', glyphColor: '#ffffff' };
  }
}

function getHazardPinColors(severity: HazardReport['severity']) {
  switch (severity) {
    case 'Critical':
      return { background: '#991b1b', borderColor: '#450a0a', glyphColor: '#ffffff' };
    case 'Severe':
      return { background: '#ea580c', borderColor: '#9a3412', glyphColor: '#ffffff' };
    case 'Moderate':
      return { background: '#eab308', borderColor: '#854d0e', glyphColor: '#0f172a' };
    default:
      return { background: '#475569', borderColor: '#1e293b', glyphColor: '#ffffff' };
  }
}

interface MapsPolylineInstance {
  setMap: (map: unknown | null) => void;
  setOptions: (opts: {
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
  }) => void;
}

interface RouteOverlayControllerProps {
  origin: { lat: number; lng: number } | null;
  destination: EvacuationCenter | null;
  onRouteComputed: (summary: {
    distanceKm: string;
    durationMins: number;
    destinationName: string;
  } | null) => void;
  onRouteError: (err: string | null) => void;
  onLoadingChange: (loading: boolean) => void;
}

function RouteOverlayController({
  origin,
  destination,
  onRouteComputed,
  onRouteError,
  onLoadingChange,
}: RouteOverlayControllerProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<MapsPolylineInstance[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!routesLib || !map || !origin || !destination) {
      onRouteComputed(null);
      onRouteError(null);
      onLoadingChange(false);
      return;
    }

    let cancelled = false;
    onLoadingChange(true);
    onRouteError(null);

    const request = {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.latitude, lng: destination.longitude },
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    const RouteClass = routesLib.Route as unknown as {
      computeRoutes: (req: typeof request) => Promise<{
        routes?: Array<{
          distanceMeters?: number;
          durationMillis?: number;
          viewport?: unknown;
          createPolylines: () => MapsPolylineInstance[];
        }>;
      }>;
    };

    RouteClass.computeRoutes(request)
      .then((res) => {
        if (cancelled) return;
        onLoadingChange(false);
        const primaryRoute = res.routes?.[0];
        if (!primaryRoute) {
          onRouteError('No drivable route returned between your location and this shelter.');
          onRouteComputed(null);
          return;
        }

        const newPolylines = primaryRoute.createPolylines();
        newPolylines.forEach((polyline) => {
          polyline.setOptions({
            strokeColor: '#0f172a',
            strokeOpacity: 0.9,
            strokeWeight: 5,
          });
          polyline.setMap(map);
        });
        polylinesRef.current = newPolylines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport as never);
        }

        const meters = primaryRoute.distanceMeters ?? 0;
        const millis = primaryRoute.durationMillis ?? 0;
        onRouteComputed({
          distanceKm: (meters / 1000).toFixed(1),
          durationMins: Math.max(1, Math.round(millis / 60_000)),
          destinationName: destination.name,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        onLoadingChange(false);
        checkQuotaErrorAndDispatch(err);
        onRouteComputed(null);
        onRouteError(
          err instanceof Error
            ? `Unable to compute route (${err.message}). Use the direct Google Maps link as backup.`
            : 'Unable to compute route. Use the direct Google Maps link as backup.'
        );
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [
    routesLib,
    map,
    origin,
    destination,
    onRouteComputed,
    onRouteError,
    onLoadingChange,
  ]);

  return null;
}

interface NearbyPlacesControllerProps {
  anchor: { lat: number; lng: number } | null;
  onPlacesFound: (places: NearbySafePlace[]) => void;
  onPlacesError: (err: string | null) => void;
}

function NearbyPlacesController({
  anchor,
  onPlacesFound,
  onPlacesError,
}: NearbyPlacesControllerProps) {
  const placesLib = useMapsLibrary('places');

  useEffect(() => {
    if (!placesLib || !anchor) {
      onPlacesFound([]);
      return;
    }

    let cancelled = false;
    onPlacesError(null);

    const PlaceClass = placesLib.Place as unknown as {
      searchNearby: (req: {
        fields: string[];
        locationRestriction: {
          center: { lat: number; lng: number };
          radius: number;
        };
        includedTypes: string[];
        maxResultCount: number;
        rankPreference: unknown;
      }) => Promise<{
        places?: Array<{
          id?: string;
          displayName?: string;
          formattedAddress?: string;
          primaryType?: string;
          types?: string[];
          location?: {
            lat: number | (() => number);
            lng: number | (() => number);
          };
        }>;
      }>;
    };

    PlaceClass.searchNearby({
      fields: ['id', 'displayName', 'formattedAddress', 'location', 'primaryType', 'types'],
      locationRestriction: {
        center: { lat: anchor.lat, lng: anchor.lng },
        radius: 3500,
      },
      includedTypes: ['hospital', 'local_government_office', 'city_hall'],
      maxResultCount: 8,
      rankPreference: placesLib.SearchNearbyRankPreference.DISTANCE,
    })
      .then(({ places }) => {
        if (cancelled) return;
        const mapped: NearbySafePlace[] = [];
        for (const p of places || []) {
          if (!p.location) continue;
          const lat = typeof p.location.lat === 'function' ? p.location.lat() : Number(p.location.lat);
          const lng = typeof p.location.lng === 'function' ? p.location.lng() : Number(p.location.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

          const typesList = p.types || [];
          const isHospital =
            p.primaryType === 'hospital' || typesList.includes('hospital');
          mapped.push({
            id: p.id || `${lat}-${lng}`,
            name: p.displayName || (isHospital ? 'Nearby Hospital' : 'Barangay / LGU Hall'),
            address: p.formattedAddress || 'Nearby emergency facility',
            category: isHospital ? 'hospital' : 'barangay_hall',
            latitude: lat,
            longitude: lng,
          });
        }
        onPlacesFound(mapped);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        checkQuotaErrorAndDispatch(err);
        onPlacesError('Nearby hospitals and barangay halls could not be loaded right now.');
        onPlacesFound([]);
      });

    return () => {
      cancelled = true;
    };
  }, [placesLib, anchor, onPlacesFound, onPlacesError]);

  return null;
}

function MapViewportController({
  focusPoint,
  centers,
  selectedMunicipality,
  hasActiveRoute,
}: {
  focusPoint: { lat: number; lng: number } | null;
  centers: EvacuationCenter[];
  selectedMunicipality?: string;
  hasActiveRoute: boolean;
}) {
  const map = useMap();
  const coreLib = useMapsLibrary('core');
  const lastMuniRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!map || !focusPoint) return;
    map.panTo(focusPoint);
  }, [map, focusPoint]);

  useEffect(() => {
    if (!map || !coreLib || hasActiveRoute || centers.length === 0) return;
    if (lastMuniRef.current === selectedMunicipality) return;
    lastMuniRef.current = selectedMunicipality;

    if (centers.length === 1) {
      map.panTo({ lat: centers[0].latitude, lng: centers[0].longitude });
      map.setZoom(14);
      return;
    }

    const bounds = new coreLib.LatLngBounds();
    for (const c of centers) {
      if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
        bounds.extend({ lat: c.latitude, lng: c.longitude });
      }
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 48);
    }
  }, [map, coreLib, centers, selectedMunicipality, hasActiveRoute]);

  return null;
}

export function EmergencyMapView({
  centers,
  reports,
  isOffline,
  selectedMunicipality,
  initialRouteCenterId,
  onClearInitialRoute,
}: EmergencyMapViewProps) {
  const [showShelters, setShowShelters] = useState(true);
  const [showHazards, setShowHazards] = useState(true);
  const [showNearbySupport, setShowNearbySupport] = useState(true);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [userLocationIsManual, setUserLocationIsManual] = useState(false);
  const [isPickingOrigin, setIsPickingOrigin] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [routeDestination, setRouteDestination] = useState<EvacuationCenter | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [routeOriginLabel, setRouteOriginLabel] = useState<string>('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeSummary, setRouteSummary] = useState<{
    distanceKm: string;
    durationMins: number;
    destinationName: string;
  } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [nearbyPlaces, setNearbyPlaces] = useState<NearbySafePlace[]>([]);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number } | null>(null);

  const resolvedReportPins = useMemo<ResolvedReportPin[]>(() => {
    return reports
      .filter((r) => r.status !== 'dismissed')
      .map((report) => {
        if (
          typeof report.latitude === 'number' &&
          Number.isFinite(report.latitude) &&
          typeof report.longitude === 'number' &&
          Number.isFinite(report.longitude)
        ) {
          return {
            report,
            lat: report.latitude,
            lng: report.longitude,
            isApprox: false,
          };
        }

        const brgyKey = report.barangay.trim().toLowerCase();
        const muniKey = (report.municipality || 'Quezon City').trim().toLowerCase();
        const matchingCenter =
          centers.find(
            (c) =>
              c.barangay.trim().toLowerCase() === brgyKey &&
              c.city.trim().toLowerCase() === muniKey
          ) ||
          centers.find((c) => c.city.trim().toLowerCase() === muniKey);

        const base =
          BARANGAY_COORDINATE_HINTS[brgyKey] ||
          BARANGAY_COORDINATE_HINTS[muniKey] ||
          (matchingCenter
            ? { lat: matchingCenter.latitude, lng: matchingCenter.longitude }
            : DEFAULT_CENTER);

        const offset = hashOffset(report.id);
        return {
          report,
          lat: base.lat + offset.dLat,
          lng: base.lng + offset.dLng,
          isApprox: true,
        };
      });
  }, [reports, centers]);

  const fallbackAreaOrigin = useMemo(() => {
    if (selectedMunicipality && selectedMunicipality !== 'All') {
      const hint = BARANGAY_COORDINATE_HINTS[selectedMunicipality.trim().toLowerCase()];
      if (hint) return { point: hint, label: `${selectedMunicipality} center` };
      const matchCenter = centers.find(
        (c) => c.city.toLowerCase() === selectedMunicipality.toLowerCase()
      );
      if (matchCenter) {
        return {
          point: { lat: matchCenter.latitude, lng: matchCenter.longitude },
          label: `${matchCenter.barangay}, ${matchCenter.city}`,
        };
      }
    }
    return { point: DEFAULT_CENTER, label: 'Quezon City center' };
  }, [selectedMunicipality, centers]);

  const requestUserLocation = useCallback(
    async (
      onResolved?: (
        coords: { lat: number; lng: number },
        usedGps: boolean
      ) => void
    ) => {
      setLocating(true);
      setLocationNotice(null);
      setIsPickingOrigin(false);

      const result = await requestBestEffortGeolocation();
      setLocating(false);

      if (result.ok) {
        setUserLocation(result.coords);
        setUserLocationIsManual(false);
        setFocusPoint(result.coords);
        if (!result.highAccuracy) {
          setLocationNotice(
            'Using network-approximated location. Tap "Pick Start on Map" anytime to adjust your exact spot.'
          );
        }
        onResolved?.(result.coords, true);
        return;
      }

      const reasonHint =
        result.reason === 'denied'
          ? 'Location access is blocked by your browser or embedded preview frame.'
          : result.message;

      setLocationNotice(
        `${reasonHint} Tap "Pick Start on Map" to set your starting pin anywhere in the Philippines${onResolved ? `, or routing from ${fallbackAreaOrigin.label} for now.` : '.'}`
      );
      onResolved?.(fallbackAreaOrigin.point, false);
    },
    [fallbackAreaOrigin]
  );

  const handleManualOriginDrop = useCallback(
    (coords: { lat: number; lng: number }) => {
      setUserLocation(coords);
      setUserLocationIsManual(true);
      setIsPickingOrigin(false);
      setLocationNotice(
        `Starting pin placed at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}.`
      );
      if (routeDestination) {
        setRouteOrigin(coords);
        setRouteOriginLabel('Selected map pin');
      }
    },
    [routeDestination]
  );

  const startSafeRouteToCenter = useCallback(
    (center: EvacuationCenter) => {
      setSelection({ kind: 'center', item: center });
      setRouteDestination(center);
      setShowNearbySupport(true);

      if (userLocation) {
        setRouteOrigin(userLocation);
        setRouteOriginLabel(
          userLocationIsManual ? 'Selected map pin' : 'Your GPS location'
        );
        return;
      }

      void requestUserLocation((coords, usedGps) => {
        setRouteOrigin(coords);
        setRouteOriginLabel(usedGps ? 'Your GPS location' : fallbackAreaOrigin.label);
      });
    },
    [userLocation, userLocationIsManual, requestUserLocation, fallbackAreaOrigin.label]
  );

  useEffect(() => {
    if (!initialRouteCenterId) return;
    const match = centers.find((c) => c.id === initialRouteCenterId);
    if (match) {
      startSafeRouteToCenter(match);
    }
    onClearInitialRoute?.();
  }, [initialRouteCenterId, centers, startSafeRouteToCenter, onClearInitialRoute]);

  const nearbyOpenShelters = useMemo(() => {
    const anchor = routeDestination
      ? { lat: routeDestination.latitude, lng: routeDestination.longitude }
      : userLocation || fallbackAreaOrigin.point;
    return centers
      .filter((c) => c.status === 'Open' || c.status === 'Near Full')
      .map((c) => ({
        center: c,
        distanceKm: haversineKm(anchor, { lat: c.latitude, lng: c.longitude }),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 4);
  }, [centers, routeDestination, userLocation, fallbackAreaOrigin.point]);

  const nearbyAnchor = useMemo(() => {
    if (!showNearbySupport) return null;
    if (routeDestination) {
      return { lat: routeDestination.latitude, lng: routeDestination.longitude };
    }
    return userLocation;
  }, [showNearbySupport, routeDestination, userLocation]);

  if (isOffline || !MAPS_API_KEY) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              {isOffline
                ? 'Interactive Map Paused While Offline'
                : 'Google Maps Key Not Yet Configured'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {isOffline
                ? 'Cached shelter coordinates and open Google Maps links remain available below for low-signal navigation.'
                : 'Set VITE_GOOGLE_MAPS_API_KEY in your environment to render live interactive map pins and safe routes.'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {centers.slice(0, 6).map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{c.name}</p>
                <p className="text-slate-600">
                  {c.status} · {c.current_occupancy}/{c.max_capacity} · {c.barangay}
                </p>
              </div>
              <a
                href={buildSafeGoogleMapsUrl(c.latitude, c.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-semibold text-slate-900 underline"
              >
                <span>Open</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Map Controls & Color Legend */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
          <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
            <input
              type="checkbox"
              checked={showShelters}
              onChange={(e) => setShowShelters(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            <span>Shelters ({centers.length})</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
            <input
              type="checkbox"
              checked={showHazards}
              onChange={(e) => setShowHazards(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            <span>Hazard Reports ({resolvedReportPins.length})</span>
          </label>
          <div className="hidden h-4 w-px bg-slate-200 sm:block" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
              Open
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-600" />
              Near Full
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
              Full/Closed
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-600" />
              Hazard Pin
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void requestUserLocation()}
            disabled={locating}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            <Crosshair className="h-3.5 w-3.5 text-sky-700" aria-hidden="true" />
            <span>
              {locating
                ? 'Locating...'
                : userLocation && !userLocationIsManual
                  ? 'Update My GPS'
                  : 'Use My Location'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsPickingOrigin((prev) => !prev);
              setSelection(null);
            }}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              isPickingOrigin
                ? 'border-sky-600 bg-sky-50 text-sky-900'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            <MapPin className="h-3.5 w-3.5 text-sky-700" aria-hidden="true" />
            <span>
              {isPickingOrigin ? 'Tap Map to Set Start...' : 'Pick Start on Map'}
            </span>
          </button>

          {routeDestination && (
            <button
              type="button"
              onClick={() => {
                setRouteDestination(null);
                setRouteSummary(null);
                setRouteError(null);
              }}
              className="cursor-pointer rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Clear Route
            </button>
          )}
        </div>
      </div>

      {isPickingOrigin && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900">
          Tap anywhere on the map below to set your starting location pin for nationwide shelter routing.
        </p>
      )}

      {locationNotice && !isPickingOrigin && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {locationNotice}
        </p>
      )}

      {/* Map + Safe Route & Nearby Support Drawer */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white lg:col-span-8">
          <div className="relative h-[440px] w-full sm:h-[520px]">
            <APIProvider
              apiKey={MAPS_API_KEY}
              language="en"
              region="PH"
            >
              <GoogleMap
                defaultCenter={DEFAULT_CENTER}
                defaultZoom={12}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                onClick={(ev) => {
                  const latLng = ev.detail.latLng;
                  if (isPickingOrigin && latLng) {
                    handleManualOriginDrop({ lat: latLng.lat, lng: latLng.lng });
                    return;
                  }
                  setSelection(null);
                }}
                style={{ width: '100%', height: '100%' }}
              >
                <MapViewportController
                  focusPoint={focusPoint}
                  centers={centers}
                  selectedMunicipality={selectedMunicipality}
                  hasActiveRoute={Boolean(routeDestination)}
                />

                <RouteOverlayController
                  origin={routeOrigin}
                  destination={routeDestination}
                  onRouteComputed={setRouteSummary}
                  onRouteError={setRouteError}
                  onLoadingChange={setRouteLoading}
                />

                <NearbyPlacesController
                  anchor={nearbyAnchor}
                  onPlacesFound={setNearbyPlaces}
                  onPlacesError={setNearbyError}
                />

                {userLocation && (
                  <AdvancedMarker position={userLocation} title="Your Location">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-sky-600 shadow-md">
                      <span className="h-2 w-2 rounded-full bg-white" />
                    </div>
                  </AdvancedMarker>
                )}

                {showShelters &&
                  centers.map((center) => {
                    const pinColors = getCenterPinColors(center.status);
                    return (
                      <AdvancedMarker
                        key={`ec-${center.id}`}
                        position={{ lat: center.latitude, lng: center.longitude }}
                        title={`${center.name} (${center.status})`}
                        onClick={() => setSelection({ kind: 'center', item: center })}
                      >
                        <Pin
                          background={pinColors.background}
                          borderColor={pinColors.borderColor}
                          glyphColor={pinColors.glyphColor}
                          glyphText="S"
                        />
                      </AdvancedMarker>
                    );
                  })}

                {showHazards &&
                  resolvedReportPins.map(({ report, lat, lng, isApprox }) => {
                    const pinColors = getHazardPinColors(report.severity);
                    return (
                      <AdvancedMarker
                        key={`rep-${report.id}`}
                        position={{ lat, lng }}
                        title={`${report.severity} ${report.category}: ${report.street_or_landmark}`}
                        onClick={() =>
                          setSelection({
                            kind: 'report',
                            item: report,
                            approx: isApprox,
                            lat,
                            lng,
                          })
                        }
                      >
                        <Pin
                          background={pinColors.background}
                          borderColor={pinColors.borderColor}
                          glyphColor={pinColors.glyphColor}
                          glyphText="!"
                          scale={0.9}
                        />
                      </AdvancedMarker>
                    );
                  })}

                {showNearbySupport &&
                  nearbyPlaces.map((place) => (
                    <AdvancedMarker
                      key={`place-${place.id}`}
                      position={{ lat: place.latitude, lng: place.longitude }}
                      title={place.name}
                      onClick={() => setSelection({ kind: 'place', item: place })}
                    >
                      <Pin
                        background={place.category === 'hospital' ? '#0284c7' : '#4f46e5'}
                        borderColor={place.category === 'hospital' ? '#075985' : '#312e81'}
                        glyphColor="#ffffff"
                        glyphText={place.category === 'hospital' ? '+' : 'H'}
                        scale={0.85}
                      />
                    </AdvancedMarker>
                  ))}

                {selection && (
                  <InfoWindow
                    position={
                      selection.kind === 'center'
                        ? {
                            lat: selection.item.latitude,
                            lng: selection.item.longitude,
                          }
                        : selection.kind === 'place'
                          ? {
                              lat: selection.item.latitude,
                              lng: selection.item.longitude,
                            }
                          : { lat: selection.lat, lng: selection.lng }
                    }
                    onCloseClick={() => setSelection(null)}
                  >
                    <div className="max-w-xs space-y-1.5 p-1 text-slate-900">
                      {selection.kind === 'center' && (
                        <>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Evacuation Center · {selection.item.status}
                          </p>
                          <p className="text-sm font-bold leading-snug">
                            {selection.item.name}
                          </p>
                          <p className="text-xs text-slate-600">
                            {selection.item.address}
                          </p>
                          <p className="font-mono text-xs font-medium text-slate-800">
                            Occupancy: {selection.item.current_occupancy} /{' '}
                            {selection.item.max_capacity}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => startSafeRouteToCenter(selection.item)}
                              className="inline-flex cursor-pointer items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                            >
                              <Navigation className="h-3 w-3" aria-hidden="true" />
                              <span>Find Safe Route</span>
                            </button>
                            <a
                              href={buildSafeGoogleMapsUrl(
                                selection.item.latitude,
                                selection.item.longitude
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 underline"
                            >
                              <span>Open Maps</span>
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          </div>
                        </>
                      )}

                      {selection.kind === 'report' && (
                        <>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {selection.item.severity} · {selection.item.category}
                          </p>
                          <p className="text-sm font-bold leading-snug">
                            {selection.item.street_or_landmark}
                          </p>
                          <p className="text-xs text-slate-600">
                            {selection.item.barangay}
                            {selection.item.municipality
                              ? `, ${selection.item.municipality}`
                              : ''}{' '}
                            · {formatRelativeTime(selection.item.created_at)}
                          </p>
                          <p className="text-xs leading-relaxed text-slate-700">
                            {selection.item.description}
                          </p>
                          <p className="text-[11px] font-medium text-slate-600">
                            {selection.item.is_verified ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                                Verified by Barangay/Responder
                              </span>
                            ) : (
                              'Unverified community report'
                            )}
                            {selection.approx ? ' · Approx. barangay pin' : ''}
                          </p>
                        </>
                      )}

                      {selection.kind === 'place' && (
                        <>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {selection.item.category === 'hospital'
                              ? 'Nearby Hospital (Google Places)'
                              : 'Nearby Barangay / Municipal Hall'}
                          </p>
                          <p className="text-sm font-bold leading-snug">
                            {selection.item.name}
                          </p>
                          <p className="text-xs text-slate-600">
                            {selection.item.address}
                          </p>
                          <a
                            href={buildSafeGoogleMapsUrl(
                              selection.item.latitude,
                              selection.item.longitude
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-slate-900 underline"
                          >
                            <span>View in Google Maps</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </>
                      )}
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
            </APIProvider>
          </div>
        </div>

        {/* Right Side Panel: Active Safe Route + Nearby Shelters / Hospitals / Barangay Halls */}
        <aside className="space-y-4 lg:col-span-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <RouteIcon className="h-4 w-4 text-slate-700" aria-hidden="true" />
              <h2 className="font-display text-sm font-bold text-slate-900">
                Safe Route &amp; Shelter Guidance
              </h2>
            </div>

            {!routeDestination ? (
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Select any green or amber shelter pin on the map (or tap &ldquo;Find Safe Route&rdquo; on an evacuation center) to calculate a route and highlight nearby hospitals and barangay halls.
              </p>
            ) : (
              <div className="mt-3 space-y-2.5 text-xs">
                <div>
                  <p className="font-semibold text-slate-900">
                    To: {routeDestination.name}
                  </p>
                  <p className="text-slate-600">
                    From: {routeOriginLabel || fallbackAreaOrigin.label}
                  </p>
                </div>

                {routeLoading && (
                  <p className="font-medium text-slate-700">
                    Calculating route via Google Maps Routes API...
                  </p>
                )}

                {routeError && (
                  <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                    {routeError}
                  </p>
                )}

                {routeSummary && (
                  <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                    <div>
                      <p className="text-[11px] text-slate-500">Est. Distance</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {routeSummary.distanceKm} km
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Drive ETA</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                        ~{routeSummary.durationMins} mins
                      </p>
                    </div>
                  </div>
                )}

                <a
                  href={buildSafeGoogleMapsUrl(
                    routeDestination.latitude,
                    routeDestination.longitude
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-slate-900 underline underline-offset-2"
                >
                  <span>Open turn-by-turn in Google Maps</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Nearby Open Shelters
            </h3>
            <div className="mt-2.5 space-y-2">
              {nearbyOpenShelters.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No open shelters available in current filter.
                </p>
              ) : (
                nearbyOpenShelters.map(({ center, distanceKm }) => (
                  <div
                    key={center.id}
                    className="flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {center.name}
                      </p>
                      <p className="text-slate-600">
                        {center.status} · {center.current_occupancy}/
                        {center.max_capacity} ·{' '}
                        <span className="font-mono tabular-nums">
                          {distanceKm.toFixed(1)} km
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startSafeRouteToCenter(center)}
                      className="shrink-0 cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      Route
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {(nearbyPlaces.length > 0 || nearbyError) && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Nearby Hospitals &amp; Barangay Halls
                </h3>
                <span className="text-[11px] text-slate-500">Google Places</span>
              </div>

              {nearbyError ? (
                <p className="mt-2 text-xs text-slate-600">{nearbyError}</p>
              ) : (
                <div className="mt-2.5 space-y-2">
                  {nearbyPlaces.slice(0, 5).map((place) => (
                    <button
                      key={place.id}
                      type="button"
                      onClick={() => {
                        setSelection({ kind: 'place', item: place });
                        setFocusPoint({ lat: place.latitude, lng: place.longitude });
                      }}
                      className="flex w-full cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-left text-xs hover:bg-slate-100"
                    >
                      {place.category === 'hospital' ? (
                        <Hospital
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-700"
                          aria-hidden="true"
                        />
                      ) : (
                        <Building2
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-700"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                          {place.name}
                        </p>
                        <p className="truncate text-slate-600">{place.address}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!nearbyAnchor && !nearbyError && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3.5 text-xs text-slate-600">
              <p className="flex items-center gap-1.5 font-medium text-slate-800">
                <MapPin className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                <span>Nearby Emergency Support</span>
              </p>
              <p className="mt-1">
                Tap &ldquo;Use My Location&rdquo; or select &ldquo;Find Safe Route&rdquo; on any shelter to load nearby hospitals and barangay halls from Google Places.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
