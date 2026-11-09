/** Read-only HCC history. Patient identity and access URLs never come from the HHR DOM. */
(function (root) {
  'use strict';
  const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const text = value => (typeof value === 'string' ? value : '');
  const run = value => String(value || '').replace(/[^0-9k]/gi, '').toUpperCase();
  const create = ({ getContext, readJson, fetchImpl, openTab, getAuthorizationKey, downloadDau, prepareDauLogin, now = () => new Date() }) => {
    const authorize = root.HhrClinicalAntecedentsTransport.create({ fetchImpl });
    const sourceSupport = root.HhrClinicalAntecedentsSources.create({ run, list, text });
    const detailSupport = root.HhrClinicalAntecedentsDetail.create({
      openTab,
      getAuthorizationKey,
      sources: sourceSupport,
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
    const historyFor = async (encId, sender, beforeDate) => {
      const end = now();
      const window = root.HhrClinicalAntecedentsWindow.create(end, beforeDate);
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
      const readHistoryJson = await authorize(parts[4]);
      // The viewer accepts bounded windows, including older ones requested on demand.
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Pacific/Easter',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(end);
      const base = {
        CodigoEstablecimientoConsulta: '99-991',
        FechaHoraMensaje: `${root.HhrClinicalAntecedentsWindow.localDay(end)} ${time}`,
        IdSitioSoftware: '1',
        IdSoftwareInforma: '1',
        TipoMensaje: '1',
        VersionSoftwareInforma: '1',
      };
      const params = {
        FechaInicio: window.startDate,
        FechaTermino: window.endDate,
        IdRyF: id,
        IdentificacionPaciente: {
          OtraIdentificacion: '1',
          Run: patientRun,
          TipoIdentificacion: '1',
        },
        ParametroBase: base,
      };
      const sources = await Promise.allSettled(
        ['Primaria', 'Secundaria'].map(async source => {
          const data = await readHistoryJson(`/api/ObtenerResumenHistorialClinico${source}`,
            'ParametroFUC', params, source === 'Secundaria' ? 45000 : 15000);
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
          return sourceSupport.summaryRows(result, source, window.endDate);
        })
      );
      return {
        base,
        patientRun,
        readHistoryJson,
        ...window,
        rows: sources.flatMap(source => (source.status === 'fulfilled' ? source.value : [])),
        warnings: sources.flatMap((source, i) =>
          source.status === 'rejected' ? [detailSupport.sourceWarning(source, i)] : []
        ),
        unavailableSources: sources.flatMap((source, i) =>
          source.status === 'rejected' ? [i === 0 ? 'Primaria' : 'Secundaria'] : []
        ),
      };
    };
    const officialDauFor = async (history, selected, detail, sender) => {
      if (selected.source !== 'Primaria' || detailSupport.slim(detail).careType !== 'emergency' || !downloadDau)
        throw new Error('El DAU oficial no está disponible para esta atención.');
      return await downloadDau({ patientRun: run(history.patientRun), attentionId: selected.id, sender,
        assertAuthorization: async () => {
          if (await getAuthorizationKey(sender) !== history.authorizationKey)
            throw new Error('La sesión clínica cambió durante la descarga del DAU.');
        },
      });
    };
    const prepareDauAccess = async ({ operation, entryId, sender }) => {
      if (operation !== 'dau') return null;
      if (!/^Primaria:\d+$/.test(String(entryId)))
        throw new Error('El DAU oficial no está disponible para esta atención.');
      // Credentials UI contains no clinical data; selection is still verified before download.
      return await prepareDauLogin?.(sender);
    };
    const handleRequest = async ({ encId, operation, entryId, beforeDate, sender }) => {
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
        if (!['list', 'detail', 'attachment', 'dau'].includes(operation))
          throw new Error('La consulta de antecedentes no es válida.');
        const access = await prepareDauAccess({ operation, entryId, sender });
        if (access) return access;
        const history = await detailSupport.cachedHistoryFor(historyFor, encId, sender, beforeDate, operation === 'list');
        if (operation === 'list')
          return {
            ok: true,
            entries: history.rows.map(({ facilityCode: _facilityCode, attentionId: _attentionId, ...entry }) => entry),
            warnings: history.warnings,
            unavailableSources: history.unavailableSources,
            windowStart: history.startDate,
            windowEnd: history.endDate,
            nextBeforeDate: history.nextBeforeDate,
          };
        const [source, id, attachmentId] = String(entryId || '').split(':');
        const selected = history.rows.find(row => row.source === source && row.id === id);
        if (!selected) throw new Error('La atención ya no está disponible para este paciente.');
        const detail = await detailSupport.detailFor(history, selected, sender);
        if (operation === 'dau') return await officialDauFor(history, selected, detail, sender);
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
