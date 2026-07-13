import React from 'react';
import { RefreshCw } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { CensusImportDiff } from '../contracts/censusImportDiff';

export interface RayenImportPreviewModalProps {
  isOpen: boolean;
  diff: CensusImportDiff | null;
  isBusy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const dischargeKindLabel: Record<string, string> = {
  alta: 'Alta',
  traslado: 'Traslado a otro hospital',
  cma: 'Egreso CMA',
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
  const [acceptedPreviousDays, setAcceptedPreviousDays] = React.useState(false);
  React.useEffect(() => {
    if (isOpen) setAcceptedPreviousDays(false);
  }, [isOpen]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      title="Importar censo desde Rayen"
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
                label="Pend. alta enfermería"
                value={diff.summary.pendingNursingDischarges}
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
                  <span className="font-semibold">{entry.bedId}</span> — {entry.patientName}:{' '}
                  {dischargeKindLabel[entry.kind] ?? entry.kind}
                  {entry.status === 'Fallecido' && (
                    <span className="ml-1 text-red-600">(Fallecido)</span>
                  )}
                  {entry.reason === 'missing-in-rayen' && (
                    <span className="ml-1 text-amber-600">(ausente en Rayen — revisar)</span>
                  )}
                </li>
              ))}
            </Section>

            <Section
              title="Pendientes de alta de enfermería (se mantienen en cama)"
              count={diff.pendingNursingDischarges.length}
            >
              {diff.pendingNursingDischarges.map(entry => (
                <li key={`pnd-${entry.bedId}-${entry.rut}`}>
                  <span className="font-semibold">{entry.bedId}</span> — {entry.patientName}:{' '}
                  <span className="text-gray-500">alta médica</span>
                  {entry.kind !== 'alta' && (
                    <span className="ml-1 text-teal-600">
                      ({dischargeKindLabel[entry.kind] ?? entry.kind})
                    </span>
                  )}
                  {entry.status === 'Fallecido' && (
                    <span className="ml-1 text-red-600">(Fallecido)</span>
                  )}
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
              title="Egresos del día no registrados en HHR (se agregarán a altas)"
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
                      <span className="font-semibold tabular-nums">{edit.day}</span> —{' '}
                      {edit.patientNames.join(', ')}
                      {!edit.withinEditingWindow && (
                        <span className="ml-1 font-medium text-red-600">
                          (requiere administrador — se omitirá)
                        </span>
                      )}
                      {edit.isSigned && (
                        <span className="ml-1 text-amber-600">(día ya firmado)</span>
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
          onClick={onConfirm}
          disabled={isBusy || !hasChanges || (needsPreviousDayAck && !acceptedPreviousDays)}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {isBusy ? 'Aplicando…' : 'Confirmar e importar'}
        </button>
      </div>
    </BaseModal>
  );
};
