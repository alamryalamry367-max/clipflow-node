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
