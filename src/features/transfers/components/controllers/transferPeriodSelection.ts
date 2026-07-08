import type { TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';
import {
  isSameTransferOperationalMonth,
  resolveTransferMonthKeyFromDate,
} from '@/shared/transfers/transferOperationalPeriod';

export const parseTransferDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isLastCalendarDayOfMonth = (date: Date): boolean => {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() === lastDay;
};

const isNextCalendarMonth = (from: Date, selectedPeriodStart: Date): boolean => {
  const nextMonthStart = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return (
    selectedPeriodStart.getFullYear() === nextMonthStart.getFullYear() &&
    selectedPeriodStart.getMonth() === nextMonthStart.getMonth()
  );
};

const resolveFinalizedOperationalDate = (transfer: TransferRequest): string | undefined => {
  const executedDate = transfer.customFields?.executedDate;
  if (executedDate) {
    return executedDate;
  }

  if (transfer.customFields?.source === 'census_transfer_autocreate') {
    return transfer.requestDate;
  }

  return transfer.statusHistory.at(-1)?.timestamp;
};

export const collectTransferAvailableYears = ({
  transfers,
  currentYear,
}: {
  transfers: TransferRequest[];
  currentYear: number;
}): number[] =>
  Array.from(
    transfers.reduce((years, transfer) => {
      years.add(currentYear);
      const requestDate = parseTransferDate(transfer.requestDate);
      if (requestDate) years.add(requestDate.getFullYear());
      const latestStatusDate = parseTransferDate(transfer.statusHistory.at(-1)?.timestamp);
      if (latestStatusDate) years.add(latestStatusDate.getFullYear());
      return years;
    }, new Set<number>())
  ).sort((left, right) => right - left);

export const isTransferVisibleInSelectedPeriod = ({
  transfer,
  selectedPeriodStart,
  selectedPeriodEnd,
  closedStatuses,
}: {
  transfer: TransferRequest;
  selectedPeriodStart: Date;
  selectedPeriodEnd: Date;
  closedStatuses: Set<TransferStatus>;
}): boolean => {
  const requestDate = parseTransferDate(transfer.requestDate);
  if (!requestDate) {
    return false;
  }

  const selectedMonthKey = resolveTransferMonthKeyFromDate(selectedPeriodEnd);
  const requestInPeriod = isSameTransferOperationalMonth(transfer.requestDate, selectedMonthKey);
  const isClosed = closedStatuses.has(transfer.status);
  if (!isClosed) {
    return (
      requestInPeriod ||
      (isLastCalendarDayOfMonth(requestDate) &&
        isNextCalendarMonth(requestDate, selectedPeriodStart))
    );
  }

  const finalizedDate = parseTransferDate(resolveFinalizedOperationalDate(transfer));
  const closedInPeriod = finalizedDate
    ? finalizedDate >= selectedPeriodStart && finalizedDate <= selectedPeriodEnd
    : false;

  return closedInPeriod;
};
