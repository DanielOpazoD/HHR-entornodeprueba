import { isValidRut } from '@/utils/rutUtils';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { ageFromBirthDate } from '../mapping/rayenToPatientData';
import { isMaternalCandidatePatient } from './clinicalCribMaternalAssociation';
import { mapRayenBed } from '../mapping/bedMapping';

/** A distinct unique maternal episode may validate a source RUN; never replace the RN document. */
const maternalCandidates = (
  current: DailyRecord,
  sources: RayenEncounter[],
  episode: string,
  sourceRun: string
): Array<{ episode: string; rut: string }> => {
  if (!isValidRut(sourceRun)) return [];
  const key = (run: string) => run.replace(/[^0-9kK]/g, '').toUpperCase();
  const candidates = [
    ...Object.values(current.beds)
      .filter(
        p =>
          p.clinicalEpisodeId &&
          p.clinicalEpisodeId !== episode &&
          isMaternalCandidatePatient(p) &&
          !p.isBlocked
      )
      .map(p => ({ episode: p.clinicalEpisodeId!, rut: p.rut })),
    ...sources
      .filter(
        s =>
          s.encounterId !== episode &&
          !(
            (s.hasMedicalDischarge || s.hasNurseDischarge) &&
            !Object.values(current.beds).some(p => p.clinicalEpisodeId === s.encounterId)
          ) &&
          !/^\d+d$/.test(ageFromBirthDate(s.birthDate, new Date(current.date + 'T12:00:00'))) &&
          !mapRayenBed(s).isClinicalCrib &&
          !current.beds[mapRayenBed(s).bedId ?? '']?.isBlocked &&
          !/^RN\s+de\b/i.test([s.firstGivenName, s.nextGivenNames, s.firstFamilyName].join(' ')) &&
          !Object.values(current.beds).some(
            p =>
              (p.clinicalEpisodeId === s.encounterId && p.neonatalPlacementDecision) ||
              p.clinicalCrib?.clinicalEpisodeId === s.encounterId
          ) &&
          !/^(?:Hombre|Masculino|Male)$/i.test(s.administrativeSex || '')
      )
      .map(s => ({ episode: s.encounterId, rut: s.run })),
  ].filter(p => key(p.rut) === key(sourceRun));
  return candidates;
};

export const neonatalMaternalLookupRut = (
  current: DailyRecord,
  sources: RayenEncounter[],
  episode: string,
  sourceRun: string
): string | undefined => {
  const candidates = maternalCandidates(current, sources, episode, sourceRun);
  return new Set(candidates.map(p => p.episode)).size === 1 ? candidates[0]?.rut : undefined;
};
/** Ambiguous parental matches still cannot become a known RN's personal document. */
export const neonatalSourceRunIsMaternal = (
  current: DailyRecord,
  sources: RayenEncounter[],
  episode: string,
  sourceRun: string
): boolean => maternalCandidates(current, sources, episode, sourceRun).length > 0;
