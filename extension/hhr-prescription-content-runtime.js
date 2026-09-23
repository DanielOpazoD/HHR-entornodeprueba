/** Bounded extension-message transport for the Ficha content interface. */
(function (root) {
  'use strict';
  const createSendMessage = ({ runtimeMessages, chromeApi, windowRef }) => {
    const retryableTypes = new Set([
      runtimeMessages.PRESCRIPTION_OPTIONS_REQUEST,
      runtimeMessages.HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST,
      runtimeMessages.SCALES_REPORT_REQUEST,
      runtimeMessages.PATIENT_HEADER_REQUEST,
      runtimeMessages.CENSUS_LIST_REQUEST,
      runtimeMessages.VITALS_CENSUS_REQUEST,
    ]);
    const isTransient = value =>
      /message channel closed|receiving end does not exist|asynchronous response|extension context invalidated/i
        .test(String(value || ''));
    const friendlyMessage = (error, isClinicalWrite) => {
      const raw = String((error && error.message) || error || 'La extensión no respondió.');
      if (!isTransient(raw)) return raw;
      return isClinicalWrite
        ? 'Se perdió la conexión con la extensión durante el guardado. Verifica el dato visible antes de reintentar.'
        : 'Se perdió temporalmente la conexión mientras se preparaban los datos. Reintenta; no se imprimió ni modificó información.';
    };
    return message => new Promise(resolve => {
      const isClinicalWrite = message && (
        message.type === runtimeMessages.HANDOFF_SAVE_REQUEST ||
        message.type === runtimeMessages.SCORE_SAVE_REQUEST
      );
      const transportFailure = error => ({
        error: friendlyMessage(error, isClinicalWrite),
        transportError: true,
        ...(isClinicalWrite ? { writeMayHaveSucceeded: true } : {}),
      });
      const mayRetry = retryableTypes.has(String(message && message.type || ''));
      const attempt = retryCount => {
        try {
          chromeApi.runtime.sendMessage(message, response => {
            const error = chromeApi.runtime.lastError;
            const rawError = String(error && error.message || error || '');
            if (error && mayRetry && retryCount < 1 && isTransient(rawError)) {
              windowRef.setTimeout(() => attempt(retryCount + 1), 180);
              return;
            }
            resolve(error ? transportFailure(error) : response || transportFailure('La extensión no respondió.'));
          });
        } catch (error) {
          if (mayRetry && retryCount < 1 && isTransient(error && error.message)) {
            windowRef.setTimeout(() => attempt(retryCount + 1), 180);
            return;
          }
          resolve(transportFailure(error));
        }
      };
      attempt(0);
    });
  };
  root.HhrPrescriptionContentRuntime = Object.freeze({ createSendMessage });
})(typeof self !== 'undefined' ? self : globalThis);
