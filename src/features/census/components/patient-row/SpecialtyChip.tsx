/**
 * SpecialtyChip — the patient's clinical specialty shown next to "FI:" in the identity cell.
 *
 * Rediseño 2026: each specialty gets its own color so the census reads at a glance. When a patient
 * has no specialty yet, it shows an amber "Pendiente asignar" chip; clicking either chip opens a
 * small popover to pick/change it. The value is written through the same field handler the diagnosis
 * editor uses (`onAssign` → onNameChange('specialty')), so it coalesces and persists identically.
 *
 * Con los flags de asignación por episodio activos, el chip muestra el origen de la decisión
 * (automática/manual/IA) y el popover añade: recomendación consultiva de IA (backend, solo
 * pacientes pendientes) y "recordar asociación" CIE-10→especialidad con doble confirmación.
 */

import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  SPECIALTY_OPTIONS,
  SPECIALTY_CHIP_STYLES,
  SPECIALTY_CHIP_FALLBACK,
} from '@/constants/clinicalSpecialtyConstants';
import { isFeatureEnabled } from '@/services/utils/featureFlags';
import { useSpecialtyAssignmentActions } from '@/features/census/hooks/useSpecialtyAssignmentActions';
import type { PatientData } from '@/types/domain/patient';

interface SpecialtyChipProps {
  specialty: string;
  readOnly?: boolean;
  onAssign: (value: string) => void;
  /** Contexto del episodio — activa badge de origen y acciones IA/memoria. */
  patient?: PatientData;
  recordDate?: string;
  isSubRow?: boolean;
}

const styleFor = (specialty: string): string =>
  SPECIALTY_CHIP_STYLES[specialty] ?? SPECIALTY_CHIP_FALLBACK;

const ORIGIN_BADGE: Record<string, { label: string; title: string; className: string }> = {
  automatic_locked: {
    label: 'A',
    title: 'Especialidad asignada automáticamente (regla aprobada)',
    className: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  manual_locked: {
    label: 'M',
    title: 'Especialidad confirmada manualmente',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  ai_recommendation: {
    label: 'IA',
    title: 'Especialidad aceptada desde una recomendación de IA',
    className: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  legacy_protected: {
    label: '·',
    title: 'Especialidad heredada (protegida de cambios automáticos)',
    className: 'bg-slate-50 text-slate-400 ring-slate-200',
  },
};

const AssignmentActions: React.FC<{
  patient: PatientData;
  recordDate: string;
  isSubRow: boolean;
  onAccept: (value: string) => void;
}> = ({ patient, recordDate, isSubRow, onAccept }) => {
  const actions = useSpecialtyAssignmentActions(patient, recordDate, isSubRow);
  const rec = actions.recommendation;
  const aiEnabled = isFeatureEnabled('SPECIALTY_AI_RECOMMENDATION');
  const memoryEnabled = isFeatureEnabled('SPECIALTY_RULES_MEMORY');
  const canRemember = memoryEnabled && !actions.pending && !!patient.cie10Code?.trim();

  if (!aiEnabled && !memoryEnabled) return null;

  return (
    <div className="mt-1 border-t border-slate-100 pt-1">
      {aiEnabled && actions.pending && !rec && (
        <button
          type="button"
          disabled={actions.busy}
          onClick={() => void actions.requestAiRecommendation()}
          className="w-full rounded px-1.5 py-1 text-left text-[11px] text-violet-700 hover:bg-violet-50 disabled:opacity-50"
        >
          {actions.busy ? 'Consultando…' : 'Sugerir con IA'}
        </button>
      )}
      {rec && (
        <div className="rounded bg-violet-50/60 p-1.5">
          <p className="mb-1 text-[10px] font-semibold text-violet-700">
            Sugerencia IA ({rec.candidates.length} opción{rec.candidates.length === 1 ? '' : 'es'})
          </p>
          {rec.candidates.map(candidate => (
            <button
              key={candidate.specialty}
              type="button"
              disabled={actions.busy}
              onClick={() =>
                void actions.acceptAiCandidate(candidate.specialty).then(ok => {
                  if (ok) onAccept(candidate.specialty);
                })
              }
              className="flex w-full items-center justify-between gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-white disabled:opacity-50"
            >
              <span>{candidate.specialty}</span>
              <span className="text-[9px] uppercase text-slate-400">{candidate.certainty}</span>
            </button>
          ))}
          <button
            type="button"
            disabled={actions.busy}
            onClick={() => void actions.discardRecommendation()}
            className="mt-0.5 w-full rounded px-1 py-0.5 text-left text-[10px] text-slate-400 hover:bg-white"
          >
            Descartar sugerencia
          </button>
        </div>
      )}
      {actions.requestError && (
        <p className="px-1.5 py-0.5 text-[10px] text-amber-600">{actions.requestError}</p>
      )}
      {canRemember && (
        <button
          type="button"
          disabled={actions.busy}
          onClick={() => void actions.rememberCurrentAssociation()}
          className="w-full rounded px-1.5 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          title="Crear regla memoria: este diagnóstico CIE-10 sugerirá esta especialidad en futuros pacientes"
        >
          {actions.memoryConfirmArmed
            ? 'Confirmar: recordar asociación'
            : 'Recordar asociación diagnóstico → especialidad'}
        </button>
      )}
    </div>
  );
};

export const SpecialtyChip: React.FC<SpecialtyChipProps> = ({
  specialty,
  readOnly = false,
  onAssign,
  patient,
  recordDate,
  isSubRow = false,
}) => {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const trimmed = specialty.trim();
  const assigned = trimmed.length > 0;
  const episodeUiEnabled =
    isFeatureEnabled('SPECIALTY_EPISODE_ASSIGNMENT') && !!patient && !!recordDate;

  const select = (value: string): void => {
    onAssign(value);
    setOpen(false);
  };

  const originKey = episodeUiEnabled
    ? patient!.specialtyAssignment?.state === 'manual_locked' &&
      patient!.specialtyAssignment.selectionOrigin === 'ai_recommendation'
      ? 'ai_recommendation'
      : (patient!.specialtyAssignment?.state ?? (assigned ? 'legacy_protected' : ''))
    : '';
  const originBadge = originKey ? ORIGIN_BADGE[originKey] : undefined;

  const chip = (
    <>
      {assigned ? (
        <span
          className={clsx(
            'truncate rounded px-1 py-px text-[9px] font-medium ring-1',
            styleFor(trimmed),
            !readOnly && 'cursor-pointer'
          )}
        >
          {trimmed}
        </span>
      ) : (
        <span
          className={clsx(
            'inline-flex items-center gap-0.5 rounded border border-dashed border-amber-300 bg-amber-50/60 px-1 py-px text-[9px] font-medium text-amber-600',
            !readOnly && 'cursor-pointer hover:bg-amber-100'
          )}
        >
          Pendiente asignar
        </span>
      )}
      {originBadge && originBadge.label !== '·' && (
        <span
          className={clsx('rounded px-0.5 text-[8px] font-bold ring-1', originBadge.className)}
          title={originBadge.title}
        >
          {originBadge.label}
        </span>
      )}
    </>
  );

  if (readOnly) {
    return (
      <span
        className="flex min-w-0 items-center gap-1"
        title={assigned ? `Especialidad: ${trimmed}` : 'Sin especialidad'}
      >
        {chip}
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          setOpen(current => !current);
        }}
        className="inline-flex min-w-0 items-center gap-0.5"
        title={assigned ? `Especialidad: ${trimmed}` : 'Asignar especialidad'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {chip}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-[60] cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Asignar especialidad"
            className="absolute left-0 top-full z-[61] mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg"
          >
            <div className="flex flex-col">
              {SPECIALTY_OPTIONS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => select(option)}
                  className={clsx(
                    'flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-50',
                    option === trimmed && 'font-semibold'
                  )}
                >
                  <span
                    className={clsx('h-2 w-2 shrink-0 rounded-full ring-1', styleFor(option))}
                  />
                  {option}
                </button>
              ))}
            </div>
            {episodeUiEnabled && (
              <AssignmentActions
                patient={patient!}
                recordDate={recordDate!}
                isSubRow={isSubRow}
                onAccept={select}
              />
            )}
          </div>
        </>
      )}
    </span>
  );
};
