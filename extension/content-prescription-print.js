/**
 * content-prescription-print.js (ISOLATED world)
 *
 * Adds a global, extensible HHR operations entry point across Ficha Médico. Prescription and
 * indications shortcuts remain contextual to the nursing medication view. The panel asks the
 * service worker for official Eloisa reports and verified nursing workflows. Clinical writes are
 * delegated to the service worker and shown as synchronized only after a read-back succeeds.
 */
(() => {
  'use strict';

  const helper = globalThis.HhrPrescriptionPrint;
  const labHelper = globalThis.HhrLabViewer;
  const ui = globalThis.HhrUI;
  const vitalsHelper = globalThis.HhrVitals;
  const requestForms = globalThis.HhrRequestForms;
  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  if (!helper || !ui || !runtimeMessages || globalThis.__hhrPrescriptionPrintInjected) return;
  globalThis.__hhrPrescriptionPrintInjected = true;

  const BUTTON_ID = 'hhr-prescription-print-button';
  const INDICATIONS_BUTTON_ID = 'hhr-indications-print-button';
  const OPERATIONS_BAR_ID = 'hhr-clinical-operations-bar';
  const MODAL_ID = 'hhr-prescription-print-modal';
  const STYLE_ID = 'hhr-prescription-print-styles';
  const NOTICE_HOST_ID = 'hhr-clinical-page-notices';
  const NOTICE_STYLE_ID = 'hhr-clinical-page-notice-styles';
  const LAB_MAX_SELECTED_EXAMS = 24;
  const uncertainClinicalWrites = new Map();

  const getActiveUncertainWrite = key => uncertainClinicalWrites.get(key) || null;

  const normalizedText = value =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const currentRouteEncounterId = () => helper.resolveEncounterId(window.location.href) || '';
  const EPICRISIS_MENU_ITEM_ID = 'hhr-corrected-discharge-print';
  const epicrisisCaptureWaiters = new Map();
  const syslabLoginFrameHandlers = new WeakMap();
  let activeEpicrisisPrintReqId = '';
  let lastDischargePatientRun = '';

  const runFromText = value => {
    const match = String(value || '').match(/RUN\s*:?\s*([0-9.\-Kk]+)/i);
    return match ? match[1].trim() : '';
  };

  const runFromPatientRow = row => {
    if (!row) return '';
    const labeledRun = Array.from(row.querySelectorAll('[aria-label]')).find(element =>
      /^RUN\s*:?/i.test(String(element.textContent || '').trim())
    );
    if (labeledRun) return String(labeledRun.getAttribute('aria-label') || '').trim();
    const visibleRun = Array.from(row.querySelectorAll('p,span,div')).find(element =>
      /^RUN\s*:?/i.test(String(element.textContent || '').trim())
    );
    return runFromText(visibleRun ? visibleRun.textContent : row.textContent);
  };

  const encounterIdFromPatientRow = row => {
    if (!row) return '';
    const link = Array.from(row.querySelectorAll('a[href]')).find(anchor =>
      /\/dashboard\/encounter-list(?:-nurse)?(?:\/|\?)/.test(String(anchor.getAttribute('href') || ''))
    );
    if (!link) return '';
    const direct = String(link.getAttribute('href') || '').match(
      /\/dashboard\/encounter-list(?:-nurse)?\/(\d+)(?:[/?#]|$)/
    );
    return direct ? direct[1] : helper.resolveEncounterId(link.href) || '';
  };

  // Eloísa renders the action menu in a portal, outside the patient row. Remember the RUN when
  // the user opens a row action so the captured PDF can later be bound to that patient.
  const rememberDischargePatientFromEvent = event => {
    const target = event.target instanceof Element ? event.target : null;
    const row = target && target.closest('tr,[role="row"]');
    if (!row) return;
    lastDischargePatientRun = runFromPatientRow(row);
  };
  document.addEventListener('click', rememberDischargePatientFromEvent, true);
  document.addEventListener('focusin', rememberDischargePatientFromEvent, true);

  const dischargePatientFromOpenMenu = () => {
    const expandedActions = Array.from(
      document.querySelectorAll('button[aria-expanded="true"],[role="button"][aria-expanded="true"]')
    );
    for (const action of expandedActions) {
      const row = action.closest('tr,[role="row"]');
      if (row) {
        return {
          found: true,
          patientRun: runFromPatientRow(row),
          encounterId: encounterIdFromPatientRow(row),
        };
      }
    }
    return { found: false, patientRun: '', encounterId: '' };
  };

  const setCorrectedDischargeItemLabel = (item, label) => {
    const labelNode = item.querySelector(
      '.MuiListItemText-primary,.MuiListItemText-root span,p'
    );
    if (labelNode) labelNode.textContent = label;
    else item.textContent = label;
  };

  const ensurePageNoticeHost = () => {
    let host = document.getElementById(NOTICE_HOST_ID);
    if (host) return host;
    if (!document.getElementById(NOTICE_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = NOTICE_STYLE_ID;
      style.textContent = `
      #${NOTICE_HOST_ID} { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; display: grid; gap: 8px; width: min(390px,calc(100vw - 36px)); font-family: Arial,sans-serif; }
      #${NOTICE_HOST_ID} .hhr-page-notice { padding: 11px 13px; border: 1px solid #d8e3e0; border-left: 4px solid #15968b; border-radius: 9px; background: #fff; color: #263633; box-shadow: 0 10px 30px rgba(7,27,49,.22); font-size: 13px; line-height: 1.4; }
      #${NOTICE_HOST_ID} .hhr-page-notice.is-error { border-left-color: #c74a43; background: #fff8f7; }
      #${NOTICE_HOST_ID} .hhr-page-notice strong { display: block; margin-bottom: 3px; font-size: 13.5px; }
      #${NOTICE_HOST_ID} .hhr-page-notice > span { white-space: pre-line; }
      #${NOTICE_HOST_ID} .hhr-page-notice-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
      #${NOTICE_HOST_ID} button { min-height: 31px; padding: 5px 11px; border: 1px solid #cbd7d4; border-radius: 7px; background: #fff; color: #3b4b48; cursor: pointer; font: inherit; font-weight: 600; }
      #${NOTICE_HOST_ID} button.is-primary { border-color: #15968b; background: #15968b; color: #fff; }
    `;
      document.head.appendChild(style);
    }
    host = document.createElement('div');
    host.id = NOTICE_HOST_ID;
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  };

  const showPageNotice = (message, { title = 'Centro HHR', error = false, duration = 6500 } = {}) => {
    const host = ensurePageNoticeHost();
    const notice = document.createElement('div');
    notice.className = 'hhr-page-notice' + (error ? ' is-error' : '');
    notice.setAttribute('role', error ? 'alert' : 'status');
    const heading = document.createElement('strong');
    heading.textContent = title;
    const text = document.createElement('span');
    text.textContent = String(message || '');
    notice.append(heading, text);
    host.appendChild(notice);
    if (duration > 0) window.setTimeout(() => notice.remove(), duration);
    return notice;
  };

  const requestPageConfirmation = ({ title, message, confirmLabel = 'Confirmar' }) =>
    new Promise(resolve => {
      const notice = showPageNotice(message, { title, duration: 0 });
      notice.setAttribute('role', 'dialog');
      notice.setAttribute('aria-modal', 'false');
      const actions = document.createElement('div');
      actions.className = 'hhr-page-notice-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancelar';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'is-primary';
      confirm.textContent = confirmLabel;
      const finish = value => {
        notice.remove();
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      actions.append(cancel, confirm);
      notice.appendChild(actions);
      confirm.focus();
    });

  window.addEventListener('message', event => {
    const handler = event.source && syslabLoginFrameHandlers.get(event.source);
    if (!handler) return;
    let extensionOrigin = '';
    try {
      extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
    } catch (_error) {
      return;
    }
    const data = event.data || {};
    if (event.origin !== extensionOrigin || data.type !== 'HHR_SYSLAB_LOGIN_STATE') return;
    handler(data);
  });

  window.addEventListener('message', event => {
    if (event.source !== window || (event.origin && event.origin !== window.location.origin)) return;
    const data = event.data || {};
    if (data.type !== 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT') return;
    const resolve = epicrisisCaptureWaiters.get(String(data.reqId || ''));
    if (!resolve) return;
    epicrisisCaptureWaiters.delete(String(data.reqId || ''));
    resolve(data);
  });

  const waitForEpicrisisCapture = reqId => new Promise(resolve => {
    const timeout = window.setTimeout(() => {
      if (!epicrisisCaptureWaiters.has(reqId)) return;
      epicrisisCaptureWaiters.delete(reqId);
      resolve({ error: 'Eloísa no generó el PDF de alta dentro del tiempo esperado.' });
    }, 32_000);
    epicrisisCaptureWaiters.set(reqId, result => {
      window.clearTimeout(timeout);
      resolve(result || { error: 'No se recibió el PDF de alta.' });
    });
  });

  const findNativeDischargePrintItems = () => Array.from(
    document.querySelectorAll('button,[role="menuitem"]')
  ).filter(element =>
    normalizedText(element.textContent) === 'imprimir alta medica' &&
    element.dataset.hhrCorrectedDischargePrint !== 'true'
  );

  const requestCorrectedDischargePrint = async (nativeItem, item) => {
    if (activeEpicrisisPrintReqId) return;
    const openMenuPatient = dischargePatientFromOpenMenu();
    const expectedPatientRun = openMenuPatient.found
      ? openMenuPatient.patientRun
      : lastDischargePatientRun;
    if (!expectedPatientRun) {
      showPageNotice(
        'No se pudo identificar al paciente de esta alta. Cierra el menú, vuelve a abrirlo desde su fila y reintenta.',
        { title: 'Alta corregida', error: true }
      );
      return;
    }
    const reqId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'epicrisis-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    lastDischargePatientRun = expectedPatientRun;
    activeEpicrisisPrintReqId = reqId;
    setCorrectedDischargeItemLabel(item, 'Preparando alta corregida…');
    item.setAttribute('aria-busy', 'true');
    item.setAttribute('aria-disabled', 'true');
    item.style.pointerEvents = 'none';
    const captured = waitForEpicrisisCapture(reqId);
    window.postMessage({
      type: 'RAYEN_EPICRISIS_PDF_CAPTURE_ARM',
      reqId,
      patientRun: expectedPatientRun,
    }, window.location.origin);
    try {
      nativeItem.click();
      const result = await captured;
      if (result.error) throw new Error(result.error);
      const response = await sendMessage({
        type: runtimeMessages.EPICRISIS_CORRECTED_PRINT_REQUEST,
        pdfBase64: String(result.pdfBase64 || ''),
        patientRun: expectedPatientRun,
      });
      if (!response || response.error) throw new Error(String(response && response.error || 'No se pudo preparar el alta corregida.'));
    } catch (error) {
      showPageNotice(
        String((error && error.message) || error || 'No se pudo preparar el alta corregida.'),
        { title: 'Alta corregida', error: true }
      );
    } finally {
      window.postMessage({ type: 'RAYEN_EPICRISIS_PDF_CAPTURE_CANCEL', reqId }, window.location.origin);
      if (activeEpicrisisPrintReqId === reqId) activeEpicrisisPrintReqId = '';
      setCorrectedDischargeItemLabel(item, 'Imprimir alta corregida');
      item.removeAttribute('aria-busy');
      item.removeAttribute('aria-disabled');
      item.style.pointerEvents = '';
    }
  };

  const ensureCorrectedDischargePrintItems = () => {
    findNativeDischargePrintItems().forEach(nativeItem => {
      const nextItem = nativeItem.nextElementSibling;
      if (nextItem && nextItem.dataset.hhrCorrectedDischargePrint === 'true') return;
      const item = nativeItem.cloneNode(true);
      item.removeAttribute('id');
      if (!document.getElementById(EPICRISIS_MENU_ITEM_ID)) item.id = EPICRISIS_MENU_ITEM_ID;
      item.dataset.hhrCorrectedDischargePrint = 'true';
      item.removeAttribute('data-state');
      setCorrectedDischargeItemLabel(item, 'Imprimir alta corregida');
      item.setAttribute('aria-label', 'Imprimir alta médica con receta en página nueva');
      item.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void requestCorrectedDischargePrint(nativeItem, item);
      });
      nativeItem.insertAdjacentElement('afterend', item);
    });
  };

  const nursingMedicalEpicrisisMenu = () => Array.from(document.querySelectorAll(
    '[role="menu"],[class*="MuiMenu-paper"],[class*="MuiPopover-paper"]'
  )).find(menu => {
    if (menu.hidden || menu.getAttribute('aria-hidden') === 'true') return false;
    return Array.from(menu.querySelectorAll('button,[role="menuitem"]')).some(action => {
      const label = normalizedText(action.textContent);
      return label.includes('alta') && /(revertir|imprimir|epicrisis)/.test(label);
    });
  }) || null;

  const requestNursingMedicalEpicrisisPrint = async item => {
    if (activeEpicrisisPrintReqId) return;
    const openMenuPatient = dischargePatientFromOpenMenu();
    const patientRun = openMenuPatient.patientRun;
    const encounterId = openMenuPatient.encounterId;
    const expectedRun = String(item.dataset.hhrPatientRun || '');
    const expectedEncounterId = String(item.dataset.hhrEncounterId || '');
    const contextChanged = !openMenuPatient.found || !patientRun || patientRun !== expectedRun ||
      (expectedEncounterId && encounterId !== expectedEncounterId);
    if (contextChanged) {
      showPageNotice(
        'No se pudo identificar al paciente de esta alta. Cierra el menú y vuelve a abrirlo desde su fila.',
        { title: 'Epicrisis médica', error: true }
      );
      return;
    }
    activeEpicrisisPrintReqId = 'nursing-epicrisis-' + Date.now();
    setCorrectedDischargeItemLabel(item, 'Preparando epicrisis médica…');
    item.setAttribute('aria-busy', 'true');
    item.setAttribute('aria-disabled', 'true');
    item.style.pointerEvents = 'none';
    try {
      const response = await sendMessage({
        type: runtimeMessages.NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST,
        encId: encounterId,
        patientRun,
      });
      if (!response || response.error) {
        throw new Error(String(response && response.error || 'No se pudo imprimir la epicrisis médica.'));
      }
    } catch (error) {
      showPageNotice(
        String((error && error.message) || error || 'No se pudo imprimir la epicrisis médica.'),
        { title: 'Epicrisis médica', error: true }
      );
    } finally {
      activeEpicrisisPrintReqId = '';
      setCorrectedDischargeItemLabel(item, 'Imprimir epicrisis médica');
      item.removeAttribute('aria-busy');
      item.removeAttribute('aria-disabled');
      item.style.pointerEvents = '';
    }
  };

  const ensureNursingMedicalEpicrisisPrintItem = nursingContext => {
    if (!nursingContext || !/\?tab=3(?:&|$)/.test(window.location.search || '?tab=3')) return;
    const patientContext = dischargePatientFromOpenMenu();
    if (!patientContext.found || !patientContext.patientRun) return;
    const menu = nursingMedicalEpicrisisMenu();
    if (!menu || menu.querySelector('[data-hhr-nursing-medical-epicrisis="true"]')) return;
    const template = menu.querySelector('button,[role="menuitem"]');
    if (!template) return;
    const item = template.cloneNode(true);
    item.removeAttribute('id');
    item.dataset.hhrNursingMedicalEpicrisis = 'true';
    item.dataset.hhrPatientRun = patientContext.patientRun;
    item.dataset.hhrEncounterId = patientContext.encounterId;
    item.removeAttribute('data-state');
    setCorrectedDischargeItemLabel(item, 'Imprimir epicrisis médica');
    item.setAttribute('aria-label', 'Imprimir epicrisis médica corregida');
    const iconHost = item.querySelector('.MuiListItemIcon-root,[class*="MuiListItemIcon"]');
    if (iconHost) {
      iconHost.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 8V3h12v5h1a3 3 0 0 1 3 3v6h-4v4H6v-4H2v-6a3 3 0 0 1 3-3h1Zm2-3v3h8V5H8Zm0 10v4h8v-4H8Zm10-2h2v-2a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v2h2v-1h12v1Z"/></svg>';
    }
    item.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void requestNursingMedicalEpicrisisPrint(item);
    });
    menu.appendChild(item);
  };

  // Combines the free-text search with an optional service <select> (shown only when the
  // census spans more than one service). Rows expose data-search and data-service.
  const attachPatientListFilter = ({ toolbar, search, list, services }) => {
    const unique = Array.from(new Set((services || []).filter(Boolean))).sort();
    let serviceFilter = null;
    if (unique.length > 1) {
      serviceFilter = document.createElement('select');
      serviceFilter.className = 'hhr-rx-filter';
      serviceFilter.setAttribute('aria-label', 'Filtrar por servicio');
      const all = document.createElement('option');
      all.value = '';
      all.textContent = 'Todos los servicios';
      serviceFilter.appendChild(all);
      unique.forEach(service => {
        const option = document.createElement('option');
        option.value = normalizedText(service);
        option.textContent = service;
        serviceFilter.appendChild(option);
      });
      search.insertAdjacentElement('afterend', serviceFilter);
    }
    const apply = () => {
      const query = normalizedText(search.value);
      const service = serviceFilter ? serviceFilter.value : '';
      Array.from(list.children).forEach(row => {
        const matchesQuery = !query || String(row.dataset.search || '').includes(query);
        const matchesService = !service || String(row.dataset.service || '') === service;
        row.hidden = !(matchesQuery && matchesService);
      });
    };
    search.addEventListener('input', apply);
    if (serviceFilter) serviceFilter.addEventListener('change', apply);
    return apply;
  };

  try {
    document.documentElement.setAttribute(
      'data-hhr-prescription-print-script',
      chrome.runtime.getManifest().version
    );
  } catch (_error) {}

  const retryableMessageTypes = new Set([
    runtimeMessages.PRESCRIPTION_OPTIONS_REQUEST,
    runtimeMessages.HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST,
    runtimeMessages.SCALES_REPORT_REQUEST,
    runtimeMessages.PATIENT_HEADER_REQUEST,
    runtimeMessages.CENSUS_LIST_REQUEST,
    runtimeMessages.VITALS_CENSUS_REQUEST,
  ]);
  const isTransientMessageChannelError = value =>
    /message channel closed|receiving end does not exist|asynchronous response|extension context invalidated/i
      .test(String(value || ''));
  const friendlyTransportMessage = (error, isClinicalWrite) => {
    const raw = String((error && error.message) || error || 'La extensión no respondió.');
    if (!isTransientMessageChannelError(raw)) return raw;
    return isClinicalWrite
      ? 'Se perdió la conexión con la extensión durante el guardado. Verifica el dato visible antes de reintentar.'
      : 'Se perdió temporalmente la conexión mientras se preparaban los datos. Reintenta; no se imprimió ni modificó información.';
  };

  const sendMessage = message =>
    new Promise(resolve => {
      const isClinicalWrite = message && (
        message.type === runtimeMessages.HANDOFF_SAVE_REQUEST ||
        message.type === runtimeMessages.SCORE_SAVE_REQUEST
      );
      const transportFailure = error => ({
        error: friendlyTransportMessage(error, isClinicalWrite),
        ...(isClinicalWrite ? { writeMayHaveSucceeded: true } : {}),
      });
      const mayRetry = retryableMessageTypes.has(String(message && message.type || ''));
      const attempt = retryCount => {
        try {
          chrome.runtime.sendMessage(message, response => {
            const error = chrome.runtime.lastError;
            const rawError = String(error && error.message || error || '');
            if (error && mayRetry && retryCount < 1 && isTransientMessageChannelError(rawError)) {
              window.setTimeout(() => attempt(retryCount + 1), 180);
              return;
            }
            resolve(error ? transportFailure(error) : response || transportFailure('La extensión no respondió.'));
          });
        } catch (error) {
          if (mayRetry && retryCount < 1 && isTransientMessageChannelError(error && error.message)) {
            window.setTimeout(() => attempt(retryCount + 1), 180);
            return;
          }
          resolve(transportFailure(error));
        }
      };
      attempt(0);
    });

  const acknowledgeClinicalWrite = receipt =>
    new Promise(resolve => {
      if (!receipt || !receipt.key || !receipt.generationId || !receipt.receiptId) {
        resolve({ error: 'Eloísa no entregó un acuse local verificable para este guardado.' });
        return;
      }
      try {
        chrome.runtime.sendMessage({
          type: runtimeMessages.CLINICAL_WRITE_ACK,
          key: receipt.key,
          generationId: receipt.generationId,
          receiptId: receipt.receiptId,
        }, response => {
          const error = chrome.runtime.lastError;
          resolve(error
            ? { error: String(error.message || error) }
            : response && response.ok ? { ok: true } : {
                error: String(response && response.error || 'La extensión no confirmó el acuse local.'),
              });
        });
      } catch (error) {
        resolve({ error: String((error && error.message) || error) });
      }
    });

  const hydrateClinicalWriteProtection = (key, protection) => {
    if (!protection || typeof protection !== 'object') {
      uncertainClinicalWrites.delete(key);
      return null;
    }
    const marker = {
      state: String(protection.state || 'ambiguous'),
      generationId: String(protection.generationId || ''),
      receiptId: String(protection.receiptId || ''),
      startedAt: Number(protection.createdAt || Date.now()),
      error: String(protection.error || 'Revisa el último dato visible antes de liberar la protección.'),
      displayObservation: '',
      observation: '',
    };
    uncertainClinicalWrites.set(key, marker);
    return marker;
  };

  const formatClinicalRecoveryReview = review => {
    if (!review || typeof review !== 'object') return 'Eloísa no informó un registro vigente.';
    if (review.kind === 'handoff') {
      return [
        'Última entrega leída ahora:',
        review.present ? String(review.value || 'Sin texto') : 'Sin entrega registrada',
        'Fecha: ' + (review.dateTime ? helper.formatDateTimeLabel(review.dateTime) : 'Sin fecha'),
        'Profesional: ' + String(review.author || 'No informado'),
      ].join('\n');
    }
    return [
      String(review.instrument || 'Score') + ' leído ahora:',
      review.present ? 'Valor: ' + String(review.value || '—') : 'Sin aplicación registrada',
      review.classification ? 'Clasificación: ' + String(review.classification) : '',
      'Fecha: ' + (review.dateTime ? helper.formatDateTimeLabel(review.dateTime) : 'Sin fecha'),
      'Profesional: ' + String(review.author || 'No informado'),
    ].filter(Boolean).join('\n');
  };

  const releaseClinicalWriteProtection = async (key, protection) => {
    const preview = await sendMessage({
      type: runtimeMessages.CLINICAL_WRITE_RECOVERY_REQUEST,
      key,
      generationId: protection && protection.generationId,
      phase: 'preview',
    });
    if (!preview || preview.error) return preview;
    const recoveryPreview = preview.recoveryPreview || {};
    if (!recoveryPreview.challenge || !recoveryPreview.review) {
      return { error: 'Eloísa no devolvió una lectura fresca verificable; la protección se mantuvo.' };
    }
    const confirmed = await requestPageConfirmation({
      title: 'Revisión del último guardado',
      message: 'Eloísa se consultó nuevamente.\n\n' +
        formatClinicalRecoveryReview(recoveryPreview.review) +
        '\n\nLibera la protección solo si este resultado coincide con lo que registraste.',
      confirmLabel: 'Revisado, liberar',
    });
    if (!confirmed) return { cancelled: true };
    return sendMessage({
      type: runtimeMessages.CLINICAL_WRITE_RECOVERY_REQUEST,
      key,
      generationId: protection && protection.generationId,
      phase: 'confirm',
      ['recoveryToken']: recoveryPreview.challenge,
    });
  };

  const clinicalWriteRecoveryReady = protection =>
    Boolean(protection && Date.now() - Number(protection.createdAt || 0) >= 60 * 1000);

  const normalizedClinicalText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const clinicalWriteKey = (kind, encId, instrument = '') => {
    const parts = [kind, String(encId || '')];
    if (instrument) parts.push(String(instrument).toUpperCase());
    return parts.join(':');
  };

  const getClinicalGuard = root => {
    if (!root.__hhrClinicalGuard) {
      root.__hhrClinicalGuard = {
        dirty: new Set(),
        pending: new Set(),
        uncertain: new Set(),
        confirming: false,
      };
    }
    return root.__hhrClinicalGuard;
  };

  const setClinicalGuardState = (root, state, key, active) => {
    const bucket = getClinicalGuard(root)[state];
    if (active) bucket.add(key);
    else bucket.delete(key);
  };

  const runClinicalTransition = (root, action, { allowUncertain = false } = {}) => {
    const guard = getClinicalGuard(root);
    if (guard.pending.size) {
      setRouteChangeState(root, 'Guardado clínico en curso · espera su confirmación', 'uncertain');
      showPageNotice('Espera a que Eloísa confirme el guardado antes de cambiar de módulo.', {
        title: 'Guardado en curso',
      });
      return false;
    }
    if (guard.dirty.size) {
      if (guard.confirming) return false;
      guard.confirming = true;
      void requestPageConfirmation({
        title: 'Cambios sin guardar',
        message: 'Hay cambios clínicos sin guardar. ¿Quieres descartarlos y continuar?',
        confirmLabel: 'Descartar y continuar',
      }).then(confirmed => {
        guard.confirming = false;
        if (!confirmed || guard.pending.size) return;
        guard.dirty.clear();
        showPageNotice('Los cambios que no se habían guardado fueron descartados.', {
          title: 'Cambio de módulo',
        });
        if (root.isConnected) action();
      });
      return false;
    }
    if (!allowUncertain && guard.uncertain.size) {
      showPageNotice(
        'El resultado de un guardado aún no pudo verificarse. Puedes continuar: la protección contra duplicados se mantiene activa.',
        { title: 'Verificación pendiente' }
      );
    }
    action();
    return true;
  };

  const focusableElements = root => Array.from(root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
      'a[href], [tabindex]:not([tabindex="-1"])'
  )).filter(element => element.getAttribute('aria-hidden') !== 'true' &&
    (element.offsetParent !== null || element === document.activeElement));

  const trapModalFocus = (root, event) => {
    if (event.key !== 'Tab') return;
    const focusables = focusableElements(root);
    if (!focusables.length) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const setLiveRegion = (element, text, state = '') => {
    const isError = state === 'error' || state === 'uncertain';
    element.setAttribute('role', isError ? 'alert' : 'status');
    element.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    element.setAttribute('aria-atomic', 'true');
    element.textContent = text;
  };

  const setRouteChangeState = (root, text, state = '') => {
    const notice = root && root.querySelector('.hhr-route-change-state');
    if (!notice) return;
    notice.className = 'hhr-route-change-state' + (state ? ' is-' + state : '');
    setLiveRegion(notice, text, state);
  };

  const finishRouteChangeWrite = (root, state) => {
    if (!root || root.dataset.routeStale !== 'true') return;
    if (getClinicalGuard(root).pending.size) {
      setRouteChangeState(root, 'Episodio cambió · esperando confirmación del guardado');
      return;
    }
    if (state === 'synced') {
      setRouteChangeState(root, 'Episodio cambió · guardado confirmado', 'synced');
    } else if (state === 'uncertain') {
      setRouteChangeState(root, 'Episodio cambió · guardado no verificado', 'uncertain');
    } else {
      setRouteChangeState(root, 'Episodio cambió · guardado falló', 'error');
    }
  };

  const freezeClinicalModalForEncounterChange = root => {
    if (!root || root.dataset.routeStale === 'true') return;
    root.dataset.routeStale = 'true';
    const close = root.querySelector('.hhr-rx-close');
    const blockStaleInteraction = event => {
      if (close && (event.target === close || close.contains(event.target))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'focusin' && close) close.focus();
    };
    ['click', 'input', 'change', 'submit', 'focusin'].forEach(type =>
      root.addEventListener(type, blockStaleInteraction, true)
    );
    const header = root.querySelector('.hhr-center-header');
    if (header) {
      const notice = document.createElement('span');
      notice.className = 'hhr-route-change-state';
      header.appendChild(notice);
      setRouteChangeState(root, 'Episodio cambió · esperando confirmación del guardado');
    }
    if (close) close.focus();
  };

  const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID}, #${INDICATIONS_BUTTON_ID} {
        appearance: none; background: transparent; border: 0; border-radius: 50%; color: #777;
        cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
        width: 38px; height: 38px; margin-left: 6px; padding: 7px; vertical-align: middle;
      }
      #${BUTTON_ID}:hover, #${INDICATIONS_BUTTON_ID}:hover { background: rgba(0,0,0,.06); color: #555; }
      #${BUTTON_ID}:focus-visible, #${INDICATIONS_BUTTON_ID}:focus-visible {
        outline: 3px solid rgba(20,151,139,.32); outline-offset: 1px;
      }
      #${BUTTON_ID} svg, #${INDICATIONS_BUTTON_ID} svg { width: 25px; height: 25px; fill: currentColor; }
      ${ui.tokenRule('#' + MODAL_ID)}
      #${MODAL_ID} { position: fixed; inset: 0; z-index: 2147483646; font-family: var(--hhr-font); }
      #${MODAL_ID} [hidden] { display: none !important; }
      #${MODAL_ID} ::-webkit-scrollbar { width: 10px; height: 10px; }
      #${MODAL_ID} ::-webkit-scrollbar-track { background: transparent; }
      #${MODAL_ID} ::-webkit-scrollbar-thumb {
        background: #c8d4d1; border: 3px solid transparent; background-clip: content-box; border-radius: 999px;
      }
      #${MODAL_ID} ::-webkit-scrollbar-thumb:hover { background-color: #a9bab5; }
      #${MODAL_ID} .hhr-rx-backdrop {
        position: absolute; inset: 0; background: rgba(7,27,49,.44);
        backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
      }
      #${MODAL_ID} .hhr-rx-dialog {
        position: relative; width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 20px);
        margin: max(10px, 2vh) auto; background: #fff; border-radius: 14px; overflow: hidden;
        box-shadow: 0 24px 70px rgba(7,27,49,.30), 0 2px 8px rgba(7,27,49,.10);
        color: var(--hhr-ink-900); display: flex; flex-direction: column;
      }
      #${MODAL_ID} .hhr-rx-header { padding: 12px 16px 8px; border-bottom: 1px solid #e7ecea; }
      #${MODAL_ID} .hhr-rx-title { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.2; color: var(--hhr-ink-900); letter-spacing: -.01em; }
      #${MODAL_ID} .hhr-rx-subtitle { margin: 3px 0 0; color: var(--hhr-ink-500); font-size: 12px; line-height: 1.35; }
      #${MODAL_ID} .hhr-rx-close {
        position: absolute; top: 8px; right: 9px; width: 34px; height: 34px; border: 0;
        border-radius: 50%; background: transparent; color: #6b7478; cursor: pointer; font-size: 24px;
        transition: background-color .15s ease, color .15s ease;
      }
      #${MODAL_ID} .hhr-rx-close:hover { background: #eef2f1; color: #3c4a48; }
      #${MODAL_ID} .hhr-rx-close:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-rx-tabs { display: flex; gap: 4px; margin-top: 8px; padding: 3px; background: #f0f4f3; border-radius: 9px; }
      #${MODAL_ID} .hhr-rx-tab {
        flex: 1; min-height: 29px; border: 0; border-radius: 7px; background: transparent; color: #5c686c;
        cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 550;
      }
      #${MODAL_ID} .hhr-rx-tab[aria-selected="true"] { background: #fff; color: var(--hhr-teal-ink); font-weight: 650; box-shadow: 0 1px 4px rgba(16,42,67,.14); }
      #${MODAL_ID} .hhr-rx-tab:disabled { cursor: not-allowed; opacity: .42; }
      #${MODAL_ID} .hhr-rx-tab:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-rx-tab-minor { flex: 0 0 auto; padding: 0 11px; color: #7b8785; font-size: 11.5px; font-weight: 500; }
      #${MODAL_ID} .hhr-rx-tab-minor[aria-selected="true"] { color: var(--hhr-teal-ink); font-weight: 650; }
      #${MODAL_ID} .hhr-rx-dialog-compact { width: min(480px, calc(100vw - 24px)); }
      #${MODAL_ID} .hhr-rx-body { padding: 8px 16px 12px; overflow: auto; min-height: 120px; }
      #${MODAL_ID} .hhr-rx-status { color: var(--hhr-ink-500); font-size: 12.5px; padding: 16px 0; text-align: center; }
      #${MODAL_ID} .hhr-rx-print-feedback {
        margin: 0 0 10px; padding: 9px 12px; border: 0; border-left: 3px solid var(--hhr-green-600);
        border-radius: 6px; background: #ecf8f3; color: #1d6a52; font-size: 12.5px; line-height: 1.45; text-align: left;
      }
      #${MODAL_ID} .hhr-rx-error {
        margin: 0 0 10px; padding: 10px 12px; border: 0; border-left: 3px solid var(--hhr-red-600);
        border-radius: 6px; background: #fdf1f0; color: var(--hhr-red-ink); font-size: 12.5px; line-height: 1.45;
      }
      #${MODAL_ID} .hhr-rx-patient-context {
        display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 8px;
        padding: 8px 11px; border: 1px solid #dbe8e5; border-radius: 9px; background: #f6fbfa;
      }
      #${MODAL_ID} .hhr-rx-patient-context strong { color: var(--hhr-ink-900); font-size: 13px; font-weight: 650; }
      #${MODAL_ID} .hhr-rx-patient-context span { color: var(--hhr-ink-500); font-size: 11.5px; line-height: 1.3; }
      #${MODAL_ID} .hhr-rx-sync-note {
        margin: 0 0 7px; padding: 6px 10px; border-left: 3px solid var(--hhr-amber-600); border-radius: 6px;
        background: #fff8e8; color: #6f5716; font-size: 11.5px; line-height: 1.35;
      }
      #${MODAL_ID} .hhr-rx-list { display: grid; gap: 6px; }
      #${MODAL_ID} .hhr-rx-option {
        display: grid; grid-template-columns: 18px 1fr; gap: 8px; align-items: start; cursor: pointer;
        border: 1px solid #e0e7e5; border-radius: 9px; padding: 8px 11px; background: #fff;
        transition: border-color .15s ease, background-color .15s ease;
      }
      #${MODAL_ID} .hhr-rx-option:hover { border-color: #9fd0ca; background: #f7fbfa; }
      #${MODAL_ID} .hhr-rx-option:has(input:checked) { border-color: var(--hhr-teal-500); background: #effaf7; }
      #${MODAL_ID} .hhr-rx-option.is-disabled { cursor: not-allowed; opacity: .62; background: #f7f8f8; }
      #${MODAL_ID} input[type="radio"], #${MODAL_ID} input[type="checkbox"] { width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--hhr-teal-500); }
      #${MODAL_ID} .hhr-rx-format-title {
        margin: 12px 0 5px; font-size: 10.5px; font-weight: 700; color: #5d6b68;
        text-transform: uppercase; letter-spacing: .05em;
      }
      #${MODAL_ID} .hhr-rx-list > .hhr-rx-format-title { margin: 5px 0 0; }
      #${MODAL_ID} .hhr-rx-formats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      #${MODAL_ID} .hhr-rx-format-option {
        display: grid; grid-template-columns: 18px 1fr; gap: 7px; align-items: start; cursor: pointer;
        border: 1px solid #e0e7e5; border-radius: 9px; padding: 8px 10px; background: #fff;
        transition: border-color .15s ease, background-color .15s ease;
      }
      #${MODAL_ID} .hhr-rx-format-option:hover { border-color: #9fd0ca; }
      #${MODAL_ID} .hhr-rx-format-option:has(input:checked) { border-color: var(--hhr-teal-500); background: #effaf7; }
      #${MODAL_ID} .hhr-rx-date { display: block; font-size: 13px; font-weight: 550; line-height: 1.25; color: var(--hhr-ink-900); }
      #${MODAL_ID} .hhr-rx-meta { display: block; margin-top: 2px; color: var(--hhr-ink-500); font-size: 11.5px; line-height: 1.3; }
      #${MODAL_ID} .hhr-rx-bulk-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
      #${MODAL_ID} .hhr-rx-search {
        flex: 1; min-width: 0; height: 36px; border: 1px solid #cfd7d8; border-radius: 8px; padding: 0 11px;
        color: #30383b; background: #fff; font: inherit; font-size: 13px;
      }
      #${MODAL_ID} .hhr-rx-search:focus { border-color: #15978b; outline: 3px solid rgba(21,151,139,.14); }
      #${MODAL_ID} .hhr-rx-filter {
        flex: 0 0 auto; max-width: 190px; height: 36px; border: 1px solid #cfd7d8; border-radius: 8px;
        padding: 0 8px; color: #3a4649; background: #fff; font: inherit; font-size: 12.5px; cursor: pointer;
      }
      #${MODAL_ID} .hhr-rx-filter:focus { border-color: #15978b; outline: 3px solid rgba(21,151,139,.14); }
      #${MODAL_ID} .hhr-rx-mini-action {
        border: 0; border-radius: 7px; background: transparent; color: var(--hhr-teal-ink); cursor: pointer;
        padding: 7px 8px; font: inherit; font-size: 12.5px; font-weight: 550; white-space: nowrap;
        transition: background-color .15s ease;
      }
      #${MODAL_ID} .hhr-rx-mini-action:hover { background: var(--hhr-teal-050); }
      #${MODAL_ID} .hhr-rx-mini-action:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-rx-selection-summary { display: flex; justify-content: space-between; gap: 12px; margin: 2px 0 8px; color: #5d696d; font-size: 12px; }
      #${MODAL_ID} .hhr-rx-patient-list { display: block; border: 1px solid #dde3e4; border-radius: 10px; background: #fff; overflow: hidden; }
      #${MODAL_ID} .hhr-rx-patient {
        display: grid; grid-template-columns: 20px minmax(0,1fr) auto auto; gap: 10px; align-items: center;
        border-bottom: 1px solid #eef2f1; padding: 7px 12px; background: #fff; cursor: pointer;
      }
      #${MODAL_ID} .hhr-rx-patient:last-child { border-bottom: 0; }
      #${MODAL_ID} .hhr-rx-patient:hover { background: #f7fbfa; }
      #${MODAL_ID} .hhr-rx-patient:has(input:checked) { background: #effaf7; box-shadow: inset 3px 0 0 #15978b; }
      #${MODAL_ID} .hhr-rx-patient.is-disabled { cursor: default; background: #fafbfb; opacity: .62; }
      #${MODAL_ID} .hhr-rx-patient.hhr-rx-patient-summary { grid-template-columns: minmax(0,1fr) auto; cursor: default; }
      #${MODAL_ID} .hhr-rx-patient.hhr-rx-patient-summary:hover { background: #fff; }
      #${MODAL_ID} .hhr-rx-patient-selection { min-width: 0; cursor: pointer; }
      #${MODAL_ID} .hhr-rx-open-patient {
        border: 1px solid #b8d9d4; background: #f4fbf9; padding: 5px 9px; font-size: 11.5px;
      }
      #${MODAL_ID} .hhr-rx-patient-details { display: grid; gap: 1px; min-width: 0; }
      #${MODAL_ID} .hhr-rx-patient-title {
        display: flex; align-items: baseline; gap: 7px; min-width: 0; white-space: nowrap; overflow: hidden;
        font-size: 12.5px; font-weight: 600; color: #30383b;
      }
      #${MODAL_ID} .hhr-rx-name { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
      #${MODAL_ID} .hhr-rx-bed {
        flex: 0 0 auto; border-radius: 6px; padding: 1px 6px; color: #0b7c72; background: #e7f5f2;
        font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
      }
      #${MODAL_ID} .hhr-rx-badge { flex: 0 0 auto; border-radius: 999px; padding: 1px 7px; color: #117f75; background: #dff4f0; font-size: 10px; font-weight: 600; }
      #${MODAL_ID} .hhr-rx-patient-title .hhr-rx-meta { flex: 0 1 auto; margin: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 400; }
      #${MODAL_ID} .hhr-rx-prescribers {
        display: block; min-width: 0; color: #5c6a68; font-size: 11px; line-height: 1.35;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #${MODAL_ID} .hhr-rx-patient-stats { display: grid; justify-items: end; gap: 2px; white-space: nowrap; }
      #${MODAL_ID} .hhr-rx-med-count { border-radius: 999px; padding: 2px 8px; color: #117f75; background: #dff4f0; font-size: 10.5px; font-weight: 700; }
      #${MODAL_ID} .hhr-rx-stat-time { color: #7c8886; font-size: 10px; }
      #${MODAL_ID} .hhr-rx-braden-line { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 1px; color: #536064; font-size: 11px; min-width: 0; }
      #${MODAL_ID} .hhr-rx-braden-score { border-radius: 999px; padding: 1px 7px; color: #725400; background: #fff1bd; font-size: 10.5px; font-weight: 700; }
      #${MODAL_ID} .hhr-rx-braden-missing { color: #7b8589; font-style: italic; }
      #${MODAL_ID} .hhr-rx-footer {
        padding: 10px 16px; border-top: 1px solid #e7ecea; display: flex;
        justify-content: flex-end; gap: 9px; background: #fafcfb;
      }
      #${MODAL_ID} .hhr-rx-action {
        border-radius: 8px; min-height: 38px; padding: 7px 16px; font: inherit; font-size: 13px;
        font-weight: 550; cursor: pointer; border: 1px solid #ccd6d3; background: #fff; color: #3e4a48;
        transition: border-color .15s ease, background-color .15s ease, color .15s ease;
      }
      #${MODAL_ID} .hhr-rx-action:hover { border-color: #9fc9c3; color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-rx-action:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-rx-action-primary { background: var(--hhr-teal-500); border-color: var(--hhr-teal-500); color: #fff; font-weight: 650; }
      #${MODAL_ID} .hhr-rx-action-primary:hover { background: #0f857a; border-color: #0f857a; color: #fff; }
      #${MODAL_ID} .hhr-rx-action:disabled { cursor: not-allowed; opacity: .55; }
      #${MODAL_ID} .hhr-center-dialog {
        width: min(1380px, calc(100vw - 28px)); height: min(790px, calc(100vh - 28px));
        max-height: calc(100vh - 28px); margin: 14px auto; border-radius: 13px;
      }
      #${MODAL_ID} .hhr-center-header {
        min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 56px 0 16px;
        border-bottom: 1px solid #e2e8e6; background: #fff;
      }
      #${MODAL_ID} .hhr-center-header img { width: 24px; height: 22px; object-fit: contain; }
      #${MODAL_ID} .hhr-center-header strong { color: var(--hhr-ink-900); font-size: 15.5px; font-weight: 650; letter-spacing: -.01em; }
      #${MODAL_ID} .hhr-center-regimen-print { margin-left: auto; min-height: 30px; font-size: 11px; }
      #${MODAL_ID} .hhr-center-patientbar {
        position: relative; display: flex; align-items: center; gap: 9px; min-height: 40px;
        padding: 5px 16px; border-bottom: 1px solid #e2e8e6; background: #f6faf9;
      }
      #${MODAL_ID} .hhr-patientbar-tag {
        flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; background: #dff0ec;
        color: var(--hhr-teal-ink); font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      }
      #${MODAL_ID} .hhr-patientbar-name { color: var(--hhr-ink-900); font-size: 12.5px; font-weight: 650; white-space: nowrap; }
      #${MODAL_ID} .hhr-patientbar-meta { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64716f; font-size: 11px; }
      #${MODAL_ID} .hhr-patientbar-route {
        flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; background: #fff1d6;
        color: var(--hhr-amber-ink); font-size: 10px; font-weight: 700;
      }
      #${MODAL_ID} .hhr-patientbar-change { flex: 0 0 auto; min-height: 28px; font-size: 11px; }
      #${MODAL_ID} .hhr-patientbar-picker {
        position: absolute; top: calc(100% + 4px); right: 12px; z-index: 6; width: min(440px, calc(100% - 24px));
        padding: 9px; border: 1px solid #d8e1de; border-radius: 11px; background: #fff;
        box-shadow: 0 16px 44px rgba(7,27,49,.22);
      }
      #${MODAL_ID} .hhr-patientbar-search { width: 100%; height: 34px; margin-bottom: 7px; }
      #${MODAL_ID} .hhr-patientbar-list { max-height: 300px; overflow: auto; border: 1px solid #e8eeec; border-radius: 8px; }
      #${MODAL_ID} .hhr-patientbar-option {
        display: grid; grid-template-columns: auto minmax(0,1fr); gap: 2px 8px; align-items: center;
        width: 100%; padding: 7px 10px; border: 0; border-bottom: 1px solid #eef2f1; background: #fff;
        color: var(--hhr-ink-900); cursor: pointer; text-align: left; font: inherit;
      }
      #${MODAL_ID} .hhr-patientbar-option:last-child { border-bottom: 0; }
      #${MODAL_ID} .hhr-patientbar-option .hhr-rx-bed { grid-row: 1 / span 2; align-self: center; }
      #${MODAL_ID} .hhr-patientbar-option:hover { background: #f7fbfa; }
      #${MODAL_ID} .hhr-patientbar-option.is-selected { background: #effaf7; box-shadow: inset 3px 0 0 var(--hhr-teal-500); }
      #${MODAL_ID} .hhr-patientbar-option-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${MODAL_ID} .hhr-patientbar-option-meta { grid-column: 2; color: #74807e; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${MODAL_ID} .hhr-patientbar-empty { padding: 18px 10px; color: #697674; text-align: center; font-size: 12px; }
      #${MODAL_ID} .hhr-flow-tabs { flex: 0 0 auto; min-width: 230px; margin: 0; }
      #${MODAL_ID} .hhr-home-section-title {
        margin: 14px 0 8px; color: #55635f; font-size: 10.5px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .05em;
      }
      #${MODAL_ID} .hhr-home-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 10px; }
      #${MODAL_ID} .hhr-home-card {
        display: grid; gap: 5px; justify-items: start; padding: 13px 14px; border: 1px solid #e0e8e6;
        border-radius: 12px; background: #fff; color: var(--hhr-ink-900); cursor: pointer; text-align: left;
        font: inherit; box-shadow: 0 1px 2px rgba(16,42,67,.04);
        transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
      }
      #${MODAL_ID} .hhr-home-card:hover { border-color: #9fd0ca; box-shadow: 0 6px 18px rgba(16,42,67,.10); transform: translateY(-1px); }
      #${MODAL_ID} .hhr-home-card:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(15,147,140,.28); }
      #${MODAL_ID} .hhr-home-card strong { font-size: 13px; font-weight: 650; }
      #${MODAL_ID} .hhr-home-card-icon {
        display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px;
        background: #e8f4f1; color: var(--hhr-teal-ink);
      }
      #${MODAL_ID} .hhr-home-card-icon svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      #${MODAL_ID} .hhr-home-card-desc { color: #6b7876; font-size: 11px; line-height: 1.4; }
      #${MODAL_ID} .hhr-home-card.is-action .hhr-home-card-icon { background: #fff1d6; color: var(--hhr-amber-ink); }
      #${MODAL_ID} .hhr-vitals-trend-card svg { display: block; width: 100%; height: auto; margin-top: 6px; }
      #${MODAL_ID} .hhr-fav-list { display: grid; gap: 6px; margin-bottom: 4px; }
      #${MODAL_ID} .hhr-fav-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px; align-items: center; }
      #${MODAL_ID} .hhr-fav-open {
        display: grid; gap: 1px; min-width: 0; padding: 8px 11px; border: 1px solid #e0e7e5;
        border-radius: 9px; background: #fff; color: var(--hhr-ink-900); cursor: pointer; text-align: left; font: inherit;
        transition: border-color .15s ease, background-color .15s ease;
      }
      #${MODAL_ID} .hhr-fav-open:hover { border-color: #9fd0ca; background: #f7fbfa; }
      #${MODAL_ID} .hhr-fav-open strong { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${MODAL_ID} .hhr-fav-open span { color: #74807e; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${MODAL_ID} .hhr-fav-remove {
        width: 30px; height: 30px; border: 1px solid #e0e7e5; border-radius: 8px; background: #fff;
        color: #8a3d38; cursor: pointer; font-size: 16px; line-height: 1;
      }
      #${MODAL_ID} .hhr-fav-remove:hover { border-color: #e0b3ae; background: #fdf3f2; }
      #${MODAL_ID} .hhr-fav-form { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.4fr) auto; gap: 6px; }
      #${MODAL_ID} .hhr-fav-form .hhr-rx-search { height: 34px; }
      #${MODAL_ID} .hhr-fav-form .hhr-rx-action { min-height: 34px; padding: 5px 13px; }
      #${MODAL_ID} .hhr-route-change-state { margin-left: 12px; padding-right: 26px; color: #8a6714; font-size: 11px; font-weight: 600; }
      #${MODAL_ID} .hhr-route-change-state.is-synced { color: #11766d; }
      #${MODAL_ID} .hhr-route-change-state.is-error,
      #${MODAL_ID} .hhr-route-change-state.is-uncertain { color: #9b2c2c; }
      #${MODAL_ID} .hhr-center-shell { display: grid; grid-template-columns: 92px minmax(0,1fr); min-height: 0; flex: 1; }
      #${MODAL_ID} .hhr-center-nav {
        padding: 9px 7px; border-right: 1px solid #e4eae8; background: #f8fafa; display: flex;
        flex-direction: column; gap: 3px;
      }
      #${MODAL_ID} .hhr-center-nav-session {
        margin-top: auto; min-height: 52px; border-top: 1px solid #e4eae8; border-radius: 0;
        color: #7a8886; font-size: 10px;
      }
      #${MODAL_ID} .hhr-center-nav-session svg { width: 17px; height: 17px; }
      #${MODAL_ID} .hhr-center-nav-session[aria-current="page"] { border-left-color: var(--hhr-teal-500); background: #eef4f2; color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-center-nav-button {
        appearance: none; min-height: 58px; border: 0; border-left: 3px solid transparent; border-radius: 0 8px 8px 0;
        background: transparent; color: #51605d; cursor: pointer; display: grid; place-items: center; align-content: center;
        gap: 4px; font: inherit; font-size: 10.5px; font-weight: 550;
        transition: background-color .15s ease, color .15s ease;
      }
      #${MODAL_ID} .hhr-center-nav-button svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      #${MODAL_ID} .hhr-center-nav-button:hover { background: #ecf5f3; color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-center-nav-button:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-center-nav-button[aria-current="page"] { border-left-color: var(--hhr-teal-500); background: #e8f4f1; color: var(--hhr-teal-ink); font-weight: 700; }
      #${MODAL_ID} .hhr-center-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #fff; position: relative; }
      #${MODAL_ID} .hhr-center-toolbar {
        display: flex; align-items: center; gap: 9px; min-height: 56px; padding: 8px clamp(20px,1.8vw,28px); border-bottom: 1px solid #e6ebe9;
      }
      #${MODAL_ID} .hhr-center-heading { margin: 0 auto 0 0; color: var(--hhr-ink-900); font-size: 15.5px; font-weight: 650; white-space: nowrap; letter-spacing: -.01em; }
      #${MODAL_ID} .hhr-center-search, #${MODAL_ID} .hhr-center-select {
        height: 34px; border: 1px solid #d2dcd9; border-radius: 8px; background: #fff; color: #33403e;
        padding: 0 10px; font: inherit; font-size: 12px;
      }
      #${MODAL_ID} .hhr-center-search { width: min(270px, 24vw); }
      #${MODAL_ID} .hhr-center-search:focus, #${MODAL_ID} .hhr-center-select:focus,
      #${MODAL_ID} .hhr-handoff-input:focus, #${MODAL_ID} .hhr-score-control:focus {
        border-color: var(--hhr-teal-500); outline: none; box-shadow: 0 0 0 3px rgba(15,147,140,.14);
      }
      #${MODAL_ID} .hhr-center-content { min-height: 0; flex: 1; overflow: auto; padding: 14px clamp(20px,1.8vw,28px) 22px; }
      #${MODAL_ID} .hhr-center-notice { margin: 10px 0; padding: 8px 11px; border-left: 3px solid var(--hhr-amber-600); border-radius: 6px; background: #fffaf0; color: #665526; font-size: 11.5px; line-height: 1.4; }
      #${MODAL_ID} .hhr-center-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; color: #36413f; }
      #${MODAL_ID} .hhr-center-table th {
        position: sticky; top: 0; z-index: 1; padding: 7px 8px; border-bottom: 1px solid #d4dedb;
        background: #f6f9f8; color: #55635f; text-align: left; font-size: 10.5px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .04em;
      }
      #${MODAL_ID} .hhr-center-table td { padding: 8px; border-bottom: 1px solid #ebefee; vertical-align: top; overflow-wrap: anywhere; }
      #${MODAL_ID} .hhr-center-table tbody tr:hover { background: #f8fbfa; }
      #${MODAL_ID} .hhr-center-patient { display: block; color: var(--hhr-ink-900); font-weight: 650; }
      #${MODAL_ID} .hhr-center-meta { display: block; margin-top: 2px; color: #74807e; font-size: 10.5px; line-height: 1.35; }
      #${MODAL_ID} .hhr-center-empty { padding: 32px 12px; color: var(--hhr-ink-500); text-align: center; font-size: 12.5px; }
      #${MODAL_ID} .hhr-center-embed { display: flex; flex-direction: column; padding-top: 10px; }
      #${MODAL_ID} .hhr-center-embed .hhr-rx-subtitle { margin: 0 0 8px; }
      #${MODAL_ID} .hhr-center-embed .hhr-rx-body { padding: 0; overflow: visible; min-height: 0; }
      #${MODAL_ID} .hhr-center-toolbar .hhr-rx-tabs { margin: 0 0 0 auto; flex: 0 1 340px; min-width: 240px; }
      #${MODAL_ID} .hhr-recipes-toolbar .hhr-center-heading { margin-right: 0; }
      #${MODAL_ID} .hhr-recipes-toolbar .hhr-rx-module-tabs {
        flex: 0 0 auto; min-width: 0; margin: 0; padding: 2px; background: #eaf3f1;
      }
      #${MODAL_ID} .hhr-recipes-toolbar .hhr-rx-module-tabs .hhr-rx-tab { flex: 0 0 auto; min-height: 27px; padding: 0 12px; font-size: 11.5px; }
      #${MODAL_ID} .hhr-recipes-toolbar .hhr-rx-scope-tabs { margin-left: auto; }
      #${MODAL_ID} .hhr-center-main .hhr-rx-footer { flex: 0 0 auto; }
      #${MODAL_ID} .hhr-handoff-input { width: 100%; min-height: 48px; resize: vertical; box-sizing: border-box; padding: 6px 8px; border: 1px solid #d2dcd9; border-radius: 8px; color: #303a38; background: #fff; font: inherit; font-size: 11.5px; line-height: 1.35; }
      #${MODAL_ID} .hhr-handoff-input:disabled { background: #f5f7f6; color: #818a88; }
      #${MODAL_ID} .hhr-handoff-tools { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; }
      #${MODAL_ID} .hhr-char-count { color: #7a8583; font-size: 10px; }
      #${MODAL_ID} .hhr-row-save {
        min-height: 28px; padding: 4px 11px; border: 1px solid var(--hhr-teal-500); border-radius: 7px;
        background: var(--hhr-teal-500); color: #fff; cursor: pointer; font: inherit; font-size: 11px; font-weight: 650;
        transition: background-color .15s ease;
      }
      #${MODAL_ID} .hhr-row-save:hover { background: #0f857a; }
      #${MODAL_ID} .hhr-row-save:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-row-save:disabled { border-color: #ccd4d2; background: #e8edec; color: #85908e; cursor: not-allowed; }
      #${MODAL_ID} .hhr-handoff-save {
        min-height: 24px; padding: 2px 9px; border-radius: 999px; font-size: 10.5px;
      }
      #${MODAL_ID} .hhr-handoff-diagnosis {
        display: -webkit-box; margin-top: 5px; overflow: hidden; color: #596663; font-size: 10.5px;
        font-weight: 550; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
      }
      #${MODAL_ID} .hhr-protection-action { display: block; margin-top: 6px; padding-inline: 7px; white-space: nowrap; }
      #${MODAL_ID} .hhr-sync-state { display: inline-flex; align-items: flex-start; gap: 5px; color: #687572; font-size: 11px; line-height: 1.35; }
      #${MODAL_ID} .hhr-sync-state::before { content: ''; width: 7px; height: 7px; margin-top: 3px; border-radius: 50%; background: #a9b3b1; flex: 0 0 auto; }
      #${MODAL_ID} .hhr-sync-state.is-synced { color: #157650; font-weight: 600; }
      #${MODAL_ID} .hhr-sync-state.is-synced::before { background: #28a66c; }
      #${MODAL_ID} .hhr-sync-state.is-pending { color: #8a6714; }
      #${MODAL_ID} .hhr-sync-state.is-pending::before { background: #d8a72e; }
      #${MODAL_ID} .hhr-sync-state.is-error { color: #a13b35; }
      #${MODAL_ID} .hhr-sync-state.is-error::before { background: #c94c43; }
      #${MODAL_ID} .hhr-history { margin-top: 5px; }
      #${MODAL_ID} .hhr-history summary { color: #0f7c73; cursor: pointer; font-size: 11px; }
      #${MODAL_ID} .hhr-history ol { margin: 6px 0 0; padding-left: 18px; color: #5d6967; font-size: 10.5px; }
      @keyframes hhr-panel-slide { from { opacity: 0; transform: translateX(18px); } }
      #${MODAL_ID} .hhr-score-form {
        position: absolute; inset: 0 0 0 auto; z-index: 3; width: min(560px, 92%); display: flex; flex-direction: column;
        border-left: 1px solid #d8e1de; background: #fff; box-shadow: -16px 0 38px rgba(7,27,49,.16);
        animation: hhr-panel-slide .2s cubic-bezier(.2,.8,.3,1);
      }
      @media (prefers-reduced-motion: reduce) { #${MODAL_ID} .hhr-score-form { animation: none; } }
      #${MODAL_ID} .hhr-score-form-header { display: flex; align-items: center; gap: 8px; min-height: 58px; padding: 0 16px; border-bottom: 1px solid #e0e6e5; }
      #${MODAL_ID} .hhr-score-form-header strong { margin-right: auto; font-size: 15px; }
      #${MODAL_ID} .hhr-score-form-close { width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: #66726f; cursor: pointer; font-size: 22px; }
      #${MODAL_ID} .hhr-score-form-body { flex: 1; overflow: auto; padding: 14px 16px; }
      #${MODAL_ID} .hhr-score-field { display: grid; gap: 5px; margin-bottom: 12px; }
      #${MODAL_ID} .hhr-score-field label { color: #34413f; font-size: 12px; font-weight: 600; line-height: 1.35; }
      #${MODAL_ID} .hhr-score-explanation { color: #73807d; font-size: 10.5px; line-height: 1.35; }
      #${MODAL_ID} .hhr-score-control { width: 100%; min-height: 36px; box-sizing: border-box; border: 1px solid #cfd9d7; border-radius: 6px; padding: 7px 9px; background: #fff; color: #303b39; font: inherit; font-size: 11.5px; }
      #${MODAL_ID} .hhr-score-form-footer { display: flex; align-items: center; gap: 10px; min-height: 62px; padding: 9px 16px; border-top: 1px solid #e0e6e5; background: #fafbfb; }
      #${MODAL_ID} .hhr-score-preview { margin-right: auto; color: #49605c; font-size: 12px; font-weight: 600; }
      #${MODAL_ID} .hhr-center-action {
        min-height: 34px; padding: 5px 12px; border: 1px solid #ccd6d3; border-radius: 8px; background: #fff;
        color: #46514f; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
        transition: border-color .15s ease, background-color .15s ease, color .15s ease;
      }
      #${MODAL_ID} .hhr-center-action:hover { border-color: #9fc9c3; color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-center-action:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-center-action-primary { border-color: var(--hhr-teal-500); background: var(--hhr-teal-500); color: #fff; font-weight: 650; }
      #${MODAL_ID} .hhr-center-action-primary:hover { border-color: #0f857a; background: #0f857a; color: #fff; }
      #${MODAL_ID} .hhr-center-action:disabled { opacity: .48; cursor: not-allowed; }
      #${MODAL_ID} .hhr-lab-patient { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 10px 0; padding: 9px 12px; border: 1px solid #dbe8e5; border-radius: 9px; background: #f6fbfa; color: #43504e; font-size: 11.5px; }
      #${MODAL_ID} .hhr-lab-patient strong { color: var(--hhr-ink-900); font-size: 12.5px; font-weight: 650; }
      #${MODAL_ID} .hhr-lab-status { margin-left: auto; color: var(--hhr-teal-ink); font-weight: 700; }
      #${MODAL_ID} .hhr-lab-exam-list { display: block; border: 1px solid #e0e7e5; border-radius: 10px; background: #fff; overflow: hidden; }
      #${MODAL_ID} .hhr-lab-exam-row { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 8px 11px; border-bottom: 1px solid #eef2f1; background: #fff; }
      #${MODAL_ID} .hhr-lab-exam-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .hhr-lab-exam-row:hover { background: #f7fbfa; }
      #${MODAL_ID} .hhr-lab-exam-row:has(input:checked) { background: #effaf7; box-shadow: inset 3px 0 0 var(--hhr-teal-500); }
      #${MODAL_ID} .hhr-lab-exam-row input { width: 16px; height: 16px; accent-color: var(--hhr-teal-500); }
      #${MODAL_ID} .hhr-lab-exam-title { color: var(--hhr-ink-900); font-size: 12px; font-weight: 650; }
      #${MODAL_ID} .hhr-lab-exam-names { margin-top: 2px; color: #667370; font-size: 10.5px; line-height: 1.4; }
      #${MODAL_ID} .hhr-lab-selection { color: #63706e; font-size: 11px; white-space: nowrap; }
      #${MODAL_ID} .hhr-lab-results { margin-top: 12px; border-top: 1px solid #e6ebe9; padding-top: 12px; }
      #${MODAL_ID} .hhr-lab-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 10px; }
      #${MODAL_ID} .hhr-lab-stat { padding: 4px 9px; border-radius: 999px; background: #eef5f3; color: #3f5b57; font-size: 10.5px; font-weight: 700; }
      #${MODAL_ID} .hhr-lab-stat.is-alert { background: #fdefec; color: var(--hhr-red-ink); }
      #${MODAL_ID} .hhr-lab-tabs { display: flex; gap: 2px; margin: 0 0 10px; border-bottom: 1px solid #e0e7e5; }
      #${MODAL_ID} .hhr-lab-tab {
        padding: 7px 11px; border: 0; border-bottom: 2px solid transparent; background: transparent;
        color: #586562; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
      }
      #${MODAL_ID} .hhr-lab-tab:hover { color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-lab-tab:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-lab-tab[aria-selected="true"] { border-bottom-color: var(--hhr-teal-500); color: var(--hhr-teal-ink); font-weight: 700; }
      #${MODAL_ID} .hhr-lab-comparison-wrap { overflow: auto; max-height: 410px; border: 1px solid #dde5e3; border-radius: 7px; }
      #${MODAL_ID} .hhr-lab-comparison { table-layout: auto; min-width: 760px; }
      #${MODAL_ID} .hhr-lab-comparison th:first-child, #${MODAL_ID} .hhr-lab-comparison td:first-child { position: sticky; left: 0; z-index: 2; min-width: 170px; background: #fff; }
      #${MODAL_ID} .hhr-lab-comparison th:first-child { z-index: 3; background: #f4f7f6; }
      #${MODAL_ID} .hhr-lab-value { min-width: 112px; white-space: nowrap; }
      #${MODAL_ID} .hhr-lab-value.is-alert { background: #fff2f0; color: #a43730; font-weight: 700; }
      #${MODAL_ID} .hhr-lab-ref { display: block; margin-top: 2px; color: #7b8784; font-size: 9px; font-weight: 400; }
      #${MODAL_ID} .hhr-lab-trends { display: grid; grid-template-columns: repeat(auto-fit,minmax(330px,1fr)); gap: 10px; }
      #${MODAL_ID} .hhr-lab-trend-card { padding: 10px; border: 1px solid #dde5e3; border-radius: 8px; background: #fff; }
      #${MODAL_ID} .hhr-lab-trend-card strong { color: #33423f; font-size: 12px; }
      #${MODAL_ID} .hhr-lab-trend-card svg { display: block; width: 100%; height: 130px; margin-top: 6px; overflow: visible; }
      #${MODAL_ID} .hhr-lab-trend-labels { display: flex; justify-content: space-between; gap: 4px; color: #76827f; font-size: 8.5px; }
      #${MODAL_ID} .hhr-lab-report { margin-bottom: 8px; border: 1px solid #dfe6e5; border-radius: 7px; overflow: hidden; }
      #${MODAL_ID} .hhr-lab-report summary { padding: 9px 11px; background: #f7f9f9; color: #34413f; cursor: pointer; font-size: 11.5px; font-weight: 700; }
      #${MODAL_ID} .hhr-lab-report table { margin: 0; }
      #${MODAL_ID} .hhr-syslab-login { display: block; width: 100%; height: 92px; margin: 8px 0; border: 0; border-radius: 9px; background: #fffaf0; }
      #${MODAL_ID} .hhr-syslab-login[hidden] { display: none; }
      #${MODAL_ID} .hhr-connection-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; padding-top: 12px; }
      #${MODAL_ID} .hhr-connection-card {
        border: 1px solid #e0e8e6; border-radius: 12px; background: #fff; padding: 14px 15px;
        box-shadow: 0 1px 2px rgba(16,42,67,.04);
      }
      #${MODAL_ID} .hhr-connection-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      #${MODAL_ID} .hhr-connection-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: #eef4f3; color: #53615f; font-weight: 700; font-size: 11px; }
      #${MODAL_ID} .hhr-connection-card.is-ready .hhr-connection-icon { background: #e4f4ef; color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-connection-card.is-stale .hhr-connection-icon { background: #fff5df; color: var(--hhr-amber-ink); }
      #${MODAL_ID} .hhr-connection-card h3 { margin: 0; color: var(--hhr-ink-900); font-size: 13.5px; font-weight: 650; }
      #${MODAL_ID} .hhr-connection-status { display: flex; align-items: center; gap: 6px; margin-top: 3px; color: #6b7775; font-size: 11px; font-weight: 600; }
      #${MODAL_ID} .hhr-connection-status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #a9b3b1; }
      #${MODAL_ID} .hhr-connection-card.is-ready .hhr-connection-status { color: var(--hhr-green-ink); }
      #${MODAL_ID} .hhr-connection-card.is-ready .hhr-connection-status::before { background: var(--hhr-green-600); }
      #${MODAL_ID} .hhr-connection-card.is-stale .hhr-connection-status { color: var(--hhr-amber-ink); }
      #${MODAL_ID} .hhr-connection-card.is-stale .hhr-connection-status::before { background: var(--hhr-amber-600); }
      #${MODAL_ID} .hhr-connection-user { min-height: 40px; color: #34413f; font-size: 12.5px; font-weight: 650; }
      #${MODAL_ID} .hhr-connection-detail { display: block; margin-top: 3px; color: #76817f; font-size: 11px; font-weight: 400; line-height: 1.4; }
      #${MODAL_ID} .hhr-connection-actions { display: flex; align-items: center; gap: 7px; margin-top: 12px; }
      #${MODAL_ID} .hhr-connection-privacy {
        margin-top: 12px; padding: 10px 12px; border: 0; border-left: 3px solid var(--hhr-teal-600);
        border-radius: 6px; background: #f4faf8; color: #52605e; font-size: 11.5px; line-height: 1.5;
      }
      #${MODAL_ID} .hhr-connection-feedback { min-height: 18px; margin-top: 10px; color: #64716f; font-size: 11.5px; }
      #${MODAL_ID} .hhr-connection-feedback.is-error { color: var(--hhr-red-ink); }
      #${MODAL_ID} .hhr-imaging-tabs { flex: 0 1 430px; min-width: 300px; margin: 0 0 0 auto; }
      #${MODAL_ID} .hhr-imaging-controls {
        position: sticky; top: 0; z-index: 4; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
        margin: 8px 0 4px; padding: 7px 0; border-bottom: 1px solid #e8eeec; background: rgba(255,255,255,.97);
        box-shadow: 0 5px 10px rgba(255,255,255,.92);
      }
      #${MODAL_ID} .hhr-imaging-physician { flex: 1 1 240px; min-width: 200px; }
      #${MODAL_ID} .hhr-imaging-tools { display: flex; align-items: center; gap: 5px; }
      #${MODAL_ID} .hhr-imaging-tool.is-active { border-color: var(--hhr-teal-500); background: #e8f4f1; color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-imaging-hint { margin: 2px 0 10px; color: #74807e; font-size: 11px; line-height: 1.4; }
      #${MODAL_ID} .hhr-imaging-stage { display: flex; justify-content: center; padding: 4px 0 10px; }
      #${MODAL_ID} .hhr-imaging-canvas {
        position: relative; width: min(720px, 100%); border: 1px solid #dde5e3; border-radius: 8px;
        background: #fff; box-shadow: 0 4px 18px rgba(16,42,67,.10); overflow: hidden;
        cursor: crosshair; user-select: none;
      }
      #${MODAL_ID} .hhr-imaging-canvas:focus-visible { outline: 3px solid rgba(15,147,140,.38); outline-offset: 3px; }
      #${MODAL_ID} .hhr-imaging-image { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
      #${MODAL_ID} .hhr-imaging-overlays { position: absolute; inset: 0; }
      #${MODAL_ID} .hhr-imaging-overlay { position: absolute; color: #000; font-size: 12px; line-height: 1; white-space: nowrap; pointer-events: none; }
      #${MODAL_ID} .hhr-imaging-overlay.is-bold { font-weight: 600; }
      #${MODAL_ID} .hhr-imaging-overlay.is-small { font-size: 10px; }
      #${MODAL_ID} .hhr-imaging-mark { position: absolute; transform: translate(-50%, -50%); color: #1d4ed8; font-size: 15px; font-weight: 700; pointer-events: none; }
      #${MODAL_ID} .hhr-imaging-mark.is-text { transform: translate(0, -50%); font-size: 12px; text-transform: uppercase; }
      #${MODAL_ID} .hhr-imaging-keyboard-cursor {
        position: absolute; z-index: 3; width: 18px; height: 18px; transform: translate(-50%, -50%);
        border: 2px solid var(--hhr-teal-600); border-radius: 50%; background: rgba(255,255,255,.72);
        box-shadow: 0 0 0 2px rgba(255,255,255,.8); pointer-events: none;
      }
      #${MODAL_ID} .hhr-imaging-keyboard-cursor::before,
      #${MODAL_ID} .hhr-imaging-keyboard-cursor::after { content: ''; position: absolute; background: var(--hhr-teal-600); }
      #${MODAL_ID} .hhr-imaging-keyboard-cursor::before { left: 7px; top: -5px; width: 2px; height: 24px; }
      #${MODAL_ID} .hhr-imaging-keyboard-cursor::after { left: -5px; top: 7px; width: 24px; height: 2px; }
      #${MODAL_ID} .hhr-imaging-text-editor {
        position: absolute; transform: translate(0, -50%); z-index: 2; width: 170px; padding: 2px 6px;
        border: 1px solid var(--hhr-teal-500); border-radius: 4px; background: #fff; color: #1d3a4f;
        font: 600 11px/1.3 var(--hhr-font); text-transform: uppercase; outline: none;
        box-shadow: 0 3px 10px rgba(16,42,67,.18);
      }
      #${MODAL_ID} .hhr-vitals-section-title {
        display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
        margin: 14px 0 7px; color: #55635f; font-size: 10.5px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .05em;
      }
      #${MODAL_ID} .hhr-vitals-section-title span:last-child { color: #7c8886; font-weight: 600; text-transform: none; letter-spacing: 0; }
      #${MODAL_ID} .hhr-vitals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
      #${MODAL_ID} .hhr-vitals-tile {
        display: grid; gap: 2px; padding: 9px 10px 8px; border: 1px solid #e0e8e6; border-radius: 10px;
        background: #fbfdfc; text-align: center;
      }
      #${MODAL_ID} .hhr-vitals-label { color: #677573; font-size: 10px; font-weight: 700; letter-spacing: .04em; }
      #${MODAL_ID} .hhr-vitals-value { color: var(--hhr-ink-900); font-size: 19px; font-weight: 700; line-height: 1.1; }
      #${MODAL_ID} .hhr-vitals-unit { color: #8a9694; font-size: 9.5px; }
      #${MODAL_ID} .hhr-vitals-tile.is-warn { border-color: #ecd39a; background: #fffaf0; }
      #${MODAL_ID} .hhr-vitals-tile.is-warn .hhr-vitals-value { color: var(--hhr-amber-ink); }
      #${MODAL_ID} .hhr-vitals-tile.is-alert { border-color: #e7b3ae; background: #fdf3f2; }
      #${MODAL_ID} .hhr-vitals-tile.is-alert .hhr-vitals-value { color: var(--hhr-red-ink); }
      #${MODAL_ID} .hhr-vitals-tile.is-ungraded { border-style: dashed; background: #f7f9f8; }
      #${MODAL_ID} .hhr-vitals-tile.is-ungraded .hhr-vitals-value { color: #5f6d6a; }
      #${MODAL_ID} .hhr-vitals-census { display: grid; gap: 6px; padding-top: 10px; }
      #${MODAL_ID} .hhr-vitals-patient {
        display: grid; grid-template-columns: 64px minmax(220px,1.35fr) minmax(390px,3fr);
        gap: 9px; align-items: center; width: 100%; padding: 7px 9px; border: 1px solid #e0e8e6;
        border-radius: 10px; background: #fff; color: var(--hhr-ink-900); cursor: pointer;
        text-align: left; font: inherit;
      }
      #${MODAL_ID} .hhr-vitals-patient:hover { border-color: #8fc8c1; background: #f6fbfa; }
      #${MODAL_ID} .hhr-vitals-patient:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #${MODAL_ID} .hhr-vitals-patient.is-unavailable { cursor: default; opacity: .68; }
      #${MODAL_ID} .hhr-vitals-bed {
        display: inline-flex; justify-content: center; min-width: 0; padding: 4px 6px; border-radius: 7px;
        background: #e8f4f1; color: var(--hhr-teal-ink); font-size: 11px; font-weight: 750;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${MODAL_ID} .hhr-vitals-patient-id { display: grid; gap: 2px; min-width: 0; }
      #${MODAL_ID} .hhr-vitals-patient-id strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
      #${MODAL_ID} .hhr-vitals-patient-id span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #74807e; font-size: 10.5px; }
      #${MODAL_ID} .hhr-vitals-patient-id .hhr-vitals-patient-time {
        margin-top: 2px; color: #3f6661; font-size: 10px; font-weight: 650;
      }
      #${MODAL_ID} .hhr-vitals-values { display: grid; grid-template-columns: repeat(6,minmax(52px,1fr)); gap: 4px; min-width: 0; }
      #${MODAL_ID} .hhr-vitals-summary-value { display: grid; gap: 0; min-width: 0; padding: 3px 5px; border-radius: 6px; background: #f5f8f7; }
      #${MODAL_ID} .hhr-vitals-summary-value span { color: #788481; font-size: 8px; font-weight: 700; text-transform: uppercase; }
      #${MODAL_ID} .hhr-vitals-summary-value strong { overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
      #${MODAL_ID} .hhr-vitals-summary-value.is-alert strong { color: var(--hhr-red-ink); }
      #${MODAL_ID} .hhr-vitals-summary-value.is-warn strong { color: var(--hhr-amber-ink); }
      #${MODAL_ID} .hhr-vitals-obs { margin: 8px 0 0; padding: 8px 11px; border: 1px solid #e0e8e6; border-radius: 8px; background: #fbfdfc; color: #4c5a58; font-size: 11.5px; line-height: 1.4; }
      #${MODAL_ID} .hhr-vitals-trends { margin-top: 10px; }
      #${MODAL_ID} .hhr-vitals-table-wrap { border: 1px solid #e0e8e6; border-radius: 10px; overflow: auto; max-height: 380px; }
      #${MODAL_ID} .hhr-vitals-table td { white-space: nowrap; }
      #${MODAL_ID} .hhr-vitals-table td.is-warn { color: var(--hhr-amber-ink); font-weight: 700; }
      #${MODAL_ID} .hhr-vitals-table td.is-alert { color: var(--hhr-red-ink); font-weight: 700; background: #fdf3f2; }
      #${MODAL_ID} .hhr-vitals-day td { padding: 5px 8px; background: #f2f6f5; color: #55635f; font-size: 10.5px; font-weight: 700; letter-spacing: .03em; }
      #${MODAL_ID} .hhr-labreq-content { padding: 18px clamp(32px,3vw,44px) 32px; }
      #${MODAL_ID} .hhr-labreq-count { color: #64716f; font-size: 11.5px; white-space: nowrap; }
      #${MODAL_ID} .hhr-labreq-meta {
        display: grid; gap: 7px; margin: 0 0 14px; padding: 10px 12px; border: 1px solid #e3eae8;
        border-radius: 10px; background: #f8fbfa;
      }
      #${MODAL_ID} .hhr-labreq-meta-group { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
      #${MODAL_ID} .hhr-labreq-meta-label { min-width: 84px; color: #55635f; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
      #${MODAL_ID} .hhr-labreq-chip {
        display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid #d7e0de;
        border-radius: 999px; background: #fff; color: #46534f; cursor: pointer; font-size: 11px; font-weight: 600;
      }
      #${MODAL_ID} .hhr-labreq-chip:has(input:checked) { border-color: var(--hhr-teal-500); background: #e8f4f1; color: var(--hhr-teal-ink); }
      #${MODAL_ID} .hhr-labreq-chip input { width: 13px; height: 13px; margin: 0; accent-color: var(--hhr-teal-500); }
      #${MODAL_ID} .hhr-labreq-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      #${MODAL_ID} .hhr-labreq-column { display: grid; gap: 12px; align-content: start; }
      #${MODAL_ID} .hhr-labreq-section { border: 1px solid #dfe7e5; border-radius: 9px; background: #fff; overflow: hidden; }
      #${MODAL_ID} .hhr-labreq-section header {
        padding: 5px 9px; border-bottom: 1px solid #e6ecea; background: #f6f9f8; color: #45524f;
        font-size: 10.5px; font-weight: 700; text-align: center;
      }
      #${MODAL_ID} .hhr-labreq-section header small { display: block; color: #7c8886; font-size: 8.5px; font-weight: 600; }
      #${MODAL_ID} .hhr-labreq-exam { display: flex; align-items: center; gap: 7px; padding: 3px 9px; cursor: pointer; color: #3d4a47; font-size: 10.5px; }
      #${MODAL_ID} .hhr-labreq-exam:hover { background: #f7fbfa; }
      #${MODAL_ID} .hhr-labreq-exam input { width: 14px; height: 14px; margin: 0; flex: 0 0 auto; }
      #${MODAL_ID} .hhr-labreq-footer { display: flex; gap: 8px; margin-top: 12px; }
      #${MODAL_ID} .hhr-labreq-footer input { flex: 1; }
      @media (max-width: 900px) { #${MODAL_ID} .hhr-labreq-grid { grid-template-columns: 1fr; } }
      @media (max-width: 760px) {
        #${MODAL_ID} .hhr-center-dialog { width: calc(100vw - 16px); height: calc(100vh - 16px); max-height: calc(100vh - 16px); margin: 8px auto; }
        #${MODAL_ID} .hhr-center-shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0,1fr); }
        #${MODAL_ID} .hhr-center-nav { display: grid; grid-template-columns: repeat(9,1fr); padding: 4px; border-right: 0; border-bottom: 1px solid #e0e6e5; }
        #${MODAL_ID} .hhr-center-nav-session { margin-top: 0; border-top: 0; }
        #${MODAL_ID} .hhr-center-nav-button { min-height: 48px; border-left: 0; border-bottom: 2px solid transparent; border-radius: 5px; font-size: 9.5px; }
        #${MODAL_ID} .hhr-center-nav-button[aria-current="page"] { border-left-color: transparent; border-bottom-color: #15978b; }
        #${MODAL_ID} .hhr-center-toolbar { flex-wrap: wrap; min-height: auto; padding: 8px 12px; }
        #${MODAL_ID} .hhr-center-heading { flex-basis: 100%; }
        #${MODAL_ID} .hhr-center-search { width: 100%; flex: 1 1 160px; }
        #${MODAL_ID} .hhr-center-content { padding: 10px 12px 14px; }
        #${MODAL_ID} .hhr-labreq-content { padding: 12px 16px 18px; }
        #${MODAL_ID} .hhr-vitals-patient { grid-template-columns: 54px minmax(130px,1fr) auto; }
        #${MODAL_ID} .hhr-vitals-values { grid-column: 1 / -1; grid-template-columns: repeat(3,minmax(0,1fr)); }
        #${MODAL_ID} .hhr-vitals-summary-time { grid-column: 1 / -1; justify-self: end; }
        #${MODAL_ID} .hhr-connection-grid { grid-template-columns: 1fr; }
        #${MODAL_ID} .hhr-syslab-login { height: 170px; }
        #${MODAL_ID} .hhr-center-table { min-width: 0; display: block; }
        #${MODAL_ID} .hhr-center-table colgroup, #${MODAL_ID} .hhr-center-table thead { display: none; }
        #${MODAL_ID} .hhr-center-table tbody { display: grid; gap: 9px; padding-top: 9px; }
        #${MODAL_ID} .hhr-center-table tbody tr {
          display: block; border: 1px solid #dce4e2; border-radius: 8px; background: #fff; overflow: hidden;
        }
        #${MODAL_ID} .hhr-center-table tbody tr:hover { background: #fff; }
        #${MODAL_ID} .hhr-center-table td {
          display: grid; grid-template-columns: 82px minmax(0,1fr); gap: 8px; padding: 7px 9px;
          border-bottom: 1px solid #edf0ef; overflow-wrap: anywhere;
        }
        #${MODAL_ID} .hhr-center-table td::before {
          content: attr(data-label); color: #687471; font-size: 9.5px; font-weight: 700;
          letter-spacing: .035em; line-height: 1.35; text-transform: uppercase;
        }
        #${MODAL_ID} .hhr-center-table td > .hhr-center-meta,
        #${MODAL_ID} .hhr-handoff-table td[data-label="Nueva entrega"] > .hhr-handoff-tools { grid-column: 2; }
        #${MODAL_ID} .hhr-center-table td:last-child { border-bottom: 0; }
        #${MODAL_ID} .hhr-handoff-input { min-height: 72px; }
        #${MODAL_ID} .hhr-score-form { width: 100%; }
      }
      @media (max-width: 560px) {
        #${MODAL_ID} .hhr-rx-dialog { margin: 16px auto; max-height: calc(100vh - 32px); }
        #${MODAL_ID} .hhr-rx-footer { flex-direction: column-reverse; }
        #${MODAL_ID} .hhr-rx-action { width: 100%; }
        #${MODAL_ID} .hhr-rx-formats { grid-template-columns: 1fr; }
        #${MODAL_ID} .hhr-rx-bulk-toolbar { align-items: stretch; flex-wrap: wrap; }
        #${MODAL_ID} .hhr-rx-search { flex-basis: 100%; }
        #${MODAL_ID} .hhr-rx-header, #${MODAL_ID} .hhr-rx-body, #${MODAL_ID} .hhr-rx-footer { padding-left: 16px; padding-right: 16px; }
      }
      @media (forced-colors: active) {
        #${MODAL_ID} .hhr-rx-dialog { border: 1px solid CanvasText; }
        #${MODAL_ID} button:focus-visible, #${MODAL_ID} input:focus-visible,
        #${MODAL_ID} select:focus-visible, #${MODAL_ID} textarea:focus-visible {
          outline: 2px solid Highlight; outline-offset: 2px;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const closeModal = (force = false) => {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return true;
    if (!force && typeof modal.__hhrDismiss === 'function') return modal.__hhrDismiss();
    modal.remove();
    return true;
  };

  const modalDismissWithFocusRestore = (root, focusReturnTarget) => () => {
    if (root && root.isConnected) root.remove();
    if (focusReturnTarget && focusReturnTarget.isConnected && typeof focusReturnTarget.focus === 'function') {
      window.setTimeout(() => focusReturnTarget.focus(), 0);
    }
    return true;
  };

  const createFeedbackModal = ({ title, message, error = false }) => {
    const focusReturnTarget = document.activeElement;
    if (!closeModal()) return;
    ensureStyles();
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.innerHTML = `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog" role="dialog" aria-modal="true" aria-labelledby="hhr-rx-title">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <header class="hhr-rx-header"><h2 class="hhr-rx-title" id="hhr-rx-title"></h2></header>
        <div class="hhr-rx-body"></div>
        <footer class="hhr-rx-footer">
          <button class="hhr-rx-action hhr-rx-cancel" type="button">Cerrar</button>
        </footer>
      </section>
    `;
    root.querySelector('.hhr-rx-title').textContent = title;
    const body = root.querySelector('.hhr-rx-body');
    const status = document.createElement('div');
    status.className = error ? 'hhr-rx-error' : 'hhr-rx-status';
    status.textContent = message;
    body.appendChild(status);
    const dismiss = modalDismissWithFocusRestore(root, focusReturnTarget);
    root.__hhrDismiss = dismiss;
    root.querySelector('.hhr-rx-close').addEventListener('click', dismiss);
    root.querySelector('.hhr-rx-cancel').addEventListener('click', dismiss);
    root.querySelector('.hhr-rx-backdrop').addEventListener('click', dismiss);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      trapModalFocus(root, event);
    });
    document.body.appendChild(root);
    root.querySelector('.hhr-rx-close').focus();
  };

  const createModal = (encId, initialTab = '', existingRoot = null) => {
    const requestedEncId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
    // Module changes inside Centro HHR must keep the patient selected there, even when the
    // underlying Eloísa route still points at another encounter. Consult the route only when
    // opening a fresh modal without an explicit encounter.
    encId = requestedEncId || (!existingRoot ? currentRouteEncounterId() : '');
    const focusReturnTarget = existingRoot && existingRoot.__hhrFocusReturnTarget
      ? existingRoot.__hhrFocusReturnTarget
      : document.activeElement;
    const hasCurrentPatient = /^\d+$/.test(String(encId || ''));
    // A patient selected from the hospitalized list is a valid explicit context even when
    // Eloísa keeps another episode in the underlying route. This unlocks the same detailed
    // prescription options (including verified external prescriptions) without navigation.
    const currentPatientMatchesRoute = hasCurrentPatient;
    const root = prepareCenterModalRoot({
      existingRoot,
      activeModule: 'recipes',
      encId,
      focusReturnTarget,
    });
    if (!root) return;
    root.querySelector('.hhr-center-main').innerHTML = `
      <div class="hhr-center-toolbar hhr-recipes-toolbar">
        <h2 class="hhr-center-heading hhr-rx-title" id="hhr-rx-title">Recetas</h2>
        <div class="hhr-rx-tabs hhr-rx-module-tabs" role="tablist" aria-label="Sección de recetas">
          <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="recipes" aria-selected="true">Recetas</button>
          <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="indications" aria-selected="false">Indicaciones</button>
        </div>
        <div class="hhr-rx-tabs hhr-rx-scope-tabs" role="tablist" aria-label="Alcance de impresión">
          <button class="hhr-rx-tab" id="hhr-rx-tab-current" type="button" role="tab" data-tab="current" aria-controls="hhr-rx-tabpanel" aria-selected="true">Paciente actual</button>
          <button class="hhr-rx-tab" id="hhr-rx-tab-hospitalized" type="button" role="tab" data-tab="hospitalized" aria-controls="hhr-rx-tabpanel" aria-selected="false">Hospitalizados</button>
        </div>
      </div>
      <div class="hhr-center-content hhr-center-embed">
        <p class="hhr-rx-subtitle">Elige qué recetas necesitas y abre un único diálogo de impresión.</p>
        <div class="hhr-rx-body" id="hhr-rx-tabpanel" role="tabpanel" aria-labelledby="hhr-rx-tab-current"><div class="hhr-rx-status">Buscando recetas disponibles…</div></div>
      </div>
      <footer class="hhr-rx-footer">
        <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
        <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled>
          Imprimir receta completa
        </button>
      </footer>
    `;
    const body = root.querySelector('.hhr-rx-body');
    const submit = root.querySelector('.hhr-rx-submit');
    const cancel = root.querySelector('.hhr-rx-cancel');
    const subtitle = root.querySelector('.hhr-rx-subtitle');
    root.querySelector('[data-rx-module="indications"]').addEventListener('click', () => {
      runClinicalTransition(root, () => createHospitalizedDocumentsModal('indications', encId, root));
    });
    const tabs = Array.from(root.querySelectorAll('.hhr-rx-scope-tabs .hhr-rx-tab'));
    const currentTab = tabs.find(tab => tab.dataset.tab === 'current');
    if (!currentPatientMatchesRoute && currentTab) {
      currentTab.disabled = true;
      currentTab.setAttribute('aria-disabled', 'true');
      currentTab.setAttribute('aria-selected', 'false');
      currentTab.title = 'Disponible al abrir Recetas desde el episodio activo en Ficha Médico';
    } else if (currentTab) {
      currentTab.disabled = false;
      currentTab.removeAttribute('aria-disabled');
      currentTab.removeAttribute('title');
    }
    let activeTab = currentPatientMatchesRoute ? 'current' : 'hospitalized';
    let viewGeneration = 0;
    let hospitalizedResponse = null;
    let hospitalizedRequest = null;
    cancel.addEventListener('click', root.__hhrDismiss);

    const renderError = message => {
      body.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'hhr-rx-error';
      error.textContent = message;
      body.appendChild(error);
      submit.disabled = true;
    };

    const renderFormats = (name, checkedFormat = 'standard') => {
      const formatTitle = document.createElement('div');
      formatTitle.className = 'hhr-rx-format-title';
      formatTitle.textContent = 'Formato de impresión';
      const formats = document.createElement('div');
      formats.className = 'hhr-rx-formats';
      const addFormat = ({ value, title, meta }) => {
        const label = document.createElement('label');
        label.className = 'hhr-rx-format-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = value;
        input.checked = value === checkedFormat;
        const details = document.createElement('span');
        const optionTitle = document.createElement('span');
        optionTitle.className = 'hhr-rx-date';
        optionTitle.textContent = title;
        const optionMeta = document.createElement('span');
        optionMeta.className = 'hhr-rx-meta';
        optionMeta.textContent = meta;
        details.append(optionTitle, optionMeta);
        label.append(input, details);
        formats.appendChild(label);
      };
      addFormat({ value: 'standard', title: 'Estándar', meta: 'Documento oficial con lectura amplia' });
      addFormat({ value: 'compact', title: 'Compacta', meta: 'Mismo contenido, hasta 22 fármacos por hoja' });
      body.append(formatTitle, formats);
      return formats;
    };

    const showSuccess = (message, restoreSubmitState) => {
      let status = body.querySelector('.hhr-rx-print-feedback');
      if (!status) {
        status = document.createElement('div');
        status.className = 'hhr-rx-status hhr-rx-print-feedback';
        body.prepend(status);
      }
      setLiveRegion(status, message);
      cancel.disabled = false;
      cancel.textContent = 'Cerrar';
      submit.disabled = false;
      if (typeof restoreSubmitState === 'function') restoreSubmitState();
      else submit.textContent = 'Imprimir nuevamente';
    };

    const renderCurrentPatient = async generation => {
      body.innerHTML = '<div class="hhr-rx-status">Buscando recetas disponibles…</div>';
      submit.disabled = true;
      submit.textContent = 'Imprimir receta completa';
      const response = await sendMessage({ type: runtimeMessages.PRESCRIPTION_OPTIONS_REQUEST, encId });
      if (!root.isConnected || generation !== viewGeneration) return;
      if (!response || response.error) {
        renderError((response && response.error) || 'No se encontraron recetas disponibles.');
        return;
      }
      const groups = Array.isArray(response.groups) ? response.groups : [];
      const externalGroups = Array.isArray(response.externalGroups) ? response.externalGroups : [];
      if (groups.length === 0) {
        body.innerHTML = '<div class="hhr-rx-status">No hay recetas farmacológicas disponibles para este episodio.</div>';
        return;
      }
      body.innerHTML = '';
      const patient = response.patient && typeof response.patient === 'object' ? response.patient : null;
      const patientContext = document.createElement('div');
      patientContext.className = 'hhr-rx-patient-context';
      patientContext.setAttribute('aria-label', 'Paciente de la receta');
      const patientName = document.createElement('strong');
      patientName.textContent = patient && patient.name
        ? patient.name
        : 'Episodio ' + String(encId || 'no identificado');
      const patientMeta = document.createElement('span');
      const location = [patient && patient.bed, patient && patient.room].filter(Boolean).join(' / ');
      const patientRun = patient && patient.run
        ? helper.formatRun(patient.run) || String(patient.run)
        : '';
      patientMeta.textContent = [
        patientRun ? 'RUN ' + patientRun : '',
        location ? 'Cama ' + location : '',
        patient && patient.service ? patient.service : '',
      ].filter(Boolean).join(' · ') || 'Identificación clínica no disponible';
      patientContext.append(patientName, patientMeta);
      body.appendChild(patientContext);
      if (response.medicationMetadataWarning) {
        const syncNote = document.createElement('div');
        syncNote.className = 'hhr-rx-sync-note';
        syncNote.textContent = 'No se pudo verificar la etiqueta “Externo” en la tabla activa. Las demás recetas siguen disponibles.';
        body.appendChild(syncNote);
      }
      const list = document.createElement('div');
      list.className = 'hhr-rx-list';
      const selectableGroups = [...externalGroups, ...groups];
      const totalCount = groups.reduce((sum, group) => sum + (Number(group.count) || 0), 0);
      const currentValidation = response.validation && (response.validation.dateTime || response.validation.date)
        ? ' · validación ' + helper.formatDateTimeLabel(response.validation.dateTime || response.validation.date)
        : '';
      const addOption = ({ key, title, meta, checked = false, disabled = false }) => {
        const label = document.createElement('label');
        label.className = 'hhr-rx-option';
        if (disabled) label.classList.add('is-disabled');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'hhr-prescription-selection';
        input.value = key;
        input.checked = checked;
        input.disabled = disabled;
        const details = document.createElement('span');
        const optionTitle = document.createElement('span');
        optionTitle.className = 'hhr-rx-date';
        optionTitle.textContent = title;
        const optionMeta = document.createElement('span');
        optionMeta.className = 'hhr-rx-meta';
        optionMeta.textContent = meta;
        details.append(optionTitle, optionMeta);
        label.append(input, details);
        list.appendChild(label);
      };
      addOption({
        key: 'complete',
        title: 'Receta completa',
        meta:
          'PDF oficial vigente · ' + totalCount + (totalCount === 1 ? ' fármaco' : ' fármacos') +
          (externalGroups.length
            ? ' · incluye ' + externalGroups.length + (externalGroups.length === 1 ? ' receta externa' : ' recetas externas')
            : '') +
          currentValidation,
        checked: true,
      });
      if (externalGroups.length) {
        const externalTitle = document.createElement('div');
        externalTitle.className = 'hhr-rx-format-title';
        externalTitle.textContent = externalGroups.length === 1
          ? 'Receta externa detectada'
          : 'Recetas externas detectadas';
        list.appendChild(externalTitle);
        externalGroups.forEach(group => {
          const printDateTime = helper.formatDateTimeLabel(group.printDateTime || group.validationDateTime) ||
            helper.formatDateLabel(group.printDate || group.validationDate);
          const printDateLabel = group.printDateSource === 'indication'
            ? 'última indicación '
            : 'última validación ';
          const identityReady = Boolean(group.prescriberVerified && group.professionalRun);
          const dateReady = Boolean(printDateTime);
          addOption({
            key: group.key,
            title: 'Externa · ' + (group.medication || 'Medicamento no informado'),
            meta:
              (group.professional || 'Profesional no informado') +
              (group.professionalRun ? ' · RUN ' + group.professionalRun : '') +
              (printDateTime ? ' · ' + printDateLabel + printDateTime : '') +
              (!identityReady
                ? ' · identidad no verificable; usa receta completa'
                : !dateReady ? ' · sin fecha atribuible; usa receta completa' : ''),
            disabled: !identityReady || !dateReady,
          });
        });
        const professionalTitle = document.createElement('div');
        professionalTitle.className = 'hhr-rx-format-title';
        professionalTitle.textContent = 'Recetas por prescriptor';
        list.appendChild(professionalTitle);
      }
      groups.forEach(group => {
        const drugCount = Number(group.count) || 0;
        const printDateTime = helper.formatDateTimeLabel(group.printDateTime || group.validationDateTime) ||
          helper.formatDateLabel(group.printDate || group.validationDate);
        const printDateLabel = group.printDateSource === 'indication'
          ? 'última indicación '
          : 'última validación ';
        const identityReady = Boolean(group.prescriberVerified && group.professionalRun);
        const dateReady = Boolean(printDateTime);
        addOption({
          key: group.key,
          title: group.professional || 'Profesional no informado',
          meta:
            (group.professionalRun ? 'RUN ' + group.professionalRun + ' · ' : '') +
            drugCount + (drugCount === 1 ? ' fármaco' : ' fármacos') +
            (Number(group.externalCount) > 0
              ? ' · incluye ' + group.externalCount + (Number(group.externalCount) === 1 ? ' externo' : ' externos')
              : '') +
            (printDateTime
              ? ' · ' + printDateLabel + printDateTime
              : '') +
            (!identityReady
              ? ' · identidad no verificable; usa receta completa'
              : !dateReady ? ' · sin fecha atribuible; usa receta completa' : ''),
          disabled: !identityReady || !dateReady,
        });
      });
      body.appendChild(list);
      const formats = renderFormats('hhr-prescription-format');
      submit.disabled = false;

      const updateSubmitText = () => {
        const selected = list.querySelector('input:checked');
        const selectedFormat = formats.querySelector('input:checked');
        const group = selectableGroups.find(item => item.key === selected?.value);
        const compact = selectedFormat?.value === 'compact';
        submit.textContent = group
          ? group.external
            ? 'Imprimir receta externa' + (compact ? ' compacta' : '')
            : 'Imprimir receta' + (compact ? ' compacta' : '') + ' de ' + group.professional
          : 'Imprimir receta ' + (compact ? 'compacta completa' : 'completa');
      };
      list.addEventListener('change', updateSubmitText);
      formats.addEventListener('change', updateSubmitText);
      updateSubmitText();

      submit.onclick = async () => {
        const selected = list.querySelector('input:checked');
        const selectedFormat = formats.querySelector('input:checked');
        if (!selected || !selectedFormat) return;
        submit.disabled = true;
        cancel.disabled = true;
        submit.textContent = 'Generando receta…';
        const result = await sendMessage({
          type: runtimeMessages.PRESCRIPTION_PRINT_REQUEST,
          encId,
          selectionKey: selected.value,
          printFormat: selectedFormat.value,
        });
        if (!root.isConnected) return;
        if (!result || result.error) {
          cancel.disabled = false;
          submit.textContent = 'Reintentar impresión';
          renderError((result && result.error) || 'No se pudo abrir la receta para imprimir.');
          submit.disabled = false;
          return;
        }
        showSuccess(
          'La receta se abrió en una pestaña nueva con el diálogo de impresión. Puedes imprimir otra sin cerrar este panel.',
          updateSubmitText
        );
      };
    };

    const renderHospitalized = async generation => {
      submit.disabled = true;
      submit.textContent = 'Selecciona pacientes';
      if (!hospitalizedResponse) {
        body.innerHTML = '<div class="hhr-rx-status">Revisando pacientes hospitalizados y sus recetas activas…</div>';
        if (!hospitalizedRequest) {
          hospitalizedRequest = sendMessage({
            type: runtimeMessages.HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST,
            currentEncId: encId,
          });
        }
        const requestedResponse = await hospitalizedRequest;
        if (!root.isConnected || generation !== viewGeneration) return;
        hospitalizedRequest = null;
        hospitalizedResponse = requestedResponse;
      }
      if (!root.isConnected || generation !== viewGeneration) return;
      if (!hospitalizedResponse || hospitalizedResponse.error) {
        const message = hospitalizedResponse && hospitalizedResponse.error;
        hospitalizedResponse = null;
        renderError(message || 'No se pudo revisar la lista de pacientes hospitalizados.');
        return;
      }
      const patients = Array.isArray(hospitalizedResponse.patients) ? hospitalizedResponse.patients : [];
      if (patients.length === 0) {
        body.innerHTML = '<div class="hhr-rx-status">No hay pacientes hospitalizados disponibles.</div>';
        return;
      }

      body.innerHTML = '';
      const toolbar = document.createElement('div');
      toolbar.className = 'hhr-rx-bulk-toolbar';
      const search = document.createElement('input');
      search.className = 'hhr-rx-search';
      search.type = 'search';
      search.placeholder = 'Buscar por paciente, RUN, cama o prescriptor';
      search.setAttribute('aria-label', 'Buscar pacientes hospitalizados');
      const selectVisible = document.createElement('button');
      selectVisible.className = 'hhr-rx-mini-action';
      selectVisible.type = 'button';
      selectVisible.textContent = 'Seleccionar todos';
      const clearSelection = document.createElement('button');
      clearSelection.className = 'hhr-rx-mini-action';
      clearSelection.type = 'button';
      clearSelection.textContent = 'Quitar selección';
      toolbar.append(search, selectVisible, clearSelection);

      const selectionSummary = document.createElement('div');
      selectionSummary.className = 'hhr-rx-selection-summary';
      const selectedText = document.createElement('span');
      const availableText = document.createElement('span');
      const printablePatients = patients.filter(patient => patient.medicationCount > 0 && !patient.unavailableReason);
      availableText.textContent = printablePatients.length + ' con receta disponible';
      selectionSummary.append(selectedText, availableText);

      const list = document.createElement('div');
      list.className = 'hhr-rx-patient-list';
      patients.forEach(patient => {
        const printable = patient.medicationCount > 0 && !patient.unavailableReason;
        const row = document.createElement('div');
        row.className = 'hhr-rx-patient' + (printable ? '' : ' is-disabled');
        row.dataset.search = normalizedText([
          patient.name,
          patient.run,
          patient.bed,
          patient.room,
          patient.service,
          ...(patient.prescribers || []).map(item => item.professional),
        ].join(' '));
        row.dataset.service = normalizedText(patient.service);
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'hhr-bulk-patient';
        input.value = patient.encounterId;
        input.disabled = !printable;
        input.id = 'hhr-rx-patient-' + patient.encounterId;
        const details = document.createElement('span');
        details.className = 'hhr-rx-patient-details';
        const selectionLabel = document.createElement('label');
        selectionLabel.className = 'hhr-rx-patient-selection';
        selectionLabel.htmlFor = input.id;
        const title = document.createElement('span');
        title.className = 'hhr-rx-patient-title';
        const bed = document.createElement('span');
        bed.className = 'hhr-rx-bed';
        bed.textContent = patient.bed || patient.room || 'Sin cama';
        const name = document.createElement('span');
        name.className = 'hhr-rx-name';
        name.textContent = patient.name || 'Paciente sin nombre';
        title.append(bed, name);
        if (patient.isCurrent) {
          const badge = document.createElement('span');
          badge.className = 'hhr-rx-badge';
          badge.textContent = 'Paciente actual';
          title.appendChild(badge);
        }
        const meta = document.createElement('span');
        meta.className = 'hhr-rx-meta';
        meta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
        title.appendChild(meta);
        const prescribers = document.createElement('span');
        prescribers.className = 'hhr-rx-prescribers';
        if (patient.unavailableReason) {
          prescribers.textContent = 'No fue posible consultar la receta';
          row.title = patient.unavailableReason;
        } else if (!patient.medicationCount) {
          prescribers.textContent = 'Sin fármacos activos';
        } else {
          const items = patient.prescribers || [];
          prescribers.textContent = items
            .map(item => item.professional + ' (' + item.count + ')')
            .join(' · ');
          prescribers.title = items
            .map(item => {
              const dateTime = helper.formatDateTimeLabel(item.validationDateTime);
              return item.professional + ' · ' + item.count +
                (item.count === 1 ? ' fármaco' : ' fármacos') + (dateTime ? ' · ' + dateTime : '');
            })
            .join('\n');
        }
        details.append(title, prescribers);
        selectionLabel.appendChild(details);
        row.append(input, selectionLabel);
        if (printable) {
          const stats = document.createElement('span');
          stats.className = 'hhr-rx-patient-stats';
          const medCount = document.createElement('span');
          medCount.className = 'hhr-rx-med-count';
          medCount.textContent = patient.medicationCount +
            (patient.medicationCount === 1 ? ' fármaco' : ' fármacos');
          stats.appendChild(medCount);
          const latest = (patient.prescribers || [])
            .map(item => item.validationDateTime)
            .filter(Boolean)
            .sort()
            .pop();
          const latestLabel = latest ? helper.formatDateTimeLabel(latest) : '';
          if (latestLabel) {
            const time = document.createElement('span');
            time.className = 'hhr-rx-stat-time';
            time.textContent = latestLabel;
            stats.appendChild(time);
          }
          row.appendChild(stats);
        }
        const openPatient = document.createElement('button');
        openPatient.type = 'button';
        openPatient.className = 'hhr-rx-mini-action hhr-rx-open-patient';
        openPatient.textContent = 'Abrir';
        openPatient.title = 'Abrir las opciones individuales de este paciente';
        openPatient.addEventListener('click', () => {
          createModal(patient.encounterId, 'current', root);
        });
        row.appendChild(openPatient);
        list.appendChild(row);
      });
      body.append(toolbar, selectionSummary, list);
      const formats = renderFormats('hhr-bulk-prescription-format');

      const availableCheckboxes = () => Array.from(list.querySelectorAll('input:not(:disabled)'));
      const selectedCheckboxes = () => Array.from(list.querySelectorAll('input:checked'));
      const updateSelection = () => {
        const count = selectedCheckboxes().length;
        selectedText.textContent = count === 1 ? '1 paciente seleccionado' : count + ' pacientes seleccionados';
        submit.disabled = count === 0;
        submit.textContent = count === 1 ? 'Imprimir 1 receta' : 'Imprimir ' + count + ' recetas';
      };
      attachPatientListFilter({ toolbar, search, list, services: patients.map(patient => patient.service) });
      selectVisible.addEventListener('click', () => {
        availableCheckboxes().forEach(input => { input.checked = true; });
        updateSelection();
      });
      clearSelection.addEventListener('click', () => {
        selectedCheckboxes().forEach(input => { input.checked = false; });
        updateSelection();
      });
      list.addEventListener('change', updateSelection);
      updateSelection();

      submit.onclick = async () => {
        const selected = selectedCheckboxes();
        const selectedFormat = formats.querySelector('input:checked');
        if (!selected.length || !selectedFormat) return;
        submit.disabled = true;
        cancel.disabled = true;
        submit.textContent = 'Preparando ' + selected.length + (selected.length === 1 ? ' receta…' : ' recetas…');
        const result = await sendMessage({
          type: runtimeMessages.HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST,
          batchId: hospitalizedResponse.batchId,
          encIds: selected.map(input => input.value),
          printFormat: selectedFormat.value,
        });
        if (!root.isConnected) return;
        if (!result || result.error) {
          cancel.disabled = false;
          renderError((result && result.error) || 'No se pudieron preparar las recetas seleccionadas.');
          submit.textContent = 'Reintentar impresión';
          submit.disabled = false;
          return;
        }
        const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
        const compactFallbackCount = Array.isArray(result.compactFallbacks)
          ? result.compactFallbacks.length
          : 0;
        showSuccess(
          'Se abrió un PDF con ' + result.count + (result.count === 1 ? ' receta' : ' recetas') +
          ' y el diálogo de impresión.' +
          (skipped ? ' No se pudieron incluir ' + skipped + (skipped === 1 ? ' paciente.' : ' pacientes.') : '') +
          (compactFallbackCount
            ? ' ' + compactFallbackCount + (compactFallbackCount === 1 ? ' receta conservó' : ' recetas conservaron') +
              ' el formato oficial para evitar omitir contenido clínico.'
            : '') +
          ' Puedes ajustar la selección e imprimir nuevamente.',
          updateSelection
        );
      };
    };

    const activateTab = tabName => {
      const requestedTab = tabs.find(tab => tab.dataset.tab === tabName);
      if (!requestedTab || requestedTab.disabled) return;
      activeTab = tabName;
      viewGeneration += 1;
      const generation = viewGeneration;
      tabs.forEach(tab => {
        const selected = tab.dataset.tab === tabName;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      body.setAttribute('aria-labelledby', requestedTab.id || '');
      subtitle.textContent = tabName === 'current'
        ? 'Elige la receta completa o solamente los fármacos indicados por un profesional.'
        : 'Selecciona uno, varios o todos. Se abrirá un único PDF, con fecha, hora y prescriptor por paciente.';
      if (tabName === 'current') renderCurrentPatient(generation);
      else renderHospitalized(generation);
    };
    tabs.forEach(tab => tab.addEventListener('click', () => {
      if (tab.disabled) return;
      if (tab.dataset.tab !== activeTab) activateTab(tab.dataset.tab);
    }));
    tabs.forEach(tab => tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const enabledTabs = tabs.filter(candidate => !candidate.disabled);
      if (!enabledTabs.length) return;
      event.preventDefault();
      const currentIndex = Math.max(0, enabledTabs.indexOf(tab));
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabledTabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + enabledTabs.length) % enabledTabs.length;
      const nextTab = enabledTabs[nextIndex];
      if (nextTab.dataset.tab !== activeTab) activateTab(nextTab.dataset.tab);
      nextTab.focus();
    }));
    activateTab(initialTab === 'hospitalized' || !currentPatientMatchesRoute ? 'hospitalized' : 'current');
  };

  const createHospitalizedDocumentsModal = (kind, encId, existingRoot = null) => {
    const focusReturnTarget = existingRoot && existingRoot.__hhrFocusReturnTarget
      ? existingRoot.__hhrFocusReturnTarget
      : document.activeElement;
    const isRegimen = kind === 'regimen';
    // Indicaciones comparte la sección Recetas y conserva el mismo paciente seleccionado.
    const root = prepareCenterModalRoot({
      existingRoot,
      activeModule: isRegimen ? kind : 'recipes',
      encId,
      focusReturnTarget,
    });
    if (!root) return;
    root.querySelector('.hhr-center-main').innerHTML = `
      <div class="hhr-center-toolbar${isRegimen ? '' : ' hhr-recipes-toolbar'}">
        <h2 class="hhr-center-heading hhr-rx-title" id="hhr-rx-title"></h2>
        ${isRegimen ? '' : `
          <div class="hhr-rx-tabs hhr-rx-module-tabs" role="tablist" aria-label="Sección de recetas">
            <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="recipes" aria-selected="false">Recetas</button>
            <button class="hhr-rx-tab" type="button" role="tab" data-rx-module="indications" aria-selected="true">Indicaciones</button>
          </div>
        `}
      </div>
      <div class="hhr-center-content hhr-center-embed">
        <p class="hhr-rx-subtitle"></p>
        <div class="hhr-rx-body"><div class="hhr-rx-status">Buscando pacientes hospitalizados…</div></div>
      </div>
      <footer class="hhr-rx-footer">
        <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
        <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled></button>
      </footer>
    `;
    const title = root.querySelector('.hhr-rx-title');
    const subtitle = root.querySelector('.hhr-rx-subtitle');
    const body = root.querySelector('.hhr-rx-body');
    const submit = root.querySelector('.hhr-rx-submit');
    const cancel = root.querySelector('.hhr-rx-cancel');
    title.textContent = isRegimen ? 'Regímenes y BRADEN' : 'Recetas';
    subtitle.textContent = isRegimen
      ? 'Genera una tabla única con régimen vigente, observación, fecha, valor BRADEN, clasificación y fecha de escala.'
      : 'Selecciona uno, varios o todos los pacientes. Sus indicaciones oficiales se abrirán en un único PDF.';
    submit.textContent = isRegimen ? 'Imprimir regímenes + BRADEN' : 'Imprimir indicaciones';
    cancel.addEventListener('click', root.__hhrDismiss);
    if (!isRegimen) {
      root.querySelector('[data-rx-module="recipes"]').addEventListener('click', () => {
        runClinicalTransition(root, () => createModal(encId, '', root));
      });
    }

    const renderError = message => {
      body.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'hhr-rx-error';
      error.textContent = message;
      body.appendChild(error);
      submit.disabled = true;
    };
    const showSuccess = (message, restoreSubmitState) => {
      let status = body.querySelector('.hhr-rx-print-feedback');
      if (!status) {
        status = document.createElement('div');
        status.className = 'hhr-rx-status hhr-rx-print-feedback';
        body.prepend(status);
      }
      setLiveRegion(status, message);
      cancel.disabled = false;
      cancel.textContent = 'Cerrar';
      submit.disabled = false;
      if (typeof restoreSubmitState === 'function') restoreSubmitState();
      else submit.textContent = 'Imprimir nuevamente';
    };

    const renderPatients = response => {
      const patients = Array.isArray(response.patients) ? response.patients : [];
      body.innerHTML = '';
      if (!patients.length) {
        body.innerHTML = '<div class="hhr-rx-status">No hay pacientes hospitalizados disponibles.</div>';
        return;
      }
      const toolbar = document.createElement('div');
      toolbar.className = 'hhr-rx-bulk-toolbar';
      const search = document.createElement('input');
      search.className = 'hhr-rx-search';
      search.type = 'search';
      search.placeholder = 'Buscar por paciente, RUN o cama';
      search.setAttribute('aria-label', 'Buscar pacientes hospitalizados');
      toolbar.appendChild(search);
      let selectVisible = null;
      let clearSelection = null;
      if (!isRegimen) {
        selectVisible = document.createElement('button');
        selectVisible.type = 'button';
        selectVisible.className = 'hhr-rx-mini-action';
        selectVisible.textContent = 'Seleccionar todos';
        clearSelection = document.createElement('button');
        clearSelection.type = 'button';
        clearSelection.className = 'hhr-rx-mini-action';
        clearSelection.textContent = 'Limpiar';
        toolbar.append(selectVisible, clearSelection);
      }

      const selectionSummary = document.createElement('div');
      selectionSummary.className = 'hhr-rx-selection-summary';
      const selectedText = document.createElement('span');
      const availableText = document.createElement('span');
      selectionSummary.append(selectedText, availableText);
      const list = document.createElement('div');
      list.className = 'hhr-rx-patient-list';

      patients.forEach(patient => {
        const row = document.createElement(isRegimen ? 'div' : 'label');
        row.className = 'hhr-rx-patient' + (isRegimen ? ' hhr-rx-patient-summary' : '');
        row.dataset.search = normalizedText([
          patient.name,
          patient.run,
          patient.bed,
          patient.room,
          patient.service,
          patient.regimen && patient.regimen.diet,
          patient.regimen && patient.regimen.observation,
        ].join(' '));
        row.dataset.service = normalizedText(patient.service);
        if (!isRegimen) {
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.name = 'hhr-clinical-document-patient';
          input.value = patient.encounterId;
          input.checked = Boolean(patient.isCurrent);
          row.appendChild(input);
        }
        const details = document.createElement('span');
        details.className = 'hhr-rx-patient-details';
        const patientTitle = document.createElement('span');
        patientTitle.className = 'hhr-rx-patient-title';
        const bed = document.createElement('span');
        bed.className = 'hhr-rx-bed';
        bed.textContent = patient.bed || patient.room || 'Sin cama';
        const patientName = document.createElement('span');
        patientName.className = 'hhr-rx-name';
        patientName.textContent = patient.name || 'Paciente sin nombre';
        patientTitle.append(bed, patientName);
        if (patient.isCurrent) {
          const badge = document.createElement('span');
          badge.className = 'hhr-rx-badge';
          badge.textContent = 'Paciente actual';
          patientTitle.appendChild(badge);
        }
        const meta = document.createElement('span');
        meta.className = 'hhr-rx-meta';
        meta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
        patientTitle.appendChild(meta);
        details.append(patientTitle);
        if (isRegimen) {
          const regimenLine = document.createElement('span');
          regimenLine.className = 'hhr-rx-braden-line';
          if (patient.regimenUnavailableReason) {
            regimenLine.classList.add('hhr-rx-braden-missing');
            regimenLine.textContent = 'Régimen no verificable en esta consulta';
          } else if (patient.regimen) {
            const regimenName = document.createElement('strong');
            regimenName.textContent = 'Régimen: ' + patient.regimen.diet;
            const regimenMeta = document.createElement('span');
            regimenMeta.textContent = [
              patient.regimen.observation,
              helper.formatDateTimeLabel(patient.regimen.dateTime),
            ].filter(Boolean).join(' · ');
            regimenLine.append(regimenName, regimenMeta);
          } else {
            regimenLine.classList.add('hhr-rx-braden-missing');
            regimenLine.textContent = 'Sin régimen vigente';
          }
          details.appendChild(regimenLine);
          const bradenLine = document.createElement('span');
          bradenLine.className = 'hhr-rx-braden-line';
          if (patient.braden) {
            const score = document.createElement('span');
            score.className = 'hhr-rx-braden-score';
            score.textContent = 'BRADEN ' + patient.braden.total;
            const bradenMeta = document.createElement('span');
            bradenMeta.textContent = [
              patient.braden.severity,
              helper.formatDateTimeLabel(patient.braden.dateTime),
              patient.braden.author,
            ].filter(Boolean).join(' · ');
            bradenLine.append(score, bradenMeta);
          } else {
            bradenLine.classList.add('hhr-rx-braden-missing');
            bradenLine.textContent = patient.bradenUnavailableReason
              ? 'BRADEN no disponible en esta consulta'
              : 'Sin resultado BRADEN registrado';
          }
          details.appendChild(bradenLine);
        }
        row.appendChild(details);
        list.appendChild(row);
      });
      body.append(toolbar, selectionSummary, list);

      const availableInputs = () => Array.from(list.querySelectorAll('input'));
      const selectedInputs = () => Array.from(list.querySelectorAll('input:checked'));
      const updateSelection = () => {
        if (isRegimen) {
          const regimenCount = Number.isFinite(Number(response.regimenCount))
            ? Number(response.regimenCount)
            : patients.filter(patient => patient.regimen).length;
          const bradenCount = Number.isFinite(Number(response.bradenCount))
            ? Number(response.bradenCount)
            : patients.filter(patient => patient.braden).length;
          selectedText.textContent = patients.length + (patients.length === 1 ? ' paciente hospitalizado' : ' pacientes hospitalizados');
          availableText.textContent = regimenCount + ' con régimen · ' + bradenCount + ' con BRADEN';
          submit.disabled = Number(response.regimenErrorCount || 0) > 0 || Number(response.unavailableCount || 0) > 0;
          submit.textContent = 'Imprimir regímenes y BRADEN';
          if (submit.disabled) submit.title = 'Actualiza: faltan regímenes o resultados BRADEN por verificar.';
          return;
        }
        const count = selectedInputs().length;
        selectedText.textContent = count === 1 ? '1 paciente seleccionado' : count + ' pacientes seleccionados';
        availableText.textContent = patients.length + ' disponibles';
        submit.disabled = count === 0;
        submit.textContent = count === 1 ? 'Imprimir 1 paciente' : 'Imprimir ' + count + ' pacientes';
      };
      attachPatientListFilter({ toolbar, search, list, services: patients.map(patient => patient.service) });
      if (!isRegimen) {
        selectVisible.addEventListener('click', () => {
          availableInputs().forEach(input => { input.checked = true; });
          updateSelection();
        });
        clearSelection.addEventListener('click', () => {
          selectedInputs().forEach(input => { input.checked = false; });
          updateSelection();
        });
        list.addEventListener('change', updateSelection);
      }
      updateSelection();

      submit.onclick = async () => {
        const selected = isRegimen ? [] : selectedInputs();
        if (!isRegimen && !selected.length) return;
        submit.disabled = true;
        cancel.disabled = true;
        submit.textContent = isRegimen
          ? 'Preparando regímenes y BRADEN…'
          : 'Preparando ' + selected.length + (selected.length === 1 ? ' indicación…' : ' indicaciones…');
        const result = await sendMessage(isRegimen
          ? { type: runtimeMessages.HOSPITALIZED_REGIMEN_PRINT_REQUEST }
          : {
              type: runtimeMessages.HOSPITALIZED_INDICATIONS_PRINT_REQUEST,
              batchId: response.batchId,
              encIds: selected.map(input => input.value),
            });
        if (!root.isConnected) return;
        if (!result || result.error) {
          cancel.disabled = false;
          renderError((result && result.error) || 'No se pudo preparar el documento solicitado.');
          submit.disabled = false;
          submit.textContent = 'Reintentar impresión';
          return;
        }
        const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
        showSuccess((isRegimen
          ? 'Se abrió el régimen integrado de ' + result.count + ' pacientes: ' + result.regimenCount +
              ' con régimen vigente y ' + result.bradenCount + ' con BRADEN disponible.'
          : 'Se abrió un PDF con indicaciones de ' + result.count +
              (result.count === 1 ? ' paciente' : ' pacientes') + ' y el diálogo de impresión.' +
              (skipped ? ' No se pudieron incluir ' + skipped + (skipped === 1 ? ' paciente.' : ' pacientes.') : '')) +
          ' Puedes imprimir nuevamente sin cerrar este panel.', updateSelection);
      };
    };

    sendMessage({
      type: isRegimen
        ? runtimeMessages.HOSPITALIZED_REGIMEN_OPTIONS_REQUEST
        : runtimeMessages.HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST,
      currentEncId: encId || '',
    }).then(response => {
      if (!root.isConnected) return;
      if (!response || response.error) {
        renderError((response && response.error) || 'No se pudo leer la lista de hospitalizados.');
        return;
      }
      renderPatients(response);
    });
  };

  const setSyncState = (element, text, state = '') => {
    element.className = 'hhr-sync-state' + (state ? ' is-' + state : '');
    setLiveRegion(element, text, state);
  };

  const centerNavMarkup = activeModule => {
    const items = [
      {
        key: 'home', label: 'Inicio', title: 'Inicio · resumen y accesos directos',
        icon: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
      },
      {
        key: 'recipes', label: 'Rx', title: 'Recetas',
        icon: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
      },
      {
        key: 'handoff', label: 'Turno', title: 'Entrega de turno',
        icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11l2 2 3-4"/>',
      },
      {
        key: 'vitals', label: 'Vitales', title: 'Signos vitales',
        icon: '<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>',
      },
      {
        key: 'scores', label: 'Scores', title: 'Instrumentos',
        icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2M14 7l2-2 2 2 4-4"/>',
      },
      {
        key: 'lab', label: 'Lab', title: 'Exámenes de laboratorio',
        icon: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M8 15h8"/>',
      },
      {
        key: 'imaging', label: 'Imágenes', title: 'Imágenes',
        icon: '<circle cx="12" cy="12" r="3"/><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
      },
    ];
    const navButton = item => `
      <button class="hhr-center-nav-button${item.session ? ' hhr-center-nav-session' : ''}" type="button" data-module="${item.key}"
        title="${item.title}" aria-label="${item.title}" ${item.key === activeModule ? 'aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span>${item.label}</span>
      </button>
    `;
    // Conexiones vive anclado al pie del riel, con estilo de configuración/inicio de sesión.
    return items.map(navButton).join('') + navButton({
      key: 'connection', label: 'Sesión', title: 'Conexiones y sesión', session: true,
      icon: '<circle cx="12" cy="12" r="3"/><path d="M12 4.5V3M12 21v-1.5M19.5 12H21M3 12h1.5M17.3 6.7l1.1-1.1M5.6 18.4l1.1-1.1M17.3 17.3l1.1 1.1M5.6 5.6l1.1 1.1"/>',
    });
  };

  // Shared header + nav rail of the Centro HHR shell. Every module view (recipes and
  // hospitalized documents included) renders inside this frame.
  const centerShellMarkup = activeModule => `
    <div class="hhr-rx-backdrop" aria-hidden="true"></div>
    <section class="hhr-rx-dialog hhr-center-dialog" role="dialog" aria-modal="true" aria-label="Centro HHR">
      <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
      <header class="hhr-center-header">
        <img alt="" aria-hidden="true"><strong>Centro HHR</strong>
      </header>
      <div class="hhr-center-patientbar" hidden>
        <span class="hhr-patientbar-tag">Paciente</span>
        <strong class="hhr-patientbar-name">—</strong>
        <span class="hhr-patientbar-meta"></span>
        <span class="hhr-patientbar-route" hidden>Distinto al episodio abierto en Eloísa</span>
        <button class="hhr-center-action hhr-center-action-primary hhr-patientbar-change" type="button" aria-expanded="false">Cambiar paciente ▾</button>
        <div class="hhr-patientbar-picker" hidden>
          <input class="hhr-rx-search hhr-patientbar-search" type="search"
            placeholder="Buscar por paciente, RUN o cama" aria-label="Buscar paciente en el censo">
          <div class="hhr-patientbar-list" role="listbox" aria-label="Pacientes hospitalizados"></div>
        </div>
      </div>
      <div class="hhr-center-shell">
        <nav class="hhr-center-nav" aria-label="Módulos clínicos">${centerNavMarkup(activeModule)}</nav>
        <main class="hhr-center-main"></main>
      </div>
    </section>
  `;

  const applyCenterShellLogo = root => {
    try {
      root.querySelector('.hhr-center-header img').src = chrome.runtime.getURL('hhr-logo.svg');
    } catch (_error) {
      const img = root.querySelector('.hhr-center-header img');
      if (img) img.remove();
    }
  };

  // Keep one Centro HHR root mounted while its modules change. Rebuilding only the shell contents
  // avoids the visible close/open cycle and also invalidates detached async views safely.
  const prepareCenterModalRoot = ({ existingRoot = null, activeModule, encId, focusReturnTarget }) => {
    if (!existingRoot && !closeModal()) return null;
    ensureStyles();
    const root = existingRoot || document.createElement('div');
    const isNew = !existingRoot;
    if (isNew) {
      root.id = MODAL_ID;
      root.__hhrFocusReturnTarget = focusReturnTarget;
      root.__hhrDismiss = () => {
        return runClinicalTransition(root, () => {
          root.remove();
          const target = root.__hhrFocusReturnTarget;
          if (target && target.isConnected && typeof target.focus === 'function') {
            window.setTimeout(() => target.focus(), 0);
          }
        });
      };
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          root.__hhrDismiss();
          return;
        }
        trapModalFocus(root, event);
      });
    }
    // encounterId tracks the Eloísa route that opened the modal. A patient chosen from the
    // census lives in selectedEncounterId and must not look like a route change to the observer.
    if (isNew) root.dataset.encounterId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
    root.dataset.activeModule = activeModule;
    root.innerHTML = centerShellMarkup(activeModule);
    applyCenterShellLogo(root);
    getClinicalGuard(root);
    root.querySelector('.hhr-rx-close').addEventListener('click', root.__hhrDismiss);
    root.querySelector('.hhr-rx-backdrop').addEventListener('click', root.__hhrDismiss);
    wireCenterNavButtons(root, activeModule, encId, root.__hhrFocusReturnTarget);
    if (isNew) {
      document.body.appendChild(root);
      root.querySelector('.hhr-rx-close').focus();
    } else {
      root.querySelector('.hhr-center-nav-button[aria-current="page"]')?.focus();
    }
    return root;
  };

  // Remembered across openings so the brand button of the bar reopens where the user left off.
  let lastCenterModule = 'home';

  const openCenterModule = (module, encId, trigger) => {
    if (module === 'recipes') createModal(encId);
    else if (module === 'regimen' || module === 'indications') createHospitalizedDocumentsModal(module, encId);
    else createOperationsCenterModal(module, encId, trigger);
  };

  const switchCenterModule = (root, module, encId, focusReturnTarget) => {
    if (module === 'recipes') createModal(encId, '', root);
    else if (module === 'regimen' || module === 'indications') {
      createHospitalizedDocumentsModal(module, encId, root);
    } else createOperationsCenterModal(module, encId, focusReturnTarget, root);
  };

  const wireCenterNavButtons = (root, activeModule, encId, focusReturnTarget) => {
    lastCenterModule = activeModule === 'indications' ? 'recipes' : activeModule;
    root.querySelectorAll('.hhr-center-nav-button').forEach(button => {
      button.addEventListener('click', () => {
        const target = button.dataset.module;
        if (target === activeModule) return;
        runClinicalTransition(root, () =>
          switchCenterModule(root, target, root.dataset.selectedEncounterId || encId, focusReturnTarget)
        );
      });
    });
    const regimenButton = root.querySelector('.hhr-center-regimen-print');
    if (regimenButton) {
      regimenButton.addEventListener('click', () => {
        runClinicalTransition(root, () => {
          root.__hhrDismiss = null;
          root.remove();
          createRegimenQuickDialog();
        });
      });
    }
  };

  // Persistent patient context of the Centro HHR. Patient-bound modules (vitales, laboratorio,
  // imágenes) show WHO they act on and let the user pick any hospitalized patient from the
  // census; census-wide modules state that explicitly. Selecting a patient re-renders the
  // active module bound to that encounter.
  const PATIENT_BOUND_MODULES = new Set(['vitals', 'lab', 'imaging']);
  const setupCenterPatientContext = (root, module, initialEncId, renderModule) => {
    const bar = root.querySelector('.hhr-center-patientbar');
    if (!bar) return;
    const nameEl = bar.querySelector('.hhr-patientbar-name');
    const metaEl = bar.querySelector('.hhr-patientbar-meta');
    const routeBadge = bar.querySelector('.hhr-patientbar-route');
    const changeButton = bar.querySelector('.hhr-patientbar-change');
    const picker = bar.querySelector('.hhr-patientbar-picker');
    const search = bar.querySelector('.hhr-patientbar-search');
    const list = bar.querySelector('.hhr-patientbar-list');
    if (module === 'connection' || module === 'home') return;
    bar.hidden = false;
    if (!PATIENT_BOUND_MODULES.has(module)) {
      nameEl.textContent = 'Todos los hospitalizados';
      metaEl.textContent = 'Este módulo trabaja sobre el censo completo.';
      changeButton.hidden = true;
      return;
    }

    let selected = /^\d+$/.test(String(initialEncId || '')) ? String(initialEncId) : '';
    root.dataset.selectedEncounterId = selected;
    let censusPatients = [];
    let censusLoaded = false;

    const refreshIdentity = async () => {
      const requestedEncId = selected;
      const routeEncId = currentRouteEncounterId();
      routeBadge.hidden = !requestedEncId || !routeEncId || requestedEncId === routeEncId;
      if (!requestedEncId) {
        nameEl.textContent = 'Sin paciente seleccionado';
        metaEl.textContent = 'Elige un paciente del censo para continuar.';
        return;
      }
      nameEl.textContent = 'Identificando…';
      metaEl.textContent = '';
      const response = await sendMessage({ type: runtimeMessages.PATIENT_HEADER_REQUEST, encId: requestedEncId });
      if (!root.isConnected || root.dataset.selectedEncounterId !== requestedEncId) return;
      if (!response || response.error) {
        nameEl.textContent = 'Paciente no identificado';
        metaEl.textContent = String((response && response.error) || '');
        return;
      }
      const patient = response.patient || {};
      nameEl.textContent = patient.name || 'Paciente sin nombre';
      metaEl.textContent = [
        patient.formattedRun || patient.run,
        [patient.bed, patient.service].filter(Boolean).join(' · '),
        patient.age,
        patient.diagnosis,
      ].filter(Boolean).join('  ·  ');
      metaEl.title = metaEl.textContent;
    };

    const renderList = () => {
      list.innerHTML = '';
      const query = normalizedText(search.value);
      censusPatients
        .filter(patient => !query ||
          normalizedText([patient.name, patient.run, patient.bed, patient.service].join(' ')).includes(query))
        .forEach(patient => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'hhr-patientbar-option' + (patient.encounterId === selected ? ' is-selected' : '');
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(patient.encounterId === selected));
          const bed = document.createElement('span');
          bed.className = 'hhr-rx-bed';
          bed.textContent = patient.bed || '—';
          const name = document.createElement('span');
          name.className = 'hhr-patientbar-option-name';
          name.textContent = patient.name || 'Paciente sin nombre';
          const meta = document.createElement('span');
          meta.className = 'hhr-patientbar-option-meta';
          meta.textContent = [patient.run, patient.service, patient.isCurrent ? 'Episodio abierto' : '']
            .filter(Boolean).join(' · ');
          option.append(bed, name, meta);
          option.addEventListener('click', () => {
            if (patient.encounterId === selected) {
              closePicker();
              return;
            }
            runClinicalTransition(root, () => {
              closePicker();
              selected = patient.encounterId;
              root.dataset.selectedEncounterId = selected;
              void refreshIdentity();
              renderModule(selected);
            });
          });
          list.appendChild(option);
        });
      if (!list.children.length) {
        const empty = document.createElement('div');
        empty.className = 'hhr-patientbar-empty';
        empty.textContent = 'Sin coincidencias en el censo.';
        list.appendChild(empty);
      }
    };

    const closePicker = () => {
      picker.hidden = true;
      changeButton.setAttribute('aria-expanded', 'false');
    };
    const openPicker = async () => {
      picker.hidden = false;
      changeButton.setAttribute('aria-expanded', 'true');
      search.value = '';
      search.focus();
      if (!censusLoaded) {
        list.innerHTML = '<div class="hhr-patientbar-empty">Cargando censo…</div>';
        const response = await sendMessage({
          type: runtimeMessages.CENSUS_LIST_REQUEST,
          currentEncId: currentRouteEncounterId(),
        });
        if (!root.isConnected || picker.hidden) return;
        if (!response || response.error) {
          list.innerHTML = '';
          const failure = document.createElement('div');
          failure.className = 'hhr-patientbar-empty';
          failure.textContent = (response && response.error) || 'No se pudo leer el censo.';
          list.appendChild(failure);
          return;
        }
        censusPatients = Array.isArray(response.patients) ? response.patients : [];
        censusLoaded = true;
      }
      renderList();
    };
    changeButton.addEventListener('click', () => {
      if (picker.hidden) void openPicker();
      else closePicker();
    });
    search.addEventListener('input', renderList);
    root.addEventListener('click', event => {
      if (!picker.hidden && !bar.contains(event.target)) closePicker();
    });
    bar.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !picker.hidden) {
        event.stopPropagation();
        closePicker();
        changeButton.focus();
      }
    });
    void refreshIdentity();
  };

  const renderHandoffCenter = (root, encId) => {
    const requestGeneration = String(Number(root.dataset.handoffRequestGeneration || 0) + 1);
    root.dataset.handoffRequestGeneration = requestGeneration;
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Entrega de turno</h2>
        <input class="hhr-center-search" type="search" placeholder="Buscar paciente, RUN o cama" aria-label="Buscar paciente">
        <select class="hhr-center-select hhr-handoff-station" aria-label="Estación de enfermería"><option value="0">Todas las estaciones</option></select>
        <button class="hhr-center-action hhr-handoff-print" type="button">Imprimir</button>
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo entregas desde Eloísa…</div></div>
    `;
    const content = main.querySelector('.hhr-center-content');
    const search = main.querySelector('.hhr-center-search');
    const station = main.querySelector('.hhr-handoff-station');
    const printButton = main.querySelector('.hhr-handoff-print');
    main.querySelector('.hhr-center-refresh').addEventListener('click', () => {
      runClinicalTransition(root, () => renderHandoffCenter(root, encId), { allowUncertain: true });
    });

    const filterRows = () => {
      const query = normalizedText(search.value);
      content.querySelectorAll('tbody tr').forEach(row => {
        row.hidden = Boolean(query) && !String(row.dataset.search || '').includes(query);
      });
    };
    search.addEventListener('input', filterRows);
    printButton.addEventListener('click', async () => {
      printButton.disabled = true;
      printButton.textContent = 'Abriendo…';
      const result = await sendMessage({
        type: runtimeMessages.HANDOFF_REPORT_REQUEST,
        nurseStationId: station.value,
      });
      printButton.disabled = false;
      printButton.textContent = 'Imprimir';
      if (!result || result.error) {
        const notice = document.createElement('div');
        notice.className = 'hhr-center-notice';
        notice.textContent = (result && result.error) || 'No se pudo abrir el reporte de turno.';
        content.prepend(notice);
      }
    });

    sendMessage({ type: runtimeMessages.HANDOFF_OPTIONS_REQUEST, currentEncId: encId || '' }).then(response => {
      if (
        !root.isConnected ||
        root.dataset.activeModule !== 'handoff' ||
        root.dataset.handoffRequestGeneration !== requestGeneration
      ) return;
      content.innerHTML = '';
      if (!response || response.error) {
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = (response && response.error) || 'No se pudieron leer las entregas.';
        content.appendChild(error);
        return;
      }
      const handoffLabel = response.handoffLabel || 'Entrega de turno';
      main.querySelector('.hhr-center-heading').textContent = handoffLabel;
      const nursingLane = response.handoffKind === 'nursing';
      station.hidden = !nursingLane;
      printButton.hidden = !response.canPrint;
      const identityNotice = document.createElement('div');
      identityNotice.className = 'hhr-center-notice';
      identityNotice.textContent = 'Sesión verificada: ' +
        [response.currentProfessionalRole, response.currentProfessional].filter(Boolean).join(' · ') +
        '. Ves las entregas médicas y de enfermería; solo puedes registrar ' + handoffLabel.toLowerCase() + '.';
      content.appendChild(identityNotice);
      (Array.isArray(response.nurseStations) ? response.nurseStations : []).forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        station.appendChild(option);
      });
      if (!response.canWrite) {
        const notice = document.createElement('div');
        notice.className = 'hhr-center-notice';
        notice.textContent = response.writeBlockedReason || 'La sesión permite lectura, pero no ingreso de entregas.';
        content.appendChild(notice);
      }
      const patients = Array.isArray(response.patients) ? response.patients : [];
      if (!patients.length) {
        content.insertAdjacentHTML('beforeend', '<div class="hhr-center-empty">No hay pacientes hospitalizados.</div>');
        return;
      }
      const table = document.createElement('table');
      table.className = 'hhr-center-table hhr-handoff-table';
      table.innerHTML = `
        <colgroup><col style="width:6%"><col style="width:15%"><col style="width:21%"><col style="width:21%"><col style="width:26%"><col style="width:11%"></colgroup>
        <thead><tr><th>Cama</th><th>Paciente / RUN</th><th>Entrega médica</th><th>Entrega enfermería</th><th>Nueva ${response.handoffKind === 'medical' ? 'entrega médica' : 'entrega de enfermería'}</th><th>Estado</th></tr></thead><tbody></tbody>
      `;
      const tbody = table.querySelector('tbody');
      patients.forEach(patient => {
        const handoffKey = clinicalWriteKey('handoff', patient.encounterId);
        const persistedProtection = patient.clinicalWriteProtection || null;
        const uncertainWrite = hydrateClinicalWriteProtection(handoffKey, persistedProtection);
        setClinicalGuardState(root, 'uncertain', handoffKey, Boolean(uncertainWrite));
        const row = document.createElement('tr');
        row.dataset.search = normalizedText([patient.name, patient.run, patient.bed, patient.room, patient.service].join(' '));
        const bedCell = document.createElement('td');
        bedCell.dataset.label = 'Cama';
        bedCell.textContent = patient.bed || patient.room || '-';
        const patientCell = document.createElement('td');
        patientCell.dataset.label = 'Paciente';
        const patientName = document.createElement('span');
        patientName.className = 'hhr-center-patient';
        patientName.textContent = patient.name || 'Paciente sin nombre';
        const patientMeta = document.createElement('span');
        patientMeta.className = 'hhr-center-meta';
        patientMeta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
        patientCell.append(patientName, patientMeta);
        if (patient.diagnosis) {
          const diagnosis = document.createElement('span');
          diagnosis.className = 'hhr-handoff-diagnosis';
          diagnosis.textContent = 'Dg: ' + patient.diagnosis;
          patientCell.appendChild(diagnosis);
        }
        const medicalCell = document.createElement('td');
        medicalCell.dataset.label = 'Entrega médica';
        const nursingCell = document.createElement('td');
        nursingCell.dataset.label = 'Entrega enfermería';
        const laneEmptyText = patient.handoffUnavailableReason ? 'No disponible' : 'Sin entrega registrada';
        const fillLane = (cell, latest) => {
          cell.innerHTML = '';
          if (!latest) {
            cell.textContent = laneEmptyText;
            return;
          }
          cell.textContent = latest.observation;
          const meta = document.createElement('span');
          meta.className = 'hhr-center-meta';
          meta.textContent = [
            latest.author,
            helper.formatDateTimeLabel(latest.dateTime),
            latest.isSigned ? 'Firmado' : latest.requiresValidation ? 'Pendiente de validar' : 'Guardado',
          ].filter(Boolean).join(' · ');
          cell.appendChild(meta);
        };
        fillLane(medicalCell, patient.latestMedical || (response.handoffKind === 'medical' ? patient.latestHandoff : null));
        fillLane(nursingCell, patient.latestNursing || (response.handoffKind === 'nursing' ? patient.latestHandoff : null));
        const ownLaneCell = response.handoffKind === 'medical' ? medicalCell : nursingCell;
        const fillLatest = latest => fillLane(ownLaneCell, latest);
        const editorCell = document.createElement('td');
        editorCell.dataset.label = 'Nueva entrega';
        const textarea = document.createElement('textarea');
        textarea.className = 'hhr-handoff-input';
        textarea.maxLength = 255;
        textarea.placeholder = (response.handoffKind === 'medical' ? 'Nueva entrega médica' : 'Nueva entrega de enfermería') + ' (máx. 255 caracteres)';
        textarea.disabled = !response.canWrite || Boolean(patient.handoffUnavailableReason) || Boolean(uncertainWrite);
        const editorTools = document.createElement('div');
        editorTools.className = 'hhr-handoff-tools';
        const counter = document.createElement('span');
        counter.className = 'hhr-char-count';
        if (uncertainWrite) textarea.value = uncertainWrite.displayObservation || uncertainWrite.observation;
        counter.textContent = textarea.value.length + '/255';
        const save = document.createElement('button');
        save.className = 'hhr-row-save hhr-handoff-save';
        save.type = 'button';
        save.textContent = 'Guardar';
        save.disabled = true;
        editorTools.append(counter, save);
        editorCell.append(textarea, editorTools);
        const statusCell = document.createElement('td');
        statusCell.dataset.label = 'Estado';
        const sync = document.createElement('span');
        setSyncState(
          sync,
          patient.handoffUnavailableReason
            ? 'No disponible'
            : uncertainWrite
              ? uncertainWrite.state === 'awaiting-client-ack'
                ? 'Guardado · confirmar'
                : 'No verificado · protegido'
              : 'Sin cambios',
          patient.handoffUnavailableReason || uncertainWrite ? 'error' : ''
        );
        if (uncertainWrite) sync.title = uncertainWrite.error || 'La escritura permanece protegida hasta confirmar su estado en Eloísa.';
        statusCell.appendChild(sync);
        if (persistedProtection) {
          const release = document.createElement('button');
          release.type = 'button';
          release.className = 'hhr-row-save hhr-protection-action';
          release.textContent = clinicalWriteRecoveryReady(persistedProtection)
            ? 'Actualizar y revisar'
            : 'Espera y actualiza';
          release.disabled = Boolean(
            patient.handoffUnavailableReason || persistedProtection.error ||
              !persistedProtection.generationId ||
              !clinicalWriteRecoveryReady(persistedProtection)
          );
          release.title = release.disabled
            ? 'La lectura o la protección no pudo verificarse; actualiza antes de liberar.'
            : 'Libera únicamente después de revisar la última entrega visible.';
          release.addEventListener('click', async () => {
            release.disabled = true;
            setSyncState(sync, 'Verificando nuevamente…');
            const result = await releaseClinicalWriteProtection(handoffKey, persistedProtection);
            if (!root.isConnected) return;
            if (result && result.cancelled) {
              setSyncState(sync, 'Protegido · sin liberar', 'error');
              release.disabled = false;
              return;
            }
            if (!result || result.error) {
              setSyncState(sync, 'No se liberó', 'error');
              sync.title = String(result && result.error || 'No fue posible liberar la protección.');
              release.disabled = false;
              return;
            }
            uncertainClinicalWrites.delete(handoffKey);
            setClinicalGuardState(root, 'uncertain', handoffKey, false);
            renderHandoffCenter(root, encId);
          });
          statusCell.appendChild(release);
        }
        textarea.addEventListener('input', () => {
          counter.textContent = textarea.value.length + '/255';
          save.disabled = !textarea.value.trim();
          setClinicalGuardState(root, 'dirty', handoffKey, Boolean(textarea.value.trim()));
          setSyncState(sync, textarea.value.trim() ? 'Sin guardar' : 'Sin cambios', textarea.value.trim() ? 'pending' : '');
        });
        save.addEventListener('click', async () => {
          if (!textarea.value.trim()) return;
          const pendingText = textarea.value;
          const startedAt = Date.now();
          save.disabled = true;
          textarea.disabled = true;
          setClinicalGuardState(root, 'dirty', handoffKey, false);
          setClinicalGuardState(root, 'pending', handoffKey, true);
          setSyncState(sync, 'Guardando…', 'pending');
          const result = await sendMessage({
            type: runtimeMessages.HANDOFF_SAVE_REQUEST,
            batchId: response.batchId,
            encId: patient.encounterId,
            observation: pendingText,
          });
          setClinicalGuardState(root, 'pending', handoffKey, false);
          if (!result || result.error) {
            const mayHaveSucceeded = Boolean(result && result.writeMayHaveSucceeded);
            textarea.disabled = mayHaveSucceeded;
            save.disabled = mayHaveSucceeded || !textarea.value.trim();
            if (mayHaveSucceeded) {
              uncertainClinicalWrites.set(handoffKey, {
                observation: normalizedClinicalText(pendingText),
                displayObservation: pendingText,
                startedAt,
                error: result.error || '',
              });
              setClinicalGuardState(root, 'uncertain', handoffKey, true);
              setClinicalGuardState(root, 'dirty', handoffKey, false);
            } else {
              setClinicalGuardState(root, 'dirty', handoffKey, Boolean(textarea.value.trim()));
            }
            setSyncState(sync, mayHaveSucceeded ? 'No verificado · actualiza' : 'Error al guardar', 'error');
            sync.title = (result && result.error) || 'No se pudo guardar.';
            finishRouteChangeWrite(root, mayHaveSucceeded ? 'uncertain' : 'error');
            return;
          }
          uncertainClinicalWrites.delete(handoffKey);
          setClinicalGuardState(root, 'uncertain', handoffKey, false);
          setClinicalGuardState(root, 'dirty', handoffKey, false);
          fillLatest(result.record);
          textarea.value = '';
          counter.textContent = '0/255';
          textarea.disabled = false;
          const persistedState = result.finishConfirmed
            ? 'Terminado'
            : result.record && result.record.isSigned
              ? 'Firmado'
            : result.record && result.record.requiresValidation ? 'Pendiente de validar' : 'Guardado';
          const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt);
          if (!root.isConnected) return;
          if (acknowledged.error) {
            uncertainClinicalWrites.set(handoffKey, {
              observation: '',
              displayObservation: '',
              startedAt,
              error: 'El guardado fue verificado, pero falta confirmar su recepción local. ' +
                acknowledged.error,
            });
            textarea.disabled = true;
            save.disabled = true;
            setClinicalGuardState(root, 'uncertain', handoffKey, true);
            setSyncState(sync, 'Guardado · protegido', 'uncertain');
            sync.title = uncertainClinicalWrites.get(handoffKey).error;
            finishRouteChangeWrite(root, 'uncertain');
            return;
          }
          setSyncState(sync, 'Guardado en Eloísa · ' + persistedState, 'synced');
          finishRouteChangeWrite(root, 'synced');
        });
        row.append(bedCell, patientCell, medicalCell, nursingCell, editorCell, statusCell);
        tbody.appendChild(row);
      });
      content.appendChild(table);
      filterRows();
    });
  };

  const renderScoresCenter = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Scores</h2>
        <select class="hhr-center-select hhr-score-selector" aria-label="Instrumento global">
          <option value="CUDYR">CUDYR</option><option value="DOWNTON">Downton</option><option value="BRADEN">Braden</option>
        </select>
        <input class="hhr-center-search" type="search" placeholder="Buscar paciente, RUN o cama" aria-label="Buscar paciente">
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo instrumentos desde Eloísa…</div></div>
    `;
    const content = main.querySelector('.hhr-center-content');
    const selector = main.querySelector('.hhr-score-selector');
    const search = main.querySelector('.hhr-center-search');
    main.querySelector('.hhr-center-refresh').addEventListener('click', () => {
      runClinicalTransition(root, () => renderScoresCenter(root, encId), { allowUncertain: true });
    });

    sendMessage({ type: runtimeMessages.SCORES_OPTIONS_REQUEST, currentEncId: encId || '' }).then(response => {
      if (!root.isConnected || root.dataset.activeModule !== 'scores') return;
      if (!response || response.error) {
        content.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = (response && response.error) || 'No se pudieron leer los instrumentos.';
        content.appendChild(error);
        return;
      }
      const patients = Array.isArray(response.patients) ? response.patients : [];
      const openScoreForm = (patient, instrument, rerender) => {
        const focusReturnTarget = document.activeElement;
        const scoreKey = clinicalWriteKey('score', patient.encounterId, instrument);
        if (getActiveUncertainWrite(scoreKey)) {
          showPageNotice(
            'Esta aplicación no pudo confirmarse y permanece protegida hasta revisar su estado en Eloísa.',
            { title: instrument + ' · verificación pendiente' }
          );
          return;
        }
        const previous = main.querySelector('.hhr-score-form');
        if (previous) {
          runClinicalTransition(root, () => {
            previous.remove();
            openScoreForm(patient, instrument, rerender);
          }, { allowUncertain: true });
          return;
        }
        const panel = document.createElement('section');
        panel.className = 'hhr-score-form';
        panel.setAttribute('aria-label', 'Registrar ' + instrument);
        panel.innerHTML = `
          <div class="hhr-score-form-header"><strong></strong><button class="hhr-score-form-close" type="button" aria-label="Cerrar">&times;</button></div>
          <div class="hhr-score-form-body"><div class="hhr-center-empty">Cargando formulario oficial…</div></div>
          <div class="hhr-score-form-footer"><span class="hhr-score-preview" role="status" aria-live="polite" aria-atomic="true">Sin calcular</span><button class="hhr-center-action hhr-center-action-primary hhr-score-save" type="button" disabled>Guardar</button></div>
        `;
        panel.querySelector('strong').textContent = instrument + ' · ' + (patient.name || 'Paciente');
        const state = { saving: false, saved: false, uncertain: false };
        const panelClose = panel.querySelector('.hhr-score-form-close');
        const closePanel = () => {
          runClinicalTransition(root, () => {
            panel.remove();
            if (focusReturnTarget && focusReturnTarget.isConnected && typeof focusReturnTarget.focus === 'function') {
              focusReturnTarget.focus();
            } else if (selector && selector.isConnected) {
              selector.focus();
            }
          });
        };
        panelClose.addEventListener('click', closePanel);
        panel.addEventListener('keydown', event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePanel();
            return;
          }
          trapModalFocus(panel, event);
        });
        main.appendChild(panel);
        panelClose.focus();
        sendMessage({
          type: runtimeMessages.SCORE_FORM_REQUEST,
          batchId: response.batchId,
          encId: patient.encounterId,
          instrument,
        }).then(formResponse => {
          if (!panel.isConnected) return;
          const body = panel.querySelector('.hhr-score-form-body');
          const save = panel.querySelector('.hhr-score-save');
          const preview = panel.querySelector('.hhr-score-preview');
          body.innerHTML = '';
          if (!formResponse || formResponse.error) {
            const error = document.createElement('div');
            error.className = 'hhr-rx-error';
            error.setAttribute('role', 'alert');
            error.textContent = (formResponse && formResponse.error) || 'No se pudo cargar el instrumento.';
            body.appendChild(error);
            return;
          }
          const definition = formResponse.definition;
          const controls = [];
          let calculatedValue = '';
          (Array.isArray(definition.fields) ? definition.fields : []).forEach((field, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'hhr-score-field';
            const label = document.createElement('label');
            label.textContent = (index + 1) + '. ' + (field.label || field.id) +
              (field.required === false ? ' (opcional)' : '');
            const safeFieldId = String(field.id || index).replace(/[^a-z0-9_-]/gi, '-');
            const controlId = 'hhr-score-' + patient.encounterId + '-' + instrument.toLowerCase() + '-' + safeFieldId + '-' + index;
            label.htmlFor = controlId;
            wrapper.appendChild(label);
            let explanation = null;
            if (field.explanation) {
              explanation = document.createElement('span');
              explanation.className = 'hhr-score-explanation';
              explanation.id = controlId + '-help';
              explanation.textContent = field.explanation;
              wrapper.appendChild(explanation);
            }
            let control;
            if (Array.isArray(field.options) && field.options.length) {
              control = document.createElement('select');
              control.className = 'hhr-score-control';
              if (field.type === 7) control.multiple = true;
              const placeholder = document.createElement('option');
              placeholder.value = '';
              placeholder.textContent = 'Seleccionar…';
              if (!control.multiple) control.appendChild(placeholder);
              field.options.forEach(option => {
                const item = document.createElement('option');
                item.value = String(instrument === 'CUDYR' ? option.value : option.id);
                item.dataset.optionId = String(option.id);
                item.dataset.score = option.score == null ? '' : String(option.score);
                item.textContent = (instrument === 'CUDYR' ? '[' + option.value + '] ' : '') + option.description;
                control.appendChild(item);
              });
            } else {
              control = document.createElement('input');
              control.className = 'hhr-score-control';
              control.type = field.type === 3 || field.type === 6 ? 'number' : field.type === 4 ? 'date' : field.type === 5 ? 'datetime-local' : 'text';
            }
            control.id = controlId;
            control.required = field.required !== false;
            if (explanation) control.setAttribute('aria-describedby', explanation.id);
            control.dataset.fieldId = field.id;
            control.dataset.typeId = field.typeId == null ? '' : String(field.typeId);
            wrapper.appendChild(control);
            body.appendChild(wrapper);
            controls.push({ field, control });
          });
          const readAnswers = () => {
            const answers = {};
            controls.forEach(({ field, control }) => {
              if (control.multiple) {
                answers[field.id] = Array.from(control.selectedOptions).map(option => option.value).join(',');
              } else {
                answers[field.id] = control.value;
              }
            });
            return answers;
          };
          const setControlsDisabled = disabled => {
            controls.forEach(({ control }) => { control.disabled = disabled; });
          };
          const updatePreview = () => {
            if (state.saving || state.saved || state.uncertain) {
              save.disabled = true;
              return;
            }
            const answered = controls.some(({ control }) => control.multiple
              ? control.selectedOptions.length > 0
              : Boolean(control.value));
            setClinicalGuardState(root, 'dirty', scoreKey, answered);
            const requiredControls = controls.filter(item => item.field.required !== false);
            const complete = requiredControls.length > 0 && requiredControls.every(({ control }) =>
              control.multiple ? control.selectedOptions.length > 0 : Boolean(control.value.trim())
            );
            save.disabled = !complete;
            calculatedValue = '';
            if (!complete) {
              setLiveRegion(preview, answered ? 'Faltan respuestas' : 'Sin calcular');
              return;
            }
            if (instrument === 'CUDYR') {
              let dependency = 0;
              let risk = 0;
              controls.forEach(({ field, control }) => {
                if (Number(field.typeId) === 1) dependency += Number(control.value || 0);
                if (Number(field.typeId) === 2) risk += Number(control.value || 0);
              });
              const dependencyClass = dependency <= 6 ? 3 : dependency <= 12 ? 2 : 1;
              const riskClass = risk <= 5 ? 'D' : risk <= 11 ? 'C' : risk <= 18 ? 'B' : 'A';
              calculatedValue = riskClass + dependencyClass;
              setLiveRegion(preview, 'Resultado ' + calculatedValue + ' · D ' + dependency + ' / R ' + risk);
              return;
            }
            let total = 0;
            controls.forEach(({ control }) => {
              Array.from(control.selectedOptions || []).forEach(option => { total += Number(option.dataset.score || 0); });
            });
            const result = (definition.results || []).find(item => total >= item.minScore && total <= item.maxScore);
            calculatedValue = String(total);
            setLiveRegion(
              preview,
              'Puntaje ' + total + (result && result.valueName ? ' · ' + result.valueName : '')
            );
          };
          controls.forEach(({ control }) => control.addEventListener('change', updatePreview));
          controls.forEach(({ control }) => control.addEventListener('input', updatePreview));
          updatePreview();
          save.addEventListener('click', async () => {
            if (state.saving || state.saved || state.uncertain || !calculatedValue) return;
            const submittedAnswers = readAnswers();
            const submittedValue = calculatedValue;
            const startedAt = Date.now();
            state.saving = true;
            save.disabled = true;
            save.textContent = 'Guardando…';
            setLiveRegion(preview, 'Verificando en Eloísa…');
            setControlsDisabled(true);
            setClinicalGuardState(root, 'dirty', scoreKey, false);
            setClinicalGuardState(root, 'pending', scoreKey, true);
            const result = await sendMessage({
              type: runtimeMessages.SCORE_SAVE_REQUEST,
              batchId: response.batchId,
              encId: patient.encounterId,
              instrument,
              answers: submittedAnswers,
            });
            setClinicalGuardState(root, 'pending', scoreKey, false);
            if (!result || result.error) {
              const mayHaveSucceeded = Boolean(result && result.writeMayHaveSucceeded);
              state.saving = false;
              state.uncertain = mayHaveSucceeded;
              if (mayHaveSucceeded) {
                uncertainClinicalWrites.set(scoreKey, {
                  expectedValue: submittedValue,
                  startedAt,
                  error: result.error || '',
                });
                setClinicalGuardState(root, 'uncertain', scoreKey, true);
                setClinicalGuardState(root, 'dirty', scoreKey, false);
              } else {
                setControlsDisabled(false);
                setClinicalGuardState(root, 'dirty', scoreKey, true);
              }
              if (!panel.isConnected) return;
              save.textContent = mayHaveSucceeded ? 'Bloqueado' : 'Reintentar';
              save.disabled = mayHaveSucceeded;
              setLiveRegion(
                preview,
                mayHaveSucceeded ? 'No verificado · protegido' : 'Error al guardar',
                mayHaveSucceeded ? 'uncertain' : 'error'
              );
              const error = document.createElement('div');
              error.className = 'hhr-center-notice';
              error.setAttribute('role', 'alert');
              error.textContent = (result && result.error) || 'No se pudo guardar el instrumento.';
              body.prepend(error);
              finishRouteChangeWrite(root, mayHaveSucceeded ? 'uncertain' : 'error');
              if (mayHaveSucceeded) renderScoresCenter(root, encId);
              return;
            }
            state.saving = false;
            state.saved = true;
            uncertainClinicalWrites.delete(scoreKey);
            setClinicalGuardState(root, 'uncertain', scoreKey, false);
            setClinicalGuardState(root, 'dirty', scoreKey, false);
            setControlsDisabled(true);
            if (instrument === 'CUDYR') {
              const savedHistoryEntry = {
                category: String(result.record.total),
                recordedAt: result.record.dateTime,
                author: response.currentProfessional || '',
                authorRole: 'Enfermería',
                dependencyScore: result.record.dependency,
                riskScore: result.record.risk,
                items: [],
              };
              patient.scores.CUDYR = {
                crdValue: savedHistoryEntry.category,
                crdDateTime: savedHistoryEntry.recordedAt,
                author: savedHistoryEntry.author,
                authorRole: savedHistoryEntry.authorRole,
                source: 'ficha_medico',
                history: [savedHistoryEntry].concat(
                  patient.scores.CUDYR && Array.isArray(patient.scores.CUDYR.history)
                    ? patient.scores.CUDYR.history
                    : []
                ).slice(0, 20),
              };
            } else {
              patient.scores[instrument] = [result.record].concat(patient.scores[instrument] || []).slice(0, 8);
            }
            const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt);
            if (!panel.isConnected) return;
            if (acknowledged.error) {
              state.saved = false;
              state.uncertain = true;
              uncertainClinicalWrites.set(scoreKey, {
                expectedValue: submittedValue,
                startedAt,
                error: 'El guardado fue verificado, pero falta confirmar su recepción local. ' +
                  acknowledged.error,
              });
              setClinicalGuardState(root, 'uncertain', scoreKey, true);
              save.textContent = 'Bloqueado';
              save.disabled = true;
              setLiveRegion(preview, 'Guardado · protegido', 'uncertain');
              finishRouteChangeWrite(root, 'uncertain');
              renderScoresCenter(root, encId);
              return;
            }
            setLiveRegion(preview, 'Sincronizado en Eloísa');
            save.textContent = 'Guardado';
            save.disabled = true;
            finishRouteChangeWrite(root, 'synced');
            rerender();
            panelClose.focus();
          });
        });
      };

      const renderTable = () => {
        content.innerHTML = '';
        const canWriteInstrument = response.canWriteByInstrument
          ? Boolean(response.canWriteByInstrument[selector.value])
          : Boolean(response.canWrite);
        if (!canWriteInstrument) {
          const notice = document.createElement('div');
          notice.className = 'hhr-center-notice';
          notice.textContent = response.writeBlockedReason || 'La sesión permite lectura, pero no registro de este instrumento.';
          content.appendChild(notice);
        }
        if (selector.value === 'CUDYR') {
          const notice = document.createElement('div');
          notice.className = 'hhr-center-notice';
          notice.textContent = globalThis.HhrPrescriptionPrint.cudyrSourceNotice(response);
          content.appendChild(notice);
        }
        const table = document.createElement('table');
        table.className = 'hhr-center-table hhr-scores-table';
        table.innerHTML = `
          <colgroup><col style="width:7%"><col style="width:25%"><col style="width:13%"><col style="width:15%"><col style="width:17%"><col style="width:14%"><col style="width:9%"></colgroup>
          <thead><tr><th>Cama</th><th>Paciente / RUN</th><th>Último valor</th><th>Última aplicación</th><th>Profesional</th><th>Historia</th><th>Acción</th></tr></thead><tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        patients.forEach(patient => {
          const instrument = selector.value;
          const scoreKey = clinicalWriteKey('score', patient.encounterId, instrument);
          const persistedProtection = patient.scoreProtections && patient.scoreProtections[instrument] || null;
          const raw = patient.scores && patient.scores[instrument];
          const unavailableReason = patient.scoreUnavailableReasons && patient.scoreUnavailableReasons[instrument] || '';
          const history = unavailableReason
            ? []
            : instrument === 'CUDYR'
              ? raw && Array.isArray(raw.history) && raw.history.length
                ? raw.history.map(item => ({
                    total: item.category,
                    dateTime: item.recordedAt,
                    author: item.author || '',
                    authorRole: item.authorRole || '',
                    dependencyScore: item.dependencyScore,
                    riskScore: item.riskScore,
                  }))
                : raw && raw.crdValue
                  ? [{
                      total: raw.crdValue,
                      dateTime: raw.crdDateTime,
                      author: raw.author || '',
                      authorRole: raw.authorRole || '',
                    }]
                  : []
              : Array.isArray(raw) ? raw : [];
          const latest = history[0] || null;
          const uncertainWrite = hydrateClinicalWriteProtection(scoreKey, persistedProtection);
          setClinicalGuardState(root, 'uncertain', scoreKey, Boolean(uncertainWrite));
          const row = document.createElement('tr');
          row.dataset.search = normalizedText([patient.name, patient.run, patient.bed, patient.room, patient.service].join(' '));
          const values = [
            patient.bed || patient.room || '-',
            '',
            unavailableReason ? 'No verificable' : latest ? String(latest.total) + (latest.severity ? ' · ' + latest.severity : '') : 'Sin aplicación',
            unavailableReason ? '-' : latest ? helper.formatDateTimeLabel(latest.dateTime) || '-' : '-',
            unavailableReason ? '-' : latest && latest.author ? latest.author : '-',
          ];
          const bed = document.createElement('td'); bed.dataset.label = 'Cama'; bed.textContent = values[0];
          const patientCell = document.createElement('td');
          patientCell.dataset.label = 'Paciente';
          const name = document.createElement('span'); name.className = 'hhr-center-patient'; name.textContent = patient.name || 'Paciente sin nombre';
          const meta = document.createElement('span'); meta.className = 'hhr-center-meta'; meta.textContent = [patient.run, patient.service].filter(Boolean).join(' · ');
          patientCell.append(name, meta);
          const valueCell = document.createElement('td'); valueCell.dataset.label = 'Último valor'; valueCell.textContent = values[2];
          const dateCell = document.createElement('td'); dateCell.dataset.label = 'Última aplicación'; dateCell.textContent = values[3];
          const authorCell = document.createElement('td');
          authorCell.dataset.label = 'Profesional';
          authorCell.textContent = latest && (latest.author || latest.authorRole) && !unavailableReason
            ? latest.author || latest.authorRole
            : values[4];
          if (!unavailableReason && latest && latest.author && latest.authorRole) {
            const roleMeta = document.createElement('span');
            roleMeta.className = 'hhr-center-meta';
            roleMeta.textContent = latest.authorRole;
            authorCell.appendChild(roleMeta);
          }
          const historyCell = document.createElement('td');
          historyCell.dataset.label = 'Historia';
          const details = document.createElement('details'); details.className = 'hhr-history';
          const summary = document.createElement('summary');
          summary.textContent = uncertainWrite
            ? 'Protegido · revisa el último valor'
            : unavailableReason
            ? 'Lectura no disponible'
            : instrument === 'CUDYR'
              ? history.length + (history.length === 1 ? ' categorización' : ' categorizaciones')
              : history.length + (history.length === 1 ? ' visible' : ' visibles') + ' · máx. 8/120 días';
          if (uncertainWrite) details.title = uncertainWrite.error || 'La escritura permanece protegida hasta confirmar su estado en Eloísa.';
          else if (unavailableReason) details.title = unavailableReason;
          details.appendChild(summary);
          if (!unavailableReason && history.length) {
            const list = document.createElement('ol');
            history.forEach(item => {
              const li = document.createElement('li');
              li.textContent = String(item.total) +
                (item.severity ? ' · ' + item.severity : '') + ' · ' +
                helper.formatDateTimeLabel(item.dateTime) +
                (item.author ? ' · ' + item.author : '') +
                (item.authorRole ? ' (' + item.authorRole + ')' : '') +
                (item.dependencyScore != null && item.riskScore != null
                  ? ' · Dependencia ' + item.dependencyScore + ' / Riesgo ' + item.riskScore
                  : '');
              list.appendChild(li);
            });
            details.appendChild(list);
          }
          historyCell.appendChild(details);
          const actionCell = document.createElement('td');
          actionCell.dataset.label = 'Acción';
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'hhr-center-action';
          if (persistedProtection) {
            action.textContent = clinicalWriteRecoveryReady(persistedProtection)
              ? 'Actualizar y revisar'
              : 'Espera y actualiza';
            action.disabled = Boolean(
              unavailableReason || persistedProtection.error ||
                !persistedProtection.generationId ||
                !clinicalWriteRecoveryReady(persistedProtection)
            );
            action.title = action.disabled
              ? 'La lectura o la protección no pudo verificarse; actualiza antes de liberar.'
              : 'Libera únicamente después de revisar el último valor e historial visibles.';
            action.addEventListener('click', async () => {
              action.disabled = true;
              action.textContent = 'Verificando…';
              const result = await releaseClinicalWriteProtection(scoreKey, persistedProtection);
              if (!root.isConnected) return;
              if (result && result.cancelled) {
                action.textContent = 'Protegido';
                action.title = 'La protección se mantuvo porque no se confirmó la lectura fresca.';
                action.disabled = false;
                return;
              }
              if (!result || result.error) {
                action.textContent = 'No se liberó';
                action.title = String(result && result.error || 'No fue posible liberar la protección.');
                action.disabled = false;
                return;
              }
              uncertainClinicalWrites.delete(scoreKey);
              setClinicalGuardState(root, 'uncertain', scoreKey, false);
              renderScoresCenter(root, encId);
            });
          } else {
            action.textContent = 'Registrar';
            action.disabled = !canWriteInstrument || Boolean(uncertainWrite) || Boolean(unavailableReason);
            if (uncertainWrite) action.title = 'Revisa el estado en Eloísa antes de registrar otra aplicación.';
            else if (unavailableReason) action.title = 'No se puede registrar mientras el historial completo no sea verificable.';
            action.addEventListener('click', () => openScoreForm(patient, instrument, renderTable));
          }
          actionCell.appendChild(action);
          row.append(bed, patientCell, valueCell, dateCell, authorCell, historyCell, actionCell);
          tbody.appendChild(row);
        });
        content.appendChild(table);
        const query = normalizedText(search.value);
        tbody.querySelectorAll('tr').forEach(row => { row.hidden = Boolean(query) && !row.dataset.search.includes(query); });
      };
      let selectedInstrument = selector.value;
      selector.addEventListener('change', () => {
        const nextInstrument = selector.value;
        selector.value = selectedInstrument;
        runClinicalTransition(root, () => {
          selectedInstrument = nextInstrument;
          selector.value = nextInstrument;
          const openPanel = main.querySelector('.hhr-score-form');
          if (openPanel) openPanel.remove();
          renderTable();
        }, { allowUncertain: true });
      });
      search.addEventListener('input', renderTable);
      renderTable();
    });
  };

  const copyText = async text => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  };

  const appendLabTrendChart = (container, trend) => {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 420 130');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Tendencia de ' + trend.analysis);
    const values = trend.points.map(point => Number(point.value));
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const spread = maxValue - minValue || Math.max(Math.abs(maxValue) * 0.1, 1);
    const xFor = index => 24 + (trend.points.length === 1 ? 0 : index * (372 / (trend.points.length - 1)));
    const yFor = value => 108 - ((value - minValue) / spread) * 82;
    const baseline = document.createElementNS(namespace, 'line');
    baseline.setAttribute('x1', '24');
    baseline.setAttribute('x2', '396');
    baseline.setAttribute('y1', '108');
    baseline.setAttribute('y2', '108');
    baseline.setAttribute('stroke', '#d6dfdd');
    svg.appendChild(baseline);
    const polyline = document.createElementNS(namespace, 'polyline');
    polyline.setAttribute('points', trend.points.map((point, index) => `${xFor(index)},${yFor(point.value)}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#15978b');
    polyline.setAttribute('stroke-width', '2');
    svg.appendChild(polyline);
    trend.points.forEach((point, index) => {
      const circle = document.createElementNS(namespace, 'circle');
      circle.setAttribute('cx', String(xFor(index)));
      circle.setAttribute('cy', String(yFor(point.value)));
      circle.setAttribute('r', point.alert ? '4.5' : '3.5');
      circle.setAttribute('fill', point.alert ? '#c94c43' : '#15978b');
      const title = document.createElementNS(namespace, 'title');
      title.textContent = `${point.label}: ${point.value}${trend.unit ? ' ' + trend.unit : ''}`;
      circle.appendChild(title);
      svg.appendChild(circle);
      const label = document.createElementNS(namespace, 'text');
      label.setAttribute('x', String(xFor(index)));
      label.setAttribute('y', String(Math.max(12, yFor(point.value) - 8)));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', point.alert ? '#a43730' : '#43514e');
      label.textContent = String(point.value);
      svg.appendChild(label);
    });
    container.appendChild(svg);
    const labels = document.createElement('div');
    labels.className = 'hhr-lab-trend-labels';
    trend.points.forEach(point => {
      const label = document.createElement('span');
      label.textContent = point.label.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, '');
      labels.appendChild(label);
    });
    container.appendChild(labels);
  };

  const renderLabAnalysis = (host, analysis, activeTab, onTabChange) => {
    host.innerHTML = '';
    const summary = document.createElement('div');
    summary.className = 'hhr-lab-summary';
    const statValues = [
      [`${analysis.summary.reportCount} informes`, ''],
      [`${analysis.summary.findingCount} resultados`, ''],
      [`${analysis.summary.alertCount} fuera de rango / alertas`, analysis.summary.alertCount ? ' is-alert' : ''],
    ];
    statValues.forEach(item => {
      const stat = document.createElement('span');
      stat.className = 'hhr-lab-stat' + item[1];
      stat.textContent = item[0];
      summary.appendChild(stat);
    });
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'hhr-center-action';
    copy.textContent = 'Copiar tabla';
    copy.addEventListener('click', async () => {
      try {
        await copyText(labHelper.comparisonClipboard(analysis));
        copy.textContent = 'Copiada';
      } catch (_error) {
        copy.textContent = 'No se pudo copiar';
      }
      window.setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copiar tabla'; }, 1800);
    });
    summary.appendChild(copy);
    host.appendChild(summary);

    const tabs = document.createElement('div');
    tabs.className = 'hhr-lab-tabs';
    tabs.setAttribute('role', 'tablist');
    [
      ['comparison', 'Comparación'],
      ['trends', 'Tendencias'],
      ['reports', 'Por informe'],
    ].forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hhr-lab-tab';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(activeTab === item[0]));
      button.textContent = item[1];
      button.addEventListener('click', () => onTabChange(item[0]));
      tabs.appendChild(button);
    });
    host.appendChild(tabs);

    if (activeTab === 'comparison') {
      const wrap = document.createElement('div');
      wrap.className = 'hhr-lab-comparison-wrap';
      const table = document.createElement('table');
      table.className = 'hhr-center-table hhr-lab-comparison';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['Variable', ...analysis.columns.map(column => column.label)].forEach(labelText => {
        const th = document.createElement('th');
        th.textContent = labelText;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      analysis.comparison.forEach(row => {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = row.analysis;
        const section = document.createElement('span');
        section.className = 'hhr-center-meta';
        section.textContent = row.section;
        name.append(strong, section);
        tr.appendChild(name);
        analysis.columns.forEach(column => {
          const td = document.createElement('td');
          td.className = 'hhr-lab-value';
          const finding = row.values && row.values[column.key];
          if (!finding) {
            td.textContent = '—';
          } else {
            if (finding.alert) td.classList.add('is-alert');
            td.append(document.createTextNode(finding.result + (finding.unit ? ' ' + finding.unit : '')));
            if (finding.refValue) {
              const ref = document.createElement('span');
              ref.className = 'hhr-lab-ref';
              ref.textContent = 'Ref. ' + finding.refValue;
              td.appendChild(ref);
            }
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      host.appendChild(wrap);
      return;
    }

    if (activeTab === 'trends') {
      if (!analysis.trends.length) {
        const empty = document.createElement('div');
        empty.className = 'hhr-center-empty';
        empty.textContent = 'Se necesitan al menos dos valores numéricos del mismo analito para mostrar tendencias.';
        host.appendChild(empty);
        return;
      }
      const trends = document.createElement('div');
      trends.className = 'hhr-lab-trends';
      analysis.trends.forEach(trend => {
        const card = document.createElement('article');
        card.className = 'hhr-lab-trend-card';
        const title = document.createElement('strong');
        title.textContent = trend.analysis + (trend.unit ? ' · ' + trend.unit : '');
        card.appendChild(title);
        appendLabTrendChart(card, trend);
        trends.appendChild(card);
      });
      host.appendChild(trends);
      return;
    }

    analysis.reports.forEach((report, reportIndex) => {
      const details = document.createElement('details');
      details.className = 'hhr-lab-report';
      details.open = reportIndex === 0;
      const reportSummary = document.createElement('summary');
      reportSummary.textContent = `${report.label} · ${report.findings.length} resultados` +
        (report.examNames.length ? ' · ' + report.examNames.join(', ') : '');
      details.appendChild(reportSummary);
      if (report.error) {
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = report.error;
        details.appendChild(error);
      }
      const table = document.createElement('table');
      table.className = 'hhr-center-table';
      const tbody = document.createElement('tbody');
      report.findings.forEach(finding => {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.dataset.label = 'Examen';
        name.textContent = finding.analysis;
        const value = document.createElement('td');
        value.dataset.label = 'Resultado';
        value.className = 'hhr-lab-value' + (finding.alert ? ' is-alert' : '');
        value.textContent = finding.result + (finding.unit ? ' ' + finding.unit : '');
        const reference = document.createElement('td');
        reference.dataset.label = 'Referencia';
        reference.textContent = finding.refValue || '—';
        const section = document.createElement('td');
        section.dataset.label = 'Sección';
        section.textContent = finding.section;
        tr.append(name, value, reference, section);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      details.appendChild(table);
      host.appendChild(details);
    });
  };

  const renderLabCenter = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    if (!labHelper) {
      main.innerHTML = '<div class="hhr-rx-error">El visor de laboratorio no quedó cargado. Recarga la extensión y la pestaña de Eloísa.</div>';
      return;
    }
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Laboratorio</h2>
        <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de laboratorio">
          <button class="hhr-rx-tab" type="button" role="tab" data-flow="results" aria-selected="true">Ver resultados</button>
          <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="false">Solicitar exámenes</button>
        </div>
        <input class="hhr-center-search hhr-lab-filter" type="search" placeholder="Filtrar por fecha o examen" aria-label="Filtrar informes">
        <button class="hhr-center-action hhr-lab-select-all" type="button" disabled>Seleccionar todos</button>
        <button class="hhr-center-action hhr-center-action-primary hhr-lab-analyze" type="button" disabled>Analizar</button>
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content">
        <div class="hhr-lab-patient"><strong>Verificación Syslab</strong><span>Cruzando identidad Eloísa ↔ Syslab…</span><span class="hhr-lab-status">Conectando a Syslab local</span></div>
        <iframe class="hhr-syslab-login" title="Acceso seguro a Syslab" hidden></iframe>
        <div class="hhr-lab-selection" role="status" aria-live="polite">Buscando exámenes en Syslab…</div>
        <div class="hhr-lab-exam-list"></div>
        <section class="hhr-lab-results" aria-label="Análisis de laboratorio"></section>
      </div>
    `;
    const patientHost = main.querySelector('.hhr-lab-patient');
    const status = main.querySelector('.hhr-lab-selection');
    const list = main.querySelector('.hhr-lab-exam-list');
    const results = main.querySelector('.hhr-lab-results');
    const filter = main.querySelector('.hhr-lab-filter');
    const selectAll = main.querySelector('.hhr-lab-select-all');
    const analyze = main.querySelector('.hhr-lab-analyze');
    const refresh = main.querySelector('.hhr-center-refresh');
    const syslabLogin = main.querySelector('.hhr-syslab-login');
    syslabLogin.src = chrome.runtime.getURL('syslab-login.html');
    main.querySelector('.hhr-flow-tabs [data-flow="request"]').addEventListener('click', () =>
      renderLabRequestView(root, encId)
    );
    let batchId = '';
    let exams = [];
    let selected = new Set();
    let analysis = null;
    let activeTab = 'comparison';
    let requestGeneration = 0;
    let isAnalyzing = false;

    const setSyslabAccess = (connected, message = '') => {
      syslabLogin.hidden = connected;
      const badge = patientHost.querySelector('.hhr-lab-status');
      if (badge) badge.textContent = connected ? 'Syslab conectado' : 'Syslab requiere acceso';
      if (message) syslabLogin.title = message;
    };

    const checkSyslabAccess = async () => {
      const report = await sendMessage({ type: runtimeMessages.SYSLAB_STATUS_REQUEST });
      const connected = Boolean(report && !report.error && report.connected);
      setSyslabAccess(connected, report && (report.error || report.message) || 'No se pudo comprobar Syslab.');
      return connected;
    };

    const invalidateLabAnalysis = () => {
      analysis = null;
      activeTab = 'comparison';
      results.innerHTML = '';
    };

    const visibleExams = () => {
      const query = normalizedText(filter.value);
      return exams.filter(exam => !query || normalizedText([
        exam.date, exam.time, exam.origin, ...(exam.exams || []),
      ].join(' ')).includes(query));
    };
    const updateSelection = () => {
      const selectableCount = Math.min(exams.length, LAB_MAX_SELECTED_EXAMS);
      if (!isAnalyzing) {
        status.textContent = exams.length
          ? `${selected.size} de ${exams.length} informes seleccionados · máximo ${LAB_MAX_SELECTED_EXAMS}`
          : 'No hay informes disponibles para este paciente.';
        analyze.textContent = selected.size ? `Analizar ${selected.size}` : 'Analizar';
      }
      analyze.disabled = isAnalyzing || selected.size === 0;
      selectAll.disabled = isAnalyzing || exams.length === 0;
      selectAll.textContent = selectableCount > 0 && selected.size >= selectableCount
        ? 'Quitar todos' : 'Seleccionar todos';
    };
    const renderList = () => {
      list.innerHTML = '';
      const visible = visibleExams();
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'hhr-center-empty';
        empty.textContent = exams.length ? 'Ningún informe coincide con el filtro.' : 'Syslab no informó exámenes.';
        list.appendChild(empty);
        updateSelection();
        return;
      }
      visible.forEach(exam => {
        const row = document.createElement('label');
        row.className = 'hhr-lab-exam-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(exam.id);
        checkbox.disabled = isAnalyzing || (!checkbox.checked && selected.size >= LAB_MAX_SELECTED_EXAMS);
        checkbox.addEventListener('change', () => {
          const selectionBefore = selected.has(exam.id);
          if (checkbox.checked && selected.size < LAB_MAX_SELECTED_EXAMS) selected.add(exam.id);
          else if (!checkbox.checked) selected.delete(exam.id);
          if (selected.has(exam.id) !== selectionBefore) invalidateLabAnalysis();
          renderList();
        });
        const copy = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'hhr-lab-exam-title';
        title.textContent = `${exam.date}${exam.time ? ' · ' + exam.time : ''}${exam.origin ? ' · ' + exam.origin : ''}`;
        const names = document.createElement('span');
        names.className = 'hhr-lab-exam-names';
        names.textContent = (exam.exams || []).join(' · ') || 'Informe de laboratorio';
        copy.append(title, names);
        const pdf = document.createElement('button');
        pdf.type = 'button';
        pdf.className = 'hhr-center-action';
        pdf.textContent = 'PDF';
        pdf.disabled = isAnalyzing;
        pdf.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          pdf.disabled = true;
          const response = await sendMessage({ type: runtimeMessages.LAB_PDF_OPEN_REQUEST, batchId, examId: exam.id });
          pdf.disabled = false;
          if (!response || response.error) status.textContent = (response && response.error) || 'No se pudo abrir el PDF.';
        });
        row.append(checkbox, copy, pdf);
        list.appendChild(row);
      });
      updateSelection();
    };
    const showAnalysis = () => {
      if (!analysis) return;
      renderLabAnalysis(results, analysis, activeTab, nextTab => {
        activeTab = nextTab;
        showAnalysis();
      });
    };
    const load = async () => {
      const generation = ++requestGeneration;
      isAnalyzing = false;
      batchId = '';
      exams = [];
      selected = new Set();
      invalidateLabAnalysis();
      if (!/^\d+$/.test(String(encId || ''))) {
        patientHost.querySelector('span').textContent =
          'Selecciona un paciente con «Cambiar paciente» en la franja superior.';
        status.textContent = 'Sin paciente seleccionado';
        list.innerHTML = '';
        results.innerHTML = '';
        analyze.disabled = true;
        selectAll.disabled = true;
        return;
      }
      if (!await checkSyslabAccess()) {
        status.textContent = 'Inicio de sesión requerido';
        list.innerHTML = '<div class="hhr-center-empty">Conecta Syslab para consultar los exámenes de este paciente.</div>';
        results.innerHTML = '';
        analyze.disabled = true;
        selectAll.disabled = true;
        filter.disabled = true;
        refresh.disabled = false;
        return;
      }
      status.textContent = 'Buscando exámenes en Syslab…';
      list.innerHTML = '<div class="hhr-center-empty">Consultando la sesión oficial de Syslab en la red local…</div>';
      results.innerHTML = '';
      analyze.disabled = true;
      selectAll.disabled = true;
      filter.disabled = true;
      refresh.disabled = true;
      const response = await sendMessage({ type: runtimeMessages.LAB_SEARCH_REQUEST, encId: encId || '' });
      if (!root.isConnected || root.dataset.activeModule !== 'lab' || generation !== requestGeneration) return;
      filter.disabled = false;
      refresh.disabled = false;
      if (!response || response.error) {
        status.textContent = 'Syslab no disponible';
        list.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = (response && response.error) || 'No se pudo consultar laboratorio.';
        list.appendChild(error);
        return;
      }
      batchId = response.batchId;
      exams = Array.isArray(response.exams) ? response.exams : [];
      selected = new Set(exams.slice(0, 6).map(exam => exam.id));
      analysis = null;
      patientHost.innerHTML = '';
      const patientName = document.createElement('strong');
      patientName.textContent = response.patient && response.patient.name || 'Paciente actual';
      const patientMeta = document.createElement('span');
      patientMeta.textContent = [
        response.patient && response.patient.run,
        response.patient && response.patient.bed ? 'Cama ' + response.patient.bed : '',
        response.patient && response.patient.service,
      ].filter(Boolean).join(' · ');
      const connection = document.createElement('span');
      connection.className = 'hhr-lab-status';
      connection.textContent = 'Syslab conectado directamente';
      patientHost.append(patientName, patientMeta, connection);
      renderList();
    };
    if (syslabLogin.contentWindow) {
      syslabLoginFrameHandlers.set(syslabLogin.contentWindow, data => {
        const connected = Boolean(data.connected);
        setSyslabAccess(connected, String(data.message || ''));
        if (connected) void load();
      });
    }
    filter.addEventListener('input', renderList);
    selectAll.addEventListener('click', () => {
      const selectionBefore = [...selected].sort().join('|');
      const selectableCount = Math.min(exams.length, LAB_MAX_SELECTED_EXAMS);
      if (selectableCount > 0 && selected.size >= selectableCount) selected.clear();
      else {
        selected.clear();
        exams.slice(0, LAB_MAX_SELECTED_EXAMS).forEach(exam => selected.add(exam.id));
      }
      if ([...selected].sort().join('|') !== selectionBefore) invalidateLabAnalysis();
      renderList();
    });
    analyze.addEventListener('click', async () => {
      const generation = ++requestGeneration;
      const requestBatchId = batchId;
      const requestExamIds = [...selected].sort();
      isAnalyzing = true;
      filter.disabled = true;
      refresh.disabled = true;
      renderList();
      analyze.textContent = 'Leyendo y organizando informes…';
      status.textContent = 'Extrayendo resultados desde los PDF seleccionados. Cada bloque tiene un límite de 25 segundos.';
      const response = await sendMessage({
        type: runtimeMessages.LAB_DETAILS_REQUEST,
        batchId: requestBatchId,
        examIds: requestExamIds,
      });
      const currentExamIds = [...selected].sort();
      if (!root.isConnected || root.dataset.activeModule !== 'lab' || generation !== requestGeneration ||
          requestBatchId !== batchId || requestExamIds.join('|') !== currentExamIds.join('|')) return;
      isAnalyzing = false;
      filter.disabled = false;
      refresh.disabled = false;
      if (!response || response.error) {
        renderList();
        status.textContent = (response && response.error) || 'No se pudieron analizar los informes.';
        analyze.textContent = `Reintentar ${selected.size}`;
        return;
      }
      analysis = response.analysis;
      activeTab = 'comparison';
      updateSelection();
      showAnalysis();
      results.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    refresh.addEventListener('click', load);
    load();
  };

  const connectionInitials = value => {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'HHR';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };

  const connectionTimeLabel = source => {
    if (source && source.remainingSeconds == null) return 'Vigencia controlada por Rayen';
    const seconds = Number(source && source.remainingSeconds);
    if (!Number.isFinite(seconds)) return 'Vigencia controlada por Rayen';
    if (seconds <= 0) return 'Sesión vencida';
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    if (minutes < 60) return 'Vence en ' + minutes + (minutes === 1 ? ' minuto' : ' minutos');
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return 'Vence en ' + hours + ' h' + (rest ? ' ' + rest + ' min' : '');
  };

  const fetchPatientHeaderView = async encId => {
    const response = await sendMessage({ type: runtimeMessages.PATIENT_HEADER_REQUEST, encId });
    if (!response || response.error) {
      return { error: (response && response.error) || 'No se pudo identificar al paciente.' };
    }
    const patient = response.patient || {};
    return {
      patient,
      view: requestForms.buildPatientView(patient, patient.formattedRun),
    };
  };

  // Inicio: resumen del Centro con accesos directos a cada módulo y a los documentos del
  // censo (Reg+BRADEN vive aquí como acción de un clic).
  const HOME_SHORTCUTS = [
    { module: 'recipes', icon: 'recipes', title: 'Recetas', desc: 'Imprime recetas del paciente actual o de todos los hospitalizados.' },
    { module: 'handoff', icon: 'handoff', title: 'Entrega de turno', desc: 'Entregas médicas y de enfermería, visibles para todo el equipo.' },
    { module: 'vitals', icon: 'vitals', title: 'Signos vitales', desc: 'Última toma, historial y tendencias por paciente.' },
    { module: 'scores', icon: 'scores', title: 'Scores', desc: 'CUDYR, Downton y Braden de todo el censo.' },
    { module: 'lab', icon: 'lab', title: 'Laboratorio', desc: 'Resultados Syslab y solicitud de exámenes de sangre.' },
    { module: 'imaging', icon: 'imaging', title: 'Imágenes', desc: 'Solicitud con formularios oficiales; informes en preparación.' },
  ];

  const renderHomeCenter = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Inicio</h2></div>
      <div class="hhr-center-content">
        <div class="hhr-home-section-title">Módulos</div>
        <div class="hhr-home-grid">
          ${HOME_SHORTCUTS.map(item => `
            <button class="hhr-home-card" type="button" data-module="${item.module}">
              <span class="hhr-home-card-icon">${ui.icons[item.icon]}</span>
              <strong>${item.title}</strong>
              <span class="hhr-home-card-desc">${item.desc}</span>
            </button>
          `).join('')}
        </div>
        <div class="hhr-home-section-title">Documentos del censo</div>
        <div class="hhr-home-grid hhr-home-grid-actions">
          <button class="hhr-home-card is-action hhr-home-regimen" type="button">
            <span class="hhr-home-card-icon">${ui.icons.regimen}</span>
            <strong>Reg + BRADEN</strong>
            <span class="hhr-home-card-desc">PDF global con régimen vigente y escala BRADEN de todos los pacientes, en un clic.</span>
          </button>
        </div>
      </div>
    `;
    main.querySelectorAll('.hhr-home-card[data-module]').forEach(card => {
      card.addEventListener('click', () => {
        runClinicalTransition(root, () =>
          switchCenterModule(root, card.dataset.module, encId, root.__hhrFocusReturnTarget)
        );
      });
    });
    main.querySelector('.hhr-home-regimen').addEventListener('click', () => {
      runClinicalTransition(root, () => createHospitalizedDocumentsModal('regimen', encId, root));
    });
  };

  // MMRAD · Solicitud de Imágenes — port del panel de HHR: PNG oficial con overlays
  // autocompletados en pantalla y marcado interactivo (cruces X / texto libre); al imprimir,
  // el background rellena la plantilla PDF real con pdf-lib y abre el diálogo de impresión.
  const renderImagingCenter = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    if (!requestForms) {
      main.innerHTML = '<div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Imágenes</h2></div>' +
        '<div class="hhr-center-content"><div class="hhr-rx-error">Los formularios de solicitud no quedaron cargados. Recarga la extensión y la pestaña.</div></div>';
      return;
    }
    const documents = requestForms.IMAGING_DOCUMENTS;
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Imágenes</h2>
        <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de imágenes">
          <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="true">Solicitar</button>
          <button class="hhr-rx-tab" type="button" role="tab" data-flow="reports" aria-selected="false">Ver informes</button>
        </div>
      </div>
      <div class="hhr-center-content">
        <div class="hhr-rx-tabs hhr-imaging-tabs" role="tablist" aria-label="Documento">
          ${Object.values(documents).map((doc, index) => `
            <button class="hhr-rx-tab" type="button" role="tab" data-doc="${doc.id}" aria-selected="${index === 0}">${doc.title}</button>
          `).join('')}
        </div>
        <div class="hhr-imaging-controls">
          <input class="hhr-center-search hhr-imaging-physician" type="text" maxlength="120"
            placeholder="Médico solicitante (nombre y apellido)" aria-label="Médico solicitante">
          <div class="hhr-imaging-tools" role="group" aria-label="Herramientas de marcado">
            <button class="hhr-center-action hhr-imaging-tool is-active" type="button" data-tool="cross" aria-pressed="true">✕ Cruz</button>
            <button class="hhr-center-action hhr-imaging-tool" type="button" data-tool="text" aria-pressed="false">T Texto</button>
            <button class="hhr-center-action hhr-imaging-undo" type="button">Deshacer</button>
          </div>
          <button class="hhr-center-action hhr-center-action-primary hhr-imaging-print" type="button" disabled>Imprimir</button>
        </div>
        <p class="hhr-imaging-hint" id="hhr-imaging-keyboard-hint">Los datos del paciente se completan solos. Haz clic sobre el formulario o usa las flechas para mover el cursor y Enter para marcar; lo que agregues se imprime en el PDF oficial.</p>
        <div class="hhr-imaging-stage">
          <div class="hhr-imaging-canvas" role="group" tabindex="0"
            aria-describedby="hhr-imaging-keyboard-hint"
            aria-label="Vista previa del formulario. Usa las flechas para mover el cursor y Enter para marcar.">
            <img class="hhr-imaging-image" alt="" draggable="false">
            <div class="hhr-imaging-overlays"></div>
          </div>
        </div>
        <div class="hhr-connection-feedback hhr-imaging-feedback" role="status" aria-live="polite"></div>
      </div>
    `;
    const physicianInput = main.querySelector('.hhr-imaging-physician');
    const printButton = main.querySelector('.hhr-imaging-print');
    const undoButton = main.querySelector('.hhr-imaging-undo');
    const canvas = main.querySelector('.hhr-imaging-canvas');
    const image = main.querySelector('.hhr-imaging-image');
    const overlaysHost = main.querySelector('.hhr-imaging-overlays');
    const feedback = main.querySelector('.hhr-imaging-feedback');
    const docTabs = Array.from(main.querySelectorAll('.hhr-imaging-tabs .hhr-rx-tab'));
    const contentHost = main.querySelector('.hhr-center-content');
    main.querySelector('.hhr-flow-tabs [data-flow="reports"]').addEventListener('click', event => {
      main.querySelectorAll('.hhr-flow-tabs .hhr-rx-tab').forEach(tab =>
        tab.setAttribute('aria-selected', String(tab === event.currentTarget)));
      contentHost.innerHTML = `
        <div class="hhr-connection-grid" style="padding-top:12px">
          <section class="hhr-connection-card">
            <div class="hhr-connection-card-header">
              <span class="hhr-connection-icon">IMG</span>
              <div><h3>Visualizar informes</h3><span class="hhr-connection-status">En preparación</span></div>
            </div>
            <div class="hhr-connection-user">Resultados de imagenología
              <span class="hhr-connection-detail">La visualización de informes radiológicos dentro de este panel está en preparación. Por ahora revísalos en el visor habitual del servicio; la solicitud sigue disponible en la pestaña «Solicitar».</span>
            </div>
          </section>
        </div>`;
    });
    main.querySelector('.hhr-flow-tabs [data-flow="request"]').addEventListener('click', () =>
      renderImagingCenter(root, encId)
    );
    if (!/^\d+$/.test(String(encId || ''))) {
      main.querySelector('.hhr-center-content').innerHTML =
        '<div class="hhr-center-empty">Selecciona un paciente con «Cambiar paciente» en la franja superior para autocompletar y solicitar imágenes.</div>';
      return;
    }

    let selectedDoc = 'solicitud';
    let toolMode = 'cross';
    let patientView = null;
    const marksByDoc = { solicitud: [], encuesta: [], consentimiento: [] };
    const keyboardPoint = { x: 50, y: 50 };
    let keyboardActive = false;

    const setFeedback = (message, error = false) => {
      feedback.className = 'hhr-connection-feedback hhr-imaging-feedback' + (error ? ' is-error' : '');
      setLiveRegion(feedback, message, error ? 'error' : '');
    };

    const renderOverlays = () => {
      overlaysHost.innerHTML = '';
      const doc = documents[selectedDoc];
      if (patientView) {
        doc.overlays(patientView, physicianInput.value.trim()).forEach(overlay => {
          if (!overlay.text) return;
          const node = document.createElement('div');
          node.className = 'hhr-imaging-overlay' +
            (overlay.bold ? ' is-bold' : '') + (overlay.small ? ' is-small' : '');
          node.textContent = overlay.text;
          node.style.left = overlay.left;
          node.style.top = overlay.top;
          overlaysHost.appendChild(node);
        });
      }
      marksByDoc[selectedDoc].forEach(mark => {
        const node = document.createElement('div');
        node.className = 'hhr-imaging-mark' + (mark.text ? ' is-text' : '');
        node.textContent = mark.text ? mark.text.toUpperCase() : 'X';
        node.style.left = mark.x + '%';
        node.style.top = mark.y + '%';
        overlaysHost.appendChild(node);
      });
      if (keyboardActive) {
        const cursor = document.createElement('div');
        cursor.className = 'hhr-imaging-keyboard-cursor';
        cursor.style.left = keyboardPoint.x + '%';
        cursor.style.top = keyboardPoint.y + '%';
        cursor.setAttribute('aria-hidden', 'true');
        overlaysHost.appendChild(cursor);
      }
      undoButton.disabled = marksByDoc[selectedDoc].length === 0;
    };

    const renderDocument = () => {
      const doc = documents[selectedDoc];
      canvas.style.aspectRatio = doc.aspectRatio.replace(/\s/g, '');
      try {
        image.src = chrome.runtime.getURL(doc.image);
      } catch (_error) {}
      docTabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.doc === selectedDoc)));
      renderOverlays();
    };

    const openTextEditor = (x, y) => {
      const editor = document.createElement('input');
      let restoreCanvasFocus = false;
      editor.type = 'text';
      editor.maxLength = 80;
      editor.className = 'hhr-imaging-text-editor';
      editor.style.left = x + '%';
      editor.style.top = y + '%';
      editor.setAttribute('aria-label', 'Texto libre sobre el formulario');
      const commit = () => {
        const text = editor.value.trim();
        editor.remove();
        if (text) {
          marksByDoc[selectedDoc].push({ x, y, text });
        }
        if (!restoreCanvasFocus) keyboardActive = false;
        renderOverlays();
        if (restoreCanvasFocus && canvas.isConnected) {
          window.setTimeout(() => canvas.focus({ preventScroll: true }), 0);
        }
      };
      editor.addEventListener('blur', commit);
      editor.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          restoreCanvasFocus = true;
          editor.blur();
        }
        if (event.key === 'Escape') {
          editor.value = '';
          restoreCanvasFocus = true;
          editor.blur();
        }
      });
      overlaysHost.appendChild(editor);
      editor.focus();
    };

    canvas.addEventListener('click', event => {
      if (!patientView) return;
      if (event.target.closest('.hhr-imaging-text-editor')) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10;
      const y = Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10;
      if (toolMode === 'text') openTextEditor(x, y);
      else {
        marksByDoc[selectedDoc].push({ x, y });
        renderOverlays();
      }
    });
    canvas.addEventListener('focus', () => {
      keyboardActive = true;
      renderOverlays();
    });
    canvas.addEventListener('blur', event => {
      if (
        event.relatedTarget &&
        typeof event.relatedTarget.closest === 'function' &&
        event.relatedTarget.closest('.hhr-imaging-text-editor')
      ) return;
      keyboardActive = false;
      renderOverlays();
    });
    canvas.addEventListener('keydown', event => {
      const step = event.shiftKey ? 5 : 1;
      if (event.key === 'ArrowLeft') keyboardPoint.x = Math.max(0, keyboardPoint.x - step);
      else if (event.key === 'ArrowRight') keyboardPoint.x = Math.min(100, keyboardPoint.x + step);
      else if (event.key === 'ArrowUp') keyboardPoint.y = Math.max(0, keyboardPoint.y - step);
      else if (event.key === 'ArrowDown') keyboardPoint.y = Math.min(100, keyboardPoint.y + step);
      else if ((event.key === 'Enter' || event.key === ' ') && patientView) {
        event.preventDefault();
        if (toolMode === 'text') openTextEditor(keyboardPoint.x, keyboardPoint.y);
        else {
          marksByDoc[selectedDoc].push({ x: keyboardPoint.x, y: keyboardPoint.y });
          renderOverlays();
        }
        return;
      } else return;
      event.preventDefault();
      keyboardActive = true;
      renderOverlays();
    });
    main.querySelectorAll('.hhr-imaging-tool').forEach(button => {
      button.addEventListener('click', () => {
        toolMode = button.dataset.tool;
        main.querySelectorAll('.hhr-imaging-tool').forEach(candidate => {
          const active = candidate === button;
          candidate.classList.toggle('is-active', active);
          candidate.setAttribute('aria-pressed', String(active));
        });
      });
    });
    undoButton.addEventListener('click', () => {
      marksByDoc[selectedDoc].pop();
      renderOverlays();
    });
    docTabs.forEach(tab => tab.addEventListener('click', () => {
      if (tab.dataset.doc === selectedDoc) return;
      selectedDoc = tab.dataset.doc;
      renderDocument();
    }));
    physicianInput.addEventListener('input', () => {
      renderOverlays();
    });

    printButton.addEventListener('click', async () => {
      printButton.disabled = true;
      printButton.textContent = 'Generando PDF…';
      setFeedback('Rellenando la plantilla oficial…');
      const result = await sendMessage({
        type: runtimeMessages.IMAGING_FORM_PRINT_REQUEST,
        encId,
        doc: selectedDoc,
        physician: physicianInput.value.trim(),
        marks: marksByDoc[selectedDoc],
      });
      if (!root.isConnected) return;
      printButton.disabled = false;
      printButton.textContent = 'Imprimir';
      if (!result || result.error) {
        setFeedback((result && result.error) || 'No se pudo generar el formulario.', true);
        return;
      }
      setFeedback('Se abrió el PDF con el diálogo de impresión. Puedes seguir marcando e imprimir de nuevo.');
    });

    renderDocument();
    fetchPatientHeaderView(encId).then(result => {
      if (!root.isConnected || root.dataset.activeModule !== 'imaging') return;
      if (result.error) {
        setFeedback(result.error, true);
        return;
      }
      patientView = result.view;
      printButton.disabled = false;
      renderDocument();
    });
  };

  // Signos vitales — datos del formulario VITAL_SIGNS de Ficha Médico (mismo feed que las
  // escalas). Los umbrales HHR se aplican solo a adultos confirmados; en pacientes pediátricos
  // o sin fecha de nacimiento se muestran los valores sin clasificarlos con rangos de adulto.
  // Trend chart with real axes: min/mid/max gridlines with values on the left, first/last
  // date-time under the baseline, and a <title> tooltip (value · timestamp) per point.
  const vitalsSparklineSvg = points => {
    const escSvg = value => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const width = 320;
    const height = 118;
    const padL = 38;
    const padR = 12;
    const padT = 10;
    const padB = 20;
    const values = points.map(point => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = index => padL + (points.length > 1 ? ((width - padL - padR) / (points.length - 1)) * index : 0);
    const y = value => padT + (height - padT - padB) * (1 - (value - min) / span);
    const formatValue = value => (Number.isInteger(value) ? String(value) : value.toFixed(1));
    const mid = (min + max) / 2;
    const gridline = value => `
      <line x1="${padL}" y1="${y(value).toFixed(1)}" x2="${width - padR}" y2="${y(value).toFixed(1)}"
        stroke="#dbe4e1" stroke-width="1" stroke-dasharray="3 3"></line>
      <text x="${padL - 5}" y="${(y(value) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#7c8886">${formatValue(value)}</text>`;
    const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
    const dots = points.map((point, index) => {
      const fill = point.status === 'alert'
        ? '#c94c43'
        : point.status === 'warn'
          ? '#d8a72e'
          : point.status === 'ungraded' ? '#7c8886' : '#0f938c';
      return `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3" fill="${fill}">
        <title>${escSvg(point.at)} · ${formatValue(point.value)}</title>
      </circle>`;
    }).join('');
    const first = points[0];
    const last = points[points.length - 1];
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia">
      ${gridline(max)}${max - min > 1 ? gridline(mid) : ''}${gridline(min)}
      <polyline points="${line}" fill="none" stroke="#0f938c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
      ${dots}
      <text x="${padL}" y="${height - 5}" font-size="8.5" fill="#7c8886">${escSvg(first.at)}</text>
      <text x="${width - padR}" y="${height - 5}" text-anchor="end" font-size="8.5" fill="#7c8886">${escSvg(last.at)}</text>
    </svg>`;
  };

  const renderVitalsCensus = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Signos vitales</h2>
        <input class="hhr-center-search hhr-vitals-search" type="search"
          placeholder="Buscar paciente, RUN o cama" aria-label="Buscar paciente por signos vitales">
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo la última toma de los pacientes hospitalizados…</div></div>
    `;
    const content = main.querySelector('.hhr-center-content');
    const search = main.querySelector('.hhr-vitals-search');
    main.querySelector('.hhr-center-refresh').addEventListener('click', () => renderVitalsCensus(root, encId));
    if (!vitalsHelper) {
      content.innerHTML = '<div class="hhr-rx-error">El módulo de signos vitales no quedó cargado. Recarga la extensión y la pestaña.</div>';
      return;
    }
    const requestGeneration = String(Number(root.dataset.vitalsCensusRequestGeneration || 0) + 1);
    root.dataset.vitalsCensusRequestGeneration = requestGeneration;
    sendMessage({
      type: runtimeMessages.VITALS_CENSUS_REQUEST,
      currentEncId: currentRouteEncounterId() || encId || '',
    }).then(response => {
      if (!root.isConnected || root.dataset.activeModule !== 'vitals' ||
          root.dataset.vitalsCensusRequestGeneration !== requestGeneration) return;
      content.innerHTML = '';
      if (!response || response.error) {
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = (response && response.error) || 'No se pudieron leer los signos vitales del censo.';
        content.appendChild(error);
        return;
      }
      const patients = Array.isArray(response.patients) ? response.patients : [];
      if (!patients.length) {
        content.innerHTML = '<div class="hhr-center-empty">No hay pacientes hospitalizados disponibles.</div>';
        return;
      }
      const notice = document.createElement('div');
      notice.className = 'hhr-center-notice';
      notice.textContent = 'Última toma disponible por paciente. Haz clic en una fila para revisar todo su historial y sus gráficas.';
      content.appendChild(notice);
      const list = document.createElement('div');
      list.className = 'hhr-vitals-census';
      const metrics = vitalsHelper.VITAL_METRICS.slice(0, 6);
      patients.forEach(patient => {
        const records = vitalsHelper.parseVitalSigns(patient.forms);
        const latest = records[0] || null;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'hhr-vitals-patient' + (patient.unavailableReason ? ' is-unavailable' : '');
        row.disabled = Boolean(patient.unavailableReason);
        row.dataset.search = normalizedText([patient.name, patient.run, patient.bed, patient.service].join(' '));
        const bed = document.createElement('span');
        bed.className = 'hhr-vitals-bed';
        bed.textContent = patient.bed || '—';
        const identity = document.createElement('span');
        identity.className = 'hhr-vitals-patient-id';
        const name = document.createElement('strong');
        name.textContent = patient.name || 'Paciente sin nombre';
        const meta = document.createElement('span');
        meta.textContent = patient.run || 'RUN no disponible';
        const time = document.createElement('span');
        time.className = 'hhr-vitals-patient-time';
        time.textContent = patient.unavailableReason
          ? 'No disponible'
          : latest ? 'Última toma · ' + latest.recordedAt : 'Sin registros';
        identity.append(name, meta, time);
        row.append(bed, identity);
        let cohort = 'unknown';
        if (latest && latest.recordedDate) {
          const parts = latest.recordedDate.split('-').map(Number);
          const referenceDate = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date('invalid');
          cohort = vitalsHelper.ageCohort(patient.birthDate, referenceDate);
        }
        const values = document.createElement('span');
        values.className = 'hhr-vitals-values';
        metrics.forEach(metric => {
          const value = document.createElement('span');
          value.className = 'hhr-vitals-summary-value' + (latest ? ' is-' + metric.status(latest, cohort) : '');
          const label = document.createElement('span');
          label.textContent = metric.label;
          const reading = document.createElement('strong');
          reading.textContent = latest ? metric.text(latest) || '–' : '–';
          value.append(label, reading);
          values.appendChild(value);
        });
        row.appendChild(values);
        if (!patient.unavailableReason) {
          row.addEventListener('click', () => {
            createOperationsCenterModal('vitals', patient.encounterId, root.__hhrFocusReturnTarget, root, {
              vitalsView: 'detail',
            });
          });
        }
        list.appendChild(row);
      });
      content.appendChild(list);
      const applyFilter = () => {
        const query = normalizedText(search.value);
        Array.from(list.children).forEach(row => {
          row.hidden = Boolean(query) && !String(row.dataset.search || '').includes(query);
        });
      };
      search.addEventListener('input', applyFilter);
    });
  };

  const renderVitalsCenter = (root, encId, view = 'overview') => {
    if (view !== 'detail') {
      renderVitalsCensus(root, encId);
      return;
    }
    const requestedEncId = String(encId || '');
    root.dataset.selectedEncounterId = requestedEncId;
    const requestGeneration = String(Number(root.dataset.vitalsRequestGeneration || 0) + 1);
    root.dataset.vitalsRequestGeneration = requestGeneration;
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Signos vitales</h2>
        <button class="hhr-center-action hhr-vitals-all" type="button">Todos los pacientes</button>
        <button class="hhr-center-action hhr-vitals-charts" type="button" aria-pressed="false" hidden>Ver gráficas</button>
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo signos vitales desde Eloísa…</div></div>
    `;
    const content = main.querySelector('.hhr-center-content');
    const chartsToggle = main.querySelector('.hhr-vitals-charts');
    main.querySelector('.hhr-vitals-all').addEventListener('click', () => {
      createOperationsCenterModal('vitals', encId, root.__hhrFocusReturnTarget, root, { vitalsView: 'overview' });
    });
    main.querySelector('.hhr-center-refresh').addEventListener('click', () => renderVitalsCenter(root, encId, 'detail'));
    if (!vitalsHelper) {
      content.innerHTML = '<div class="hhr-rx-error">El módulo de signos vitales no quedó cargado. Recarga la extensión y la pestaña.</div>';
      return;
    }
    if (!/^\d+$/.test(String(encId || ''))) {
      content.innerHTML = '<div class="hhr-center-empty">Selecciona un paciente con «Cambiar paciente» en la franja superior para revisar sus signos vitales.</div>';
      return;
    }

    Promise.all([
      sendMessage({ type: runtimeMessages.SCALES_REPORT_REQUEST, encId: requestedEncId }),
      sendMessage({ type: runtimeMessages.PATIENT_HEADER_REQUEST, encId: requestedEncId }),
    ]).then(([response, patientResponse]) => {
      if (
        !root.isConnected ||
        root.dataset.activeModule !== 'vitals' ||
        root.dataset.selectedEncounterId !== requestedEncId ||
        root.dataset.vitalsRequestGeneration !== requestGeneration
      ) return;
      if (!response || response.error) {
        content.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = (response && response.error) || 'No se pudieron leer los signos vitales.';
        content.appendChild(error);
        return;
      }
      const records = vitalsHelper.parseVitalSigns(response.forms);
      content.innerHTML = '';
      if (!records.length) {
        content.insertAdjacentHTML('beforeend',
          '<div class="hhr-center-empty">No hay signos vitales registrados en este episodio.</div>');
        return;
      }
      const metrics = vitalsHelper.VITAL_METRICS;
      const latest = records[0];
      const birthDate = patientResponse && !patientResponse.error
        ? patientResponse.patient && patientResponse.patient.birthDate
        : '';
      const cohortForRecord = record => {
        const parts = String(record && record.recordedDate || '').split('-').map(Number);
        if (parts.length !== 3 || parts.some(value => !value)) return 'unknown';
        const referenceDate = new Date(parts[0], parts[1] - 1, parts[2]);
        if (
          referenceDate.getFullYear() !== parts[0] ||
          referenceDate.getMonth() !== parts[1] - 1 ||
          referenceDate.getDate() !== parts[2]
        ) return 'unknown';
        return vitalsHelper.ageCohort(birthDate, referenceDate);
      };
      const cohort = cohortForRecord(latest);
      const hasUngradedHistory = records.some(record => cohortForRecord(record) !== 'adult');

      if (hasUngradedHistory) {
        const notice = document.createElement('div');
        notice.className = 'hhr-center-notice';
        notice.textContent = cohort === 'pediatric'
          ? 'Paciente pediátrico: umbrales no evaluados; no se aplican rangos de adulto.'
          : cohort === 'unknown'
            ? 'Edad no verificable: umbrales no evaluados. Actualiza para reintentar la identificación.'
            : 'Las tomas previas a los 18 años o sin fecha verificable se muestran como no evaluadas.';
        content.appendChild(notice);
      }

      const latestHead = document.createElement('div');
      latestHead.className = 'hhr-vitals-section-title';
      const latestTitle = document.createElement('span');
      latestTitle.textContent = 'Última toma';
      const latestMeta = document.createElement('span');
      latestMeta.textContent = latest.recordedAt + (latest.author ? ' · ' + latest.author : '');
      latestHead.append(latestTitle, latestMeta);
      content.appendChild(latestHead);
      const grid = document.createElement('div');
      grid.className = 'hhr-vitals-grid';
      metrics.forEach(metric => {
        const text = metric.text(latest);
        const tile = document.createElement('div');
        tile.className = 'hhr-vitals-tile is-' + metric.status(latest, cohort);
        tile.innerHTML = `<span class="hhr-vitals-label">${metric.label}</span>
          <span class="hhr-vitals-value">${text || '–'}</span>
          <span class="hhr-vitals-unit">${metric.unit}</span>`;
        grid.appendChild(tile);
      });
      content.appendChild(grid);
      if (latest.observations) {
        const obs = document.createElement('div');
        obs.className = 'hhr-vitals-obs';
        obs.textContent = 'Observaciones: ' + latest.observations;
        content.appendChild(obs);
      }

      const chartsHost = document.createElement('div');
      chartsHost.className = 'hhr-lab-trends hhr-vitals-trends';
      chartsHost.hidden = true;
      content.appendChild(chartsHost);
      const chartMetrics = metrics.filter(metric => metric.key !== 'insulin' && metric.key !== 'painEva');
      const renderCharts = () => {
        chartsHost.innerHTML = '';
        const chronological = records.slice().reverse();
        chartMetrics.forEach(metric => {
          const points = chronological
            .map(record => ({
              value: metric.key === 'pa' ? record.systolic : metric.series(record),
              status: metric.status(record, cohortForRecord(record)),
              at: record.recordedAt,
            }))
            .filter(point => point.value != null);
          if (points.length < 2) return;
          const card = document.createElement('div');
          card.className = 'hhr-lab-trend-card hhr-vitals-trend-card';
          const cardTitle = document.createElement('strong');
          cardTitle.textContent = metric.label + (metric.unit ? ' · ' + metric.unit : '');
          card.appendChild(cardTitle);
          card.insertAdjacentHTML('beforeend', vitalsSparklineSvg(points));
          const lastReading = points[points.length - 1];
          const lastLine = document.createElement('div');
          lastLine.className = 'hhr-lab-trend-labels';
          lastLine.textContent = 'Último: ' + lastReading.value + (metric.unit ? ' ' + metric.unit : '') +
            ' · ' + lastReading.at + ' · ' + points.length + ' tomas';
          card.appendChild(lastLine);
          chartsHost.appendChild(card);
        });
        if (!chartsHost.children.length) {
          chartsHost.innerHTML = '<div class="hhr-center-empty">No hay suficientes tomas para graficar tendencias.</div>';
        }
      };
      chartsToggle.hidden = false;
      chartsToggle.addEventListener('click', () => {
        const show = chartsHost.hidden;
        chartsHost.hidden = !show;
        if (show) renderCharts();
        chartsToggle.setAttribute('aria-pressed', String(show));
        chartsToggle.textContent = show ? 'Ocultar gráficas' : 'Ver gráficas';
      });

      const historyHead = document.createElement('div');
      historyHead.className = 'hhr-vitals-section-title';
      historyHead.innerHTML = `<span>Historial</span><span>${records.length} ${records.length === 1 ? 'toma' : 'tomas'}</span>`;
      content.appendChild(historyHead);
      const table = document.createElement('table');
      table.className = 'hhr-center-table hhr-vitals-table';
      table.innerHTML = `<thead><tr><th>Hora</th>${metrics.map(metric => `<th>${metric.label}</th>`).join('')}</tr></thead><tbody></tbody>`;
      const tbody = table.querySelector('tbody');
      let currentDay = '';
      records.forEach(record => {
        const day = record.recordedAt.slice(0, 10);
        if (day !== currentDay) {
          currentDay = day;
          const dayRow = document.createElement('tr');
          dayRow.className = 'hhr-vitals-day';
          dayRow.innerHTML = `<td colspan="${metrics.length + 1}">${day}</td>`;
          tbody.appendChild(dayRow);
        }
        const row = document.createElement('tr');
        if (record.observations || record.author) {
          row.title = [record.observations, record.author && 'Registró: ' + record.author]
            .filter(Boolean).join('\n');
        }
        const timeCell = document.createElement('td');
        timeCell.textContent = record.recordedAt.slice(11) || record.recordedAt;
        row.appendChild(timeCell);
        metrics.forEach(metric => {
          const cell = document.createElement('td');
          const status = metric.status(record, cohortForRecord(record));
          if (status !== 'normal') cell.className = 'is-' + status;
          cell.textContent = metric.text(record) || '·';
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });
      const tableWrap = document.createElement('div');
      tableWrap.className = 'hhr-vitals-table-wrap';
      tableWrap.appendChild(table);
      content.appendChild(tableWrap);
    });
  };

  // Solicitud de laboratorio — réplica del formulario oficial HHR (checkboxes por categoría),
  // autocompletada con el paciente actual; imprime vía pestaña dedicada.
  const renderLabRequestView = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    if (!requestForms) return;
    const categories = requestForms.EXAM_CATEGORIES;
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Laboratorio</h2>
        <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de laboratorio">
          <button class="hhr-rx-tab" type="button" role="tab" data-flow="results" aria-selected="false">Ver resultados</button>
          <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="true">Solicitar exámenes</button>
        </div>
        <span class="hhr-labreq-count">0 exámenes seleccionados</span>
        <button class="hhr-center-action hhr-center-action-primary hhr-labreq-print" type="button" disabled>Imprimir solicitud</button>
      </div>
      <div class="hhr-center-content hhr-labreq-content">
        <div class="hhr-labreq-meta">
          <div class="hhr-labreq-meta-group" role="radiogroup" aria-label="Procedencia">
            <span class="hhr-labreq-meta-label">Procedencia</span>
            ${requestForms.PROCEDENCIA_OPTIONS.map(option => `
              <label class="hhr-labreq-chip"><input type="radio" name="hhr-labreq-procedencia" value="${option}" ${option === 'Hospitalización' ? 'checked' : ''}>${option}</label>
            `).join('')}
          </div>
          <div class="hhr-labreq-meta-group" role="radiogroup" aria-label="Previsión">
            <span class="hhr-labreq-meta-label">FONASA</span>
            ${requestForms.FONASA_LEVELS.map(level => `
              <label class="hhr-labreq-chip"><input type="radio" name="hhr-labreq-fonasa" value="${level}">${level}</label>
            `).join('')}
            <label class="hhr-labreq-chip"><input type="checkbox" class="hhr-labreq-prais">PRAIS</label>
          </div>
        </div>
        <div class="hhr-labreq-grid">
          ${requestForms.LAB_FORM_COLUMNS.map(column => `
            <div class="hhr-labreq-column">
              ${column.map(id => {
                const category = categories.find(candidate => candidate.id === id);
                return `
                  <section class="hhr-labreq-section">
                    <header>${category.name}${category.tube ? `<small>${category.tube}</small>` : ''}</header>
                    ${category.exams.map(exam => `
                      <label class="hhr-labreq-exam"><input type="checkbox" data-key="${category.id}|${exam.replace(/"/g, '&quot;')}">${exam}</label>
                    `).join('')}
                  </section>`;
              }).join('')}
            </div>
          `).join('')}
        </div>
        <div class="hhr-labreq-footer">
          <input class="hhr-center-search hhr-labreq-otros" type="text" maxlength="160" placeholder="Otros exámenes" aria-label="Otros exámenes">
          <input class="hhr-center-search hhr-labreq-medico" type="text" maxlength="120" placeholder="Médico tratante" aria-label="Médico tratante">
        </div>
        <div class="hhr-connection-feedback hhr-labreq-feedback" role="status" aria-live="polite"></div>
      </div>
    `;
    const counter = main.querySelector('.hhr-labreq-count');
    const printButton = main.querySelector('.hhr-labreq-print');
    const feedback = main.querySelector('.hhr-labreq-feedback');
    const othersInput = main.querySelector('.hhr-labreq-otros');
    let patientData = null;
    let patientViewData = null;

    main.querySelector('.hhr-flow-tabs [data-flow="results"]').addEventListener('click', () => {
      runClinicalTransition(root, () => renderLabCenter(root, encId));
    });
    const selectedKeys = () => Array.from(main.querySelectorAll('.hhr-labreq-exam input:checked'))
      .map(input => input.dataset.key);
    const updateCount = () => {
      const count = selectedKeys().length + (othersInput.value.trim() ? 1 : 0);
      counter.textContent = count === 1 ? '1 examen seleccionado' : count + ' exámenes seleccionados';
      printButton.disabled = !patientData || count === 0;
    };
    main.querySelector('.hhr-center-content').addEventListener('change', () => {
      updateCount();
    });
    main.querySelector('.hhr-center-content').addEventListener('input', () => {
      updateCount();
    });

    printButton.addEventListener('click', () => {
      if (!patientData) return;
      const fonasa = main.querySelector('input[name="hhr-labreq-fonasa"]:checked');
      const procedencia = main.querySelector('input[name="hhr-labreq-procedencia"]:checked');
      let logoUrl = '';
      try { logoUrl = chrome.runtime.getURL('hhr-logo.svg'); } catch (_error) {}
      const html = requestForms.buildLabRequestPrintHtml({
        patient: {
          name: patientData.name || '',
          run: patientData.formattedRun || patientData.run || '',
          birthDate: patientViewData ? patientViewData.nacimiento : '',
        },
        diagnosis: patientData.diagnosis || '',
        ficha: '',
        procedencia: procedencia ? procedencia.value : 'Hospitalización',
        fonasaLevel: fonasa ? fonasa.value : '',
        prais: main.querySelector('.hhr-labreq-prais').checked,
        selected: selectedKeys(),
        otros: main.querySelector('.hhr-labreq-otros').value.trim(),
        medico: main.querySelector('.hhr-labreq-medico').value.trim(),
        logoUrl,
      });
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        setLiveRegion(feedback, 'El navegador bloqueó la pestaña de impresión. Permite ventanas emergentes.', 'error');
        return;
      }
      let printStarted = false;
      const openPrintDialog = () => {
        if (printStarted || printWindow.closed) return;
        printStarted = true;
        printWindow.focus();
        printWindow.print();
      };
      printWindow.addEventListener('load', openPrintDialog, { once: true });
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      // document.write() does not fire `load` consistently in every supported Chrome build.
      // Keep a guarded fallback so the native dialog still opens exactly once.
      window.setTimeout(openPrintDialog, 300);
      setLiveRegion(feedback, 'Se abrió la solicitud con el diálogo de impresión.');
    });

    if (!/^\d+$/.test(String(encId || ''))) {
      setLiveRegion(feedback,
        'Selecciona un paciente con «Cambiar paciente» en la franja superior para autocompletar la solicitud.');
      return;
    }
    fetchPatientHeaderView(encId).then(result => {
      if (!root.isConnected) return;
      if (result.error) {
        setLiveRegion(feedback, result.error, 'error');
        return;
      }
      patientData = result.patient;
      patientViewData = result.view;
      updateCount();
    });
    updateCount();
  };

  const renderConnectionCenter = (root, _encId) => {
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar">
        <h2 class="hhr-center-heading">Conexiones</h2>
        <button class="hhr-center-action hhr-connection-refresh" type="button">Comprobar</button>
      </div>
      <div class="hhr-center-content">
        <div class="hhr-connection-grid">
          <section class="hhr-connection-card hhr-connection-ficha">
            <div class="hhr-connection-card-header"><span class="hhr-connection-icon">FM</span><div><h3>Ficha Médico</h3><span class="hhr-connection-status">Comprobando…</span></div></div>
            <div class="hhr-connection-user">Sesión clínica<span class="hhr-connection-detail">Leyendo identidad vigente…</span></div>
          </section>
          <section class="hhr-connection-card hhr-connection-camas">
            <div class="hhr-connection-card-header"><span class="hhr-connection-icon">GC</span><div><h3>Gestión de Camas</h3><span class="hhr-connection-status">Comprobando…</span></div></div>
            <div class="hhr-connection-user">Cuenta Rayen<span class="hhr-connection-detail">Necesaria para egresos, Alta Administrativa e historial CUDYR.</span></div>
            <div class="hhr-connection-actions">
              <button class="hhr-center-action hhr-center-action-primary hhr-connection-connect" type="button">Conectar</button>
              <button class="hhr-center-action hhr-connection-forget" type="button" hidden>Olvidar</button>
            </div>
          </section>
        </div>
        <div class="hhr-connection-privacy"><strong>Acceso protegido.</strong> La contraseña se ingresa únicamente en la página oficial de Rayen. La extensión conserva temporalmente el token de acceso durante esta sesión de Chrome y lo elimina al olvidar la conexión, recargar la extensión o cerrar el navegador.</div>
        <div class="hhr-connection-feedback" role="status" aria-live="polite" aria-atomic="true"></div>
      </div>
    `;
    const fichaCard = main.querySelector('.hhr-connection-ficha');
    const camasCard = main.querySelector('.hhr-connection-camas');
    const connect = main.querySelector('.hhr-connection-connect');
    const forget = main.querySelector('.hhr-connection-forget');
    const refresh = main.querySelector('.hhr-connection-refresh');
    const feedback = main.querySelector('.hhr-connection-feedback');
    let pollingGeneration = 0;
    let shouldRenewSession = false;

    const setFeedback = (message, error = false) => {
      feedback.className = 'hhr-connection-feedback' + (error ? ' is-error' : '');
      setLiveRegion(feedback, message, error ? 'error' : '');
    };

    const renderSource = (card, source, fallbackName) => {
      const ready = source && source.status === 'ready';
      const stale = source && source.status === 'stale';
      card.className = card.className.replace(/\s+is-(?:ready|stale|missing)/g, '') +
        (ready ? ' is-ready' : stale ? ' is-stale' : ' is-missing');
      card.querySelector('.hhr-connection-status').textContent = ready
        ? 'Conectado'
        : stale
          ? source && source.remainingSeconds != null && Number(source.remainingSeconds) === 0
            ? 'Sesión vencida'
            : 'Requiere comprobación'
          : 'No conectado';
      const identity = source && source.identity || {};
      const name = identity.fullName || identity.username || fallbackName;
      const user = card.querySelector('.hhr-connection-user');
      user.childNodes[0].nodeValue = name || 'Cuenta no identificada';
      const role = identity.role || '';
      user.querySelector('.hhr-connection-detail').textContent = ready
        ? [role, connectionTimeLabel(source)].filter(Boolean).join(' · ')
        : String(source && source.message || 'Inicia sesión para continuar.');
    };

    const load = async () => {
      refresh.disabled = true;
      const report = await sendMessage({ type: runtimeMessages.EXTENSION_HEALTH_REQUEST });
      refresh.disabled = false;
      if (!root.isConnected) return null;
      if (!report || report.error) {
        setFeedback((report && report.error) || 'No se pudo comprobar la conexión.', true);
        return null;
      }
      const ficha = report.fichaMedico || {};
      const camas = report.gestionCamas || {};
      const fichaName = ficha.identity && ficha.identity.fullName || 'Sesión de Ficha Médico';
      renderSource(fichaCard, ficha, fichaName);
      renderSource(camasCard, camas, 'Cuenta autenticada en Gestión de Camas');
      shouldRenewSession = camas.connectionSource === 'session';
      connect.textContent = camas.status === 'ready' ? 'Renovar' : 'Conectar';
      forget.hidden = camas.status !== 'ready' && camas.status !== 'stale';
      refreshOperationsConnectionBadge(document.getElementById(OPERATIONS_BAR_ID), true, report);
      return report;
    };

    const pollUntilConnected = generation => {
      let attempts = 0;
      const poll = async () => {
        if (!root.isConnected || generation !== pollingGeneration) return;
        const report = await load();
        if (report && report.gestionCamas && report.gestionCamas.status === 'ready') {
          connect.disabled = false;
          setFeedback('Gestión de Camas quedó conectada. Puedes continuar trabajando solo en Ficha Médico.');
          return;
        }
        attempts += 1;
        if (attempts >= 120) {
          connect.disabled = false;
          setFeedback('No se detectó una sesión. Completa el acceso en la ventana oficial y vuelve a comprobar.', true);
          return;
        }
        window.setTimeout(poll, 1000);
      };
      window.setTimeout(poll, 700);
    };

    refresh.addEventListener('click', () => { void load(); });
    connect.addEventListener('click', async () => {
      connect.disabled = true;
      setFeedback('Abriendo la página oficial de Gestión de Camas…');
      const response = await sendMessage({
        type: runtimeMessages.GC_CONNECT_REQUEST,
        renew: shouldRenewSession,
      });
      if (!response || response.error) {
        connect.disabled = false;
        setFeedback((response && response.error) || 'No se pudo abrir Gestión de Camas.', true);
        return;
      }
      setFeedback(response.message || 'Completa el acceso en la ventana oficial de Rayen.');
      pollingGeneration += 1;
      pollUntilConnected(pollingGeneration);
    });
    forget.addEventListener('click', async () => {
      pollingGeneration += 1;
      const response = await sendMessage({ type: runtimeMessages.GC_DISCONNECT_REQUEST });
      connect.disabled = false;
      if (!response || response.error) {
        setFeedback((response && response.error) || 'No se pudo olvidar la conexión.', true);
        return;
      }
      setFeedback('La sesión temporal de Gestión de Camas fue eliminada de la extensión.');
      await load();
    });
    void load();
  };

  const barPart = (bar, selector) => {
    const root = bar && bar.__hhrRoot;
    return root ? root.querySelector(selector) : null;
  };

  let operationsConnectionCheckAt = 0;
  let operationsConnectionCheck = null;
  const refreshOperationsConnectionBadge = (bar, force = false, knownReport = null) => {
    if (!bar) return Promise.resolve(null);
    const button = barPart(bar, '.hhr-ops-session');
    if (!button) return Promise.resolve(null);
    const apply = report => {
      if (!report || !bar.isConnected) return report;
      const ficha = report.fichaMedico || {};
      const camas = report.gestionCamas || {};
      const identity = ficha.identity || {};
      const name = identity.fullName || 'Sesión HHR';
      const role = String(identity.role || '');
      const handoffButton = barPart(bar, '.hhr-ops-handoff');
      if (handoffButton) {
        const handoffTitle = globalThis.HhrPrescriptionPrint.handoffLabelForIdentity(
          role,
          identity.practitionerRoleId
        );
        handoffButton.dataset.tip = handoffTitle;
        handoffButton.setAttribute('aria-label', handoffTitle);
      }
      const state = ficha.status !== 'ready'
        ? 'is-offline'
        : camas.status === 'ready' ? 'is-ready' : 'is-degraded';
      button.classList.remove('is-ready', 'is-degraded', 'is-offline');
      button.classList.add(state);
      button.querySelector('.hhr-ops-avatar').textContent = connectionInitials(name);
      const sessionName = button.querySelector('.session-name');
      if (sessionName) sessionName.textContent = name;
      const sessionState = button.querySelector('.session-state');
      if (sessionState) {
        sessionState.textContent = state === 'is-ready'
          ? 'Conectado'
          : state === 'is-degraded' ? 'Conexión parcial' : 'Sin conexión';
      }
      const details = [
        ficha.status === 'ready' ? 'Ficha Médico conectada' : 'Ficha Médico no conectada',
        camas.status === 'ready'
          ? 'Gestión de Camas · ' + connectionTimeLabel(camas)
          : 'Gestión de Camas no conectada',
      ];
      button.dataset.tip = name;
      button.dataset.tipNote = details.join(' · ');
      button.setAttribute('aria-label', [name, ...details].join(' · '));
      return report;
    };
    if (knownReport) {
      operationsConnectionCheckAt = Date.now();
      return Promise.resolve(apply(knownReport));
    }
    if (!force && Date.now() - operationsConnectionCheckAt < 30 * 1000) return Promise.resolve(null);
    if (operationsConnectionCheck) return operationsConnectionCheck;
    operationsConnectionCheck = sendMessage({ type: runtimeMessages.EXTENSION_HEALTH_REQUEST })
      .then(report => apply(report && !report.error ? report : null))
      .finally(() => {
        operationsConnectionCheckAt = Date.now();
        operationsConnectionCheck = null;
      });
    return operationsConnectionCheck;
  };

  const createOperationsCenterModal = (module, encId, returnFocusTarget = null, existingRoot = null, options = {}) => {
    const focusReturnTarget = existingRoot && existingRoot.__hhrFocusReturnTarget
      ? existingRoot.__hhrFocusReturnTarget
      : returnFocusTarget || document.activeElement;
    const activeModule = ['scores', 'connection', 'lab', 'imaging', 'vitals', 'home'].includes(module) ? module : 'handoff';
    const root = prepareCenterModalRoot({
      existingRoot,
      activeModule,
      encId,
      focusReturnTarget,
    });
    if (!root) return;
    const renderModule = targetEncId => {
      if (activeModule === 'handoff') renderHandoffCenter(root, targetEncId);
      else if (activeModule === 'scores') renderScoresCenter(root, targetEncId);
      else if (activeModule === 'lab') renderLabRequestView(root, targetEncId);
      else if (activeModule === 'imaging') renderImagingCenter(root, targetEncId);
      else if (activeModule === 'vitals') renderVitalsCenter(root, targetEncId, options.vitalsView || 'overview');
      else if (activeModule === 'home') renderHomeCenter(root, targetEncId);
      else renderConnectionCenter(root, targetEncId);
    };
    setupCenterPatientContext(root, activeModule, encId, renderModule);
    if (activeModule === 'vitals' && options.vitalsView !== 'detail') {
      root.querySelector('.hhr-center-patientbar').hidden = true;
    }
    renderModule(encId);
  };

  const findPharmaHeading = () => {
    const candidates = document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],p,span,div');
    return (
      Array.from(candidates)
        .filter(element => normalizedText(element.textContent) === 'farmacos')
        .sort((a, b) => a.childElementCount - b.childElementCount)[0] || null
    );
  };

  const downloadIndications = async (encId, button) => {
    if (currentRouteEncounterId() !== String(encId || '')) {
      createFeedbackModal({
        title: 'Indicaciones',
        message: 'El episodio cambió. Vuelve a abrir Indicaciones desde el paciente actual.',
        error: true,
      });
      return;
    }
    button.disabled = true;
    const result = await sendMessage({ type: runtimeMessages.INDICATIONS_PRINT_REQUEST, encId });
    button.disabled = false;
    if (!result || result.error) {
      createFeedbackModal({
        title: 'Indicaciones',
        message: (result && result.error) || 'No se pudo descargar el reporte de indicaciones.',
        error: true,
      });
      return;
    }
    createFeedbackModal({
      title: 'Indicaciones',
      message: 'PDF de indicaciones descargado. Ábrelo desde Descargas para imprimir.',
    });
  };

  const hasVisibleNursingRole = () => {
    const roleLabels = document.querySelectorAll('span,p,small,div');
    return Array.from(roleLabels).some(element => {
      const text = normalizedText(element.textContent);
      return (
        text === 'enfermera(o)' ||
        text === 'enfermero(a)' ||
        text === 'enfermera' ||
        text === 'enfermero'
      );
    });
  };

  const findToolbarAnchor = heading => {
    const card =
      heading.closest('[class*="MuiPaper"], [class*="MuiCard"], section, article') ||
      heading.parentElement?.parentElement ||
      document.body;
    const textNodes = card.querySelectorAll('label,span,div,p');
    const suspended = Array.from(textNodes)
      .filter(element => normalizedText(element.textContent).includes('mostrar suspendidos'))
      .sort((a, b) => String(a.textContent || '').length - String(b.textContent || '').length)[0];
    if (!suspended) return heading.parentElement || heading;
    return suspended.closest('label') || suspended;
  };

  const updateOperationsBarPosition = bar => {
    if (!bar || window.matchMedia('(max-width: 560px)').matches) return;
    const sampledElements = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(Math.max(1, Math.round(window.innerWidth / 2)), 2)
      : [];
    const candidates = Array.from(new Set([
      ...document.querySelectorAll(
        'header,[role="banner"],[class*="MuiAppBar"],[class*="appbar" i],[class*="app-bar" i]'
      ),
      ...sampledElements,
    ]))
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => {
        if (element === bar || bar.contains(element)) return false;
        return (
          rect.top >= -4 && rect.top <= 6 &&
          rect.width >= window.innerWidth * 0.65 &&
          rect.height >= 42 && rect.height <= 118 &&
          rect.bottom >= 42 && rect.bottom <= 122
        );
      })
      .sort((a, b) => b.rect.bottom - a.rect.bottom);
    const headerBottom = candidates[0]?.rect.bottom || 64;
    bar.style.setProperty('--hhr-ops-top', Math.round(headerBottom + 5) + 'px');
  };

  // Regímenes y BRADEN dejó de ser una sección completa: el valor está en el PDF global.
  // Este diálogo compacto verifica el censo, muestra el resumen y lo imprime en un clic.
  const createRegimenQuickDialog = () => {
    const focusReturnTarget = document.activeElement;
    if (!closeModal()) return;
    ensureStyles();
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.innerHTML = `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog hhr-rx-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="hhr-rx-title">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <header class="hhr-rx-header">
          <h2 class="hhr-rx-title" id="hhr-rx-title">Regímenes y BRADEN</h2>
          <p class="hhr-rx-subtitle">PDF global con régimen vigente y escala BRADEN de todos los hospitalizados.</p>
        </header>
        <div class="hhr-rx-body"><div class="hhr-rx-status">Verificando censo…</div></div>
        <footer class="hhr-rx-footer">
          <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
          <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled>Imprimir PDF global</button>
        </footer>
      </section>
    `;
    document.body.appendChild(root);
    const body = root.querySelector('.hhr-rx-body');
    const submit = root.querySelector('.hhr-rx-submit');
    const cancel = root.querySelector('.hhr-rx-cancel');
    const dismiss = modalDismissWithFocusRestore(root, focusReturnTarget);
    root.__hhrDismiss = dismiss;
    cancel.addEventListener('click', dismiss);
    root.querySelector('.hhr-rx-close').addEventListener('click', dismiss);
    root.querySelector('.hhr-rx-backdrop').addEventListener('click', dismiss);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      trapModalFocus(root, event);
    });
    root.querySelector('.hhr-rx-close').focus();

    const renderError = message => {
      body.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'hhr-rx-error';
      error.textContent = message;
      body.appendChild(error);
      submit.disabled = true;
    };

    sendMessage({ type: runtimeMessages.HOSPITALIZED_REGIMEN_OPTIONS_REQUEST, currentEncId: '' }).then(response => {
      if (!root.isConnected) return;
      if (!response || response.error) {
        renderError((response && response.error) || 'No se pudo leer la lista de hospitalizados.');
        return;
      }
      const patients = Array.isArray(response.patients) ? response.patients : [];
      if (!patients.length) {
        body.innerHTML = '<div class="hhr-rx-status">No hay pacientes hospitalizados disponibles.</div>';
        return;
      }
      const regimenCount = Number.isFinite(Number(response.regimenCount))
        ? Number(response.regimenCount)
        : patients.filter(patient => patient.regimen).length;
      const bradenCount = Number.isFinite(Number(response.bradenCount))
        ? Number(response.bradenCount)
        : patients.filter(patient => patient.braden).length;
      body.innerHTML = '';
      const summary = document.createElement('div');
      summary.className = 'hhr-lab-summary';
      [
        patients.length + (patients.length === 1 ? ' paciente hospitalizado' : ' pacientes hospitalizados'),
        regimenCount + ' con régimen vigente',
        bradenCount + ' con BRADEN',
      ].forEach(text => {
        const stat = document.createElement('span');
        stat.className = 'hhr-lab-stat';
        stat.textContent = text;
        summary.appendChild(stat);
      });
      body.appendChild(summary);
      const blocked = Number(response.regimenErrorCount || 0) > 0 || Number(response.unavailableCount || 0) > 0;
      if (blocked) {
        const notice = document.createElement('div');
        notice.className = 'hhr-center-notice';
        notice.textContent = 'Faltan regímenes o resultados BRADEN por verificar. Cierra y reintenta antes de imprimir.';
        body.appendChild(notice);
      }
      submit.disabled = blocked;
      submit.onclick = async () => {
        submit.disabled = true;
        cancel.disabled = true;
        submit.textContent = 'Preparando PDF…';
        const result = await sendMessage({ type: runtimeMessages.HOSPITALIZED_REGIMEN_PRINT_REQUEST });
        if (!root.isConnected) return;
        cancel.disabled = false;
        if (!result || result.error) {
          renderError((result && result.error) || 'No se pudo preparar el documento.');
          submit.disabled = false;
          submit.textContent = 'Reintentar impresión';
          return;
        }
        let feedback = body.querySelector('.hhr-rx-print-feedback');
        if (!feedback) {
          feedback = document.createElement('div');
          feedback.className = 'hhr-rx-status hhr-rx-print-feedback';
          body.prepend(feedback);
        }
        setLiveRegion(feedback,
          'Se abrió el régimen integrado de ' + result.count + ' pacientes: ' + result.regimenCount +
          ' con régimen vigente y ' + result.bradenCount + ' con BRADEN disponible.');
        cancel.textContent = 'Cerrar';
        submit.disabled = false;
        submit.textContent = 'Imprimir nuevamente';
      };
    });
  };

  // Favoritos: accesos rápidos a páginas web, persistidos localmente en el navegador.
  const FAVORITES_STORAGE_KEY = 'hhrFavorites';
  const readFavorites = () => new Promise(resolve => {
    try {
      chrome.storage.local.get(FAVORITES_STORAGE_KEY, stored => {
        const list = stored && Array.isArray(stored[FAVORITES_STORAGE_KEY])
          ? stored[FAVORITES_STORAGE_KEY]
          : null;
        resolve(list);
      });
    } catch (_error) {
      resolve(null);
    }
  });
  const writeFavorites = list => new Promise(resolve => {
    try {
      chrome.storage.local.set({ [FAVORITES_STORAGE_KEY]: list }, () => resolve(!chrome.runtime.lastError));
    } catch (_error) {
      resolve(false);
    }
  });
  const normalizeFavoriteUrl = raw => {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_error) {
      return '';
    }
  };

  const createFavoritesDialog = () => {
    const focusReturnTarget = document.activeElement;
    if (!closeModal()) return;
    ensureStyles();
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.innerHTML = `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog hhr-rx-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="hhr-rx-title">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <header class="hhr-rx-header">
          <h2 class="hhr-rx-title" id="hhr-rx-title">Favoritos</h2>
          <p class="hhr-rx-subtitle">Accesos rápidos a páginas web. Se guardan solo en este navegador.</p>
        </header>
        <div class="hhr-rx-body">
          <div class="hhr-fav-list"></div>
          <div class="hhr-rx-format-title">Agregar favorito</div>
          <div class="hhr-fav-form">
            <input class="hhr-rx-search hhr-fav-name" type="text" maxlength="60" placeholder="Nombre" aria-label="Nombre del favorito">
            <input class="hhr-rx-search hhr-fav-url" type="url" maxlength="300" placeholder="https://…" aria-label="URL del favorito">
            <button class="hhr-rx-action hhr-rx-action-primary hhr-fav-add" type="button">Agregar</button>
          </div>
          <div class="hhr-connection-feedback hhr-fav-feedback" role="status" aria-live="polite"></div>
        </div>
        <footer class="hhr-rx-footer">
          <button class="hhr-rx-action hhr-rx-cancel" type="button">Cerrar</button>
        </footer>
      </section>
    `;
    root.dataset.routeIndependent = 'true';
    document.body.appendChild(root);
    const list = root.querySelector('.hhr-fav-list');
    const nameInput = root.querySelector('.hhr-fav-name');
    const urlInput = root.querySelector('.hhr-fav-url');
    const feedback = root.querySelector('.hhr-fav-feedback');
    const dismiss = modalDismissWithFocusRestore(root, focusReturnTarget);
    root.__hhrDismiss = dismiss;
    root.querySelector('.hhr-rx-cancel').addEventListener('click', dismiss);
    root.querySelector('.hhr-rx-close').addEventListener('click', dismiss);
    root.querySelector('.hhr-rx-backdrop').addEventListener('click', dismiss);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      trapModalFocus(root, event);
    });

    let favorites = [];
    const renderList = () => {
      list.innerHTML = '';
      if (!favorites.length) {
        list.innerHTML = '<div class="hhr-center-empty">Aún no hay favoritos guardados.</div>';
        return;
      }
      favorites.forEach((favorite, index) => {
        const row = document.createElement('div');
        row.className = 'hhr-fav-row';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'hhr-fav-open';
        const title = document.createElement('strong');
        title.textContent = favorite.name || favorite.url;
        const meta = document.createElement('span');
        meta.textContent = favorite.url;
        open.append(title, meta);
        open.addEventListener('click', () => window.open(favorite.url, '_blank', 'noopener'));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'hhr-fav-remove';
        remove.setAttribute('aria-label', 'Eliminar ' + (favorite.name || favorite.url));
        remove.textContent = '×';
        remove.addEventListener('click', async () => {
          favorites.splice(index, 1);
          await writeFavorites(favorites);
          renderList();
        });
        row.append(open, remove);
        list.appendChild(row);
      });
    };

    root.querySelector('.hhr-fav-add').addEventListener('click', async () => {
      const url = normalizeFavoriteUrl(urlInput.value);
      if (!url) {
        setLiveRegion(feedback, 'Ingresa una dirección web válida (http o https).', 'error');
        return;
      }
      favorites.push({ name: nameInput.value.trim() || url.replace(/^https?:\/\//, ''), url });
      const saved = await writeFavorites(favorites);
      nameInput.value = '';
      urlInput.value = '';
      setLiveRegion(feedback, saved ? 'Favorito guardado.' : 'No se pudo guardar el favorito.', saved ? '' : 'error');
      renderList();
      nameInput.focus();
    });

    root.querySelector('.hhr-rx-close').focus();
    readFavorites().then(stored => {
      if (!root.isConnected) return;
      favorites = stored || [{ name: 'HHR · Sistema Estadístico', url: 'https://testinghhr.netlify.app/' }];
      if (!stored) void writeFavorites(favorites);
      renderList();
    });
  };

  const OPERATIONS_MODULES = [
    {
      key: 'recipes', label: 'Recetas', icon: 'recipes',
      tip: 'Recetas médicas',
      note: 'Imprime recetas del paciente actual o de todos los hospitalizados.',
      aria: 'Abrir centro de recetas',
    },
    {
      key: 'handoff', label: 'Turno', icon: 'handoff',
      tip: 'Entrega de turno',
      note: 'Registra y revisa la entrega de turno del servicio.',
      aria: 'Entrega de turno',
    },
    {
      key: 'vitals', label: 'Vitales', icon: 'vitals',
      tip: 'Signos vitales',
      note: 'Última toma, historial y tendencias del paciente actual.',
      aria: 'Signos vitales',
    },
    {
      key: 'scores', label: 'Scores', icon: 'scores',
      tip: 'Scores de enfermería',
      note: 'Instrumentos y escalas de evaluación por paciente.',
      aria: 'Scores de enfermería',
    },
    {
      key: 'lab', label: 'Lab', icon: 'lab',
      tip: 'Laboratorio Syslab',
      note: 'Resultados de exámenes con comparación y tendencias.',
      aria: 'Exámenes de laboratorio',
    },
    {
      key: 'imaging', label: 'Imágenes', icon: 'imaging',
      tip: 'Imágenes',
      note: 'Solicitud de imágenes con formularios oficiales y, próximamente, informes.',
      aria: 'Imágenes y radiología',
    },
  ];

  const ensureOperationsBar = encId => {
    let bar = document.getElementById(OPERATIONS_BAR_ID);
    if (!bar) {
      ensureStyles();
      bar = document.createElement('aside');
      bar.id = OPERATIONS_BAR_ID;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Centro de operaciones del Hospital Hanga Roa');
      const shadow = bar.attachShadow({ mode: 'open' });
      bar.__hhrRoot = shadow;
      shadow.innerHTML = `
        <style>${ui.barCss}</style>
        <button class="brand" type="button" aria-label="Abrir Centro HHR"
          data-tip="Centro HHR" data-tip-note="Abre el centro completo en el último módulo que usaste.">
          <img class="brand-logo" alt="" aria-hidden="true">
          <span class="brand-name">Centro HHR</span>
        </button>
        <span class="divider" aria-hidden="true"></span>
        <div class="modules" role="group" aria-label="Módulos clínicos">
          ${OPERATIONS_MODULES.map(module => `
            <button class="module hhr-ops-${module.key}" type="button"
              aria-label="${module.aria}" data-tip="${module.tip}" data-tip-note="${module.note}">
              ${ui.icons[module.icon]}
              <span>${module.label}</span>
            </button>
          `).join('')}
          <button class="module module-icon hhr-ops-favorites" type="button" aria-label="Favoritos"
            data-tip="Favoritos" data-tip-note="Tus páginas web frecuentes, siempre a un clic.">
            ${ui.icons.star}
          </button>
        </div>
        <span class="divider" aria-hidden="true"></span>
        <button class="session hhr-ops-session is-degraded" type="button"
          aria-label="Comprobar conexiones" data-tip="Conexiones"
          data-tip-note="Estado de Ficha Médico y Gestión de Camas. Clic para administrar.">
          <span class="avatar-wrap" aria-hidden="true">
            <span class="avatar hhr-ops-avatar">HHR</span>
            <span class="dot hhr-ops-connection-dot"></span>
          </span>
          <span class="session-copy" aria-hidden="true">
            <span class="session-name">Conexiones</span>
            <span class="session-state">Comprobando…</span>
          </span>
        </button>
        <div class="tip" role="tooltip"><strong></strong><span></span></div>
      `;
      try {
        shadow.querySelector('.brand-logo').src = chrome.runtime.getURL('hhr-logo.svg');
      } catch (_error) {
        shadow.querySelector('.brand-logo').remove();
      }
      const brandButton = shadow.querySelector('.brand');
      brandButton.addEventListener('click', () =>
        openCenterModule(lastCenterModule, bar.dataset.encounterId, brandButton)
      );
      shadow.querySelector('.hhr-ops-recipes').addEventListener('click', () =>
        createModal(bar.dataset.encounterId)
      );
      const sessionButton = shadow.querySelector('.hhr-ops-session');
      const handoffButton = shadow.querySelector('.hhr-ops-handoff');
      const vitalsButton = shadow.querySelector('.hhr-ops-vitals');
      const scoresButton = shadow.querySelector('.hhr-ops-scores');
      const labButton = shadow.querySelector('.hhr-ops-lab');
      const imagingButton = shadow.querySelector('.hhr-ops-imaging');
      sessionButton.addEventListener('click', () =>
        createOperationsCenterModal('connection', bar.dataset.encounterId, sessionButton)
      );
      handoffButton.addEventListener('click', () =>
        createOperationsCenterModal('handoff', bar.dataset.encounterId, handoffButton)
      );
      scoresButton.addEventListener('click', () =>
        createOperationsCenterModal('scores', bar.dataset.encounterId, scoresButton)
      );
      labButton.addEventListener('click', () => {
        if (labButton.classList.contains('is-disabled')) return;
        createOperationsCenterModal('lab', bar.dataset.encounterId, labButton);
      });
      imagingButton.addEventListener('click', () =>
        createOperationsCenterModal('imaging', bar.dataset.encounterId, imagingButton)
      );
      vitalsButton.addEventListener('click', () =>
        createOperationsCenterModal('vitals', bar.dataset.encounterId, vitalsButton)
      );
      shadow.querySelector('.hhr-ops-favorites').addEventListener('click', () =>
        createFavoritesDialog()
      );
      ui.enableBarTooltips(shadow, bar);
      ui.enableRovingFocus(shadow);
      document.body.appendChild(bar);
    }
    bar.dataset.encounterId = encId || '';
    const labButton = barPart(bar, '.hhr-ops-lab');
    if (labButton) {
      const labDisabled = !labHelper;
      labButton.classList.toggle('is-disabled', labDisabled);
      labButton.setAttribute('aria-disabled', String(labDisabled));
      labButton.dataset.tipNote = labDisabled
        ? 'Recarga la extensión para activar laboratorio.'
        : 'Resultados de exámenes con comparación y tendencias.';
    }
    updateOperationsBarPosition(bar);
    void refreshOperationsConnectionBadge(bar);
  };

  const ensureButton = () => {
    if (!document.body) return;
    const encId = helper.resolveEncounterId(window.location.href);
    const nursingContext = helper.isNursingRouteUrl(window.location.href) || hasVisibleNursingRole();
    const existing = document.getElementById(BUTTON_ID);
    const existingIndications = document.getElementById(INDICATIONS_BUTTON_ID);
    const expectedEncounterId = encId || '';
    const modal = document.getElementById(MODAL_ID);
    if (modal && modal.dataset.routeIndependent !== 'true' &&
        modal.dataset.encounterId !== expectedEncounterId) {
      if (modal.dataset.routeStale === 'true') {
        // A clinical write was already in flight when the route changed. Keep its frozen
        // result panel visible until the user reviews the confirmation and closes it.
      } else if (typeof modal.__hhrDismiss === 'function') {
        const guard = getClinicalGuard(modal);
        if (guard.pending.size) {
          freezeClinicalModalForEncounterChange(modal);
        } else {
          if (guard.dirty.size) {
            showPageNotice(
              'El episodio cambió. Los datos sin guardar se descartaron para evitar asociarlos al paciente equivocado.',
              { title: 'Cambio de paciente' }
            );
          }
          modal.remove();
        }
      } else {
        closeModal(true);
      }
    }
    ensureOperationsBar(encId);
    ensureCorrectedDischargePrintItems();
    ensureNursingMedicalEpicrisisPrintItem(nursingContext);
    if (!encId || !nursingContext) {
      document.documentElement.setAttribute(
        'data-hhr-prescription-print-state',
        !encId ? 'operations-ready' : 'operations-ready-no-context-actions'
      );
      if (existing) existing.remove();
      if (existingIndications) existingIndications.remove();
      return;
    }
    if (existing && existingIndications) {
      existing.dataset.encounterId = encId;
      existingIndications.dataset.encounterId = encId;
      return;
    }
    const heading = findPharmaHeading();
    if (!heading) {
      document.documentElement.setAttribute('data-hhr-prescription-print-state', 'waiting-pharma');
      return;
    }
    const anchor = findToolbarAnchor(heading);
    ensureStyles();
    let indicationsButton = existingIndications;
    if (!indicationsButton) {
      indicationsButton = document.createElement('button');
      indicationsButton.id = INDICATIONS_BUTTON_ID;
      indicationsButton.type = 'button';
      indicationsButton.title = 'Indicaciones';
      indicationsButton.setAttribute('aria-label', 'Descargar indicaciones');
      indicationsButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6Zm1 7V3.5L20.5 9H15ZM8 13h8v2H8v-2Zm0 4h8v2H8v-2Zm0-8h4v2H8V9Z"/>
        </svg>
      `;
      indicationsButton.addEventListener('click', () =>
        downloadIndications(indicationsButton.dataset.encounterId, indicationsButton)
      );
      anchor.insertAdjacentElement('afterend', indicationsButton);
    }
    indicationsButton.dataset.encounterId = encId;

    let button = existing;
    if (!button) {
      button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.title = 'Receta médica';
      button.setAttribute('aria-label', 'Imprimir receta médica');
      button.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 8H5c-1.66 0-3 1.34-3 3v4h4v4h12v-4h4v-4c0-1.66-1.34-3-3-3Zm-3 9H8v-5h8v5Zm3-5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM18 3H6v4h12V3Z"/>
        </svg>
      `;
      button.addEventListener('click', () => createModal(button.dataset.encounterId));
      indicationsButton.insertAdjacentElement('afterend', button);
    }
    button.dataset.encounterId = encId;
    document.documentElement.setAttribute('data-hhr-prescription-print-state', 'ready');
  };

  let scheduled = false;
  const scheduleEnsureButton = () => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      ensureButton();
    }, 80);
  };

  const observer = new MutationObserver(scheduleEnsureButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleEnsureButton);
  window.addEventListener('hashchange', scheduleEnsureButton);
  window.addEventListener('hhr:fichamedico-locationchange', scheduleEnsureButton);
  window.addEventListener('resize', scheduleEnsureButton);
  window.addEventListener('focus', scheduleEnsureButton);
  window.addEventListener('pageshow', scheduleEnsureButton);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleEnsureButton();
  });
  scheduleEnsureButton();
})();
