const VOOXOR_VISITOR_ID = (() => {
  try {
    const key = 'vooxor_visitor_id';
    let id = localStorage.getItem(key);

    if (!id) {
      id = (crypto.randomUUID
        ? crypto.randomUUID()
        : 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2));

      localStorage.setItem(key, id);
    }

    return id;
  } catch (_) {
    return '';
  }
})();

const input = document.getElementById('url');

/* VOOXOR private analytics client. Sends to your own server, independent of GA4. */
function vooxorTrack(event, extra = {}) {
  try {
    const payload = {
      event,
      page_path: location.pathname,
      page_title: document.title || '',
      referrer: document.referrer || 'direct',
      language: navigator.language || '',
      visitor_id: VOOXOR_VISITOR_ID,
      ...extra
    };
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/vooxor-analytics', blob);
    } else {
      fetch('/api/vooxor-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    }
  } catch (_) {}
}

vooxorTrack('page_view');
const btn = document.getElementById('go');
const result = document.getElementById('result');

function show(html, kind = '') {
  result.className = `result ${kind}`;
  result.innerHTML = html;
}

let deferredPrompt = null;
let installPromptUsed = false;

function getInstallContext() {
  const path = window.location.pathname.toLowerCase();

  let platform = 'home';

  if (path.includes('tiktok')) platform = 'tiktok';
  else if (path.includes('instagram')) platform = 'instagram';
  else if (path.includes('facebook')) platform = 'facebook';
  else if (path.includes('snapchat')) platform = 'snapchat';

  return {
    page_path: window.location.pathname,
    page_title: document.title || '',
    platform: platform,
    referrer: document.referrer || 'direct'
  };
}

window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  deferredPrompt = event;

  const installButton = document.getElementById('install-app');

  if (installButton) {
    installButton.hidden = false;
  }

  vooxorTrack('pwa_install_prompt_available', getInstallContext());

  if (typeof gtag === 'function') {
    gtag('event', 'pwa_install_prompt_available', getInstallContext());
  }
});

window.addEventListener('appinstalled', function () {
  deferredPrompt = null;
  installPromptUsed = true;

  vooxorTrack('pwa_installed', getInstallContext());

  if (typeof gtag === 'function') {
    gtag('event', 'pwa_installed', getInstallContext());
  }

  const installButton = document.getElementById('install-app');

  if (installButton) {
    installButton.hidden = true;
  }
});

async function maybePromptInstall() {
  if (!deferredPrompt || installPromptUsed) return;

  installPromptUsed = true;

  vooxorTrack('pwa_install_prompt_shown', getInstallContext());

  if (typeof gtag === 'function') {
    gtag('event', 'pwa_install_prompt_shown', getInstallContext());
  }

  try {
    deferredPrompt.prompt();

    const choice = await deferredPrompt.userChoice;

    if (typeof gtag === 'function') {
      vooxorTrack('pwa_install_prompt_result', {
        ...getInstallContext(),
        outcome: choice.outcome
      });

      gtag('event', 'pwa_install_prompt_result', {
        ...getInstallContext(),
        outcome: choice.outcome
      });
    }
  } catch (e) {
    console.warn('Install prompt error:', e);

    if (typeof gtag === 'function') {
      vooxorTrack('pwa_install_prompt_error', {
        ...getInstallContext(),
        outcome: 'error'
      });

      gtag('event', 'pwa_install_prompt_error', {
        ...getInstallContext(),
        error: 'prompt_error'
      });
    }
  }

  deferredPrompt = null;

  const installButton = document.getElementById('install-app');

  if (installButton) {
    installButton.hidden = true;
  }
}

const installButton = document.getElementById('install-app');

if (installButton) {
  installButton.addEventListener('click', async function () {
    await maybePromptInstall();
  });
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
  } catch (_) {}

  gtag('event', 'download_click', {
    platform: platform
  });

  vooxorTrack('download_click', { platform });
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
