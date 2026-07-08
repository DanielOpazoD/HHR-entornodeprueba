import React from 'react';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';

export interface MedicalIndicationsAppliedRecordLookup {
  key: string;
  patient: MedicalIndicationsPatientOption;
  targetDate: string;
}

export const buildMedicalIndicationsAppliedRecordLookup = (
  selectedPatient: MedicalIndicationsPatientOption | null,
  targetDate: string
): MedicalIndicationsAppliedRecordLookup | null => {
  if (!selectedPatient || !targetDate) return null;

  const key = [
    selectedPatient.clinicalEpisodeId || '',
    selectedPatient.rut,
    selectedPatient.patientName,
    selectedPatient.admissionDate,
    selectedPatient.admissionTime || '',
    targetDate,
  ].join('|');

  return {
    key,
    patient: { ...selectedPatient },
    targetDate,
  };
};

export const useMedicalIndicationsAppliedRecordLookup = (
  selectedPatient: MedicalIndicationsPatientOption | null,
  targetDate: string
): MedicalIndicationsAppliedRecordLookup | null => {
  const bedId = selectedPatient?.bedId || '';
  const label = selectedPatient?.label || '';
  const patientName = selectedPatient?.patientName || '';
  const rut = selectedPatient?.rut || '';
  const diagnosis = selectedPatient?.diagnosis || '';
  const age = selectedPatient?.age || '';
  const birthDate = selectedPatient?.birthDate || '';
  const allergies = selectedPatient?.allergies || '';
  const admissionDate = selectedPatient?.admissionDate || '';
  const admissionTime = selectedPatient?.admissionTime;
  const clinicalEpisodeId = selectedPatient?.clinicalEpisodeId;
  const sourceDailyRecordDate = selectedPatient?.sourceDailyRecordDate;
  const daysOfStay = selectedPatient?.daysOfStay || '';
  const treatingDoctor = selectedPatient?.treatingDoctor || '';
  const hasPatient = Boolean(selectedPatient);

  return React.useMemo(
    () =>
      buildMedicalIndicationsAppliedRecordLookup(
        hasPatient
          ? {
              bedId,
              label,
              patientName,
              rut,
              diagnosis,
              age,
              birthDate,
              allergies,
              admissionDate,
              admissionTime,
              clinicalEpisodeId,
              sourceDailyRecordDate,
              daysOfStay,
              treatingDoctor,
            }
          : null,
        targetDate
      ),
    [
      admissionDate,
      admissionTime,
      age,
      allergies,
      bedId,
      birthDate,
      clinicalEpisodeId,
      daysOfStay,
      diagnosis,
      hasPatient,
      label,
      patientName,
      rut,
      sourceDailyRecordDate,
      targetDate,
      treatingDoctor,
    ]
  );
};
