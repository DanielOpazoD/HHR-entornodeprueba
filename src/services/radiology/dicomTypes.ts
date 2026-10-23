/** Transport and capture contracts shared by the viewer and clinical forms. No runtime imports. */
export interface DicomInstance {
  uid: string;
  number: number;
  frames: number;
  ticket: string;
}

export interface DicomSeries {
  uid: string;
  number: number;
  description: string;
  modality: string;
  rows: number;
  columns: number;
  instances: DicomInstance[];
}

export interface DicomStudy {
  uid: string;
  /** Requested patient document. Verified against PatientID in every original before rendering. */
  patientId: string;
  date: string;
  series: DicomSeries[];
}

export type DicomPlane = 'original' | 'axial' | 'coronal' | 'sagittal' | '3d';

export interface DicomCapture {
  id: string;
  patientId: string;
  studyUid: string;
  seriesUid: string;
  plane: DicomPlane;
  caption: string;
  png: Uint8Array;
  width: number;
  height: number;
}

export const normalizeDicomPatientId = (value: string): string =>
  value.replace(/[.\s-]/g, '').toUpperCase();
