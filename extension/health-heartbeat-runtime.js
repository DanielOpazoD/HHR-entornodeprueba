/**
 * health-heartbeat-runtime.js
 *
 * Empuja el reporte de salud de la extensión a las pestañas HHR abiertas sin
 * esperar a que la página pregunte (hoy solo consulta al montar, al enfocar o
 * al hacer clic). Dos disparadores:
 *   - un latido periódico con chrome.alarms (despierta al service worker MV3,
 *     que de otro modo duerme a los ~30 s), y
 *   - pushNow(reason) inmediato tras las transiciones de sesión de Gestión de
 *     Camas (captura, pestaña lista, desconexión).
 * El reporte es el mismo del canal request/response (sin datos clínicos ni
 * tokens); una pestaña sin content script simplemente ignora el envío.
 */
(function (root) {
  'use strict';

  const HEALTH_PUSH_MESSAGE_TYPE = 'RAYEN_EXTENSION_HEALTH_PUSH';

  const create = ({
    chromeApi,
    readHealth,
    hhrMatchPatterns,
    alarmName = 'hhr-health-heartbeat',
    periodMinutes = 1,
    log = (...args) => console.warn(...args),
  }) => {
    const pushNow = async reason => {
      let report;
      try {
        report = await readHealth();
      } catch (error) {
        log('[HHR] El latido no pudo leer el estado de la extensión:', error);
        return { pushed: 0 };
      }
      let tabs = [];
      try {
        tabs = await chromeApi.tabs.query({ url: hhrMatchPatterns });
      } catch (error) {
        log('[HHR] El latido no pudo enumerar pestañas HHR:', error);
        return { pushed: 0 };
      }
      let pushed = 0;
      await Promise.all(
        tabs.map(async tab => {
          try {
            await chromeApi.tabs.sendMessage(tab.id, {
              type: HEALTH_PUSH_MESSAGE_TYPE,
              report,
              reason,
            });
            pushed += 1;
          } catch {
            // Pestaña HHR sin content script (p. ej. cargada antes de instalar
            // la extensión): el push es oportunista, no un error.
          }
        })
      );
      return { pushed };
    };

    const start = () => {
      if (!chromeApi.alarms) return false;
      chromeApi.alarms.create(alarmName, { periodInMinutes: periodMinutes });
      chromeApi.alarms.onAlarm.addListener(alarm => {
        if (alarm && alarm.name === alarmName) void pushNow('heartbeat');
      });
      return true;
    };

    /** Envuelve un handler de ruta para empujar el estado fresco al terminar. */
    const pushAfter =
      (handle, reason) =>
      (...args) =>
        Promise.resolve(handle(...args)).finally(() => void pushNow(reason));

    return { start, pushNow, pushAfter };
  };

  root.HhrHealthHeartbeatRuntime = { create, HEALTH_PUSH_MESSAGE_TYPE };
})(typeof self !== 'undefined' ? self : globalThis);
