/** Pure presentation model shared by the extension connection surfaces. */
(function (root) {
  'use strict';

  if (root.HhrConnectionActionModel) return;

  const REPAIR_CAPABILITY = 'clean-connection-repair';
  const STATUS_LABELS = Object.freeze({
    connected: 'Conectado',
    outdated_tab: 'Pestaña desactualizada',
    relay_disconnected: 'Relé desconectado',
    session_expired: 'Sesión vencida',
    session_unverified: 'Requiere comprobación',
    tab_missing: 'Pestaña no abierta',
  });
  const ready = source => Boolean(source && source.status === 'ready');
  const reasonIs = (source, values) => Boolean(source && values.includes(source.reason));
  const sourceLabel = source => STATUS_LABELS[source && source.reason] || (
    ready(source) ? 'Conectado' : source && source.status === 'missing'
      ? 'Pestaña no abierta' : 'Requiere comprobación'
  );

  const isExpiring = source => {
    const remaining = source && source.remainingSeconds;
    return Boolean(source && (
      source.expiring === true ||
      (Number.isFinite(remaining) && remaining >= 0 && remaining < 240)
    ));
  };

  const connectedModel = (ficha, camas, hhr, supportsRepair) => {
    if (isExpiring(ficha) && supportsRepair) {
      return {
        tone: 'degraded',
        summary: 'Ficha Médico por vencer',
        action: 'repair',
        actionLabel: 'Abrir conexión limpia',
      };
    }
    if (isExpiring(camas)) {
      return {
        tone: 'degraded',
        summary: 'Renovar Gestión de Camas',
        action: 'connect-gc',
        actionLabel: 'Renovar Gestión de Camas',
        renewGestionCamas: true,
      };
    }
    return {
      tone: ready(hhr) ? 'ready' : 'degraded',
      summary: ready(hhr) ? 'Conectado' : 'HHR sin enlace',
      action: 'none',
      actionLabel: '',
    };
  };

  const targetedCamasModel = camas => {
    const expired = camas.reason === 'session_expired';
    const renewGestionCamas = expired || camas.connectionSource === 'session';
    return {
      tone: 'degraded',
      summary: expired ? 'Sesión de Camas vencida' : 'Conexión parcial',
      action: 'connect-gc',
      actionLabel: expired
        ? 'Iniciar sesión en Gestión de Camas'
        : renewGestionCamas ? 'Renovar Gestión de Camas' : 'Abrir Gestión de Camas',
      renewGestionCamas,
    };
  };

  const repairModel = (ficha, camas) => {
    const sources = [ficha, camas];
    if (sources.some(source => reasonIs(source, ['session_expired']))) {
      return {
        tone: 'offline',
        summary: 'Sesión vencida',
        action: 'repair',
        actionLabel: 'Iniciar sesión en pestañas nuevas',
      };
    }
    if (sources.some(source => reasonIs(source, ['outdated_tab']))) {
      return {
        tone: 'degraded',
        summary: 'Pestaña desactualizada',
        action: 'repair',
        actionLabel: 'Abrir conexión limpia',
      };
    }
    if (sources.some(source => reasonIs(source, ['relay_disconnected']))) {
      return {
        tone: 'offline',
        summary: 'Relé desconectado',
        action: 'repair',
        actionLabel: 'Restablecer enlaces',
      };
    }
    return {
      tone: 'degraded',
      summary: 'Faltan pestañas',
      action: 'repair',
      actionLabel: 'Abrir pestañas necesarias',
    };
  };

  const derive = report => {
    if (!report) {
      return {
        tone: 'checking',
        summary: 'Comprobando…',
        action: 'refresh',
        actionLabel: 'Reintentar comprobación',
      };
    }

    const ficha = report.fichaMedico || {};
    const camas = report.gestionCamas || {};
    const hhr = report.hhr || {};
    const fichaReady = ready(ficha);
    const camasReady = ready(camas);
    const supportsRepair = Array.isArray(report.capabilities) &&
      report.capabilities.includes(REPAIR_CAPABILITY);

    if (fichaReady && camasReady) {
      return connectedModel(ficha, camas, hhr, supportsRepair);
    }

    if (fichaReady && isExpiring(ficha) && supportsRepair) {
      return connectedModel(ficha, camas, hhr, supportsRepair);
    }

    // La reparación global no debe duplicar Ficha Médico cuando la única
    // fuente ausente es la cuenta temporal de Gestión de Camas.
    if (
      fichaReady &&
      !camasReady &&
      !reasonIs(camas, ['outdated_tab', 'relay_disconnected'])
    ) {
      return targetedCamasModel(camas);
    }

    if (supportsRepair) return repairModel(ficha, camas);

    return {
      tone: 'offline',
      summary: 'Requiere comprobación',
      action: 'refresh',
      actionLabel: 'Reintentar comprobación',
    };
  };

  root.HhrConnectionActionModel = Object.freeze({ derive, sourceLabel, REPAIR_CAPABILITY });
})(typeof self !== 'undefined' ? self : globalThis);
