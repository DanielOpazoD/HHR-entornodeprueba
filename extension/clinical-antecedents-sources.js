/** HCC source contracts. Secondary identifiers are opaque, never navigation URLs. */
(function (root) {
  'use strict';
  const create = ({ run, list, text }) => {
    const scalar = value => value == null ? '' : String(value);
    const facility = value => /^[A-Za-z0-9-]{1,32}$/.test(value || '');
    const entry = (row, item, source, windowEnd) => {
      const id = scalar(item.IdAtencion ?? row.IdentificadorAtencion);
      const facilityCode = scalar(row.CodEstablecimientoAtencion);
      const secondary = source === 'Secundaria';
      return {
        id: secondary ? `${facilityCode}~${id}` : id, source,
        date: text(item.FechaHoraInicio || row.FechaHoraAtencion), windowEnd,
        diagnosis: text(row.DiagnosticoPrincipal), facility: text(row.EstablecimientoAtencion),
        type: text(row.TipoAtencion),
        ...(secondary ? { facilityCode, attentionId: id } : {}),
      };
    };
    const summaryRows = (result, source, windowEnd) => {
      const history = result.ResumenHistorial;
      const secondary = source === 'Secundaria';
      return list(secondary ? history?.ResumenHistorial ?? history?.TypeResumenHistorial
        : history?.TypeResumenHistorial).flatMap(row => {
        if (secondary && !facility(scalar(row.CodEstablecimientoAtencion)))
          throw new Error('El visor no pudo consultar esta fuente.');
        const details = secondary ? [] : list(row.HistorialResumido?.ResumenHistorialAtenciones);
        return (details.length ? details : [row]).map(item => entry(row, item, source, windowEnd))
          .filter(value => (secondary ? /^[A-Za-z0-9-]{1,128}$/ : /^\d+$/)
            .test(secondary ? value.attentionId : value.id));
      });
    };
    const status = result => Number(result?.RespuestaBase?.Estatus ?? result?.RespuestaBase?.Status);
    const verifiedPrimary = (result, history, selected) => {
      const detail = result?.DetalleHistorial;
      if (status(result) !== 0 || scalar(detail?.IdAtencion) !== selected.id)
        throw new Error('El visor no pudo verificar el detalle de la atención.');
      if (!detail.Paciente?.Rut || run(detail.Paciente.Rut) !== run(history.patientRun))
        throw new Error('El detalle no permite verificar al paciente.');
      return detail;
    };
    const verifiedSecondary = (result, history, selected) => {
      if (!result) throw new Error('La fuente secundaria no entregó detalle para esta atención.');
      const xml = result?.XMLDetalleHistoria;
      const detail = xml?.DetalleEpisodio || xml?.DetalleEpisodioCC;
      const episode = detail?.Episodio;
      const patient = detail?.Paciente;
      if (status(result) !== 0 || !episode || scalar(episode.IdEpisodio) !== selected.attentionId)
        throw new Error('El visor no pudo verificar el detalle de la atención.');
      if (!patient?.RUT || run(patient.RUT) !== run(history.patientRun))
        throw new Error('El detalle no permite verificar al paciente.');
      return { episode, patient };
    };
    const secondaryDetail = (result, history, selected) => {
      const { episode, patient } = verifiedSecondary(result, history, selected);
      const type = text(episode.TipoEpisodio || selected.type).normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const anamnesis = list(episode.Anamnesis);
      const join = key => anamnesis.map(value => text(value[key])).filter(Boolean).join('\n\n');
      return { secondaryDetail: {
        careType: /^urgencia/.test(type) ? 'emergency' : /^hospital/.test(type) ? 'hospitalization' : 'outpatient',
        patientName: text(patient.NombreCompleto), reason: join('MotivoConsultaAnamnesis'),
        history: join('EnfermedadActual'), summary: text(episode.Resumen),
        professional: list(episode.ProfesionalPrestador).map(p => text(p.NombreCompleto))
          .filter(Boolean).join(' · '),
        diagnoses: list(episode.Diagnosticos).map(d => text(d.DescripcionDiagnostico)).filter(Boolean),
        indications: anamnesis.map(value => text(value.Indicacion)).filter(Boolean),
        attachments: [], physicalExams: [], prescriptions: [],
      } };
    };
    const detailFor = async (history, selected) => {
      const secondary = selected.source === 'Secundaria';
      if (secondary && !facility(selected.facilityCode))
        throw new Error('El visor no pudo verificar el establecimiento de la atención.');
      const params = secondary ? { IdAtencion: selected.attentionId,
        ParametroBase: { ...history.base, CodigoEstablecimientoConsulta: selected.facilityCode, Key: '1' },
      } : { IdentificacionAtencion: selected.id, ParametroBase: history.base };
      const data = await history.readHistoryJson(
        `/api/ObtenerDetalleHistorialClinico${secondary ? 'Secundaria' : 'Primaria'}`,
        'ParametroFUC', params, secondary ? 45000 : 15000
      );
      const result = data?.ObtenerDetalleHistorialClinicoResult;
      if (secondary) return secondaryDetail(result, history, selected);
      return verifiedPrimary(result, history, selected);
    };
    return { summaryRows, detailFor };
  };
  root.HhrClinicalAntecedentsSources = { create };
})(typeof self !== 'undefined' ? self : globalThis);
