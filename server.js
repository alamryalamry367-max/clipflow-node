const express = require('express');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(PUBLIC, { maxAge: '1h' }));

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a,b,c,d] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      a === 0 || a >= 224;
  }
  if (net.isIP(ip) === 6) {
    const x = ip.toLowerCase();
    return x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80:');
  }
  return true;
}

async function validateRemoteUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('Enter a valid URL.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (u.username || u.password) throw new Error('Credential URLs are not allowed.');
  const host = u.hostname.toLowerCase();
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private or local network URLs are not allowed.');
  } else {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some(r => isPrivateIp(r.address))) throw new Error('This host is not allowed.');
  }
  return u;
}

async function fetchMedia(value, method = 'HEAD') {
  const u = await validateRemoteUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(u, { method, redirect: 'follow', signal: controller.signal });
  } finally { clearTimeout(timer); }
}

app.post('/api/resolve', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Paste a URL first.' });
  try {
    const response = await fetchMedia(url, 'HEAD');
    const type = response.headers.get('content-type') || '';
    const length = response.headers.get('content-length');
    if (!type.toLowerCase().startsWith('video/')) {
      return res.status(422).json({ error: 'This URL does not point directly to a video file. ClipFlow V1 does not bypass platform protections.' });
    }
    res.json({ ok: true, finalUrl: response.url, contentType: type, contentLength: length ? Number(length) : null });
  } catch (e) {
    res.status(400).json({ error: e.name === 'AbortError' ? 'The source took too long to respond.' : (e.message || 'Could not verify this URL.') });
  }
});

app.get('/download', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).send('Invalid URL');
  try {
    const response = await fetchMedia(url, 'GET');
    const type = response.headers.get('content-type') || '';
    if (!type.toLowerCase().startsWith('video/')) return res.status(422).send('URL is not a direct video file.');
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', 'attachment; filename="clipflow-video.mp4"');
    const length = response.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    if (!response.body) return res.status(502).send('No media stream available.');
    for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.status(502).send(e.name === 'AbortError' ? 'Download timed out.' : 'Download failed.');
  }
});

app.get('/privacy', (_, res) => res.sendFile(path.join(PUBLIC, 'privacy.html')));
app.get('/terms', (_, res) => res.sendFile(path.join(PUBLIC, 'terms.html')));
app.get('/robots.txt', (_, res) => res.type('text').send('User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n'));
app.get('/sitemap.xml', (_, res) => res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>/</loc></url><url><loc>/privacy</loc></url><url><loc>/terms</loc></url></urlset>`));

app.get('*splat', (_, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.listen(PORT, () => console.log(`ClipFlow V1 running on http://localhost:${PORT}`));
