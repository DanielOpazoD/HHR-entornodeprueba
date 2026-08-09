import React from 'react';
import { RefreshCw } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import {
  Chip,
  ddmmyyyy,
  HistoricalReconstructionReview,
  Section,
  VerificationBadges,
} from './RayenImportDiffReviewParts';
import { presentPatientUpdates } from './rayenImportUpdatePresentation';

export interface RayenImportPreviewModalProps {
  isOpen: boolean;
  diff: CensusImportDiff | null;
  isBusy: boolean;
  error: string | null;
  isApplied?: boolean;
  targetDate?: string | null;
  /** Whether to also file confirmed cross-day admission/discharge corrections. */
  onConfirm: (applyPreviousDays: boolean) => void;
  onCancel: () => void;
}

const dischargeKindLabel: Record<string, string> = {
  alta: 'Alta',
  traslado: 'Traslado a otro hospital',
  cma: 'Egreso CMA',
};

const updateEntryKey = (entry: CensusImportDiff['updates'][number]): string => {
  const subject = entry.source?.encounterId || entry.rut || entry.patientName;
  const fields = entry.changes.map(change => String(change.field)).sort();
  return JSON.stringify([entry.bedId, subject, fields]);
};

export const RayenImportPreviewModal: React.FC<RayenImportPreviewModalProps> = ({
  isOpen,
  diff,
  isBusy,
  error,
  isApplied = false,
  targetDate,
  onConfirm,
  onCancel,
}) => {
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
  React.useEffect(() => {
    if (isOpen) setAcceptedPreviousDays(false);
  }, [isOpen]);
  const hasConflicts = Boolean(diff?.summary.conflicts);
  const presentedUpdates = React.useMemo(
    () => presentPatientUpdates(diff?.updates ?? []),
    [diff?.updates]
  );
  const historicalConflicts =
    diff?.conflicts.filter(entry => entry.code === 'historical-reconstruction') ?? [];
  const blockingConflicts =
    diff?.conflicts.filter(entry => entry.code !== 'historical-reconstruction') ?? [];
  const showReview = (hasChanges || hasConflicts) && !isBusy && !isApplied;
  const showAppliedConflicts = isApplied && diff != null && diff.summary.conflicts > 0 && !isBusy;
  const handleClose = (): void => {
    if (!isBusy) onCancel();
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
      closeOnBackdrop={!isBusy}
      showCloseButton={!isBusy}
    >
      <div className="max-h-[60vh] overflow-y-auto">
        {targetDate && (
          <p
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
            data-testid="rayen-import-target-date"
          >
            Censo del {ddmmyyyy(targetDate)}
          </p>
        )}
        {!diff ? (
          <p className="text-sm text-gray-500">Esperando datos de Rayen…</p>
        ) : (
          <>
            {showReview && (
              <div>
                <div className="flex flex-wrap gap-2">
                  <Chip label="Ingresos" value={diff.summary.admissions} tone="green" />
                  <Chip label="Actualizaciones" value={presentedUpdates.length} tone="blue" />
                  <Chip label="Movimientos de cama" value={diff.summary.moves} tone="teal" />
                  <Chip label="Egresos" value={diff.summary.discharges} tone="amber" />
                  <Chip
                    label="Pend. alta administrativa"
                    value={diff.summary.pendingAdministrativeDischarges}
                    tone="indigo"
                  />
                  <Chip label="Sin cambios" value={diff.summary.unchanged} tone="gray" />
                  {historicalConflicts.length > 0 && (
                    <Chip label="Por revisar" value={historicalConflicts.length} tone="amber" />
                  )}
                  {blockingConflicts.length > 0 && (
                    <Chip label="Conflictos" value={blockingConflicts.length} tone="red" />
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
                      <div>
                        <span className="font-semibold">{entry.bedId}</span> —{' '}
                        {entry.patient.patientName}
                        {entry.isCma && <span className="ml-1 text-teal-600">(CMA)</span>}
                      </div>
                      {entry.patient.clinicalCrib?.patientName && (
                        <div className="ml-4 text-gray-600">
                          ↳ Cuna RN — {entry.patient.clinicalCrib.patientName}
                        </div>
                      )}
                    </li>
                  ))}
                </Section>

                <Section title="Actualizaciones" count={presentedUpdates.length}>
                  {presentedUpdates.map(entry => (
                    <li key={updateEntryKey(entry)}>
                      <span className="font-semibold">{entry.bedId}</span> — {entry.patientName}:{' '}
                      <span className="text-gray-400">{entry.visibleLabels.join(', ')}</span>
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
                      {entry.associatedClinicalCrib && (
                        <div className="ml-4 text-gray-600">
                          ↳ Alta asociada — {entry.associatedClinicalCrib.patientName}{' '}
                          <span className="text-gray-400">(cuna RN; no suma egreso)</span>
                        </div>
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

                <HistoricalReconstructionReview conflicts={historicalConflicts} />

                <Section title="Cambios que requieren revisión" count={blockingConflicts.length}>
                  {blockingConflicts.map((entry, index) => (
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
                      Los ingresos de madrugada pertenecen al turno noche anterior y los egresos
                      conservan su día clínico oficial. Al confirmar se grabarán también en el día
                      correspondiente de Rapa Nui.
                    </p>
                    <ul className="space-y-1 text-sm text-amber-900">
                      {previousDayEdits.map(edit => (
                        <li key={`${edit.day}-${edit.reason}`}>
                          <span className="font-semibold tabular-nums">{ddmmyyyy(edit.day)}</span> —{' '}
                          <span className="font-medium">
                            {edit.reason === 'admission-night-shift-correction'
                              ? 'Ingreso turno noche: '
                              : 'Egreso: '}
                          </span>
                          {edit.patientNames.join(', ')}
                          {!edit.withinEditingWindow && (
                            <span className="ml-1 font-medium text-red-600">
                              (requiere administrador — se omitirá)
                            </span>
                          )}
                          {edit.isSigned && (
                            <span className="ml-1 font-medium text-red-600">
                              (día ya firmado — se omitirá)
                            </span>
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
            {showAppliedConflicts && (
              <div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {blockingConflicts.length > 0
                    ? 'Los demás cambios fueron aplicados. Los conflictos pendientes se conservaron sin modificaciones.'
                    : 'Los cambios verificables fueron aplicados. Los pacientes indicados se conservaron sin modificaciones.'}
                </div>
                <HistoricalReconstructionReview conflicts={historicalConflicts} />
                <Section title="Conflictos pendientes" count={blockingConflicts.length}>
                  {blockingConflicts.map((entry, index) => (
                    <li key={`pending-con-${index}`} className="text-amber-900">
                      {entry.bedId ? `${entry.bedId}: ` : ''}
                      {entry.reason}
                    </li>
                  ))}
                </Section>
              </div>
            )}
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
          disabled={isBusy}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {!hasChanges || isApplied ? 'Listo' : 'Cancelar'}
        </button>
        {showReview && hasChanges && (
          <button
            type="button"
            // Today's changes always apply; the días-previos ack only gates the historical copy.
            onClick={() => {
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
