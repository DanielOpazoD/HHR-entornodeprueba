(function (root) {
  'use strict';
  const create = ({ externalJson, openTab, getAuthorizationKey, run, list, text }) => {
    const attachmentSupport = root.HhrClinicalAntecedentsAttachment.create({ list, text, openTab });
    const { remember, readHistory } = root.HhrClinicalAntecedentsCache;
    const recentHistory = new Map(), recentDetails = new Map(), detailWaiters = [];
    let activeDetails = 0;
    const withDetailSlot = async work => {
      if (activeDetails >= 3) await new Promise(resolve => detailWaiters.push(resolve));
      activeDetails += 1;
      try { return await work(); }
      finally {
        activeDetails -= 1;
        detailWaiters.shift()?.();
      }
    };
    const cachedHistoryFor = async (historyFor, encId, sender, beforeDate, retryPartial = false) => {
      const authorizationKey = await getAuthorizationKey(sender);
      const key = `${authorizationKey}:${encId}:${beforeDate || 'latest'}`;
      const cached = readHistory(recentHistory, key, retryPartial);
      if (cached) return await cached;
      const previous = recentHistory.get(key)?.result;
      const pending = historyFor(encId, sender, beforeDate).then(async value => {
        const currentAuthorizationKey = await getAuthorizationKey(sender);
        if (currentAuthorizationKey !== authorizationKey)
          throw new Error('La sesión clínica cambió durante la consulta de antecedentes.');
        const retained = previous?.patientRun === value.patientRun
          ? previous.rows.filter(row => value.unavailableSources?.includes(row.source)) : [];
        return { ...value, rows: [...retained, ...value.rows], authorizationKey };
      });
      remember(recentHistory, key, pending, recentHistory.get(key));
      return await pending;
    };
    const detailFor = async (history, selected, sender) => {
      const assertCurrentAuthorization = async () => {
        if (await getAuthorizationKey(sender) !== history.authorizationKey)
          throw new Error('La sesión clínica cambió durante la consulta de antecedentes.');
      };
      const key = `${history.authorizationKey}:${history.patientRun}:${selected.id}`;
      const cached = recentDetails.get(key);
      if (cached?.expiresAt > Date.now()) {
        const detail = await cached.value;
        await assertCurrentAuthorization();
        return detail;
      }
      const pending = withDetailSlot(() => externalJson(
        '/api/ObtenerDetalleHistorialClinicoPrimaria', 'ParametroFUC',
        { IdentificacionAtencion: selected.id, ParametroBase: history.base }
      )).then(data => {
        const result = data?.ObtenerDetalleHistorialClinicoResult;
        const detail = result?.DetalleHistorial;
        if (
          Number(result?.RespuestaBase?.Estatus) !== 0 ||
          String(detail?.IdAtencion) !== selected.id
        )
          throw new Error('El visor no pudo verificar el detalle de la atención.');
        if (!detail.Paciente?.Rut || run(detail.Paciente.Rut) !== run(history.patientRun))
          throw new Error('El detalle no permite verificar al paciente.');
        return detail;
      });
      remember(recentDetails, key, pending);
      try {
        const detail = await pending;
        await assertCurrentAuthorization();
        return detail;
      } catch (error) {
        recentDetails.delete(key);
        throw error;
      }
    };
    const slim = detail => ({
      ...root.HhrClinicalAntecedentsFields.project(detail),
      reason: text(detail.Anamnesis?.MotivoConsultaAnamnesis),
      history: text(detail.Anamnesis?.HistoriaEnfermedadAnamnesis),
      professional: text(detail.ProfesionalPrestador?.Nombre),
      attachments: attachmentSupport.summaries(detail),
    });
    const sourceWarning = (source, index) => index === 1 && source.reason?.name === 'AbortError'
      ? 'El historial de atención secundaria no respondió dentro de 45 segundos. Los antecedentes cargados siguen disponibles.'
      : `No se pudo consultar la fuente ${index === 0 ? 'ambulatoria' : 'secundaria'}. ${
        source.reason?.name === 'AbortError'
          ? 'El visor tardó demasiado en responder.'
          : /^(Visor de antecedentes: HTTP \d{3}|El visor devolvió una respuesta no JSON\.|El visor no pudo consultar esta fuente\.|La respuesta corresponde a otro paciente\.)$/.test(
                source.reason?.message || ''
              )
            ? source.reason.message
            : 'No se pudo establecer la conexión con el visor.'
      }`;
    return {
      cachedHistoryFor,
      detailFor,
      slim,
      sourceWarning,
      openAttachment: attachmentSupport.open,
    };
  };
  root.HhrClinicalAntecedentsDetail = { create };
})(typeof self !== 'undefined' ? self : globalThis);
