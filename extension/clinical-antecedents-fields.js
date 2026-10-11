/** Selected, read-only fields from an identity-verified HCC primary encounter. */
(function (root) {
  'use strict';
  const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const text = value => typeof value === 'string' ? value : '';
  const scalar = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
  const strings = value => (Array.isArray(value) ? value : [value]).map(text).filter(value => value.trim());
  const normalized = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const emergencyForm = form => /^examen fisico(?: segmentario)? urgencia\s*:?$/.test(normalized(form?.Nombre));
  const categoryFields = category => {
    const own = list(category?.Campo?.TypeCampo).map(field => ({
      label: text(field?.Etiqueta), value: scalar(field?.Valor),
    })).filter(field => field.label.trim() && field.value.trim());
    return own.concat(list(category?.SubCategoria?.TypeCategoria).flatMap(categoryFields));
  };
  const examKey = exam => JSON.stringify([normalized(exam.name).replace(/\s*:$/, ''), exam.fields.map(field =>
    [normalized(field.label), field.value.trim()]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))]);
  const physicalExams = forms => [...new Map(forms.filter(emergencyForm).map(form => ({
    name: text(form.Nombre),
    fields: list(form.Categoria?.TypeCategoria).flatMap(categoryFields),
  })).filter(form => form.fields.length).map(exam => [examKey(exam), exam])).values()];
  const prescriptions = detail => list(detail.Recetas?.DetalleHistorialAtencionesReceta).map(recipe => ({
    id: scalar(recipe?.IdReceta),
    date: text(recipe?.FechaGeneracion),
    status: text(recipe?.Estado),
    type: text(recipe?.TipoReceta),
    items: list(recipe?.Prescripcion?.DetalleHistorialAtencionesRecetaPrescripcion)
      .map(item => text(item?.DescripcionPrescripcion)).filter(value => value.trim()),
  })).filter(recipe => recipe.id && recipe.items.length);
  const project = detail => {
    const forms = list(detail.Formularios?.TypeFormulario);
    const careType = forms.some(emergencyForm) ? 'emergency' : 'outpatient';
    return {
      careType,
      patientName: text(detail.Paciente?.NombreCompleto),
      diagnoses: list(detail.DiagnosticosAtencion?.DetalleHistorialAtencionesDiagnosticoAtencion)
        .map(diagnosis => text(diagnosis?.DescripcionDiagnostico)).filter(value => value.trim()),
      indications: strings(detail.Indicaciones?.string),
      physicalExams: careType === 'emergency' ? physicalExams(forms) : [],
      prescriptions: careType === 'outpatient' ? prescriptions(detail) : [],
    };
  };
  root.HhrClinicalAntecedentsFields = { project };
})(typeof self !== 'undefined' ? self : globalThis);
