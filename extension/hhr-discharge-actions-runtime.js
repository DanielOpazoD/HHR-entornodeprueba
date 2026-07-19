/**
 * hhr-discharge-actions-runtime.js (ISOLATED world)
 *
 * Owns the corrected-discharge and nursing medical-epicrisis actions rendered in Eloísa portal
 * menus. The consumer injects DOM, patient-resolution, notice and messaging dependencies so the
 * classic runtime remains independently testable and fails closed when its contract is incomplete.
 */
(() => {
  'use strict';

  if (globalThis.HhrDischargeActionsRuntime) return;

  const create = dependencies => {
    const {
      documentRef,
      windowRef,
      cryptoApi,
      normalizedText,
      resolveEncounterId,
      showPageNotice,
      sendMessage,
      runtimeMessages,
    } = dependencies || {};

    if (
      !documentRef ||
      !windowRef ||
      typeof normalizedText !== 'function' ||
      typeof resolveEncounterId !== 'function' ||
      typeof showPageNotice !== 'function' ||
      typeof sendMessage !== 'function' ||
      !runtimeMessages
    ) {
      throw new Error('No se pudo inicializar el runtime de acciones de alta HHR.');
    }

    const EPICRISIS_MENU_ITEM_ID = 'hhr-corrected-discharge-print';
    const CAPTURE_TIMEOUT_MS = 32_000;
    const epicrisisCaptureWaiters = new Map();
    let activeEpicrisisPrintReqId = '';
    let lastDischargePatientRun = '';
    let disposed = false;

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
        /\/dashboard\/encounter-list(?:-nurse)?(?:\/|\?)/.test(
          String(anchor.getAttribute('href') || '')
        )
      );
      if (!link) return '';
      const direct = String(link.getAttribute('href') || '').match(
        /\/dashboard\/encounter-list(?:-nurse)?\/(\d+)(?:[/?#]|$)/
      );
      return direct ? direct[1] : resolveEncounterId(link.href) || '';
    };

    // Eloísa renders the action menu in a portal, outside the patient row. Remember the RUN when
    // the user opens a row action so the captured PDF can later be bound to that patient.
    const rememberDischargePatientFromEvent = event => {
      const ElementCtor = windowRef.Element;
      const target = ElementCtor && event.target instanceof ElementCtor ? event.target : null;
      const row = target && target.closest('tr,[role="row"]');
      if (!row) return;
      lastDischargePatientRun = runFromPatientRow(row);
    };

    const dischargePatientFromOpenMenu = () => {
      const expandedActions = Array.from(
        documentRef.querySelectorAll(
          'button[aria-expanded="true"],[role="button"][aria-expanded="true"]'
        )
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

    const settleEpicrisisCapture = (reqId, result) => {
      const waiter = epicrisisCaptureWaiters.get(reqId);
      if (!waiter) return false;
      epicrisisCaptureWaiters.delete(reqId);
      windowRef.clearTimeout(waiter.timeout);
      waiter.resolve(result);
      return true;
    };

    const cancelEpicrisisCapture = (reqId, message = 'La captura del PDF de alta fue cancelada.') =>
      settleEpicrisisCapture(reqId, { error: message, cancelled: true });

    const onEpicrisisCaptureMessage = event => {
      if (
        event.source !== windowRef ||
        (event.origin && event.origin !== windowRef.location.origin)
      ) return;
      const data = event.data || {};
      if (data.type !== 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT') return;
      settleEpicrisisCapture(String(data.reqId || ''), data);
    };

    const waitForEpicrisisCapture = reqId => new Promise(resolve => {
      const timeout = windowRef.setTimeout(() => {
        settleEpicrisisCapture(reqId, {
          error: 'Eloísa no generó el PDF de alta dentro del tiempo esperado.',
        });
      }, CAPTURE_TIMEOUT_MS);
      epicrisisCaptureWaiters.set(reqId, { resolve, timeout });
    });

    const findNativeDischargePrintItems = () => Array.from(
      documentRef.querySelectorAll('button,[role="menuitem"]')
    ).filter(element =>
      normalizedText(element.textContent) === 'imprimir alta medica' &&
      element.dataset.hhrCorrectedDischargePrint !== 'true'
    );

    const requestCorrectedDischargePrint = async (nativeItem, item) => {
      if (disposed || activeEpicrisisPrintReqId) return;
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
      const reqId = cryptoApi && typeof cryptoApi.randomUUID === 'function'
        ? cryptoApi.randomUUID()
        : 'epicrisis-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      lastDischargePatientRun = expectedPatientRun;
      activeEpicrisisPrintReqId = reqId;
      setCorrectedDischargeItemLabel(item, 'Preparando alta corregida…');
      item.setAttribute('aria-busy', 'true');
      item.setAttribute('aria-disabled', 'true');
      item.style.pointerEvents = 'none';
      const captured = waitForEpicrisisCapture(reqId);
      windowRef.postMessage({
        type: 'RAYEN_EPICRISIS_PDF_CAPTURE_ARM',
        reqId,
        patientRun: expectedPatientRun,
      }, windowRef.location.origin);
      try {
        nativeItem.click();
        const result = await captured;
        if (result.error) throw new Error(result.error);
        const response = await sendMessage({
          type: runtimeMessages.EPICRISIS_CORRECTED_PRINT_REQUEST,
          pdfBase64: String(result.pdfBase64 || ''),
          patientRun: expectedPatientRun,
        });
        if (!response || response.error) {
          throw new Error(String(
            response && response.error || 'No se pudo preparar el alta corregida.'
          ));
        }
      } catch (error) {
        if (!disposed) {
          showPageNotice(
            String((error && error.message) || error || 'No se pudo preparar el alta corregida.'),
            { title: 'Alta corregida', error: true }
          );
        }
      } finally {
        // Covers thrown native clicks, timeouts, disposal and normal completion. The cancellation
        // settles and removes any still-pending waiter immediately instead of retaining it for 32s.
        cancelEpicrisisCapture(reqId);
        windowRef.postMessage({
          type: 'RAYEN_EPICRISIS_PDF_CAPTURE_CANCEL',
          reqId,
        }, windowRef.location.origin);
        if (activeEpicrisisPrintReqId === reqId) activeEpicrisisPrintReqId = '';
        setCorrectedDischargeItemLabel(item, 'Imprimir alta corregida');
        item.removeAttribute('aria-busy');
        item.removeAttribute('aria-disabled');
        item.style.pointerEvents = '';
      }
    };

    const ensureCorrectedDischargePrintItems = () => {
      if (disposed) return;
      findNativeDischargePrintItems().forEach(nativeItem => {
        const nextItem = nativeItem.nextElementSibling;
        if (nextItem && nextItem.dataset.hhrCorrectedDischargePrint === 'true') return;
        const item = nativeItem.cloneNode(true);
        item.removeAttribute('id');
        if (!documentRef.getElementById(EPICRISIS_MENU_ITEM_ID)) {
          item.id = EPICRISIS_MENU_ITEM_ID;
        }
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

    const nursingMedicalEpicrisisMenu = () => Array.from(documentRef.querySelectorAll(
      '[role="menu"],[class*="MuiMenu-paper"],[class*="MuiPopover-paper"]'
    )).find(menu => {
      if (menu.hidden || menu.getAttribute('aria-hidden') === 'true') return false;
      return Array.from(menu.querySelectorAll('button,[role="menuitem"]')).some(action => {
        const label = normalizedText(action.textContent);
        return label.includes('alta') && /(revertir|imprimir|epicrisis)/.test(label);
      });
    }) || null;

    const requestNursingMedicalEpicrisisPrint = async item => {
      if (disposed || activeEpicrisisPrintReqId) return;
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
          throw new Error(String(
            response && response.error || 'No se pudo imprimir la epicrisis médica.'
          ));
        }
      } catch (error) {
        if (!disposed) {
          showPageNotice(
            String((error && error.message) || error || 'No se pudo imprimir la epicrisis médica.'),
            { title: 'Epicrisis médica', error: true }
          );
        }
      } finally {
        activeEpicrisisPrintReqId = '';
        setCorrectedDischargeItemLabel(item, 'Imprimir epicrisis médica');
        item.removeAttribute('aria-busy');
        item.removeAttribute('aria-disabled');
        item.style.pointerEvents = '';
      }
    };

    const ensureNursingMedicalEpicrisisPrintItem = nursingContext => {
      if (
        disposed ||
        !nursingContext ||
        !/\?tab=3(?:&|$)/.test(windowRef.location.search || '?tab=3')
      ) return;
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

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      documentRef.removeEventListener('click', rememberDischargePatientFromEvent, true);
      documentRef.removeEventListener('focusin', rememberDischargePatientFromEvent, true);
      windowRef.removeEventListener('message', onEpicrisisCaptureMessage);
      Array.from(epicrisisCaptureWaiters.keys()).forEach(reqId =>
        cancelEpicrisisCapture(reqId)
      );
      activeEpicrisisPrintReqId = '';
    };

    documentRef.addEventListener('click', rememberDischargePatientFromEvent, true);
    documentRef.addEventListener('focusin', rememberDischargePatientFromEvent, true);
    windowRef.addEventListener('message', onEpicrisisCaptureMessage);

    return Object.freeze({
      ensureCorrectedDischargePrintItems,
      ensureNursingMedicalEpicrisisPrintItem,
      dispose,
    });
  };

  globalThis.HhrDischargeActionsRuntime = Object.freeze({ create });
})();
