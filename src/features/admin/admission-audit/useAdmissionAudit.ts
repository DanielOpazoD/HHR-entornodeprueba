import { useEffect, useRef, useState } from 'react';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { getSessionEpoch, onSessionChange } from '@/services/storage/sessionStorageTransition';
import { readAdmissionAuditCensus } from '@/services/admin/admissionAuditCensus';
import {
  parseAdmissionVitalSigns,
  requestClinicalPanel,
} from '@/features/rayen-import/admission-audit';
import {
  buildAdmissionAuditEntry,
  collectAdmissionCandidates,
  UNATTRIBUTED_DOCTOR,
  withinAdmissionHistory,
  type AdmissionAuditEntry,
  type AdmissionCandidate,
  type AdmissionPeriod,
  type IndicationScope,
} from './admissionAuditModel';

export interface AdmissionAuditReport {
  period: AdmissionPeriod;
  indicationScope: IndicationScope;
  entries: AdmissionAuditEntry[];
}
export const useAdmissionAudit = (owner: string | null) => {
  const epoch = useSessionEpoch();
  const scope = `${owner}:${epoch}`;
  const current = useRef(scope);
  current.current = scope;
  const operation = useRef<AbortController | null>(null);
  const [answer, setAnswer] = useState<{ scope: string; report: AdmissionAuditReport } | null>(
    null
  );
  const [status, setStatus] = useState<{
    scope: string;
    running: boolean;
    progress: string;
    error: string;
  }>({ scope, running: false, progress: '', error: '' });
  const clear = () => {
    operation.current?.abort();
    operation.current = null;
    setAnswer(null);
    setStatus({ scope: '', running: false, progress: '', error: '' });
  };
  useEffect(() => onSessionChange(clear), []);
  useEffect(() => {
    setAnswer(null);
    setStatus({ scope, running: false, progress: '', error: '' });
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [scope]);

  const start = async (period: AdmissionPeriod, indicationScope: IndicationScope) => {
    if (!owner || operation.current) return;
    if (!withinAdmissionHistory(period.from)) {
      setStatus({
        scope,
        running: false,
        progress: '',
        error: 'El período supera la cobertura histórica de 4000 días.',
      });
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted &&
      current.current === scope &&
      getSessionEpoch() === epoch &&
      operation.current === controller;
    setStatus({
      scope,
      running: true,
      progress: 'Leyendo hospitalizaciones del período…',
      error: '',
    });
    try {
      const candidates = new Map<string, AdmissionCandidate>();
      for await (const records of readAdmissionAuditCensus(
        period.from,
        period.to,
        controller.signal
      )) {
        // Apply the period only once all monthly batches have supplied their latest snapshots.
        for (const candidate of collectAdmissionCandidates(records, {
          from: '1000-01-01',
          to: '9999-12-31',
        })) {
          const prior = candidates.get(candidate.key);
          candidates.set(candidate.key, {
            ...candidate,
            admissionTime:
              candidate.admissionTime ||
              (prior?.admissionDate === candidate.admissionDate ? prior.admissionTime : '') ||
              '',
          });
        }
      }
      if (!isCurrent()) return;
      const cohort = [...candidates.values()].filter(
        p => p.admissionDate >= period.from && p.admissionDate <= period.to
      );
      const entries: AdmissionAuditEntry[] = [];
      for (const patient of cohort) {
        if (!isCurrent()) return;
        setStatus({
          scope,
          running: true,
          progress: `Leyendo ingresos: ${entries.length + 1} de ${cohort.length}`,
          error: '',
        });
        const previous =
          answer?.scope === scope && answer.report.indicationScope === indicationScope
            ? answer.report.entries.find(
                e =>
                  e.patient.key === patient.key &&
                  e.patient.admissionDate === patient.admissionDate &&
                  e.patient.admissionTime === patient.admissionTime
              )
            : undefined;
        try {
          const history = await requestClinicalPanel(patient.episodeId, 90000, controller.signal, {
            historyFrom: patient.admissionDate,
          });
          if (!isCurrent()) return;
          if (history.error) throw new Error(history.error);
          if (history.historyFrom !== patient.admissionDate) {
            setStatus({
              scope,
              running: false,
              progress: '',
              error:
                'Actualiza la extensión Eloísa a 0.48.77 o superior: no se confirmó el historial desde el ingreso. El último resultado disponible se conserva.',
            });
            return;
          }
          const parsedVitals = parseAdmissionVitalSigns(history.forms ?? []);
          const formError =
            history.formError ||
            (parsedVitals.unverifiableTime
              ? 'Hay tomas de signos vitales sin fecha-hora verificable.'
              : '') ||
            (!history.forms ? 'No se confirmó la lectura de signos vitales.' : '');
          const entry = buildAdmissionAuditEntry(
            patient,
            history.events,
            formError ? (previous?.vital ? [previous.vital] : null) : parsedVitals.vitals,
            indicationScope
          );
          if (formError) {
            entry.vitalReadError = previous?.vital
              ? 'No se pudieron actualizar los signos vitales; se muestra la última lectura disponible.'
              : 'No se pudieron leer los signos vitales. Reconsulta para verificarlos.';
          }
          entries.push(entry);
        } catch (error) {
          if (!isCurrent()) return;
          entries.push({
            patient,
            notes: previous?.notes ?? [],
            indications: previous?.indications ?? [],
            vital: previous?.vital ?? null,
            vitalReadError: previous?.vitalReadError,
            doctor: previous?.doctor ?? UNATTRIBUTED_DOCTOR,
            issues: previous
              ? [
                  ...previous.issues,
                  'Se muestra la última lectura disponible; no se pudo actualizar.',
                ]
              : [],
            readError: error instanceof Error ? error.message : 'No se pudo leer el ingreso.',
          });
        }
      }
      if (isCurrent())
        setAnswer({ scope, report: { period: { ...period }, indicationScope, entries } });
    } catch {
      if (isCurrent())
        setStatus({
          scope,
          running: false,
          progress: '',
          error:
            'No se pudo verificar el período en el servidor. Reintenta; el último resultado disponible se conserva.',
        });
    } finally {
      if (isCurrent()) {
        operation.current = null;
        setStatus(s => ({ ...s, running: false, progress: '' }));
      }
    }
  };
  return {
    report: owner && answer?.scope === scope ? answer.report : null,
    running: status.scope === scope && status.running,
    progress: status.scope === scope ? status.progress : '',
    error: status.scope === scope ? status.error : '',
    start,
    cancel: () => {
      operation.current?.abort();
      operation.current = null;
      setStatus(s => ({ ...s, running: false, progress: '' }));
    },
  };
};
