/** UI controller for clean connection repair and privacy-safe diagnostic copying. */
(function (root) {
  'use strict';

  const STATUS_LABELS = Object.freeze({
    connected: 'Conectado',
    outdated_tab: 'Pestaña desactualizada',
    relay_disconnected: 'Relé desconectado',
    session_expired: 'Sesión vencida',
    tab_missing: 'Pestaña no abierta',
    session_unverified: 'Requiere comprobación',
  });
  const shortGeneration = value => String(value || '').slice(0, 8) || 'no disponible';
  const statusLabel = source => STATUS_LABELS[source && source.reason] || (
    source && source.status === 'ready'
      ? 'Conectado'
      : source && source.status === 'missing' ? 'Pestaña no abierta' : 'Requiere comprobación'
  );
  const recommendationFor = sources => {
    if (sources.some(source => source && source.reason === 'session_expired')) {
      return 'iniciar sesión nuevamente en Eloísa';
    }
    if (sources.some(source => source && source.reason === 'outdated_tab')) return 'abrir pestañas limpias';
    if (sources.some(source => source && source.reason === 'relay_disconnected')) return 'reparar la conexión de la extensión';
    if (sources.some(source => source && source.reason === 'tab_missing')) return 'abrir las pestañas faltantes';
    if (sources.some(source => source && source.reason === 'session_unverified')) return 'comprobar la sesión en las pestañas nuevas';
    return sources.every(source => source && source.reason === 'connected')
      ? 'ninguna; conexión vigente'
      : 'comprobar nuevamente las conexiones';
  };

  const diagnosticText = report => {
    const sourceLine = (label, source) => {
      const details = [
        statusLabel(source),
        source && source.bridgeVersion ? 'lector ' + source.bridgeVersion : '',
        source && source.bridgeGeneration
          ? 'generación ' + shortGeneration(source.bridgeGeneration)
          : '',
      ].filter(Boolean);
      return label + ': ' + details.join(' · ');
    };
    const sources = [report && report.fichaMedico, report && report.gestionCamas, report && report.hhr];
    const recommendation = recommendationFor(sources);
    return [
      'Extensión: ' + String(report && report.version || 'no disponible') +
        ' · generación ' + shortGeneration(report && report.runtimeGeneration),
      sourceLine('Ficha Médico', report && report.fichaMedico),
      sourceLine('Gestión de Camas', report && report.gestionCamas),
      sourceLine('HHR', report && report.hhr),
      'Acción recomendada: ' + recommendation,
    ].join('\n');
  };

  const create = ({ documentRef, windowRef, runtimeMessages, sendMessage }) => {
    const copyDiagnostic = async report => {
      const value = diagnosticText(report);
      if (windowRef.navigator?.clipboard?.writeText) {
        await windowRef.navigator.clipboard.writeText(value);
        return;
      }
      const area = documentRef.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      documentRef.body.appendChild(area);
      area.select();
      documentRef.execCommand('copy');
      area.remove();
    };

    const attach = ({
      repair,
      copy,
      beginAction,
      isActionCurrent,
      setFeedback,
      load,
      getReport,
      rememberReport,
    }) => {
      repair.addEventListener('click', async () => {
        const action = beginAction();
        repair.disabled = true;
        copy.disabled = true;
        setFeedback('Abriendo pestañas nuevas y comprobando una conexión limpia…');
        try {
          const response = await sendMessage({ type: runtimeMessages.CONNECTION_REPAIR_REQUEST });
          if (!isActionCurrent(action)) return;
          if (response && response.report) rememberReport(response.report);
          if (response && response.ok) {
            setFeedback(response.message || 'La conexión limpia quedó verificada.');
          } else if (response && response.requiresLogin) {
            setFeedback('Inicia sesión en las pestañas nuevas de Eloísa y luego pulsa Actualizar estado.', true);
          } else {
            setFeedback((response && response.message) || 'La conexión todavía no pudo verificarse.', true);
          }
          await load();
        } catch (_error) {
          if (isActionCurrent(action)) setFeedback('No se pudo reparar la conexión.', true);
        } finally {
          repair.disabled = false;
          copy.disabled = false;
        }
      });
      copy.addEventListener('click', async () => {
        const report = getReport();
        if (!report) {
          setFeedback('Primero comprueba el estado de las conexiones.', true);
          return;
        }
        try {
          await copyDiagnostic(report);
          setFeedback('Diagnóstico técnico copiado sin datos clínicos ni credenciales.');
        } catch (_error) {
          setFeedback('No se pudo copiar el diagnóstico.', true);
        }
      });
    };

    return Object.freeze({ attach, shortGeneration });
  };

  root.HhrConnectionRepairControls = Object.freeze({ create, diagnosticText, statusLabel });
})(typeof self !== 'undefined' ? self : globalThis);
