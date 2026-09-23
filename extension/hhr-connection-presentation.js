/** Shared, identity-free connection states for Ficha and Gestión de Camas. */
(function (root) {
  'use strict';
  const readHealth = async load => {
    try { return { report: await load(), transportFailed: false }; }
    catch (_error) { return { report: null, transportFailed: true }; }
  };
  const isTransportFailure = (report, transportFailed) =>
    transportFailed || report?.transportError === true;
  const isUnavailable = report => !report || Boolean(report.error);
  const renderSource = (card, source, fallbackName, actionModel, connectionTimeLabel) => {
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
  const renderPanelUnavailable = ({ extensionCard, fichaCard, camasCard, hhrCard,
    connect, repair, forget, transportFailed }) => {
    [extensionCard, fichaCard, camasCard, hhrCard].forEach((card, index) => {
      card.classList.remove('is-ready', 'is-stale');
      card.classList.add('is-missing');
      card.querySelector('.hhr-connection-status').textContent = index === 0 && transportFailed
        ? 'Sin respuesta' : 'No comprobado';
    });
    [[fichaCard, 'Sesión clínica'], [camasCard, 'Cuenta Rayen'], [hhrCard, 'Enlace con el censo']]
      .forEach(([card, label]) => {
        const user = card.querySelector('.hhr-connection-user');
        user.childNodes[0].nodeValue = label;
        user.querySelector('.hhr-connection-detail').textContent = 'Pendiente de comprobación.';
      });
    extensionCard.querySelector('.hhr-connection-detail').textContent = transportFailed
      ? 'Comprueba la extensión en Chrome y reintenta.' : 'Reintenta la comprobación.';
    connect.hidden = true;
    repair.hidden = true;
    forget.hidden = true;
  };
  const renderBadgeReport = (bar, report, { handoffLabelForIdentity,
    connectionInitials, connectionTimeLabel }) => {
    const part = selector => bar.__hhrRoot?.querySelector(selector);
    const button = part('.hhr-ops-session');
    if (!button) return report;
    const ficha = report.fichaMedico || {};
    const camas = report.gestionCamas || {};
    const identity = ficha.identity || {};
    const name = identity.fullName || 'Sesión HHR';
    const role = String(identity.role || '');
    const handoffButton = part('.hhr-ops-handoff');
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
  const renderBadgeUnavailable = (bar, transportFailed) => {
    const button = bar.__hhrRoot?.querySelector('.hhr-ops-session');
    if (!button) return null;
    button.classList.remove('is-ready', 'is-degraded');
    button.classList.add('is-offline');
    const label = transportFailed ? 'Extensión sin respuesta' : 'Estado no disponible';
    button.querySelector('.session-state').textContent = label;
    button.dataset.tip = label;
    button.dataset.tipNote = 'Comprueba la extensión en Chrome y reintenta.';
    button.setAttribute('aria-label', label + '. ' + button.dataset.tipNote);
    return null;
  };
  const renderIndicatorUnavailable = (host, part) => {
    host.dataset.tone = 'offline';
    part('.summary').textContent = 'Pestaña desactualizada';
    part('.trigger').setAttribute(
      'aria-label', 'Extensión Eloísa: pestaña desactualizada; abre una pestaña nueva'
    );
    part('.version').textContent = 'sin enlace';
    part('.primary').hidden = true;
    part('.feedback').textContent =
      'Esta pestaña perdió el enlace con la extensión. Ábrela nuevamente desde una conexión vigente.';
  };
  root.HhrConnectionPresentation = Object.freeze({
    readHealth, isTransportFailure, isUnavailable, renderSource, renderPanelUnavailable,
    renderBadgeReport, renderBadgeUnavailable, renderIndicatorUnavailable,
  });
})(typeof self !== 'undefined' ? self : globalThis);
