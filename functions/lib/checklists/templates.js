const { pressureInjuryTemplates } = require('./pressureInjury');
const yesNo = ['Sí', 'No'];
const field = (id, label, type, options, required = true) => ({
  id,
  label,
  type,
  required,
  ...(options ? { options: options.map(label => ({ label })) } : {}),
});
const templates = [
  {
    id: 'vigilancia-cirugias',
    version: 1,
    title: 'IAAS · Seguimiento de cirugías trazadoras',
    fields: [
      field('cirugia', 'Cirugía', 'text'),
      field('fecha-cirugia', 'Fecha de cirugía', 'date'),
      field('primer-control', 'Fecha del primer control', 'date'),
      field('observacion-1', 'Observaciones del primer control', 'text'),
      field('iho', 'Infección de herida operatoria (IHO)', 'choice', yesNo, false),
      field('segundo-control', 'Fecha del segundo control', 'date', null, false),
      field('observacion-2', 'Observaciones del segundo control', 'text', null, false),
    ],
  },
  {
    id: 'supervision-tacto',
    version: 1,
    title: 'IAAS · Supervisión de la indicación de tacto vaginal',
    fields: [
      field('servicio', 'Servicio', 'text'),
      field('fecha', 'Fecha del procedimiento', 'date'),
      field('hora', 'Hora del procedimiento', 'time'),
      field('profesional', 'Profesional responsable del procedimiento', 'text'),
      field('numero', 'N.º de tacto del día', 'positive-integer'),
      field('criterio', 'Criterio de indicación', 'choice', [
        'C1 · Trabajo de parto activo (máx. 1 cada 4 h)',
        'C2 · Sospecha de progresión anormal del trabajo de parto',
        'C3 · Cambios en la dinámica uterina o condición materno-fetal',
        'C4 · Decisión clínica (analgesia, conducción o resolución)',
        'C5 · Sensación de pujo o transición a expulsivo',
      ]),
      field('excede', '¿Excede la frecuencia recomendada?', 'choice', yesNo),
      {
        ...field('justificacion', 'Justificación si excede la frecuencia', 'text', null, false),
        requiredWhen: { field: 'excede', equals: 'Sí' },
      },
      field('cumple', 'Cumple criterio', 'choice', yesNo),
    ],
  },
  ...pressureInjuryTemplates,
];
module.exports = { templates };
