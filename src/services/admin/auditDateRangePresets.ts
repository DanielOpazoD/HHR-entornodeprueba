export type AuditDateRangePreset = 'all' | 'current_month' | 'last_3_months' | 'current_year';

export interface AuditDateRangePresetOption {
  id: AuditDateRangePreset;
  label: string;
}

export interface AuditDateRange {
  startDate: string;
  endDate: string;
}

export const AUDIT_DATE_RANGE_PRESETS: AuditDateRangePresetOption[] = [
  { id: 'all', label: 'Todo histórico' },
  { id: 'current_month', label: 'Mes actual' },
  { id: 'last_3_months', label: 'Últimos 3 meses' },
  { id: 'current_year', label: 'Año actual' },
];

const toDateInputValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export const resolveAuditDateRangePreset = (
  preset: AuditDateRangePreset,
  now = new Date()
): AuditDateRange => {
  const endDate = toDateInputValue(now);

  if (preset === 'all') {
    return { startDate: '', endDate: '' };
  }

  if (preset === 'current_month') {
    return {
      startDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate,
    };
  }

  if (preset === 'last_3_months') {
    return {
      startDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
      endDate,
    };
  }

  return {
    startDate: toDateInputValue(new Date(now.getFullYear(), 0, 1)),
    endDate,
  };
};
