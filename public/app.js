const input = document.getElementById('url');
const btn = document.getElementById('go');
const result = document.getElementById('result');

function show(html, kind = '') {
  result.className = `result ${kind}`;
  result.innerHTML = html;
}

let deferredPrompt = null;
let installPromptUsed = false;

window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  deferredPrompt = event;

  const installButton = document.getElementById('install-app');
  if (installButton) {
    installButton.hidden = false;
  }
});

window.addEventListener('appinstalled', function () {
  deferredPrompt = null;
  installPromptUsed = true;

  const installButton = document.getElementById('install-app');
  if (installButton) {
    installButton.hidden = true;
  }
});

async function maybePromptInstall() {
  if (!deferredPrompt || installPromptUsed) return;

  installPromptUsed = true;

  try {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
  } catch (e) {
    console.warn('Install prompt error:', e);
  }

  deferredPrompt = null;

  const installButton = document.getElementById('install-app');
  if (installButton) {
    installButton.hidden = true;
  }
}

async function startDownload() {
  const url = input.value.trim();

  if (!url) {
    show('Paste a video URL first.', 'error');
    input.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Preparing download…';

  show(
    '<div class="loading">Preparing your download…</div>',
    'loading'
  );

  await maybePromptInstall();

  setTimeout(() => {
    window.location.href = `/download?url=${encodeURIComponent(url)}`;
  }, 120);

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Download video';
  }, 3000);
}

btn.addEventListener('click', startDownload);

btn.addEventListener('click', function () {
  if (typeof gtag !== 'function') return;

  let platform = 'unknown';
  try {
    const host = new URL(input.value.trim()).hostname.toLowerCase();
    if (host.includes('tiktok')) platform = 'tiktok';
    else if (host.includes('instagram')) platform = 'instagram';
    else if (host.includes('facebook') || host.includes('fb.watch')) platform = 'facebook';
    else if (host.includes('snapchat')) platform = 'snapchat';
    else if (host.includes('youtube') || host.includes('youtu.be')) platform = 'youtube';
  } catch (_) {}

  gtag('event', 'download_click', {
    platform: platform
  });
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    startDownload();
  }
});

const pasteBtn = document.getElementById('paste');

if (pasteBtn) {
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();

      if (text && text.trim()) {
        input.value = text.trim();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (err) {
      // Clipboard permission unavailable.
      // User can paste manually into the focused input.
    }

    input.focus();
  });
}


/* VOOXOR Service Worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function (error) {
      console.warn("Service Worker registration failed:", error);
    });
  });
}
