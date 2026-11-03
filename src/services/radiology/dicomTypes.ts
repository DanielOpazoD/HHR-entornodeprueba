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
  /**
   * MMRAD's registration of this same patient when it differs only in a mistyped check digit.
   * Its originals carry it as PatientID, so it replaces `patientId` in that check only.
   */
  registeredPatientId?: string;
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

/** DICOM DA (YYYYMMDD) as shown in the viewer; other values pass through unchanged. */
export const formatDicomStudyDate = (value?: string): string | undefined =>
  value?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$3/$2/$1');

/** Patient-direction letters shown at each edge of a view (LPS). */
export interface DicomOrientation {
  top: string;
  right: string;
  bottom: string;
  left: string;
}
