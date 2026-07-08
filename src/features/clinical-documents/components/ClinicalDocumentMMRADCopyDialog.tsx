import React, { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCopy, Loader2, Radio, X } from 'lucide-react';

import { searchMMRADExams, type MMRADExam } from '@/services/radiology/mmradService';
import { buildMMRADReportClipboardText } from '@/services/radiology/mmradReportSupport';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { useTransientFlag } from '@/hooks/useTransientFlag';

interface ClinicalDocumentMMRADCopyDialogProps {
  patientRut: string;
  onClose: () => void;
}

const toIsoDate = (date: Date): string => date.toISOString().split('T')[0];

const buildLastThirtyDaysRange = (): { dateFrom: string; dateTo: string } => {
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 30);
  return {
    dateFrom: toIsoDate(dateFrom),
    dateTo: toIsoDate(dateTo),
  };
};

const toExamTimestamp = (raw: string): number => {
  const match = raw.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return 0;
  const [, dd, mm, yyyy, hh = '00', min = '00'] = match;
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`).getTime() || 0;
};

const buildExamKey = (exam: MMRADExam): string =>
  exam.informe_html_url || exam.pdf_url || `${exam.nombre_examen}-${exam.fecha_examen}`;

export const ClinicalDocumentMMRADCopyDialog: React.FC<ClinicalDocumentMMRADCopyDialogProps> = ({
  patientRut,
  onClose,
}) => {
  const [exams, setExams] = useState<MMRADExam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedExamKey, flashCopiedExamKey] = useTransientFlag<string | null>(null, 1800);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { dateFrom, dateTo } = buildLastThirtyDaysRange();
        const result = await searchMMRADExams({ rut: patientRut, dateFrom, dateTo });
        if (cancelled) return;

        const relevantExams = result.examenes
          .filter(exam => (exam.mod || '').trim().toUpperCase() === 'CT' && exam.report)
          .sort(
            (a, b) => toExamTimestamp(b.fecha_examen || '') - toExamTimestamp(a.fecha_examen || '')
          );

        setExams(relevantExams);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar MMRAD.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [patientRut]);

  const dialogTitle = useMemo(() => 'Copiar informe MMRAD', []);

  const handleCopy = async (exam: MMRADExam) => {
    if (!exam.report) return;

    const text = buildMMRADReportClipboardText({
      examName: exam.nombre_examen,
      examDate: exam.fecha_examen,
      title: exam.report.title,
      findings: exam.report.findings,
      impression: exam.report.impression,
    });

    if (!text) return;

    await writeClipboardText(text);
    flashCopiedExamKey(buildExamKey(exam));
  };

  return (
    <div className="absolute right-0 top-10 z-50 w-[360px] rounded-xl border border-violet-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-violet-100 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Radio size={13} className="text-violet-600" />
          <span className="text-[11px] font-bold text-slate-700">{dialogTitle}</span>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto p-2">
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-violet-500" />
            <span className="ml-2 text-[11px] text-slate-400">
              Cargando TAC de últimos 30 días...
            </span>
          </div>
        )}

        {error && <p className="px-2 py-3 text-center text-[11px] text-red-600">{error}</p>}

        {!isLoading && exams.length === 0 && !error && (
          <p className="px-2 py-6 text-center text-[11px] text-slate-400">
            No hay TAC con informe estructurado disponibles en los últimos 30 días.
          </p>
        )}

        {exams.map(exam => {
          const examKey = buildExamKey(exam);
          const isCopied = copiedExamKey === examKey;
          return (
            <div
              key={examKey}
              className="mb-2 rounded-lg border border-slate-200 px-2.5 py-2 last:mb-0"
            >
              <div className="mb-2">
                <p className="text-[12px] font-semibold text-slate-700">{exam.nombre_examen}</p>
                <p className="text-[10px] text-slate-400">{exam.fecha_examen}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy(exam)}
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all ${
                  isCopied
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                }`}
              >
                {isCopied ? <Check size={12} /> : <ClipboardCopy size={12} />}
                {isCopied ? 'Copiado' : 'Copiar informe'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
