/**
 * SpecialtyChip — the patient's clinical specialty shown next to "FI:" in the identity cell.
 *
 * Rediseño 2026: each specialty gets its own color so the census reads at a glance. When a patient
 * has no specialty yet, it shows an amber "Pendiente asignar" chip; clicking either chip opens a
 * small popover to pick/change it. The value is written through the same field handler the diagnosis
 * editor uses (`onAssign` → onNameChange('specialty')). In episode mode the
 * server confirms an explicit, episode-bound decision before it is durable.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import type { SpecialtyDecisionMeta } from '@/types/domain/specialtyDecision';
import type { SpecialtyTarget } from '@/services/specialty/specialtyJevClient';
import { SpecialtyBadge, SpecialtyMemoryControls } from './SpecialtyActionControls';
import {
  SPECIALTY_OPTIONS,
  SPECIALTY_CHIP_STYLES,
  SPECIALTY_CHIP_FALLBACK,
} from '@/constants/clinicalSpecialtyConstants';

interface SpecialtyChipProps {
  specialty: string;
  decision?: SpecialtyDecisionMeta;
  readOnly?: boolean;
  onAssign: (value: string) => void;
  scope?: SpecialtyTarget;
  cie10Code?: string;
}

const styleFor = (specialty: string): string =>
  SPECIALTY_CHIP_STYLES[specialty] ?? SPECIALTY_CHIP_FALLBACK;

export const SpecialtyChip: React.FC<SpecialtyChipProps> = ({
  specialty,
  decision,
  readOnly = false,
  onAssign,
  scope,
  cie10Code,
}) => {
  const [open, setOpen] = useState(false);
  const episodeMode = useFeatureFlag('SPECIALTY_EPISODE_ASSIGNMENT');
  const memoryMode = useFeatureFlag('SPECIALTY_RULES_MEMORY');
  const [canPublish, setCanPublish] = useState(false);
  const [confirmMemory, setConfirmMemory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'error' | 'success'>('error');
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const operationGenerationRef = useRef(0);

  const scopeKey = scope
    ? `${scope.date}|${scope.bedId}|${scope.target}|${scope.episodeId}|${decision?.decisionId ?? ''}|${cie10Code?.trim().toUpperCase() ?? ''}`
    : '';
  useLayoutEffect(() => {
    operationGenerationRef.current += 1;
    if (popoverRef.current?.contains(document.activeElement)) anchorRef.current?.focus();
    setOpen(false);
    setMessage('');
    setConfirmMemory(false);
    setBusy(false);
  }, [scopeKey]);

  const closePopover = useCallback(() => {
    if (popoverRef.current?.contains(document.activeElement)) anchorRef.current?.focus();
    setOpen(false);
  }, []);
  useEffect(() => {
    if (open) popoverRef.current?.focus();
  }, [open]);
  const resolvePosition = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return null;
    const width = popoverRef.current?.offsetWidth ?? 288;
    const height = popoverRef.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 4;
    const top =
      below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, Math.min(anchor.top - height - 4, window.innerHeight - height - 8));
    return { top, left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) };
  }, []);
  const { position, updatePosition } = usePortalPopoverRuntime({
    isOpen: open,
    anchorRef,
    popoverRef,
    initialPosition: { top: 8, left: 8 },
    resolvePosition,
    onClose: closePopover,
  });
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!memoryMode || !open) return;
    let active = true;
    void (async () => {
      try {
        const [{ defaultAuthRuntime }, { resolveFirebaseUserRole }] = await Promise.all([
          import('@/services/firebase-runtime/authRuntime'),
          import('@/services/auth/authAccessResolution'),
        ]);
        await defaultAuthRuntime.ready;
        const user = defaultAuthRuntime.getCurrentUser();
        const role = user ? await resolveFirebaseUserRole(user) : null;
        if (active) setCanPublish(role === 'admin');
      } catch {
        if (active) setCanPublish(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [memoryMode, open]);

  const trimmed = specialty.trim();
  const assigned = trimmed.length > 0;
  const canChoose = !episodeMode || Boolean(scope?.episodeId);

  const select = (value: string): void => {
    onAssign(value);
    closePopover();
  };

  const remember = async (): Promise<void> => {
    if (!scope || !assigned || !canPublish || !cie10Code || !decision?.decisionId || busy) return;
    const generation = operationGenerationRef.current;
    setBusy(true);
    setMessage('');
    setMessageTone('error');
    try {
      const { publishSpecialtyMemory } = await import('@/services/specialty/specialtyJevClient');
      await publishSpecialtyMemory(
        scope,
        trimmed,
        cie10Code.toUpperCase().replace(/\s+/g, ''),
        decision.decisionId
      );
      if (operationGenerationRef.current !== generation) return;
      setConfirmMemory(false);
      setMessageTone('success');
      setMessage(
        'Memoria publicada. Se aplicará sólo si está habilitada y no hay reglas en conflicto.'
      );
    } catch {
      if (operationGenerationRef.current === generation) {
        setMessage(
          'No se publicó la regla. Revisa el código CIE-10, permisos y versión del catálogo.'
        );
      }
    } finally {
      if (operationGenerationRef.current === generation) setBusy(false);
    }
  };

  if (readOnly) {
    return (
      <SpecialtyBadge specialty={trimmed} decision={episodeMode ? decision : undefined} readOnly />
    );
  }

  return (
    <span className="inline-flex">
      <button
        ref={anchorRef}
        type="button"
        onClick={event => {
          event.stopPropagation();
          setOpen(current => !current);
        }}
        className="inline-flex min-w-0 items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        title={assigned ? `Especialidad: ${trimmed}` : 'Asignar especialidad'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <SpecialtyBadge specialty={trimmed} decision={episodeMode ? decision : undefined} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Asignar especialidad"
            tabIndex={-1}
            className="fixed z-[110] max-h-[calc(100vh-16px)] w-72 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl print:hidden"
            style={position}
            onClick={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="mb-2 border-b border-slate-100 px-1 pb-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">Especialidad del episodio</p>
                <button
                  type="button"
                  onClick={closePopover}
                  className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  aria-label="Cerrar selector de especialidad"
                >
                  Cerrar
                </button>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {decision?.source === 'rule'
                  ? 'Asignada por regla del catálogo'
                  : decision?.source === 'manual_ai'
                    ? 'Sugerencia Jev confirmada por un profesional'
                    : decision?.source === 'manual'
                      ? 'Decisión manual confirmada'
                      : 'Selecciona una especialidad para este paciente.'}
              </p>
              {!canChoose && (
                <p role="status" className="mt-1 text-[11px] text-amber-700">
                  Espera a que se confirme el episodio clínico para asignar una especialidad.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              {SPECIALTY_OPTIONS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => select(option)}
                  disabled={busy || !canChoose}
                  aria-pressed={option === trimmed}
                  className={clsx(
                    'flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50',
                    option === trimmed && 'bg-teal-50 font-semibold text-teal-900'
                  )}
                >
                  <span
                    className={clsx('h-2 w-2 shrink-0 rounded-full ring-1', styleFor(option))}
                  />
                  {option}
                </button>
              ))}
              {episodeMode && (
                <button
                  type="button"
                  onClick={() => select('')}
                  disabled={busy || !canChoose}
                  className="min-h-8 rounded-md px-2 py-1 text-left text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Dejar sin asignar
                </button>
              )}
              {episodeMode &&
                memoryMode &&
                canPublish &&
                assigned &&
                ['manual', 'manual_ai'].includes(decision?.source ?? '') &&
                scope &&
                cie10Code && (
                  <SpecialtyMemoryControls
                    busy={busy}
                    confirmMemory={confirmMemory}
                    onConfirmChange={setConfirmMemory}
                    onRemember={() => void remember()}
                  />
                )}
              {message && (
                <p
                  role={messageTone === 'error' ? 'alert' : 'status'}
                  className={clsx(
                    'px-1.5 py-1 text-[11px]',
                    messageTone === 'success' ? 'text-emerald-700' : 'text-red-700'
                  )}
                >
                  {message}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </span>
  );
};
