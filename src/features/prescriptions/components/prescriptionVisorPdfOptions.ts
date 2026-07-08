import {
  DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS,
  type PrescriptionMonthlyPdfColorMode,
  type PrescriptionMonthlyPdfImageQuality,
  type PrescriptionsPerPageOption,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfService';

const MONTHLY_PDF_OPTIONS_STORAGE_KEY = 'hhr.prescriptions.monthlyPdfOptions';

export const PRESCRIPTIONS_PER_PAGE_OPTIONS: readonly PrescriptionsPerPageOption[] = [1, 2, 4, 6];
export const PDF_COLOR_MODE_OPTIONS: readonly PrescriptionMonthlyPdfColorMode[] = [
  'color',
  'grayscale',
];
export const PDF_IMAGE_QUALITY_OPTIONS: readonly PrescriptionMonthlyPdfImageQuality[] = [
  'medium',
  'reduced',
  'compact',
  'low',
];

interface MonthlyPdfOptions {
  colorMode: PrescriptionMonthlyPdfColorMode;
  imageQuality: PrescriptionMonthlyPdfImageQuality;
  prescriptionsPerPage: PrescriptionsPerPageOption;
}

const isPrescriptionsPerPageOption = (value: unknown): value is PrescriptionsPerPageOption =>
  typeof value === 'number' &&
  PRESCRIPTIONS_PER_PAGE_OPTIONS.includes(value as PrescriptionsPerPageOption);

const isPdfColorMode = (value: unknown): value is PrescriptionMonthlyPdfColorMode =>
  typeof value === 'string' &&
  PDF_COLOR_MODE_OPTIONS.includes(value as PrescriptionMonthlyPdfColorMode);

const isPdfImageQuality = (value: unknown): value is PrescriptionMonthlyPdfImageQuality =>
  typeof value === 'string' &&
  PDF_IMAGE_QUALITY_OPTIONS.includes(value as PrescriptionMonthlyPdfImageQuality);

export const loadStoredMonthlyPdfOptions = (): Partial<MonthlyPdfOptions> => {
  if (typeof window === 'undefined') return {};
  try {
    const rawValue = window.localStorage.getItem(MONTHLY_PDF_OPTIONS_STORAGE_KEY);
    if (!rawValue) return {};
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    return {
      colorMode: isPdfColorMode(parsed.colorMode) ? parsed.colorMode : undefined,
      imageQuality: isPdfImageQuality(parsed.imageQuality) ? parsed.imageQuality : undefined,
      prescriptionsPerPage: isPrescriptionsPerPageOption(parsed.prescriptionsPerPage)
        ? parsed.prescriptionsPerPage
        : undefined,
    };
  } catch {
    return {};
  }
};

export const buildMonthlyPdfOptions = (options: Partial<MonthlyPdfOptions>): MonthlyPdfOptions => ({
  colorMode: options.colorMode ?? DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS.colorMode,
  imageQuality: options.imageQuality ?? DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS.imageQuality,
  prescriptionsPerPage:
    options.prescriptionsPerPage ?? DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS.prescriptionsPerPage,
});

export const persistMonthlyPdfOptions = (options: MonthlyPdfOptions): void => {
  try {
    window.localStorage.setItem(MONTHLY_PDF_OPTIONS_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Preference persistence must never block clinical printing.
  }
};
