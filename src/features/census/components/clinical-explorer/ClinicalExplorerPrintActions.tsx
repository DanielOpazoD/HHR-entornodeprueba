import React, { useLayoutEffect, useRef, useState } from 'react';
import { FileText, Loader2, Printer } from 'lucide-react';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import {
  parseClinicalPanel,
  requestClinicalAction,
  requestClinicalPanel,
} from '@/features/rayen-import/clinical-panel';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { getSessionEpoch, onSessionChange } from '@/services/storage/sessionStorageTransition';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { buildIndicationsPrintHtml, printHtmlDocument } from './clinicalExplorerPrint';

type Action = 'indications' | 'prescription';
type ActionState =
  | { kind: 'idle' }
  | { kind: 'pending'; action: Action }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string };

const ACTION_BUTTON =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60';

interface ClinicalExplorerPrintActionsProps {
  patient: ClinicalExplorerPatient;
  /** Day chosen in the indications area; null means today in Rapa Nui. */
  indicationDate: string | null;
}

/**
 * Print the day's indications and open the official current prescription. Mounted per patient
 * and episode; a session change cancels what is in flight, so nothing prints for someone else.
 */
export const ClinicalExplorerPrintActions: React.FC<ClinicalExplorerPrintActionsProps> = ({
  patient,
  indicationDate,
}) => {
  const epoch = useSessionEpoch();
  const mounted = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const [state, setState] = useState<ActionState>({ kind: 'idle' });

  useLayoutEffect(() => {
    mounted.current = true;
    const cancel = () => operation.current?.abort();
    const unsubscribe = onSessionChange(cancel);
    return () => {
      mounted.current = false;
      cancel();
      unsubscribe();
    };
  }, []);

  const isCurrent = (controller: AbortController): boolean =>
    mounted.current &&
    operation.current === controller &&
    !controller.signal.aborted &&
    getSessionEpoch() === epoch;

  const printIndications = async (controller: AbortController): Promise<void> => {
    // Read again at the moment of printing: the paper carries what Ficha Médico says now.
    const date = indicationDate ?? getClinicalCalendarDateISO();
    const result = await requestClinicalPanel(patient.episodeId, undefined, controller.signal);
    if (!isCurrent(controller)) return;
    if (result.error) {
      setState({ kind: 'error', message: `No se pudo leer Ficha Médico: ${result.error}` });
      return;
    }
    const day = parseClinicalPanel(result.events, result.carePlan).indicationDays.find(
      candidate => candidate.day === date
    );
    const active = day?.active ?? [];
    if (active.length === 0) {
      setState({
        kind: 'notice',
        message: `Sin indicaciones vigentes el ${formatDateDDMMYYYY(date)}: no hay nada que imprimir.`,
      });
      return;
    }
    await printHtmlDocument(
      buildIndicationsPrintHtml({
        patient,
        date,
        indications: active.map(entry => ({ title: entry.title, text: entry.text })),
        printedAt: new Date(),
      }),
      controller.signal
    );
    if (isCurrent(controller)) setState({ kind: 'idle' });
  };

  // Once sent, the extension opens Eloísa's document by itself: an abort only stops waiting here.
  // The prescription button of the clinical panel behaves the same; the document is authorised by
  // the Eloísa session, which an HHR session change does not alter.
  const openPrescription = async (controller: AbortController): Promise<void> => {
    const result = await requestClinicalAction(
      patient.episodeId,
      'prescription',
      undefined,
      controller.signal
    );
    if (!isCurrent(controller)) return;
    setState(
      result.ok && result.opened
        ? { kind: 'idle' }
        : { kind: 'error', message: result.error || 'No se pudo abrir la receta vigente.' }
    );
  };

  const run = async (action: Action): Promise<void> => {
    if (operation.current || getSessionEpoch() !== epoch) return;
    const controller = new AbortController();
    operation.current = controller;
    setState({ kind: 'pending', action });
    try {
      if (action === 'indications') await printIndications(controller);
      else await openPrescription(controller);
    } catch {
      if (isCurrent(controller)) {
        setState({
          kind: 'error',
          message:
            action === 'indications'
              ? 'No se pudieron imprimir las indicaciones.'
              : 'No se pudo abrir la receta vigente.',
        });
      }
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  };

  const pending = state.kind === 'pending' ? state.action : null;
  const indicationsLabel = indicationDate
    ? `Imprimir las indicaciones del ${formatDateDDMMYYYY(indicationDate)}`
    : 'Imprimir las indicaciones de hoy';
  return (
    <>
      {(state.kind === 'error' || state.kind === 'notice') && (
        <span
          role={state.kind === 'error' ? 'alert' : 'status'}
          className={
            state.kind === 'error' ? 'text-[10.5px] text-red-700' : 'text-[10.5px] text-slate-500'
          }
        >
          {state.message}
        </span>
      )}
      <button
        type="button"
        className={`${ACTION_BUTTON} w-7 justify-center px-0`}
        aria-label="Imprimir indicaciones"
        title={indicationsLabel}
        disabled={pending !== null}
        onClick={() => void run('indications')}
      >
        {pending === 'indications' ? (
          <Loader2 size={13} aria-hidden="true" className="animate-spin" />
        ) : (
          <Printer size={13} aria-hidden="true" className="text-teal-700" />
        )}
      </button>
      <button
        type="button"
        className={ACTION_BUTTON}
        title="Ver o imprimir la receta vigente de Eloísa"
        disabled={pending !== null}
        onClick={() => void run('prescription')}
      >
        {pending === 'prescription' ? (
          <Loader2 size={13} aria-hidden="true" className="animate-spin" />
        ) : (
          <FileText size={13} aria-hidden="true" className="text-sky-700" />
        )}
        Receta
      </button>
    </>
  );
};
