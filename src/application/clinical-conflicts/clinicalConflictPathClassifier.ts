export type ClinicalConflictModuleKey =
  | 'census'
  | 'movements'
  | 'nursing_handoff'
  | 'medical_handoff'
  | 'system';

export interface ClinicalConflictModuleDescriptor {
  key: ClinicalConflictModuleKey;
  label: string;
  tone: 'blue' | 'amber' | 'emerald' | 'violet' | 'slate';
}

export interface ClinicalConflictPathClassification {
  module: ClinicalConflictModuleKey;
  label: string;
  bedId?: string;
}

export const CLINICAL_CONFLICT_MODULE_DESCRIPTORS: Record<
  ClinicalConflictModuleKey,
  ClinicalConflictModuleDescriptor
> = {
  census: { key: 'census', label: 'Censo diario', tone: 'blue' },
  movements: { key: 'movements', label: 'Altas, traslados y CMA', tone: 'amber' },
  nursing_handoff: { key: 'nursing_handoff', label: 'Entrega enfermería', tone: 'emerald' },
  medical_handoff: { key: 'medical_handoff', label: 'Entrega médica', tone: 'violet' },
  system: { key: 'system', label: 'Sincronización', tone: 'slate' },
};

export const CLINICAL_CONFLICT_MODULE_ORDER: ClinicalConflictModuleKey[] = [
  'census',
  'movements',
  'nursing_handoff',
  'medical_handoff',
  'system',
];

const FIELD_LABELS: Array<{
  test: (path: string) => boolean;
  module: ClinicalConflictModuleKey;
  label: string;
}> = [
  {
    test: path => /^beds\.[^.]+\.handoffNoteDayShift/.test(path),
    module: 'nursing_handoff',
    label: 'Nota enfermería turno largo',
  },
  {
    test: path => /^beds\.[^.]+\.handoffNoteNightShift/.test(path),
    module: 'nursing_handoff',
    label: 'Nota enfermería turno noche',
  },
  {
    test: path => path.startsWith('handoffNovedadesDayShift'),
    module: 'nursing_handoff',
    label: 'Novedades enfermería turno largo',
  },
  {
    test: path => path.startsWith('handoffNovedadesNightShift'),
    module: 'nursing_handoff',
    label: 'Novedades enfermería turno noche',
  },
  {
    test: path => path.startsWith('handoffDayChecklist'),
    module: 'nursing_handoff',
    label: 'Checklist enfermería turno largo',
  },
  {
    test: path => path.startsWith('handoffNightChecklist'),
    module: 'nursing_handoff',
    label: 'Checklist enfermería turno noche',
  },
  {
    test: path => /^medicalHandoffBySpecialty\./.test(path),
    module: 'medical_handoff',
    label: 'Entrega médica por especialidad',
  },
  {
    test: path => /^beds\.[^.]+\.medicalHandoffEntries/.test(path),
    module: 'medical_handoff',
    label: 'Entrada médica por paciente',
  },
  {
    test: path => path.startsWith('medicalHandoffNovedades'),
    module: 'medical_handoff',
    label: 'Novedades entrega médica',
  },
  {
    test: path => path.startsWith('medicalHandoffDoctor') || path.startsWith('medicalSignature'),
    module: 'medical_handoff',
    label: 'Firma entrega médica',
  },
  {
    test: path => path.startsWith('discharges.'),
    module: 'movements',
    label: 'Altas',
  },
  {
    test: path => path.startsWith('transfers.'),
    module: 'movements',
    label: 'Traslados',
  },
  {
    test: path => path.startsWith('cma.'),
    module: 'movements',
    label: 'CMA',
  },
  {
    test: path => /^beds\.[^.]+\.pathology/.test(path),
    module: 'census',
    label: 'Diagnóstico',
  },
  {
    test: path => /^beds\.[^.]+\.patientName/.test(path),
    module: 'census',
    label: 'Paciente',
  },
  {
    test: path => /^beds\.[^.]+\.(rut|bedName|status|specialty|admissionDate)/.test(path),
    module: 'census',
    label: 'Dato clínico del censo',
  },
];

const getBedIdFromPath = (path: string): string | undefined => {
  const match = path.match(/^beds\.([^.]+)\./);
  return match?.[1];
};

export const classifyClinicalConflictPath = (path: string): ClinicalConflictPathClassification => {
  const matched = FIELD_LABELS.find(entry => entry.test(path));
  return {
    module: matched?.module ?? 'census',
    label: matched?.label ?? 'Campo clínico',
    bedId: getBedIdFromPath(path),
  };
};
