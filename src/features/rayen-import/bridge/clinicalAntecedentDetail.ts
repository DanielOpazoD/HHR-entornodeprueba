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

/** Whitelist the current extension payload instead of spreading bridge input. */
export const decodeClinicalAntecedentDetail = (
  value: unknown
): ClinicalAntecedentDetail | undefined => {
  if (!record(value) || !stringFields(value, ['reason', 'history', 'professional'])) return;
  if (!attachments(value.attachments)) return;
  if (value.careType !== 'emergency' && value.careType !== 'outpatient') return;
  if (typeof value.patientName !== 'string') return;
  if (!strings(value.diagnoses)) return;
  if (!strings(value.indications)) return;
  if (!exams(value.physicalExams)) return;
  if (!prescriptions(value.prescriptions)) return;
  return {
    reason: value.reason as string,
    history: value.history as string,
    professional: value.professional as string,
    attachments: value.attachments.map(({ id, label }) => ({ id, label })),
    careType: value.careType,
    patientName: value.patientName,
    diagnoses: value.diagnoses,
    indications: value.indications,
    physicalExams: value.physicalExams.map(({ name, fields }) => ({
      name,
      fields: fields.map(({ label, value }) => ({ label, value })),
    })),
    prescriptions: value.prescriptions.map(({ id, date, status, type, items }) => ({
      id,
      date,
      status,
      type,
      items,
    })),
  };
};
