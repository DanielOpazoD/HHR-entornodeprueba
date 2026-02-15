import type { DailyRecord, ShiftType } from '@/types';

interface HandoffTitleParams {
  isMedical: boolean;
  selectedShift: ShiftType;
}

export const resolveHandoffTitle = ({ isMedical, selectedShift }: HandoffTitleParams): string =>
  isMedical
    ? 'Entrega Turno Médicos'
    : `Entrega Turno Enfermería - ${selectedShift === 'day' ? 'Día' : 'Noche'} `;

export const resolveHandoffTableHeaderClass = ({
  isMedical,
  selectedShift,
}: HandoffTitleParams): string => {
  if (isMedical) {
    return 'bg-sky-100 text-sky-900 text-xs uppercase tracking-wider font-semibold border-b border-sky-100';
  }

  return selectedShift === 'day'
    ? 'bg-medical-50 text-medical-900 text-xs uppercase tracking-wider font-semibold border-b border-medical-100'
    : 'bg-slate-100 text-slate-800 text-xs uppercase tracking-wider font-semibold border-b border-slate-200';
};

interface ResolveHandoffDocumentTitleParams {
  isMedical: boolean;
  selectedShift: ShiftType;
  recordDate?: string;
}

export const resolveHandoffDocumentTitle = ({
  isMedical,
  selectedShift,
  recordDate,
}: ResolveHandoffDocumentTitleParams): string | null => {
  if (!recordDate) return null;

  const [year, month, day] = recordDate.split('-');
  if (!year || !month || !day) return null;

  const formattedDate = `${day}-${month}-${year}`;
  if (isMedical) return `Entrega Medico ${formattedDate}`;
  return `${selectedShift === 'day' ? 'TL' : 'TN'} ${formattedDate}`;
};

interface ResolveHandoffNovedadesValueParams {
  isMedical: boolean;
  selectedShift: ShiftType;
  record: Pick<
    DailyRecord,
    'medicalHandoffNovedades' | 'handoffNovedadesDayShift' | 'handoffNovedadesNightShift'
  >;
}

export const resolveHandoffNovedadesValue = ({
  isMedical,
  selectedShift,
  record,
}: ResolveHandoffNovedadesValueParams): string => {
  if (isMedical) return record.medicalHandoffNovedades || '';

  if (selectedShift === 'day') return record.handoffNovedadesDayShift || '';

  return record.handoffNovedadesNightShift || record.handoffNovedadesDayShift || '';
};

export const shouldShowNightCudyrActions = ({
  isMedical,
  selectedShift,
}: HandoffTitleParams): boolean => !isMedical && selectedShift === 'night';
