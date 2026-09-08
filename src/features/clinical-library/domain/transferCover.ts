/** Datos de la carátula del sobre de traslado. No se persiste: se imprime y se olvida. */

export type CoverPaper = 'oficio' | 'carta';

export interface TransferCoverData {
  patientName: string;
  rut: string;
  age: string;
  bedId: string;
  admissionDate: string;
  origin: string;
  destination: string;
  paper: CoverPaper;
}

export const TRANSFER_COVER_CONTENTS: ReadonlyArray<string> = [
  'Informe de traslado',
  'Epicrisis',
  'Exámenes de laboratorio',
  'Imágenes e informes',
  'Consentimientos',
  'Indicaciones y medicamentos',
  'Documentos administrativos',
];

export const DEFAULT_TRANSFER_ORIGIN = 'Hospital Hanga Roa · Servicio de Hospitalizados';
export const DEFAULT_TRANSFER_DESTINATION = 'Hospital del Salvador';

export const emptyTransferCover = (): TransferCoverData => ({
  patientName: '',
  rut: '',
  age: '',
  bedId: '',
  admissionDate: '',
  origin: DEFAULT_TRANSFER_ORIGIN,
  destination: DEFAULT_TRANSFER_DESTINATION,
  paper: 'oficio',
});

export const isTransferCoverPrintable = (cover: TransferCoverData): boolean =>
  cover.patientName.trim().length > 0 && cover.rut.trim().length > 0;

/** Normaliza fechas ISO o clínicas al formato que acepta un input date. */
export const normalizeCoverDateInput = (rawDate?: string | null): string => {
  const trimmed = rawDate?.trim() ?? '';
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const clinicalMatch = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (clinicalMatch) return `${clinicalMatch[3]}-${clinicalMatch[2]}-${clinicalMatch[1]}`;
  return trimmed;
};

/** Fecha de ingreso local en formato dd-mm-aaaa para la carátula. */
export const formatCoverDate = (rawDate: string): string => {
  const normalized = normalizeCoverDateInput(rawDate);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : normalized;
};
