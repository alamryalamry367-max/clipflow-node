const input = document.getElementById('url');
const btn = document.getElementById('go');
const result = document.getElementById('result');

function show(html, kind = '') {
  result.className = `result ${kind}`;
  result.innerHTML = html;
}

function startDownload() {
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

  setTimeout(() => { window.location.href = `/download?url=${encodeURIComponent(url)}`; }, 120);

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Download video';
  }, 3000);
}

btn.addEventListener('click', startDownload);

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

/* VOOXOR Install App */
(function () {
  let deferredPrompt = null;
  const installButton = document.getElementById("install-app");

  if (!installButton) return;

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async function () {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();

    try {
      await deferredPrompt.userChoice;
    } catch (e) {
      console.warn("Install prompt error:", e);
    }

    deferredPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    installButton.hidden = true;
  });
})();
