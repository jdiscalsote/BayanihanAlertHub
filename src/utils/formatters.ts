export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Just now';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return 'Just now';
  const diffMins = Math.floor(diffSeconds / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatClockTime(isoDate: string | null): string {
  if (!isoDate) return 'Cached locally';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Cached locally';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatExactTimestamp(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function buildSafeGoogleMapsUrl(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return 'https://www.google.com/maps';
  }
  const lat = Math.max(-90, Math.min(90, latitude));
  const lng = Math.max(-180, Math.min(180, longitude));
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

export function buildSafeTelHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : '#';
}

export function buildSafeSmsHref(phone: string, body: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  const encodedBody = encodeURIComponent(body.slice(0, 600));
  return cleaned
    ? `sms:${cleaned}?body=${encodedBody}`
    : `sms:?body=${encodedBody}`;
}
