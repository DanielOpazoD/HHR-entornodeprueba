/** Detail and attachment safeguards for the read-only HCC history runtime. */
(function (root) {
  'use strict';
  const create = ({ externalJson, openTab, getAuthorizationKey, run, list, text }) => {
    const attachmentSupport = root.HhrClinicalAntecedentsAttachment.create({ list, text, openTab });
    const recentHistory = new Map(), recentDetails = new Map();
    let activeDetails = 0;
    const detailWaiters = [];
    const withDetailSlot = async work => {
      if (activeDetails >= 3) await new Promise(resolve => detailWaiters.push(resolve));
      activeDetails += 1;
      try { return await work(); }
      finally {
        activeDetails -= 1;
        detailWaiters.shift()?.();
      }
    };
    const remember = (cache, key, value) => {
      const entry = { value, expiresAt: Date.now() + 30000 };
      cache.set(key, entry);
      setTimeout(() => {
        if (cache.get(key) === entry) cache.delete(key);
      }, 30000);
      return entry;
    };
    const cachedHistoryFor = async (historyFor, encId, sender) => {
      const authorizationKey = await getAuthorizationKey(sender);
      const key = `${authorizationKey}:${encId}`;
      const cached = recentHistory.get(key);
      if (cached?.expiresAt > Date.now()) return await cached.value;
      const pending = historyFor(encId, sender).then(async value => {
        const currentAuthorizationKey = await getAuthorizationKey(sender);
        if (currentAuthorizationKey !== authorizationKey)
          throw new Error('La sesión clínica cambió durante la consulta de antecedentes.');
        return { ...value, authorizationKey };
      });
      remember(recentHistory, key, pending);
      try {
        const value = await pending;
        if (value.warnings.length) recentHistory.delete(key);
        return value;
      } catch (error) {
        recentHistory.delete(key);
        throw error;
      }
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
      reason: text(detail.Anamnesis?.MotivoConsultaAnamnesis),
      history: text(detail.Anamnesis?.HistoriaEnfermedadAnamnesis),
      professional: text(detail.ProfesionalPrestador?.Nombre),
      attachments: attachmentSupport.summaries(detail),
    });
    const sourceWarning = (source, index) => index === 1 && source.reason?.name === 'AbortError'
      ? 'Antecedentes ambulatorios cargados. La fuente secundaria sigue pendiente; se reintentará en segundo plano.'
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
