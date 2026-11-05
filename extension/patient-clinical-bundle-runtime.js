/**
 * One patient's clinical reads (devices + scales history + forms + chart alerts) resolved in a
 * single runtime message (capability "patient-clinical-bundle"): fewer MV3 round-trips and ONE
 * timeout window. Each section degrades independently ({error}) so HHR keeps its
 * per-source coverage classification. Classic UMD for the MV3 service worker.
 */
(function (root) {
  'use strict';

  const create = ({ readDevices, readHistory, readForms, readAlerts, readFluidBalance }) => {
    if ([readDevices, readHistory, readForms, readAlerts].some(read => typeof read !== 'function')) {
      throw new Error('Falta un lector clínico para el paquete por paciente.');
    }
    const section = async read => {
      try {
        const result = await read();
        return result || { error: 'La extensión no entregó datos para esta fuente.' };
      } catch (error) {
        return { error: String((error && error.message) || error) };
      }
    };
    return async ({ encId, fecha, censusDate, lookbackDays, acceptEntries, sender }) => {
      const [devices, history, forms, alerts, fluidBalance] = await Promise.all([
        section(() => readDevices({ encId, fecha, acceptEntries: acceptEntries === true })),
        section(() => readHistory({ encId, censusDate, lookbackDays })),
        section(() => readForms({ encId, sender })),
        section(() => readAlerts({ encId, fecha, sender })),
        readFluidBalance ? section(() => readFluidBalance({ encId, fecha, sender })) : undefined,
      ]);
      return { ok: true, devices, history, forms, alerts, ...(fluidBalance ? { fluidBalance } : {}) };
    };
  };

  root.HhrPatientClinicalBundleRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
