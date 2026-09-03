/** Opens Eloisa's patient document modal from the one-shot HHR navigation marker. */
(() => {
  'use strict';
  let url;
  try {
    url = new URL(window.location.href);
  } catch (_error) {
    return;
  }
  const requestId = url.searchParams.get('hhrOpenDocumentManager');
  if (!requestId) return;
  const deadline = Date.now() + 15000;
  let clicked = false;
  const finish = result => {
    url.searchParams.delete('hhrOpenDocumentManager');
    history.replaceState(history.state, '', url.toString());
    chrome.runtime.sendMessage({
      type: 'RAYEN_PATIENT_DOCUMENT_MANAGER_ACK',
      requestId,
      ...result,
    }).catch(() => {});
  };
  const tryOpen = () => {
    const button = document.getElementById('gestor-documental-button');
    const actionable = button instanceof HTMLElement &&
      !button.hasAttribute('disabled') && button.getAttribute('aria-disabled') !== 'true';
    if (!clicked && actionable) {
      button.click();
      clicked = true;
    }
    const modal = document.getElementById('DocumentPatientModal');
    const modalVisible = modal instanceof HTMLElement && modal.getClientRects().length > 0 &&
      modal.getAttribute('aria-hidden') !== 'true';
    if (clicked && modalVisible) return finish({ opened: true });
    if (Date.now() < deadline) setTimeout(tryOpen, 250);
    else finish({ opened: false, error: 'Eloísa no mostró el control del Gestor documental.' });
  };
  tryOpen();
})();
