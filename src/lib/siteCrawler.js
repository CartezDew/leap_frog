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
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  let json = null;
  let parseError = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (err) {
    parseError = err;
    json = {};
  }

  if (!/application\/json/i.test(contentType)) {
    throw new Error(
      `Site crawl returned ${contentType || 'unknown content type'} instead of JSON (HTTP ${res.status}).`,
    );
  }
  if (!res.ok) {
    throw new Error(json.error || `Site crawl failed (HTTP ${res.status})`);
  }
  if (parseError) {
    throw new Error(`Site crawl response was not valid JSON: ${parseError.message}`);
  }
  if (!json || !Array.isArray(json.pages)) {
    throw new Error('Site crawl response did not include a pages array.');
  }
  return json;
}
