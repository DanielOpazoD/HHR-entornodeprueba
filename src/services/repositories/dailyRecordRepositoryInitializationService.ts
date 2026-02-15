import { BedType, DailyRecord, PatientData } from '@/types';
import { BEDS } from '@/constants';
import { getRecordFromFirestore } from '@/services/storage/firestoreService';
import { getLegacyRecord } from '@/services/storage/legacyFirebaseService';
import { saveRecord as saveToIndexedDB } from '@/services/storage/indexedDBService';
import { isDemoModeActive, isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { clonePatient, createEmptyPatient } from '@/services/factories/patientFactory';
import { getForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { save } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { migrateLegacyData } from '@/services/repositories/dataMigration';

export const initializeDay = async (date: string, copyFromDate?: string): Promise<DailyRecord> => {
  const existing = await getForDate(date);
  if (existing) return existing;

  if (!isDemoModeActive() && isFirestoreEnabled()) {
    try {
      const remoteRecord = await getRecordFromFirestore(date);
      if (remoteRecord) {
        const migrated = migrateLegacyData(remoteRecord, date);
        await saveToIndexedDB(migrated);
        return migrated;
      }

      const legacyRecord = await getLegacyRecord(date);
      if (legacyRecord) {
        const migrated = migrateLegacyData(legacyRecord, date);
        await saveToIndexedDB(migrated);
        return migrated;
      }
    } catch (err) {
      console.warn(`[Repository] Failed to check remote sources for ${date} during init:`, err);
    }
  }

  const initialBeds: Record<string, PatientData> = {};
  let activeExtras: string[] = [];
  let initialOverrides: Record<string, BedType> = {};

  BEDS.forEach(bed => {
    initialBeds[bed.id] = createEmptyPatient(bed.id);
  });

  let nursesDay: string[] = ['', ''];
  const nursesNight: string[] = ['', ''];
  let tensDay: string[] = ['', '', ''];
  const tensNight: string[] = ['', '', ''];

  const prevRecord = copyFromDate ? await getForDate(copyFromDate) : null;

  if (prevRecord) {
    const prevBeds = prevRecord.beds;

    const isNightShiftEmpty =
      !prevRecord.nursesNightShift || prevRecord.nursesNightShift.every(n => !n);
    const prevNurses = !isNightShiftEmpty
      ? prevRecord.nursesNightShift
      : prevRecord.nurses || ['', ''];

    nursesDay = [...(prevNurses || ['', ''])];
    while (nursesDay.length < 2) nursesDay.push('');
    nursesDay = nursesDay.slice(0, 2);

    const isNightTensEmpty = !prevRecord.tensNightShift || prevRecord.tensNightShift.every(t => !t);
    const rawTens = !isNightTensEmpty
      ? prevRecord.tensNightShift!
      : prevRecord.tensDayShift || ['', '', ''];

    tensDay = [...rawTens];
    while (tensDay.length < 3) tensDay.push('');
    tensDay = tensDay.slice(0, 3);

    activeExtras = [...(prevRecord.activeExtraBeds || [])];
    initialOverrides = { ...(prevRecord.bedTypeOverrides || {}) };

    BEDS.forEach(bed => {
      const prevPatient = prevBeds[bed.id];
      if (prevPatient) {
        if (
          prevPatient.patientName ||
          prevPatient.isBlocked ||
          prevPatient.cie10Code ||
          prevPatient.cie10Description ||
          prevPatient.pathology ||
          prevPatient.diagnosisComments
        ) {
          initialBeds[bed.id] = clonePatient(prevPatient);

          initialBeds[bed.id].cudyr = undefined;

          if (initialBeds[bed.id].clinicalCrib) {
            initialBeds[bed.id].clinicalCrib!.cudyr = undefined;
          }

          const prevNightNote = prevPatient.handoffNoteNightShift || prevPatient.handoffNote || '';
          initialBeds[bed.id].handoffNoteDayShift = prevNightNote;
          initialBeds[bed.id].handoffNoteNightShift = prevNightNote;

          if (initialBeds[bed.id].clinicalCrib && prevPatient.clinicalCrib) {
            const cribPrevNight =
              prevPatient.clinicalCrib.handoffNoteNightShift ||
              prevPatient.clinicalCrib.handoffNote ||
              '';
            initialBeds[bed.id].clinicalCrib!.handoffNoteDayShift = cribPrevNight;
            initialBeds[bed.id].clinicalCrib!.handoffNoteNightShift = cribPrevNight;
          }
        } else {
          initialBeds[bed.id].bedMode = prevPatient.bedMode || initialBeds[bed.id].bedMode;
          initialBeds[bed.id].hasCompanionCrib = prevPatient.hasCompanionCrib || false;
        }
        if (prevPatient.location && bed.isExtra) {
          initialBeds[bed.id].location = prevPatient.location;
        }
      }
    });
  }

  const dateObj = new Date(`${date}T00:00:00`);
  const newRecord: DailyRecord = {
    date,
    beds: initialBeds,
    discharges: [],
    transfers: [],
    cma: [],
    bedTypeOverrides: initialOverrides,
    lastUpdated: new Date().toISOString(),
    dateTimestamp: dateObj.getTime(),
    nurses: ['', ''],
    nursesDayShift: nursesDay,
    nursesNightShift: nursesNight,
    tensDayShift: tensDay,
    tensNightShift: tensNight,
    activeExtraBeds: activeExtras,
    handoffNovedadesDayShift: prevRecord
      ? prevRecord.handoffNovedadesNightShift || prevRecord.handoffNovedadesDayShift || ''
      : '',
  };

  await save(newRecord);
  return newRecord;
};

export const copyPatientToDate = async (
  sourceDate: string,
  sourceBedId: string,
  targetDate: string,
  targetBedId: string
): Promise<void> => {
  const sourceRecord = await getForDate(sourceDate);
  if (!sourceRecord) throw new Error(`Source record for ${sourceDate} not found`);

  const sourcePatient = sourceRecord.beds[sourceBedId];
  if (!sourcePatient || !sourcePatient.patientName) {
    throw new Error(`No patient found in bed ${sourceBedId} on ${sourceDate}`);
  }

  let targetRecord = await getForDate(targetDate);
  if (!targetRecord) {
    targetRecord = await initializeDay(targetDate);
  }

  const clonedPatient = clonePatient(sourcePatient);
  clonedPatient.cudyr = undefined;
  if (clonedPatient.clinicalCrib) {
    clonedPatient.clinicalCrib.cudyr = undefined;
  }

  const nightNote = sourcePatient.handoffNoteNightShift || sourcePatient.handoffNote || '';
  clonedPatient.handoffNoteDayShift = nightNote;
  clonedPatient.handoffNoteNightShift = nightNote;

  targetRecord.beds[targetBedId] = clonedPatient;
  targetRecord.lastUpdated = new Date().toISOString();

  await save(targetRecord);
};
