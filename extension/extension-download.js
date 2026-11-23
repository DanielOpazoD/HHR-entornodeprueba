'use strict';
(() => {
  const link = document.querySelector('[data-download]');
  if (!globalThis.chrome?.downloads || !link) return;
  link.addEventListener('click', async event => {
    event.preventDefault();
    const feedback = document.getElementById('download-feedback');
    try {
      await chrome.downloads.download({ url: link.href });
      feedback.textContent = 'Descarga iniciada.';
    } catch {
      feedback.textContent = 'No se pudo iniciar la descarga. Vuelve a intentarlo.';
    }
    feedback.hidden = false;
  });
})();
