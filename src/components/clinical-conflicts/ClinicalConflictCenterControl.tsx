import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, History, ShieldCheck } from 'lucide-react';
import { BaseModalContent } from '@/components/shared/baseModalContent';
import { useConflictVersionRecovery } from '@/hooks/clinical-conflicts/useConflictVersionRecovery';
import {
  buildClinicalConflictCenterModel,
  type ClinicalConflictModuleDescriptor,
  type ClinicalConflictReviewPackage,
  type ClinicalConflictSnapshotOption,
} from '@/application/clinical-conflicts/clinicalConflictCenterController';
import type { DailyRecordConflictRecoveryPort } from '@/application/ports/dailyRecordConflictRecoveryPort';
import type { ConflictVersionRestoreAuditDetails } from '@/services/repositories/ports/repositoryAuditPort';
import {
  analyzeDailyRecordRestoreImpact,
  type DailyRecordRestoreImpactAnalysis,
} from '@/services/repositories/dailyRecordRestoreImpactAnalyzer';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export type ClinicalConflictCenterScope = 'census' | 'nursing_handoff' | 'medical_handoff';

interface ClinicalConflictCenterControlProps {
  date?: string;
  scope: ClinicalConflictCenterScope;
  port?: DailyRecordConflictRecoveryPort;
  currentRecord?: DailyRecord | null;
  buttonTestId?: string;
  className?: string;
  hideButtonLabel?: boolean;
  buttonLabel?: string;
  buttonVariant?: 'default' | 'operations' | 'quick-action';
}

const MODULE_TONE_CLASS: Record<ClinicalConflictModuleDescriptor['tone'], string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-100',
  slate: 'bg-slate-50 text-slate-600 border-slate-100',
};

const SCOPE_LABEL: Record<ClinicalConflictCenterScope, string> = {
  census: 'Censo diario',
  nursing_handoff: 'Entrega enfermería',
  medical_handoff: 'Entrega médica',
};

const buildRestoreMessage = (
  option: ClinicalConflictSnapshotOption,
  scope: ClinicalConflictCenterScope,
  date?: string
): string =>
  [
    `Se preservará "${option.label}" para ${SCOPE_LABEL[scope]}${date ? ` del ${date}` : ''}.`,
    'El estado actual quedará en historial y la acción quedará auditada con usuario, fecha, módulo y versión elegida.',
    'Usa esta opción solo si la regla automática eligió un camino clínico incorrecto.',
  ].join(' ');

const buildRestoreReviewContext = ({
  conflict,
  option,
  scope,
}: {
  conflict: ClinicalConflictReviewPackage;
  option: ClinicalConflictSnapshotOption;
  scope: ClinicalConflictCenterScope;
}): ConflictVersionRestoreAuditDetails['reviewContext'] => ({
  source: 'clinical_conflict_center',
  scope,
  reason: 'manual_preserve_selected_truth',
  selectedVersionLabel: option.label,
  modules: conflict.modules.map(module => ({ key: module.key, label: module.label })),
  patientContexts: conflict.patientContexts.slice(0, 10),
  patientContextCount: conflict.patientContexts.length,
  patientContextsTruncated: conflict.patientContexts.length > 10,
  changedFields: conflict.changes.slice(0, 12).map(change => ({
    path: change.path,
    module: change.module,
    label: change.label,
    before: change.before,
    after: change.after,
    ...(change.bedId ? { bedId: change.bedId } : {}),
  })),
  changedFieldCount: conflict.totalChangeCount,
  changedFieldsTruncated: conflict.totalChangeCount > 12,
});

function PatientContextList({ conflict }: { conflict: ClinicalConflictReviewPackage }) {
  if (conflict.patientContexts.length === 0) {
    return <p className="text-xs text-slate-500">Sin paciente específico identificado.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {conflict.patientContexts.slice(0, 6).map(patient => (
        <span
          key={[patient.rut, patient.bedId, patient.patientName].join('|')}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600"
        >
          {patient.patientName}
          {patient.rut ? ` · ${patient.rut}` : ''}
          {patient.bedName ? ` · ${patient.bedName}` : ''}
        </span>
      ))}
      {conflict.patientContexts.length > 6 && (
        <span className="text-[11px] text-slate-500">
          +{conflict.patientContexts.length - 6} paciente(s) adicionales
        </span>
      )}
    </div>
  );
}

const ChangeList: React.FC<{ conflict: ClinicalConflictReviewPackage }> = ({ conflict }) => {
  if (conflict.changes.length === 0) {
    return (
      <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        No se pudo calcular una diferencia campo a campo, pero las versiones completas siguen
        disponibles.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {conflict.changes.slice(0, 8).map(change => (
        <div
          key={change.path}
          className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs md:grid-cols-[150px_1fr]"
        >
          <div>
            <p className="font-semibold text-slate-700">{change.label}</p>
            <p className="font-mono text-[10px] text-slate-400">{change.path}</p>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <p className="min-w-0 text-rose-700">
              <span className="font-semibold">Antes:</span> {change.before}
            </p>
            <p className="min-w-0 text-emerald-700">
              <span className="font-semibold">Después:</span> {change.after}
            </p>
          </div>
        </div>
      ))}
      {conflict.changes.length > 8 && (
        <p className="text-[11px] text-slate-500">
          +{conflict.totalChangeCount - 8} diferencia(s) adicionales en el registro completo.
        </p>
      )}
    </div>
  );
};

const IMPACT_TONE_CLASS: Record<DailyRecordRestoreImpactAnalysis['status'], string> = {
  safe: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  review_required: 'border-amber-100 bg-amber-50 text-amber-700',
  blocked: 'border-rose-100 bg-rose-50 text-rose-700',
};

const IMPACT_TITLE: Record<DailyRecordRestoreImpactAnalysis['status'], string> = {
  safe: 'Sin impacto posterior relevante',
  review_required: 'Requiere revisión',
  blocked: 'Bloqueado por seguridad clínica',
};

function RestoreImpactNotice({ impact }: { impact?: DailyRecordRestoreImpactAnalysis }) {
  if (!impact || impact.status === 'safe') return null;
  const [firstImpact] = impact.impacts;
  return (
    <div
      className={clsx(
        'mt-2 rounded-md border px-2 py-1.5 text-[11px]',
        IMPACT_TONE_CLASS[impact.status]
      )}
    >
      <p className="font-semibold">{IMPACT_TITLE[impact.status]}</p>
      {firstImpact && <p className="mt-0.5">{firstImpact.message}</p>}
      {impact.impacts.length > 1 && (
        <p className="mt-0.5 font-medium">+{impact.impacts.length - 1} impacto(s) adicional(es)</p>
      )}
    </div>
  );
}

const ConflictPackageCard: React.FC<{
  conflict: ClinicalConflictReviewPackage;
  restoringId: string | null;
  restoreImpactBySnapshotId: Map<string, DailyRecordRestoreImpactAnalysis>;
  onRestore: (snapshotId: string, option: ClinicalConflictSnapshotOption) => void;
}> = ({ conflict, restoringId, restoreImpactBySnapshotId, onRestore }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
              conflict.status === 'auto_merged_reviewable'
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : 'border-amber-100 bg-amber-50 text-amber-700'
            )}
          >
            {conflict.status === 'auto_merged_reviewable' ? (
              <CheckCircle2 size={12} />
            ) : (
              <AlertTriangle size={12} />
            )}
            {conflict.title}
          </span>
          {conflict.modules.map(module => (
            <span
              key={module.key}
              className={clsx(
                'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                MODULE_TONE_CLASS[module.tone]
              )}
            >
              {module.label}
            </span>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{conflict.subtitle}</p>
      </div>
      <p className="font-mono text-[10px] text-slate-400">{conflict.id}</p>
    </div>

    <div className="mt-3 space-y-3">
      <PatientContextList conflict={conflict} />
      <ChangeList conflict={conflict} />

      <div className="grid gap-2 sm:grid-cols-2">
        {conflict.options.map(option => {
          const impact = restoreImpactBySnapshotId.get(option.id);
          const blocked = impact?.status === 'blocked';
          return (
            <div key={option.id} className="rounded-lg border border-slate-200 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700">{option.label}</p>
                  <p className="text-xs text-slate-500">{option.summary}</p>
                  {option.sourceLastUpdated && (
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                      Base {option.sourceLastUpdated.slice(11, 16)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRestore(option.id, option)}
                  disabled={restoringId !== null || blocked}
                  className={clsx(
                    'shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50',
                    blocked
                      ? 'border-rose-200 text-rose-700'
                      : 'border-accent-200 text-accent-700 hover:bg-accent-50'
                  )}
                >
                  {blocked ? 'Bloqueado' : restoringId === option.id ? 'Aplicando...' : 'Preservar'}
                </button>
              </div>
              <RestoreImpactNotice impact={impact} />
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

export const ClinicalConflictCenterControl: React.FC<ClinicalConflictCenterControlProps> = ({
  date,
  scope,
  port,
  currentRecord,
  buttonTestId = 'clinical-conflict-center-button',
  className,
  hideButtonLabel = false,
  buttonLabel = 'Conflictos',
  buttonVariant = 'default',
}) => {
  const recovery = useConflictVersionRecovery({ date, port });
  const centerModel = React.useMemo(
    () =>
      buildClinicalConflictCenterModel({
        date,
        snapshots: recovery.snapshots,
        snapshotRecovery: recovery.snapshotRecovery,
      }),
    [date, recovery.snapshotRecovery, recovery.snapshots]
  );
  const restoreImpactBySnapshotId = React.useMemo(() => {
    const impactById = new Map<string, DailyRecordRestoreImpactAnalysis>();
    if (!date || !currentRecord || !recovery.isOpen) return impactById;
    recovery.snapshots.forEach(snapshot => {
      impactById.set(
        snapshot.id,
        analyzeDailyRecordRestoreImpact({
          date,
          current: currentRecord,
          selectedSnapshot: { ...snapshot.record, date },
        })
      );
    });
    return impactById;
  }, [currentRecord, date, recovery.isOpen, recovery.snapshots]);

  if (!date || !recovery.canManageClinicalConflicts) {
    return null;
  }

  const handleRestore = (snapshotId: string, option: ClinicalConflictSnapshotOption) => {
    if (restoreImpactBySnapshotId.get(snapshotId)?.status === 'blocked') {
      return;
    }
    const conflict = centerModel.conflicts.find(item =>
      item.options.some(candidate => candidate.id === snapshotId)
    );
    void recovery.restore(snapshotId, {
      title: 'Preservar versión seleccionada',
      message: conflict ? buildRestoreMessage(option, scope, date) : undefined,
      confirmText: 'Preservar',
      successTitle: 'Versión preservada',
      successMessage: 'La versión clínica elegida quedó como estado vigente del día.',
      reviewContext: conflict
        ? buildRestoreReviewContext({
            conflict,
            option,
            scope,
          })
        : undefined,
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={recovery.open}
        title={`Centro de conflictos clínicos · ${SCOPE_LABEL[scope]}`}
        aria-label={`Centro de conflictos clínicos de ${SCOPE_LABEL[scope]}`}
        data-testid={buttonTestId}
        className={clsx(
          'relative inline-flex items-center justify-center gap-1.5 border font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          buttonVariant === 'quick-action'
            ? 'h-[30px] min-w-[96px] shrink-0 rounded-lg border-amber-200 bg-amber-50 px-2.5 py-0 text-[10px] text-amber-700 hover:bg-amber-100 focus-visible:outline-amber-500'
            : 'border-slate-200 bg-white text-xs shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-slate-400',
          buttonVariant === 'operations' && 'min-h-9 rounded-lg px-2.5 py-2 text-slate-600',
          buttonVariant === 'default' && 'rounded-md px-2 py-1.5 text-slate-500',
          className
        )}
      >
        <History size={14} />
        {!hideButtonLabel && <span className="hidden sm:inline">{buttonLabel}</span>}
        {recovery.snapshots.length > 0 && (
          <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
            {recovery.snapshots.length}
          </span>
        )}
      </button>

      <BaseModalContent
        isOpen={recovery.isOpen}
        onClose={recovery.close}
        title="Centro de conflictos clínicos"
        size="xl"
        dataTestId="clinical-conflict-center-modal"
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="flex items-center gap-1.5 font-semibold text-slate-700">
              <ShieldCheck size={14} />
              {SCOPE_LABEL[scope]} · {date}
            </p>
            <p className="mt-1">
              Los conflictos seguros se resuelven automáticamente. Este centro muestra versiones
              revisables cuando existe evidencia recuperable.
            </p>
          </div>

          {recovery.loading ? (
            <p className="py-6 text-center text-sm text-slate-500">Cargando conflictos...</p>
          ) : !centerModel.hasReviewableConflicts ? (
            <div className="py-6 text-center">
              <p className="text-sm font-semibold text-slate-700">{centerModel.emptyState.title}</p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
                {centerModel.emptyState.message}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {centerModel.conflicts.map(conflict => (
                <ConflictPackageCard
                  key={conflict.id}
                  conflict={conflict}
                  restoringId={recovery.restoringId}
                  restoreImpactBySnapshotId={restoreImpactBySnapshotId}
                  onRestore={handleRestore}
                />
              ))}
            </div>
          )}
        </div>
      </BaseModalContent>
    </>
  );
};
