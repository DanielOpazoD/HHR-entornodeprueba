import { MasterPatient } from '@/types';
import { formatRut, isValidRut } from '@/utils/rutUtils';
import { DailyRecordRepository } from './DailyRecordRepository';
import { bulkUpsertPatients } from './PatientMasterRepository';

const normalizeId = (rut: string): string => formatRut(rut).toUpperCase();

/**
 * Scans existing daily records and backfills the master patient index.
 * Separated from PatientMasterRepository to keep repository dependencies acyclic.
 */
export const migrateFromDailyRecords = async (): Promise<{
  scannedDays: number;
  totalPatients: number;
}> => {
  const dates = await DailyRecordRepository.getAllDates();
  const uniquePatients = new Map<string, MasterPatient>();

  for (const date of dates) {
    const record = await DailyRecordRepository.getForDate(date);
    if (!record?.beds) continue;

    Object.values(record.beds).forEach(patient => {
      if (patient.patientName?.trim() && patient.rut?.trim() && isValidRut(patient.rut)) {
        const id = normalizeId(patient.rut);
        if (!uniquePatients.has(id)) {
          uniquePatients.set(id, {
            rut: id,
            fullName: patient.patientName,
            birthDate: patient.birthDate,
            forecast: patient.insurance,
            gender: patient.biologicalSex,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }

      if (
        patient.clinicalCrib?.patientName?.trim() &&
        patient.clinicalCrib?.rut?.trim() &&
        isValidRut(patient.clinicalCrib.rut)
      ) {
        const id = normalizeId(patient.clinicalCrib.rut);
        if (!uniquePatients.has(id)) {
          uniquePatients.set(id, {
            rut: id,
            fullName: patient.clinicalCrib.patientName,
            birthDate: patient.clinicalCrib.birthDate,
            forecast: patient.insurance,
            gender: patient.clinicalCrib.biologicalSex,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
    });
  }

  const patientsList = Array.from(uniquePatients.values());
  if (patientsList.length > 0) {
    console.warn(
      `[Migration] Found ${patientsList.length} unique patients across ${dates.length} days. Syncing...`
    );
    await bulkUpsertPatients(patientsList);
  }

  return { scannedDays: dates.length, totalPatients: patientsList.length };
};
