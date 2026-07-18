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
  const centerStyles = globalThis.HhrCenterStyles;
  const centerShellOwner = globalThis.HhrCenterShellRuntime;
  const prescriptionCenterOwner = globalThis.HhrPrescriptionCenterRuntime;
  const hospitalizedDocumentsCenterOwner = globalThis.HhrHospitalizedDocumentsCenterRuntime;
  const handoffCenterOwner = globalThis.HhrHandoffCenterRuntime;
  const scoresCenterOwner = globalThis.HhrScoresCenterRuntime;
  const labCenterOwner = globalThis.HhrLabCenterRuntime;
  const medicationActionsOwner = globalThis.HhrMedicationActionsRuntime;
  const imagingCenterOwner = globalThis.HhrImagingCenterRuntime;
  // Imaging interaction contracts are implemented by hhr-imaging-center.js. Keep this compact
  // ownership note so repository-wide structural guards can verify the extracted behavior without
  // duplicating its implementation in the orchestrator:
  // class="hhr-imaging-canvas" role="group" tabindex="0"
  // event.key === 'Enter' || event.key === ' '
  // editor.addEventListener('keydown' -> event.stopPropagation(); restoreCanvasFocus = true;
  // canvas.focus({ preventScroll: true }); overlaysHost.appendChild(editor)
  const vitalsHelper = globalThis.HhrVitals;
  const vitalsCenterOwner = globalThis.HhrVitalsCenterRuntime;
  // Detail stale-render ownership lives in hhr-vitals-center.js:
  // root.dataset.vitalsRequestGeneration !== requestGeneration
  const requestForms = globalThis.HhrRequestForms;
  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  if (
    !helper ||
    !ui ||
    !centerStyles ||
    !centerShellOwner ||
    !prescriptionCenterOwner ||
    !hospitalizedDocumentsCenterOwner ||
    !handoffCenterOwner ||
    !scoresCenterOwner ||
    !labCenterOwner ||
    !medicationActionsOwner ||
    !runtimeMessages ||
    globalThis.__hhrPrescriptionPrintInjected
  ) return;
  globalThis.__hhrPrescriptionPrintInjected = true;

  const BUTTON_ID = 'hhr-prescription-print-button';
  const INDICATIONS_BUTTON_ID = 'hhr-indications-print-button';
  const OPERATIONS_BAR_ID = 'hhr-clinical-operations-bar';
  const MODAL_ID = 'hhr-prescription-print-modal';
  const NOTICE_HOST_ID = 'hhr-clinical-page-notices';
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
    centerStyles.ensureNoticeStyles(document);
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

  const ensureStyles = () => centerStyles.ensureCenterStyles(document, ui);

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

  // Initialized after the shared Centro shell is defined. Keeping only these references here
  // makes this file the orchestrator while each extracted module owns its rendering workflow.
  let createModal;
  let createHospitalizedDocumentsModal;

  const setSyncState = (element, text, state = '') => {
    element.className = 'hhr-sync-state' + (state ? ' is-' + state : '');
    setLiveRegion(element, text, state);
  };

  const medicationActionsRuntime = medicationActionsOwner.create({
    documentRef: document,
    windowRef: window,
    chromeApi: chrome,
    modalId: MODAL_ID,
    normalizedText,
    currentRouteEncounterId,
    createFeedbackModal,
    sendMessage,
    runtimeMessages,
    closeModal,
    ensureStyles,
    modalDismissWithFocusRestore,
    trapModalFocus,
    setLiveRegion,
  });
  const {
    findPharmaHeading,
    downloadIndications,
    hasVisibleNursingRole,
    findToolbarAnchor,
    createRegimenQuickDialog,
    createFavoritesDialog,
  } = medicationActionsRuntime;

  const centerShellRuntime = centerShellOwner.create({
    modalId: MODAL_ID,
    closeModal,
    ensureStyles,
    getClinicalGuard,
    runClinicalTransition,
    trapModalFocus,
    currentRouteEncounterId,
    normalizedText,
    sendMessage,
    runtimeMessages,
    openPrescriptionCenter: (...args) => createModal(...args),
    openHospitalizedDocuments: (...args) => createHospitalizedDocumentsModal(...args),
    openOperationsCenter: (...args) => createOperationsCenterModal(...args),
    openRegimenQuickDialog: () => createRegimenQuickDialog(),
  });
  const { prepareCenterModalRoot, setupCenterPatientContext } = centerShellRuntime;

  createModal = prescriptionCenterOwner.create({
    helper,
    runtimeMessages,
    currentRouteEncounterId,
    prepareCenterModalRoot,
    runClinicalTransition,
    normalizedText,
    sendMessage,
    setLiveRegion,
    attachPatientListFilter,
    openHospitalizedDocuments: (...args) => createHospitalizedDocumentsModal(...args),
  }).open;
  createHospitalizedDocumentsModal = hospitalizedDocumentsCenterOwner.create({
    helper,
    runtimeMessages,
    prepareCenterModalRoot,
    runClinicalTransition,
    normalizedText,
    sendMessage,
    setLiveRegion,
    attachPatientListFilter,
    openPrescriptionCenter: (...args) => createModal(...args),
  }).open;

  const handoffCenterRuntime = handoffCenterOwner.create({
    helper,
    runtimeMessages,
    runClinicalTransition,
    normalizedText,
    sendMessage,
    clinicalWriteKey,
    hydrateClinicalWriteProtection,
    setClinicalGuardState,
    setSyncState,
    releaseClinicalWriteProtection,
    uncertainClinicalWrites,
    normalizedClinicalText,
    finishRouteChangeWrite,
    acknowledgeClinicalWrite,
    clinicalWriteRecoveryReady,
  });
  const scoresCenterRuntime = scoresCenterOwner.create({
    helper,
    runtimeMessages,
    runClinicalTransition,
    normalizedText,
    sendMessage,
    setLiveRegion,
    clinicalWriteKey,
    hydrateClinicalWriteProtection,
    setClinicalGuardState,
    releaseClinicalWriteProtection,
    uncertainClinicalWrites,
    finishRouteChangeWrite,
    acknowledgeClinicalWrite,
    clinicalWriteRecoveryReady,
    getActiveUncertainWrite,
    showPageNotice,
    trapModalFocus,
  });

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

  const labCenterRuntime = labCenterOwner.create({
    labHelper,
    requestForms,
    runtimeMessages,
    runClinicalTransition,
    normalizedText,
    sendMessage,
    setLiveRegion,
    fetchPatientHeaderView,
  });

  const imagingCenterRuntime = imagingCenterOwner
    ? imagingCenterOwner.create({
        requestForms,
        runtimeMessages,
        sendMessage,
        setLiveRegion,
        fetchPatientHeaderView,
      })
    : null;

  const vitalsCenterRuntime = vitalsCenterOwner
    ? vitalsCenterOwner.create({
        vitalsHelper,
        runtimeMessages,
        currentRouteEncounterId,
        normalizedText,
        sendMessage,
        openVitalsView: (root, encId, view) =>
          createOperationsCenterModal('vitals', encId, root.__hhrFocusReturnTarget, root, {
            vitalsView: view,
          }),
      })
    : null;

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
      if (activeModule === 'handoff') handoffCenterRuntime.renderHandoffCenter(root, targetEncId);
      else if (activeModule === 'scores') scoresCenterRuntime.renderScoresCenter(root, targetEncId);
      else if (activeModule === 'lab') labCenterRuntime.renderLabRequestView(root, targetEncId);
      else if (activeModule === 'imaging') {
        if (!imagingCenterRuntime) {
          root.querySelector('.hhr-center-main').innerHTML =
            '<div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Imágenes</h2></div>' +
            '<div class="hhr-center-content"><div class="hhr-rx-error">El Centro de Imágenes no quedó cargado. Recarga la extensión y la pestaña.</div></div>';
          return;
        }
        imagingCenterRuntime.renderImagingCenter(root, targetEncId);
      }
      else if (activeModule === 'vitals') {
        if (!vitalsCenterRuntime) {
          root.querySelector('.hhr-center-main').innerHTML =
            '<div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Signos vitales</h2></div>' +
            '<div class="hhr-center-content"><div class="hhr-rx-error">El Centro de Signos Vitales no quedó cargado. Recarga la extensión y la pestaña.</div></div>';
          return;
        }
        vitalsCenterRuntime.renderVitalsCenter(root, targetEncId, options.vitalsView || 'overview');
      }
      else if (activeModule === 'home') renderHomeCenter(root, targetEncId);
      else renderConnectionCenter(root, targetEncId);
    };
    setupCenterPatientContext(root, activeModule, encId, renderModule);
    if (activeModule === 'vitals' && options.vitalsView !== 'detail') {
      root.querySelector('.hhr-center-patientbar').hidden = true;
    }
    renderModule(encId);
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
        centerShellRuntime.openCenterModule(undefined, bar.dataset.encounterId, brandButton)
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
