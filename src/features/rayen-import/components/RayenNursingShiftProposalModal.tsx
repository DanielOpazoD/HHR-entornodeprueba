import React from 'react';
import { Moon, Sun, UserRoundCheck } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type {
  NursingStaffingProposal,
  NursingShiftEvidence,
  NursingShiftSuggestion,
} from '../contracts/nursingShiftInference';

interface RayenNursingShiftProposalModalProps {
  proposal: NursingStaffingProposal | null;
  isBusy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const evidenceFor = (
  suggestion: NursingShiftSuggestion,
  name: string
): NursingShiftEvidence | undefined =>
  suggestion.candidates.find(candidate => candidate.name === name);

const ShiftSuggestion: React.FC<{
  label: string;
  suggestion: NursingShiftSuggestion;
  icon: React.ReactNode;
}> = ({ label, suggestion, icon }) => {
  const alreadyAssigned = suggestion.alreadyAssigned ?? [];
  if (suggestion.names.length === 0 && alreadyAssigned.length === 0 && !suggestion.ambiguous)
    return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        {icon}
        {label}
      </h4>
      {alreadyAssigned.length > 0 && (
        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          Ya sincronizado en HHR: {alreadyAssigned.join(', ')}.
        </p>
      )}
      <ul className="mt-2 space-y-2">
        {suggestion.names.map(name => {
          const evidence = evidenceFor(suggestion, name);
          return (
            <li
              key={name}
              className="rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100"
            >
              <p className="font-semibold text-slate-800">{name}</p>
              {evidence && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {evidence.records} registros · {evidence.patients} pacientes ·{' '}
                  {evidence.activeHours} bloques horarios
                  {evidence.catalogMatched ? ' · coincide con nómina HHR' : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {suggestion.ignoredBoundaryRecords > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Se excluyeron {suggestion.ignoredBoundaryRecords} registros cercanos al relevo por ser
          temporalmente ambiguos.
        </p>
      )}
      {suggestion.ambiguous && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Un cupo quedó sin sugerencia porque hay profesionales con la misma evidencia.
        </p>
      )}
    </section>
  );
};

export const RayenNursingShiftProposalModal: React.FC<RayenNursingShiftProposalModalProps> = ({
  proposal,
  isBusy,
  error,
  onConfirm,
  onCancel,
}) => {
  const hasVacanciesToComplete = Boolean(
    proposal && (proposal.day.names.length > 0 || proposal.night.names.length > 0)
  );
  if (!proposal || !hasVacanciesToComplete) return null;

  return (
    <BaseModal
      isOpen
      onClose={onCancel}
      title="Enfermería identificada"
      icon={<UserRoundCheck size={20} />}
      size="md"
      variant="white"
      headerIconColor="text-teal-600"
      dataModule="rayen-import"
      dataTestId="rayen-nursing-shift-proposal"
      closeOnBackdrop={!isBusy}
      showCloseButton={!isBusy}
    >
      <section
        className="space-y-3"
        data-module="rayen-import"
        aria-labelledby="rayen-nursing-shift-title"
      >
        <h3 id="rayen-nursing-shift-title" className="sr-only">
          Propuesta de enfermería
        </h3>
        <p className="text-sm leading-relaxed text-slate-600">
          La sugerencia usa actividad registrada fuera de las ventanas ambiguas del cambio de turno.
          Al confirmar se completarán únicamente los cupos que continúen vacantes.
        </p>
        <ShiftSuggestion
          label="Turno largo"
          suggestion={proposal.day}
          icon={<Sun size={16} className="text-amber-500" aria-hidden="true" />}
        />
        <ShiftSuggestion
          label="Turno noche"
          suggestion={proposal.night}
          icon={<Moon size={16} className="text-slate-500" aria-hidden="true" />}
        />
        {error && (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            Mantener actual
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-progress disabled:opacity-60"
          >
            {isBusy ? 'Aplicando…' : 'Aplicar propuesta'}
          </button>
        </div>
        <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          La decisión quedará registrada en el historial de sincronización.
        </p>
      </section>
    </BaseModal>
  );
};
