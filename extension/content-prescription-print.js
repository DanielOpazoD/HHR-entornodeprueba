/**
 * content-prescription-print.js (ISOLATED world)
 *
 * Adds compact prescription and examination tools across Ficha Médico through Centro HHR.
 * The panel asks the service worker for official Eloisa reports and verified nursing workflows.
 * Clinical writes are
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
  const labCenterOwner = globalThis.HhrLabCenterRuntime;
  const clinicalWriteClientOwner = globalThis.HhrClinicalWriteClientRuntime;
  const dischargeActionsOwner = globalThis.HhrDischargeActionsRuntime;
  const medicationActionsOwner = globalThis.HhrMedicationActionsRuntime;
  const connectionCenterOwner = globalThis.HhrConnectionCenterRuntime;
  const imagingCenterOwner = globalThis.HhrImagingCenterRuntime;
  // Imaging interaction contracts (owned by hhr-imaging-center.js):
  // class="hhr-imaging-canvas" role="group" tabindex="0"
  // event.key === 'Enter' || event.key === ' '
  // editor.addEventListener('keydown' -> event.stopPropagation(); restoreCanvasFocus = true;
  // canvas.focus({ preventScroll: true }); overlaysHost.appendChild(editor)
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
    !labCenterOwner ||
    !clinicalWriteClientOwner ||
    !dischargeActionsOwner ||
    !medicationActionsOwner ||
    !connectionCenterOwner ||
    !runtimeMessages ||
    !globalThis.HhrPrescriptionContentRuntime ||
    !globalThis.HhrPrescriptionUiLifecycle
  ) return;
  const uiLifecycle = globalThis.HhrPrescriptionUiLifecycle.create(chrome);
  const initialize = () => {
    if (!uiLifecycle.preparePrevious()) {
      uiLifecycle.waitForModalClosure(initialize);
      return;
    }
  uiLifecycle.claim();
  globalThis.__hhrPrescriptionPrintInjected = true;
  let active = true;
  const historyNavigation = globalThis.HhrHistoryDateNavigation?.create();
  const nativePresentation = globalThis.HhrNativeFichaPresentation?.create();
  const worklistPresentation = globalThis.HhrNativeWorklistPresentation?.create();

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

  document.documentElement.dataset.hhrPrescriptionPrintScript = uiLifecycle.version;

  const sendMessage = globalThis.HhrPrescriptionContentRuntime.createSendMessage({
    runtimeMessages, chromeApi: chrome, windowRef: window,
  });

  const onWorklistEdit = async event => {
    const button = event.target.closest?.('button[data-hhr-edit-episode]');
    if (!event.isTrusted || !button || !uiLifecycle.owns() ||
        !/^\/dashboard\/encounter-list-nurse\/?$/.test(location.pathname) ||
        !button.closest('table[data-hhr-compact-worklist]')) return;
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await sendMessage({ type: runtimeMessages.WORKLIST_PATIENT_EDIT, encId: button.dataset.hhrEditEpisode });
      if (!result?.ok && active) showPageNotice(result?.error || 'No se pudo abrir Gestión de Camas.', { title: 'Modificar paciente', error: true });
    } finally { button.disabled = false; }
  };
  document.addEventListener('click', onWorklistEdit, true);
  const pendingWorklistPrints = new Set();
  const onWorklistPrint = async event => {
    const button = event.target.closest?.('button[data-hhr-print-document]');
    if (!event.isTrusted || !button || button.disabled || !uiLifecycle.owns() ||
        !/^\/dashboard\/encounter-list(?:-nurse)?\/?$/.test(location.pathname) ||
        !button.closest('table[data-hhr-compact-worklist]')) return;
    const cell = button.closest('td.hhr-worklist-documents');
    const encId = cell?.dataset.hhrWorklistEpisode;
    const documentKind = button.dataset.hhrPrintDocument;
    if (!/^[1-9]\d*$/.test(encId) || !['indications', 'prescription'].includes(documentKind)) return;
    event.stopPropagation();
    const key = encId + '/' + documentKind;
    if (pendingWorklistPrints.has(key)) return;
    pendingWorklistPrints.add(key);
    button.setAttribute('aria-busy', 'true');
    try {
      const result = await sendMessage({ type: runtimeMessages.WORKLIST_DOCUMENT_PRINT_REQUEST, encId, documentKind, expectedPatientId: cell.dataset.hhrWorklistPatient });
      if (!result?.ok && active) showPageNotice(result?.error || 'No se pudo abrir la impresión.', { title: 'Imprimir', error: true });
    } finally {
      pendingWorklistPrints.delete(key);
      button.removeAttribute('aria-busy');
    }
  };
  document.addEventListener('click', onWorklistPrint, true);

  const focusableElements = root => Array.from(root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
      'a[href], [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true' &&
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
    freezeClinicalModalForEncounterChange,
    getClinicalGuard,
    runClinicalTransition,
  } = clinicalWriteClientRuntime;

  const ensureStyles = () => centerStyles.ensureCenterStyles(document, ui);
  const setActiveOperationsModule = moduleKey =>
    document.getElementById(OPERATIONS_BAR_ID)?.__hhrUi?.setActive(moduleKey);
  const clearActiveOperationsModule = () => setActiveOperationsModule('');

  const closeModal = (force = false) => {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return true;
    if (!force && typeof modal.__hhrDismiss === 'function') return modal.__hhrDismiss();
    if (typeof modal.__hhrConnectionDispose === 'function') modal.__hhrConnectionDispose();
    modal.remove();
    clearActiveOperationsModule();
    return true;
  };

  const modalDismissWithFocusRestore = (root, focusReturnTarget) => () => {
    if (root && root.isConnected) root.remove();
    clearActiveOperationsModule();
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

  // Initialized after the shared Centro shell; each extracted module owns its workflow.
  let createModal;
  let createHospitalizedDocumentsModal;

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
    hasVisibleNursingRole,
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
    onCenterDismiss: clearActiveOperationsModule,
    onCenterModuleChange: setActiveOperationsModule,
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
  let latestHealthPushReport = null;
  const healthPushOrdering = globalThis.HhrHealthPushOrderingRuntime.createReceiver();
  const connectionCenterRuntime = connectionCenterOwner.create({
    documentRef: document,
    windowRef: window,
    runtimeMessages,
    sendMessage,
    setLiveRegion,
    connectionInitials,
    connectionTimeLabel,
    operationsBarId: OPERATIONS_BAR_ID,
  });
  const {
    renderConnectionCenter,
    refreshOperationsConnectionBadge,
    invalidateConnectionState,
  } = connectionCenterRuntime;
  const onRuntimeMessage = (message, _sender, sendResponse) => {
    if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING') {
      sendMessage({ type: runtimeMessages.EXTENSION_RUNTIME_CONTEXT_REQUEST })
        .then(context => sendResponse({ uiReady: Boolean(context?.runtimeGeneration), uiBuildVersion: uiLifecycle.version }))
        .catch(() => sendResponse({ uiReady: false }));
      return true;
    }
    if (!message || message.type !== 'RAYEN_EXTENSION_HEALTH_PUSH' || !message.report ||
        !healthPushOrdering.accept(message)) return;
    latestHealthPushReport = message.report;
    const bar = document.getElementById(OPERATIONS_BAR_ID);
    if (bar) void refreshOperationsConnectionBadge(bar, true, message.report);
  };
  chrome.runtime.onMessage?.addListener(onRuntimeMessage);
  const fetchPatientHeaderView = async encId => {
    const response = await sendMessage({ type: runtimeMessages.PATIENT_HEADER_REQUEST, encId });
    if (!response || response.error) {
      return { error: (response && response.error) || 'No se pudo identificar al paciente.',
        errorCode: response?.errorCode, code: response?.code, requiresLogin: response?.requiresLogin,
        state: response?.state, status: response?.status };
    }
    const patient = response.patient || {};
    return {
      patient,
      actorId: response.actorId,
      view: requestForms.buildPatientView(patient, patient.formattedRun),
    };
  };

  const labCenterRuntime = labCenterOwner.create({
    labHelper,
    labRequestPatient: globalThis.HhrLabRequestPatient,
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

  const HOME_SHORTCUTS = [
    { module: 'recipes', icon: 'recipes', title: 'Recetas', desc: 'Recetas e indicaciones del paciente o de los hospitalizados.' },
    { module: 'lab', icon: 'lab', title: 'Laboratorio', desc: 'Resultados Syslab y solicitud de exámenes de sangre.' },
    { module: 'imaging', icon: 'imaging', title: 'Imágenes', desc: 'Solicitudes de imagenología con formularios oficiales.' },
  ];

  const renderHomeCenter = (root, encId) => {
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `
      <div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Herramientas de Eloísa</h2></div>
      <div class="hhr-center-content">
        <p class="hhr-home-intro">Recetas y exámenes a mano. El censo y el registro clínico completo están en HHR.</p>
        <div class="hhr-home-grid">
          ${HOME_SHORTCUTS.map(item => `
            <button class="hhr-home-card" type="button" data-module="${item.module}">
              <span class="hhr-home-card-icon">${ui.icons[item.icon]}</span>
              <strong>${item.title}</strong>
              <span class="hhr-home-card-desc">${item.desc}</span>
            </button>
          `).join('')}
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

  };

  const barPart = (bar, selector) => {
    const root = bar && bar.__hhrRoot;
    return root ? root.querySelector(selector) : null;
  };

  const createOperationsCenterModal = (module, encId, returnFocusTarget = null, existingRoot = null, flow) => {
    if (existingRoot && typeof existingRoot.__hhrConnectionDispose === 'function') {
      invalidateConnectionState(existingRoot);
    }
    const focusReturnTarget = existingRoot && existingRoot.__hhrFocusReturnTarget
      ? existingRoot.__hhrFocusReturnTarget
      : returnFocusTarget || document.activeElement;
    const activeModule = ['connection', 'lab', 'imaging', 'home', 'settings'].includes(module) ? module : 'home';
    const root = prepareCenterModalRoot({
      existingRoot,
      activeModule,
      encId,
      focusReturnTarget,
    });
    if (!root) return;
    if (flow === 'results' || flow === 'request') root.dataset.labFlow = flow;
    const renderModule = targetEncId => {
      if (activeModule === 'lab') {
        if (root.dataset.labFlow === 'results') labCenterRuntime.renderLabCenter(root, targetEncId);
        else labCenterRuntime.renderLabRequestView(root, targetEncId);
      }
      else if (activeModule === 'imaging') {
        if (!imagingCenterRuntime) {
          root.querySelector('.hhr-center-main').innerHTML =
            '<div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Imágenes</h2></div>' +
            '<div class="hhr-center-content"><div class="hhr-rx-error">El Centro de Imágenes no quedó cargado. Recarga la extensión y la pestaña.</div></div>';
          return;
        }
        imagingCenterRuntime.renderImagingCenter(root, targetEncId);
      }
      else if (activeModule === 'settings') globalThis.HhrCenterSettings.render({ root,
        operationsBar: document.getElementById(OPERATIONS_BAR_ID),
        openFavorites: panel => createFavoritesDialog(panel, () => createOperationsCenterModal('settings', targetEncId, null, panel)) });
      else if (activeModule === 'home') renderHomeCenter(root, targetEncId);
      else renderConnectionCenter(root, targetEncId);
    };
    setupCenterPatientContext(root, activeModule, encId, renderModule);
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
    const dateRect = document.getElementById('hhr-history-date-navigation')?.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const top = headerBottom + 5;
    const overlapsDates = dateRect && dateRect.left < barRect.right && dateRect.right > barRect.left &&
      dateRect.bottom > top && dateRect.top < top + barRect.height;
    bar.style.setProperty('--hhr-ops-top', Math.round(overlapsDates ? dateRect.bottom + 5 : top) + 'px');
  };

  const OPERATIONS_MODULES = [
    {
      key: 'recipes', icon: 'recipes',
      tip: 'Recetas médicas',
      note: 'Recetas e indicaciones del paciente o de los hospitalizados.',
      aria: 'Abrir centro de recetas',
    },
    {
      key: 'exams', icon: 'lab',
      tip: 'Exámenes', note: 'Laboratorio e imágenes del paciente.',
      aria: 'Exámenes: laboratorio e imágenes', hasMenu: true,
    },
  ];

  const ensureOperationsBar = encId => {
    let bar = uiLifecycle.takeBar(OPERATIONS_BAR_ID);
    if (!bar) {
      ensureStyles();
      bar = document.createElement('aside');
      bar.id = OPERATIONS_BAR_ID;
      uiLifecycle.markBar(bar);
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Centro de operaciones del Hospital Hanga Roa');
      const shadow = bar.attachShadow({ mode: 'open' });
      bar.__hhrRoot = shadow;
      shadow.innerHTML = `
        <style>${ui.barCss}</style>
        <button class="brand" type="button" aria-label="Abrir Centro HHR"
          data-tip="Centro HHR" data-tip-note="Abre el centro completo en el último módulo que usaste.">
          <img class="brand-logo" alt="" aria-hidden="true">
          <span class="brand-status" aria-hidden="true"></span>
        </button>
        <span class="divider" aria-hidden="true"></span>
        <div class="modules" role="group" aria-label="Módulos clínicos">
          ${OPERATIONS_MODULES.map(module => `
            <button class="module hhr-ops-${module.key}" type="button"
              aria-label="${module.aria}" data-tip="${module.tip}" data-tip-note="${module.note}"
              ${module.hasMenu ? 'aria-haspopup="menu" aria-expanded="false" aria-controls="hhr-exams-menu"' : ''}>
              ${ui.icons[module.icon]}
            </button>
          `).join('')}
          <div class="exams-menu" id="hhr-exams-menu" role="menu" aria-label="Tipos de exámenes" hidden>
            <button class="exam-item hhr-exams-results" type="button" role="menuitem" tabindex="-1" data-module="lab" data-flow="results">
              ${ui.icons.lab}<strong>Ver resultados</strong><small>Laboratorio Syslab</small>
            </button>
            <button class="exam-item hhr-exams-lab" type="button" role="menuitem" tabindex="-1" data-module="lab" data-flow="request">
              ${ui.icons.lab}<strong>Solicitar laboratorio</strong>
            </button>
            <button class="exam-item hhr-exams-imaging" type="button" role="menuitem" tabindex="-1" data-module="imaging">
              ${ui.icons.imaging}<strong>Solicitar imágenes</strong>
            </button>
          </div>
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
      shadow.querySelector('.hhr-ops-recipes').addEventListener('click', () =>
        centerShellRuntime.openCenterModule('recipes', bar.dataset.encounterId, shadow.querySelector('.hhr-ops-recipes'))
      );
      const sessionButton = shadow.querySelector('.hhr-ops-session');
      sessionButton.addEventListener('click', () =>
        centerShellRuntime.openCenterModule('connection', bar.dataset.encounterId, sessionButton)
      );
      ui.enableBarTooltips(shadow, bar);
      ui.enableRovingFocus(shadow);
      bar.__hhrUi = ui.createOperationsBarController({
        root: shadow, host: bar, storageArea: chrome.storage?.local,
        onOpenBrand: () => centerShellRuntime.openCenterModule(undefined, bar.dataset.encounterId, brandButton),
        onExamSelect: (module, trigger, flow) => centerShellRuntime.openCenterModule(module, bar.dataset.encounterId, trigger, flow),
      });
      document.body.appendChild(bar);
    }
    bar.dataset.encounterId = encId || '';
    [barPart(bar, '.hhr-exams-lab'), barPart(bar, '.hhr-exams-results')].filter(Boolean).forEach(labButton => {
      const labDisabled = !labHelper;
      labButton.setAttribute('aria-disabled', String(labDisabled));
      labButton.title = labDisabled ? 'Recarga la extensión para activar laboratorio' : '';
    });
    updateOperationsBarPosition(bar);
    void refreshOperationsConnectionBadge(
      bar,
      Boolean(latestHealthPushReport),
      latestHealthPushReport
    ).finally(() => {
      bar.dataset.connectionState = ['ready', 'degraded', 'offline'].find(state => barPart(bar, '.hhr-ops-session')?.classList.contains('is-' + state)) || 'degraded';
      bar.__hhrUi?.scheduleIdle();
    });
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
    if (modal?.isConnected) globalThis.HhrCenterPatientContext?.refreshRoute(modal, encId);
    nativePresentation?.refresh(encId);
    historyNavigation?.refresh(encId);
    worklistPresentation?.refresh(window.location.pathname);
    ensureOperationsBar(encId);
    ensureCorrectedDischargePrintItems();
    ensureNursingMedicalEpicrisisPrintItem(nursingContext);
    // Remove only extension-owned shortcuts left by an older injected version.
    existing?.remove();
    existingIndications?.remove();
    document.documentElement.setAttribute(
      'data-hhr-prescription-print-state', encId ? 'ready' : 'operations-ready'
    );
  };

  let scheduled = false;
  const scheduleEnsureButton = () => {
    if (!active || scheduled || !uiLifecycle.owns()) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      if (!active || !uiLifecycle.owns()) return;
      ensureButton();
    }, 80);
  };

  // Apply density to replacement tables before the browser paints. The other
  // controls still use the debounced operations UI refresh.
  const observer = new MutationObserver(records => {
    if (!active || !uiLifecycle.owns()) return;
    worklistPresentation?.refresh(window.location.pathname);
    if (records.some(record => record.type !== 'characterData')) scheduleEnsureButton();
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'],
  });
  window.addEventListener('popstate', scheduleEnsureButton);
  window.addEventListener('hashchange', scheduleEnsureButton);
  window.addEventListener('hhr:fichamedico-locationchange', scheduleEnsureButton);
  window.addEventListener('resize', scheduleEnsureButton);
  window.addEventListener('focus', scheduleEnsureButton);
  window.addEventListener('pageshow', scheduleEnsureButton);
  const onVisibilityChange = () => {
    if (!document.hidden) scheduleEnsureButton();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  globalThis.__hhrPrescriptionPrintRuntime = {
    dispose: () => {
      const modal = document.getElementById(MODAL_ID);
      if (modal) {
        const guard = getClinicalGuard(modal);
        if (guard.pending.size || guard.dirty.size) return false;
      }
      active = false;
      document.removeEventListener('click', onWorklistPrint, true);
      document.removeEventListener('click', onWorklistEdit, true);
      observer.disconnect();
      window.removeEventListener('popstate', scheduleEnsureButton);
      window.removeEventListener('hashchange', scheduleEnsureButton);
      window.removeEventListener('hhr:fichamedico-locationchange', scheduleEnsureButton);
      window.removeEventListener('resize', scheduleEnsureButton);
      window.removeEventListener('focus', scheduleEnsureButton);
      window.removeEventListener('pageshow', scheduleEnsureButton);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      try { chrome.runtime.onMessage?.removeListener?.(onRuntimeMessage); } catch (_error) {}
      connectionCenterRuntime.dispose();
      historyNavigation?.dispose();
      nativePresentation?.dispose();
      worklistPresentation?.dispose();
      modal?.__hhrDocumentPreview?.dispose();
      modal?.__hhrPanel?.dispose();
      [BUTTON_ID, INDICATIONS_BUTTON_ID, OPERATIONS_BAR_ID, MODAL_ID, NOTICE_HOST_ID]
        .forEach(id => document.getElementById(id)?.remove());
      return true;
    },
  };
  scheduleEnsureButton();
  };
  initialize();
})();
