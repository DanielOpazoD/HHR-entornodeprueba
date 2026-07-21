import React, { useEffect, useMemo } from 'react';
import { CalendarDays, Download, ExternalLink, FileClock, Loader2, RefreshCw } from 'lucide-react';

import { BaseModal } from '@/components/shared/BaseModal';
import { usePatientHospitalizationReports } from '@/features/census/components/usePatientHospitalizationReports';

interface PatientHospitalizationReportsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  patientRun: string;
  currentEpisodeId?: string;
  admissionDate?: string;
  censusDate?: string;
}

const formatDate = (value?: string): string => {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};

export const PatientHospitalizationReportsDialog: React.FC<
  PatientHospitalizationReportsDialogProps
> = ({ isOpen, onClose, patientName, patientRun, currentEpisodeId, admissionDate, censusDate }) => {
  const reports = usePatientHospitalizationReports();
  const { load, download, isLoading, error, episodes, downloadingKey } = reports;
  const context = useMemo(
    () => ({
      patientName,
      patientRun,
      clinicalEpisodeId: currentEpisodeId,
      admissionDate,
      censusDate,
    }),
    [admissionDate, censusDate, currentEpisodeId, patientName, patientRun]
  );

  useEffect(() => {
    if (isOpen) void load(context);
    // `load` is stable; context primitives intentionally trigger a new patient lookup.
  }, [context, isOpen, load]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Informes de hospitalización"
      icon={<FileClock size={18} />}
      size="lg"
      dataTestId="patient-hospitalization-reports-dialog"
      bodyClassName="p-0"
    >
      <div className="border-b border-slate-100 px-5 py-3">
        <p className="truncate text-sm font-semibold text-slate-800">{patientName}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Selecciona una hospitalización y el documento que necesitas.
        </p>
      </div>

      <div className="space-y-2 p-4">
        {isLoading ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            Buscando hospitalizaciones en Eloísa…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void load(context)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-100"
            >
              <RefreshCw size={13} /> Reintentar
            </button>
          </div>
        ) : episodes.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No se encontraron hospitalizaciones para este paciente.
          </div>
        ) : (
          episodes.map(episode => {
            const isCurrent = episode.encId === currentEpisodeId;
            const dateLabel = episode.endDate
              ? `${formatDate(episode.startDate)} – ${formatDate(episode.endDate)}`
              : episode.active === true
                ? `${formatDate(episode.startDate)} – hospitalización vigente`
                : episode.startDate
                  ? `${formatDate(episode.startDate)} – estado no verificado`
                  : 'Fecha de ingreso no disponible';
            return (
              <article
                key={episode.encId}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <CalendarDays size={15} className="shrink-0 text-teal-600" />
                      <p className="text-sm font-semibold tabular-nums text-slate-800">
                        {dateLabel}
                      </p>
                    </div>
                    <div className="mt-1 flex gap-1.5 pl-6">
                      {isCurrent && (
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700 ring-1 ring-teal-200">
                          Episodio del censo
                        </span>
                      )}
                      {episode.active && !isCurrent && (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-sky-200">
                          Vigente
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void download(context, episode, 'epicrisis')}
                      disabled={downloadingKey !== null}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 disabled:cursor-progress disabled:opacity-60"
                    >
                      {downloadingKey === `${episode.encId}:epicrisis` ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      Epicrisis
                    </button>
                    <button
                      type="button"
                      onClick={() => void download(context, episode, 'history')}
                      disabled={downloadingKey !== null || !episode.startDate}
                      title={
                        episode.startDate
                          ? undefined
                          : 'La ficha completa requiere la fecha de ingreso del episodio.'
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-progress disabled:opacity-60"
                    >
                      {downloadingKey === `${episode.encId}:history` ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <ExternalLink size={14} />
                      )}
                      Ficha completa
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
        La ficha completa se abre en la vista oficial de Eloísa para imprimirla o guardarla en PDF.
      </p>
    </BaseModal>
  );
};
