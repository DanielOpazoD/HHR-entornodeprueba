import { useCallback, useRef, useState } from 'react';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import { downloadCombinedSyslabPdf } from '@/services/laboratory/syslabPdfBundleService';

interface UseLabViewerPdfDownloadParams {
  examList: SyslabExamItem[];
  selectedExamIds: Set<string>;
  setError: (message: string | null) => void;
}

export const useLabViewerPdfDownload = ({
  examList,
  selectedExamIds,
  setError,
}: UseLabViewerPdfDownloadParams) => {
  const [isDownloadingSelectedPdfs, setIsDownloadingSelectedPdfs] = useState(false);
  const requestIdRef = useRef(0);

  const cancelPdfDownload = useCallback(() => {
    requestIdRef.current += 1;
    setIsDownloadingSelectedPdfs(false);
  }, []);

  const downloadSelectedPdfs = useCallback(async () => {
    const selectedExams = examList.filter(exam => selectedExamIds.has(exam.id));
    const selectedLinks = selectedExams.map(exam => exam.link);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError(null);
    setIsDownloadingSelectedPdfs(true);
    try {
      if (
        selectedLinks.length !== selectedExamIds.size ||
        selectedLinks.some(link => typeof link !== 'string' || link.length === 0)
      ) {
        throw new Error(
          'Uno de los informes seleccionados no está disponible. Actualiza la búsqueda antes de descargar.'
        );
      }
      await downloadCombinedSyslabPdf(selectedLinks as string[]);
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setError(error instanceof Error ? error.message : 'No se pudo descargar el PDF combinado.');
      }
    } finally {
      if (requestIdRef.current === requestId) setIsDownloadingSelectedPdfs(false);
    }
  }, [examList, selectedExamIds, setError]);

  return { cancelPdfDownload, downloadSelectedPdfs, isDownloadingSelectedPdfs };
};
