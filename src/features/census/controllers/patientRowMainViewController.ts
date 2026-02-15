import clsx from 'clsx';

interface ResolveBedTypeToggleVisibilityParams {
  bedId: string;
  readOnly: boolean;
  isEmpty: boolean;
}

export const shouldShowBedTypeToggle = ({
  bedId,
  readOnly,
  isEmpty,
}: ResolveBedTypeToggleVisibilityParams): boolean => !readOnly && !isEmpty && bedId.startsWith('R');

interface ResolvePatientMainRowClassNameParams {
  isBlocked: boolean;
  patientName?: string;
}

export const resolvePatientMainRowClassName = ({
  isBlocked,
  patientName,
}: ResolvePatientMainRowClassNameParams): string =>
  clsx(
    'group/row relative border-b border-slate-100 transition-all duration-200 ease-in-out',
    'hover:bg-slate-50 hover:shadow-sm hover:z-10',
    isBlocked ? 'bg-slate-50/50' : 'bg-white',
    'text-[12px] leading-tight',
    patientName?.trim() === '' && 'animate-slide-fade-in'
  );

export const resolvePatientMainRowActionsAvailability = (
  data: { patientName?: string; rut?: string } | null | undefined
): {
  canOpenExamRequest: boolean;
  canOpenHistory: boolean;
} => ({
  canOpenExamRequest: Boolean(data?.patientName),
  canOpenHistory: Boolean(data?.rut),
});
