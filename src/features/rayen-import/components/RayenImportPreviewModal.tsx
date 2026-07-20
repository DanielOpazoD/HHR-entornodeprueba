import React from 'react';
import { CheckCircle2, CircleHelp, CircleMinus, RefreshCw } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type {
  CensusImportDiff,
  DischargeVerification,
  DischargeVerificationState,
} from '../contracts/censusImportDiff';

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

/** ISO "YYYY-MM-DD" → "DD-MM-YYYY" for display in the sync dialog. */
const ddmmyyyy = (iso?: string): string => {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso ?? '');
};

interface ChipProps {
  label: string;
  value: number;
  tone: 'green' | 'blue' | 'amber' | 'gray' | 'red' | 'teal' | 'indigo';
}

const TONES: Record<ChipProps['tone'], string> = {
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-800',
  gray: 'bg-gray-100 text-gray-700',
  red: 'bg-red-100 text-red-800',
  teal: 'bg-teal-100 text-teal-800',
  indigo: 'bg-indigo-100 text-indigo-800',
};

const Chip: React.FC<ChipProps> = ({ label, value, tone }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${TONES[tone]}`}
  >
    <span className="font-bold tabular-nums">{value}</span>
    {label}
  </span>
);

const Section: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({
  title,
  count,
  children,
}) => {
  if (count === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-1 text-sm font-semibold text-gray-700">
        {title} <span className="text-gray-400">({count})</span>
      </h4>
      <ul className="space-y-1 text-sm text-gray-600">{children}</ul>
    </div>
  );
};

const verificationPresentation: Record<
  DischargeVerificationState,
  { Icon: typeof CheckCircle2; className: string; suffix: string }
> = {
  confirmed: {
    Icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    suffix: 'confirmado',
  },
  'not-detected': {
    Icon: CircleMinus,
    className: 'border-slate-200 bg-slate-50 text-slate-500',
    suffix: 'no detectado',
  },
  unknown: {
    Icon: CircleHelp,
    className: 'border-slate-200 bg-white text-slate-500',
    suffix: 'sin dato',
  },
};

const VerificationBadges: React.FC<{ verification: DischargeVerification }> = ({
  verification,
}) => {
  const items = [
    ['Epicrisis médica', verification.medicalEpicrisis],
    ['Epicrisis enfermería', verification.nursingEpicrisis],
    ['Egreso hospitalario', verification.hospitalDischarge],
  ] as const;
  return (
    <div
      className="mt-1 flex flex-wrap gap-1.5"
      role="group"
      aria-label="Verificación documental del egreso"
    >
      {items.map(([label, state]) => {
        const { Icon, className, suffix } = verificationPresentation[state];
        return (
          <span
            key={label}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${className}`}
            title={`${label}: ${suffix}`}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{label}</span>
            <span className="sr-only">: {suffix}</span>
          </span>
        );
      })}
    </div>
  );
};

export const RayenImportPreviewModal: React.FC<RayenImportPreviewModalProps> = ({
  isOpen,
  diff,
  isBusy,
  error,
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

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      title="Sincronizar censo · Eloísa"
      icon={<RefreshCw size={20} />}
      size="2xl"
      variant="white"
      headerIconColor="text-teal-600"
      dataModule="rayen-import"
      dataTestId="rayen-import-preview"
    >
      <div className="max-h-[60vh] overflow-y-auto">
        {!diff ? (
          <p className="text-sm text-gray-500">Esperando datos de Rayen…</p>
        ) : (
          <>
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
                  <span className="font-semibold">{entry.bedId}</span> — {entry.patient.patientName}
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
                  {entry.patientName}: <span className="font-semibold">{entry.fromBedId}</span> →{' '}
                  <span className="font-semibold">{entry.toBedId}</span>
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
                        {entry.correctedTime ? ` ${entry.correctedTime} (hora isla)` : ''}, no hoy
                      </span>
                    )}
                  </div>
                  {entry.verification && <VerificationBadges verification={entry.verification} />}
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
          </>
        )}

        {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          // Today's changes (ingresos/movimientos/egresos) always apply; the días-previos ack only
          // gates whether the past-day corrections are also filed — it never blocks the confirm.
          onClick={() => onConfirm(acceptedPreviousDays)}
          disabled={isBusy || !hasChanges}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {isBusy ? 'Aplicando…' : 'Confirmar e importar'}
        </button>
      </div>
    </BaseModal>
  );
};
