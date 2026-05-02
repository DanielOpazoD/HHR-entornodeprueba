import type { TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';
import {
  isSameTransferOperationalMonth,
  resolveTransferMonthKeyFromDate,
} from '@/shared/transfers/transferOperationalPeriod';

export const parseTransferDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    return requestInPeriod;
  }

  const latestStatusDate = parseTransferDate(transfer.statusHistory.at(-1)?.timestamp);
  const closedInPeriod = latestStatusDate
    ? latestStatusDate >= selectedPeriodStart && latestStatusDate <= selectedPeriodEnd
    : false;

  return requestInPeriod || closedInPeriod;
};
