/**
 * hhr-connection-center-runtime.js (ISOLATED world)
 *
 * Owns the connection panel and operations-bar badge. Every asynchronous result is bound to the
 * render/request epoch that started it, so responses and polling timers cannot repaint a closed,
 * replaced or disconnected panel.
 */
(() => {
  'use strict';

  if (globalThis.HhrConnectionCenterRuntime) return;

  const create = dependencies => {
    const {
      documentRef,
      windowRef,
      runtimeMessages,
      sendMessage,
      setLiveRegion,
      connectionInitials,
      connectionTimeLabel,
      handoffLabelForIdentity,
      operationsBarId,
    } = dependencies || {};

    if (
      !documentRef ||
      !windowRef ||
      !runtimeMessages ||
      !globalThis.HhrConnectionActionModel ||
      typeof sendMessage !== 'function' ||
      typeof setLiveRegion !== 'function' ||
      typeof connectionInitials !== 'function' ||
      typeof connectionTimeLabel !== 'function' ||
      typeof handoffLabelForIdentity !== 'function' ||
      !operationsBarId
    ) {
      throw new Error('No se pudo inicializar el runtime de conexiones HHR.');
    }
    const actionModel = globalThis.HhrConnectionActionModel;

    const panelControllers = new Map();
    let runtimeDisposed = false;
    let nextEpoch = 0;
    let nextRequestId = 0;
    let badgeEpoch = 0;
    let badgeRequestId = 0;
    let badgeCheckAt = 0;
    let badgeCheck = null;
    let badgeBar = null;

    const barPart = (bar, selector) => {
      const root = bar && bar.__hhrRoot;
      return root ? root.querySelector(selector) : null;
    };

    const repairControls = globalThis.HhrConnectionRepairControls.create({
      documentRef,
      windowRef,
      runtimeMessages,
      sendMessage,
    });

    const clearPanelTimers = controller => {
      controller.timers.forEach(timer => windowRef.clearTimeout(timer));
      controller.timers.clear();
    };

    const invalidateBadge = () => {
      badgeEpoch += 1;
      badgeRequestId += 1;
      badgeCheckAt = 0;
      badgeCheck = null;
      badgeBar = null;
    };

    const disposePanel = (root, { invalidateBadgeCache = true } = {}) => {
      const controller = panelControllers.get(root);
      if (!controller) {
        if (invalidateBadgeCache) invalidateBadge();
        return;
      }
      controller.disposed = true;
      controller.epoch = ++nextEpoch;
      controller.loadRequestId = ++nextRequestId;
      controller.actionRequestId = ++nextRequestId;
      clearPanelTimers(controller);
      panelControllers.delete(root);
      if (root.__hhrConnectionDispose === controller.dispose) {
        delete root.__hhrConnectionDispose;
      }
      if (invalidateBadgeCache) invalidateBadge();
    };

    const resetPanelWork = controller => {
      controller.epoch = ++nextEpoch;
      controller.loadRequestId = ++nextRequestId;
      controller.actionRequestId = ++nextRequestId;
      clearPanelTimers(controller);
      invalidateBadge();
      return controller.epoch;
    };

    const isPanelCurrent = (controller, epoch) =>
      !runtimeDisposed &&
      !controller.disposed &&
      controller.root.isConnected &&
      controller.root.dataset.activeModule === 'connection' &&
      panelControllers.get(controller.root) === controller &&
      controller.epoch === epoch;

    const isPanelRequestCurrent = (controller, epoch, requestKey, requestId) =>
      isPanelCurrent(controller, epoch) && controller[requestKey] === requestId;

    const schedulePanelTimer = (controller, callback, delay) => {
      const epoch = controller.epoch;
      const timer = windowRef.setTimeout(() => {
        controller.timers.delete(timer);
        if (isPanelCurrent(controller, epoch)) callback();
      }, delay);
      controller.timers.add(timer);
      return timer;
    };

    const applyBadgeReport = (bar, report, epoch, requestId) => {
      if (
        runtimeDisposed ||
        epoch !== badgeEpoch ||
        requestId !== badgeRequestId ||
        !report ||
        !bar.isConnected
      ) return report;
      const button = barPart(bar, '.hhr-ops-session');
      if (!button) return report;
      const ficha = report.fichaMedico || {};
      const camas = report.gestionCamas || {};
      const identity = ficha.identity || {};
      const name = identity.fullName || 'Sesión HHR';
      const role = String(identity.role || '');
      const handoffButton = barPart(bar, '.hhr-ops-handoff');
      if (handoffButton) {
        const handoffTitle = handoffLabelForIdentity(role, identity.practitionerRoleId);
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

    const refreshOperationsConnectionBadge = (bar, force = false, knownReport = null) => {
      if (runtimeDisposed || !bar || !barPart(bar, '.hhr-ops-session')) {
        return Promise.resolve(null);
      }
      if (badgeBar !== bar) {
        invalidateBadge();
        badgeBar = bar;
      }
      if (knownReport) {
        badgeEpoch += 1;
        badgeRequestId += 1;
        badgeCheck = null;
        badgeCheckAt = Date.now();
        badgeBar = bar;
        return Promise.resolve(
          applyBadgeReport(bar, knownReport, badgeEpoch, badgeRequestId)
        );
      }
      if (!force && Date.now() - badgeCheckAt < 30 * 1000) return Promise.resolve(null);
      if (badgeCheck) return badgeCheck;

      const epoch = badgeEpoch;
      const requestId = ++badgeRequestId;
      const request = sendMessage({ type: runtimeMessages.EXTENSION_HEALTH_REQUEST })
        .then(report => {
          if (epoch !== badgeEpoch || requestId !== badgeRequestId) return null;
          return applyBadgeReport(bar, report && !report.error ? report : null, epoch, requestId);
        })
        .finally(() => {
          if (epoch !== badgeEpoch || requestId !== badgeRequestId) return;
          badgeCheckAt = Date.now();
          badgeCheck = null;
        });
      badgeCheck = request;
      return request;
    };

    const renderConnectionCenter = (root, _encId) => {
      if (runtimeDisposed || !root) return;
      disposePanel(root, { invalidateBadgeCache: false });
      const main = root.querySelector('.hhr-center-main');
      if (!main) return;
      main.innerHTML = `
        <div class="hhr-center-toolbar">
          <h2 class="hhr-center-heading">Conexiones</h2>
          <button class="hhr-center-action hhr-connection-refresh" type="button">Actualizar estado</button>
        </div>
        <div class="hhr-center-content">
          <div class="hhr-connection-grid">
            <section class="hhr-connection-card hhr-connection-extension">
              <div class="hhr-connection-card-header"><span class="hhr-connection-icon">EXT</span><div><h3>Extensión</h3><span class="hhr-connection-status">Comprobando…</span></div></div>
              <div class="hhr-connection-user">Puente Eloísa → HHR<span class="hhr-connection-detail">Leyendo versión vigente…</span></div>
            </section>
            <section class="hhr-connection-card hhr-connection-ficha">
              <div class="hhr-connection-card-header"><span class="hhr-connection-icon">FM</span><div><h3>Ficha Médico</h3><span class="hhr-connection-status">Comprobando…</span></div></div>
              <div class="hhr-connection-user">Sesión clínica<span class="hhr-connection-detail">Leyendo identidad vigente…</span></div>
            </section>
            <section class="hhr-connection-card hhr-connection-camas">
              <div class="hhr-connection-card-header"><span class="hhr-connection-icon">GC</span><div><h3>Gestión de Camas</h3><span class="hhr-connection-status">Comprobando…</span></div></div>
              <div class="hhr-connection-user">Cuenta Rayen<span class="hhr-connection-detail">Necesaria para egresos, Alta Administrativa e historial CUDYR.</span></div>
              <div class="hhr-connection-actions">
                <button class="hhr-center-action hhr-center-action-primary hhr-connection-connect" type="button" hidden></button>
                <button class="hhr-center-action hhr-connection-forget" type="button" hidden>Olvidar</button>
              </div>
            </section>
            <section class="hhr-connection-card hhr-connection-hhr">
              <div class="hhr-connection-card-header"><span class="hhr-connection-icon">HHR</span><div><h3>Aplicación HHR</h3><span class="hhr-connection-status">Comprobando…</span></div></div>
              <div class="hhr-connection-user">Enlace con el censo<span class="hhr-connection-detail">Comprobando el relé HHR…</span></div>
            </section>
          </div>
          <div class="hhr-connection-tools">
            <button class="hhr-center-action hhr-center-action-primary hhr-connection-repair" type="button" hidden></button>
            <button class="hhr-center-action hhr-connection-copy" type="button">Copiar diagnóstico</button>
          </div>
          <div class="hhr-connection-privacy"><strong>Acceso protegido.</strong> La contraseña se ingresa únicamente en la página oficial de Rayen. La extensión conserva temporalmente el token de acceso durante esta sesión de Chrome y lo elimina al olvidar la conexión, recargar la extensión o cerrar el navegador.</div>
          <div class="hhr-connection-feedback" role="status" aria-live="polite" aria-atomic="true"></div>
        </div>
      `;

      const controller = {
        root,
        epoch: ++nextEpoch,
        loadRequestId: 0,
        actionRequestId: 0,
        timers: new Set(),
        disposed: false,
        shouldRenewSession: false,
        dispose: null,
      };
      controller.dispose = () => disposePanel(root);
      panelControllers.set(root, controller);
      root.__hhrConnectionDispose = controller.dispose;

      const fichaCard = main.querySelector('.hhr-connection-ficha');
      const camasCard = main.querySelector('.hhr-connection-camas');
      const extensionCard = main.querySelector('.hhr-connection-extension');
      const hhrCard = main.querySelector('.hhr-connection-hhr');
      const connect = main.querySelector('.hhr-connection-connect');
      const forget = main.querySelector('.hhr-connection-forget');
      const refresh = main.querySelector('.hhr-connection-refresh');
      const repair = main.querySelector('.hhr-connection-repair');
      const copy = main.querySelector('.hhr-connection-copy');
      const feedback = main.querySelector('.hhr-connection-feedback');
      let latestReport = null;

      const setFeedback = (message, error = false) => {
        feedback.className = 'hhr-connection-feedback' + (error ? ' is-error' : '');
        setLiveRegion(feedback, message, error ? 'error' : '');
      };

      const renderSource = (card, source, fallbackName) => {
        const ready = source && source.status === 'ready';
        const stale = source && source.status === 'stale';
        card.className = card.className.replace(/\s+is-(?:ready|stale|missing)/g, '') +
          (ready ? ' is-ready' : stale ? ' is-stale' : ' is-missing');
        card.querySelector('.hhr-connection-status').textContent = actionModel.sourceLabel(source);
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
        const epoch = controller.epoch;
        const requestId = ++nextRequestId;
        controller.loadRequestId = requestId;
        if (!isPanelRequestCurrent(controller, epoch, 'loadRequestId', requestId)) return null;
        refresh.disabled = true;
        const report = await sendMessage({ type: runtimeMessages.EXTENSION_HEALTH_REQUEST });
        if (!isPanelRequestCurrent(controller, epoch, 'loadRequestId', requestId)) return null;
        refresh.disabled = false;
        if (!report || report.error) {
          setFeedback((report && report.error) || 'No se pudo comprobar la conexión.', true);
          return null;
        }
        const ficha = report.fichaMedico || {};
        const camas = report.gestionCamas || {};
        const hhr = report.hhr || {};
        latestReport = report;
        renderSource(extensionCard, {
          status: 'ready',
          reason: 'connected',
          message: 'Generación ' + repairControls.shortGeneration(report.runtimeGeneration),
        }, 'Versión ' + String(report.version || 'desconocida'));
        extensionCard.querySelector('.hhr-connection-detail').textContent =
          'Generación ' + repairControls.shortGeneration(report.runtimeGeneration);
        const fichaName = ficha.identity && ficha.identity.fullName || 'Sesión de Ficha Médico';
        renderSource(fichaCard, ficha, fichaName);
        renderSource(camasCard, camas, 'Cuenta autenticada en Gestión de Camas');
        renderSource(hhrCard, hhr, 'Enlace HHR');
        hhrCard.querySelector('.hhr-connection-detail').textContent =
          String(hhr.message || 'La pestaña HHR no está disponible.');
        const nextAction = actionModel.derive(report);
        controller.shouldRenewSession = nextAction.renewGestionCamas === true;
        connect.hidden = nextAction.action !== 'connect-gc';
        connect.textContent = nextAction.actionLabel;
        repair.hidden = nextAction.action !== 'repair';
        repair.textContent = nextAction.actionLabel;
        forget.hidden = camas.status !== 'ready' && camas.status !== 'stale';
        const bar = documentRef.getElementById(operationsBarId);
        void refreshOperationsConnectionBadge(bar, true, report);
        return report;
      };

      const pollUntilConnected = epoch => {
        let attempts = 0;
        const poll = async () => {
          if (!isPanelCurrent(controller, epoch)) return;
          const report = await load();
          if (!isPanelCurrent(controller, epoch)) return;
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
          schedulePanelTimer(controller, poll, 1000);
        };
        schedulePanelTimer(controller, poll, 700);
      };

      refresh.addEventListener('click', () => { void load(); });
      repairControls.attach({
        repair,
        copy,
        beginAction: () => {
          const epoch = resetPanelWork(controller);
          const requestId = ++nextRequestId;
          controller.actionRequestId = requestId;
          return { epoch, requestId };
        },
        isActionCurrent: ({ epoch, requestId }) =>
          isPanelRequestCurrent(controller, epoch, 'actionRequestId', requestId),
        setFeedback,
        load,
        getReport: () => latestReport,
        rememberReport: report => { latestReport = report; },
      });
      connect.addEventListener('click', async () => {
        const epoch = resetPanelWork(controller);
        refresh.disabled = false;
        const requestId = ++nextRequestId;
        controller.actionRequestId = requestId;
        if (!isPanelRequestCurrent(controller, epoch, 'actionRequestId', requestId)) return;
        connect.disabled = true;
        forget.disabled = true;
        setFeedback('Abriendo la página oficial de Gestión de Camas…');
        const response = await sendMessage({
          type: runtimeMessages.GC_CONNECT_REQUEST,
          renew: controller.shouldRenewSession,
        });
        if (!isPanelRequestCurrent(controller, epoch, 'actionRequestId', requestId)) return;
        if (!response || response.error) {
          connect.disabled = false;
          forget.disabled = false;
          setFeedback((response && response.error) || 'No se pudo abrir Gestión de Camas.', true);
          return;
        }
        forget.disabled = false;
        setFeedback(response.message || 'Completa el acceso en la ventana oficial de Rayen.');
        pollUntilConnected(epoch);
      });
      forget.addEventListener('click', async () => {
        const epoch = resetPanelWork(controller);
        refresh.disabled = false;
        const requestId = ++nextRequestId;
        controller.actionRequestId = requestId;
        if (!isPanelRequestCurrent(controller, epoch, 'actionRequestId', requestId)) return;
        forget.disabled = true;
        connect.disabled = true;
        const response = await sendMessage({ type: runtimeMessages.GC_DISCONNECT_REQUEST });
        if (!isPanelRequestCurrent(controller, epoch, 'actionRequestId', requestId)) return;
        forget.disabled = false;
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

    const dispose = () => {
      if (runtimeDisposed) return;
      runtimeDisposed = true;
      Array.from(panelControllers.keys()).forEach(root => disposePanel(root));
      invalidateBadge();
    };

    return Object.freeze({
      renderConnectionCenter,
      refreshOperationsConnectionBadge,
      invalidateConnectionState: root => disposePanel(root),
      dispose,
    });
  };

  globalThis.HhrConnectionCenterRuntime = Object.freeze({ create });
})();
