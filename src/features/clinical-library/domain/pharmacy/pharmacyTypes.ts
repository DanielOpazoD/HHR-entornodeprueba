export type PharmacyActKind = 'return' | 'disposal';
export type PharmacyPaperSize = 'a4' | 'letter';

export interface PharmacyProfessional {
  name: string;
  rut: string;
  role: string;
  unit: string;
}

export interface PharmacyActLine {
  id: string;
  medicationId: string;
  name: string;
  presentation: string;
  quantity: string;
  patient: string;
  reason: string;
  expiry: string;
  disposalCause: '' | 'expired' | 'damaged' | 'unlabelled';
}

export interface PharmacyActDraft {
  kind: PharmacyActKind;
  paperSize: PharmacyPaperSize;
  number: string;
  date: string;
  professional: PharmacyProfessional;
  recipient: string;
  lines: PharmacyActLine[];
}

export interface ArsenalItem {
  id: string;
  name: string;
  presentation: string;
  observations: string;
}
