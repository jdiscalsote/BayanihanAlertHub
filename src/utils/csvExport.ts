import type {
  EvacuationCenter,
  HazardReport,
  SafetyCheckin,
} from '../types/alert';

function formatExportDateSlug(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatScopeSlug(scopeLabel: string): string {
  const normalized = scopeLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'all';
}

/**
 * Neutralizes spreadsheet formula injection (e.g. cells starting with =, +, -, @, tab, CR)
 * and applies RFC-4180 CSV escaping.
 */
export function sanitizeCsvCell(
  value: string | number | boolean | null | undefined
): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  let text = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Guard against spreadsheet formula injection on string cells
  if (/^[\t\n\r ]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function buildCsvContent(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
): string {
  const headerLine = headers.map((h) => sanitizeCsvCell(h)).join(',');
  const dataLines = rows.map((row) =>
    row.map((cell) => sanitizeCsvCell(cell)).join(',')
  );
  // Prepend UTF-8 BOM so Philippine characters (e.g., ñ) open cleanly in Excel
  return `\uFEFF${[headerLine, ...dataLines].join('\r\n')}`;
}

export function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
): void {
  const csvContent = buildCsvContent(headers, rows);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function exportHazardReportsCsv(
  reports: HazardReport[],
  scopeLabel: string
): { filename: string; count: number } {
  const headers = [
    'ID',
    'Created At',
    'Updated At',
    'Category',
    'Severity',
    'Flood Level',
    'Status',
    'Verified',
    'Confirmations',
    'Region',
    'Municipality',
    'Barangay',
    'Street or Landmark',
    'Description',
    'Contact',
    'Latitude',
    'Longitude',
    'Verified At',
    'Verified By',
    'Dismissed At',
    'Dismissed By',
    'Offline Queued',
  ];

  const rows = reports.map((r) => [
    r.id,
    r.created_at,
    r.updated_at || '',
    r.category,
    r.severity,
    r.flood_level,
    r.status,
    r.is_verified,
    r.confirmations_count,
    r.region || '',
    r.municipality || '',
    r.barangay,
    r.street_or_landmark,
    r.description,
    r.contact_optional || '',
    r.latitude ?? '',
    r.longitude ?? '',
    r.verified_at || '',
    r.verified_by_name || r.verified_by || '',
    r.dismissed_at || '',
    r.dismissed_by_name || r.dismissed_by || '',
    Boolean(r.queued_offline),
  ]);

  const filename = `bayanihan-hazard-reports-${formatScopeSlug(scopeLabel)}-${formatExportDateSlug()}.csv`;
  downloadCsvFile(filename, headers, rows);
  return { filename, count: reports.length };
}

export function exportEvacuationCentersCsv(
  centers: EvacuationCenter[],
  scopeLabel: string
): { filename: string; count: number } {
  const headers = [
    'ID',
    'Name',
    'Status',
    'Current Occupancy',
    'Max Capacity',
    'Occupancy %',
    'Region',
    'City / Municipality',
    'Barangay',
    'Address',
    'Contact Info',
    'Notes',
    'Latitude',
    'Longitude',
    'Updated At',
  ];

  const rows = centers.map((c) => {
    const pct =
      c.max_capacity > 0
        ? Math.round((c.current_occupancy / c.max_capacity) * 100)
        : 0;
    return [
      c.id,
      c.name,
      c.status,
      c.current_occupancy,
      c.max_capacity,
      `${pct}%`,
      c.region || '',
      c.city,
      c.barangay,
      c.address,
      c.contact_info,
      c.notes,
      c.latitude,
      c.longitude,
      c.updated_at,
    ];
  });

  const filename = `bayanihan-evacuation-centers-${formatScopeSlug(scopeLabel)}-${formatExportDateSlug()}.csv`;
  downloadCsvFile(filename, headers, rows);
  return { filename, count: centers.length };
}

export function exportSafetyCheckinsCsv(
  checkins: SafetyCheckin[],
  scopeLabel: string
): { filename: string; count: number } {
  const headers = [
    'ID',
    'Created At',
    'Full Name',
    'Status',
    'Household Count',
    'Municipality',
    'Barangay',
    'Evacuation Center',
    'Note',
    'Offline Queued',
  ];

  const rows = checkins.map((c) => [
    c.id,
    c.created_at,
    c.full_name,
    c.status,
    c.household_count,
    c.municipality,
    c.barangay,
    c.evacuation_center || '',
    c.note,
    Boolean(c.queued_offline),
  ]);

  const filename = `bayanihan-family-checkins-${formatScopeSlug(scopeLabel)}-${formatExportDateSlug()}.csv`;
  downloadCsvFile(filename, headers, rows);
  return { filename, count: checkins.length };
}
