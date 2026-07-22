import React from 'react';
import { RefreshCw } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useRayenFillProgress } from '../hooks/useRayenFillStatus';
import { RayenImportFlowStatus } from './RayenImportFlowStatus';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { Chip, ddmmyyyy, Section, VerificationBadges } from './RayenImportDiffReviewParts';

export interface RayenImportPreviewModalProps {
  isOpen: boolean;
  diff: CensusImportDiff | null;
  isBusy: boolean;
  error: string | null;
  /** `applyPreviousDays` = whether to ALSO file the past-day egreso corrections (the ack checkbox). */
  onConfirm: (applyPreviousDays: boolean) => void;
  onCancel: () => void;
}

const dischargeKindLabel: Record<string, string> = {
  alta: 'Alta',
  traslado: 'Traslado a otro hospital',
  cma: 'Egreso CMA',
};

export const RayenImportPreviewModal: React.FC<RayenImportPreviewModalProps> = ({
  isOpen,
  diff,
  isBusy,
  error,
  onConfirm,
  onCancel,
}) => {
  const fill = useRayenFillProgress();
  const [confirmationStarted, setConfirmationStarted] = React.useState(false);
  const hasChanges =
    !!diff &&
    diff.summary.admissions +
      diff.summary.updates +
      diff.summary.moves +
      diff.summary.discharges +
      (diff.reportEgresos?.length ?? 0) >
      0;

  // Modifying a previous day requires an explicit acknowledgment; reset it each time the modal opens.
  const previousDayEdits = diff?.previousDayEdits ?? [];
  const needsPreviousDayAck = previousDayEdits.length > 0;
  // Days that will receive a cross-day correction — used to tag each affected egreso in its own
  // list ("→ se grabará el …, no hoy"), so the section wording never suggests it lands today.
  const previousDays = new Set(previousDayEdits.map(edit => edit.day));
  const [acceptedPreviousDays, setAcceptedPreviousDays] = React.useState(false);
  const fillActive = fill.outcome === 'running';
  const fillSettled =
    fill.outcome === 'complete' || fill.outcome === 'partial' || fill.outcome === 'rejected';
  const staffingNeedsDecision =
    fill.staffingOutcome === 'pending' || fill.staffingOutcome === 'ambiguous';
  const staffingActive = fill.staffingOutcome === 'applying';
  React.useEffect(() => {
    if (isOpen) setAcceptedPreviousDays(false);
    else setConfirmationStarted(false);
  }, [isOpen]);
  React.useEffect(() => {
    // Auto/no-change flows can open this surface after the apply already began. Preserve that
    // fact so an applied diff is never presented as confirmable a second time.
    if (isOpen && (isBusy || fillActive || (fill.attemptId > 0 && fillSettled))) {
      setConfirmationStarted(true);
    }
  }, [fill.attemptId, fillActive, fillSettled, isBusy, isOpen]);

  const flowActive = isBusy || fillActive || staffingActive;
  const clinicalCompleted = !!diff && !error && confirmationStarted && fillSettled;
  const flowCompleted = !flowActive && !!diff && !error && confirmationStarted && fillSettled;
  const hasUnresolvedConflicts = (diff?.summary.conflicts ?? 0) > 0;
  const hasSkippedPreviousDayEdits =
    confirmationStarted &&
    needsPreviousDayAck &&
    (!acceptedPreviousDays ||
      previousDayEdits.some(edit => !edit.recordExists || !edit.withinEditingWindow));
  const hasSkippedItems = fill.staffingOutcome === 'declined' || hasSkippedPreviousDayEdits;
  const flowSuccessful =
    flowCompleted &&
    fill.outcome === 'complete' &&
    fill.staffingOutcome === 'resolved' &&
    !hasUnresolvedConflicts &&
    !hasSkippedItems;
  const showReview = hasChanges && (!confirmationStarted || Boolean(error)) && !flowActive;
  const handleClose = (): void => {
    if (!flowActive) onCancel();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Sincronizar censo · Eloísa"
      icon={<RefreshCw size={20} />}
      size="2xl"
      variant="white"
      headerIconColor="text-teal-600"
      dataModule="rayen-import"
      dataTestId="rayen-import-preview"
      closeOnBackdrop={!flowActive}
      showCloseButton={!flowActive}
    >
      <div className="max-h-[60vh] overflow-y-auto">
        {!diff ? (
          <p className="text-sm text-gray-500">Esperando datos de Rayen…</p>
        ) : (
          <>
            <RayenImportFlowStatus
              isApplyingCensus={isBusy}
              fill={fill}
              completed={clinicalCompleted}
              hasUnresolvedConflicts={hasUnresolvedConflicts}
              hasSkippedItems={hasSkippedItems}
            />
            {showReview && (
              <div>
                <div className="flex flex-wrap gap-2">
                  <Chip label="Ingresos" value={diff.summary.admissions} tone="green" />
                  <Chip label="Actualizaciones" value={diff.summary.updates} tone="blue" />
                  <Chip label="Movimientos de cama" value={diff.summary.moves} tone="teal" />
                  <Chip label="Egresos" value={diff.summary.discharges} tone="amber" />
                  <Chip
                    label="Pend. alta administrativa"
                    value={diff.summary.pendingAdministrativeDischarges}
                    tone="indigo"
                  />
                  <Chip label="Sin cambios" value={diff.summary.unchanged} tone="gray" />
                  {diff.summary.conflicts > 0 && (
                    <Chip label="Conflictos" value={diff.summary.conflicts} tone="red" />
                  )}
                  {(diff.reportEgresos?.length ?? 0) > 0 && (
                    <Chip
                      label="Egresos no sincronizados"
                      value={diff.reportEgresos?.length ?? 0}
                      tone="amber"
                    />
                  )}
                </div>

                <Section title="Ingresos" count={diff.admissions.length}>
                  {diff.admissions.map(entry => (
                    <li key={`adm-${entry.bedId}`}>
                      <span className="font-semibold">{entry.bedId}</span> —{' '}
                      {entry.patient.patientName}
                      {entry.isCma && <span className="ml-1 text-teal-600">(CMA)</span>}
                    </li>
                  ))}
                </Section>

                <Section title="Actualizaciones" count={diff.updates.length}>
                  {diff.updates.map(entry => (
                    <li key={`upd-${entry.bedId}`}>
                      <span className="font-semibold">{entry.bedId}</span> — {entry.patientName}:{' '}
                      <span className="text-gray-400">
                        {entry.changes.map(change => String(change.field)).join(', ')}
                      </span>
                    </li>
                  ))}
                </Section>

                <Section title="Movimientos de cama" count={diff.moves.length}>
                  {diff.moves.map(entry => (
                    <li key={`mov-${entry.fromBedId}-${entry.toBedId}`}>
                      {entry.patientName}: <span className="font-semibold">{entry.fromBedId}</span>{' '}
                      → <span className="font-semibold">{entry.toBedId}</span>
                    </li>
                  ))}
                </Section>

                <Section title="Egresos" count={diff.discharges.length}>
                  {diff.discharges.map(entry => (
                    <li key={`dis-${entry.bedId}-${entry.rut}`}>
                      <div>
                        <span className="font-semibold">{entry.bedId}</span> — {entry.patientName}:{' '}
                        {dischargeKindLabel[entry.kind] ?? entry.kind}
                        {entry.status === 'Fallecido' && (
                          <span className="ml-1 text-red-600">(Fallecido)</span>
                        )}
                        {previousDays.has(entry.correctedDay ?? '') && (
                          <span className="ml-1 font-medium text-amber-700">
                            → se grabará el {ddmmyyyy(entry.correctedDay)}
                            {entry.correctedTime ? ` ${entry.correctedTime} (hora isla)` : ''}, no
                            hoy
                          </span>
                        )}
                      </div>
                      {entry.verification && (
                        <VerificationBadges verification={entry.verification} />
                      )}
                    </li>
                  ))}
                </Section>

                <Section
                  title="Pendientes de alta administrativa (se mantienen en cama)"
                  count={diff.pendingAdministrativeDischarges.length}
                >
                  {diff.pendingAdministrativeDischarges.map(entry => (
                    <li key={`pnd-${entry.bedId}-${entry.rut}`}>
                      <div>
                        <span className="font-semibold">{entry.bedId}</span> — {entry.patientName}:{' '}
                        <span className="text-gray-500">
                          {entry.signal === 'clinical-closure'
                            ? 'cierre clínico registrado; egreso hospitalario aún no detectado'
                            : 'no aparece en Ficha Médico; se conserva en cama hasta confirmar el egreso'}
                        </span>
                      </div>
                      <VerificationBadges verification={entry.verification} />
                    </li>
                  ))}
                </Section>

                <Section title="Conflictos (no se aplican)" count={diff.conflicts.length}>
                  {diff.conflicts.map((entry, index) => (
                    <li key={`con-${index}`} className="text-red-700">
                      {entry.bedId ? `${entry.bedId}: ` : ''}
                      {entry.reason}
                    </li>
                  ))}
                </Section>

                <Section
                  title="Egresos no registrados en HHR (se agregarán a altas)"
                  count={diff.reportEgresos?.length ?? 0}
                >
                  {(diff.reportEgresos ?? []).map((entry, index) => (
                    <li key={`rep-${entry.run}-${index}`}>
                      <span className="font-semibold">{entry.bedLabel || '—'}</span> —{' '}
                      {entry.patientName} <span className="text-gray-400">({entry.run})</span>:{' '}
                      {dischargeKindLabel[entry.kind] ?? entry.kind}
                      {entry.destino && <span className="text-gray-500"> · {entry.destino}</span>}
                      {entry.fechaEgreso && (
                        <span className="text-gray-400"> · {entry.fechaEgreso}</span>
                      )}
                      {entry.status === 'Fallecido' && (
                        <span className="ml-1 text-red-600">(Fallecido)</span>
                      )}
                      {previousDays.has(entry.correctedDay ?? '') && (
                        <span className="ml-1 font-medium text-amber-700">
                          → se grabará el {ddmmyyyy(entry.correctedDay)}
                          {entry.correctedTime ? ` ${entry.correctedTime} (hora isla)` : ''}, no hoy
                        </span>
                      )}
                      <VerificationBadges
                        verification={{
                          medicalEpicrisis: 'unknown',
                          nursingEpicrisis: 'unknown',
                          hospitalDischarge: 'confirmed',
                        }}
                      />
                    </li>
                  ))}
                </Section>

                {needsPreviousDayAck && (
                  <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <h4 className="mb-1 text-sm font-semibold text-amber-800">
                      Modificar días previos ({previousDayEdits.length})
                    </h4>
                    <p className="mb-2 text-xs text-amber-700">
                      Según el reporte oficial, estos egresos ocurrieron en un día anterior. Al
                      confirmar se grabarán en su día real (Rapa Nui), no en el día de hoy.
                    </p>
                    <ul className="space-y-1 text-sm text-amber-900">
                      {previousDayEdits.map(edit => (
                        <li key={edit.day}>
                          <span className="font-semibold tabular-nums">{ddmmyyyy(edit.day)}</span> —{' '}
                          {edit.patientNames.join(', ')}
                          {!edit.withinEditingWindow && (
                            <span className="ml-1 font-medium text-red-600">
                              (requiere administrador — se omitirá)
                            </span>
                          )}
                          {edit.isSigned && (
                            <span className="ml-1 text-amber-600">(día ya firmado)</span>
                          )}
                          {!edit.recordExists && (
                            <span className="ml-1 font-medium text-red-600">
                              (no existe registro para ese día — se omitirá)
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-center gap-2 text-sm font-medium text-amber-900">
                      <input
                        type="checkbox"
                        checked={acceptedPreviousDays}
                        onChange={event => setAcceptedPreviousDays(event.target.checked)}
                        className="h-4 w-4"
                      />
                      Acepto modificar los días previos indicados
                    </label>
                  </div>
                )}
              </div>
            )}

            {flowSuccessful && !error && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                <p className="font-semibold text-emerald-800">Todo está actualizado</p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  Censo e información clínica fueron revisados correctamente.
                </p>
              </div>
            )}

            {flowCompleted && hasUnresolvedConflicts && (
              <Section title="Conflictos pendientes de revisión" count={diff.conflicts.length}>
                {diff.conflicts.map((entry, index) => (
                  <li key={`pending-conflict-${index}`} className="text-amber-800">
                    {entry.bedId ? `${entry.bedId}: ` : ''}
                    {entry.reason}
                  </li>
                ))}
              </Section>
            )}

            <div id="rayen-nursing-shift-slot" className="mt-4" />
          </>
        )}

        {error && (
          <details
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            open
          >
            <summary className="cursor-pointer font-semibold">
              La sincronización requiere atención
            </summary>
            <p className="mt-2 leading-relaxed">{error}</p>
          </details>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t pt-4">
        <button
          type="button"
          onClick={handleClose}
          disabled={flowActive}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {staffingNeedsDecision
            ? 'Mantener actual y cerrar'
            : flowCompleted || !hasChanges
              ? 'Listo'
              : 'Cancelar'}
        </button>
        {showReview && (
          <button
            type="button"
            // Today's changes (ingresos/movimientos/egresos) always apply; the días-previos ack only
            // gates whether the past-day corrections are also filed — it never blocks the confirm.
            onClick={() => {
              setConfirmationStarted(true);
              onConfirm(acceptedPreviousDays);
            }}
            disabled={isBusy || !hasChanges}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {isBusy ? 'Aplicando…' : 'Confirmar e importar'}
          </button>
        )}
      </div>
    </BaseModal>
  );
};
