/**
 * SpecialtyChip — the patient's clinical specialty shown next to "FI:" in the identity cell.
 *
 * Rediseño 2026: each specialty gets its own color so the census reads at a glance. When a patient
 * has no specialty yet, it shows an amber "Pendiente asignar" chip; clicking either chip opens a
 * small popover to pick/change it. The value is written through the same field handler the diagnosis
 * editor uses (`onAssign` → onNameChange('specialty')), so it coalesces and persists identically.
 */

import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import type { SpecialtyDecisionMeta } from '@/types/domain/specialtyDecision';
import type { JevSuggestion, SpecialtyTarget } from '@/services/specialty/specialtyJevClient';
import { resolveFirebaseUserRole } from '@/services/auth/authAccessResolution';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
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
  const jevMode = useFeatureFlag('SPECIALTY_JEV_CONSULTATION');
  const memoryMode = useFeatureFlag('SPECIALTY_RULES_MEMORY');
  const [canPublish, setCanPublish] = useState(false);
  const [confirmMemory, setConfirmMemory] = useState(false);
  const [suggestion, setSuggestion] = useState<{ requestId: string; result: JevSuggestion } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const jevRequestIdRef = useRef<string | null>(null);

  const scopeKey = scope
    ? `${scope.date}|${scope.bedId}|${scope.target}|${scope.episodeId}|${decision?.decisionId ?? ''}`
    : '';
  useEffect(() => {
    jevRequestIdRef.current = null;
    setSuggestion(null);
    setMessage('');
    setConfirmMemory(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!memoryMode || !open) return;
    let active = true;
    void (async () => {
      try {
        await defaultAuthRuntime.ready;
        const user = defaultAuthRuntime.getCurrentUser();
        const role = user ? await resolveFirebaseUserRole(user) : null;
        if (active) setCanPublish(role === 'admin');
      } catch { if (active) setCanPublish(false); }
    })();
    return () => { active = false; };
  }, [memoryMode, open]);

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

  const select = (value: string): void => {
    jevRequestIdRef.current = null;
    setSuggestion(null);
    onAssign(value);
    setOpen(false);
  };

  const consult = async (): Promise<void> => {
    if (!scope || busy) return;
    setBusy(true);
    setMessage('');
    let jevService: typeof import('@/services/specialty/specialtyJevClient') | null = null;
    try {
      const requestId = suggestion ? crypto.randomUUID()
        : (jevRequestIdRef.current ?? crypto.randomUUID());
      jevRequestIdRef.current = requestId;
      jevService = await import('@/services/specialty/specialtyJevClient');
      const result = await jevService.requestSpecialtySuggestion(scope, requestId);
      setSuggestion({ requestId, result });
    } catch (error) {
      if (jevService && error instanceof jevService.JevSuggestionUnavailableError) {
        jevRequestIdRef.current = null;
      }
      setMessage('No se pudo consultar Jev. La asignación manual sigue disponible.');
    } finally {
      setBusy(false);
    }
  };

  const accept = async (): Promise<void> => {
    if (!scope || !suggestion?.result.specialty || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { acceptSpecialtySuggestion } = await import('@/services/specialty/specialtyJevClient');
      await acceptSpecialtySuggestion(scope, suggestion.requestId,
        suggestion.result.specialty, decision?.decisionId ?? null);
      jevRequestIdRef.current = null;
      setSuggestion(null);
      setOpen(false);
    } catch {
      setMessage('La sugerencia ya no pudo confirmarse. Actualiza el censo y revisa el episodio.');
    } finally {
      setBusy(false);
    }
  };

  const remember = async (): Promise<void> => {
    if (!scope || !assigned || !canPublish || !cie10Code ||
        !decision?.decisionId || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { publishSpecialtyMemory } = await import('@/services/specialty/specialtyJevClient');
      await publishSpecialtyMemory(scope, trimmed, cie10Code.toUpperCase().replace(/\s+/g, ''),
        decision.decisionId);
      setConfirmMemory(false);
      setMessage('Regla publicada. Las decisiones manuales existentes conservan prioridad.');
    } catch {
      setMessage('No se publicó la regla. Revisa el código CIE-10, permisos y versión del catálogo.');
    } finally {
      setBusy(false);
    }
  };

  const chip = assigned ? (
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
      {episodeMode && decision?.source === 'manual' ? 'Sin asignar · manual' : 'Pendiente asignar'}
    </span>
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
        className="inline-flex min-w-0 items-center"
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
            className="absolute left-0 top-full z-[61] mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg"
          >
            <div className="flex flex-col">
              {SPECIALTY_OPTIONS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => select(option)}
                  disabled={busy}
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
              {episodeMode && (
                <button type="button" onClick={() => select('')} disabled={busy}
                  className="rounded px-1.5 py-1 text-left text-[11px] hover:bg-slate-50">
                  Dejar sin asignar
                </button>
              )}
              {episodeMode && jevMode && !assigned && !decision && scope?.episodeId && cie10Code && (
                <div className="mt-1 border-t border-slate-200 pt-1">
                  <button type="button" onClick={() => void consult()} disabled={busy}
                    className="rounded px-1.5 py-1 text-left text-[11px] text-teal-700 hover:bg-teal-50 disabled:opacity-50">
                    {busy ? 'Consultando…' : suggestion ? 'Nueva consulta Jev' : 'Consultar sugerencia Jev'}
                  </button>
                  {suggestion && (
                    <div className="px-1.5 text-[11px] text-slate-600">
                      {suggestion.result.specialty
                        ? <>Sugerencia: <strong>{suggestion.result.specialty}</strong>
                            <button type="button" onClick={() => void accept()} disabled={busy}
                              className="mt-1 block rounded bg-teal-700 px-2 py-1 text-white disabled:opacity-50">
                              Aceptar para este episodio
                            </button></>
                        : 'Jev indica que requiere revisión manual.'}
                    </div>
                  )}
                </div>
              )}
              {episodeMode && memoryMode && canPublish && assigned &&
                ['manual', 'manual_ai'].includes(decision?.source ?? '') && scope && cie10Code && (
                <div className="mt-1 border-t border-slate-200 px-1.5 py-1 text-[11px]">
                  {confirmMemory ? <>
                    <p>Publicar una regla futura para el CIE-10 de este episodio?</p>
                    <button type="button" onClick={() => void remember()} disabled={busy}
                      className="mr-2 font-semibold text-teal-700 disabled:opacity-50">Confirmar publicación</button>
                    <button type="button" onClick={() => setConfirmMemory(false)} disabled={busy}>
                      Cancelar
                    </button>
                  </> : <button type="button" onClick={() => setConfirmMemory(true)}
                    className="text-slate-600 hover:text-teal-700">
                    Recordar CIE-10 para futuras asignaciones
                  </button>}
                </div>
              )}
              {message && <p role="alert" className="px-1.5 py-1 text-[11px] text-red-700">{message}</p>}
            </div>
          </div>
        </>
      )}
    </span>
  );
};
