/** Atomic read coordinator for one Rayen census synchronization (classic UMD for MV3). */
(function (root) {
  'use strict';
  const MAX_SOURCE_SKEW_MS = 2 * 60 * 1000;
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const bothSourcesReady = health =>
    health?.fichaMedico?.status === 'ready' && health?.gestionCamas?.status === 'ready';
  const sourceFailureMessage = health => health?.fichaMedico?.status !== 'ready'
    ? health?.fichaMedico?.message || 'Ficha Médico no está conectada.'
    : health?.gestionCamas?.message || 'Gestión de Camas no está conectada.';
  const createMeasuredRead = (timings, clock = () => root.performance.now()) => async (stage, read) => {
    const started = clock();
    try {
      return await read();
    } finally {
      const elapsed = Math.max(0, Math.round(clock() - started));
      if (Number.isSafeInteger(elapsed)) timings[stage] = (timings[stage] || 0) + elapsed;
    }
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
    const calendarDay = root.HhrClinicalDayRuntime?.calendarDayAt(at);
    return nextIsoDay(calendarDay) === dateEnd && dateStart <= calendarDay;
  };
  const hasReaders = (readHealth, readSnapshot, readReport) =>
    [readHealth, readSnapshot, readReport].every(reader => typeof reader === 'function');
  const createBundleResult = ({
    snapshot,
    report,
    startedAt,
    completedAt,
    dateStart,
    dateEnd,
    idFactory,
    captureTimingsMs,
    capturePhasesMs,
    captureRetries,
  }) => {
    const snapshotFacility = Number(snapshot.facilityId);
    const reportFacility = Number(report.facilityId);
    if (!Number.isInteger(snapshotFacility) || snapshotFacility !== reportFacility) {
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
    for (const key of ['fichaContext', 'fichaListsAndCatalog', 'fichaPatientReads', 'fichaDiagnosisCoding']) {
      const duration = capturePhasesMs?.[key];
      if (Number.isSafeInteger(duration) && duration >= 0) captureTimingsMs[key] = duration;
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
        captureTimingsMs,
        captureRetries,
        egresoRows: report.rows,
      },
    };
  };
  const completeCapture = async context => {
    const after = await context.measuredRead('captureHealthAfter', () => context.readHealth({ force: true }));
    if (context.isCancelled()) return { error: 'Sincronización cancelada desde HHR.', cancelled: true };
    if (!bothSourcesReady(after)) return { error: 'Una fuente se desconectó durante la captura. ' + sourceFailureMessage(after) };
    const completed = context.now();
    const temporalError = root.HhrCensusSyncHorizonRuntime?.validateCaptureBoundary(context.started, completed);
    if (temporalError) return { error: temporalError };
    return createBundleResult({ ...context, completedAt: completed.toISOString() });
  };
  const captureInputError = (dateStart, dateEnd, started, readers) => {
    if (!isValidRange(dateStart, dateEnd, started)) return 'El intervalo solicitado para sincronizar no es válido.';
    if (!hasReaders(...readers)) return 'La captura sincronizada no pudo inicializarse.';
    if (!root.HhrCensusSyncHorizonRuntime?.isSupportedTargetDay(dateStart, started)) return 'Selecciona una fecha de censo válida, actual o pasada.';
    return null;
  };
  const capture = async ({
    dateStart,
    dateEnd,
    readHealth,
    readSnapshot,
    readReport,
    now = () => new Date(),
    idFactory = () => crypto.randomUUID(),
    monotonicNow = () => root.performance.now(),
    isCancelled = () => false,
  }) => {
    const started = now(), startedAt = started.toISOString();
    const inputError = captureInputError(dateStart, dateEnd, started, [readHealth, readSnapshot, readReport]);
    if (inputError) return { error: inputError };
    const captureTimingsMs = {};
    const deadline = monotonicNow() + 10_000;
    let captureRetries = 0;
    const withRetries = result => captureRetries && result.error ? { ...result, captureRetries } : result;
    const cancelled = () => ({ error: 'Sincronización cancelada desde HHR.', cancelled: true });
    const measuredRead = createMeasuredRead(captureTimingsMs, monotonicNow);
    try {
      const before = await measuredRead('captureHealthBefore', readHealth);
      if (isCancelled()) return cancelled();
      if (!bothSourcesReady(before)) {
        return { error: sourceFailureMessage(before) };
      }
      const reads = await root.HhrCaptureReadRecovery.read({
        readFicha: () => measuredRead('captureFichaMedico', readSnapshot),
        readGestion: () => measuredRead('captureGestionCamas', () => readReport({ dateStart, dateEnd })),
        readHealth: () => measuredRead('captureHealthBefore', () => readHealth({ force: true })),
        healthError: health => bothSourcesReady(health) ? null : sourceFailureMessage(health),
        isCancelled, withinBudget: () => monotonicNow() < deadline,
      });
      if (reads.error) return reads;
      const { snapshotResult, reportResult } = reads;
      captureRetries = reads.captureRetries;
      const readResult = root.HhrCaptureReadRecovery.validate(snapshotResult, reportResult);
      if (readResult.error) return { ...readResult, ...(captureRetries ? { captureRetries } : {}) };
      return withRetries(await completeCapture({
        ...readResult, started, startedAt, dateStart, dateEnd, idFactory,
        captureTimingsMs, captureRetries, now, measuredRead, readHealth, isCancelled,
      }));
    } catch (error) {
      if (isCancelled()) return cancelled();
      return withRetries({
        error: 'No se pudo capturar ambas fuentes: ' +
          String(error && error.message || error),
      });
    }
  };

  root.HhrRayenSyncBundleRuntime = Object.freeze({
    MAX_SOURCE_SKEW_MS,
    bothSourcesReady,
    capture,
  });
})(typeof self !== 'undefined' ? self : globalThis);
