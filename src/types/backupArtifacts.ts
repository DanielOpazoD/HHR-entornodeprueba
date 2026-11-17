export interface BaseStoredFile {
  name: string;
  fullPath: string;
  downloadUrl: string;
  date: string;
  createdAt: string;
  size: number;
}

export interface StoredPdfFile extends BaseStoredFile {
  shiftType: 'day' | 'night';
}

export interface StorageListReport {
  skippedNotFound: number;
  skippedRestricted: number;
  skippedUnknown: number;
  skippedUnparsed: number;
  timedOut: boolean;
}

export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i)) + ' ' + sizes[i];
};
