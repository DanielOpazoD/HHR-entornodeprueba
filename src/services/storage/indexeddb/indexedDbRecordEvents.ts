import {
  broadcastDailyRecordStoreChanged,
  onSyncBroadcastMessage,
} from '@/services/storage/sync/syncBroadcastChannel';

export const DAILY_RECORD_STORE_CHANGED_EVENT = 'daily-record-store-changed';

export interface DailyRecordStoreChangedEventDetail {
  dates?: string[];
  operation: 'save' | 'delete' | 'clear';
}

const buildMonthPrefix = (year: number, monthOneBased: number): string =>
  `${year}-${String(monthOneBased).padStart(2, '0')}-`;

const dispatchDailyRecordStoreChangedLocal = (detail: DailyRecordStoreChangedEventDetail): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DailyRecordStoreChangedEventDetail>(DAILY_RECORD_STORE_CHANGED_EVENT, {
      detail,
    })
  );
};

export const dispatchDailyRecordStoreChanged = (
  detail: DailyRecordStoreChangedEventDetail
): void => {
  dispatchDailyRecordStoreChangedLocal(detail);
  broadcastDailyRecordStoreChanged(detail);
};

onSyncBroadcastMessage(message => {
  if (message.type !== 'DAILY_RECORD_STORE_CHANGED') {
    return;
  }
  dispatchDailyRecordStoreChangedLocal(message.detail);
});

export const isDailyRecordStoreChangeRelevantToMonth = (
  detail: DailyRecordStoreChangedEventDetail | undefined,
  year: number,
  monthOneBased: number
): boolean => {
  if (!detail) {
    return true;
  }

  if (detail.operation === 'clear') {
    return true;
  }

  const monthPrefix = buildMonthPrefix(year, monthOneBased);
  return (detail.dates ?? []).some(date => date.startsWith(monthPrefix));
};

export const isDailyRecordStoreChangeRelevantToRange = (
  detail: DailyRecordStoreChangedEventDetail | undefined,
  startDate: string,
  endDate: string
): boolean => {
  if (!detail) {
    return true;
  }

  if (detail.operation === 'clear') {
    return true;
  }

  if (!detail.dates || detail.dates.length === 0) {
    return true;
  }

  return detail.dates.some(date => date >= startDate && date <= endDate);
};

export const isDailyRecordStoreChangeRelevantToCensusPrompt = (
  detail: DailyRecordStoreChangedEventDetail | undefined,
  currentDateString: string
): boolean => {
  if (!detail) {
    return true;
  }

  if (detail.operation === 'clear') {
    return true;
  }

  if (!detail.dates || detail.dates.length === 0) {
    return true;
  }

  return detail.dates.some(date => date !== currentDateString);
};
