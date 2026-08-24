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

    if (platform === 'tiktok') {
      downloadArgs.splice(
        downloadArgs.indexOf('--format'),
        4,
        '--format',
        'best'
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

app.get('/robots.txt', (_, res) =>
  res.type('text').send(
    'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n'
  )
);

app.get('/sitemap.xml', (_, res) =>
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://clipflow-node-1.onrender.com/</loc></url>
<url><loc>https://clipflow-node-1.onrender.com/privacy</loc></url>
<url><loc>https://clipflow-node-1.onrender.com/terms</loc></url>
<url><loc>https://clipflow-node-1.onrender.com/dmca</loc></url>
<url><loc>https://clipflow-node-1.onrender.com/tiktok-video-downloader</loc></url>
</urlset>`
  )
);

app.get('*splat', (_, res) =>
  res.sendFile(path.join(PUBLIC, 'index.html'))
);

app.listen(PORT, () =>
  console.log(`ClipFlow V1 running on http://localhost:${PORT}`)
);
