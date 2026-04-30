// Netlify Function: server-side crawl helper for the SEO/AEO dashboard.
//
// This is the production counterpart to `vite-plugins/site-crawl.js`. The
// React dashboard cannot fetch third-party HTML in the browser because of
// CORS, so it calls a same-origin endpoint that performs the crawl on the
// server. In dev that endpoint is served by the Vite middleware; on Netlify
// it is served by this function (wired via a rewrite in `netlify.toml`).
//
// The crawl logic mirrors the dev plugin. The one production-specific
// change is bounded concurrency: Netlify Functions have a hard execution
// limit (10s on Starter, 26s on Pro), so we fan out fetches in small
// batches instead of awaiting them one by one.

const DEFAULT_ORIGIN = 'https://leapfrogservices.com';
const ALLOWED_HOSTS = new Set([
  'leapfrogservices.com',
  'www.leapfrogservices.com',
]);
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 150;
const MAX_SITEMAP_URLS = 500;
const FETCH_TIMEOUT_MS = 8000;
const PAGE_FETCH_CONCURRENCY = 6;
const AUDIT_USER_AGENT =
  'LeapfrogSEOAEOAudit/1.0 (+https://leapfrogservices.com/; purpose=seo-aeo-dashboard)';

function normalizeOrigin(value) {
  const url = new URL(value || DEFAULT_ORIGIN);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) origins can be crawled.');
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`Host "${host}" is not allowed for this crawler.`);
  }
  return `${url.protocol}//${url.host}`;
}

function auditHeaders(origin) {
  return {
    'User-Agent': AUDIT_USER_AGENT,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'X-Leapfrog-Audit': 'seo-aeo-dashboard',
    'X-Leapfrog-Audit-Origin': origin,
  };
}

async function fetchText(url, origin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: auditHeaders(origin),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      contentType: res.headers.get('content-type') || '',
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function xmlLocs(xml) {
  return unique(
    Array.from(String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)).map(
      (m) => decodeHtml(m[1].trim()),
    ),
  );
}

async function discoverSitemaps(origin, warnings) {
  const robotsUrl = `${origin}/robots.txt`;
  const robots = await fetchText(robotsUrl, origin).catch((err) => {
    warnings.push(`Could not read robots.txt: ${err.message}`);
    return null;
  });
  const listed = robots?.text
    ? Array.from(robots.text.matchAll(/^\s*Sitemap:\s*(.+?)\s*$/gim)).map((m) =>
        m[1].trim(),
      )
    : [];
  return unique(
    listed.length
      ? listed
      : [`${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`],
  );
}

async function collectPageUrls(origin, warnings) {
  const queue = await discoverSitemaps(origin, warnings);
  const seenSitemaps = new Set();
  const pageUrls = new Set();
  const sitemapUrls = [];

  while (
    queue.length > 0 &&
    seenSitemaps.size < 40 &&
    pageUrls.size < MAX_SITEMAP_URLS
  ) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    let sitemap;
    try {
      sitemap = await fetchText(sitemapUrl, origin);
    } catch (err) {
      warnings.push(`Could not fetch sitemap ${sitemapUrl}: ${err.message}`);
      continue;
    }
    if (!sitemap.ok) {
      warnings.push(`Sitemap ${sitemapUrl} returned HTTP ${sitemap.status}`);
      continue;
    }

    sitemapUrls.push(sitemapUrl);
    for (const loc of xmlLocs(sitemap.text)) {
      try {
        const url = new URL(loc);
        if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) continue;
        if (/sitemap.*\.xml$/i.test(url.pathname)) {
          queue.push(url.href);
        } else if (url.protocol === 'https:' || url.protocol === 'http:') {
          pageUrls.add(url.href);
        }
      } catch {
        // Ignore malformed sitemap entries.
      }
    }
  }

  if (pageUrls.size === 0) {
    pageUrls.add(`${origin}/`);
    warnings.push('No sitemap page URLs were found; crawled the homepage only.');
  }

  return {
    sitemapUrls,
    urls: Array.from(pageUrls).sort(),
  };
}

function stripTags(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function attr(tag, name) {
  const rx = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  return decodeHtml(tag.match(rx)?.[1] || '');
}

function firstMatch(html, rx) {
  const match = String(html || '').match(rx);
  return match ? decodeHtml(match[1].trim()) : '';
}

function allMatches(html, rx) {
  return Array.from(String(html || '').matchAll(rx))
    .map((m) => stripTags(m[1]))
    .filter(Boolean);
}

function schemaTypes(html) {
  const types = new Set();
  const blocks = Array.from(
    String(html || '').matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(decodeHtml(block[1].trim()));
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== 'object') continue;
        const type = item['@type'];
        if (Array.isArray(type)) type.forEach((t) => types.add(String(t)));
        else if (type) types.add(String(type));
        if (Array.isArray(item['@graph'])) stack.push(...item['@graph']);
      }
    } catch {
      // Invalid JSON-LD should not fail the crawl.
    }
  }
  return Array.from(types).sort();
}

function extractQuestions(text) {
  const sentences = String(text || '').match(/[^.!?]+\?/g) || [];
  return unique(sentences.map((s) => s.trim()).filter((s) => s.length > 12)).slice(
    0,
    12,
  );
}

function parsePage(html, finalUrl, status, contentType) {
  const body = firstMatch(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) || html;
  const text = stripTags(body);
  const imageTags = Array.from(
    String(html || '').matchAll(/<img\b[^>]*>/gi),
  ).map((m) => m[0]);
  const links = Array.from(
    String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi),
  )
    .map((m) => decodeHtml(m[1]))
    .filter(Boolean);
  const url = new URL(finalUrl);
  const internalLinks = links.filter((href) => {
    try {
      const link = new URL(href, finalUrl);
      return ALLOWED_HOSTS.has(link.hostname.toLowerCase());
    } catch {
      return false;
    }
  });

  return {
    url: finalUrl,
    path: url.pathname || '/',
    status,
    contentType,
    title: stripTags(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)),
    metaDescription: attr(
      String(html || '').match(
        /<meta\b[^>]*(?:name|property)=["']description["'][^>]*>/i,
      )?.[0] || '',
      'content',
    ),
    canonical: attr(
      String(html || '').match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0] ||
        '',
      'href',
    ),
    h1: allMatches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
    h2: allMatches(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 20),
    h3: allMatches(html, /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi).slice(0, 20),
    images: {
      total: imageTags.length,
      missingAlt: imageTags.filter((tag) => !attr(tag, 'alt').trim()).length,
      samples: imageTags
        .map((tag) => ({
          src: attr(tag, 'src'),
          alt: attr(tag, 'alt'),
        }))
        .filter((img) => img.src)
        .slice(0, 8),
    },
    links: {
      internal: unique(internalLinks).length,
      external: Math.max(0, unique(links).length - unique(internalLinks).length),
    },
    schemaTypes: schemaTypes(html),
    questions: extractQuestions(text),
    wordCount: text ? text.split(/\s+/).length : 0,
    textSample: text.slice(0, 2400),
  };
}

// Bounded-concurrency map. Keeps total wall time inside the Netlify
// function budget while still respecting the source site's load.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function pull() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    () => pull(),
  );
  await Promise.all(runners);
  return results;
}

async function crawl(origin, limit) {
  const warnings = [];
  const discovered = await collectPageUrls(origin, warnings);
  const urls = discovered.urls.slice(0, limit);

  const fetched = await mapWithConcurrency(
    urls,
    PAGE_FETCH_CONCURRENCY,
    async (url) => {
      try {
        const result = await fetchText(url, origin);
        return { url, ok: true, result };
      } catch (err) {
        return { url, ok: false, error: err };
      }
    },
  );

  const pages = [];
  for (const item of fetched) {
    if (!item.ok) {
      warnings.push(`Failed to crawl ${item.url}: ${item.error.message}`);
      continue;
    }
    const { result } = item;
    if (!/html/i.test(result.contentType)) {
      warnings.push(
        `Skipped non-HTML URL ${item.url} (${result.contentType || 'unknown type'})`,
      );
      continue;
    }
    pages.push(parsePage(result.text, result.url, result.status, result.contentType));
  }

  return {
    origin,
    fetchedAt: new Date().toISOString(),
    userAgent: AUDIT_USER_AGENT,
    auditHeaders: {
      'User-Agent': AUDIT_USER_AGENT,
      'X-Leapfrog-Audit': 'seo-aeo-dashboard',
      'X-Leapfrog-Audit-Origin': origin,
    },
    sitemapUrls: discovered.sitemapUrls,
    discoveredUrlCount: discovered.urls.length,
    crawledUrlCount: pages.length,
    limit,
    pages,
    warnings,
  };
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export const handler = async (event) => {
  try {
    const params = event?.queryStringParameters || {};
    const origin = normalizeOrigin(params.origin);
    const requested = Number(params.limit ?? DEFAULT_LIMIT);
    const limit = Math.max(
      1,
      Math.min(
        MAX_LIMIT,
        Number.isFinite(requested) ? requested : DEFAULT_LIMIT,
      ),
    );
    const payload = await crawl(origin, limit);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: err?.message || 'Site crawl failed.' }),
    };
  }
};
