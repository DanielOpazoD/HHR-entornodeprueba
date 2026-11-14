import type { ClinicalFormValues } from './clinicalFormTypes';

export const SIC_FORM_ID = 'solicitud-interconsulta-hhr';
const nameParts = ['paciente_apellido_paterno', 'paciente_apellido_materno', 'paciente_nombres'];
export const SIC_REASON_IDS = [
  'sic_confirmacion',
  'sic_tratamiento',
  'sic_examenes',
  'sic_ges',
  'sic_otro',
];

/** Never guess surnames from a free name, or print the full name over structured names. */
export const projectSicNames = (input: ClinicalFormValues): ClinicalFormValues => ({
  ...input,
  paciente_nombre_completo: nameParts.some(id => String(input[id] ?? '').trim())
    ? null
    : (input.paciente_nombre_completo ?? null),
});

export const validateSicRequired = (values: ClinicalFormValues): void => {
  const required: Array<[string, string]> = [
    ['formulario_fecha_emision', 'Fecha SIC'],
    ['paciente_fecha_nacimiento', 'Fecha de nacimiento'],
    ['paciente_sexo_biologico', 'Sexo'],
    ['sic_especialidad', 'Especialidad de destino'],
    ['sic_establecimiento', 'Establecimiento de destino'],
    ['sic_tipo_consulta', 'Tipo de consulta'],
    ['diagnostico_texto', 'Hipótesis diagnóstica'],
    ['sic_fundamento', 'Fundamentos del diagnóstico'],
    ['sic_profesional_nombre', 'Nombre del profesional'],
    ['sic_profesional_rut', 'RUT del profesional'],
  ];
  const missing = required
    .filter(([id]) => !String(values[id] ?? '').trim())
    .map(([, label]) => label);
  const structured = nameParts.some(id => String(values[id] ?? '').trim());
  if (
    structured
      ? !String(values.paciente_nombres ?? '').trim() ||
        !String(values.paciente_apellido_paterno ?? '').trim()
      : !String(values.paciente_nombre_completo ?? '').trim()
  )
    missing.unshift('Nombre del paciente (nombres y apellido paterno, o nombre completo)');
  if (!SIC_REASON_IDS.some(id => values[id] === true))
    missing.push('Al menos un motivo de derivación');
  if (values.paciente_sexo_biologico === 'Indeterminado')
    throw new Error(
      'La plantilla original sólo incluye casilleros Femenino y Masculino. Revisa cómo documentar el sexo sin marcar un dato incorrecto.'
    );
  if (missing.length) throw new Error(`Completa: ${missing.join('; ')}.`);
};
