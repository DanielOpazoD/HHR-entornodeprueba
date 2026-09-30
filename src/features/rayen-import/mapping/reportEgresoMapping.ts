import type { PatientData } from '../contracts/rayenDomainContracts';
import type { ReportEgreso } from '../contracts/egresoReport';
import type { DischargeEntry } from '../contracts/censusImportDiff';

// A report egreso HHR never synced has no bed here — synthesize the minimal patient the movement
// builders read, so the day's altas census can log it from the report's data.
export const reportEgresoPatient = (egreso: ReportEgreso): PatientData =>
  ({
    patientName: egreso.patientName,
    rut: egreso.run,
    pathology: egreso.diagnostico ?? '',
    specialty: egreso.servicio ?? '',
    age: egreso.edad ?? undefined,
    clinicalEpisodeId: egreso.encounterId,
    admissionDate: egreso.admissionDay ?? '',
    admissionTime: egreso.admissionTime ?? '',
  }) as unknown as PatientData;

/**
 * Adapts a report-only egreso for the movement builders. It is intentionally used only when the
 * patient never occupied a bed in this HHR census (or when filing its historical movement); it does
 * not enter the bed-vacating discharge loop, whose entries carry a previewed occupant fingerprint.
 */
export const reportEgresoEntry = (egreso: ReportEgreso): DischargeEntry => ({
  bedId: egreso.bedLabel,
  rut: egreso.run,
  patientName: egreso.patientName,
  encounterId: egreso.encounterId,
  kind: egreso.kind,
  status: egreso.status,
  reason: 'administrative-discharge',
  correctedDay: egreso.correctedDay,
  correctedTime: egreso.correctedTime,
});
