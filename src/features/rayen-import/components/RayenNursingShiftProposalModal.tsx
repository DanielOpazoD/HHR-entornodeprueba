import React from 'react';
import { Moon, Sun, UserRoundCheck } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type {
  NursingStaffingProposal,
  NursingShiftEvidence,
  NursingShiftSuggestion,
} from '../contracts/nursingShiftInference';
import { StaffingBoundaryExclusions } from './StaffingBoundaryExclusions';
import {
  hasUnresolvedStaffingAmbiguity,
  NURSING_STAFFING_STANDARD_SLOTS,
} from '../domain/staffingSlotPolicy';

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
  roleLabel: string;
  standardSlots: number;
}> = ({ label, suggestion, icon, roleLabel, standardSlots }) => {
  const alreadyAssigned = suggestion.alreadyAssigned ?? [];
  const hasUnresolvedAmbiguity = hasUnresolvedStaffingAmbiguity(suggestion, standardSlots);
  if (
    suggestion.names.length === 0 &&
    alreadyAssigned.length === 0 &&
    !hasUnresolvedAmbiguity &&
    suggestion.ignoredBoundaryRecords === 0
  )
    return null;
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 p-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        {icon}
        {roleLabel} · {label}
      </h4>
      {alreadyAssigned.length > 0 && (
        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          Ya sincronizado en HHR: {alreadyAssigned.join(', ')}.
        </p>
      )}
      {suggestion.replaceStandardSlots && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Se reemplazará la asignación actual: {(suggestion.currentNames ?? []).join(', ')}.
        </p>
      )}
      <ul className="mt-2 divide-y divide-slate-100">
        {suggestion.names.map(name => {
          const evidence = evidenceFor(suggestion, name);
          return (
            <li key={name} className="py-1.5 text-sm">
              {evidence ? (
                <details>
                  <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
                    <span className="font-semibold text-slate-800">{name}</span>
                  </summary>
                  <p className="mt-1 text-xs text-slate-500">
                    {evidence.records} registros · {evidence.patients} pacientes ·{' '}
                    {evidence.activeHours} bloques horarios
                    {evidence.catalogMatched ? ' · coincide con nómina HHR' : ''}
                  </p>
                </details>
              ) : (
                <p className="font-semibold text-slate-800">{name}</p>
              )}
            </li>
          );
        })}
      </ul>
      {suggestion.ignoredBoundaryRecords > 0 && (
        <div className="text-xs">
          <p className="sr-only">Firmas del relevo excluidas de la propuesta.</p>
          <StaffingBoundaryExclusions
            total={suggestion.ignoredBoundaryRecords}
            evidence={suggestion.ignoredBoundaryEvidence ?? []}
          />
        </div>
      )}
      {hasUnresolvedAmbiguity && (
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
    proposal &&
    [proposal.day, proposal.night, proposal.tensDay, proposal.tensNight].some(
      suggestion => (suggestion?.names.length ?? 0) > 0
    )
  );
  const hasAmbiguousSuggestions = Boolean(
    proposal &&
    (hasUnresolvedStaffingAmbiguity(proposal.day, NURSING_STAFFING_STANDARD_SLOTS.day) ||
      hasUnresolvedStaffingAmbiguity(proposal.night, NURSING_STAFFING_STANDARD_SLOTS.night) ||
      (proposal.tensDay != null &&
        hasUnresolvedStaffingAmbiguity(
          proposal.tensDay,
          NURSING_STAFFING_STANDARD_SLOTS.tensDay
        )) ||
      (proposal.tensNight != null &&
        hasUnresolvedStaffingAmbiguity(
          proposal.tensNight,
          NURSING_STAFFING_STANDARD_SLOTS.tensNight
        )))
  );
  const hasBoundaryExclusions = Boolean(
    proposal &&
    [proposal.day, proposal.night, proposal.tensDay, proposal.tensNight].some(
      suggestion => (suggestion?.ignoredBoundaryRecords ?? 0) > 0
    )
  );
  const replacesExisting = Boolean(
    proposal &&
    [proposal.day, proposal.night, proposal.tensDay, proposal.tensNight].some(
      suggestion => suggestion?.replaceStandardSlots
    )
  );
  if (!proposal || (!hasVacanciesToComplete && !hasAmbiguousSuggestions && !hasBoundaryExclusions))
    return null;

  return (
    <BaseModal
      isOpen
      onClose={() => {
        if (!isBusy) onCancel();
      }}
      title="Dotación clínica identificada"
      icon={<UserRoundCheck size={20} />}
      size="3xl"
      bodyClassName="!max-h-[calc(100dvh-6rem)] !overflow-hidden flex min-h-0 flex-col"
      variant="white"
      headerIconColor="text-teal-600"
      dataModule="rayen-import"
      dataTestId="rayen-nursing-shift-proposal"
      closeOnBackdrop={!isBusy}
      showCloseButton={!isBusy}
    >
      <section
        className="min-h-0 overflow-y-auto px-4 py-3"
        data-module="rayen-import"
        aria-labelledby="rayen-nursing-shift-title"
      >
        <h3 id="rayen-nursing-shift-title" className="sr-only">
          Propuesta de dotación clínica
        </h3>
        <p className="mb-3 text-xs text-slate-600">
          Propuesta según firmas de Eloísa.{' '}
          {replacesExisting
            ? 'Se reemplazarán los cupos indicados; los cupos adicionales no cambiarán.'
            : 'Solo se completarán los cupos vacantes.'}
        </p>
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <ShiftSuggestion
            label="Turno largo"
            roleLabel="Enfermería"
            suggestion={proposal.day}
            standardSlots={NURSING_STAFFING_STANDARD_SLOTS.day}
            icon={<Sun size={16} className="text-amber-500" aria-hidden="true" />}
          />
          <ShiftSuggestion
            label="Turno noche"
            roleLabel="Enfermería"
            suggestion={proposal.night}
            standardSlots={NURSING_STAFFING_STANDARD_SLOTS.night}
            icon={<Moon size={16} className="text-slate-500" aria-hidden="true" />}
          />
          {proposal.tensDay && (
            <ShiftSuggestion
              label="Turno largo"
              roleLabel="TENS"
              suggestion={proposal.tensDay}
              standardSlots={NURSING_STAFFING_STANDARD_SLOTS.tensDay}
              icon={<Sun size={16} className="text-amber-500" aria-hidden="true" />}
            />
          )}
          {proposal.tensNight && (
            <ShiftSuggestion
              label="Turno noche"
              roleLabel="TENS"
              suggestion={proposal.tensNight}
              standardSlots={NURSING_STAFFING_STANDARD_SLOTS.tensNight}
              icon={<Moon size={16} className="text-slate-500" aria-hidden="true" />}
            />
          )}
        </div>
        {error && (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            role="alert"
          >
            {error}
          </p>
        )}
      </section>
      <footer className="shrink-0 border-t border-slate-100 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-slate-500">
            La decisión quedará en el historial.
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-60"
          >
            {hasVacanciesToComplete ? 'Mantener actual' : 'Entendido'}
          </button>
          {hasVacanciesToComplete && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={isBusy}
              className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-progress disabled:opacity-60"
            >
              {isBusy ? 'Aplicando…' : 'Aplicar propuesta'}
            </button>
          )}
        </div>
      </footer>
    </BaseModal>
  );
};
