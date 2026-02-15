import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowContracts';

const MENU_ALIGN_BOTTOM_THRESHOLD = 4;

export const resolvePatientRowMenuAlign = (index: number, totalRows: number): RowMenuAlign => {
  return index >= totalRows - MENU_ALIGN_BOTTOM_THRESHOLD ? 'bottom' : 'top';
};

export const shouldRenderEmptyBedsDivider = (emptyBedsCount: number): boolean => emptyBedsCount > 0;
