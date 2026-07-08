/**
 * Wound Care Section Controller
 *
 * Orchestration logic for integrating wound care into the nursing handoff.
 */

import type { DailyRecord } from '@/domain/handoff/recordContracts';
import { buildClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';
import type { EpisodeContext } from '@/application/wound-care/woundCareUseCases';

/**
 * A patient row eligible for wound care documentation in the handoff table.
 * Derived from a {@link DailyRecord} bed entry with a valid RUT and admission date.
 */
export interface WoundCarePatientEntry {
  bedId: string;
  bedName: string;
  patientName: string;
  patientRut: string;
  episodeKey: string;
  episodeContext: EpisodeContext;
}

/**
 * Extract the list of active patients from a DailyRecord that can have
 * wound care documentation. Only patients with a RUT and admission date
 * produce a valid episodeKey.
 */
export const resolveWoundCarePatients = (record: DailyRecord): WoundCarePatientEntry[] => {
  const entries: WoundCarePatientEntry[] = [];

  if (!record.beds) return entries;

  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!patient || patient.isBlocked) continue;

    const patientName = patient.patientName?.trim();
    if (!patientName) continue;

    const patientRut = (patient.rut || '').trim();
    const admissionDate = (patient.admissionDate || '').trim();
    if (!patientRut || !admissionDate) continue;

    const episodeKey = buildClinicalEpisodeKey(patientRut, admissionDate, patient.admissionTime);

    entries.push({
      bedId,
      bedName: bedId,
      patientName,
      patientRut,
      episodeKey,
      episodeContext: {
        episodeKey,
        patientRut,
        patientName,
      },
    });
  }

  return entries.sort((a, b) => a.bedName.localeCompare(b.bedName, 'es'));
};
