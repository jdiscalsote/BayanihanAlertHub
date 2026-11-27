import { describe, expect, it } from 'vitest';
import { buildCsvContent, sanitizeCsvCell } from '../src/utils/csvExport';

describe('csvExport utilities', () => {
  it('neutralizes spreadsheet formula-injection prefixes', () => {
    expect(sanitizeCsvCell('=SUM(A1:A5)')).toBe("'=SUM(A1:A5)");
    expect(sanitizeCsvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(sanitizeCsvCell('-1+1')).toBe("'-1+1");
    expect(sanitizeCsvCell('@HYPERLINK("http://evil")')).toBe(
      `"'@HYPERLINK(""http://evil"")"`
    );
    expect(sanitizeCsvCell('\t=1+1')).toBe("'\t=1+1");
  });

  it('applies RFC-4180 escaping for commas, quotes, and newlines', () => {
    expect(sanitizeCsvCell('Brgy. Tatalon, Quezon City')).toBe(
      '"Brgy. Tatalon, Quezon City"'
    );
    expect(sanitizeCsvCell('Near "Red Cross" gate')).toBe(
      '"Near ""Red Cross"" gate"'
    );
    expect(sanitizeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
  });

  it('prepends UTF-8 BOM and CRLF line endings for Philippine text', () => {
    const csv = buildCsvContent(
      ['Barangay', 'Verified', 'Count'],
      [['Brgy. Sto. Niño', true, 12]]
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFBarangay,Verified,Count\r\nBrgy. Sto. Niño,Yes,12');
  });
});
