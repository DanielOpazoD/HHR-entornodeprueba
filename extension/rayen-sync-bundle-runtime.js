/** Atomic read coordinator for one Rayen census synchronization (classic UMD for MV3). */
(function (root) {
  'use strict';
  const MAX_SOURCE_SKEW_MS = 2 * 60 * 1000;
  const MAX_HISTORICAL_LOOKBACK_DAYS =
    root.HhrCensusSyncHorizonRuntime?.MAX_HISTORICAL_LOOKBACK_DAYS;
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
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
  // Include today's calendar morning even while it still belongs to the prior nursing census.
  const isValidRange = (dateStart, dateEnd, at) => {
    const clinicalDay = root.HhrClinicalDayRuntime?.clinicalDayAt(at);
    const calendarDay = root.HhrClinicalDayRuntime?.calendarDayAt(at);
    return nextIsoDay(calendarDay) === dateEnd && dateStart <= clinicalDay;
  };
  const hasReaders = (readHealth, readSnapshot, readReport) =>
    [readHealth, readSnapshot, readReport].every(reader => typeof reader === 'function');
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
    const started = now(), startedAt = started.toISOString();
    if (!isValidRange(dateStart, dateEnd, started)) {
      return { error: 'El intervalo solicitado para sincronizar no es válido.' };
    }
    if (!hasReaders(readHealth, readSnapshot, readReport)) {
      return { error: 'La captura sincronizada no pudo inicializarse.' };
    }

    if (!root.HhrCensusSyncHorizonRuntime?.isSupportedTargetDay(dateStart, started)) {
      return { error: 'La reconstrucción automática admite el censo vigente y hasta siete días clínicos anteriores.' };
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
      const temporalError = root.HhrCensusSyncHorizonRuntime?.validateCaptureBoundary(
        started,
        completed
      );
      if (temporalError) return { error: temporalError };

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
    MAX_HISTORICAL_LOOKBACK_DAYS,
    bothSourcesReady,
    capture,
  });
})(typeof self !== 'undefined' ? self : globalThis);
