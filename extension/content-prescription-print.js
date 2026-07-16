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
  if (!helper || globalThis.__hhrPrescriptionPrintInjected) return;
  globalThis.__hhrPrescriptionPrintInjected = true;

  const BUTTON_ID = 'hhr-prescription-print-button';
  const INDICATIONS_BUTTON_ID = 'hhr-indications-print-button';
  const OPERATIONS_BAR_ID = 'hhr-clinical-operations-bar';
  const MODAL_ID = 'hhr-prescription-print-modal';
  const STYLE_ID = 'hhr-prescription-print-styles';
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

  try {
    document.documentElement.setAttribute(
      'data-hhr-prescription-print-script',
      chrome.runtime.getManifest().version
    );
  } catch (_error) {}

  const retryableMessageTypes = new Set([
    'RAYEN_PRESCRIPTION_OPTIONS_REQUEST',
    'RAYEN_HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST',
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
        message.type === 'RAYEN_HANDOFF_SAVE_REQUEST' ||
        message.type === 'RAYEN_SCORE_SAVE_REQUEST'
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
          type: 'RAYEN_CLINICAL_WRITE_ACK',
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
      type: 'RAYEN_CLINICAL_WRITE_RECOVERY_REQUEST',
      key,
      generationId: protection && protection.generationId,
      phase: 'preview',
    });
    if (!preview || preview.error) return preview;
    const recoveryPreview = preview.recoveryPreview || {};
    if (!recoveryPreview.challenge || !recoveryPreview.review) {
      return { error: 'Eloísa no devolvió una lectura fresca verificable; la protección se mantuvo.' };
    }
    const confirmed = window.confirm(
      'Eloísa se consultó nuevamente. Revisa esta lectura fresca:\n\n' +
        formatClinicalRecoveryReview(recoveryPreview.review) +
        '\n\n¿Confirmas que revisaste exactamente este resultado y deseas liberar la protección contra duplicados?'
    );
    if (!confirmed) return { cancelled: true };
    return sendMessage({
      type: 'RAYEN_CLINICAL_WRITE_RECOVERY_REQUEST',
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
      };
    }
    return root.__hhrClinicalGuard;
  };

  const setClinicalGuardState = (root, state, key, active) => {
    const bucket = getClinicalGuard(root)[state];
    if (active) bucket.add(key);
    else bucket.delete(key);
  };

  const confirmClinicalTransition = (root, { allowUncertain = false } = {}) => {
    const guard = getClinicalGuard(root);
    if (guard.pending.size) {
      window.alert('Hay una escritura clínica en curso. Espera a que Eloísa confirme el resultado.');
      return false;
    }
    if (guard.dirty.size) {
      const discard = window.confirm('Hay cambios clínicos sin guardar. ¿Descartarlos y continuar?');
      if (!discard) return false;
      guard.dirty.clear();
    }
    if (!allowUncertain && guard.uncertain.size) {
      const leave = window.confirm(
        'Hay escrituras cuyo resultado aún no pudo verificarse. La protección contra duplicados se conservará hasta confirmar su estado en Eloísa. ¿Continuar?'
      );
      if (!leave) return false;
    }
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
      #${OPERATIONS_BAR_ID} {
        box-sizing: border-box; position: fixed; top: var(--hhr-ops-top, 70px); right: 18px; z-index: 2147483000;
        height: 38px; display: flex; align-items: center; gap: 3px; padding: 3px 4px 3px 7px;
        border: 1px solid #dce5e3; border-radius: 10px; color: #314240; background: rgba(255,255,255,.94);
        box-shadow: 0 3px 10px rgba(38,65,62,.08);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-family: Roboto, Arial, sans-serif;
      }
      #${OPERATIONS_BAR_ID} .hhr-ops-brand { display: flex; align-items: center; gap: 6px; padding-right: 4px; }
      #${OPERATIONS_BAR_ID} .hhr-ops-logo { width: 24px; height: 21px; object-fit: contain; flex: 0 0 auto; }
      #${OPERATIONS_BAR_ID} .hhr-ops-brand-copy { display: grid; line-height: 1.05; white-space: nowrap; }
      #${OPERATIONS_BAR_ID} .hhr-ops-brand-copy strong { color: #3f514e; font-size: 12px; font-weight: 600; letter-spacing: .01em; }
      #${OPERATIONS_BAR_ID} .hhr-ops-brand-copy span { display: none; }
      #${OPERATIONS_BAR_ID} .hhr-ops-session {
        appearance: none; min-width: 30px; height: 30px; padding: 2px; border: 0; border-radius: 8px;
        background: transparent; color: #52615f; cursor: pointer; position: relative; font: inherit;
      }
      #${OPERATIONS_BAR_ID} .hhr-ops-session:hover { background: #edf7f5; }
      #${OPERATIONS_BAR_ID} .hhr-ops-session:focus-visible { outline: 3px solid rgba(15,130,120,.24); outline-offset: 2px; }
      #${OPERATIONS_BAR_ID} .hhr-ops-avatar {
        width: 25px; height: 25px; border-radius: 50%; display: grid; place-items: center;
        background: #e9efee; color: #5e6b69; font-size: 9px; font-weight: 700; letter-spacing: .02em;
      }
      #${OPERATIONS_BAR_ID} .hhr-ops-connection-dot {
        position: absolute; right: 1px; bottom: 1px; width: 8px; height: 8px; border-radius: 50%;
        border: 2px solid #fff; background: #a9b3b1;
      }
      #${OPERATIONS_BAR_ID} .hhr-ops-session.is-ready .hhr-ops-avatar { background: #e4f4f0; color: #0c746b; }
      #${OPERATIONS_BAR_ID} .hhr-ops-session.is-ready .hhr-ops-connection-dot { background: #28a66c; }
      #${OPERATIONS_BAR_ID} .hhr-ops-session.is-degraded .hhr-ops-connection-dot { background: #d8a72e; }
      #${OPERATIONS_BAR_ID} .hhr-ops-session.is-offline .hhr-ops-connection-dot { background: #c94c43; }
      #${OPERATIONS_BAR_ID} .hhr-ops-modules { display: flex; align-items: center; gap: 2px; }
      #${OPERATIONS_BAR_ID} .hhr-ops-module {
        appearance: none; height: 30px; min-width: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 2px; padding: 0 4px;
        border: 0; border-radius: 7px; background: transparent; color: #52615f; cursor: pointer;
        font: inherit; font-size: 10.5px; font-weight: 600; box-shadow: none; white-space: nowrap;
      }
      #${OPERATIONS_BAR_ID} .hhr-ops-module:hover { background: #e9f5f3; color: #095f58; }
      #${OPERATIONS_BAR_ID} .hhr-ops-module:disabled { opacity: .42; cursor: not-allowed; }
      #${OPERATIONS_BAR_ID} .hhr-ops-module:focus-visible { outline: 3px solid rgba(15,130,120,.24); outline-offset: 2px; }
      #${OPERATIONS_BAR_ID} .hhr-ops-module svg { width: 14px; height: 14px; fill: currentColor; }
      #${MODAL_ID} { position: fixed; inset: 0; z-index: 2147483646; font-family: Roboto, Arial, sans-serif; }
      #${MODAL_ID} .hhr-rx-backdrop { position: absolute; inset: 0; background: rgba(22,30,33,.46); }
      #${MODAL_ID} .hhr-rx-dialog {
        position: relative; width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 20px);
        margin: max(10px, 2vh) auto; background: #fff; border-radius: 12px; overflow: hidden;
        box-shadow: 0 18px 55px rgba(0,0,0,.28); color: #2f3437; display: flex; flex-direction: column;
      }
      #${MODAL_ID} .hhr-rx-header { padding: 14px 18px 10px; border-bottom: 1px solid #e7eaeb; }
      #${MODAL_ID} .hhr-rx-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 1.2; }
      #${MODAL_ID} .hhr-rx-subtitle { margin: 4px 0 0; color: #667176; font-size: 12.5px; line-height: 1.35; }
      #${MODAL_ID} .hhr-rx-close {
        position: absolute; top: 8px; right: 9px; width: 34px; height: 34px; border: 0;
        border-radius: 50%; background: transparent; color: #6b7478; cursor: pointer; font-size: 24px;
      }
      #${MODAL_ID} .hhr-rx-close:hover { background: #f1f3f3; }
      #${MODAL_ID} .hhr-rx-tabs { display: flex; gap: 4px; margin-top: 10px; padding: 3px; background: #f1f5f4; border-radius: 8px; }
      #${MODAL_ID} .hhr-rx-tab {
        flex: 1; min-height: 32px; border: 0; border-radius: 6px; background: transparent; color: #5c686c;
        cursor: pointer; font: inherit; font-size: 13px; font-weight: 500;
      }
      #${MODAL_ID} .hhr-rx-tab[aria-selected="true"] { background: #fff; color: #117f75; box-shadow: 0 1px 5px rgba(22,55,52,.13); }
      #${MODAL_ID} .hhr-rx-tab:disabled { cursor: not-allowed; opacity: .42; }
      #${MODAL_ID} .hhr-rx-body { padding: 10px 18px 12px; overflow: auto; min-height: 120px; }
      #${MODAL_ID} .hhr-rx-status { color: #606b70; font-size: 13px; padding: 16px 0; text-align: center; }
      #${MODAL_ID} .hhr-rx-print-feedback {
        margin: 0 0 12px; padding: 10px 12px; border: 1px solid #b9ded8; border-radius: 8px;
        background: #eef9f7; color: #22645e; text-align: left;
      }
      #${MODAL_ID} .hhr-rx-error {
        color: #9b2c2c; background: #fff2f1; border: 1px solid #f1c5c2; border-radius: 8px;
        padding: 12px 14px; font-size: 14px; line-height: 1.45;
      }
      #${MODAL_ID} .hhr-rx-patient-context {
        display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 8px;
        padding: 8px 10px; border: 1px solid #d9e7e5; border-radius: 8px; background: #f7fbfa;
      }
      #${MODAL_ID} .hhr-rx-patient-context strong { color: #273b38; font-size: 14px; font-weight: 600; }
      #${MODAL_ID} .hhr-rx-patient-context span { color: #64706f; font-size: 11.5px; line-height: 1.3; }
      #${MODAL_ID} .hhr-rx-sync-note {
        margin: 0 0 7px; padding: 6px 9px; border-radius: 7px; background: #fff8e8;
        color: #765b18; font-size: 11.5px; line-height: 1.35;
      }
      #${MODAL_ID} .hhr-rx-list { display: grid; gap: 6px; }
      #${MODAL_ID} .hhr-rx-option {
        display: grid; grid-template-columns: 18px 1fr; gap: 8px; align-items: start; cursor: pointer;
        border: 1px solid #dfe4e5; border-radius: 8px; padding: 8px 10px; background: #fff;
      }
      #${MODAL_ID} .hhr-rx-option:hover { border-color: #8cc9c3; background: #f7fbfa; }
      #${MODAL_ID} .hhr-rx-option:has(input:checked) { border-color: #15978b; background: #f0faf8; }
      #${MODAL_ID} .hhr-rx-option.is-disabled { cursor: not-allowed; opacity: .62; background: #f7f8f8; }
      #${MODAL_ID} input[type="radio"], #${MODAL_ID} input[type="checkbox"] { width: 16px; height: 16px; margin: 1px 0 0; accent-color: #15978b; }
      #${MODAL_ID} .hhr-rx-format-title { margin: 10px 0 5px; font-size: 12px; font-weight: 600; color: #4c565a; }
      #${MODAL_ID} .hhr-rx-list > .hhr-rx-format-title { margin: 5px 0 0; }
      #${MODAL_ID} .hhr-rx-formats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      #${MODAL_ID} .hhr-rx-format-option {
        display: grid; grid-template-columns: 18px 1fr; gap: 7px; align-items: start; cursor: pointer;
        border: 1px solid #dfe4e5; border-radius: 8px; padding: 8px 9px; background: #fff;
      }
      #${MODAL_ID} .hhr-rx-format-option:has(input:checked) { border-color: #15978b; background: #f0faf8; }
      #${MODAL_ID} .hhr-rx-date { display: block; font-size: 14px; font-weight: 500; line-height: 1.25; }
      #${MODAL_ID} .hhr-rx-meta { display: block; margin-top: 2px; color: #697378; font-size: 11.5px; line-height: 1.3; }
      #${MODAL_ID} .hhr-rx-bulk-toolbar { display: flex; gap: 9px; align-items: center; margin-bottom: 10px; }
      #${MODAL_ID} .hhr-rx-search {
        flex: 1; min-width: 0; height: 40px; border: 1px solid #cfd7d8; border-radius: 8px; padding: 0 12px;
        color: #30383b; background: #fff; font: inherit; font-size: 14px;
      }
      #${MODAL_ID} .hhr-rx-search:focus { border-color: #15978b; outline: 3px solid rgba(21,151,139,.14); }
      #${MODAL_ID} .hhr-rx-mini-action { border: 0; background: transparent; color: #117f75; cursor: pointer; padding: 7px 6px; font: inherit; font-size: 13px; font-weight: 500; }
      #${MODAL_ID} .hhr-rx-selection-summary { display: flex; justify-content: space-between; gap: 12px; margin: 4px 0 10px; color: #5d696d; font-size: 13px; }
      #${MODAL_ID} .hhr-rx-patient-list { display: grid; gap: 8px; }
      #${MODAL_ID} .hhr-rx-patient {
        display: grid; grid-template-columns: 22px minmax(0,1fr); gap: 11px; align-items: start; border: 1px solid #dde3e4;
        border-radius: 10px; padding: 12px 13px; background: #fff; cursor: pointer;
      }
      #${MODAL_ID} .hhr-rx-patient:hover { border-color: #8cc9c3; background: #f8fcfb; }
      #${MODAL_ID} .hhr-rx-patient:has(input:checked) { border-color: #15978b; background: #f0faf8; }
      #${MODAL_ID} .hhr-rx-patient.is-disabled { cursor: default; background: #f7f8f8; opacity: .68; }
      #${MODAL_ID} .hhr-rx-patient.hhr-rx-patient-summary { grid-template-columns: minmax(0,1fr); cursor: default; }
      #${MODAL_ID} .hhr-rx-patient.hhr-rx-patient-summary:hover { border-color: #dde3e4; background: #fff; }
      #${MODAL_ID} .hhr-rx-patient-title { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; font-size: 15px; font-weight: 600; color: #30383b; }
      #${MODAL_ID} .hhr-rx-bed { color: #117f75; }
      #${MODAL_ID} .hhr-rx-badge { border-radius: 999px; padding: 2px 7px; color: #117f75; background: #dff4f0; font-size: 11px; font-weight: 600; }
      #${MODAL_ID} .hhr-rx-prescribers { display: grid; gap: 3px; margin-top: 7px; color: #4f5a5e; font-size: 12px; line-height: 1.35; }
      #${MODAL_ID} .hhr-rx-prescriber-time { color: #748085; }
      #${MODAL_ID} .hhr-rx-braden-line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 7px; color: #536064; font-size: 12px; }
      #${MODAL_ID} .hhr-rx-braden-score { border-radius: 999px; padding: 2px 8px; color: #725400; background: #fff1bd; font-weight: 700; }
      #${MODAL_ID} .hhr-rx-braden-missing { color: #7b8589; font-style: italic; }
      #${MODAL_ID} .hhr-rx-footer {
        padding: 10px 18px 12px; border-top: 1px solid #e7eaeb; display: flex;
        justify-content: flex-end; gap: 10px; background: #fafbfb;
      }
      #${MODAL_ID} .hhr-rx-action {
        border-radius: 7px; min-height: 40px; padding: 8px 17px; font: inherit; font-size: 14px;
        font-weight: 500; cursor: pointer; border: 1px solid #cbd1d3; background: #fff; color: #3e4649;
      }
      #${MODAL_ID} .hhr-rx-action-primary { background: #15978b; border-color: #15978b; color: #fff; }
      #${MODAL_ID} .hhr-rx-action-primary:hover { background: #117f75; }
      #${MODAL_ID} .hhr-rx-action:disabled { cursor: not-allowed; opacity: .55; }
      #${MODAL_ID} .hhr-center-dialog {
        width: min(1380px, calc(100vw - 28px)); height: min(790px, calc(100vh - 28px));
        max-height: calc(100vh - 28px); margin: 14px auto; border-radius: 10px;
      }
      #${MODAL_ID} .hhr-center-header {
        min-height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 56px 0 18px;
        border-bottom: 1px solid #dde4e3; background: #fff;
      }
      #${MODAL_ID} .hhr-center-header img { width: 24px; height: 22px; object-fit: contain; }
      #${MODAL_ID} .hhr-center-header strong { color: #30413f; font-size: 17px; font-weight: 600; }
      #${MODAL_ID} .hhr-route-change-state { margin-left: auto; padding-right: 26px; color: #8a6714; font-size: 11px; font-weight: 600; }
      #${MODAL_ID} .hhr-route-change-state.is-synced { color: #11766d; }
      #${MODAL_ID} .hhr-route-change-state.is-error,
      #${MODAL_ID} .hhr-route-change-state.is-uncertain { color: #9b2c2c; }
      #${MODAL_ID} .hhr-center-shell { display: grid; grid-template-columns: 92px minmax(0,1fr); min-height: 0; flex: 1; }
      #${MODAL_ID} .hhr-center-nav {
        padding: 9px 7px; border-right: 1px solid #e0e6e5; background: #fbfcfc; display: grid;
        align-content: start; gap: 4px;
      }
      #${MODAL_ID} .hhr-center-nav-button {
        appearance: none; min-height: 62px; border: 0; border-left: 3px solid transparent; border-radius: 0 7px 7px 0;
        background: transparent; color: #4f5c5a; cursor: pointer; display: grid; place-items: center; align-content: center;
        gap: 4px; font: inherit; font-size: 11px; font-weight: 500;
      }
      #${MODAL_ID} .hhr-center-nav-button svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      #${MODAL_ID} .hhr-center-nav-button:hover { background: #edf7f5; color: #0d766d; }
      #${MODAL_ID} .hhr-center-nav-button[aria-current="page"] { border-left-color: #15978b; background: #eaf6f4; color: #0b8177; font-weight: 700; }
      #${MODAL_ID} .hhr-center-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #fff; position: relative; }
      #${MODAL_ID} .hhr-center-toolbar {
        display: flex; align-items: center; gap: 10px; min-height: 66px; padding: 10px 18px; border-bottom: 1px solid #e2e7e6;
      }
      #${MODAL_ID} .hhr-center-heading { margin: 0 auto 0 0; color: #303b3a; font-size: 18px; font-weight: 600; white-space: nowrap; }
      #${MODAL_ID} .hhr-center-search, #${MODAL_ID} .hhr-center-select {
        height: 36px; border: 1px solid #cfd9d7; border-radius: 6px; background: #fff; color: #33403e;
        padding: 0 10px; font: inherit; font-size: 12px;
      }
      #${MODAL_ID} .hhr-center-search { width: min(270px, 24vw); }
      #${MODAL_ID} .hhr-center-search:focus, #${MODAL_ID} .hhr-center-select:focus,
      #${MODAL_ID} .hhr-handoff-input:focus, #${MODAL_ID} .hhr-score-control:focus {
        border-color: #15978b; outline: 2px solid rgba(21,151,139,.14);
      }
      #${MODAL_ID} .hhr-center-content { min-height: 0; flex: 1; overflow: auto; padding: 0 18px 18px; }
      #${MODAL_ID} .hhr-center-notice { margin: 12px 0; padding: 9px 11px; border-left: 3px solid #d7a424; background: #fffaf0; color: #665526; font-size: 12px; line-height: 1.4; }
      #${MODAL_ID} .hhr-center-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; color: #36413f; }
      #${MODAL_ID} .hhr-center-table th { position: sticky; top: 0; z-index: 1; padding: 9px 8px; border-bottom: 1px solid #cfd9d7; background: #f4f7f6; color: #3e4b49; text-align: left; font-weight: 600; }
      #${MODAL_ID} .hhr-center-table td { padding: 9px 8px; border-bottom: 1px solid #e3e8e7; vertical-align: top; overflow-wrap: anywhere; }
      #${MODAL_ID} .hhr-center-table tbody tr:hover { background: #fbfdfd; }
      #${MODAL_ID} .hhr-center-patient { display: block; color: #2f3a38; font-weight: 600; }
      #${MODAL_ID} .hhr-center-meta { display: block; margin-top: 3px; color: #74807e; font-size: 10.5px; line-height: 1.35; }
      #${MODAL_ID} .hhr-center-empty { padding: 32px 12px; color: #697674; text-align: center; font-size: 13px; }
      #${MODAL_ID} .hhr-handoff-input { width: 100%; min-height: 58px; resize: vertical; box-sizing: border-box; padding: 7px 8px; border: 1px solid #d1dad8; border-radius: 6px; color: #303a38; background: #fff; font: inherit; font-size: 11.5px; line-height: 1.35; }
      #${MODAL_ID} .hhr-handoff-input:disabled { background: #f5f7f6; color: #818a88; }
      #${MODAL_ID} .hhr-handoff-tools { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; }
      #${MODAL_ID} .hhr-char-count { color: #7a8583; font-size: 10px; }
      #${MODAL_ID} .hhr-row-save { min-height: 28px; padding: 4px 10px; border: 1px solid #11877d; border-radius: 5px; background: #15978b; color: #fff; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600; }
      #${MODAL_ID} .hhr-row-save:disabled { border-color: #ccd4d2; background: #e8edec; color: #85908e; cursor: not-allowed; }
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
      #${MODAL_ID} .hhr-score-form {
        position: absolute; inset: 0 0 0 auto; z-index: 3; width: min(560px, 92%); display: flex; flex-direction: column;
        border-left: 1px solid #cfd9d7; background: #fff; box-shadow: -14px 0 34px rgba(24,46,43,.13);
      }
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
      #${MODAL_ID} .hhr-center-action { min-height: 34px; padding: 5px 11px; border: 1px solid #cbd5d3; border-radius: 6px; background: #fff; color: #46514f; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600; }
      #${MODAL_ID} .hhr-center-action:hover { border-color: #98c8c3; color: #0d766d; }
      #${MODAL_ID} .hhr-center-action-primary { border-color: #15978b; background: #15978b; color: #fff; }
      #${MODAL_ID} .hhr-center-action:disabled { opacity: .48; cursor: not-allowed; }
      #${MODAL_ID} .hhr-lab-patient { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 12px 0; padding: 10px 12px; border: 1px solid #dbe4e2; border-radius: 8px; background: #f7faf9; color: #43504e; font-size: 11.5px; }
      #${MODAL_ID} .hhr-lab-patient strong { color: #263533; font-size: 13px; }
      #${MODAL_ID} .hhr-lab-status { margin-left: auto; color: #167a70; font-weight: 700; }
      #${MODAL_ID} .hhr-lab-exam-list { display: grid; gap: 7px; }
      #${MODAL_ID} .hhr-lab-exam-row { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 9px 10px; border: 1px solid #dfe6e5; border-radius: 7px; background: #fff; }
      #${MODAL_ID} .hhr-lab-exam-row:hover { border-color: #acd2ce; background: #fbfdfd; }
      #${MODAL_ID} .hhr-lab-exam-row input { width: 17px; height: 17px; accent-color: #15978b; }
      #${MODAL_ID} .hhr-lab-exam-title { color: #2f3d3b; font-size: 12px; font-weight: 700; }
      #${MODAL_ID} .hhr-lab-exam-names { margin-top: 3px; color: #667370; font-size: 10.5px; line-height: 1.4; }
      #${MODAL_ID} .hhr-lab-selection { color: #63706e; font-size: 11px; white-space: nowrap; }
      #${MODAL_ID} .hhr-lab-results { margin-top: 14px; border-top: 1px solid #dfe6e5; padding-top: 13px; }
      #${MODAL_ID} .hhr-lab-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
      #${MODAL_ID} .hhr-lab-stat { padding: 5px 8px; border-radius: 999px; background: #edf5f4; color: #3f5b57; font-size: 10.5px; font-weight: 700; }
      #${MODAL_ID} .hhr-lab-stat.is-alert { background: #fff0ee; color: #a23d35; }
      #${MODAL_ID} .hhr-lab-tabs { display: flex; gap: 4px; margin: 0 0 10px; border-bottom: 1px solid #dce4e2; }
      #${MODAL_ID} .hhr-lab-tab { padding: 8px 11px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #586562; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600; }
      #${MODAL_ID} .hhr-lab-tab[aria-selected="true"] { border-bottom-color: #15978b; color: #0b7c72; }
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
      #${MODAL_ID} .hhr-connection-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; padding-top: 14px; }
      #${MODAL_ID} .hhr-connection-card { border: 1px solid #dce5e3; border-radius: 10px; background: #fff; padding: 15px; }
      #${MODAL_ID} .hhr-connection-card-header { display: flex; align-items: center; gap: 9px; margin-bottom: 11px; }
      #${MODAL_ID} .hhr-connection-icon { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: #eef4f3; color: #53615f; font-weight: 700; font-size: 11px; }
      #${MODAL_ID} .hhr-connection-card.is-ready .hhr-connection-icon { background: #e7f5f1; color: #0d766d; }
      #${MODAL_ID} .hhr-connection-card.is-stale .hhr-connection-icon { background: #fff5df; color: #8a6714; }
      #${MODAL_ID} .hhr-connection-card h3 { margin: 0; color: #303b39; font-size: 14px; font-weight: 600; }
      #${MODAL_ID} .hhr-connection-status { display: flex; align-items: center; gap: 6px; margin-top: 3px; color: #6b7775; font-size: 11px; }
      #${MODAL_ID} .hhr-connection-status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #a9b3b1; }
      #${MODAL_ID} .hhr-connection-card.is-ready .hhr-connection-status::before { background: #28a66c; }
      #${MODAL_ID} .hhr-connection-card.is-stale .hhr-connection-status::before { background: #d8a72e; }
      #${MODAL_ID} .hhr-connection-user { min-height: 40px; color: #34413f; font-size: 13px; font-weight: 600; }
      #${MODAL_ID} .hhr-connection-detail { display: block; margin-top: 3px; color: #76817f; font-size: 11px; font-weight: 400; line-height: 1.35; }
      #${MODAL_ID} .hhr-connection-actions { display: flex; align-items: center; gap: 7px; margin-top: 13px; }
      #${MODAL_ID} .hhr-connection-privacy { margin-top: 14px; padding: 11px 12px; border: 1px solid #d8e7e4; border-radius: 8px; background: #f7fbfa; color: #52605e; font-size: 11.5px; line-height: 1.45; }
      #${MODAL_ID} .hhr-connection-feedback { min-height: 18px; margin-top: 10px; color: #64716f; font-size: 11.5px; }
      #${MODAL_ID} .hhr-connection-feedback.is-error { color: #9b2c2c; }
      @media (max-width: 2200px) {
        #${OPERATIONS_BAR_ID} .hhr-ops-module span { display: inline; }
        #${OPERATIONS_BAR_ID} .hhr-ops-module { padding: 0 3px; justify-content: center; }
        #${OPERATIONS_BAR_ID} .hhr-ops-brand-copy { display: none; }
      }
      @media (max-width: 1180px) {
        #${OPERATIONS_BAR_ID} { right: 12px; }
        #${OPERATIONS_BAR_ID} .hhr-ops-brand-copy { display: none; }
      }
      @media (max-width: 820px) {
        #${OPERATIONS_BAR_ID} { right: 10px; }
        #${OPERATIONS_BAR_ID} .hhr-ops-module { padding: 0 3px; font-size: 10px; }
      }
      @media (max-width: 760px) {
        #${MODAL_ID} .hhr-center-dialog { width: calc(100vw - 16px); height: calc(100vh - 16px); max-height: calc(100vh - 16px); margin: 8px auto; }
        #${MODAL_ID} .hhr-center-shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0,1fr); }
        #${MODAL_ID} .hhr-center-nav { grid-template-columns: repeat(6,1fr); padding: 4px; border-right: 0; border-bottom: 1px solid #e0e6e5; }
        #${MODAL_ID} .hhr-center-nav-button { min-height: 48px; border-left: 0; border-bottom: 2px solid transparent; border-radius: 5px; font-size: 9.5px; }
        #${MODAL_ID} .hhr-center-nav-button[aria-current="page"] { border-left-color: transparent; border-bottom-color: #15978b; }
        #${MODAL_ID} .hhr-center-toolbar { flex-wrap: wrap; min-height: auto; padding: 8px 10px; }
        #${MODAL_ID} .hhr-center-heading { flex-basis: 100%; }
        #${MODAL_ID} .hhr-center-search { width: 100%; flex: 1 1 160px; }
        #${MODAL_ID} .hhr-center-content { padding: 0 10px 12px; }
        #${MODAL_ID} .hhr-connection-grid { grid-template-columns: 1fr; }
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
        #${OPERATIONS_BAR_ID} { top: auto; right: auto; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); max-width: calc(100vw - 32px); height: 38px; border-color: #0d6e66; background: #106f67; box-shadow: 0 8px 22px rgba(0,0,0,.24); }
        #${OPERATIONS_BAR_ID} .hhr-ops-module { border-color: #fff; background: #fff; color: #0e766d; }
        #${OPERATIONS_BAR_ID} .hhr-ops-module:hover { border-color: #effaf8; background: #effaf8; color: #095f58; }
        #${MODAL_ID} .hhr-rx-dialog { margin: 16px auto; max-height: calc(100vh - 32px); }
        #${MODAL_ID} .hhr-rx-footer { flex-direction: column-reverse; }
        #${MODAL_ID} .hhr-rx-action { width: 100%; }
        #${MODAL_ID} .hhr-rx-formats { grid-template-columns: 1fr; }
        #${MODAL_ID} .hhr-rx-bulk-toolbar { align-items: stretch; flex-wrap: wrap; }
        #${MODAL_ID} .hhr-rx-search { flex-basis: 100%; }
        #${MODAL_ID} .hhr-rx-header, #${MODAL_ID} .hhr-rx-body, #${MODAL_ID} .hhr-rx-footer { padding-left: 16px; padding-right: 16px; }
      }
      @media (forced-colors: active) {
        #${OPERATIONS_BAR_ID}, #${MODAL_ID} .hhr-rx-dialog { border: 1px solid CanvasText; }
        #${OPERATIONS_BAR_ID} .hhr-ops-module:focus-visible,
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

  const createModal = encId => {
    encId = currentRouteEncounterId() || String(encId || '');
    const focusReturnTarget = document.activeElement;
    if (!closeModal()) return;
    ensureStyles();
    const hasCurrentPatient = /^\d+$/.test(String(encId || ''));
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.dataset.encounterId = hasCurrentPatient ? String(encId) : '';
    root.innerHTML = `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog" role="dialog" aria-modal="true" aria-labelledby="hhr-rx-title">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <header class="hhr-rx-header">
          <h2 class="hhr-rx-title" id="hhr-rx-title">Centro de recetas</h2>
          <p class="hhr-rx-subtitle">Elige qué recetas necesitas y abre un único diálogo de impresión.</p>
          <div class="hhr-rx-tabs" role="tablist" aria-label="Alcance de impresión">
            <button class="hhr-rx-tab" id="hhr-rx-tab-current" type="button" role="tab" data-tab="current" aria-controls="hhr-rx-tabpanel" aria-selected="true">Paciente actual</button>
            <button class="hhr-rx-tab" id="hhr-rx-tab-hospitalized" type="button" role="tab" data-tab="hospitalized" aria-controls="hhr-rx-tabpanel" aria-selected="false">Hospitalizados</button>
          </div>
        </header>
        <div class="hhr-rx-body" id="hhr-rx-tabpanel" role="tabpanel" aria-labelledby="hhr-rx-tab-current"><div class="hhr-rx-status">Buscando recetas disponibles…</div></div>
        <footer class="hhr-rx-footer">
          <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
          <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled>
            Imprimir receta completa
          </button>
        </footer>
      </section>
    `;
    document.body.appendChild(root);

    const body = root.querySelector('.hhr-rx-body');
    const submit = root.querySelector('.hhr-rx-submit');
    const cancel = root.querySelector('.hhr-rx-cancel');
    const close = root.querySelector('.hhr-rx-close');
    const backdrop = root.querySelector('.hhr-rx-backdrop');
    const subtitle = root.querySelector('.hhr-rx-subtitle');
    const tabs = Array.from(root.querySelectorAll('.hhr-rx-tab'));
    const currentTab = tabs.find(tab => tab.dataset.tab === 'current');
    if (!hasCurrentPatient && currentTab) {
      currentTab.disabled = true;
      currentTab.setAttribute('aria-disabled', 'true');
      currentTab.setAttribute('aria-selected', 'false');
    }
    let activeTab = hasCurrentPatient ? 'current' : 'hospitalized';
    let viewGeneration = 0;
    let hospitalizedResponse = null;
    let hospitalizedRequest = null;
    const dismiss = modalDismissWithFocusRestore(root, focusReturnTarget);
    root.__hhrDismiss = dismiss;
    cancel.addEventListener('click', dismiss);
    close.addEventListener('click', dismiss);
    backdrop.addEventListener('click', dismiss);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      trapModalFocus(root, event);
    });
    close.focus();

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
      const response = await sendMessage({ type: 'RAYEN_PRESCRIPTION_OPTIONS_REQUEST', encId });
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
        if (currentRouteEncounterId() !== String(encId || '')) {
          renderError('El episodio cambió. Cierra este panel y vuelve a abrir la receta del paciente actual.');
          submit.disabled = true;
          return;
        }
        submit.disabled = true;
        cancel.disabled = true;
        submit.textContent = 'Generando receta…';
        const result = await sendMessage({
          type: 'RAYEN_PRESCRIPTION_PRINT_REQUEST',
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
            type: 'RAYEN_HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST',
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
      selectVisible.textContent = 'Seleccionar visibles';
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
        const label = document.createElement('label');
        label.className = 'hhr-rx-patient' + (printable ? '' : ' is-disabled');
        label.dataset.search = normalizedText([
          patient.name,
          patient.run,
          patient.bed,
          patient.room,
          patient.service,
          ...(patient.prescribers || []).map(item => item.professional),
        ].join(' '));
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'hhr-bulk-patient';
        input.value = patient.encounterId;
        input.disabled = !printable;
        const details = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'hhr-rx-patient-title';
        const bed = document.createElement('span');
        bed.className = 'hhr-rx-bed';
        bed.textContent = patient.bed || patient.room || 'Sin cama';
        const name = document.createElement('span');
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
        meta.textContent = [patient.run, patient.service, patient.room].filter(Boolean).join(' · ');
        const prescribers = document.createElement('span');
        prescribers.className = 'hhr-rx-prescribers';
        if (patient.unavailableReason) {
          prescribers.textContent = 'No fue posible consultar la receta';
          label.title = patient.unavailableReason;
        } else if (!patient.medicationCount) {
          prescribers.textContent = 'Sin fármacos activos';
        } else {
          (patient.prescribers || []).forEach(item => {
            const line = document.createElement('span');
            const dateTime = helper.formatDateTimeLabel(item.validationDateTime);
            line.textContent = item.professional + ' · ' + item.count +
              (item.count === 1 ? ' fármaco' : ' fármacos');
            if (dateTime) {
              const time = document.createElement('span');
              time.className = 'hhr-rx-prescriber-time';
              time.textContent = ' · ' + dateTime;
              line.appendChild(time);
            }
            prescribers.appendChild(line);
          });
        }
        details.append(title, meta, prescribers);
        label.append(input, details);
        list.appendChild(label);
      });
      body.append(toolbar, selectionSummary, list);
      const formats = renderFormats('hhr-bulk-prescription-format');

      const visibleCheckboxes = () => Array.from(list.querySelectorAll('input:not(:disabled)'))
        .filter(input => !input.closest('.hhr-rx-patient').hidden);
      const selectedCheckboxes = () => Array.from(list.querySelectorAll('input:checked'));
      const updateSelection = () => {
        const count = selectedCheckboxes().length;
        selectedText.textContent = count === 1 ? '1 paciente seleccionado' : count + ' pacientes seleccionados';
        submit.disabled = count === 0;
        submit.textContent = count === 1 ? 'Imprimir 1 receta' : 'Imprimir ' + count + ' recetas';
      };
      search.addEventListener('input', () => {
        const query = normalizedText(search.value);
        Array.from(list.children).forEach(row => {
          row.hidden = Boolean(query) && !String(row.dataset.search || '').includes(query);
        });
      });
      selectVisible.addEventListener('click', () => {
        visibleCheckboxes().forEach(input => { input.checked = true; });
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
          type: 'RAYEN_HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST',
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
        showSuccess(
          'Se abrió un PDF con ' + result.count + (result.count === 1 ? ' receta' : ' recetas') +
          ' y el diálogo de impresión.' +
          (skipped ? ' No se pudieron incluir ' + skipped + (skipped === 1 ? ' paciente.' : ' pacientes.') : '') +
          ' Puedes ajustar la selección e imprimir nuevamente.',
          updateSelection
        );
      };
    };

    const activateTab = tabName => {
      activeTab = tabName;
      viewGeneration += 1;
      const generation = viewGeneration;
      tabs.forEach(tab => {
        const selected = tab.dataset.tab === tabName;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      const activeTabElement = tabs.find(tab => tab.dataset.tab === tabName);
      body.setAttribute('aria-labelledby', activeTabElement?.id || '');
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
    activateTab(hasCurrentPatient ? 'current' : 'hospitalized');
  };

  const createHospitalizedDocumentsModal = (kind, encId) => {
    const focusReturnTarget = document.activeElement;
    if (!closeModal()) return;
    ensureStyles();
    const isRegimen = kind === 'regimen';
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.dataset.encounterId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
    root.innerHTML = `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog" role="dialog" aria-modal="true" aria-labelledby="hhr-rx-title">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <header class="hhr-rx-header">
          <h2 class="hhr-rx-title" id="hhr-rx-title"></h2>
          <p class="hhr-rx-subtitle"></p>
        </header>
        <div class="hhr-rx-body"><div class="hhr-rx-status">Buscando pacientes hospitalizados…</div></div>
        <footer class="hhr-rx-footer">
          <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
          <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled></button>
        </footer>
      </section>
    `;
    const title = root.querySelector('.hhr-rx-title');
    const subtitle = root.querySelector('.hhr-rx-subtitle');
    const body = root.querySelector('.hhr-rx-body');
    const submit = root.querySelector('.hhr-rx-submit');
    const cancel = root.querySelector('.hhr-rx-cancel');
    title.textContent = isRegimen ? 'Regímenes y BRADEN' : 'Indicaciones de hospitalizados';
    subtitle.textContent = isRegimen
      ? 'Genera una tabla única con régimen vigente, observación, fecha, valor BRADEN, clasificación y fecha de escala.'
      : 'Selecciona uno, varios o todos los pacientes. Sus indicaciones oficiales se abrirán en un único PDF.';
    submit.textContent = isRegimen ? 'Imprimir regímenes + BRADEN' : 'Imprimir indicaciones';
    document.body.appendChild(root);

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
        selectVisible.textContent = 'Seleccionar visibles';
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
        if (!isRegimen) {
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.name = 'hhr-clinical-document-patient';
          input.value = patient.encounterId;
          input.checked = Boolean(patient.isCurrent);
          row.appendChild(input);
        }
        const details = document.createElement('span');
        const patientTitle = document.createElement('span');
        patientTitle.className = 'hhr-rx-patient-title';
        const bed = document.createElement('span');
        bed.className = 'hhr-rx-bed';
        bed.textContent = patient.bed || patient.room || 'Sin cama';
        const patientName = document.createElement('span');
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
        meta.textContent = [patient.run, patient.service, patient.room].filter(Boolean).join(' · ');
        details.append(patientTitle, meta);
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

      const visibleInputs = () => Array.from(list.querySelectorAll('input'))
        .filter(input => !input.closest('.hhr-rx-patient').hidden);
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
      search.addEventListener('input', () => {
        const query = normalizedText(search.value);
        Array.from(list.children).forEach(row => {
          row.hidden = Boolean(query) && !String(row.dataset.search || '').includes(query);
        });
      });
      if (!isRegimen) {
        selectVisible.addEventListener('click', () => {
          visibleInputs().forEach(input => { input.checked = true; });
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
          ? { type: 'RAYEN_HOSPITALIZED_REGIMEN_PRINT_REQUEST' }
          : {
              type: 'RAYEN_HOSPITALIZED_INDICATIONS_PRINT_REQUEST',
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
        ? 'RAYEN_HOSPITALIZED_REGIMEN_OPTIONS_REQUEST'
        : 'RAYEN_HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST',
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
        key: 'recipes', label: 'Rx', title: 'Recetas',
        icon: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
      },
      {
        key: 'regimen', label: 'Reg', title: 'Regímenes y BRADEN',
        icon: '<path d="M4 19h16M5 15h14M7 15a5 5 0 0 1 10 0M12 8V5M10 5h4"/>',
      },
      {
        key: 'indications', label: 'Ind', title: 'Indicaciones',
        icon: '<path d="M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6"/>',
      },
      {
        key: 'handoff', label: 'Turno', title: 'Entrega de turno',
        icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11l2 2 3-4"/>',
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
        key: 'connection', label: 'Con', title: 'Conexiones',
        icon: '<path d="M8 12a4 4 0 0 1 4-4h3M16 12a4 4 0 0 1-4 4H9M10 12h4M18 5v4h-4M6 19v-4h4"/>',
      },
    ];
    return items.map(item => `
      <button class="hhr-center-nav-button" type="button" data-module="${item.key}"
        title="${item.title}" aria-label="${item.title}" ${item.key === activeModule ? 'aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span>${item.label}</span>
      </button>
    `).join('');
  };

  const renderHandoffCenter = (root, encId) => {
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
      if (!confirmClinicalTransition(root, { allowUncertain: true })) return;
      renderHandoffCenter(root, encId);
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
        type: 'RAYEN_HANDOFF_REPORT_REQUEST',
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

    sendMessage({ type: 'RAYEN_HANDOFF_OPTIONS_REQUEST', currentEncId: encId || '' }).then(response => {
      if (!root.isConnected || root.dataset.activeModule !== 'handoff') return;
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
        '. Solo puedes registrar ' + handoffLabel.toLowerCase() + '.';
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
        <colgroup><col style="width:6%"><col style="width:19%"><col style="width:23%"><col style="width:13%"><col style="width:28%"><col style="width:11%"></colgroup>
        <thead><tr><th>Cama</th><th>Paciente / RUN</th><th>Última ${response.handoffKind === 'medical' ? 'entrega médica' : 'entrega de enfermería'}</th><th>Profesional</th><th>Nueva entrega</th><th>Estado</th></tr></thead><tbody></tbody>
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
        const latestCell = document.createElement('td');
        latestCell.dataset.label = 'Última entrega';
        const authorCell = document.createElement('td');
        authorCell.dataset.label = 'Profesional';
        const fillLatest = latest => {
          latestCell.innerHTML = '';
          authorCell.innerHTML = '';
          if (!latest) {
            latestCell.textContent = patient.handoffUnavailableReason ? 'No disponible' : 'Sin entrega registrada';
            authorCell.textContent = '-';
            return;
          }
          latestCell.textContent = latest.observation;
          const time = document.createElement('span');
          time.className = 'hhr-center-meta';
          time.textContent = helper.formatDateTimeLabel(latest.dateTime);
          latestCell.appendChild(time);
          authorCell.textContent = latest.author || '-';
          const signature = document.createElement('span');
          signature.className = 'hhr-center-meta';
          signature.textContent = latest.isSigned ? 'Firmado' : latest.requiresValidation ? 'Pendiente de validar' : 'Guardado';
          authorCell.appendChild(signature);
        };
        fillLatest(patient.latestHandoff);
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
        save.className = 'hhr-row-save';
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
            type: 'RAYEN_HANDOFF_SAVE_REQUEST',
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
          const persistedState = result.record && result.record.isSigned
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
        row.append(bedCell, patientCell, latestCell, authorCell, editorCell, statusCell);
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
      if (!confirmClinicalTransition(root, { allowUncertain: true })) return;
      renderScoresCenter(root, encId);
    });

    sendMessage({ type: 'RAYEN_SCORES_OPTIONS_REQUEST', currentEncId: encId || '' }).then(response => {
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
          window.alert('Esta aplicación no pudo confirmarse y permanece protegida hasta revisar su estado en Eloísa.');
          return;
        }
        const previous = main.querySelector('.hhr-score-form');
        if (previous) {
          if (!confirmClinicalTransition(root, { allowUncertain: true })) return;
          previous.remove();
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
          if (!confirmClinicalTransition(root)) return;
          panel.remove();
          if (focusReturnTarget && focusReturnTarget.isConnected && typeof focusReturnTarget.focus === 'function') {
            focusReturnTarget.focus();
          } else if (selector && selector.isConnected) {
            selector.focus();
          }
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
          type: 'RAYEN_SCORE_FORM_REQUEST',
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
              type: 'RAYEN_SCORE_SAVE_REQUEST',
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
                  ? [{ total: raw.crdValue, dateTime: raw.crdDateTime, author: raw.author || '' }]
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
          const authorCell = document.createElement('td'); authorCell.dataset.label = 'Profesional'; authorCell.textContent = values[4];
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
        if (!confirmClinicalTransition(root, { allowUncertain: true })) {
          selector.value = selectedInstrument;
          return;
        }
        selectedInstrument = nextInstrument;
        const openPanel = main.querySelector('.hhr-score-form');
        if (openPanel) openPanel.remove();
        renderTable();
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
        <h2 class="hhr-center-heading">Laboratorio Syslab</h2>
        <input class="hhr-center-search hhr-lab-filter" type="search" placeholder="Filtrar por fecha o examen" aria-label="Filtrar informes">
        <button class="hhr-center-action hhr-lab-select-all" type="button" disabled>Seleccionar todos</button>
        <button class="hhr-center-action hhr-center-action-primary hhr-lab-analyze" type="button" disabled>Analizar</button>
        <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
      </div>
      <div class="hhr-center-content">
        <div class="hhr-lab-patient"><strong>Paciente actual</strong><span>Identificando desde Eloísa…</span><span class="hhr-lab-status">Conectando a Syslab local</span></div>
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
    let batchId = '';
    let exams = [];
    let selected = new Set();
    let analysis = null;
    let activeTab = 'comparison';
    let requestGeneration = 0;
    let isAnalyzing = false;

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
      const visible = visibleExams();
      if (!isAnalyzing) {
        status.textContent = exams.length
          ? `${selected.size} de ${exams.length} informes seleccionados · máximo ${LAB_MAX_SELECTED_EXAMS}`
          : 'No hay informes disponibles para este paciente.';
        analyze.textContent = selected.size ? `Analizar ${selected.size}` : 'Analizar';
      }
      analyze.disabled = isAnalyzing || selected.size === 0;
      selectAll.disabled = isAnalyzing || visible.length === 0;
      selectAll.textContent = visible.length && visible.every(exam => selected.has(exam.id))
        ? 'Quitar visibles' : 'Seleccionar visibles';
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
          const response = await sendMessage({ type: 'RAYEN_LAB_PDF_OPEN_REQUEST', batchId, examId: exam.id });
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
      status.textContent = 'Buscando exámenes en Syslab…';
      list.innerHTML = '<div class="hhr-center-empty">Consultando la sesión oficial de Syslab en la red local…</div>';
      results.innerHTML = '';
      analyze.disabled = true;
      selectAll.disabled = true;
      filter.disabled = true;
      refresh.disabled = true;
      const response = await sendMessage({ type: 'RAYEN_LAB_SEARCH_REQUEST', encId: encId || '' });
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
    filter.addEventListener('input', renderList);
    selectAll.addEventListener('click', () => {
      const visible = visibleExams();
      const selectionBefore = [...selected].sort().join('|');
      const shouldSelect = !visible.every(exam => selected.has(exam.id));
      visible.forEach(exam => {
        if (shouldSelect && selected.size < LAB_MAX_SELECTED_EXAMS) selected.add(exam.id);
        else if (!shouldSelect) selected.delete(exam.id);
      });
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
        type: 'RAYEN_LAB_DETAILS_REQUEST',
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
      const report = await sendMessage({ type: 'RAYEN_EXTENSION_HEALTH_REQUEST' });
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
        type: 'RAYEN_GC_CONNECT_REQUEST',
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
      const response = await sendMessage({ type: 'RAYEN_GC_DISCONNECT_REQUEST' });
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

  let operationsConnectionCheckAt = 0;
  let operationsConnectionCheck = null;
  const refreshOperationsConnectionBadge = (bar, force = false, knownReport = null) => {
    if (!bar) return Promise.resolve(null);
    const button = bar.querySelector('.hhr-ops-session');
    if (!button) return Promise.resolve(null);
    const apply = report => {
      if (!report || !bar.isConnected) return report;
      const ficha = report.fichaMedico || {};
      const camas = report.gestionCamas || {};
      const identity = ficha.identity || {};
      const name = identity.fullName || 'Sesión HHR';
      const role = String(identity.role || '');
      const handoffButton = bar.querySelector('.hhr-ops-handoff');
      if (handoffButton) {
        const handoffTitle = globalThis.HhrPrescriptionPrint.handoffLabelForIdentity(
          role,
          identity.practitionerRoleId
        );
        handoffButton.title = handoffTitle;
        handoffButton.setAttribute('aria-label', handoffTitle);
      }
      button.querySelector('.hhr-ops-avatar').textContent = connectionInitials(name);
      button.className = 'hhr-ops-session ' + (
        ficha.status !== 'ready' ? 'is-offline' : camas.status === 'ready' ? 'is-ready' : 'is-degraded'
      );
      button.title = [
        name,
        ficha.status === 'ready' ? 'Ficha Médico conectada' : 'Ficha Médico no conectada',
        camas.status === 'ready' ? 'Gestión de Camas · ' + connectionTimeLabel(camas) : 'Gestión de Camas no conectada',
      ].join(' · ');
      button.setAttribute('aria-label', button.title);
      return report;
    };
    if (knownReport) {
      operationsConnectionCheckAt = Date.now();
      return Promise.resolve(apply(knownReport));
    }
    if (!force && Date.now() - operationsConnectionCheckAt < 30 * 1000) return Promise.resolve(null);
    if (operationsConnectionCheck) return operationsConnectionCheck;
    operationsConnectionCheck = sendMessage({ type: 'RAYEN_EXTENSION_HEALTH_REQUEST' })
      .then(report => apply(report && !report.error ? report : null))
      .finally(() => {
        operationsConnectionCheckAt = Date.now();
        operationsConnectionCheck = null;
      });
    return operationsConnectionCheck;
  };

  const createOperationsCenterModal = (module, encId, returnFocusTarget = null) => {
    const focusReturnTarget = returnFocusTarget || document.activeElement;
    if (!closeModal()) return;
    ensureStyles();
    const activeModule = ['scores', 'connection', 'lab'].includes(module) ? module : 'handoff';
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.dataset.encounterId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
    root.dataset.activeModule = activeModule;
    root.innerHTML = `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog hhr-center-dialog" role="dialog" aria-modal="true" aria-label="Centro HHR">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <header class="hhr-center-header"><img alt="" aria-hidden="true"><strong>Centro HHR</strong></header>
        <div class="hhr-center-shell"><nav class="hhr-center-nav" aria-label="Módulos clínicos">${centerNavMarkup(activeModule)}</nav><main class="hhr-center-main"></main></div>
      </section>
    `;
    try { root.querySelector('.hhr-center-header img').src = chrome.runtime.getURL('hhr-logo.svg'); } catch (_error) { root.querySelector('.hhr-center-header img').remove(); }
    getClinicalGuard(root);
    const dismiss = () => {
      if (!confirmClinicalTransition(root)) return false;
      root.remove();
      if (focusReturnTarget && focusReturnTarget.isConnected && typeof focusReturnTarget.focus === 'function') {
        window.setTimeout(() => focusReturnTarget.focus(), 0);
      }
      return true;
    };
    root.__hhrDismiss = dismiss;
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
    root.querySelectorAll('.hhr-center-nav-button').forEach(button => {
      button.addEventListener('click', () => {
        const target = button.dataset.module;
        if (target === activeModule) return;
        if (!confirmClinicalTransition(root)) return;
        root.__hhrDismiss = null;
        root.remove();
        if (target === 'recipes') createModal(encId);
        else if (target === 'regimen' || target === 'indications') createHospitalizedDocumentsModal(target, encId);
        else createOperationsCenterModal(target, encId, focusReturnTarget);
      });
    });
    document.body.appendChild(root);
    root.querySelector('.hhr-rx-close').focus();
    if (activeModule === 'handoff') renderHandoffCenter(root, encId);
    else if (activeModule === 'scores') renderScoresCenter(root, encId);
    else if (activeModule === 'lab') renderLabCenter(root, encId);
    else renderConnectionCenter(root, encId);
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
    const result = await sendMessage({ type: 'RAYEN_INDICATIONS_PRINT_REQUEST', encId });
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

  const ensureOperationsBar = encId => {
    let bar = document.getElementById(OPERATIONS_BAR_ID);
    if (!bar) {
      ensureStyles();
      bar = document.createElement('aside');
      bar.id = OPERATIONS_BAR_ID;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Centro de operaciones del Hospital Hanga Roa');
      bar.innerHTML = `
        <div class="hhr-ops-brand" aria-label="Hospital Hanga Roa">
          <img class="hhr-ops-logo" alt="" aria-hidden="true">
          <span class="hhr-ops-brand-copy">
            <strong>Centro HHR</strong>
            <span>Operaciones clínicas</span>
          </span>
        </div>
        <button class="hhr-ops-session is-degraded" type="button" aria-label="Comprobar conexiones" title="Comprobar conexiones">
          <span class="hhr-ops-avatar" aria-hidden="true">HHR</span>
          <span class="hhr-ops-connection-dot" aria-hidden="true"></span>
        </button>
        <div class="hhr-ops-modules">
          <button class="hhr-ops-module hhr-ops-recipes" type="button" aria-label="Abrir centro de recetas" title="Recetas">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v4h4v4h12v-4h4v-4c0-1.66-1.34-3-3-3Zm-3 9H8v-5h8v5Zm3-5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM18 3H6v4h12V3Z"/>
            </svg>
            <span>Rx</span>
          </button>
          <button class="hhr-ops-module hhr-ops-regimens" type="button" aria-label="Imprimir regímenes y BRADEN" title="Regímenes y BRADEN">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19h16v2H4v-2Zm8-16c4.42 0 8 3.58 8 8H4c0-4.08 3.05-7.44 7-7.94V2h2v1.06c3.95.5 7 3.86 7 7.94h-2c0-3.31-2.69-6-6-6s-6 2.69-6 6H4c0-4.42 3.58-8 8-8Zm-9 9h18v5H3v-5Z"/>
            </svg>
            <span>Reg</span>
          </button>
          <button class="hhr-ops-module hhr-ops-indications" type="button" aria-label="Imprimir indicaciones de hospitalizados" title="Indicaciones de hospitalizados">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6Zm1 7V3.5L20.5 9H15ZM8 13h8v2H8v-2Zm0 4h8v2H8v-2Zm0-8h4v2H8V9Z"/>
            </svg>
            <span>Ind</span>
          </button>
          <button class="hhr-ops-module hhr-ops-handoff" type="button" aria-label="Entrega de turno" title="Entrega de turno">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v2h11.1a6.9 6.9 0 0 1-.1-1c0-2.07.92-3.93 2.38-5.19A12.7 12.7 0 0 0 9 13Zm8.5 0a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm-.72 8.25-2.3-2.3 1.06-1.06 1.24 1.23 2.68-2.68 1.06 1.06-3.74 3.75Z"/>
            </svg>
            <span>Tur</span>
          </button>
          <button class="hhr-ops-module hhr-ops-scores" type="button" aria-label="Scores de enfermería" title="Scores de enfermería">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 21h18v-2H3v2Zm2-4h3V9H5v8Zm5 0h3V3h-3v14Zm5 0h3v-6h-3v6Zm4-11.5 1.4 1.4L23 4.3 21.7 3l-2.7 2.5Z"/>
            </svg>
            <span>Scr</span>
          </button>
          <button class="hhr-ops-module hhr-ops-lab" type="button" aria-label="Exámenes de laboratorio" title="Exámenes de laboratorio Syslab">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 2v2h1v5.59l-5.7 9.88A1.68 1.68 0 0 0 5.76 22h12.48a1.68 1.68 0 0 0 1.46-2.53L14 9.59V4h1V2H9Zm3 8.12L14.24 14H9.76L12 10.12ZM6.34 20l2.27-4h6.78l2.27 4H6.34Z"/>
            </svg>
            <span>Lab</span>
          </button>
        </div>
      `;
      try {
        bar.querySelector('.hhr-ops-logo').src = chrome.runtime.getURL('hhr-logo.svg');
      } catch (_error) {
        bar.querySelector('.hhr-ops-logo').remove();
      }
      bar.querySelector('.hhr-ops-recipes').addEventListener('click', () =>
        createModal(bar.dataset.encounterId)
      );
      bar.querySelector('.hhr-ops-regimens').addEventListener('click', () =>
        createHospitalizedDocumentsModal('regimen', bar.dataset.encounterId)
      );
      bar.querySelector('.hhr-ops-indications').addEventListener('click', () =>
        createHospitalizedDocumentsModal('indications', bar.dataset.encounterId)
      );
      const sessionButton = bar.querySelector('.hhr-ops-session');
      const handoffButton = bar.querySelector('.hhr-ops-handoff');
      const scoresButton = bar.querySelector('.hhr-ops-scores');
      const labButton = bar.querySelector('.hhr-ops-lab');
      sessionButton.addEventListener('click', () =>
        createOperationsCenterModal('connection', bar.dataset.encounterId, sessionButton)
      );
      handoffButton.addEventListener('click', () =>
        createOperationsCenterModal('handoff', bar.dataset.encounterId, handoffButton)
      );
      scoresButton.addEventListener('click', () =>
        createOperationsCenterModal('scores', bar.dataset.encounterId, scoresButton)
      );
      labButton.addEventListener('click', () =>
        createOperationsCenterModal('lab', bar.dataset.encounterId, labButton)
      );
      document.body.appendChild(bar);
    }
    bar.dataset.encounterId = encId || '';
    const labButton = bar.querySelector('.hhr-ops-lab');
    if (labButton) {
      labButton.disabled = !encId || !labHelper;
      labButton.title = !labHelper
        ? 'Recarga la extensión para activar laboratorio'
        : encId
        ? 'Exámenes de laboratorio Syslab'
        : 'Abre un episodio clínico para consultar laboratorio';
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
    if (modal && modal.dataset.encounterId !== expectedEncounterId) {
      if (modal.dataset.routeStale === 'true') {
        // A clinical write was already in flight when the route changed. Keep its frozen
        // result panel visible until the user reviews the confirmation and closes it.
      } else if (typeof modal.__hhrDismiss === 'function') {
        const guard = getClinicalGuard(modal);
        if (guard.pending.size) {
          freezeClinicalModalForEncounterChange(modal);
        } else {
          if (guard.dirty.size) {
            window.alert(
              'El episodio cambió. Los datos sin guardar se descartaron para evitar asociarlos al paciente equivocado.'
            );
          }
          modal.remove();
        }
      } else {
        closeModal(true);
      }
    }
    ensureOperationsBar(encId);
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
