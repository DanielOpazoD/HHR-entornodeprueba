/** Atomic read coordinator for one Rayen census synchronization (classic UMD for MV3). */
(function (root) {
  'use strict';

  const MAX_SOURCE_SKEW_MS = 2 * 60 * 1000;
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const RAPA_NUI_TIME_ZONE = 'Pacific/Easter';
  const bothSourcesReady = health => Boolean(
    health &&
      health.fichaMedico && health.fichaMedico.status === 'ready' &&
      health.gestionCamas && health.gestionCamas.status === 'ready'
  );

  const sourceFailureMessage = health => {
    if (!health || !health.fichaMedico || health.fichaMedico.status !== 'ready') {
      return health && health.fichaMedico && health.fichaMedico.message ||
        'Ficha Médico no está conectada.';
    }
    return health.gestionCamas && health.gestionCamas.message ||
      'Gestión de Camas no está conectada.';
  };

  const timestamp = value => {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const nextIsoDay = value => {
    if (!ISO_DAY.test(String(value || ''))) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.toISOString().slice(0, 10) !== value) return null;
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  };
  // Gestión de Camas needs the exact [D, D+1] range to compensate its report-day offset.
  const isValidRange = (dateStart, dateEnd) => nextIsoDay(dateStart) === dateEnd;
  const hasReaders = (readHealth, readSnapshot, readReport) =>
    [readHealth, readSnapshot, readReport].every(reader => typeof reader === 'function');
  const rapaNuiIsoDay = date => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: RAPA_NUI_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const validateReadResults = (snapshotResult, reportResult) => {
    const snapshot = snapshotResult && snapshotResult.snapshot;
    if (!snapshot) {
      return { error: snapshotResult && snapshotResult.error || 'Ficha Médico no entregó el censo.' };
    }
    if (snapshot.isComplete !== true) {
      return { error: 'Ficha Médico entregó un censo parcial; no se inició la sincronización.' };
    }
    if (!reportResult || reportResult.ok !== true || !Array.isArray(reportResult.rows)) {
      return {
        error: reportResult && reportResult.error ||
          'Gestión de Camas no entregó el informe de egresos.',
      };
    }
    return { snapshot, report: reportResult };
  };

  const createBundleResult = ({
    snapshot,
    report,
    startedAt,
    completedAt,
    dateStart,
    dateEnd,
    idFactory,
  }) => {
    const snapshotFacility = Number(snapshot.facilityId);
    const reportFacility = Number(report.facilityId);
    if (
      !Number.isInteger(snapshotFacility) ||
      !Number.isInteger(reportFacility) ||
      snapshotFacility !== reportFacility
    ) {
      return { error: 'Ficha Médico y Gestión de Camas no corresponden al mismo establecimiento.' };
    }
    const fichaCapturedAt = timestamp(snapshot.capturedAt);
    const gestionCapturedAt = timestamp(report.capturedAt);
    if (fichaCapturedAt === null || gestionCapturedAt === null) {
      return { error: 'Las fuentes no entregaron marcas temporales verificables.' };
    }
    const sourceSkewMs = Math.abs(fichaCapturedAt - gestionCapturedAt);
    if (sourceSkewMs > MAX_SOURCE_SKEW_MS) {
      return { error: 'Las fuentes fueron capturadas con demasiado desfase; vuelve a sincronizar.' };
    }
    return {
      ok: true,
      snapshot,
      bundle: {
        id: idFactory(),
        startedAt,
        completedAt,
        facilityId: snapshotFacility,
        dateStart,
        dateEnd,
        fichaMedicoCapturedAt: snapshot.capturedAt,
        gestionCamasCapturedAt: report.capturedAt,
        sourceSkewMs,
        egresoRows: report.rows,
      },
    };
  };

  const capture = async ({
    dateStart,
    dateEnd,
    readHealth,
    readSnapshot,
    readReport,
    now = () => new Date(),
    idFactory = () => crypto.randomUUID(),
  }) => {
    if (!isValidRange(dateStart, dateEnd)) {
      return { error: 'El intervalo solicitado para sincronizar no es válido.' };
    }
    if (!hasReaders(readHealth, readSnapshot, readReport)) {
      return { error: 'La captura sincronizada no pudo inicializarse.' };
    }

    const started = now();
    const startedAt = started.toISOString();
    if (dateStart !== rapaNuiIsoDay(started)) {
      return {
        error: 'Ficha Médico solo permite sincronizar el censo del día en curso.',
      };
    }
    try {
      const before = await readHealth();
      if (!bothSourcesReady(before)) {
        return { error: sourceFailureMessage(before) };
      }

      const [snapshotResult, reportResult] = await Promise.all([
        readSnapshot(),
        readReport({ dateStart, dateEnd }),
      ]);
      const readResult = validateReadResults(snapshotResult, reportResult);
      if (readResult.error) return readResult;

      const after = await readHealth();
      if (!bothSourcesReady(after)) {
        return {
          error: 'Una fuente se desconectó durante la captura. ' + sourceFailureMessage(after),
        };
      }
      const completed = now();
      if (dateStart !== rapaNuiIsoDay(completed)) {
        return {
          error: 'El día cambió durante la captura. Vuelve a sincronizar el censo vigente.',
        };
      }

      return createBundleResult({
        ...readResult,
        startedAt,
        completedAt: completed.toISOString(),
        dateStart,
        dateEnd,
        idFactory,
      });
    } catch (error) {
      return {
        error: 'No se pudo capturar ambas fuentes: ' +
          String(error && error.message || error),
      };
    }
  };

  root.HhrRayenSyncBundleRuntime = Object.freeze({
    MAX_SOURCE_SKEW_MS,
    bothSourcesReady,
    capture,
  });
})(typeof self !== 'undefined' ? self : globalThis);
