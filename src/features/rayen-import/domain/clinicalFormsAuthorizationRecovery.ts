import { isValidRut } from '@/utils/rutUtils';
import type { ClinicalFillCandidate } from './clinicalFillCandidates';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { RayenScalesFormsResult } from '../contracts/patientClinicalBundle';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';

const AUTHORIZATION_DENIED = 'Las escalas no fueron autorizadas para el episodio de esta pestaña.';

const canonicalRun = (value: string): string => {
  const raw = value.replace(/[.\s-]/g, '').toUpperCase();
  return /^\d{1,8}[0-9K]$/.test(raw) && isValidRut(raw) ? raw : '';
};

/** Recover a lost/expired MV3 grant through source evidence, never a locally asserted grant. */
export const createClinicalFormsAuthorizationRecovery = (
  candidates: readonly ClinicalFillCandidate[],
  signal: AbortSignal,
  dependencies: {
    readForms: (encounterId: string) => Promise<RayenScalesFormsResult>;
    verifyEpisode: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>;
    refreshSnapshot?: () => Promise<RayenCensusSnapshot | null>;
  }
) => {
  const denied = new Map<string, RayenScalesFormsResult>();
  const renewals = new Map<string, Promise<boolean>>();
  let freshSnapshot: Promise<RayenCensusSnapshot | null> | undefined;
  const observe = (encounterId: string, result: RayenScalesFormsResult): void => {
    if (result.error === AUTHORIZATION_DENIED) denied.set(encounterId, result);
  };
  const renew = (encounterId: string): Promise<boolean> => {
    const existing = renewals.get(encounterId);
    if (existing) return existing;
    const pending = (async () => {
      signal.throwIfAborted();
      const matches = candidates.filter(item => item.patient.clinicalEpisodeId === encounterId);
      if (!/^\d+$/.test(encounterId) || matches.length !== 1) return false;
      const patient = matches[0].patient;
      const ownRun =
        patient.documentType !== 'Pasaporte' && patient.identityStatus !== 'provisional'
          ? patient.rut
          : '';
      // Explicit source maternal identity is lookup-only; never infer it from a shared bed/name.
      const run = ownRun || patient.neonatalMaternalRut || '';
      if (!canonicalRun(run)) return false;
      if (dependencies.refreshSnapshot) {
        freshSnapshot ??= dependencies.refreshSnapshot().catch(() => null);
        const snapshot = await freshSnapshot;
        signal.throwIfAborted();
        const live = snapshot?.encounters.filter(item => item.encounterId === encounterId) ?? [];
        // A changed identity is a contradiction, not permission to fall back to the old patient.
        if (live.length)
          return live.length === 1 && canonicalRun(live[0].run) === canonicalRun(run);
      }
      const results = await dependencies.verifyEpisode([{ run, encounterId }]);
      signal.throwIfAborted();
      return results.some(
        result =>
          !result.error &&
          result.egreso &&
          result.encounterId === encounterId &&
          canonicalRun(result.run) === canonicalRun(run) &&
          String(result.egreso.id ?? result.egreso.encounterId ?? '') === encounterId
      );
    })().catch(() => {
      signal.throwIfAborted();
      return false;
    });
    renewals.set(encounterId, pending);
    return pending;
  };
  const readForms = async (encounterId: string): Promise<RayenScalesFormsResult> => {
    signal.throwIfAborted();
    const first = denied.get(encounterId);
    if (first && !(await renew(encounterId))) return first;
    signal.throwIfAborted();
    const result = await dependencies.readForms(encounterId);
    observe(encounterId, result);
    // Retry ownership stays with readClinicalPatientSources: at most two form reads in total,
    // including the bundled section. A denied source never becomes a successful empty result.
    return result;
  };
  return { readForms, observe };
};
