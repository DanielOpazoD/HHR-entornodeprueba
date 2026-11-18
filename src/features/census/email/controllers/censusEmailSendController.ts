import { buildCensusEmailBody } from '@/constants/email';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';

interface BuildConfirmationTextParams {
  currentDateString: string;
  recipients: string[];
  shouldUseTestMode: boolean;
  formatDate: (date: string) => string;
}

export const buildCensusEmailConfirmationText = ({
  currentDateString,
  recipients,
  shouldUseTestMode,
  formatDate,
}: BuildConfirmationTextParams): string =>
  [
    `Enviar correo de censo del ${formatDate(currentDateString)}?`,
    `Destinatarios: ${recipients.join(', ')}`,
    shouldUseTestMode ? '(Modo prueba activo - solo se enviará al destinatario indicado)' : '',
    '',
    '¿Confirmas el envío?',
  ]
    .filter(Boolean)
    .join('\n');

export const resolveFinalCensusEmailMessage = ({
  message,
  currentDateString,
  nurseSignature,
}: {
  message: string;
  currentDateString: string;
  nurseSignature: string;
}): string => (message?.trim() ? message : buildCensusEmailBody(currentDateString, nurseSignature));

const toIsoDate = (year: number, monthOneBased: number, day: number): string =>
  `${year}-${String(monthOneBased).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export const buildMonthIntegrityDates = ({
  year,
  monthZeroBased,
  day,
}: {
  year: number;
  monthZeroBased: number;
  day: number;
}): string[] => {
  const monthOneBased = monthZeroBased + 1;
  const dates: string[] = [];

  for (let currentDay = 1; currentDay <= day; currentDay += 1) {
    dates.push(toIsoDate(year, monthOneBased, currentDay));
  }

  return dates;
};

export const resolveMonthRecordsForDelivery = ({
  monthRecords,
  currentRecord,
  currentDateString,
  selectedYear,
  selectedMonth,
  selectedDay,
}: {
  monthRecords: CensusExportRecord[];
  currentRecord: CensusExportRecord | null;
  currentDateString: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
}): CensusExportRecord[] => {
  const limitDate = toIsoDate(selectedYear, selectedMonth + 1, selectedDay);

  const filteredRecords = monthRecords
    .filter(record => record.date <= limitDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!filteredRecords.some(record => record.date === currentDateString) && currentRecord) {
    filteredRecords.push(currentRecord);
  }

  if (filteredRecords.length === 0) {
    throw new Error('No hay registros del mes para generar el Excel maestro.');
  }

  filteredRecords.sort((a, b) => a.date.localeCompare(b.date));
  return filteredRecords;
};
