const CRAWL_ENDPOINT = '/__site_crawl/scan';
const DEFAULT_ORIGIN = 'https://leapfrogservices.com';
const DEFAULT_LIMIT = 80;
const RESPONSE_PREVIEW_CHARS = 1400;

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
  const endpoint = `${CRAWL_ENDPOINT}?${params.toString()}`;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const res = await fetch(endpoint, {
    cache: 'no-store',
  });
  const elapsedMs = Math.round(performance.now() - start);
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
  const debug = {
    endpoint,
    startedAt,
    elapsedMs,
    request: {
      origin,
      limit,
      cache: 'no-store',
    },
    response: {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      redirected: res.redirected,
      url: res.url,
      contentType,
      bodyBytes: text.length,
      bodyPreview: text.slice(0, RESPONSE_PREVIEW_CHARS),
      parseError: parseError?.message || null,
      payloadKeys: json && typeof json === 'object' ? Object.keys(json) : [],
    },
  };

  console.info('[SEO/AEO crawl debug]', debug);

  function fail(message) {
    const err = new Error(message);
    err.debug = debug;
    throw err;
  }

  if (!/application\/json/i.test(contentType)) {
    fail(
      `Site crawl returned ${contentType || 'unknown content type'} instead of JSON (HTTP ${res.status}).`,
    );
  }
  if (!res.ok) {
    fail(json.error || `Site crawl failed (HTTP ${res.status})`);
  }
  if (parseError) {
    fail(`Site crawl response was not valid JSON: ${parseError.message}`);
  }
  if (!json || !Array.isArray(json.pages)) {
    fail('Site crawl response did not include a pages array.');
  }
  return {
    ...json,
    _debug: {
      ...debug,
      response: {
        ...debug.response,
        crawledUrlCount: json.crawledUrlCount,
        discoveredUrlCount: json.discoveredUrlCount,
        warningCount: Array.isArray(json.warnings) ? json.warnings.length : 0,
      },
    },
  };
}
