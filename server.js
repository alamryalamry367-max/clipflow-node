const express = require('express');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const { spawn } = require('child_process');

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
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 || a >= 224;
  }

  if (net.isIP(ip) === 6) {
    const x = ip.toLowerCase();
    return x === '::1' || x.startsWith('fc') ||
      x.startsWith('fd') || x.startsWith('fe80:');
  }

  return true;
}

async function validateRemoteUrl(value) {
  let u;

  try {
    u = new URL(value);
  } catch {
    throw new Error('Enter a valid URL.');
  }

  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  if (u.username || u.password) {
    throw new Error('Credential URLs are not allowed.');
  }

  const host = u.hostname.toLowerCase();

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error('Private or local network URLs are not allowed.');
    }
  } else {
    const records = await dns.lookup(host, { all: true });

    if (!records.length || records.some(r => isPrivateIp(r.address))) {
      throw new Error('This host is not allowed.');
    }
  }

  return u;
}

function detectPlatform(value) {
  let host;

  try {
    host = new URL(value)
      .hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return 'unknown';
  }

  if (
    host === 'youtube.com' ||
    host === 'youtu.be' ||
    host.endsWith('.youtube.com')
  ) return 'youtube';

  if (
    host === 'tiktok.com' ||
    host.endsWith('.tiktok.com')
  ) return 'tiktok';

  if (
    host === 'instagram.com' ||
    host.endsWith('.instagram.com')
  ) return 'instagram';

  if (
    host === 'facebook.com' ||
    host === 'fb.watch' ||
    host.endsWith('.facebook.com')
  ) return 'facebook';

  if (
    host === 'snapchat.com' ||
    host.endsWith('.snapchat.com')
  ) return 'snapchat';

  return 'other';
}

async function normalizeTikTokUrl(value) {
  const u = new URL(value);
  const host = u.hostname.toLowerCase();

  if (host !== 'm.tiktok.com' || !/^\/v\/\d+\.html$/i.test(u.pathname)) {
    return value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const oembedUrl = new URL('https://www.tiktok.com/oembed');
    oembedUrl.searchParams.set('url', value);

    const response = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOOXOR/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`TikTok oEmbed returned HTTP ${response.status}.`);
    }

    const data = await response.json();

    if (!data.author_unique_id) {
      throw new Error('TikTok oEmbed did not return the author ID.');
    }

    const videoId = u.pathname.match(/^\/v\/(\d+)\.html$/i)[1];

    return `https://www.tiktok.com/@${data.author_unique_id}/video/${videoId}`;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTikTokViaSSSTik(value) {
  const inputUrl = await normalizeTikTokUrl(value);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36',
    'Accept-Language': 'ar-SA,ar;q=0.9,en;q=0.8'
  };

  const home = await fetch('https://ssstik.io/ar', {
    headers,
    signal: AbortSignal.timeout(20000)
  });

  if (!home.ok) {
    throw new Error(`SSSTik homepage returned HTTP ${home.status}.`);
  }

  const homeHtml = await home.text();

  const tokenMatch =
    homeHtml.match(/s_tt\s*=\s*['"]([^'"]+)/i) ||
    homeHtml.match(/name=["']s_tt["'][^>]*value=["']([^"']+)/i) ||
    homeHtml.match(/value=["']([^"']+)["'][^>]*name=["']s_tt["']/i);

  if (!tokenMatch) {
    throw new Error('SSSTik token was not found.');
  }

  const form = new URLSearchParams({
    id: inputUrl,
    locale: 'ar',
    tt: tokenMatch[1]
  });

  const result = await fetch('https://ssstik.io/abc?url=dl', {
    method: 'POST',
    headers: {
      ...headers,
      'Referer': 'https://ssstik.io/ar',
      'Origin': 'https://ssstik.io',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form,
    signal: AbortSignal.timeout(30000)
  });

  if (!result.ok) {
    throw new Error(`SSSTik resolver returned HTTP ${result.status}.`);
  }

  const html = await result.text();

  const links = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)]
    .map(m => m[1].replace(/&amp;/g, '&'));

  const videoUrl = links.find(link =>
    /https:\/\/tikcdn\.io\/ssstik\/\d+\?/i.test(link)
  );

  if (!videoUrl) {
    throw new Error('SSSTik did not return a video download URL.');
  }

  return {
    sourceUrl: inputUrl,
    videoUrl
  };
}

function runYtDlp(url, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', [
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      ...args,
      url
    ]);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'yt-dlp could not process this URL.'));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

app.post('/api/resolve', async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'Paste a URL first.' });
  }

  try {
    await validateRemoteUrl(url);

    const platform = detectPlatform(url);

    if (platform === 'tiktok') {
      const normalizedUrl = await normalizeTikTokUrl(url);
      const meta = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(normalizedUrl)}`,
        {
          headers: {
            'User-Agent': 'VOOXOR/1.0'
          },
          signal: AbortSignal.timeout(15000)
        }
      );

      if (!meta.ok) {
        throw new Error(`TikTok metadata returned HTTP ${meta.status}.`);
      }

      const data = await meta.json();

      return res.json({
        ok: true,
        platform,
        title: data.title || 'TikTok Video',
        contentType: 'video/mp4',
        contentLength: null
      });
    }

    const resolveArgs = ['--get-title'];

    if (platform === 'youtube') {
      resolveArgs.push(
        '--extractor-args',
        'youtube:player_client=mweb',
        '--extractor-args',
        'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416'
      );
    }

    const title = await runYtDlp(url, resolveArgs);

    res.json({
      ok: true,
      platform,
      title: title || 'Video',
      contentType: 'video/mp4',
      contentLength: null
    });

  } catch (e) {
    res.status(400).json({
      error: e.message || 'Could not process this video.'
    });
  }
});

app.get('/download', async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).send('Invalid URL');
  }

  let tempDir = null;
  let child = null;

  try {
    await validateRemoteUrl(url);

    const platform = detectPlatform(url);

    if (platform === 'tiktok') {
      const resolved = await resolveTikTokViaSSSTik(url);

      const upstream = await fetch(resolved.videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36',
          'Referer': 'https://ssstik.io/'
        },
        signal: AbortSignal.timeout(60000)
      });

      if (!upstream.ok || !upstream.body) {
        throw new Error(`TikTok video provider returned HTTP ${upstream.status}.`);
      }

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="clipflow-tiktok.mp4"'
      );

      if (upstream.headers.get('content-length')) {
        res.setHeader('Content-Length', upstream.headers.get('content-length'));
      }

      for await (const chunk of upstream.body) {
        if (res.destroyed) break;
        res.write(Buffer.from(chunk));
      }

      if (!res.destroyed) {
        res.end();
      }

      return;
    }

    const safeName =
      platform === 'tiktok' ? 'clipflow-tiktok.mp4' :
      platform === 'instagram' ? 'clipflow-instagram.mp4' :
      platform === 'facebook' ? 'clipflow-facebook.mp4' :
      platform === 'snapchat' ? 'clipflow-snapchat.mp4' :
      platform === 'youtube' ? 'clipflow-youtube.mp4' :
      'clipflow-video.mp4';

    const fs = require('fs');
    const os = require('os');

    const baseTempDir = path.join(__dirname, 'temp-downloads');
    await fs.promises.mkdir(baseTempDir, { recursive: true });

    tempDir = await fs.promises.mkdtemp(
      path.join(baseTempDir, 'clipflow-')
    );

    const outputTemplate = path.join(tempDir, 'video.%(ext)s');

    const downloadArgs = [
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--format',
      'bestvideo*+bestaudio/best',
      '--merge-output-format',
      'mp4',
      '--output',
      outputTemplate
    ];

    if (platform === 'youtube') {
      downloadArgs.push(
        '--extractor-args',
        'youtube:player_client=mweb',
        '--extractor-args',
        'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416'
      );
    }

    child = spawn('yt-dlp', [...downloadArgs, url]);

    let errorText = '';

    child.stderr.on('data', chunk => {
      errorText += chunk.toString();
    });

    child.on('error', err => {
      if (!res.headersSent) {
        res.status(500).send(err.message);
      }
    });

    child.on('close', async code => {
      try {
        if (code !== 0) {
          if (!res.headersSent) {
            res.status(502).send(
              errorText.trim() || 'Download failed.'
            );
          }
          return;
        }

        const files = await fs.promises.readdir(tempDir);
        const videoFile = files.find(file => file.endsWith('.mp4'));

        if (!videoFile) {
          if (!res.headersSent) {
            res.status(502).send('Could not create MP4 video.');
          }
          return;
        }

        const videoPath = path.join(tempDir, videoFile);
        const stat = await fs.promises.stat(videoPath);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${safeName}"`
        );
        res.setHeader('Content-Length', stat.size);

        const stream = fs.createReadStream(videoPath);

        stream.on('error', err => {
          if (!res.destroyed) res.destroy(err);
        });

        stream.on('close', async () => {
          try {
            await fs.promises.rm(tempDir, {
              recursive: true,
              force: true
            });
          } catch {}
        });

        stream.pipe(res);

      } catch (err) {
        if (!res.headersSent) {
          res.status(500).send(
            err.message || 'Download failed.'
          );
        }
      }
    });

    req.on('close', () => {
      if (child && !child.killed && !res.writableEnded) {
        child.kill('SIGTERM');
      }
    });

  } catch (e) {
    if (tempDir) {
      try {
        const fs = require('fs');
        await fs.promises.rm(tempDir, {
          recursive: true,
          force: true
        });
      } catch {}
    }

    if (!res.headersSent) {
      res.status(400).send(
        e.message || 'Download failed.'
      );
    }
  }
});

app.get('/debug/ytdlp', async (_, res) => {
  const { spawn } = require('child_process');

  const child = spawn('yt-dlp', [
    '-v',
    '--simulate',
    '--get-title',
    '--extractor-args',
    'youtube:player_client=mweb',
    '--extractor-args',
    'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
    'https://www.youtube.com/watch?v=qYYozfEtv_E'
  ]);

  let output = '';
  child.stdout.on('data', d => output += d.toString());
  child.stderr.on('data', d => output += d.toString());

  child.on('close', code => {
    const lines = output.split('\n').filter(line =>
      line.includes('PO Token') ||
      line.includes('bgutil') ||
      line.includes('Generating a') ||
      line.includes('Retrieved a') ||
      line.includes('403') ||
      line.includes('ERROR')
    );

    res.json({ code, lines });
  });
});

app.get('/debug/bgutil', async (_, res) => {
  try {
    const r = await fetch('http://127.0.0.1:4416/ping');
    const text = await r.text();
    res.json({ ok: r.ok, status: r.status, response: text });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/privacy', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'privacy.html'))
);

app.get('/terms', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'terms.html'))
);

app.get('/dmca', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'dmca.html'))
);

app.get('/tiktok-video-downloader', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'tiktok-video-downloader.html'))
);

app.get('/ar/', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'ar', 'index.html'))
);

app.get('*splat', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'index.html'))
);

app.listen(PORT, () =>
  console.log(`VOOXOR running on http://localhost:${PORT}`)
);
