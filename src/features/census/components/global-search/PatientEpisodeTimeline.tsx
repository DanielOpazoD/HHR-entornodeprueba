/**
 * PatientEpisodeTimeline
 *
 * Orchestrator component for the patient detail view in global search.
 * Shows demographics, movement history, and grouped hospitalization episodes.
 */

import React from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/services/patient/patientHistoryService';
import type {
  EpisodeDocuments,
  PatientEpisodeTimelineState,
} from '@/features/census/components/global-search/globalSearchContracts';
import { DemographicsCard } from '@/features/census/components/global-search/DemographicsCard';
import { MovementTimeline } from '@/features/census/components/global-search/MovementTimeline';
import { EpisodeBlockCard } from '@/features/census/components/global-search/EpisodeBlockCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientEpisodeTimelineProps {
  patient: MasterPatient;
  history: PatientHistoryResult | null;
  isLoadingHistory: boolean;
  timelineState: PatientEpisodeTimelineState;
  episodeDocuments: Record<string, EpisodeDocuments>;
  onLoadDocuments: (episodeKey: string) => void;
  onDownloadPdf: (docId: string, docType: string) => Promise<void>;
  onNavigateToDate?: (isoDate: string) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PatientEpisodeTimeline: React.FC<PatientEpisodeTimelineProps> = ({
  patient,
  history,
  isLoadingHistory,
  timelineState,
  episodeDocuments,
  onLoadDocuments,
  onDownloadPdf,
  onNavigateToDate,
  onBack,
}) => {
  return (
    <div className="flex flex-col gap-2 h-full" data-testid="patient-search-detail">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors self-start"
      >
        <ArrowLeft size={14} />
        Volver a resultados
      </button>

      <DemographicsCard patient={patient} />

      {isLoadingHistory && (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-400 justify-center">
          <Loader2 size={16} className="animate-spin" />
          Cargando historial...
        </div>
      )}

      {history && <MovementTimeline movements={history.movements} />}

      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        Episodios de hospitalizacion ({timelineState.episodeCount})
      </h4>

      {!timelineState.hasEpisodes && (
        <p className="text-xs text-slate-400 py-4 text-center">Sin episodios registrados</p>
      )}

      <div
        className="relative border-l-2 border-medical-200 ml-1.5 flex-1"
        data-testid="episode-list"
      >
        {timelineState.groupedEpisodes.map(episode => (
          <EpisodeBlockCard
            key={episode.id}
            episode={episode}
            rut={patient.rut}
            lastSeenDate={history?.lastSeen}
            episodeDocuments={episodeDocuments}
            onLoadDocuments={onLoadDocuments}
            onDownloadPdf={onDownloadPdf}
            onNavigateToDate={onNavigateToDate}
          />
        ))}
      </div>
    </div>
  );
};
