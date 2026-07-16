/**
 * Adds a patient-bound, read-only action to combine 2-3 official laboratory-request PDFs.
 */
(() => {
  'use strict';
  if (window.__hhrExamRequestPrintInjected) return;
  window.__hhrExamRequestPrintInjected = true;

  const ui = globalThis.HhrExamRequestPrintUi;
  if (!ui) return;

  const CONTROL_ID = 'hhr-exam-request-print-control';
  const MODAL_ID = 'hhr-exam-request-print-modal';
  const STYLE_ID = 'hhr-exam-request-print-styles';
  let scheduled = false;

  const sendMessage = message => new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      resolve(error ? { error: error.message } : response || { error: 'Sin respuesta de la extensión.' });
    });
  });

  const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTROL_ID} { display:flex; justify-content:flex-end; margin:8px 0 10px; }
      #${CONTROL_ID} button { border:0; border-radius:10px; padding:8px 13px; background:#157f72; color:#fff; font:600 13px/1.2 system-ui,sans-serif; cursor:pointer; box-shadow:0 2px 6px rgba(21,127,114,.22); }
      #${CONTROL_ID} button:hover { background:#116c62; }
      #${CONTROL_ID} button:disabled { cursor:not-allowed; opacity:.55; }
      #${MODAL_ID} { position:fixed; inset:0; z-index:2147483646; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(15,23,42,.48); font-family:system-ui,sans-serif; }
      #${MODAL_ID} .hhr-exam-card { width:min(620px,calc(100vw - 32px)); max-height:calc(100vh - 40px); overflow:auto; border-radius:16px; background:#fff; box-shadow:0 24px 70px rgba(15,23,42,.28); color:#17202a; }
      #${MODAL_ID} .hhr-exam-head { padding:20px 22px 14px; border-bottom:1px solid #e6eceb; }
      #${MODAL_ID} h2 { margin:0 0 5px; font-size:20px; }
      #${MODAL_ID} p { margin:0; color:#5f6f6d; font-size:13px; line-height:1.45; }
      #${MODAL_ID} .hhr-exam-list { display:grid; gap:9px; padding:16px 22px; }
      #${MODAL_ID} label { display:grid; grid-template-columns:auto 1fr; gap:11px; align-items:start; padding:12px; border:1px solid #dbe5e3; border-radius:11px; cursor:pointer; }
      #${MODAL_ID} label:has(input:checked) { border-color:#2b9b8c; background:#f0faf8; }
      #${MODAL_ID} input { width:18px; height:18px; accent-color:#157f72; }
      #${MODAL_ID} strong { display:block; font-size:14px; }
      #${MODAL_ID} small { display:block; margin-top:3px; color:#60706e; }
      #${MODAL_ID} .hhr-exam-feedback { min-height:20px; padding:0 22px; color:#a23d22; font-size:13px; }
      #${MODAL_ID} .hhr-exam-actions { display:flex; justify-content:flex-end; gap:10px; padding:15px 22px 20px; }
      #${MODAL_ID} button { border:0; border-radius:10px; padding:9px 14px; font:600 13px/1.2 system-ui,sans-serif; cursor:pointer; }
      #${MODAL_ID} .hhr-exam-cancel { background:#edf1f1; color:#374543; }
      #${MODAL_ID} .hhr-exam-submit { background:#157f72; color:#fff; }
      #${MODAL_ID} .hhr-exam-submit:disabled { cursor:not-allowed; opacity:.5; }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const closeModal = () => {
    document.getElementById(MODAL_ID)?.remove();
  };

  const openModal = (encId, requests) => {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hhr-exam-request-title');
    overlay.innerHTML = `
      <section class="hhr-exam-card">
        <div class="hhr-exam-head">
          <h2 id="hhr-exam-request-title">Imprimir solicitud de exámenes</h2>
          <p>Selecciona 2 o 3 órdenes para imprimirlas en una sola solicitud.</p>
        </div>
        <div class="hhr-exam-list"></div>
        <div class="hhr-exam-feedback" role="status"></div>
        <div class="hhr-exam-actions">
          <button type="button" class="hhr-exam-cancel">Cancelar</button>
          <button type="button" class="hhr-exam-submit">Combinar e imprimir</button>
        </div>
      </section>
    `;
    const list = overlay.querySelector('.hhr-exam-list');
    const feedback = overlay.querySelector('.hhr-exam-feedback');
    const submit = overlay.querySelector('.hhr-exam-submit');
    const cancel = overlay.querySelector('.hhr-exam-cancel');
    let pending = false;
    requests.forEach((request, index) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = request.orderId;
      checkbox.checked = index < 3;
      checkbox.setAttribute('aria-label', `Orden ${request.orderId}`);
      const detail = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = `Orden ${request.orderId} · ${request.group}`;
      const date = document.createElement('small');
      date.textContent = request.date ? `Fecha: ${request.date}` : 'Fecha no informada en la tabla';
      detail.append(title, date);
      label.append(checkbox, detail);
      list.appendChild(label);
    });

    const selection = () => Array.from(list.querySelectorAll('input:checked')).map(input => input.value);
    const refresh = () => {
      const result = ui.validateSelection(selection());
      submit.disabled = !result.valid;
      feedback.textContent = result.message;
    };
    list.addEventListener('change', refresh);
    cancel.addEventListener('click', () => {
      if (!pending) overlay.remove();
    });
    overlay.addEventListener('click', event => {
      event.stopPropagation();
      if (event.target === overlay && !pending) overlay.remove();
    });
    overlay.addEventListener('mousedown', event => event.stopPropagation());
    submit.addEventListener('click', async () => {
      const result = ui.validateSelection(selection());
      if (!result.valid) {
        feedback.textContent = result.message;
        return;
      }
      pending = true;
      submit.disabled = true;
      cancel.disabled = true;
      feedback.style.color = '#35645e';
      feedback.textContent = 'Preparando las solicitudes oficiales…';
      const response = await sendMessage({
        type: 'RAYEN_EXAM_REQUEST_COMBINE_PRINT_REQUEST',
        encId,
        diteIds: result.selected,
        requests: requests
          .filter(request => result.selected.includes(request.orderId))
          .map(request => ({ orderId: request.orderId, group: request.group })),
      });
      if (!overlay.isConnected) return;
      if (response && response.ok) {
        feedback.textContent = 'Solicitud abierta en el visor de impresión.';
        overlay.remove();
      } else {
        pending = false;
        feedback.style.color = '#a23d22';
        feedback.textContent = response?.error || 'No se pudo combinar la selección.';
        submit.disabled = false;
        cancel.disabled = false;
      }
    });
    document.body.appendChild(overlay);
    refresh();
  };

  const ensureControl = () => {
    scheduled = false;
    const encId = ui.resolveEncounterId(location.href);
    if (!encId) {
      document.getElementById(CONTROL_ID)?.remove();
      return;
    }
    const table = ui.findExamRequestTable(document);
    if (!table) {
      document.getElementById(CONTROL_ID)?.remove();
      return;
    }
    const requests = ui.collectExamRequests(table);
    let control = document.getElementById(CONTROL_ID);
    if (!control) {
      control = document.createElement('div');
      control.id = CONTROL_ID;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Imprimir selección (2–3 órdenes)';
      button.title = 'Imprimir las órdenes seleccionadas en una solicitud';
      control.appendChild(button);
      table.parentElement?.insertBefore(control, table);
    }
    const button = control.querySelector('button');
    button.disabled = requests.length < 2;
    button.onclick = event => {
      event.stopPropagation();
      openModal(encId, ui.collectExamRequests(table));
    };
  };

  const scheduleControl = () => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(ensureControl, 80);
  };

  const start = () => {
    ensureStyles();
    scheduleControl();
    window.__hhrExamRequestPrintObserver?.disconnect();
    const observer = new MutationObserver(scheduleControl);
    window.__hhrExamRequestPrintObserver = observer;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    window.addEventListener('popstate', scheduleControl);
    window.addEventListener('hhr:fichamedico-locationchange', scheduleControl);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
