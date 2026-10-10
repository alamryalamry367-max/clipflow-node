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
      let title = 'TikTok Video';
      // Metadata is optional; /download still validates and downloads the video.
      try {
        const normalizedUrl = await normalizeTikTokUrl(url);
        const meta = await fetch(
          `https://www.tiktok.com/oembed?url=${encodeURIComponent(normalizedUrl)}`,
          {
            headers: {
              'User-Agent': 'VOOXOR/1.0'
            },
            signal: AbortSignal.timeout(5000)
          }
        );
  
        if (!meta.ok) {
          throw new Error(`TikTok metadata returned HTTP ${meta.status}.`);
        }
  
        const data = await meta.json();
        title = typeof data.title === 'string' && data.title.trim() ? data.title : title;
      } catch (_) {
        console.warn('TikTok title unavailable; continuing to the existing download route.');
      }

      return res.json({
        ok: true,
        platform,
        title,
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


// VOOXOR YouTube: local yt-dlp metadata extraction.
const youtubeLookupTimes = new Map();

app.get('/api/youtube/info', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (now - (youtubeLookupTimes.get(ip) || 0) < 5000) {
    return res.status(429).json({error:'Please wait 5 seconds.'});
  }
  youtubeLookupTimes.set(ip, now);

  if (youtubeLookupTimes.size > 3000) {
    for (const [key, time] of youtubeLookupTimes) {
      if (now - time > 60000) youtubeLookupTimes.delete(key);
    }
  }

  let u;
  try {
    u = new URL(String(req.query.url || ''));
  } catch {
    return res.status(400).json({error:'Invalid YouTube URL'});
  }

  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== 'https:' ||
    !['youtube.com','www.youtube.com','m.youtube.com','youtu.be',
      'www.youtu.be','youtube-nocookie.com',
      'www.youtube-nocookie.com'].includes(host) ||
    u.href.length > 500
  ) {
    return res.status(400).json({error:'Use a public YouTube HTTPS link.'});
  }

  const {execFile} = require('node:child_process');

  execFile('yt-dlp', [
    '--no-playlist',
    '--skip-download',
    '--no-warnings',
    '--dump-single-json',
    '--',
    u.href
  ], {
    timeout: 35000,
    maxBuffer: 2 * 1024 * 1024
  }, (error, stdout) => {
    if (res.destroyed) return;

    if (error) {
      return res.status(502).json({
        error:'Unable to extract this YouTube video'
      });
    }

    try {
      const data = JSON.parse(stdout);

      return res.set('Cache-Control','no-store').json({
        title:String(data.title || 'YouTube video').slice(0,250),
        author:String(data.uploader || '').slice(0,120),
        thumbnail:typeof data.thumbnail === 'string' &&
          data.thumbnail.startsWith('https://')
          ? data.thumbnail : null,
        videoUrl:null,
        videoId:String(data.id || '').slice(0,30),
        platform:'YouTube'
      });
    } catch {
      return res.status(502).json({
        error:'Invalid video metadata'
      });
    }
  });
});

// VOOXOR YouTube direct MP4 download
let youtubeVideoActive = 0;
const youtubeVideoQueue = [];
const YOUTUBE_MAX_ACTIVE = 1;
const YOUTUBE_MAX_WAITING = 3;
const YOUTUBE_WAIT_TIMEOUT = 60000;

function releaseYoutubeSlot() {
  youtubeVideoActive--;

  while (youtubeVideoQueue.length) {
    const job = youtubeVideoQueue.shift();
    if (job.cancelled) continue;

    clearTimeout(job.timer);
    job.res.off('close', job.onClose);

    youtubeVideoActive++;
    job.resolve(true);
    break;
  }
}

function acquireYoutubeSlot(res) {
  if (youtubeVideoActive < YOUTUBE_MAX_ACTIVE &&
      youtubeVideoQueue.length === 0) {
    youtubeVideoActive++;
    return Promise.resolve(true);
  }

  if (youtubeVideoQueue.length >= YOUTUBE_MAX_WAITING) {
    res.setHeader('Retry-After', '15');
    res.status(503).send('Download queue full');
    return Promise.resolve(false);
  }

  return new Promise(resolve => {
    const job = {
      res,
      resolve,
      cancelled: false,
      timer: null,
      onClose: null
    };

    const cancel = () => {
      if (job.cancelled) return;
      job.cancelled = true;
      clearTimeout(job.timer);
      const index = youtubeVideoQueue.indexOf(job);
      if (index !== -1) youtubeVideoQueue.splice(index, 1);
      resolve(false);
    };

    job.onClose = cancel;
    res.once('close', job.onClose);

    job.timer = setTimeout(() => {
      res.off('close', job.onClose);
      cancel();
      if (!res.destroyed && !res.headersSent) {
        res.status(503).send('Download queue timeout');
      }
    }, YOUTUBE_WAIT_TIMEOUT);

    youtubeVideoQueue.push(job);
  });
}

// YouTube MP4: bounded temporary download and merge.
app.get('/api/youtube/download', async (req, res) => {
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');

  const id = String(req.query.id || '');

  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).send('Invalid video ID');
  }

  const slotAcquired = await acquireYoutubeSlot(res);
  if (!slotAcquired) return;

  let dir = null;
  let child = null;
  let stream = null;
  let stopped = false;
  let timer = null;
  let diskMonitor = null;
  let diskLimitExceeded = false;

  const stop = () => {
    stopped = true;
    if (child && child.pid && child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (_) {}
    }
    if (stream) stream.destroy();
  };

  res.once('close', stop);

  try {
    if (res.destroyed) return;

    dir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'vooxor-yt-')
    );

    const output = path.join(dir, 'video.%(ext)s');

    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--max-filesize', '50M',
      '--socket-timeout', '15',
      '--retries', '2',
      '--fragment-retries', '2',
      '-f',
      'b[ext=mp4][filesize<50M]/' +
      'bv[ext=mp4][filesize<50M]+' +
      'ba[ext=m4a]',
      '--merge-output-format', 'mp4',
      '-o', output,
      '--',
      'https://www.youtube.com/watch?v=' + id
    ];

    const result = await new Promise(resolve => {
      child = spawn('yt-dlp', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true
      });

      let finished = false;
      const finish = code => {
        if (finished) return;
        finished = true;
        resolve(code);
      };

      child.stderr.on('data', () => {});

      // Monitor total temporary disk usage, including partial files.
      let checkingDisk = false;
      diskMonitor = setInterval(async () => {
        if (checkingDisk || finished || !dir) return;
        checkingDisk = true;
        try {
          const entries = await fsp.readdir(dir, {
            recursive: true,
            withFileTypes: true
          });
          let total = 0;
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const filePath = path.join(entry.parentPath, entry.name);
            const stat = await fsp.stat(filePath).catch(() => null);
            if (stat) total += stat.size;
          }
          if (total > 120 * 1024 * 1024) {
            diskLimitExceeded = true;
            if (child && child.pid && child.exitCode === null) {
              try { process.kill(-child.pid, 'SIGKILL'); }
              catch (_) {}
            }
          }
        } catch (_) {
          // Files may disappear while yt-dlp is merging.
        } finally {
          checkingDisk = false;
        }
      }, 1000);

      child.on('error', () => finish(-1));
      child.on('close', code => finish(code));

      timer = setTimeout(() => {
        if (child && child.pid && child.exitCode === null) {
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch (_) {}
        }
        // Wait for the child close event before cleanup.
        // The close handler will release the waiting request.
      }, 90000);
    });

    clearTimeout(timer);
    timer = null;
    if (diskMonitor) clearInterval(diskMonitor);
    diskMonitor = null;

    if (stopped || res.destroyed) return;
    if (diskLimitExceeded) {
      return res.status(413).send('Temporary download size exceeded');
    }

    if (result !== 0) {
      return res.status(502).send(
        'Unable to prepare MP4 video'
      );
    }

    const file = path.join(dir, 'video.mp4');
    const stat = await fsp.stat(file);

    if (stat.size > 50 * 1024 * 1024) {
      return res.status(413).send('Video too large');
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="VOOXOR-video.mp4"'
    );
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-store');

    const { pipeline } = require('node:stream/promises');
    stream = fs.createReadStream(file);
    await pipeline(stream, res);

  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      res.status(502).send('Video download failed');
    } else if (!res.destroyed) {
      res.destroy();
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (diskMonitor) clearInterval(diskMonitor);
    res.off('close', stop);
    if (child && child.pid && child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (_) {}
    }
    if (dir) {
      await fsp.rm(dir, {
        recursive: true,
        force: true
      }).catch(() => {});
    }
    releaseYoutubeSlot();
  }
});

app.all('/api/youtube/audio', (req, res) => {
  res.status(404).json({ error: 'Audio downloads are disabled' });
});

app.get('/youtube-video-downloader', (_,res) => res.sendFile(path.join(PUBLIC,'youtube-video-downloader','index.html')));

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
)
app.get('/instagram-video-downloader', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'instagram-video-downloader.html'))
)
app.get('/snapchat-video-downloader', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'snapchat-video-downloader.html'))
)
;

app.get('/facebook-video-downloader', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'facebook-video-downloader.html'))
);

app.get('/ar/snapchat-story-downloader', (_, res) =>
  res.redirect(301, '/ar/snapchat-spotlight-downloader')
);

app.get('/ar/snapchat-spotlight-downloader', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'ar', 'snapchat-spotlight-downloader.html'))
);

app.get('/ar/', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'ar', 'index.html'))
);

app.get('/yandex_ba35d0e8892cda11.html', (_, res) => res.sendFile(path.join(PUBLIC, 'yandex_ba35d0e8892cda11.html')));
app.get('*splat', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'index.html'))
);

app.listen(PORT, () =>
  console.log(`VOOXOR running on http://localhost:${PORT}`)
);
