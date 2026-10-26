import { isVacancySelection } from '@/services/staff/staffSelectionPresentation';

type StaffSelectionSlotTone = 'day' | 'night';

interface BuildStaffSelectionSelectClassNameParams {
  baseClassName: string;
  selectionValue: string | null | undefined;
  tone: StaffSelectionSlotTone;
}

const TONE_BACKGROUND_CLASSES: Record<StaffSelectionSlotTone, string> = {
  day: 'bg-indigo-50/50',
  night: 'bg-slate-100/50',
};

const TONE_FOCUS_RING_CLASSES: Record<StaffSelectionSlotTone, string> = {
  day: 'focus:ring-indigo-500',
  night: 'focus:ring-slate-500',
};

const VACANCY_CLASSES = 'rounded-md bg-slate-100 text-slate-600 border-slate-300 shadow-none';

export const buildStaffSelectionSelectClassName = ({
  baseClassName,
  selectionValue,
  tone,
}: BuildStaffSelectionSelectClassNameParams): string => {
  return isVacancySelection(selectionValue)
    ? `${baseClassName} ${VACANCY_CLASSES}`
    : `${baseClassName} rounded-md ${TONE_BACKGROUND_CLASSES[tone]} ${TONE_FOCUS_RING_CLASSES[tone]}`;
};
