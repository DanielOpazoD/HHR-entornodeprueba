import { DailyRecord, DailyRecordPatch, PatientData } from '@/types';
import { CURRENT_SCHEMA_VERSION } from '@/constants/version';
import {
  getDemoRecordForDate,
  getRecordForDate as getRecordFromIndexedDB,
  saveDemoRecord,
  saveRecord as saveToIndexedDB,
} from '@/services/storage/indexedDBService';
import {
  getRecordFromFirestore,
  saveRecordToFirestore,
  updateRecordPartial as updateRecordPartialToFirestore,
} from '@/services/storage/firestoreService';
import { isDemoModeActive, isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';
import { validateAndSalvageRecord } from '@/services/repositories/helpers/validationHelper';
import { applyPatches } from '@/utils/patchUtils';
import {
  calculateDensity,
  checkRegression,
  DataRegressionError,
  VersionMismatchError,
} from '@/utils/integrityGuard';
import { mapPatientToFhir } from '@/services/utils/fhirMappers';
import { logError } from '@/services/utils/errorService';

export const save = async (record: DailyRecord, expectedLastUpdated?: string): Promise<void> => {
  if (isDemoModeActive()) {
    await saveDemoRecord(record);
    return;
  }

  const recordWithSchemaDefaults = validateAndSalvageRecord(record, record.date);

  if (!recordWithSchemaDefaults.dateTimestamp && recordWithSchemaDefaults.date) {
    const dateObj = new Date(`${recordWithSchemaDefaults.date}T00:00:00`);
    recordWithSchemaDefaults.dateTimestamp = dateObj.getTime();
  }

  const normalized = normalizeDailyRecordInvariants(recordWithSchemaDefaults);
  const validatedRecord = normalized.record;
  if (Object.keys(normalized.patches).length > 0) {
    logError('Invariant repair applied on save', undefined, {
      date: validatedRecord.date,
      patches: Object.keys(normalized.patches),
    });
  }

  Object.keys(validatedRecord.beds).forEach(bedId => {
    const patient = validatedRecord.beds[bedId];
    if (patient && patient.patientName && patient.patientName.trim()) {
      patient.fhir_resource = mapPatientToFhir(patient);
      if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
        patient.clinicalCrib.fhir_resource = mapPatientToFhir(patient.clinicalCrib);
      }
    }
  });

  if (isFirestoreEnabled()) {
    try {
      const remoteRecord = await getRecordFromFirestore(record.date);
      if (remoteRecord) {
        const remoteVersion = remoteRecord.schemaVersion || 0;
        if (remoteVersion > CURRENT_SCHEMA_VERSION) {
          throw new VersionMismatchError(
            `Tu aplicación está desactualizada (v${CURRENT_SCHEMA_VERSION}) y el registro en la nube usa el nuevo formato v${remoteVersion}.`
          );
        }

        const { isSuspicious, dropPercentage } = checkRegression(remoteRecord, validatedRecord);
        if (isSuspicious) {
          throw new DataRegressionError(
            `Se detectó una pérdida masiva de datos (${dropPercentage.toFixed(1)}%). El guardado fue bloqueado.`,
            calculateDensity(validatedRecord),
            calculateDensity(remoteRecord)
          );
        }
      }
    } catch (err) {
      if (err instanceof DataRegressionError || err instanceof VersionMismatchError) throw err;
      console.warn('[Repository] Could not perform integrity check, proceeding:', err);
    }
  }

  validatedRecord.schemaVersion = CURRENT_SCHEMA_VERSION;

  await saveToIndexedDB(validatedRecord);

  if (isFirestoreEnabled()) {
    try {
      await saveRecordToFirestore(validatedRecord, expectedLastUpdated);
    } catch (err) {
      console.warn('Firestore sync failed, data saved in IndexedDB:', err);
      if (
        err instanceof Error &&
        (err.name === 'ConcurrencyError' || err instanceof DataRegressionError)
      ) {
        throw err;
      }
    }
  }

  setTimeout(async () => {
    try {
      const { PatientMasterRepository } =
        await import('@/services/repositories/PatientMasterRepository');
      const patientsToSync: PatientData[] = [];

      Object.values(validatedRecord.beds).forEach(patient => {
        if (patient.patientName?.trim() && patient.rut?.trim()) {
          patientsToSync.push(patient);
        }
        if (patient.clinicalCrib?.patientName?.trim() && patient.clinicalCrib?.rut?.trim()) {
          patientsToSync.push(patient.clinicalCrib);
        }
      });

      if (patientsToSync.length > 0) {
        await Promise.all(
          patientsToSync.map(p =>
            PatientMasterRepository.upsertPatient({
              rut: p.rut!,
              fullName: p.patientName!,
              birthDate: p.birthDate,
              forecast: p.insurance,
              gender: p.biologicalSex,
            })
          )
        );
      }
    } catch (_err) {
      // intentionally ignored (non-critical background sync)
    }
  }, 1000);
};

export const updatePartial = async (date: string, partialData: DailyRecordPatch): Promise<void> => {
  const current = isDemoModeActive()
    ? await getDemoRecordForDate(date)
    : await getRecordFromIndexedDB(date);

  if (!current) {
    console.warn(`[Repository] updatePartial: No record found for ${date}, operation aborted.`);
    return;
  }

  const updatedForInvariants = applyPatches(current, partialData);
  const normalized = normalizeDailyRecordInvariants(updatedForInvariants);
  const mergedPatches: DailyRecordPatch = { ...partialData, ...normalized.patches };

  if (Object.keys(normalized.patches).length > 0) {
    logError('Invariant repair applied on updatePartial', undefined, {
      date,
      patches: Object.keys(normalized.patches),
    });
  }

  const updated = applyPatches(current, mergedPatches);
  updated.lastUpdated = new Date().toISOString();

  const validatedRecord = validateAndSalvageRecord(updated, date);

  if (isDemoModeActive()) {
    await saveDemoRecord(validatedRecord);
    return;
  }
  await saveToIndexedDB(validatedRecord);

  if (isFirestoreEnabled()) {
    try {
      Object.keys(mergedPatches).forEach(key => {
        if (key.startsWith('beds.')) {
          const bedId = key.split('.')[1];
          const patient = validatedRecord.beds[bedId];
          if (patient && patient.patientName) {
            const fhirPath = `beds.${bedId}.fhir_resource` as keyof DailyRecordPatch;
            const fhirResource = mapPatientToFhir(patient);
            mergedPatches[fhirPath] = fhirResource;
          }
        }
      });

      await updateRecordPartialToFirestore(date, mergedPatches);
    } catch (err) {
      console.warn('[Repository] Firestore partial update failed:', err);
    }
  }
};
