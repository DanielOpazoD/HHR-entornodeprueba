import React, { useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { downloadBlob } from '@/services/exporters/exportDownload';
import { buildMMRADReportClipboardText } from '@/services/radiology/mmradReportSupport';
import { fetchMMRADPdfBlob, type MMRADExam } from '@/services/radiology/mmradService';
import { getSessionEpoch, onSessionChange } from '@/services/storage/sessionStorageTransition';
import { writePrivateClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { EXPLORER_ICON_BUTTON } from './clinicalExplorerUi';

type Action = 'copy' | 'download';
type ActionState =
  | { kind: 'idle' }
  | { kind: 'pending'; action: Action }
  | { kind: 'copied' }
  | { kind: 'error'; message: string };

/** Mounted for one patient, episode and study by the report's identity key. */
export const ClinicalExplorerReportActions: React.FC<{ exam: MMRADExam }> = ({ exam }) => {
  const epoch = useSessionEpoch();
  const mounted = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const report = exam.report;
  const clipboardText =
    report && (report.findings?.trim() || report.impression?.trim())
      ? buildMMRADReportClipboardText({
          examName: exam.nombre_examen,
          examDate: exam.fecha_examen,
          title: report.title,
          findings: report.findings,
          impression: report.impression,
        })
      : null;

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

  const run = async (action: Action): Promise<void> => {
    if (operation.current || getSessionEpoch() !== epoch) return;
    if (action === 'download' ? !exam.pdf_url : !clipboardText) return;
    const controller = new AbortController();
    operation.current = controller;
    setState({ kind: 'pending', action });
    try {
      if (action === 'download' && exam.pdf_url) {
        const blob = await fetchMMRADPdfBlob(exam.pdf_url, controller.signal);
        if (!isCurrent(controller)) return;
        downloadBlob(blob, 'Informe-TAC.pdf');
        setState({ kind: 'idle' });
      } else if (clipboardText) {
        await writePrivateClipboardText(clipboardText);
        if (isCurrent(controller)) setState({ kind: 'copied' });
      }
    } catch {
      if (isCurrent(controller)) {
        setState({
          kind: 'error',
          message:
            action === 'copy'
              ? 'No se pudo copiar el informe.'
              : 'No se pudo descargar el PDF original.',
        });
      }
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  };

  const busy = state.kind === 'pending';
  const pdfTitle = exam.pdf_url ? 'Descargar PDF original' : 'PDF original no disponible';
  const copyTitle = clipboardText
    ? 'Copiar hallazgos e impresión'
    : 'Sin hallazgos ni impresión para copiar';
  return (
    <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
      {state.kind === 'error' && (
        <span role="alert" className="mr-1 text-[10.5px] text-red-700">
          {state.message}
        </span>
      )}
      {state.kind === 'copied' && (
        <span role="status" className="mr-1 text-[10.5px] text-teal-700">
          Copiado
        </span>
      )}
      <button
        type="button"
        aria-label="Descargar PDF original"
        title={pdfTitle}
        className={EXPLORER_ICON_BUTTON}
        disabled={busy || !exam.pdf_url}
        onClick={() => void run('download')}
      >
        {state.kind === 'pending' && state.action === 'download' ? (
          <Loader2 size={13} aria-hidden="true" className="animate-spin" />
        ) : (
          <Download size={13} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        aria-label="Copiar hallazgos e impresión"
        title={copyTitle}
        className={EXPLORER_ICON_BUTTON}
        disabled={busy || !clipboardText}
        onClick={() => void run('copy')}
      >
        {state.kind === 'pending' && state.action === 'copy' ? (
          <Loader2 size={13} aria-hidden="true" className="animate-spin" />
        ) : state.kind === 'copied' ? (
          <Check size={13} aria-hidden="true" className="text-teal-700" />
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
      </button>
    </div>
  );
};
