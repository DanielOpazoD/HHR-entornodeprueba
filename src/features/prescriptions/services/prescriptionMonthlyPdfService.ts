import { resolvePrescriptionImageDownloadUrl } from '@/features/prescriptions/services/prescriptionStorageImageService';
import { type PrescriptionRecord } from '@/types/prescriptionTypes';
import {
  createPrescriptionMonthlyPrintDocument,
  PRESCRIPTION_MONTHLY_PRINT_ROOT_ID,
  PRESCRIPTION_MONTHLY_PRINT_STYLE_ID,
  waitForPrescriptionMonthlyPrintImages,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfPrintDocument';
import type {
  PrescriptionMonthlyPdfImageQuality,
  PrescriptionMonthlyPdfOptions,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfTypes';
export type {
  PrescriptionMonthlyPdfColorMode,
  PrescriptionMonthlyPdfImageQuality,
  PrescriptionMonthlyPdfOptions,
  PrescriptionsPerPageOption,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfTypes';

const PRINT_TRIGGER_DELAY_MS = 150;
const PRINT_CLEANUP_TIMEOUT_MS = 60_000;
const IMAGE_PROXY_REQUEST_TIMEOUT_MS = 10_000;
const IMAGE_PROXY_MAX_CONCURRENT_REQUESTS = 4;

export const DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS: PrescriptionMonthlyPdfOptions = {
  prescriptionsPerPage: 2,
  colorMode: 'color',
  imageQuality: 'medium',
};

export const PRESCRIPTION_PDF_IMAGE_QUALITY_PRESETS: Record<
  PrescriptionMonthlyPdfImageQuality,
  { width: number; quality: number } | null
> = {
  medium: null,
  reduced: { width: 980, quality: 66 },
  compact: { width: 760, quality: 58 },
  low: { width: 560, quality: 50 },
};

interface MonthlyPrescriptionPdfScope {
  records: PrescriptionRecord[];
  startIso: string;
  endIso: string;
}

interface MonthlyPrescriptionPdfFileNameParams {
  startIso: string;
  endIso: string;
}

interface ExportMonthlyPrescriptionsPdfParams {
  records: PrescriptionRecord[];
  selectedDateIso?: string | null;
  options?: Partial<PrescriptionMonthlyPdfOptions>;
}

export interface ExportMonthlyPrescriptionsPdfResult {
  exportedCount: number;
  fileName: string;
  optimizationFallbackCount: number;
}

interface PrintablePrescriptionImageAsset {
  optimizationFallback: boolean;
  revoke?: () => void;
  url: string;
}

const toLocalIsoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const parseIsoDateOrToday = (isoDate?: string | null): Date => {
  if (isoDate) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const parsed = new Date(year, (month || 1) - 1, day || 1);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
};

const parseRecordCreatedAt = (record: PrescriptionRecord): Date | null => {
  const createdAt = new Date(record.createdAt);
  return Number.isNaN(createdAt.getTime()) ? null : createdAt;
};

const hasParsedCreatedAt = (entry: {
  record: PrescriptionRecord;
  createdAt: Date | null;
}): entry is { record: PrescriptionRecord; createdAt: Date } => entry.createdAt !== null;

export const collectMonthlyPrescriptionExport = (
  records: PrescriptionRecord[],
  selectedDateIso?: string | null
): MonthlyPrescriptionPdfScope => {
  const selectedDate = parseIsoDateOrToday(selectedDateIso);
  const selectedYear = selectedDate.getFullYear();
  const selectedMonth = selectedDate.getMonth();
  const startIso = toLocalIsoDay(new Date(selectedYear, selectedMonth, 1));

  const monthlyRecords = records
    .map(record => ({ record, createdAt: parseRecordCreatedAt(record) }))
    .filter(hasParsedCreatedAt)
    .filter(
      entry =>
        entry.createdAt.getFullYear() === selectedYear &&
        entry.createdAt.getMonth() === selectedMonth
    )
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  const lastAvailableDate =
    monthlyRecords.at(-1)?.createdAt ?? new Date(selectedYear, selectedMonth, 1);

  return {
    records: monthlyRecords.map(entry => entry.record),
    startIso,
    endIso: toLocalIsoDay(lastAvailableDate),
  };
};

export const buildMonthlyPrescriptionPdfFileName = ({
  startIso,
  endIso,
}: MonthlyPrescriptionPdfFileNameParams): string =>
  `recetas-hospitalizados-${startIso}-a-${endIso}.pdf`;

const normalizeOptions = (
  options?: Partial<PrescriptionMonthlyPdfOptions>
): PrescriptionMonthlyPdfOptions => ({
  prescriptionsPerPage:
    options?.prescriptionsPerPage ?? DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS.prescriptionsPerPage,
  colorMode: options?.colorMode ?? DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS.colorMode,
  imageQuality: options?.imageQuality ?? DEFAULT_PRESCRIPTION_MONTHLY_PDF_OPTIONS.imageQuality,
});

const resolveImageStoragePath = (record: PrescriptionRecord): string => record.image.storagePath;

const mapWithConcurrency = async <TItem, TResult>(
  items: TItem[],
  limit: number,
  mapper: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> => {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

const buildOptimizedPrescriptionImageUrl = (
  downloadUrl: string,
  imageQuality: PrescriptionMonthlyPdfImageQuality
): string => {
  const preset = PRESCRIPTION_PDF_IMAGE_QUALITY_PRESETS[imageQuality];
  if (!preset) return downloadUrl;

  const params = new URLSearchParams({
    url: downloadUrl,
    w: String(preset.width),
    q: String(preset.quality),
  });
  return `/.netlify/functions/prescription-image-proxy?${params.toString()}`;
};

const resolvePrintableImageAsset = async (
  downloadUrl: string,
  imageQuality: PrescriptionMonthlyPdfImageQuality
): Promise<PrintablePrescriptionImageAsset> => {
  const preset = PRESCRIPTION_PDF_IMAGE_QUALITY_PRESETS[imageQuality];
  if (!preset) {
    return { optimizationFallback: false, url: downloadUrl };
  }

  try {
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(
      () => abortController.abort(),
      IMAGE_PROXY_REQUEST_TIMEOUT_MS
    );
    const proxyUrl = buildOptimizedPrescriptionImageUrl(downloadUrl, imageQuality);
    const proxyResponse = await Promise.resolve()
      .then(() =>
        fetch(proxyUrl, {
          signal: abortController.signal,
        })
      )
      .finally(() => window.clearTimeout(timeoutId));
    if (!proxyResponse.ok) {
      return { optimizationFallback: true, url: downloadUrl };
    }

    const blob = await proxyResponse.blob();
    const objectUrl = URL.createObjectURL(blob);
    return {
      optimizationFallback:
        proxyResponse.headers.get('X-Prescription-Image-Optimization') === 'fallback',
      revoke: () => URL.revokeObjectURL(objectUrl),
      url: objectUrl,
    };
  } catch {
    return { optimizationFallback: true, url: downloadUrl };
  }
};

export const exportMonthlyPrescriptionsPdf = async ({
  records,
  selectedDateIso,
  options,
}: ExportMonthlyPrescriptionsPdfParams): Promise<ExportMonthlyPrescriptionsPdfResult> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('La generación de PDF mensual requiere un navegador.');
  }

  const scope = collectMonthlyPrescriptionExport(records, selectedDateIso);
  if (scope.records.length === 0) {
    throw new Error('No hay recetas registradas para el mes seleccionado.');
  }

  document.getElementById(PRESCRIPTION_MONTHLY_PRINT_ROOT_ID)?.remove();
  document.getElementById(PRESCRIPTION_MONTHLY_PRINT_STYLE_ID)?.remove();

  const resolvedOptions = normalizeOptions(options);
  const imageAssets = await mapWithConcurrency(
    scope.records,
    IMAGE_PROXY_MAX_CONCURRENT_REQUESTS,
    async record => {
      const downloadUrl = await resolvePrescriptionImageDownloadUrl(
        resolveImageStoragePath(record)
      );
      return resolvePrintableImageAsset(downloadUrl, resolvedOptions.imageQuality);
    }
  );
  const imageUrls = imageAssets.map(asset => asset.url);
  const optimizationFallbackCount = imageAssets.filter(asset => asset.optimizationFallback).length;
  const { root, style } = createPrescriptionMonthlyPrintDocument({
    imageUrls,
    options: resolvedOptions,
    scope,
  });

  const fileName = buildMonthlyPrescriptionPdfFileName(scope);
  const originalTitle = document.title;
  document.title = fileName;
  document.head.append(style);
  document.body.append(root);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    root.remove();
    style.remove();
    imageAssets.forEach(asset => asset.revoke?.());
    document.title = originalTitle;
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, PRINT_CLEANUP_TIMEOUT_MS);
  await waitForPrescriptionMonthlyPrintImages(root);
  window.setTimeout(() => {
    window.print();
  }, PRINT_TRIGGER_DELAY_MS);

  return { exportedCount: scope.records.length, fileName, optimizationFallbackCount };
};
