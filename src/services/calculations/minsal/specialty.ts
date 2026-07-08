import { PatientData } from '@/services/contracts/patientServiceContracts';
import { BEDS } from '@/constants/beds';
import type { MinsalCalculationOptions } from '@/types/minsalTypes';
import { resolveReportingSpecialty } from './specialtyReporting';

export function getPatientsBySpecialty(
  beds: Record<string, PatientData>,
  options?: MinsalCalculationOptions
): Map<string, PatientData[]> {
  const bySpecialty = new Map<string, PatientData[]>();

  BEDS.forEach(bed => {
    const data = beds[bed.id];
    if (data && !data.isBlocked && data.patientName?.trim()) {
      const specialty = resolveReportingSpecialty({
        specialty: data.specialty,
        options,
      }).reportingSpecialty;
      const existing = bySpecialty.get(specialty) || [];
      existing.push(data);
      bySpecialty.set(specialty, existing);
    }
  });

  return bySpecialty;
}
