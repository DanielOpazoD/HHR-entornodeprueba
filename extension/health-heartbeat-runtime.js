/** Push ordenado de salud a HHR por alarma MV3 y tras transiciones de sesión. */
(function (root) {
  'use strict';
  const HEALTH_PUSH_MESSAGE_TYPE = 'RAYEN_EXTENSION_HEALTH_PUSH';
  const create = ({
    chromeApi,
    readHealth, invalidateHealth = () => undefined,
    targetMatchPatterns,
    alarmName = 'hhr-health-heartbeat',
    periodMinutes = 1,
    log = (...args) => console.warn(...args),
  }) => {
    const resolvedTargetMatchPatterns = targetMatchPatterns || Array.from(
      new Set(
        (chromeApi.runtime.getManifest().content_scripts || [])
          .filter(entry =>
            (entry.js || []).some(file =>
              ['content-hhr.js', 'content-fichamedico.js', 'content-gestioncamas.js'].includes(file)
            )
          )
          .flatMap(entry => entry.matches || [])
      )
    );
    let pushGeneration = 0;
    const nextPublicationSequence = root.HhrHealthPushOrderingRuntime
      .createAllocator(chromeApi.storage && chromeApi.storage.session);
    const pushNow = async (reason, report = null) => {
      const generation = ++pushGeneration;
      invalidateHealth();
      const publicationSequence = await nextPublicationSequence().catch(error => {
        log('[HHR] El latido no pudo reservar el orden de publicación:', error);
      });
      if (!publicationSequence) return { pushed: 0 };
      if (generation !== pushGeneration) return { pushed: 0 };
      try {
        report ||= await readHealth();
      } catch (error) {
        log('[HHR] El latido no pudo leer el estado de la extensión:', error);
        return { pushed: 0 };
      }
      if (generation !== pushGeneration) return { pushed: 0 };
      let tabs = [];
      try {
        tabs = await chromeApi.tabs.query({
          url: Array.from(
            new Set(
              (Array.isArray(resolvedTargetMatchPatterns)
                ? resolvedTargetMatchPatterns
                : [resolvedTargetMatchPatterns]
              ).filter(Boolean)
            )
          ),
        });
      } catch (error) {
        log('[HHR] El latido no pudo enumerar pestañas HHR/Rayen:', error);
        return { pushed: 0 };
      }
      if (generation !== pushGeneration) return { pushed: 0 };
      let pushed = 0;
      await Promise.all(
        tabs.map(async tab => {
          if (generation !== pushGeneration) return;
          try {
            await chromeApi.tabs.sendMessage(tab.id, {
              type: HEALTH_PUSH_MESSAGE_TYPE,
              report,
              reason,
              publicationSequence,
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
    // El service worker MV3 re-evalúa TODO su top-level cada vez que despierta,
    // y chrome.alarms.create con el mismo nombre REINICIA el contador: crear la
    // alarma sin proteger hacía que nunca alcanzara a disparar (las pestañas de
    // Rayen despiertan al worker más seguido que el período). Solo se crea si
    // no existe; onInstalled la recrea para tomar cambios de período.
    const ensureAlarm = async ({ recreate = false } = {}) => {
      const existing = await chromeApi.alarms.get(alarmName).catch(() => null);
      if (existing && !recreate) return;
      chromeApi.alarms.create(alarmName, { periodInMinutes: periodMinutes });
    };
    const start = () => {
      if (!chromeApi.alarms) return false;
      chromeApi.alarms.onAlarm.addListener(alarm => {
        if (alarm && alarm.name === alarmName) void pushNow('heartbeat');
      });
      if (chromeApi.runtime && chromeApi.runtime.onInstalled) {
        chromeApi.runtime.onInstalled.addListener(() => void ensureAlarm({ recreate: true }));
      }
      void ensureAlarm();
      return true;
    };

    /** Envuelve un handler de ruta para empujar el estado fresco al terminar. */
    const pushAfter = (handle, reason, reportFromResult) => (...args) =>
      Promise.resolve().then(() => handle(...args)).then(result => {
        void pushNow(reason, reportFromResult?.(result));
        return result;
      }, error => {
        void pushNow(reason);
        throw error;
      });
    return { start, pushNow, pushAfter };
  };

  root.HhrHealthHeartbeatRuntime = { create, HEALTH_PUSH_MESSAGE_TYPE };
})(typeof self !== 'undefined' ? self : globalThis);
