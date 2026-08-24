import type {
  AdmissionEntry,
  CensusImportDiff,
  CmaAdmissionResolution,
} from '../contracts/censusImportDiff';

export const cmaAdmissionReviewKey = (admission: AdmissionEntry): string =>
  JSON.stringify([
    admission.source?.encounterId || null,
    admission.bedId,
    admission.patient.clinicalEpisodeId,
    admission.patient.rut,
    admission.patient.patientName,
  ]);

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const sameAdmissionSubject = (
  admission: AdmissionEntry,
  subject: { clinicalEpisodeId?: string; rut?: string }
): boolean => {
  const episodeId = admission.patient.clinicalEpisodeId?.trim();
  if (episodeId && subject.clinicalEpisodeId?.trim()) {
    return episodeId === subject.clinicalEpisodeId.trim();
  }
  const rut = normalizeRut(admission.patient.rut);
  return !!rut && rut === normalizeRut(subject.rut);
};

export const areCmaAdmissionsResolved = (
  diff: CensusImportDiff | null,
  resolutions: CmaAdmissionResolution[]
): boolean => {
  const resolvedKeys = new Set(resolutions.map(resolution => resolution.admissionKey));
  return (diff?.admissions ?? [])
    .filter(admission => admission.isCma)
    .every(admission => resolvedKeys.has(cmaAdmissionReviewKey(admission)));
};

/**
 * Applies the reviewed CMA decisions only to the transient import plan. A deferred patient is not
 * persisted or suppressed, so Eloísa will propose the admission again on a future synchronization.
 */
export const applyCmaAdmissionResolutions = (
  diff: CensusImportDiff,
  resolutions: CmaAdmissionResolution[]
): CensusImportDiff => {
  const sourceAdmissions = diff.admissions ?? [];
  const cmaAdmissions = sourceAdmissions.filter(admission => admission.isCma);
  if (cmaAdmissions.length === 0) return diff;

  const byKey = new Map(
    resolutions.map(resolution => [resolution.admissionKey, resolution.disposition])
  );
  const unresolved = cmaAdmissions.filter(
    admission => !byKey.has(cmaAdmissionReviewKey(admission))
  );
  if (unresolved.length > 0) {
    throw new Error(
      'Cada ingreso proveniente de CMA requiere decidir si se incorpora o se deja pendiente.'
    );
  }

  const admissions = sourceAdmissions.filter(
    admission => !admission.isCma || byKey.get(cmaAdmissionReviewKey(admission)) === 'admit'
  );
  const deferredAdmissions = cmaAdmissions.filter(
    admission => byKey.get(cmaAdmissionReviewKey(admission)) === 'defer'
  );
  const previousDayEdits = (diff.previousDayEdits ?? []).flatMap(edit => {
    if (edit.reason !== 'admission-night-shift-correction' || !edit.admissionSubjects) {
      return [edit];
    }
    const admissionSubjects = edit.admissionSubjects;
    const keptIndexes = admissionSubjects.flatMap((subject, index) =>
      deferredAdmissions.some(admission => sameAdmissionSubject(admission, subject)) ? [] : [index]
    );
    if (keptIndexes.length === 0) return [];
    return [
      {
        ...edit,
        patientNames: keptIndexes.map(index => edit.patientNames[index]).filter(Boolean),
        admissionSubjects: keptIndexes.map(index => admissionSubjects[index]),
      },
    ];
  });
  return {
    ...diff,
    admissions,
    previousDayAdmissionCandidates: (diff.previousDayAdmissionCandidates ?? []).filter(
      candidate =>
        !deferredAdmissions.some(
          admission => cmaAdmissionReviewKey(admission) === cmaAdmissionReviewKey(candidate)
        )
    ),
    previousDayEdits,
    summary: { ...diff.summary, admissions: admissions.length },
  };
};
