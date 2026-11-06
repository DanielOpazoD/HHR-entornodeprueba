import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Download, Loader2, Minus } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { useSyslabHospitalizationReports } from '@/features/laboratory/hospitalization-reports';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import {
  DOWNLOAD_PART_LABELS,
  DOWNLOAD_PARTS,
  defaultDownloadRange,
  labProgressText,
  rangeProblem,
  reviewDownload,
  settleLabRead,
  type DownloadFormat,
  type DownloadPart,
  type DownloadRange,
  type PartOutcome,
} from './clinicalExplorerDownloadModel';
import {
  useClinicalExplorerDownload,
  type ClinicalExplorerDownloadState,
  type LabCollectorRequest,
} from './useClinicalExplorerDownload';

const FORMATS: ReadonlyArray<{ key: DownloadFormat; label: string }> = [
  { key: 'pdf', label: 'Un PDF unido' },
  { key: 'zip', label: 'Archivos separados (ZIP)' },
];

const BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY = `${BUTTON} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const PRIMARY = `${BUTTON} bg-teal-700 text-white hover:bg-teal-800`;
const DATE_INPUT =
  'h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[12px] tabular-nums text-slate-700 focus:border-teal-600 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400';

/** The Syslab read of one run: the laboratory hook, mounted only while the run needs it. */
const LabCollector: React.FC<{ rut: string; episodeId: string; request: LabCollectorRequest }> = ({
  rut,
  episodeId,
  request,
}) => {
  const lab = useSyslabHospitalizationReports({
    rut,
    episodeId,
    admissionDate: request.readFrom,
    enabled: true,
  });
  const { phase, message, analysis, pending, refreshing } = lab;
  const progress = labProgressText(lab);
  const { onProgress, onSettled } = request;
  useEffect(() => onProgress(progress), [onProgress, progress]);
  useEffect(() => {
    const settlement = settleLabRead({ phase, message, analysis, pending, refreshing });
    if (settlement) onSettled(settlement);
  }, [phase, message, analysis, pending, refreshing, onSettled]);
  return null;
};

const STATUS_ICON: Record<PartOutcome['status'], React.ReactNode> = {
  complete: <Check size={14} aria-hidden="true" className="text-teal-700" />,
  empty: <Minus size={14} aria-hidden="true" className="text-slate-400" />,
  partial: <AlertTriangle size={14} aria-hidden="true" className="text-amber-600" />,
  failed: <AlertTriangle size={14} aria-hidden="true" className="text-rose-600" />,
};

const PartStatus: React.FC<{
  part: DownloadPart;
  outcome: PartOutcome | undefined;
  progress: string | undefined;
}> = ({ part, outcome, progress }) => {
  const label = DOWNLOAD_PART_LABELS[part];
  return (
    <li className="flex gap-2 py-1.5">
      <span className="mt-0.5 inline-flex w-3.5 shrink-0 justify-center">
        {outcome ? (
          STATUS_ICON[outcome.status]
        ) : (
          <Loader2 size={14} aria-hidden="true" className="animate-spin text-slate-400" />
        )}
      </span>
      <div className="min-w-0 flex-1 text-[11.5px] leading-snug">
        <p className="font-semibold text-slate-700">
          {label.title} <span className="font-normal text-slate-400">· {label.source}</span>
        </p>
        <p className="text-slate-600">{outcome ? outcome.summary : (progress ?? 'En espera…')}</p>
        {outcome?.problem && (
          <p className={outcome.status === 'failed' ? 'text-rose-700' : 'text-amber-800'}>
            {outcome.problem}
          </p>
        )}
        {outcome?.notes.map(note => (
          <p key={note} className="text-slate-500">
            {note}
          </p>
        ))}
      </div>
    </li>
  );
};

const closingMessage = (
  state: ClinicalExplorerDownloadState
): { text: string; alert: boolean } | null => {
  if (state.error) return { text: state.error, alert: true };
  if (state.phase === 'saved') return { text: `Descargado como «${state.savedAs}».`, alert: false };
  if (state.phase !== 'review' || !state.request) return null;
  const review = reviewDownload(state.request.parts, state.outcomes);
  if (review.documents.length === 0) {
    return review.incomplete.length
      ? { text: 'No se obtuvo nada para descargar.', alert: true }
      : { text: 'No hay documentos para descargar.', alert: false };
  }
  return {
    text: 'Falta parte de lo pedido. Puedes descargar lo disponible o volver a intentarlo.',
    alert: true,
  };
};

interface ClinicalExplorerDownloadDialogProps {
  patient: ClinicalExplorerPatient;
  onClose: () => void;
}

/**
 * One patient's record from Eloísa, Syslab results and MMRAD CT reports, as one PDF (ficha, then
 * exámenes, then TAC, each oldest first) or as separate files in a ZIP. Nothing is stored.
 */
export const ClinicalExplorerDownloadDialog: React.FC<ClinicalExplorerDownloadDialogProps> = ({
  patient,
  onClose,
}) => {
  const { data } = patient;
  const [today] = useState(getClinicalCalendarDateISO);
  const [parts, setParts] = useState<DownloadPart[]>(() => [...DOWNLOAD_PARTS]);
  const [range, setRange] = useState<DownloadRange>(() =>
    defaultDownloadRange(data.admissionDate, today)
  );
  const [format, setFormat] = useState<DownloadFormat>('pdf');
  const { state, labCollector, start, saveAvailable, cancel, reset } = useClinicalExplorerDownload(
    patient,
    onClose
  );

  const running = state.phase === 'collecting' || state.phase === 'saving';
  const includesLab = parts.includes('lab');
  const blocker =
    parts.length === 0 ? 'Elige al menos una parte.' : includesLab ? rangeProblem(range) : null;
  const review = state.request ? reviewDownload(state.request.parts, state.outcomes) : null;
  const canSaveAvailable = state.phase === 'review' && Boolean(review?.documents.length);
  const message = closingMessage(state);
  const shownParts = state.request?.parts ?? [];

  const togglePart = (part: DownloadPart): void => {
    // Always ficha, exámenes, TAC: the order of the joined PDF and of the progress list.
    setParts(current =>
      DOWNLOAD_PARTS.filter(item =>
        item === part ? !current.includes(item) : current.includes(item)
      )
    );
    reset();
  };
  const setDay = (field: keyof DownloadRange, value: string): void => {
    setRange(current => ({ ...current, [field]: value }));
    reset();
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      size="md"
      icon={<Download />}
      headerIconColor="text-teal-700"
      title={
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-[14px]">Descargar ficha, exámenes e informes</span>
          <span className="truncate text-[11px] font-medium text-slate-500">
            {data.patientName.trim()}
          </span>
        </span>
      }
      bodyClassName="px-4 py-3"
      dataTestId="clinical-explorer-download"
    >
      <form
        className="flex flex-col gap-3 text-[12px] text-slate-700"
        onSubmit={event => {
          event.preventDefault();
          if (!blocker && !running) void start({ parts, range, format });
        }}
      >
        <fieldset disabled={running} className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Incluir
          </legend>
          {DOWNLOAD_PARTS.map(part => (
            <label key={part} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-teal-700"
                checked={parts.includes(part)}
                onChange={() => togglePart(part)}
              />
              <span>
                {DOWNLOAD_PART_LABELS[part].title}{' '}
                <span className="text-slate-400">({DOWNLOAD_PART_LABELS[part].source})</span>
              </span>
            </label>
          ))}
          <div className="ml-6 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-600">
            <span>Exámenes desde</span>
            <input
              type="date"
              aria-label="Exámenes desde"
              className={DATE_INPUT}
              value={range.from}
              max={today}
              disabled={!includesLab}
              onChange={event => setDay('from', event.target.value)}
            />
            <span>hasta</span>
            <input
              type="date"
              aria-label="Exámenes hasta"
              className={DATE_INPUT}
              value={range.to}
              max={today}
              disabled={!includesLab}
              onChange={event => setDay('to', event.target.value)}
            />
          </div>
          <p className="ml-6 text-[11px] text-slate-400">
            La ficha y los informes de TAC son los de esta hospitalización.
          </p>
        </fieldset>

        <fieldset disabled={running} className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Formato
          </legend>
          {FORMATS.map(option => (
            <label key={option.key} className="flex items-center gap-2">
              <input
                type="radio"
                name="clinical-explorer-download-format"
                className="accent-teal-700"
                checked={format === option.key}
                // The format only shapes the file: what was gathered stays and can be saved again.
                onChange={() => setFormat(option.key)}
              />
              {option.label}
            </label>
          ))}
          <p className="ml-6 text-[11px] text-slate-400">
            Orden: ficha, exámenes y TAC, cada uno del más antiguo al más reciente.
          </p>
        </fieldset>

        {shownParts.length > 0 && (
          <ul
            aria-label="Avance de la descarga"
            aria-live="polite"
            className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-2.5"
          >
            {shownParts.map(part => (
              <PartStatus
                key={part}
                part={part}
                outcome={state.outcomes[part]}
                progress={state.progress[part]}
              />
            ))}
          </ul>
        )}

        {message && (
          <p
            role={message.alert ? 'alert' : 'status'}
            className={clsx(
              'text-[11.5px] font-medium',
              message.alert ? 'text-amber-800' : 'text-teal-800'
            )}
          >
            {message.text}
          </p>
        )}
        {!message && !running && blocker && (
          <p className="text-[11.5px] text-slate-500">{blocker}</p>
        )}
        {state.phase === 'saving' && (
          <p role="status" className="text-[11.5px] text-slate-500">
            Armando el archivo…
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" className={SECONDARY} onClick={running ? cancel : onClose}>
            Cancelar
          </button>
          {canSaveAvailable && (
            <button type="button" className={SECONDARY} onClick={() => void saveAvailable(format)}>
              Descargar lo disponible
            </button>
          )}
          <button type="submit" className={PRIMARY} disabled={running || Boolean(blocker)}>
            {running ? (
              <Loader2 size={13} aria-hidden="true" className="animate-spin" />
            ) : (
              <Download size={13} aria-hidden="true" />
            )}
            {state.phase === 'review' ? 'Volver a intentar' : 'Descargar'}
          </button>
        </div>
      </form>
      {labCollector && (
        <LabCollector
          key={labCollector.key}
          rut={data.rut.trim()}
          episodeId={patient.episodeId}
          request={labCollector}
        />
      )}
    </BaseModal>
  );
};
