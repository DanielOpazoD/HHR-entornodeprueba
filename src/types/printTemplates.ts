export type FieldDataSource =
    | 'patient.name'
    | 'patient.rut'
    | 'patient.age'
    | 'patient.birthDate'
    | 'patient.sex'
    | 'bed.name'
    | 'today.date'
    | 'survey.diagnosis'
    | 'survey.weight'
    | 'survey.phone'
    | 'survey.doctor'
    | 'selectedExams'
    | 'prevision';

export interface PrintField {
    id: string;
    label: string;
    type: 'automated' | 'manual' | 'checkbox' | 'list';
    dataSource?: FieldDataSource;
    x: number; // in mm
    y: number; // in mm
    width?: number; // in mm, optional for wrap
    fontSize: number;
    fontWeight: 'normal' | 'bold' | 'black';
    alignment: 'left' | 'center' | 'right';
    color?: string;
}

export interface PrintTemplateConfig {
    id: string;
    name: string;
    backgroundUrl: string;
    fields: PrintField[];
    pageWidth: number; // usually 210 for A4
    pageHeight: number; // usually 297 for A4
}
