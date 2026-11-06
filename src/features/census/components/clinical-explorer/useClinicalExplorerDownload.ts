import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { mergeMMRADExamLists } from '@/components/modals/controllers/radiologyExamListMemory';
import { searchMmradStudies } from '@/components/modals/controllers/mmradStudySearch';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { downloadBlob } from '@/services/exporters/exportDownload';
import { fetchMMRADPdfBlob, type MMRADExam } from '@/services/radiology/mmradService';
import { getSessionEpoch, onSessionChange } from '@/services/storage/sessionStorageTransition';
import {
  calendarStampInClinicalTimeZone,
  getClinicalCalendarDateISO,
} from '@/utils/clinicalTimeZone';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { formatRut, normalizeRut } from '@/utils/rutUtils';
import { asMmradDateBound } from './clinicalExplorerImagingModel';
import {
  bundleFileName,
  ctFileName,
  describeCtPart,
  describeCtStudy,
  describeRecordPart,
  isIsoDay,
  labFileName,
  labReadFrom,
  outcome,
  planCtReports,
  planLabPart,
  recordProgressText,
  reviewDownload,
  type ArchiveFile,
  type DownloadDocument,
  type DownloadFormat,
  type DownloadOutcomes,
  type DownloadPart,
  type DownloadRequest,
  type LabSettlement,
  type PartOutcome,
} from './clinicalExplorerDownloadModel';

type Bundle = typeof import('./clinicalExplorerDownloadBundle');

export interface ClinicalExplorerDownloadState {
  phase: 'idle' | 'collecting' | 'review' | 'saving' | 'saved';
  request: DownloadRequest | null;
  /** What each part is doing while it is collected. */
  progress: Partial<Record<DownloadPart, string>>;
  outcomes: DownloadOutcomes;
  savedAs: string | null;
  error: string | null;
}

/** The Syslab read of one run, mounted as a component so the laboratory hook owns it. */
export interface LabCollectorRequest {
  key: number;
  readFrom: string;
  onSettled: (settlement: LabSettlement) => void;
  onProgress: (text: string) => void;
}

interface Run {
  controller: AbortController;
  cancelRecord?: () => void;
  settleLab?: (settlement: LabSettlement) => void;
}

const IDLE: ClinicalExplorerDownloadState = {
  phase: 'idle',
  request: null,
  progress: {},
  outcomes: {},
  savedAs: null,
  error: null,
};

/** Thrown inside a run that was cancelled or whose session ended; never shown. */
class RunStopped extends Error {}

type CtListing =
  | { kind: 'ready'; studies: MMRADExam[]; searchIncomplete: boolean }
  | { kind: 'failed'; problem: string };

/**
 * The MMRAD studies of the stay, by the same search the explorer runs, once both the exact and the
 * check-digit answers are in. A failed exact search is a failure, never «sin TAC» (SAVE-01): what
 * the session remembers may come from a check-digit answer alone, so it proves nothing.
 */
const listMmradStudies = (
  query: { rut: string; patientName: string; dateFrom: string },
  signal: AbortSignal
): Promise<CtListing> =>
  new Promise(resolve => {
    let studies: MMRADExam[] = [];
    let partial = false;
    let exactError: string | null = null;
    let exactSettled = false;
    let alternateSettled = false;
    const finish = (): void => {
      if (signal.aborted || !exactSettled || !alternateSettled) return;
      resolve(
        exactError === null
          ? { kind: 'ready', studies, searchIncomplete: partial }
          : { kind: 'failed', problem: `MMRAD no respondió: ${exactError}` }
      );
    };
    signal.addEventListener('abort', () => resolve({ kind: 'failed', problem: '' }), {
      once: true,
    });
    const handle = searchMmradStudies(
      { ...query, dateTo: '' },
      {
        isCurrent: () => !signal.aborted,
        onShown: shown => {
          studies = mergeMMRADExamLists(studies, shown.examenes);
          partial ||= shown.check_digit_search === 'partial';
        },
        onExactError: message => {
          exactError = message;
        },
        onAlternateSettled: () => {
          alternateSettled = true;
          finish();
        },
      }
    );
    void handle.done.then(() => {
      exactSettled = true;
      finish();
    });
  });

/**
 * Collects the record, the Syslab results and the CT reports of one patient and saves them as one
 * PDF or a ZIP. Missing parts stop for the person to decide (SAVE-01); a session change or closing
 * the dialog stops everything and saves nothing.
 */
export const useClinicalExplorerDownload = (
  patient: ClinicalExplorerPatient,
  onSessionEnd: () => void
) => {
  const { data } = patient;
  const patientName = data.patientName.trim();
  const rut = data.rut.trim();
  const admissionDate = data.admissionDate;
  const [state, setState] = useState<ClinicalExplorerDownloadState>(IDLE);
  const [labCollector, setLabCollector] = useState<LabCollectorRequest | null>(null);
  const runRef = useRef<Run | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const bundleRef = useRef<Bundle | null>(null);
  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;

  const stopRun = useCallback((): void => {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    run.controller.abort();
    run.cancelRecord?.();
    run.settleLab?.({ kind: 'failed', problem: '' });
    setLabCollector(null);
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    const unsubscribe = onSessionChange(() => {
      stopRun();
      onSessionEndRef.current();
    });
    return () => {
      mounted.current = false;
      stopRun();
      unsubscribe();
    };
  }, [stopRun]);

  const openRun = (): { run: Run; isCurrent: () => boolean } | null => {
    if (runRef.current) return null;
    const epoch = getSessionEpoch();
    const run: Run = { controller: new AbortController() };
    runRef.current = run;
    const isCurrent = (): boolean =>
      mounted.current &&
      runRef.current === run &&
      !run.controller.signal.aborted &&
      getSessionEpoch() === epoch;
    return { run, isCurrent };
  };

  const save = async (
    bundle: Bundle,
    format: DownloadFormat,
    documents: DownloadDocument[],
    isCurrent: () => boolean
  ): Promise<void> => {
    setState(current => ({ ...current, phase: 'saving', error: null }));
    try {
      const bytes =
        format === 'pdf'
          ? await bundle.mergePdfDocuments(documents)
          : bundle.zipDocuments(documents);
      if (!isCurrent()) return;
      const fileName = bundleFileName(patientName, getClinicalCalendarDateISO(), format);
      const type = format === 'pdf' ? 'application/pdf' : 'application/zip';
      downloadBlob(new Blob([bytes], { type }), fileName);
      setState(current => ({ ...current, phase: 'saved', savedAs: fileName }));
    } catch (error) {
      if (!isCurrent()) return;
      setState(current => ({
        ...current,
        phase: 'review',
        error:
          error instanceof bundle.DownloadAssemblyError
            ? error.message
            : 'No se pudo armar el archivo. Vuelve a intentarlo.',
      }));
    }
  };

  const start = async (request: DownloadRequest): Promise<void> => {
    const opened = openRun();
    if (!opened) return;
    const { run, isCurrent } = opened;
    const key = ++sequence.current;
    const signal = run.controller.signal;
    const stamp = calendarStampInClinicalTimeZone();
    const heading = {
      patientName,
      rut: formatRut(normalizeRut(rut)),
      generatedAt: `${formatDateDDMMYYYY(stamp.iso)} ${stamp.hhmm}`,
    };
    const stopIfStale = (): void => {
      if (!isCurrent()) throw new RunStopped();
    };
    const report = (part: DownloadPart, text: string): void => {
      if (isCurrent()) {
        setState(current => ({ ...current, progress: { ...current.progress, [part]: text } }));
      }
    };
    setState({ ...IDLE, phase: 'collecting', request });

    const collectRecord = async (bundle: Bundle): Promise<PartOutcome> => {
      report('record', recordProgressText(null));
      const audit = bundle.requestAuditDocuments({
        patients: [
          {
            run: normalizeRut(rut),
            // The stays that overlap this one; without a usable admission, the one in course.
            dateFrom: isIsoDay(admissionDate) ? admissionDate : stamp.iso,
            dateTo: stamp.iso,
          },
        ],
        documentTypes: ['history'],
        onProgress: progress => report('record', recordProgressText(progress)),
      });
      run.cancelRecord = audit.cancel;
      const result = await audit.result;
      run.cancelRecord = undefined;
      stopIfStale();
      let files: ArchiveFile[] | null = null;
      if (result.ok && result.archive) {
        try {
          files = await bundle.readHistoryArchive(result.archive);
        } catch {
          return outcome('failed', 'No incluida', {
            problem: 'No se pudo abrir el ZIP que entregó la extensión Eloísa.',
          });
        }
        stopIfStale();
      }
      return describeRecordPart(result, files);
    };

    const collectLab = async (bundle: Bundle): Promise<PartOutcome> => {
      report('lab', 'Comprobando la sesión de Syslab…');
      const settlement = await new Promise<LabSettlement>(resolve => {
        run.settleLab = resolve;
        setLabCollector({
          key,
          readFrom: labReadFrom(admissionDate, request.range.from),
          onSettled: resolve,
          onProgress: text => report('lab', text),
        });
      });
      run.settleLab = undefined;
      setLabCollector(current => (current?.key === key ? null : current));
      stopIfStale();
      const plan = planLabPart(settlement, request.range);
      if ('outcome' in plan) return plan.outcome;
      report('lab', 'Preparando el PDF de exámenes…');
      const bytes = bundle.renderLabResultsPdf({
        ...heading,
        range: request.range,
        groups: plan.groups,
      });
      return outcome('complete', plan.summary, {
        notes: plan.notes,
        documents: [{ part: 'lab', fileName: labFileName(patientName, request.range), bytes }],
      });
    };

    const collectCt = async (bundle: Bundle): Promise<PartOutcome> => {
      report('ct', 'Buscando estudios en MMRAD…');
      const listing = await listMmradStudies(
        { rut, patientName, dateFrom: asMmradDateBound(admissionDate) ?? '' },
        signal
      );
      stopIfStale();
      if (listing.kind === 'failed') {
        return outcome('failed', 'No incluidos', { problem: listing.problem });
      }
      const plan = planCtReports(listing.studies);
      const documents: DownloadDocument[] = [];
      const failures: string[] = [];
      for (const [index, { exam, source }] of plan.included.entries()) {
        report('ct', `Descargando informe ${index + 1} de ${plan.included.length}…`);
        try {
          const bytes =
            source === 'pdf' && exam.pdf_url
              ? await bundle.readBlobBytes(await fetchMMRADPdfBlob(exam.pdf_url, signal))
              : bundle.renderCtReportTextPdf({ ...heading, exam });
          stopIfStale();
          documents.push({ part: 'ct', fileName: ctFileName(patientName, exam), bytes });
        } catch {
          stopIfStale();
          failures.push(describeCtStudy(exam));
        }
      }
      return describeCtPart({
        plan,
        documents,
        failures,
        searchIncomplete: listing.searchIncomplete,
      });
    };

    try {
      const bundle = await import('./clinicalExplorerDownloadBundle');
      stopIfStale();
      bundleRef.current = bundle;
      const collectors = { record: collectRecord, lab: collectLab, ct: collectCt };
      const settled = await Promise.all(
        request.parts.map(async part => {
          // A part that breaks fails alone; the others still arrive and the person decides.
          const result = await collectors[part](bundle).catch((error: unknown) => {
            if (error instanceof RunStopped || !isCurrent()) throw error;
            return outcome('failed', 'No incluido', { problem: 'No se pudo preparar esta parte.' });
          });
          if (isCurrent()) {
            setState(current => ({
              ...current,
              outcomes: { ...current.outcomes, [part]: result },
            }));
          }
          return [part, result] as const;
        })
      );
      stopIfStale();
      const outcomes: DownloadOutcomes = Object.fromEntries(settled);
      const review = reviewDownload(request.parts, outcomes);
      if (review.incomplete.length > 0 || review.documents.length === 0) {
        setState(current => ({ ...current, phase: 'review' }));
        return;
      }
      await save(bundle, request.format, review.documents, isCurrent);
    } catch (error) {
      if (error instanceof RunStopped || !isCurrent()) return;
      setState(current => ({
        ...current,
        phase: 'review',
        error: 'No se pudo preparar la descarga. Vuelve a intentarlo.',
      }));
    } finally {
      if (runRef.current === run) runRef.current = null;
    }
  };

  /** After the person read what is missing: saves what did come, in the format chosen now. */
  const saveAvailable = async (format: DownloadFormat): Promise<void> => {
    const bundle = bundleRef.current;
    const { request, outcomes, phase } = state;
    if (phase !== 'review' || !bundle || !request) return;
    const review = reviewDownload(request.parts, outcomes);
    if (review.documents.length === 0) return;
    const opened = openRun();
    if (!opened) return;
    try {
      await save(bundle, format, review.documents, opened.isCurrent);
    } finally {
      if (runRef.current === opened.run) runRef.current = null;
    }
  };

  const cancel = (): void => {
    stopRun();
    setState(IDLE);
  };

  /** New options: what was shown belongs to the previous request. */
  const reset = (): void => {
    if (!runRef.current) setState(IDLE);
  };

  return { state, labCollector, start, saveAvailable, cancel, reset };
};
