/** Opens fresh Eloisa documents and verifies their extension bridges without reloading old tabs. */
(function (root) {
  'use strict';

  const FICHA_MEDICO_URL = 'https://fichamedico.rayensalud.cl/';
  const GESTION_CAMAS_URL = 'https://hospitalizado.rayensalud.cl/';

  const create = ({
    chromeApi,
    readHealth,
    delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    maxAttempts = 12,
    pollIntervalMs = 750,
  }) => {
    const sourceReady = source => source && source.status === 'ready' && source.reason === 'connected';
    const reportReady = report => Boolean(
      report &&
      sourceReady(report.fichaMedico) &&
      sourceReady(report.gestionCamas) &&
      sourceReady(report.hhr)
    );

    const openFreshTabs = async () => {
      const fichaMedico = await chromeApi.tabs.create({ url: FICHA_MEDICO_URL, active: true });
      const gestionCamas = await chromeApi.tabs.create({ url: GESTION_CAMAS_URL, active: false });
      return {
        fichaMedicoTabId: fichaMedico && fichaMedico.id,
        gestionCamasTabId: gestionCamas && gestionCamas.id,
      };
    };

    const repair = async () => {
      const opened = await openFreshTabs();
      let report = null;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) await delay(pollIntervalMs);
        report = await readHealth({
          fichaMedicoTabIds: [opened.fichaMedicoTabId],
          gestionCamasTabIds: [opened.gestionCamasTabId],
        });
        if (reportReady(report)) {
          return {
            ok: true,
            state: 'connected',
            message: 'La conexión limpia quedó verificada en Ficha Médico, Gestión de Camas y HHR.',
            opened,
            report,
          };
        }
      }

      const sources = ['fichaMedico', 'gestionCamas'].filter(
        source => report && report[source] && report[source].reason === 'session_expired'
      );
      if (sources.length) {
        return {
          ok: false,
          state: 'requires_login',
          requiresLogin: true,
          loginSources: sources,
          message: 'Iniciar sesión nuevamente en las pestañas nuevas de Eloísa y después comprobar la conexión.',
          opened,
          report,
        };
      }
      return {
        ok: false,
        state: 'incomplete',
        message: 'Las pestañas nuevas se abrieron, pero la conexión todavía no pudo verificarse.',
        opened,
        report,
      };
    };

    return Object.freeze({ repair });
  };

  root.HhrConnectionRepairRuntime = Object.freeze({
    create,
    FICHA_MEDICO_URL,
    GESTION_CAMAS_URL,
  });
})(typeof self !== 'undefined' ? self : globalThis);
