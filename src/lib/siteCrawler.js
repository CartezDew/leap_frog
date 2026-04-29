const CRAWL_ENDPOINT = '/__site_crawl/scan';
const DEFAULT_ORIGIN = 'https://leapfrogservices.com';
const DEFAULT_LIMIT = 80;

export const CRAWL_AUDIT_NOTE =
  'Crawler requests use the LeapfrogSEOAEOAudit/1.0 user agent and X-Leapfrog-Audit headers. They fetch HTML server-side and do not execute GA4 JavaScript.';

export async function crawlLeapfrogSite({
  origin = DEFAULT_ORIGIN,
  limit = DEFAULT_LIMIT,
} = {}) {
  const params = new URLSearchParams({
    origin,
    limit: String(limit),
  });
  const res = await fetch(`${CRAWL_ENDPOINT}?${params.toString()}`, {
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Site crawl failed (HTTP ${res.status})`);
  }
  return json;
}
