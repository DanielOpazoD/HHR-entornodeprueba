import {
  MEDIF_FIELD_BY_ID,
  MEDIF_GROUPS,
  MEDIF_FIELD_ALIASES,
  type MedifGroup,
} from './medifSchema';

/** Continuous editor blocks; PDF sections, fields and clinical answers stay unchanged. */
export interface MedifFormBlock {
  id: string;
  title: string;
  groupIds: readonly string[];
  fullWidth?: boolean;
}

export const MEDIF_FORM_BLOCKS: readonly MedifFormBlock[] = [
  {
    id: 'paciente_vuelo',
    title: 'Paciente y vuelo',
    fullWidth: true,
    groupIds: ['pasajero_datos', 'identificacion_medica', 'tramo_1', 'tramo_2', 'agencia'],
  },
  {
    id: 'diagnostico_evaluacion',
    title: 'Diagnóstico y evaluación',
    groupIds: [
      'diagnostico_informe',
      'antecedentes',
      'evolucion',
      'condiciones_volar',
      'estabilidad_viaje',
      'cirugia_tipo',
      'cirugia_complicaciones',
    ],
  },
  {
    id: 'riesgo_autonomia',
    title: 'Riesgo y autonomía',
    groupIds: [
      'prognosis',
      'riesgo_vital',
      'contagiosa',
      'contagiosa_detalle',
      'hipoxia_pasajero',
      'alteracion_esfinter',
      'alteracion_conducta',
      'alteracion_otra',
      'autonomia_comer',
      'autonomia_bano',
      'autonomia_instrucciones',
      'autonomia_otras',
    ],
  },
  {
    id: 'asistencia_acompanante',
    title: 'Asistencia y acompañante',
    groupIds: [
      'silla_pasajero',
      'camina_pasajero',
      'acompanante_datos',
      'tipo_acompanante',
      'tipo_acompanante_otro',
      'contacto_solo',
      'perro_asistencia',
      'requerimientos_especiales',
      'requerimientos_detalle',
      'silla_medico',
      'rodillas',
      'cadera',
    ],
  },
  {
    id: 'tratamiento_traslado',
    title: 'Tratamiento y traslado',
    groupIds: [
      'medicacion_lista',
      'medicacion_previa',
      'medicacion_durante',
      'anticoagulante',
      'anticoagulante_detalle',
      'oxigeno_requerido',
      'oxigeno_equipo',
      'oxigeno_desconexion',
      'coordinacion_ambulancia',
      'ambulancia_datos',
      'hospitalizacion',
      'hospitalizacion_escalas',
      'hospitalizacion_destino',
      'hospitalizacion_arreglos',
    ],
  },
  {
    id: 'psiquiatria',
    title: 'Psiquiatría',
    groupIds: [
      'patologia_psiquiatrica',
      'patologia_psiquiatrica_tipo',
      'patologia_psiquiatrica_otra',
      'patologia_estable',
    ],
  },
  {
    id: 'medico_declaraciones',
    title: 'Médico y declaraciones',
    fullWidth: true,
    groupIds: ['medico_datos', 'declaracion_pasajero_datos', 'declaracion_medica_datos'],
  },
];

const groupById = new Map(MEDIF_GROUPS.map(group => [group.id, group]));

export const getMedifFormBlockGroups = (block: MedifFormBlock): MedifGroup[] =>
  block.groupIds.map(id => {
    const group = groupById.get(id);
    if (!group) throw new Error(`El bloque MEDIF contiene un grupo desconocido: ${id}.`);
    return group;
  });

/** Patient identity and the physician's name share their respective editor controls. */
export const getMedifCanonicalFieldId = (fieldId: string): string =>
  MEDIF_FIELD_ALIASES.find(ids => ids.includes(fieldId))?.[0] ?? fieldId;

export const MEDIF_DUPLICATE_FIELD_IDS: readonly string[] = MEDIF_FIELD_ALIASES.flatMap(ids =>
  ids.slice(1)
);

/** Dictionary links target the actual canonical control in the continuous editor. */
export const getMedifFormBlockIdForField = (fieldId: string): string | undefined => {
  const canonicalId = getMedifCanonicalFieldId(fieldId);
  const groupId = MEDIF_FIELD_BY_ID[canonicalId]?.groupId;
  return MEDIF_FORM_BLOCKS.find(block => block.groupIds.includes(groupId))?.id;
};

const GROUP_LABELS: Readonly<Record<string, string>> = {
  silla_pasajero: '¿Necesita silla de ruedas? · Declaración del pasajero',
  silla_medico: '¿Necesita silla de ruedas? · Evaluación del médico',
  hipoxia_pasajero: 'Efecto de la reducción de oxígeno · Declaración del pasajero',
  declaracion_pasajero_datos: 'Declaración del pasajero',
  declaracion_medica_datos: 'Declaración del médico',
};

export const getMedifFormGroupLabel = (group: MedifGroup): string =>
  GROUP_LABELS[group.id] ?? group.label;
