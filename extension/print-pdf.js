(() => {
  'use strict';

  const status = document.getElementById('status');
  const jobId = new URLSearchParams(location.search).get('job');
  const storageKey = jobId ? `hhr-pdf-print-${jobId}` : '';

  const fail = message => {
    if (status) status.textContent = message;
  };

  if (!storageKey) {
    fail('No se encontró la receta solicitada. Cierra esta pestaña y vuelve a intentarlo.');
    return;
  }

  chrome.storage.session.get(storageKey).then(result => {
    const job = result && result[storageKey];
    if (!job || !job.base64) {
      fail('La receta ya no está disponible. Cierra esta pestaña y vuelve a intentarlo.');
      return;
    }
    const binary = atob(job.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    chrome.storage.session.remove(storageKey).catch(() => {});
    location.replace(pdfUrl);
  }).catch(error => {
    fail('No se pudo abrir la receta: ' + String((error && error.message) || error));
  });
})();
