(() => {
  'use strict';
  const baseMessage = 'السلام عليكم، وصلت لكم من موقع VOOXOR، وأبغى أستفسر عن خدمة تنظيف المنازل والفلل والأسعار. كود خصم VOOXOR: [ VO25 ] — خصم 25%.';
  document.querySelectorAll('[data-wa]').forEach(link => {
    const service = link.dataset.service;
    const message = baseMessage + (service ? '\nالخدمة المطلوبة: ' + service : '');
    link.href = 'https://wa.me/966539930789?text=' + encodeURIComponent(message);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  const button = document.getElementById('copy-code');
  const status = document.getElementById('copy-status');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('VO25');
      status.textContent = 'تم نسخ الكود VO25';
    } catch {
      status.textContent = 'انسخ الكود يدويًا: VO25';
    }
  });
})();
