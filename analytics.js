'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const geoip = require('geoip-lite');

const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'analytics-events.jsonl');

const GEO_CACHE = new Map();
const GEO_CACHE_TTL = 6 * 60 * 60 * 1000;

async function lookupGeo(ip) {
  if (!ip) return null;

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

function getGeo(req) {
  const ip = clientIp(req).replace(/^::ffff:/, '');
  if (!ip || /^(127\.0\.0\.1|::1|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip)) {
    return null;
  }

  try {
    return geoip.lookup(ip) || null;
  } catch {
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

function isPrivateIp(ip) {
  return !ip || /^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip);
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
        geo = isPrivateIp(ip)
          ? null
          : await lookupGeo(ip);
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

      fs.appendFile(
        EVENTS_FILE,
        JSON.stringify(record) + '\n',
        'utf8',
        err => {
          if (err) {
            return res.status(500).json({ ok: false });
          }

          res.json({ ok: true });
        }
      );
    } catch (_) {
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

  function readEvents() {
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

  function dateKey(ts) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh'
    }).format(new Date(ts));
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
    const recentWindow = now - 30 * 60 * 1000;

    const todayEvents = events.filter(
      e => dateKey(e.ts) === today
    );

    const recentEvents = events.filter(
      e => new Date(e.ts).getTime() >= recentWindow
    );

    const visitorKey = e => e.visitor_hash || e.ip_hash;

    const visitorsToday = new Set(
      todayEvents.map(visitorKey)
    ).size;

    const liveUsers = new Set(
      recentEvents.map(visitorKey)
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
      server_time: new Date().toISOString(),
      today,

      live_users_30m: liveUsers,
      visitors_today: visitorsToday,
      page_views_today: pageViewsToday,
      downloads_today: downloadsToday,
      downloads_conversion_rate: conversionRate,

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

  app.get('/api/vooxor-analytics/summary', (req, res) => {
    if (!authorized(req)) {
      return res
        .status(process.env.ANALYTICS_DASH_TOKEN ? 401 : 503)
        .json({ ok: false });
    }

    res.json({
      ok: true,
      data: summarize(readEvents())
    });
  });
}

module.exports = { setupVoooxorAnalytics };
