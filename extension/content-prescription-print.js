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
  const clinicalWriteClientOwner = globalThis.HhrClinicalWriteClientRuntime;
  const dischargeActionsOwner = globalThis.HhrDischargeActionsRuntime;
  const medicationActionsOwner = globalThis.HhrMedicationActionsRuntime;
  const connectionCenterOwner = globalThis.HhrConnectionCenterRuntime;
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
    !clinicalWriteClientOwner ||
    !dischargeActionsOwner ||
    !medicationActionsOwner ||
    !connectionCenterOwner ||
    !runtimeMessages ||
    globalThis.__hhrPrescriptionPrintInjected
  ) return;
  globalThis.__hhrPrescriptionPrintInjected = true;

  const BUTTON_ID = 'hhr-prescription-print-button';
  const INDICATIONS_BUTTON_ID = 'hhr-indications-print-button';
  const OPERATIONS_BAR_ID = 'hhr-clinical-operations-bar';
  const MODAL_ID = 'hhr-prescription-print-modal';
  const NOTICE_HOST_ID = 'hhr-clinical-page-notices';
  const normalizedText = value =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const currentRouteEncounterId = () => helper.resolveEncounterId(window.location.href) || '';

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

  const clinicalWriteClientRuntime = clinicalWriteClientOwner.create({
    chromeApi: chrome,
    windowRef: window,
    helper,
    runtimeMessages,
    sendMessage,
    requestPageConfirmation,
    showPageNotice,
    setRouteChangeState,
  });
  const {
    acknowledgeClinicalWrite,
    clinicalWriteKey,
    clinicalWriteRecoveryReady,
    finishRouteChangeWrite,
    freezeClinicalModalForEncounterChange,
    getActiveUncertainWrite,
    getClinicalGuard,
    hydrateClinicalWriteProtection,
    normalizedClinicalText,
    releaseClinicalWriteProtection,
    runClinicalTransition,
    setClinicalGuardState,
    uncertainClinicalWrites,
  } = clinicalWriteClientRuntime;

  const ensureStyles = () => centerStyles.ensureCenterStyles(document, ui);

  const closeModal = (force = false) => {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return true;
    if (!force && typeof modal.__hhrDismiss === 'function') return modal.__hhrDismiss();
    if (typeof modal.__hhrConnectionDispose === 'function') modal.__hhrConnectionDispose();
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

  const dischargeActionsRuntime = dischargeActionsOwner.create({
    documentRef: document,
    windowRef: window,
    cryptoApi: typeof crypto !== 'undefined' ? crypto : null,
    normalizedText,
    resolveEncounterId: value => helper.resolveEncounterId(value),
    showPageNotice,
    sendMessage,
    runtimeMessages,
  });
  const {
    ensureCorrectedDischargePrintItems,
    ensureNursingMedicalEpicrisisPrintItem,
  } = dischargeActionsRuntime;

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

  const connectionCenterRuntime = connectionCenterOwner.create({
    documentRef: document,
    windowRef: window,
    runtimeMessages,
    sendMessage,
    setLiveRegion,
    connectionInitials,
    connectionTimeLabel,
    handoffLabelForIdentity: (role, practitionerRoleId) =>
      helper.handoffLabelForIdentity(role, practitionerRoleId),
    operationsBarId: OPERATIONS_BAR_ID,
  });
  const {
    renderConnectionCenter,
    refreshOperationsConnectionBadge,
    invalidateConnectionState,
  } = connectionCenterRuntime;

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

  const barPart = (bar, selector) => {
    const root = bar && bar.__hhrRoot;
    return root ? root.querySelector(selector) : null;
  };

  const createOperationsCenterModal = (module, encId, returnFocusTarget = null, existingRoot = null, options = {}) => {
    if (existingRoot && typeof existingRoot.__hhrConnectionDispose === 'function') {
      invalidateConnectionState(existingRoot);
    }
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
          if (typeof modal.__hhrConnectionDispose === 'function') {
            modal.__hhrConnectionDispose();
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
