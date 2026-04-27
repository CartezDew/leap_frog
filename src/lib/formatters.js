// Display formatters used across dashboard pages.

const safeNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) return null;
  return num;
};

export function formatNumber(value, fallback = '—') {
  const num = safeNumber(value);
  if (num === null) return fallback;
  return num.toLocaleString('en-US');
}

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

export function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
