import type { VitalStatus } from '@/features/census/controllers/vitalSignsView';

/** One severity tone per vital status, so the census cell and its detail read the same. */
export const VITAL_STATUS_TEXT: Record<VitalStatus, string> = {
  neutral: 'text-slate-500',
  normal: 'text-slate-600',
  warn: 'text-amber-600',
  alert: 'text-red-600',
};

/** Reading cards in the detail: a tinted card for a value to review or to act on. */
export const VITAL_STATUS_CARD: Record<VitalStatus, string> = {
  neutral: 'border-slate-200 bg-slate-50',
  normal: 'border-slate-200 bg-slate-50',
  warn: 'border-amber-200 bg-amber-50',
  alert: 'border-red-200 bg-red-50',
};
