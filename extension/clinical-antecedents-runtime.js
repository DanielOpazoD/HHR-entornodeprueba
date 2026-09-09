/** Read-only HCC history. Patient identity and access URLs never come from the HHR DOM. */
(function (root) {
  'use strict';
  const API = 'https://saludteintegrachileapi.rayensalud.cl';
  const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const text = value => (typeof value === 'string' ? value : '');
  const run = value => String(value || '').replace(/[^0-9k]/gi, '').toUpperCase();
  const create = ({ getContext, readJson, fetchImpl, openTab, getAuthorizationKey, now = () => new Date() }) => {
    const externalJson = async (path, parameter, value, timeoutMs = 15000) => {
      const url = new URL(path, API);
      url.searchParams.set(parameter, JSON.stringify(value));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.href, {
          headers: { Accept: 'application/json, text/plain, */*' },
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Visor de antecedentes: HTTP ${response.status}`);
        try { return await response.json(); }
        catch { throw new Error('El visor devolvió una respuesta no JSON.'); }
      } finally {
        clearTimeout(timer);
      }
    };
    const detailSupport = root.HhrClinicalAntecedentsDetail.create({
      externalJson,
      openTab,
      getAuthorizationKey,
      run,
      list,
      text,
    });
    const contextFor = async (encId, sender) => {
      const context = await getContext(encId, null, null, sender);
      if (context.error) throw new Error(context.error);
      const { data: patient } = await readJson({
        info: context.info,
        path: `/api/visorHCC/getPatientUniversalIdentifier/${encodeURIComponent(context.patientId)}`,
        cache: 'no-store',
      });
      if (String(patient?.id) !== String(context.patientId))
        throw new Error('No se pudo verificar la identidad del paciente en Antecedentes.');
      return { context, patient };
    };
    const historyFor = async (encId, sender) => {
      const { context, patient } = await contextFor(encId, sender);
      const universal = list(patient.patientIdentifier).find(
        row => Number(row.peridentId) === 7 && !row.deleted
      )?.identifierCode;
      if (!universal)
        throw new Error('Eloísa no informó el identificador del paciente para Antecedentes.');
      const { data } = await readJson({
        info: context.info,
        path: '/api/visorHCC',
        query: {
          identifier: patient.preferredIdentifierCode,
          identifierType: patient.prefferedPeridentId,
          universalIdentifier: universal,
        },
        cache: 'no-store',
      });
      const url = new URL(data?.respuestaObtenerURLVisorHCC?.url);
      if (url.origin !== 'https://visor.saludenred.cl')
        throw new Error('Eloísa entregó un visor de antecedentes desconocido.');
      const parts = url.hash.split('/');
      const patientRun = atob(parts[1] || '');
      const id = atob(parts[3] || '');
      if (
        run(patientRun) !== run(patient.preferredIdentifierCode) ||
        !/^\d+$/.test(id) ||
        String(id) !== String(universal) ||
        !parts[4]
      )
        throw new Error('El visor de antecedentes no corresponde al paciente seleccionado.');
      const token = await externalJson('/api/ObtenerToken', 'Parametro', { TokenAcceso: parts[4] });
      if (!token?.ObtenerTokenSesionResult?.TokenSesion)
        throw new Error('La sesión del visor de antecedentes venció.');
      // Captured official calls use this exchange as validation, then send ParametroFUC only.
      const end = now();
      const date = value =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Pacific/Easter',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .format(value)
          .replace(/-/g, '');
      // Match the official viewer's 35-month window; 3 full years trigger HCC code 20.
      const endDate = date(end);
      const year = Number(endDate.slice(0, 4)),
        month = Number(endDate.slice(4, 6));
      const start = new Date(Date.UTC(year, month - 1 - 35, 1, 12));
      const lastDay = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
      ).getUTCDate();
      start.setUTCDate(Math.min(Number(endDate.slice(6, 8)), lastDay));
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Pacific/Easter',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(end);
      const base = {
        CodigoEstablecimientoConsulta: '99-991',
        FechaHoraMensaje: `${date(end)} ${time}`,
        IdSitioSoftware: '1',
        IdSoftwareInforma: '1',
        TipoMensaje: '1',
        VersionSoftwareInforma: '1',
      };
      const params = {
        FechaInicio: date(start),
        FechaTermino: endDate,
        IdRyF: id,
        IdentificacionPaciente: {
          OtraIdentificacion: '1',
          Run: patientRun,
          TipoIdentificacion: '1',
        },
        ParametroBase: base,
      };
      const sources = await Promise.allSettled(
        ['Primaria', 'Secundaria'].map(async (source, index) => {
          const data = await externalJson(`/api/ObtenerResumenHistorialClinico${source}`,
            'ParametroFUC', params, index === 1 ? 1500 : 15000);
          const result = data?.ObtenerResumenHistorialClinicoResult;
          if (
            !result ||
            Number(result.RespuestaBase?.Estatus ?? result.RespuestaBase?.Status) !== 0
          )
            throw new Error('El visor no pudo consultar esta fuente.');
          if (
            !result.Paciente?.IdentificacionPaciente?.Run ||
            run(result.Paciente.IdentificacionPaciente.Run) !== run(patientRun)
          )
            throw new Error('La respuesta corresponde a otro paciente.');
          return list(result.ResumenHistorial?.TypeResumenHistorial).flatMap(row => {
            const details = list(row.HistorialResumido?.ResumenHistorialAtenciones);
            return (details.length ? details : [row])
              .map(item => ({
                id: String(item.IdAtencion ?? row.IdentificadorAtencion ?? ''),
                source,
                date: text(item.FechaHoraInicio || row.FechaHoraAtencion),
                diagnosis: text(row.DiagnosticoPrincipal),
                facility: text(row.EstablecimientoAtencion),
                type: text(row.TipoAtencion),
              }))
              .filter(row => /^\d+$/.test(row.id));
          });
        })
      );
      return {
        base,
        patientRun,
        rows: sources.flatMap(source => (source.status === 'fulfilled' ? source.value : [])),
        warnings: sources.flatMap((source, i) =>
          source.status === 'rejected' ? [detailSupport.sourceWarning(source, i)] : []
        ),
        unavailableSources: sources.flatMap((source, i) =>
          source.status === 'rejected' ? [i === 0 ? 'Primaria' : 'Secundaria'] : []
        ),
      };
    };
    const handleRequest = async ({ encId, operation, entryId, sender }) => {
      try {
        if (operation === 'urgency') {
          const { context, patient } = await contextFor(encId, sender);
          const { data } = await readJson({
            info: context.info,
            path: '/api/viau',
            query: { identifier: patient.preferredIdentifierCode },
            cache: 'no-store',
          });
          const url = new URL(data?.url);
          if (url.origin !== 'https://viau.ssmso.cl' || !url.pathname.startsWith('/visor/'))
            throw new Error('No se recibió un visor de urgencias válido.');
          await openTab({ url: url.href });
          return { ok: true, opened: true };
        }
        if (!['list', 'detail', 'attachment'].includes(operation))
          throw new Error('La consulta de antecedentes no es válida.');
        const history = await detailSupport.cachedHistoryFor(historyFor, encId, sender);
        if (operation === 'list')
          return {
            ok: true,
            entries: history.rows,
            warnings: history.warnings,
            unavailableSources: history.unavailableSources,
          };
        const [source, id, attachmentId] = String(entryId || '').split(':');
        const selected = history.rows.find(row => row.source === source && row.id === id);
        if (!selected) throw new Error('La atención ya no está disponible para este paciente.');
        // The supplied HAR only proves the primary-care detail contract.
        if (selected.source !== 'Primaria')
          throw new Error('El detalle de esta fuente no está disponible en el panel.');
        const detail = await detailSupport.detailFor(history, selected, sender);
        if (operation === 'attachment') {
          if (await getAuthorizationKey(sender) !== history.authorizationKey)
            throw new Error('La sesión clínica cambió durante la consulta de antecedentes.');
          await detailSupport.openAttachment(detail, attachmentId);
          return { ok: true, opened: true };
        }
        return {
          ok: true,
          detail: detailSupport.slim(detail),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'No se pudieron consultar los antecedentes.',
        };
      }
    };
    return { handleRequest };
  };
  root.HhrClinicalAntecedents = { create };
})(typeof self !== 'undefined' ? self : globalThis);
