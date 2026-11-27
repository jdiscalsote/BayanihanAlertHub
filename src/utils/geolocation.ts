export interface GeolocationCoords {
  lat: number;
  lng: number;
}

export type GeolocationFailureReason =
  | 'unsupported'
  | 'denied'
  | 'unavailable'
  | 'timeout';

export type GeolocationLookupResult =
  | { ok: true; coords: GeolocationCoords; highAccuracy: boolean }
  | { ok: false; reason: GeolocationFailureReason; message: string };

function getPositionPromise(
  options: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Attempts high-accuracy GPS first, then falls back to network/Wi-Fi
 * geolocation on timeout or position_unavailable so desktop & indoor users
 * aren't blocked by strict GPS hardware timeouts.
 */
export async function requestBestEffortGeolocation(): Promise<GeolocationLookupResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'Browser geolocation is not supported on this device.',
    };
  }

  try {
    const pos = await getPositionPromise({
      enableHighAccuracy: true,
      timeout: 7000,
      maximumAge: 30000,
    });
    return {
      ok: true,
      coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      highAccuracy: true,
    };
  } catch (firstErr) {
    const code = (firstErr as GeolocationPositionError | undefined)?.code;

    // 1 === PERMISSION_DENIED: retrying without highAccuracy will still deny
    if (code === 1) {
      return {
        ok: false,
        reason: 'denied',
        message:
          'Location access was blocked by your browser or embedded frame.',
      };
    }

    // Retry with coarse/network location for POSITION_UNAVAILABLE (2) or TIMEOUT (3)
    try {
      const pos = await getPositionPromise({
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 120000,
      });
      return {
        ok: true,
        coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        highAccuracy: false,
      };
    } catch (secondErr) {
      const secondCode = (secondErr as GeolocationPositionError | undefined)?.code;
      if (secondCode === 1) {
        return {
          ok: false,
          reason: 'denied',
          message:
            'Location access was blocked by your browser or embedded frame.',
        };
      }
      if (secondCode === 3) {
        return {
          ok: false,
          reason: 'timeout',
          message: 'Location lookup timed out.',
        };
      }
      return {
        ok: false,
        reason: 'unavailable',
        message: 'Device location is currently unavailable.',
      };
    }
  }
}
