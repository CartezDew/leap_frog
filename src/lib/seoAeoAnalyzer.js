import { buildKeywordTimeline, ctrFor } from './keywordAnalyzer.js';

const STOP_WORDS = new Set([
  'and',
  'are',
  'best',
  'for',
  'from',
  'how',
  'into',
  'near',
  'the',
  'this',
  'that',
  'what',
  'when',
  'where',
  'with',
  'your',
]);

const QUESTION_STARTERS = [
  'what',
  'how',
  'why',
  'when',
  'where',
  'which',
  'who',
  'can',
  'does',
  'should',
  'is',
  'are',
];

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function textOf(...parts) {
  return parts
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function tokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && !STOP_WORDS.has(part));
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function keywordRows(analyzed) {
  return buildKeywordTimeline(analyzed?.semrush_keywords || [])
    .filter((row) => row.scope === 'national' || row.scope === 'local')
    .map((row) => ({
      ...row,
      latest_position: row.latest?.position ?? null,
      volume: num(row.latest?.volume),
      cpc: num(row.latest?.cpc),
      ctr: ctrFor(row.latest?.position),
      est_clicks: num(row.est_clicks),
      value: num(row.est_value),
      tokenSet: new Set(tokens(row.keyword)),
    }))
    .sort((a, b) => {
      const aScore = num(a.value) + num(a.volume) / 20 - num(a.latest_position, 100);
      const bScore = num(b.value) + num(b.volume) / 20 - num(b.latest_position, 100);
      return bScore - aScore;
    });
}

function trustedKeywordRows(analyzed) {
  const grouped = new Map();
  for (const row of keywordRows(analyzed)) {
    if (!grouped.has(row.keyword)) grouped.set(row.keyword, []);
    grouped.get(row.keyword).push(row);
  }

  return Array.from(grouped.values())
    .map((rows) => {
      const hasGeo = Boolean(rows[0]?.geo);
      const local = rows.find((row) => row.scope === 'local');
      const national = rows.find((row) => row.scope === 'national');
      // Avoid double-counting local + national Semrush rows. Geo keywords use
      // local rank when available; everything else uses the national row.
      return (hasGeo && local) || national || local || rows[0];
    })
    .sort((a, b) => b.value + b.volume / 20 - (a.value + a.volume / 20));
}

function pageSearchText(page) {
  return textOf(
    page.title,
    page.metaDescription,
    page.h1,
    page.h2,
    page.h3,
    page.textSample,
    page.images?.samples?.map((img) => img.alt),
  );
}

function pageScore(keyword, page) {
  const haystack = pageSearchText(page);
  if (!haystack) return 0;
  const phrase = String(keyword.keyword || '').toLowerCase();
  let score = haystack.includes(phrase) ? 55 : 0;
  for (const token of keyword.tokenSet) {
    if (haystack.includes(token)) score += 12;
  }
  if (textOf(page.title).includes(phrase)) score += 20;
  if (textOf(page.h1).includes(phrase)) score += 20;
  if (textOf(page.metaDescription).includes(phrase)) score += 10;
  return Math.min(100, score);
}

function findBestPage(keyword, pages) {
  return (pages || [])
    .map((page) => ({ page, score: pageScore(keyword, page) }))
    .sort((a, b) => b.score - a.score)[0] || { page: null, score: 0 };
}

function intentQuestion(keyword) {
  const k = String(keyword || '').trim();
  const first = k.split(/\s+/)[0]?.toLowerCase();
  if (QUESTION_STARTERS.includes(first) || /\?$/.test(k)) {
    return /\?$/.test(k) ? k : `${k}?`;
  }
  if (/\batlanta\b|\bmarietta\b|\bnorcross\b/i.test(k)) {
    return `Which company should a mid-market business choose for ${k}?`;
  }
  if (/\bvciso\b|\bvcso\b|virtual ciso/i.test(k)) {
    return 'When should a business use a vCISO or virtual security officer?';
  }
  if (/\bcyber\b|\bsecurity\b|\brisk\b/i.test(k)) {
    return `How can a business reduce risk with ${k}?`;
  }
  return `What should a business know before choosing ${k}?`;
}

function money(value) {
  return `$${Math.round(num(value)).toLocaleString('en-US')}`;
}

function metricContext(keyword) {
  const parts = [];
  if (keyword.latest_position != null) parts.push(`currently ranks #${keyword.latest_position}`);
  if (keyword.volume > 0) parts.push(`${Math.round(keyword.volume).toLocaleString('en-US')} monthly searches`);
  if (keyword.cpc > 0) parts.push(`${money(keyword.cpc)} CPC`);
  if (keyword.value > 0) parts.push(`${money(keyword.value)} modeled monthly traffic value`);
  return parts.join(', ');
}

function joinReadable(items) {
  const list = items.filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function pageOpportunityExplanation(keyword, page, fit, missing) {
  const context = metricContext(keyword);
  const scope = keyword.scope === 'local' ? 'local Semrush row' : 'national Semrush row';
  if (!page) {
    return `"${keyword.keyword}" has no strong matching page in the crawl${context ? ` (${context})` : ''}. Create a focused landing page or service section that answers the buyer intent, uses the keyword naturally in the title/H1, and links into the relevant Leapfrog service path. Source: ${scope}.`;
  }

  const pageLabel = page.path || page.url;
  const missingText = missing.length
    ? `The page is missing strong keyword alignment in ${joinReadable(missing)}.`
    : 'The page already has a reasonable match, so the next gain is stronger supporting copy and internal links.';
  const action =
    fit < 45
      ? 'Consider a dedicated page if this keyword is strategically important.'
      : fit < 70
        ? 'Add a concise section that explains the service, ideal buyer, proof points, and next step.'
        : 'Defend the page by keeping the answer fresh and linking to it from related service and blog content.';

  return `${pageLabel} is the best crawled fit for "${keyword.keyword}" at ${fit}%${context ? ` (${context})` : ''}. ${missingText} ${action} Source: ${scope}.`;
}

function questionExplanation(keyword, best, directAnswerFound, question) {
  const context = metricContext(keyword);
  const page = best.page?.path || 'a new FAQ/content block';
  if (directAnswerFound) {
    return `${page} appears to cover this question well enough for AEO discovery. Keep the answer short, explicit, and updated so AI/search tools can quote it cleanly${context ? `; the source keyword ${context}` : ''}.`;
  }
  if (best.score >= 55) {
    return `${page} is related but not direct enough for "${question}". Add a 40-80 word answer near the relevant service copy, then support it with proof points, client outcomes, and a conversion link${context ? `; prioritize because the source keyword ${context}` : ''}.`;
  }
  return `No crawled page strongly answers "${question}". Create a direct Q&A block or article section that states Leapfrog's point of view first, then expands with service details and evidence${context ? `; prioritize because the source keyword ${context}` : ''}.`;
}

function technicalExplanation(page, issues) {
  const pageLabel = page.path || page.url;
  const titleLen = page.title ? page.title.length : 0;
  const metaLen = page.metaDescription ? page.metaDescription.length : 0;
  const issueText = joinReadable(issues.slice(0, 4));
  const details = [];
  if (titleLen) details.push(`title is ${titleLen} characters`);
  if (metaLen) details.push(`meta description is ${metaLen} characters`);
  if (page.wordCount != null) details.push(`${page.wordCount} visible words`);
  if (page.images?.missingAlt > 0) details.push(`${page.images.missingAlt} images missing alt text`);
  if (page.schemaTypes?.length) details.push(`detected schema: ${page.schemaTypes.join(', ')}`);

  if (issues.length === 0) {
    return `${pageLabel} has the key crawlable signals in place. Recheck after major content changes.`;
  }

  return `${pageLabel} needs cleanup for ${issueText}. ${details.join('; ')}. Fix these so search engines and AI answer tools can understand the page topic, summarize it accurately, and connect images/content to Leapfrog services.`;
}

function campaignExplanation(cluster) {
  const avgCpc =
    cluster.cpcWeight > 0
      ? Math.round((cluster.weightedCpc / cluster.cpcWeight) * 100) / 100
      : 0;
  const keywords = unique(cluster.keywords);
  const sample = joinReadable(keywords.slice(0, 3));
  const pages = Array.from(cluster.topPages.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([page]) => page)
    .slice(0, 2);
  const pageText = pages.length
    ? `Use ${joinReadable(pages)} as the initial landing-page focus.`
    : 'Pick or create a landing page before scaling promotion.';

  if (cluster.paidValue > 1000 || avgCpc >= 15) {
    return `${cluster.theme} has ${keywords.length} tracked keywords, ${Math.round(cluster.totalVolume).toLocaleString('en-US')} monthly searches, ${money(avgCpc)} average CPC, and ${money(cluster.paidValue)} modeled traffic value. Defend it organically and use paid search selectively around high-intent terms such as ${sample}. ${pageText}`;
  }
  if (cluster.totalVolume >= 500) {
    return `${cluster.theme} has meaningful search demand (${Math.round(cluster.totalVolume).toLocaleString('en-US')} monthly searches) but lower modeled paid value (${money(cluster.paidValue)}). Build organic content, FAQs, email/social posts, and internal links around ${sample}. ${pageText}`;
  }
  return `${cluster.theme} is a smaller cluster (${keywords.length} tracked keywords) that can support niche AEO and earned-media angles. Use it for specific FAQs, quote opportunities, and supporting blog sections rather than broad paid coverage. ${pageText}`;
}

function makePageOpportunity(keyword, best) {
  const page = best.page;
  const missing = [];
  const phrase = String(keyword.keyword || '').toLowerCase();
  if (!page) {
    return {
      keyword: keyword.keyword,
      scope: keyword.scope,
      theme: keyword.theme?.label || 'Other',
      intent: keyword.intent?.label || 'Informational',
      position: keyword.latest_position,
      volume: keyword.volume,
      cpc: keyword.cpc,
      ctr: keyword.ctr,
      estClicks: keyword.est_clicks,
      estValue: keyword.value,
      semrushScope: keyword.scope,
      page: 'New content needed',
      url: '',
      fit: 0,
      priority: Math.round(keyword.volume + keyword.cpc * 30),
      recommendation: pageOpportunityExplanation(keyword, null, 0, []),
    };
  }

  if (!textOf(page.title).includes(phrase)) missing.push('title');
  if (!textOf(page.metaDescription).includes(phrase)) missing.push('meta description');
  if (!textOf(page.h1).includes(phrase)) missing.push('H1');
  if (page.images?.missingAlt > 0) missing.push('image alt text');
  if (page.wordCount < 450) missing.push('depth');

  const recommendation =
    pageOpportunityExplanation(keyword, page, best.score, missing);

  return {
    keyword: keyword.keyword,
    scope: keyword.scope,
    theme: keyword.theme?.label || 'Other',
    intent: keyword.intent?.label || 'Informational',
    position: keyword.latest_position,
    volume: keyword.volume,
    cpc: keyword.cpc,
    ctr: keyword.ctr,
    estClicks: keyword.est_clicks,
    estValue: keyword.value,
    semrushScope: keyword.scope,
    page: page.path,
    url: page.url,
    fit: best.score,
    priority: Math.round((100 - best.score) + keyword.volume / 10 + keyword.cpc * 20),
    recommendation,
  };
}

function buildQuestionOpportunities(keywords, pages) {
  const answered = new Set(
    (pages || []).flatMap((page) => page.questions || []).map((q) => q.toLowerCase()),
  );
  return keywords.slice(0, 40).map((keyword) => {
    const question = intentQuestion(keyword.keyword);
    const best = findBestPage(keyword, pages);
    const directAnswerFound =
      answered.has(question.toLowerCase()) || (best.page && best.score >= 80);
    return {
      question,
      keyword: keyword.keyword,
      theme: keyword.theme?.label || 'Other',
      intent: keyword.intent?.label || 'Informational',
      page: best.page?.path || 'New FAQ/content block',
      fit: best.score,
      priority: directAnswerFound ? 'Maintain' : best.score >= 55 ? 'Improve' : 'Create',
      recommendation: questionExplanation(keyword, best, directAnswerFound, question),
    };
  });
}

function buildTechnical(pages) {
  return (pages || [])
    .map((page) => {
      const issues = [];
      if (!page.title) issues.push('Missing title');
      else if (page.title.length < 30 || page.title.length > 65) issues.push('Title length');
      if (!page.metaDescription) issues.push('Missing meta description');
      else if (page.metaDescription.length < 80 || page.metaDescription.length > 165) {
        issues.push('Meta description length');
      }
      if (!page.h1?.length) issues.push('Missing H1');
      if ((page.h1 || []).length > 1) issues.push('Multiple H1s');
      if (page.images?.missingAlt > 0) issues.push(`${page.images.missingAlt} images missing alt text`);
      if (!page.schemaTypes?.length) issues.push('No detected schema');
      if (page.wordCount < 350) issues.push('Thin copy');

      return {
        page: page.path,
        url: page.url,
        title: page.title || 'Untitled',
        wordCount: page.wordCount,
        missingAlt: page.images?.missingAlt || 0,
        schema: page.schemaTypes?.join(', ') || 'None detected',
        issues,
        issueCount: issues.length,
        recommendation: technicalExplanation(page, issues),
      };
    })
    .filter((row) => row.issueCount > 0)
    .sort((a, b) => b.issueCount - a.issueCount);
}

function buildCampaignClusters(keywords, pageOpportunities) {
  const clusters = new Map();
  for (const keyword of keywords) {
    const key = keyword.theme?.label || 'Other';
    const cluster =
      clusters.get(key) ||
      clusters.set(key, {
        theme: key,
        keywords: [],
        totalVolume: 0,
        paidValue: 0,
        modeledClicks: 0,
        weightedCpc: 0,
        cpcWeight: 0,
        scopes: new Set(),
        topPages: new Map(),
      }).get(key);
    cluster.keywords.push(keyword.keyword);
    cluster.totalVolume += keyword.volume;
    cluster.paidValue += keyword.value;
    cluster.modeledClicks += keyword.est_clicks;
    cluster.weightedCpc += keyword.cpc * Math.max(1, keyword.volume);
    cluster.cpcWeight += Math.max(1, keyword.volume);
    cluster.scopes.add(keyword.scope);
  }

  for (const opp of pageOpportunities) {
    const cluster = clusters.get(opp.theme);
    if (cluster && opp.page) {
      cluster.topPages.set(opp.page, (cluster.topPages.get(opp.page) || 0) + 1);
    }
  }

  return Array.from(clusters.values())
    .map((cluster) => ({
      theme: cluster.theme,
      keywordCount: unique(cluster.keywords).length,
      totalVolume: Math.round(cluster.totalVolume),
      paidValue: Math.round(cluster.paidValue),
      modeledClicks: Math.round(cluster.modeledClicks * 10) / 10,
      avgCpc:
        cluster.cpcWeight > 0
          ? Math.round((cluster.weightedCpc / cluster.cpcWeight) * 100) / 100
          : 0,
      semrushScope: Array.from(cluster.scopes).sort().join(' + '),
      sampleKeywords: unique(cluster.keywords).slice(0, 6),
      landingPages: Array.from(cluster.topPages.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([page]) => page)
        .slice(0, 3),
      recommendation: campaignExplanation(cluster),
    }))
    .sort((a, b) => b.paidValue + b.totalVolume / 10 - (a.paidValue + a.totalVolume / 10));
}

function buildEarnedMedia(pageOpportunities) {
  return pageOpportunities
    .filter((opp) => opp.fit < 70 && (opp.volume > 0 || opp.cpc > 0))
    .slice(0, 12)
    .map((opp) => ({
      topic: opp.keyword,
      theme: opp.theme,
      angle:
        opp.position != null && opp.position <= 20
          ? `Leapfrog already has visibility for "${opp.keyword}" at #${opp.position}; pitch a practical expert point of view that reinforces the ranking and earns third-party mentions.`
          : `Use "${opp.keyword}" as a thought-leadership angle for buyers researching ${opp.theme.toLowerCase()}; pair outreach with an owned page that answers the topic directly.`,
      proof: opp.page === 'New content needed'
        ? `Create supporting owned content first because the crawl did not find a strong page fit (${opp.fit}%).`
        : `Use ${opp.page} as the owned-media proof point, but strengthen the page first because the current fit is ${opp.fit}%.`,
      priority: opp.priority,
    }));
}

export function runSeoAeoAnalysis({ analyzed, siteCrawl }) {
  const pages = Array.isArray(siteCrawl?.pages) ? siteCrawl.pages : [];
  const allKeywordRows = keywordRows(analyzed);
  const keywords = trustedKeywordRows(analyzed);
  if (!keywords.length || !pages.length) {
    return {
      empty: true,
      keywords,
      pages,
      summary: {
        crawledPages: pages.length,
        keywordCount: keywords.length,
        semrushRows: allKeywordRows.length,
      },
      pageOpportunities: [],
      questionOpportunities: [],
      technical: [],
      campaignClusters: [],
      earnedMedia: [],
    };
  }

  const pageOpportunities = keywords
    .slice(0, 75)
    .map((keyword) => makePageOpportunity(keyword, findBestPage(keyword, pages)))
    .sort((a, b) => b.priority - a.priority);
  const technical = buildTechnical(pages);
  const questionOpportunities = buildQuestionOpportunities(keywords, pages);
  const campaignClusters = buildCampaignClusters(keywords, pageOpportunities);
  const earnedMedia = buildEarnedMedia(pageOpportunities);

  const avgFit =
    pageOpportunities.length > 0
      ? Math.round(
          pageOpportunities.reduce((sum, row) => sum + row.fit, 0) / pageOpportunities.length,
        )
      : 0;

  return {
    empty: false,
    keywords,
    pages,
    summary: {
      crawledPages: pages.length,
      discoveredPages: siteCrawl?.discoveredUrlCount || pages.length,
      keywordCount: unique(keywords.map((k) => k.keyword)).length,
      semrushRows: allKeywordRows.length,
      avgFit,
      weakMatches: pageOpportunities.filter((row) => row.fit < 55).length,
      technicalIssues: technical.reduce((sum, row) => sum + row.issueCount, 0),
      missingAlt: pages.reduce((sum, page) => sum + (page.images?.missingAlt || 0), 0),
      userAgent: siteCrawl?.userAgent || '',
    },
    pageOpportunities,
    questionOpportunities,
    technical,
    campaignClusters,
    earnedMedia,
    warnings: siteCrawl?.warnings || [],
  };
}
