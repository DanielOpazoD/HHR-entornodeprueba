export type PrescriptionsPerPageOption = 1 | 2 | 4 | 6;
export type PrescriptionMonthlyPdfColorMode = 'color' | 'grayscale';
export type PrescriptionMonthlyPdfImageQuality = 'medium' | 'reduced' | 'compact' | 'low';

export interface PrescriptionMonthlyPdfOptions {
  prescriptionsPerPage: PrescriptionsPerPageOption;
  colorMode: PrescriptionMonthlyPdfColorMode;
  imageQuality: PrescriptionMonthlyPdfImageQuality;
}
