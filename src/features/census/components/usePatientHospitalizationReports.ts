import { useCallback, useRef, useState } from 'react';

import { useNotification } from '@/context/UIContext';
import {
  requestRayenHospitalizationDocument,
  requestRayenHospitalizationEpisodes,
  type RayenHospitalizationDocumentType,
  type RayenHospitalizationEpisode,
} from '@/features/rayen-import';

interface PatientReportContext {
  patientRun: string;
  patientName: string;
  censusDate?: string;
}

interface PatientHospitalizationReportsController {
  episodes: RayenHospitalizationEpisode[];
  isLoading: boolean;
  downloadingKey: string | null;
  error: string | null;
  load: (context: PatientReportContext) => Promise<void>;
  download: (
    context: PatientReportContext,
    episode: RayenHospitalizationEpisode,
    documentType: RayenHospitalizationDocumentType
  ) => Promise<void>;
}

export const usePatientHospitalizationReports = (): PatientHospitalizationReportsController => {
  const [episodes, setEpisodes] = useState<RayenHospitalizationEpisode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const { success, error: notifyError } = useNotification();

  const load = useCallback(async (context: PatientReportContext): Promise<void> => {
    const generation = ++requestGenerationRef.current;
    setIsLoading(true);
    setLoadError(null);
    const result = await requestRayenHospitalizationEpisodes(context);
    if (generation !== requestGenerationRef.current) return;
    setIsLoading(false);
    if (!result.ok) {
      setEpisodes([]);
      setLoadError(result.error || 'Eloísa no entregó la lista de hospitalizaciones.');
      return;
    }
    setEpisodes(result.episodes || []);
  }, []);

  const download = useCallback(
    async (
      context: PatientReportContext,
      episode: RayenHospitalizationEpisode,
      documentType: RayenHospitalizationDocumentType
    ): Promise<void> => {
      const key = `${episode.encId}:${documentType}`;
      if (downloadingKey) return;
      setDownloadingKey(key);
      try {
        const result = await requestRayenHospitalizationDocument({
          patientRun: context.patientRun,
          censusDate: context.censusDate,
          clinicalEpisodeId: episode.encId,
          documentType,
        });
        if (!result.ok) {
          notifyError(
            'No se pudo obtener el informe',
            result.error || 'Eloísa no entregó el documento seleccionado.'
          );
          return;
        }
        success(
          documentType === 'epicrisis' ? 'Epicrisis descargada' : 'Ficha clínica abierta',
          documentType === 'epicrisis'
            ? `Se descargó la epicrisis de ${context.patientName}.`
            : 'Eloísa abrió la ficha completa del episodio en una pestaña nueva.'
        );
      } catch (error) {
        notifyError(
          'No se pudo obtener el informe',
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        setDownloadingKey(null);
      }
    },
    [downloadingKey, notifyError, success]
  );

  return { episodes, isLoading, downloadingKey, error: loadError, load, download };
};
