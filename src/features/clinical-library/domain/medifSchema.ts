import schema from './medifSchema.json';

export type MedifValues = Record<string, string>;

export interface MedifField {
  id: string;
  name: string;
  label: string;
  shortLabel: string;
  rect: number[];
  kind: 'text' | 'mark';
  multiline: boolean;
  font_size: number;
  page: number;
  sectionId: string;
  groupId: string;
  inputType: 'text' | 'textarea' | 'date' | 'tel' | 'email' | 'number';
  suggestedSource: 'manual' | 'hhr' | 'medical-review';
  requiresMedicalReview: boolean;
  help?: string;
  placeholder?: string;
  maxLength?: number;
}

interface MedifGroupBase {
  id: string;
  label: string;
  help?: string;
}

export interface MedifFieldsGroup extends MedifGroupBase {
  type: 'fields';
  fields: string[];
}

export interface MedifChoiceGroup extends MedifGroupBase {
  type: 'choice';
  multiple: boolean;
  options: { label: string; fieldId: string }[];
}

export type MedifGroup = MedifFieldsGroup | MedifChoiceGroup;

export interface MedifSection {
  id: string;
  title: string;
  part: number;
  page: number;
  pages?: number[];
  parts?: number[];
  description: string;
  groups: MedifGroup[];
}

export interface MedifSchema {
  schemaVersion: string;
  title: string;
  sourceTemplate: string;
  fieldCount: number;
  textFieldCount: number;
  markFieldCount: number;
  sections: MedifSection[];
  fields: MedifField[];
}

export const MEDIF_SCHEMA = schema as MedifSchema;
export const MEDIF_FIELDS: readonly MedifField[] = MEDIF_SCHEMA.fields;
export const MEDIF_SECTIONS: readonly MedifSection[] = MEDIF_SCHEMA.sections;
export const MEDIF_GROUPS: readonly MedifGroup[] = MEDIF_SECTIONS.flatMap(
  section => section.groups
);
export const MEDIF_FIELD_BY_ID: Readonly<Record<string, MedifField>> = Object.fromEntries(
  MEDIF_FIELDS.map(field => [field.id, field])
);

export const getMedifGroupFieldIds = (group: MedifGroup): string[] =>
  group.type === 'choice' ? group.options.map(option => option.fieldId) : [...group.fields];

/** The same identity appears on both parts; other repeated questions remain independent. */
export const MEDIF_IDENTITY_ALIASES: readonly (readonly string[])[] = [
  ['p1_nombre_pasajero', 'p2_nombre_paciente'],
  ['p1_edad', 'p2_edad'],
];

export const isMedifFieldId = (fieldId: string): boolean =>
  Object.hasOwn(MEDIF_FIELD_BY_ID, fieldId);
