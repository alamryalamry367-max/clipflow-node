const input = document.getElementById('url');
const btn = document.getElementById('go');
const result = document.getElementById('result');
const formatBytes = n => !n ? '' : `${(n / 1048576).toFixed(1)} MB`;
function show(html, kind='') { result.className = `result ${kind}`; result.innerHTML = html; }
async function check() {
  const url = input.value.trim();
  if (!url) return show('Paste a URL first.', 'error');
  btn.disabled = true; btn.textContent = 'Checking…'; show('Verifying the media URL…', 'loading');
  try {
    const r = await fetch('/api/resolve', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not verify URL.');
    const size = formatBytes(d.contentLength);
    show(`<div class="success"><strong>Video detected</strong><span>${d.contentType}${size ? ` · ${size}` : ''}</span><a class="download" href="/download?url=${encodeURIComponent(url)}">Download video</a></div>`, 'ok');
  } catch (e) { show(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Check video'; }
}
btn.addEventListener('click', check);
input.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
