'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'analytics-events.jsonl');

const B2_BUCKET = process.env.B2_BUCKET || '';
const B2_ENDPOINT = (process.env.B2_ENDPOINT || '').replace(/\/+$/, '');
const B2_KEY_ID = process.env.B2_APPLICATION_KEY_ID || '';
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY || '';
const B2_FILE_NAME = 'analytics/analytics-events.jsonl';

const B2_ENABLED = Boolean(
  B2_BUCKET &&
  B2_ENDPOINT &&
  B2_KEY_ID &&
  B2_APPLICATION_KEY
);

const GEO_CACHE = new Map();
const GEO_CACHE_TTL = 6 * 60 * 60 * 1000;

let eventsCache = null;
let eventsLoadPromise = null;
let b2WriteChain = Promise.resolve();
let b2AuthCache = null;
let b2UploadCache = null;

function safe(value, max = 500) {
  return String(value ?? '').slice(0, max);
}

function hash(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 24);
}

function clientIp(req) {
  const raw =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    '';

  return safe(String(raw).split(',')[0].trim(), 100);
}

function isPrivateIp(ip) {
  return !ip || /^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip);
}

async function lookupGeo(ip) {
  if (!ip || isPrivateIp(ip)) return null;

  const cached = GEO_CACHE.get(ip);

  if (cached && (Date.now() - cached.ts) < GEO_CACHE_TTL) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      {
        headers: { accept: 'application/json' },
        signal: controller.signal
      }
    );

    clearTimeout(timer);

    if (!response.ok) return null;

    const data = await response.json();

    const geo = data && data.success ? {
      country: /^[A-Z]{2}$/.test(
        String(data.country_code || '').toUpperCase()
      )
        ? String(data.country_code).toUpperCase()
        : 'UNKNOWN',
      city: safe(data.city, 120) || 'UNKNOWN'
    } : null;

    GEO_CACHE.set(ip, {
      ts: Date.now(),
      data: geo
    });

    return geo;
  } catch (_) {
    return null;
  }
}

function getCfCountry(req) {
  const country = String(
    req.headers['cf-ipcountry'] || ''
  ).trim().toUpperCase();

  return /^[A-Z]{2}$/.test(country) ? country : '';
}

function getCfCity(req) {
  return String(
    req.headers['cf-ipcity'] || ''
  ).trim();
}

function getLanguage(req, body) {
  const clientLanguage = String(body.language || '').trim();

  if (clientLanguage) {
    return safe(clientLanguage.split(',')[0], 40);
  }

  const headerLanguage = String(req.headers['accept-language'] || '')
    .split(',')[0]
    .trim();

  return safe(headerLanguage || 'UNKNOWN', 40);
}

function getDevice(userAgent) {
  const s = String(userAgent || '').toLowerCase();

  if (/ipad|tablet|playbook|silk/.test(s)) {
    return 'Tablet';
  }

  if (/mobi|android|iphone|ipod|windows phone/.test(s)) {
    return 'Mobile';
  }

  return 'Desktop';
}

function getBrowser(userAgent) {
  const s = String(userAgent || '').toLowerCase();

  if (/edg\//.test(s)) return 'Edge';
  if (/opr\//.test(s) || /opera/.test(s)) return 'Opera';
  if (/firefox\//.test(s)) return 'Firefox';
  if (/chrome\//.test(s) && !/edg\//.test(s)) return 'Chrome';
  if (/safari\//.test(s) && !/chrome\//.test(s)) return 'Safari';
  if (/android/.test(s)) return 'Android Browser';

  return 'Other';
}

function getSource(referrer) {
  const raw = safe(referrer || 'direct', 500);

  if (!raw || raw === 'direct') {
    return 'Direct';
  }

  try {
    const host = new URL(raw).hostname
      .toLowerCase()
      .replace(/^www\./, '');

    if (/google\./.test(host)) return 'Google';
    if (/bing\.com$/.test(host)) return 'Bing';
    if (/yahoo\./.test(host)) return 'Yahoo';
    if (/duckduckgo\.com$/.test(host)) return 'DuckDuckGo';
    if (/facebook\.com$|fb\.com$/.test(host)) return 'Facebook';
    if (/instagram\.com$/.test(host)) return 'Instagram';
    if (/tiktok\.com$/.test(host)) return 'TikTok';
    if (/snapchat\.com$/.test(host)) return 'Snapchat';

    return host || 'Other';
  } catch (_) {
    return 'Other';
  }
}

function parseLocalEvents() {
  if (!fs.existsSync(EVENTS_FILE)) {
    return [];
  }

  return fs.readFileSync(EVENTS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function b2ConfigValid() {
  return B2_ENABLED && /^https:\/\/s3\.[^/]+\.backblazeb2\.com$/i.test(B2_ENDPOINT);
}

async function b2Authorize() {
  if (!b2ConfigValid()) {
    throw new Error('B2 configuration missing');
  }

  if (
    b2AuthCache &&
    Date.now() - b2AuthCache.createdAt < 20 * 60 * 60 * 1000
  ) {
    return b2AuthCache;
  }

  const basic = Buffer
    .from(`${B2_KEY_ID}:${B2_APPLICATION_KEY}`)
    .toString('base64');

  const response = await fetch(
    'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',
    {
      headers: {
        Authorization: `Basic ${basic}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`B2 authorize failed: HTTP ${response.status}`);
  }

  const data = await response.json();

  const storageApi = data.apiInfo?.storageApi || {};
  const allowedBuckets = Array.isArray(storageApi.allowed?.buckets)
    ? storageApi.allowed.buckets
    : [];

  const targetBucket = allowedBuckets.find(
    bucket => bucket && bucket.name === B2_BUCKET
  );

  const auth = {
    createdAt: Date.now(),
    authorizationToken: data.authorizationToken,
    apiUrl: storageApi.apiUrl || '',
    downloadUrl: storageApi.downloadUrl || '',
    bucketId: targetBucket?.id || ''
  };

  if (!auth.authorizationToken || !auth.apiUrl) {
    throw new Error('B2 authorize response incomplete');
  }

  b2AuthCache = auth;
  return auth;
}

async function b2GetUploadUrl() {
  const auth = await b2Authorize();

  if (
    b2UploadCache &&
    b2UploadCache.authorizationToken &&
    b2UploadCache.uploadUrl &&
    Date.now() - b2UploadCache.createdAt < 20 * 60 * 60 * 1000
  ) {
    return b2UploadCache;
  }

  if (!auth.bucketId) {
    throw new Error('B2 bucketId unavailable');
  }

  const response = await fetch(
    `${auth.apiUrl}/b2api/v4/b2_get_upload_url?bucketId=${encodeURIComponent(auth.bucketId)}`,
    {
      headers: {
        Authorization: auth.authorizationToken
      }
    }
  );

  if (!response.ok) {
    throw new Error(`B2 upload URL failed: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.uploadUrl || !data.authorizationToken) {
    throw new Error('B2 upload URL response incomplete');
  }

  b2UploadCache = {
    createdAt: Date.now(),
    uploadUrl: data.uploadUrl,
    authorizationToken: data.authorizationToken
  };

  return b2UploadCache;
}

async function b2DownloadEvents() {
  const auth = await b2Authorize();

  const url =
    `${auth.downloadUrl}/file/${encodeURIComponent(B2_BUCKET)}/${B2_FILE_NAME}`;

  const response = await fetch(url, {
    headers: {
      Authorization: auth.authorizationToken
    }
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`B2 download failed: HTTP ${response.status}`);
  }

  const text = await response.text();

  return text
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

async function b2UploadEvents(events) {
  const payload = events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
  const body = Buffer.from(payload, 'utf8');

  const sha1 = crypto
    .createHash('sha1')
    .update(body)
    .digest('hex');

  let upload = await b2GetUploadUrl();

  let response = await fetch(upload.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: upload.authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(B2_FILE_NAME),
      'Content-Type': 'application/x-ndjson',
      'Content-Length': String(body.length),
      'X-Bz-Content-Sha1': sha1
    },
    body
  });

  if (!response.ok) {
    b2UploadCache = null;
    upload = await b2GetUploadUrl();

    response = await fetch(upload.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: upload.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(B2_FILE_NAME),
        'Content-Type': 'application/x-ndjson',
        'Content-Length': String(body.length),
        'X-Bz-Content-Sha1': sha1
      },
      body
    });
  }

  if (!response.ok) {
    throw new Error(`B2 upload failed: HTTP ${response.status}`);
  }
}

async function loadEvents() {
  if (eventsCache) {
    return eventsCache;
  }

  if (eventsLoadPromise) {
    return eventsLoadPromise;
  }

  eventsLoadPromise = (async () => {
    if (B2_ENABLED) {
      try {
        const remote = await b2DownloadEvents();

        if (remote.length > 0) {
          eventsCache = remote;

          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(
            EVENTS_FILE,
            remote.map(e => JSON.stringify(e)).join('\n') + '\n',
            'utf8'
          );

          return eventsCache;
        }

        eventsCache = parseLocalEvents();

        if (eventsCache.length > 0) {
          await b2UploadEvents(eventsCache);
        }

        return eventsCache;
      } catch (error) {
        console.error('[VOOXOR ANALYTICS] B2 load failed:', error.message);
      }
    }

    eventsCache = parseLocalEvents();
    return eventsCache;
  })();

  try {
    return await eventsLoadPromise;
  } finally {
    eventsLoadPromise = null;
  }
}

async function persistEvents() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const snapshot = Array.isArray(eventsCache) ? [...eventsCache] : [];

  fs.writeFileSync(
    EVENTS_FILE,
    snapshot.map(e => JSON.stringify(e)).join('\n') + (snapshot.length ? '\n' : ''),
    'utf8'
  );

  if (!B2_ENABLED) {
    return;
  }

  b2WriteChain = b2WriteChain.then(
    () => b2UploadEvents(snapshot),
    () => b2UploadEvents(snapshot)
  );

  await b2WriteChain;
}

function dateKey(ts) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh'
  }).format(new Date(ts));
}

function monthKey(ts) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date(ts));

  const year = parts.find(p => p.type === 'year')?.value || '0000';
  const month = parts.find(p => p.type === 'month')?.value || '00';

  return `${year}-${month}`;
}

function aggregate(events, field, eventName = null) {
  const result = {};

  for (const event of events) {
    if (eventName && event.event !== eventName) {
      continue;
    }

    const key = event[field] || 'UNKNOWN';
    result[key] = (result[key] || 0) + 1;
  }

  return result;
}

function summarize(events) {
  const now = Date.now();
  const today = dateKey(now);
  const currentMonth = monthKey(now);
  const recentWindow = now - 30 * 60 * 1000;

  const todayEvents = events.filter(
    e => dateKey(e.ts) === today
  );

  const monthEvents = events.filter(
    e => monthKey(e.ts) === currentMonth
  );

  const recentEvents = events.filter(
    e => new Date(e.ts).getTime() >= recentWindow
  );

  const visitorKey = e => e.visitor_hash || e.ip_hash || 'UNKNOWN';

  const visitorsToday = new Set(
    todayEvents.map(visitorKey).filter(v => v !== 'UNKNOWN')
  ).size;

  const liveUsers = new Set(
    recentEvents.map(visitorKey).filter(v => v !== 'UNKNOWN')
  ).size;

  const pageViewsToday = todayEvents.filter(
    e => e.event === 'page_view'
  ).length;

  const downloadsToday = todayEvents.filter(
    e => e.event === 'download_click'
  ).length;

  const conversionRate = pageViewsToday
    ? +(downloadsToday / pageViewsToday * 100).toFixed(2)
    : null;

  const installsToday = todayEvents.filter(
    e => e.event === 'pwa_installed'
  ).length;

  const promptShownToday = todayEvents.filter(
    e => e.event === 'pwa_install_prompt_shown'
  ).length;

  const acceptedToday = todayEvents.filter(
    e =>
      e.event === 'pwa_install_prompt_result' &&
      e.outcome === 'accepted'
  ).length;

  const monthPageViews = monthEvents.filter(
    e => e.event === 'page_view'
  ).length;

  const monthVisitorDays = new Map();

  for (const event of monthEvents) {
    if (event.event !== 'page_view') continue;

    const visitor = visitorKey(event);

    if (visitor === 'UNKNOWN') continue;

    const day = dateKey(event.ts);

    if (!monthVisitorDays.has(visitor)) {
      monthVisitorDays.set(visitor, new Set());
    }

    monthVisitorDays.get(visitor).add(day);
  }

  const monthVisitors = monthVisitorDays.size;

  const returningVisitors = Array.from(
    monthVisitorDays.values()
  ).filter(days => days.size >= 2).length;

  const daily = [];

  for (let i = 13; i >= 0; i--) {
    const key = dateKey(now - i * 86400000);
    const day = events.filter(e => dateKey(e.ts) === key);

    daily.push({
      date: key,
      page_views: day.filter(e => e.event === 'page_view').length,
      downloads: day.filter(e => e.event === 'download_click').length,
      installs: day.filter(e => e.event === 'pwa_installed').length
    });
  }

  return {
    data_real: true,
    storage_persistent: B2_ENABLED,
    server_time: new Date().toISOString(),
    today,
    current_month: currentMonth,

    live_users_30m: liveUsers,

    visitors_today: visitorsToday,
    page_views_today: pageViewsToday,
    downloads_today: downloadsToday,
    downloads_conversion_rate: conversionRate,

    page_views_month: monthPageViews,
    visitors_month: monthVisitors,
    returning_visitors_month: returningVisitors,
    daily_14d: daily,

    installs_today: installsToday,
    install_prompt_shown_today: promptShownToday,
    install_accepted_today: acceptedToday,

    downloads_by_platform: aggregate(
      todayEvents,
      'platform',
      'download_click'
    ),

    downloads_by_page: aggregate(
      todayEvents,
      'page_path',
      'download_click'
    ),

    countries_today: aggregate(
      todayEvents,
      'country'
    ),

    cities_today: todayEvents.reduce((out, ev) => {
      const country = String(ev.country || 'UNKNOWN');
      const city = String(ev.city || 'UNKNOWN');

      out[country] = out[country] || {};
      out[country][city] = (out[country][city] || 0) + 1;

      return out;
    }, {}),

    sources_today: aggregate(
      todayEvents,
      'source'
    ),

    devices_today: aggregate(
      todayEvents,
      'device'
    ),

    browsers_today: aggregate(
      todayEvents,
      'browser'
    ),

    languages_today: aggregate(
      todayEvents,
      'language'
    ),

    daily,

    recent_activity: events
      .slice(-50)
      .reverse()
  };
}

function setupVoooxorAnalytics(app) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  app.post('/api/vooxor-analytics', async (req, res) => {
    try {
      const body = req.body || {};
      const event = safe(body.event, 80);

      const allowed = new Set([
        'page_view',
        'download_click',
        'pwa_install_prompt_available',
        'pwa_install_prompt_shown',
        'pwa_install_prompt_result',
        'pwa_installed',
        'pwa_install_prompt_error'
      ]);

      if (!allowed.has(event)) {
        return res.status(400).json({ ok: false });
      }

      const ua = safe(req.headers['user-agent'], 600);
      const ip = clientIp(req);
      const ipHash = hash(ip);
      const suppliedVisitor = safe(body.visitor_id, 100);

      const cfCountry = getCfCountry(req);
      const cfCity = getCfCity(req);

      let geo = null;

      if (!cfCountry || !cfCity) {
        geo = await lookupGeo(ip);
      }

      const country = cfCountry || (geo?.country || 'UNKNOWN');
      const city = cfCity || (geo?.city || 'UNKNOWN');

      const record = {
        ts: new Date().toISOString(),
        event,
        page_path: safe(body.page_path, 300),
        page_title: safe(body.page_title, 300),
        platform: safe(body.platform || 'unknown', 40),
        referrer: safe(body.referrer || 'direct', 500),
        source: getSource(body.referrer || 'direct'),
        outcome: safe(body.outcome, 40),

        country,
        city,
        device: getDevice(ua),
        browser: getBrowser(ua),
        language: getLanguage(req, body),

        visitor_hash: suppliedVisitor
          ? hash(suppliedVisitor)
          : ipHash,

        ip_hash: ipHash
      };

      const events = await loadEvents();

      events.push(record);
      eventsCache = events;

      try {
        await persistEvents();
        return res.json({
          ok: true,
          persisted: B2_ENABLED
        });
      } catch (error) {
        console.error('[VOOXOR ANALYTICS] B2 persist failed:', error.message);

        return res.status(503).json({
          ok: false,
          persisted: false
        });
      }
    } catch (error) {
      console.error('[VOOXOR ANALYTICS] event failed:', error.message);
      res.status(500).json({ ok: false });
    }
  });

  function authorized(req) {
    const expected = process.env.ANALYTICS_DASH_TOKEN;

    if (!expected) {
      return false;
    }

    return String(req.headers.authorization || '') === 'Bearer ' + expected;
  }

  app.get('/api/vooxor-analytics/summary', async (req, res) => {
    if (!authorized(req)) {
      return res
        .status(process.env.ANALYTICS_DASH_TOKEN ? 401 : 503)
        .json({ ok: false });
    }

    try {
      const events = await loadEvents();

      res.json({
        ok: true,
        data: summarize(events)
      });
    } catch (error) {
      console.error('[VOOXOR ANALYTICS] summary failed:', error.message);

      res.status(500).json({
        ok: false
      });
    }
  });
}

module.exports = { setupVoooxorAnalytics };
