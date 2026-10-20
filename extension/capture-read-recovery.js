/** Read-only recovery for one atomic census capture. No retries of writes or expired reads. */
(function (root) {
  'use strict';
  // Retry only fast network failures, never permissions, malformed evidence or exhausted reads.
  const isTransientRead = result => {
    if (!result?.error || result.snapshot || result.ok === true || result.timeoutStage) return false;
    const detail = String(result.error).split('Detalle:').pop().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/401|403|permission|unauthor|forbidden|sesion|identidad|invalido|cancel|abort|tiempo de espera|timeout/.test(detail)) return false;
    return /failed to fetch|networkerror|load failed|fallo de red|http\s*(502|503|504)\b/.test(detail);
  };
  const readSafely = async read => {
    try { return await read(); }
    catch (error) { return { error: String(error?.message || error) }; }
  };
  const knownTimeoutStage = value => value === 'ficha_main_relay' || value === 'ficha_tab_relay';
  const validateReadResults = (snapshotResult, reportResult) => {
    const snapshot = snapshotResult && snapshotResult.snapshot;
    if (!snapshot) {
      return { error: snapshotResult && snapshotResult.error || 'Ficha Médico no entregó el censo.', ...(knownTimeoutStage(snapshotResult?.timeoutStage) ? { timeoutStage: snapshotResult.timeoutStage } : {}) };
    }
    if (snapshot.isComplete !== true) {
      const coverage = snapshot.clinicalCoverage;
      const detail = coverage && Number(coverage.errors) > 0
        ? ` Fallaron lecturas clínicas de ${coverage.errors} de ${coverage.total} pacientes.`
        : '';
      return {
        error: `Ficha Médico entregó un censo parcial; no se inició la sincronización.${detail}`,
      };
    }
    if (!reportResult || reportResult.ok !== true || !Array.isArray(reportResult.rows)) {
      return {
        error: reportResult && reportResult.error ||
          'Gestión de Camas no entregó el informe de egresos.',
      };
    }
    return { snapshot, report: reportResult, capturePhasesMs: snapshotResult.capturePhasesMs };
  };
  const canRecover = (snapshot, report, retryFicha, retryGestion) =>
    (retryFicha || retryGestion) &&
    (retryFicha || snapshot?.snapshot?.isComplete === true) &&
    (retryGestion || (report?.ok === true && Array.isArray(report.rows)));
  const cancelled = () => ({ error: 'Sincronización cancelada desde HHR.', cancelled: true });
  const read = async ({ readFicha, readGestion, readHealth, healthError, isCancelled, withinBudget }) => {
    let [snapshotResult, reportResult] = await Promise.all([
      readSafely(readFicha), readSafely(readGestion),
    ]);
    const retryFicha = isTransientRead(snapshotResult), retryGestion = isTransientRead(reportResult);
    let captureRetries = 0;
    if (isCancelled()) return cancelled();
    if (canRecover(snapshotResult, reportResult, retryFicha, retryGestion) && withinBudget()) {
      const health = await readHealth();
      if (isCancelled()) return cancelled();
      const error = healthError(health);
      if (error) return { error };
      if (withinBudget()) {
        captureRetries = Number(retryFicha) + Number(retryGestion);
        [snapshotResult, reportResult] = await Promise.all([
          retryFicha ? readSafely(readFicha) : snapshotResult,
          retryGestion ? readSafely(readGestion) : reportResult,
        ]);
      }
    }
    return isCancelled() ? cancelled() : { snapshotResult, reportResult, captureRetries };
  };
  root.HhrCaptureReadRecovery = Object.freeze({ read, validate: validateReadResults });
})(typeof self !== 'undefined' ? self : globalThis);
