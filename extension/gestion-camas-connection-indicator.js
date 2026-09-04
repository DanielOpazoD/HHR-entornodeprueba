/** Compact, connection-only HHR surface for Gestión de Camas. */
(function (root) {
  'use strict';

  if (root.HhrGestionCamasConnectionIndicator) return;

  const HOST_ID = 'hhr-gc-connection-indicator';
  const HEALTH_PUSH_TYPE = 'RAYEN_EXTENSION_HEALTH_PUSH';

  const create = ({
    documentRef,
    windowRef,
    chromeApi,
    runtimeMessages,
    actionModel,
    isUserActivationAllowed,
  }) => {
    if (!documentRef || !windowRef || !chromeApi || !runtimeMessages || !actionModel) {
      throw new Error('No se pudo inicializar el indicador HHR de Gestión de Camas.');
    }

    let disposed = false;
    let host = null;
    let shadow = null;
    let latestReport = null;
    let requestEpoch = 0;
    let actionInFlight = false;
    let refreshInFlight = 0;
    const allowsUserAction = event => typeof isUserActivationAllowed === 'function'
      ? isUserActivationAllowed(event)
      : Boolean(event?.isTrusted && windowRef.navigator?.userActivation?.isActive);

    const sendMessage = message => Promise.resolve(chromeApi.runtime.sendMessage(message));
    const part = selector => shadow && shadow.querySelector(selector);
    const updateActionDisabled = () => {
      const action = part('.primary');
      if (action) action.disabled = actionInFlight || refreshInFlight > 0;
    };

    const css = `
      :host{--navy:#102a43;--teal:#0f938c;--teal-soft:#eefaf8;--green:#1ea86d;--amber:#d8a72e;--red:#c94c43;--line:#d7e1df;--muted:#68797a;position:fixed;top:72px;right:18px;z-index:2147483000;font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:var(--navy)}
      *,*::before,*::after{box-sizing:border-box}button{font:inherit}button:focus-visible{outline:3px solid rgba(15,147,140,.3);outline-offset:2px}
      .trigger{display:flex;align-items:center;gap:7px;min-height:38px;padding:5px 10px 5px 6px;border:1px solid rgba(16,42,67,.14);border-radius:999px;background:#fff;box-shadow:0 2px 8px rgba(16,42,67,.11),0 10px 26px rgba(16,42,67,.12);color:var(--navy);cursor:pointer}
      .brand{position:relative;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--teal-soft)}.brand img{width:23px;height:19px;object-fit:contain}.dot{position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border:2px solid #fff;border-radius:50%;background:var(--amber)}
      :host([data-tone="ready"]) .dot{background:var(--green)}:host([data-tone="offline"]) .dot{background:var(--red)}:host([data-tone="checking"]) .dot{background:var(--teal);animation:pulse 1.2s ease-in-out infinite}
      .copy{display:grid;gap:1px;text-align:left}.copy strong{font-size:11.5px}.summary{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:10px;font-weight:600}
      .panel{position:absolute;top:calc(100% + 8px);right:0;width:310px;padding:13px;border:1px solid rgba(16,42,67,.14);border-radius:13px;background:#fff;box-shadow:0 16px 38px rgba(7,27,49,.22)}.panel[hidden]{display:none}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:11px}.head strong{font-size:12px}.version{color:#8a9896;font-size:9.5px;font-weight:650}.sources{display:grid;gap:9px}.source{display:grid;grid-template-columns:8px 1fr;gap:7px}.source-dot{width:7px;height:7px;margin-top:4px;border-radius:50%;background:#b7c0be}.source[data-status="ready"] .source-dot{background:var(--green)}.source[data-status="stale"] .source-dot{background:var(--amber)}.source strong{display:block;font-size:10.5px}.source span{display:block;margin-top:1px;color:var(--muted);font-size:10px;line-height:1.35}
      .feedback{min-height:0;margin-top:9px;color:#8a6714;font-size:10px;line-height:1.35}.feedback:empty{display:none}.actions{display:flex;justify-content:flex-end;margin-top:10px}.primary{min-height:30px;padding:5px 10px;border:0;border-radius:8px;background:#007c83;color:#fff;font-size:10.5px;font-weight:700;cursor:pointer}.primary[hidden]{display:none}.primary:disabled{cursor:progress;opacity:.58}
      @keyframes pulse{50%{opacity:.38}}@media(max-width:680px){:host{top:auto;right:12px;bottom:42px}.copy{display:none}.trigger{padding-right:6px}.panel{position:fixed;right:12px;bottom:88px;top:auto;width:min(310px,calc(100vw - 24px))}}@media(prefers-reduced-motion:reduce){.dot{animation:none!important}}@media(forced-colors:active){.trigger,.panel{border:1px solid CanvasText;background:Canvas}.dot,.source-dot{forced-color-adjust:none}}
    `;

    const rowMarkup = (key, label) => `
      <div class="source source-${key}" data-status="missing">
        <span class="source-dot" aria-hidden="true"></span>
        <div><strong>${label}</strong><span>Comprobando…</span></div>
      </div>`;

    const renderSource = (key, source) => {
      const row = part('.source-' + key);
      if (!row) return;
      row.dataset.status = source && source.status || 'missing';
      row.querySelector('span:last-child').textContent = actionModel.sourceLabel(source);
    };

    const renderReport = report => {
      latestReport = report;
      const model = actionModel.derive(report);
      host.dataset.tone = model.tone;
      part('.summary').textContent = model.summary;
      part('.trigger').setAttribute('aria-label', 'Extensión HHR: ' + model.summary);
      part('.version').textContent = report && report.version ? 'v' + report.version : 'sin reporte';
      renderSource('ficha', report && report.fichaMedico);
      renderSource('camas', report && report.gestionCamas);
      renderSource('hhr', report && report.hhr);
      const action = part('.primary');
      action.hidden = model.action === 'none';
      action.textContent = model.actionLabel || '';
    };

    const renderUnavailable = () => {
      latestReport = null;
      host.dataset.tone = 'offline';
      part('.summary').textContent = 'Pestaña desactualizada';
      part('.trigger').setAttribute(
        'aria-label',
        'Extensión HHR: pestaña desactualizada; abre una pestaña nueva'
      );
      part('.version').textContent = 'sin enlace';
      part('.primary').hidden = true;
      part('.feedback').textContent =
        'Esta pestaña perdió el enlace con la extensión. Ábrela nuevamente desde una conexión vigente.';
    };

    const refresh = async () => {
      const epoch = ++requestEpoch;
      refreshInFlight += 1;
      updateActionDisabled();
      if (!latestReport) renderReport(null);
      try {
        const report = await sendMessage({ type: runtimeMessages.EXTENSION_HEALTH_REQUEST });
        if (disposed || epoch !== requestEpoch) return null;
        if (!report || report.error) throw new Error(report && report.error || 'Sin reporte');
        part('.feedback').textContent = '';
        renderReport(report);
        return report;
      } catch (_error) {
        if (!disposed && epoch === requestEpoch) renderUnavailable();
        return null;
      } finally {
        refreshInFlight -= 1;
        updateActionDisabled();
      }
    };

    const responseFeedback = response => {
      if (response && response.requiresLogin) {
        return 'Completa el inicio de sesión en las pestañas nuevas y vuelve a esta vista.';
      }
      if (response && (response.error || response.ok === false)) {
        return response.error || response.message || 'La conexión todavía no pudo verificarse.';
      }
      return response && response.message ||
        'La acción se inició; el estado se actualizará automáticamente.';
    };

    const actionRequest = model => model.action === 'repair'
      ? { type: runtimeMessages.CONNECTION_REPAIR_REQUEST }
      : {
        type: runtimeMessages.GC_CONNECT_REQUEST,
        renew: model.renewGestionCamas === true,
      };

    const runPrimaryAction = async event => {
      if (actionInFlight || refreshInFlight > 0) return;
      const button = part('.primary');
      const model = actionModel.derive(latestReport);
      const kind = model.action;
      if (!kind || kind === 'none') return;
      if (!allowsUserAction(event)) {
        part('.feedback').textContent = 'Esta acción requiere un clic directo del usuario.';
        return;
      }
      if (kind === 'refresh') {
        await refresh();
        return;
      }
      actionInFlight = true;
      updateActionDisabled();
      part('.feedback').textContent = kind === 'repair'
        ? 'Abriendo pestañas nuevas y verificando la conexión…'
        : 'Abriendo Gestión de Camas…';
      try {
        const response = await sendMessage(actionRequest(model));
        const feedback = responseFeedback(response);
        const refreshEpoch = requestEpoch + 1;
        const refreshedReport = await refresh();
        if (
          !disposed &&
          refreshedReport &&
          requestEpoch === refreshEpoch &&
          actionModel.derive(refreshedReport).action !== 'none' &&
          feedback
        ) {
          part('.feedback').textContent = feedback;
        }
      } catch (_error) {
        renderUnavailable();
      } finally {
        actionInFlight = false;
        if (button.isConnected) updateActionDisabled();
      }
    };

    const close = () => {
      const panel = part('.panel');
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      part('.trigger').setAttribute('aria-expanded', 'false');
    };
    const toggle = () => {
      const panel = part('.panel');
      panel.hidden = !panel.hidden;
      part('.trigger').setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) void refresh();
    };
    const onDocumentPointerDown = event => {
      if (host && !event.composedPath().includes(host)) close();
    };
    const onDocumentKeyDown = event => {
      if (event.key === 'Escape') close();
    };
    const onVisibility = () => {
      if (!documentRef.hidden) void refresh();
    };
    const onRuntimeMessage = message => {
      if (message && message.type === HEALTH_PUSH_TYPE && message.report) {
        requestEpoch += 1;
        renderReport(message.report);
        if (actionModel.derive(message.report).action === 'none') {
          part('.feedback').textContent = '';
        }
      }
    };

    const install = () => {
      if (disposed || !documentRef.body) return false;
      const existing = documentRef.getElementById(HOST_ID);
      if (existing) {
        if (typeof existing.__hhrDispose === 'function') existing.__hhrDispose();
        else existing.remove();
      }
      host = documentRef.createElement('aside');
      host.id = HOST_ID;
      host.dataset.tone = 'checking';
      host.setAttribute('aria-label', 'Estado de conexión de la extensión HHR');
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>${css}</style>
        <button class="trigger" type="button" aria-expanded="false" aria-controls="hhr-gc-connection-panel">
          <span class="brand" aria-hidden="true"><img alt=""><span class="dot"></span></span>
          <span class="copy"><strong>HHR</strong><span class="summary">Comprobando…</span></span>
        </button>
        <section class="panel" id="hhr-gc-connection-panel" aria-label="Conexiones Eloísa" hidden>
          <div class="head"><strong>Conexiones Eloísa</strong><span class="version">sin reporte</span></div>
          <div class="sources">
            ${rowMarkup('ficha', 'Ficha Médico')}
            ${rowMarkup('camas', 'Gestión de Camas')}
            ${rowMarkup('hhr', 'Aplicación HHR')}
          </div>
          <p class="feedback" role="status" aria-live="polite"></p>
          <div class="actions"><button class="primary" type="button" hidden></button></div>
        </section>`;
      try {
        part('.brand img').src = chromeApi.runtime.getURL('hhr-logo.svg');
      } catch (_error) {
        part('.brand img').remove();
      }
      part('.trigger').addEventListener('click', toggle);
      part('.primary').addEventListener('click', event => void runPrimaryAction(event));
      documentRef.addEventListener('pointerdown', onDocumentPointerDown);
      documentRef.addEventListener('keydown', onDocumentKeyDown);
      documentRef.addEventListener('visibilitychange', onVisibility);
      windowRef.addEventListener('focus', refresh);
      windowRef.addEventListener('online', refresh);
      chromeApi.runtime.onMessage?.addListener(onRuntimeMessage);
      host.__hhrDispose = dispose;
      documentRef.body.appendChild(host);
      void refresh();
      return true;
    };

    function dispose() {
      if (disposed) return;
      disposed = true;
      requestEpoch += 1;
      documentRef.removeEventListener('pointerdown', onDocumentPointerDown);
      documentRef.removeEventListener('keydown', onDocumentKeyDown);
      documentRef.removeEventListener('visibilitychange', onVisibility);
      windowRef.removeEventListener('focus', refresh);
      windowRef.removeEventListener('online', refresh);
      chromeApi.runtime.onMessage?.removeListener?.(onRuntimeMessage);
      if (host && host.isConnected) host.remove();
    }

    const mount = () => {
      if (documentRef.body) return install();
      documentRef.addEventListener('DOMContentLoaded', install, { once: true });
      return false;
    };

    return Object.freeze({ mount, refresh, dispose });
  };

  root.HhrGestionCamasConnectionIndicator = Object.freeze({ create, HOST_ID });
})(typeof self !== 'undefined' ? self : globalThis);
