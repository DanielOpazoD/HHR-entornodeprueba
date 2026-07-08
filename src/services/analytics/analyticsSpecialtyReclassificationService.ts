import { httpsCallable } from 'firebase/functions';

import {
  getActiveHospitalId,
  getAnalyticsSpecialtyReclassificationsPath,
} from '@/constants/firestorePaths';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import type {
  AnalyticsSpecialtyReclassificationRecord,
  MinsalMovementKind,
  SpecialtyReclassification,
} from '@/types/minsalTypes';

export interface SaveAnalyticsSpecialtyReclassificationRequest {
  date: string;
  movementKind: MinsalMovementKind;
  movementId: string;
  reportingSpecialty: string | null;
  hospitalId?: string;
}

const E2E_CAPTURE_FLAG = 'hhr_e2e_capture_analytics_reclassifications';
const E2E_RECLASSIFICATIONS_KEY = 'hhr_e2e_analytics_reclassifications';
const E2E_CALLS_KEY = 'hhr_e2e_analytics_reclassification_calls';

const isE2EAnalyticsReclassificationCaptureEnabled = (): boolean =>
  typeof window !== 'undefined' &&
  isE2ERuntimeEnabled() &&
  window.localStorage.getItem(E2E_CAPTURE_FLAG) === 'true';

const readE2EReclassifications = (): SpecialtyReclassification[] => {
  if (!isE2EAnalyticsReclassificationCaptureEnabled()) {
    return [];
  }

  try {
    return JSON.parse(window.localStorage.getItem(E2E_RECLASSIFICATIONS_KEY) || '[]');
  } catch {
    return [];
  }
};

const writeE2EReclassifications = (items: SpecialtyReclassification[]): void => {
  window.localStorage.setItem(E2E_RECLASSIFICATIONS_KEY, JSON.stringify(items));
};

const recordE2EReclassificationCall = (
  payload: Required<SaveAnalyticsSpecialtyReclassificationRequest>
): void => {
  const calls = JSON.parse(window.localStorage.getItem(E2E_CALLS_KEY) || '[]');
  calls.push(payload);
  window.localStorage.setItem(E2E_CALLS_KEY, JSON.stringify(calls));
};

const persistE2EReclassification = (
  payload: Required<SaveAnalyticsSpecialtyReclassificationRequest>
): void => {
  const current = readE2EReclassifications();
  const withoutCurrent = current.filter(
    item =>
      item.date !== payload.date ||
      item.movementKind !== payload.movementKind ||
      item.movementId !== payload.movementId
  );

  if (!payload.reportingSpecialty) {
    writeE2EReclassifications(withoutCurrent);
    return;
  }

  writeE2EReclassifications([
    ...withoutCurrent,
    {
      date: payload.date,
      movementKind: payload.movementKind,
      movementId: payload.movementId,
      specialty: payload.reportingSpecialty,
      updatedAt: new Date().toISOString(),
      updatedBy: 'E2E',
    },
  ]);
};

const toSpecialtyReclassification = (
  record: AnalyticsSpecialtyReclassificationRecord
): SpecialtyReclassification | null => {
  if (!record.active || !record.reportingSpecialty) {
    return null;
  }

  return {
    date: record.date,
    movementKind: record.movementKind,
    movementId: record.movementId,
    specialty: record.reportingSpecialty,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedByEmail || record.updatedByName || record.updatedByUid || undefined,
  };
};

export const fetchAnalyticsSpecialtyReclassifications = async (
  startDate: string,
  endDate: string,
  hospitalId: string = getActiveHospitalId(),
  database: Pick<IDatabaseProvider, 'getDocs'> = firestoreDb
): Promise<SpecialtyReclassification[]> => {
  if (isE2EAnalyticsReclassificationCaptureEnabled()) {
    return readE2EReclassifications().filter(
      item => !item.date || (item.date >= startDate && item.date <= endDate)
    );
  }

  const records = await database.getDocs<AnalyticsSpecialtyReclassificationRecord>(
    getAnalyticsSpecialtyReclassificationsPath(hospitalId),
    {
      where: [
        { field: 'date', operator: '>=', value: startDate },
        { field: 'date', operator: '<=', value: endDate },
      ],
      orderBy: [{ field: 'date', direction: 'asc' }],
    }
  );

  return records
    .map(toSpecialtyReclassification)
    .filter((item): item is SpecialtyReclassification => item !== null);
};

export const saveAnalyticsSpecialtyReclassification = async ({
  hospitalId = getActiveHospitalId(),
  date,
  movementKind,
  movementId,
  reportingSpecialty,
}: SaveAnalyticsSpecialtyReclassificationRequest): Promise<void> => {
  const payload: Required<SaveAnalyticsSpecialtyReclassificationRequest> = {
    hospitalId,
    date,
    movementKind,
    movementId,
    reportingSpecialty: reportingSpecialty || null,
  };

  if (isE2EAnalyticsReclassificationCaptureEnabled()) {
    recordE2EReclassificationCall(payload);
    persistE2EReclassification(payload);
    return;
  }

  const functions = await defaultFunctionsRuntime.getFunctions();
  const setReclassification = httpsCallable(functions, 'setMinsalSpecialtyReclassification');
  await setReclassification(payload);
};
