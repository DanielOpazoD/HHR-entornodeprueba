/** Datos de la carátula del sobre de traslado. No se persiste: se imprime y se olvida. */

export type CoverPaper = 'oficio' | 'carta';

export interface TransferCoverData {
  patientName: string;
  rut: string;
  age: string;
  bedId: string;
  date: string;
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

export const emptyTransferCover = (date: string): TransferCoverData => ({
  patientName: '',
  rut: '',
  age: '',
  bedId: '',
  date,
  origin: DEFAULT_TRANSFER_ORIGIN,
  destination: DEFAULT_TRANSFER_DESTINATION,
  paper: 'oficio',
});

export const isTransferCoverPrintable = (cover: TransferCoverData): boolean =>
  cover.patientName.trim().length > 0 && cover.rut.trim().length > 0;

/** Fecha local en formato dd-mm-aaaa para la carátula. */
export const formatCoverDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-');
  return year && month && day ? `${day}-${month}-${year}` : isoDate;
};
