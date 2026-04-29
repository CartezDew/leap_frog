// Display formatters used across dashboard pages.

const safeNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) return null;
  return num;
};

/** Whole or decimal numbers with thousands separators (e.g. 1,234.5). */
export function formatNumber(value, fallback = '—') {
  const num = safeNumber(value);
  if (num === null) return fallback;
  return num.toLocaleString('en-US');
}

/** Rounded integers with thousands separators (e.g. 1,000). */
export function formatInteger(value, fallback = '—') {
  const num = safeNumber(value);
  if (num === null) return fallback;
  return Math.round(num).toLocaleString('en-US');
}

export function formatPercent(value, decimals = 1, fallback = '—') {
  const num = safeNumber(value);
  if (num === null) return fallback;
  const pct = num <= 1 ? num * 100 : num;
  return `${pct.toFixed(decimals)}%`;
}

export function formatSeconds(value, fallback = '—') {
  const num = safeNumber(value);
  if (num === null) return fallback;
  if (num >= 60) {
    const mins = Math.floor(num / 60);
    const secs = Math.round(num % 60);
    return `${mins}m ${secs}s`;
  }
  return `${num.toFixed(1)}s`;
}

// Excel stores dates as days since 1900-01-01 (with the well-known 1900 leap
// year bug). Convert a serial number into a real JS Date in UTC. Returns
// `null` when the value isn't a usable date.
export function parseExcelDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value === null || value === undefined || value === '') return null;
  // Numeric values (or numeric strings) are treated as Excel serials when
  // they look like a plausible date — anywhere from 1900 (~1) to 2200 (~110000).
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n > 25 && n < 110000) {
    // Excel epoch (UTC). 25569 is the offset between Excel's 1900-01-00 and
    // the Unix epoch (1970-01-01) accounting for the 1900 leap-year bug.
    const ms = (n - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Otherwise fall back to standard date parsing.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value, fallback = '—') {
  const d = parseExcelDate(value);
  if (!d) return value ? String(value) : fallback;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatMonthLabel(value, fallback = '—') {
  const d = parseExcelDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function monthKey(value) {
  const d = parseExcelDate(value);
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function bounceClass(value) {
  const num = safeNumber(value);
  if (num === null) return 'bounce-okay';
  const pct = num <= 1 ? num : num / 100;
  if (pct >= 0.55) return 'bounce-high';
  if (pct >= 0.45) return 'bounce-medium';
  if (pct < 0.4) return 'bounce-good';
  return 'bounce-okay';
}

export function bounceLabel(value) {
  const cls = bounceClass(value);
  switch (cls) {
    case 'bounce-high':
      return 'High — investigate';
    case 'bounce-medium':
      return 'Above target';
    case 'bounce-good':
      return 'Healthy';
    default:
      return 'Okay';
  }
}

export function botLabel(classification) {
  switch (classification) {
    case 'confirmed_bot':
      return 'Confirmed Bot';
    case 'likely_bot':
      return 'Likely Bot';
    case 'suspicious':
      return 'Suspicious';
    case 'human':
      return 'Human Traffic';
    default:
      return classification ? String(classification) : '—';
  }
}

export function priorityFromText(text) {
  const t = String(text || '').toLowerCase();
  if (t === 'high' || t === 'critical' || t === 'red') return 'high';
  if (t === 'medium' || t === 'amber' || t === 'warn') return 'medium';
  if (t === 'low' || t === 'green' || t === 'info') return 'low';
  return 'info';
}
