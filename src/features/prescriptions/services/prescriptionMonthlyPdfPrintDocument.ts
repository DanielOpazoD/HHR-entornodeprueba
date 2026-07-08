import {
  PRESCRIPTION_ASSIGNMENT_SCOPE_LABELS,
  PRESCRIPTION_TYPE_LABELS,
  resolvePrescriptionAssignmentScope,
  type PrescriptionRecord,
} from '@/types/prescriptionTypes';
import type {
  PrescriptionMonthlyPdfColorMode,
  PrescriptionMonthlyPdfImageQuality,
  PrescriptionsPerPageOption,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfTypes';

export const PRESCRIPTION_MONTHLY_PRINT_ROOT_ID = 'prescription-monthly-print-root';
export const PRESCRIPTION_MONTHLY_PRINT_STYLE_ID = 'prescription-monthly-print-style';

const IMAGE_LOAD_TIMEOUT_MS = 8_000;

interface MonthlyPrescriptionPdfScope {
  records: PrescriptionRecord[];
  startIso: string;
  endIso: string;
}

interface PrescriptionMonthlyPdfResolvedOptions {
  prescriptionsPerPage: PrescriptionsPerPageOption;
  colorMode: PrescriptionMonthlyPdfColorMode;
  imageQuality: PrescriptionMonthlyPdfImageQuality;
}

interface CreatePrescriptionMonthlyPrintDocumentParams {
  imageUrls: string[];
  options: PrescriptionMonthlyPdfResolvedOptions;
  scope: MonthlyPrescriptionPdfScope;
}

const formatIsoDayForDisplay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-');
  if (!year || !month || !day) return isoDay;
  return `${day}-${month}-${year}`;
};

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}-${month}-${year} ${hour}:${minute}`;
};

const describeRecord = (record: PrescriptionRecord): string => {
  const assignmentScope = resolvePrescriptionAssignmentScope(record);
  if (assignmentScope === 'hospitalized_stock') {
    return PRESCRIPTION_ASSIGNMENT_SCOPE_LABELS.hospitalized_stock;
  }
  if (assignmentScope === 'unassigned') {
    return PRESCRIPTION_ASSIGNMENT_SCOPE_LABELS.unassigned;
  }
  return [record.bedId, record.patientName, record.patientRut].filter(Boolean).join(' · ');
};

const chunkRecords = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const waitForImage = (image: HTMLImageElement): Promise<void> => {
  if (image.complete) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const timeout = window.setTimeout(resolve, IMAGE_LOAD_TIMEOUT_MS);
    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
  });
};

const createPrintStyle = (): HTMLStyleElement => {
  const style = document.createElement('style');
  style.id = PRESCRIPTION_MONTHLY_PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body > :not(#${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}) { display: none !important; }
      #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID} {
        position: static !important;
        left: auto !important;
        top: auto !important;
        width: auto !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
    }
    @page { size: A4; margin: 10mm; }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID} {
      position: fixed;
      left: -10000px;
      top: 0;
      width: 210mm;
      opacity: 0;
      pointer-events: none;
      background: white;
      color: #0f172a;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .prescription-monthly-page {
      break-after: page;
      page-break-after: always;
      height: 276mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: hidden;
    }
    .prescription-monthly-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .prescription-monthly-header {
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 8px;
    }
    .prescription-monthly-title {
      font-size: 16px;
      font-weight: 800;
      margin: 0 0 4px;
    }
    .prescription-monthly-meta {
      color: #475569;
      font-size: 11px;
      margin: 0;
    }
    .prescription-monthly-grid {
      flex: 1;
      display: grid;
      gap: 10px;
      min-height: 0;
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-prescriptions-per-page="1"] .prescription-monthly-grid {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr;
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-prescriptions-per-page="2"] .prescription-monthly-grid {
      grid-template-columns: 1fr;
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-prescriptions-per-page="4"] .prescription-monthly-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-prescriptions-per-page="6"] .prescription-monthly-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(3, minmax(0, 1fr));
    }
    .prescription-monthly-card {
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 6px;
      overflow: hidden;
    }
    .prescription-monthly-card-meta {
      color: #475569;
      font-size: 9px;
      line-height: 1.25;
      margin: 0;
    }
    .prescription-monthly-image-wrap {
      min-height: 0;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .prescription-monthly-image {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-color-mode="grayscale"] {
      filter: grayscale(1) contrast(1.12) !important;
      -webkit-filter: grayscale(1) contrast(1.12) !important;
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-color-mode="grayscale"] .prescription-monthly-image {
      filter: grayscale(1) contrast(1.12) !important;
      -webkit-filter: grayscale(1) contrast(1.12) !important;
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-image-quality="reduced"] .prescription-monthly-image {
      max-width: 92%;
      max-height: 92%;
    }
    #${PRESCRIPTION_MONTHLY_PRINT_ROOT_ID}[data-image-quality="compact"] .prescription-monthly-image {
      max-width: 84%;
      max-height: 84%;
    }
  `;
  return style;
};

const createPrescriptionCard = (
  record: PrescriptionRecord,
  imageUrl: string,
  index: number
): HTMLElement => {
  const card = document.createElement('section');
  card.className = 'prescription-monthly-card';
  const type = document.createElement('p');
  type.className = 'prescription-monthly-card-meta';
  type.textContent = PRESCRIPTION_TYPE_LABELS[record.prescriptionType];

  const patient = document.createElement('p');
  patient.className = 'prescription-monthly-card-meta';
  patient.textContent = `${index + 1}. ${
    describeRecord(record) || 'Sin paciente asignado'
  } · ${formatDateTime(record.createdAt)}`;

  const imageWrap = document.createElement('div');
  imageWrap.className = 'prescription-monthly-image-wrap';

  const image = document.createElement('img');
  image.className = 'prescription-monthly-image';
  image.src = imageUrl;
  image.alt = `Receta ${index + 1}`;
  image.loading = 'eager';

  card.append(type, patient, imageWrap);
  imageWrap.append(image);
  return card;
};

const createPrescriptionPage = (
  records: PrescriptionRecord[],
  imageUrls: string[],
  pageIndex: number,
  pageCount: number,
  pageStartIndex: number,
  scope: MonthlyPrescriptionPdfScope
): HTMLElement => {
  const page = document.createElement('article');
  page.className = 'prescription-monthly-page';

  const header = document.createElement('header');
  header.className = 'prescription-monthly-header';

  const title = document.createElement('h1');
  title.className = 'prescription-monthly-title';
  title.textContent = 'Recetas Hospitalizados';

  const range = document.createElement('p');
  range.className = 'prescription-monthly-meta';
  range.textContent = `${formatIsoDayForDisplay(scope.startIso)} a ${formatIsoDayForDisplay(
    scope.endIso
  )} · página ${pageIndex + 1} de ${pageCount}`;

  const grid = document.createElement('div');
  grid.className = 'prescription-monthly-grid';
  records.forEach((record, index) => {
    grid.append(createPrescriptionCard(record, imageUrls[index] ?? '', pageStartIndex + index));
  });

  header.append(title, range);
  page.append(header, grid);
  return page;
};

export const createPrescriptionMonthlyPrintDocument = ({
  imageUrls,
  options,
  scope,
}: CreatePrescriptionMonthlyPrintDocumentParams): {
  root: HTMLElement;
  style: HTMLStyleElement;
} => {
  const root = document.createElement('section');
  root.id = PRESCRIPTION_MONTHLY_PRINT_ROOT_ID;
  root.dataset.prescriptionsPerPage = String(options.prescriptionsPerPage);
  root.dataset.colorMode = options.colorMode;
  root.dataset.imageQuality = options.imageQuality;

  const recordPages = chunkRecords(scope.records, options.prescriptionsPerPage);
  recordPages.forEach((pageRecords, pageIndex) => {
    const pageStartIndex = pageIndex * options.prescriptionsPerPage;
    root.append(
      createPrescriptionPage(
        pageRecords,
        imageUrls.slice(pageStartIndex, pageStartIndex + pageRecords.length),
        pageIndex,
        recordPages.length,
        pageStartIndex,
        scope
      )
    );
  });

  return { root, style: createPrintStyle() };
};

export const waitForPrescriptionMonthlyPrintImages = (root: HTMLElement): Promise<unknown[]> =>
  Promise.allSettled(Array.from(root.querySelectorAll('img')).map(waitForImage));
