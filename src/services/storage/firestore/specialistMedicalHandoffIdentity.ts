import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

export interface SpecialistHandoffTarget {
  bedId: string;
  target: 'bed' | 'clinicalCrib';
  clinicalEpisodeId: string;
  rut: string;
  documentType: string;
  patientName: string;
}

/** Freeze the identities from the edited record, never from a retry's fresh occupant. */
export const buildSpecialistHandoffTargets = (
  record: DailyRecord,
  patch: DailyRecordPatch
): SpecialistHandoffTarget[] => {
  const targets = new Map<string, SpecialistHandoffTarget>();
  for (const path of Object.keys(patch)) {
    const [root, bedId, field] = path.split('.');
    if (root !== 'beds' || !bedId) continue;
    const target = field === 'clinicalCrib' ? 'clinicalCrib' : 'bed';
    const bed = record.beds[bedId];
    const patient = target === 'clinicalCrib' ? bed?.clinicalCrib : bed;
    targets.set(`${bedId}.${target}`, {
      bedId,
      target,
      clinicalEpisodeId: patient?.clinicalEpisodeId?.trim() ?? '',
      rut: patient?.rut?.trim() ?? '',
      documentType: patient?.documentType ?? 'RUT',
      patientName: patient?.patientName?.trim() ?? '',
    });
  }
  return [...targets.values()];
};
