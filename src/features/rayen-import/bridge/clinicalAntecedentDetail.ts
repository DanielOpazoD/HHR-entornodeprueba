export interface ClinicalAntecedentPrescription {
  id: string;
  date: string;
  status: string;
  type: string;
  items: string[];
}
export interface ClinicalAntecedentDetail {
  reason: string;
  history: string;
  professional: string;
  attachments: Array<{ id: string; label: string }>;
  careType?: 'emergency' | 'outpatient';
  patientName?: string;
  diagnoses?: string[];
  indications?: string[];
  physicalExams?: Array<{ name: string; fields: Array<{ label: string; value: string }> }>;
  prescriptions?: ClinicalAntecedentPrescription[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');
const stringFields = (value: unknown, fields: string[]): value is Record<string, string> =>
  record(value) && fields.every(field => typeof value[field] === 'string');
const attachments = (value: unknown): value is ClinicalAntecedentDetail['attachments'] =>
  Array.isArray(value) && value.every(item => stringFields(item, ['id', 'label']));
const exams = (value: unknown): value is NonNullable<ClinicalAntecedentDetail['physicalExams']> =>
  Array.isArray(value) &&
  value.every(
    item =>
      record(item) &&
      typeof item.name === 'string' &&
      Array.isArray(item.fields) &&
      item.fields.every(field => stringFields(field, ['label', 'value']))
  );
const prescriptions = (value: unknown): value is ClinicalAntecedentPrescription[] =>
  Array.isArray(value) &&
  value.every(
    item =>
      record(item) && stringFields(item, ['id', 'date', 'status', 'type']) && strings(item.items)
  );

/** Accept legacy extensions; whitelist new fields instead of spreading bridge input. */
export const decodeClinicalAntecedentDetail = (
  value: unknown
): ClinicalAntecedentDetail | undefined => {
  if (!record(value) || !stringFields(value, ['reason', 'history', 'professional'])) return;
  if (value.attachments !== undefined && !attachments(value.attachments)) return;
  if (
    value.careType !== undefined &&
    value.careType !== 'emergency' &&
    value.careType !== 'outpatient'
  )
    return;
  if (value.patientName !== undefined && typeof value.patientName !== 'string') return;
  if (value.diagnoses !== undefined && !strings(value.diagnoses)) return;
  if (value.indications !== undefined && !strings(value.indications)) return;
  if (value.physicalExams !== undefined && !exams(value.physicalExams)) return;
  if (value.prescriptions !== undefined && !prescriptions(value.prescriptions)) return;
  return {
    reason: value.reason as string,
    history: value.history as string,
    professional: value.professional as string,
    attachments: (
      (value.attachments as ClinicalAntecedentDetail['attachments'] | undefined) ?? []
    ).map(({ id, label }) => ({ id, label })),
    careType: value.careType as ClinicalAntecedentDetail['careType'],
    patientName: value.patientName as string | undefined,
    diagnoses: value.diagnoses as string[] | undefined,
    indications: value.indications as string[] | undefined,
    physicalExams: (value.physicalExams as ClinicalAntecedentDetail['physicalExams'])?.map(
      ({ name, fields }) => ({ name, fields: fields.map(({ label, value }) => ({ label, value })) })
    ),
    prescriptions: (value.prescriptions as ClinicalAntecedentDetail['prescriptions'])?.map(
      ({ id, date, status, type, items }) => ({ id, date, status, type, items })
    ),
  };
};
