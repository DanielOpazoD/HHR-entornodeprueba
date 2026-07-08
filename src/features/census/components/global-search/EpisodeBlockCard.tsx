/**
 * EpisodeBlockCard
 *
 * Renders a single hospitalization episode as a unified block
 * (admission date → discharge date) with diagnosis, bed,
 * days of stay, and expandable clinical documents.
 */

import React, { useCallback, useState } from 'react';
import {
  BedDouble,
  FileText,
  ChevronDown,
  ChevronRight,
  Loader2,
  LogIn,
  LogOut,
  ArrowRightLeft,
  Clock,
  ExternalLink,
} from 'lucide-react';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import type {
  ClinicalDocSummary,
  EpisodeDocuments,
} from '@/features/census/components/global-search/globalSearchContracts';
import type { GroupedEpisode } from '@/features/census/components/global-search/globalSearchContracts';
import { resolveEpisodeCensusTargetDate } from '@/features/census/components/global-search/episodeGroupingController';
import { DocRow } from '@/features/census/components/global-search/DocRow';
import { buildClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';
import { formatDateToCL } from '@/utils/clinicalUtils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EpisodeBlockCardProps {
  episode: GroupedEpisode;
  rut: string;
  lastSeenDate?: string | null;
  episodeDocuments: Record<string, EpisodeDocuments>;
  onLoadDocuments: (key: string) => void;
  onDownloadPdf: (docId: string, docType: string) => Promise<void>;
  onOpenClinicalDocument?: (doc: ClinicalDocSummary) => void;
  onNavigateToDate?: (isoDate: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildEpisodeKey = (rut: string, admissionDate: string): string =>
  buildClinicalEpisodeKey(rut, admissionDate);

const dischargeTypeIcon = (type: string) => {
  switch (type) {
    case 'Egreso':
      return <LogOut size={12} className="text-blue-500" />;
    case 'Traslado':
      return <ArrowRightLeft size={12} className="text-amber-500" />;
    case 'Fallecimiento':
      return <LogOut size={12} className="text-red-500" />;
    default:
      return <LogOut size={12} className="text-slate-400" />;
  }
};

const dischargeLabel = (event: HospitalizationEvent): string => {
  if (event.type === 'Traslado' && event.receivingCenter) {
    return `Traslado a ${event.receivingCenter}`;
  }
  return event.type;
};

const hasMeaningfulDiagnosis = (diagnosis: string): boolean => {
  const normalized = diagnosis.trim().toUpperCase();
  return Boolean(normalized) && normalized !== 'S/D';
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EpisodeBlockCard: React.FC<EpisodeBlockCardProps> = ({
  episode,
  rut,
  lastSeenDate,
  episodeDocuments,
  onLoadDocuments,
  onDownloadPdf,
  onOpenClinicalDocument,
  onNavigateToDate,
}) => {
  const [isDocsExpanded, setIsDocsExpanded] = useState(false);

  const episodeKey =
    episode.admission.type === 'Ingreso' ? buildEpisodeKey(rut, episode.admission.date) : null;

  const docsState = episodeKey ? episodeDocuments[episodeKey] : undefined;
  const isCurrentlyAdmitted = episode.admission.type === 'Ingreso' && !episode.discharge;
  const censusTargetDate = resolveEpisodeCensusTargetDate(episode, lastSeenDate);
  const showDiagnosis = hasMeaningfulDiagnosis(episode.diagnosis);

  const handleToggleDocs = useCallback(() => {
    if (!episodeKey) return;
    if (!docsState) {
      onLoadDocuments(episodeKey);
    }
    setIsDocsExpanded(prev => !prev);
  }, [episodeKey, docsState, onLoadDocuments]);

  return (
    <div className="relative pl-5 pb-2">
      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-3 w-3 h-3 rounded-full border-2 border-white shadow-sm ${
          isCurrentlyAdmitted ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-medical-400'
        }`}
      />

      <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
        {/* Header: date range + status */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50/80 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <LogIn size={13} className="text-emerald-600" />
            <span className="text-xs font-semibold text-slate-700">
              {formatDateToCL(episode.admission.date)}
            </span>
            <span className="text-slate-300">&rarr;</span>
            {episode.discharge ? (
              <>
                {dischargeTypeIcon(episode.discharge.type)}
                <span className="text-xs font-semibold text-slate-700">
                  {formatDateToCL(episode.discharge.date)}
                </span>
              </>
            ) : (
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                Hospitalizado
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {episode.daysOfStay !== null && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                <Clock size={10} />
                {episode.daysOfStay} dia{episode.daysOfStay !== 1 ? 's' : ''}
              </span>
            )}
            {onNavigateToDate && (
              <button
                type="button"
                onClick={() => onNavigateToDate(censusTargetDate)}
                className="flex items-center gap-1 text-[10px] font-medium text-medical-600 hover:text-medical-800 bg-medical-50 hover:bg-medical-100 rounded px-1.5 py-0.5 transition-colors"
                title="Ir al último censo en que estuvo hospitalizado"
              >
                <ExternalLink size={10} />
                Ir al censo
              </button>
            )}
          </div>
        </div>

        {/* Body: diagnosis, bed, discharge info */}
        <div className="px-3 py-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-slate-500">
              {episode.bedName && (
                <span className="flex items-center gap-1">
                  <BedDouble size={11} />
                  {episode.bedName}
                </span>
              )}
              {showDiagnosis && (
                <span className="truncate text-slate-600">{episode.diagnosis}</span>
              )}
              {episode.discharge && episode.discharge.type !== 'Egreso' && (
                <span className="text-[10px] text-slate-400">
                  {dischargeLabel(episode.discharge)}
                </span>
              )}
            </div>

            {episodeKey && (
              <button
                type="button"
                onClick={handleToggleDocs}
                className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-medical-600 hover:text-medical-800 transition-colors"
              >
                <FileText size={12} />
                Documentos clinicos
                {isDocsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {docsState?.docs.length ? (
                  <span className="ml-0.5 text-[10px] bg-medical-100 text-medical-700 rounded-full px-1.5">
                    {docsState.docs.length}
                  </span>
                ) : null}
              </button>
            )}
          </div>

          {isDocsExpanded && episodeKey && (
            <div className="mt-2 pl-4 border-l-2 border-medical-100">
              {docsState?.isLoading && (
                <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                  <Loader2 size={12} className="animate-spin" />
                  Cargando documentos...
                </div>
              )}
              {docsState && !docsState.isLoading && docsState.docs.length === 0 && (
                <p className="text-xs text-slate-400 py-2">Sin documentos clinicos</p>
              )}
              {docsState?.docs.map(doc => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  onDownloadPdf={onDownloadPdf}
                  onOpenDocument={onOpenClinicalDocument}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
