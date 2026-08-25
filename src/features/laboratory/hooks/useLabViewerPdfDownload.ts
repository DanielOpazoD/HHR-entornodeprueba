import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SyslabExamItem, SyslabPdfDownloadStatus } from '@/types/domain/labExamTypes';
import { downloadCombinedSyslabPdf } from '@/services/laboratory/syslabPdfBundleService';

interface UseLabViewerPdfDownloadParams {
  examList: SyslabExamItem[];
  selectedExamIds: Set<string>;
  selectedRut: string;
  setError: (message: string | null) => void;
}

export const useLabViewerPdfDownload = ({
  examList,
  selectedExamIds,
  selectedRut,
  setError,
}: UseLabViewerPdfDownloadParams) => {
  const [isDownloadingSelectedPdfs, setIsDownloadingSelectedPdfs] = useState(false);
  const [pdfDownloadStatus, setPdfDownloadStatus] = useState<SyslabPdfDownloadStatus | null>(null);
  const requestIdRef = useRef(0);
  const selectionKey = useMemo(() => [...selectedExamIds].sort().join('|'), [selectedExamIds]);

  useEffect(() => setPdfDownloadStatus(null), [selectionKey]);

  const cancelPdfDownload = useCallback(() => {
    requestIdRef.current += 1;
    setIsDownloadingSelectedPdfs(false);
    setPdfDownloadStatus(null);
  }, []);

  const downloadSelectedPdfs = useCallback(async () => {
    const selectedExams = examList.filter(exam => selectedExamIds.has(exam.id));
    const selectedLinks = selectedExams.map(exam => exam.link);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError(null);
    setIsDownloadingSelectedPdfs(true);
    setPdfDownloadStatus({
      phase: 'validating',
      completed: 0,
      total: selectedExams.length,
      pageCount: 0,
    });
    try {
      if (
        selectedLinks.length !== selectedExamIds.size ||
        selectedLinks.some(link => typeof link !== 'string' || link.length === 0)
      ) {
        throw new Error(
          'Uno de los informes seleccionados no está disponible. Actualiza la búsqueda antes de descargar.'
        );
      }
      const result = await downloadCombinedSyslabPdf({
        exams: selectedExams,
        rut: selectedRut,
        onProgress: progress => {
          if (requestIdRef.current === requestId) setPdfDownloadStatus(progress);
        },
      });
      if (requestIdRef.current === requestId) {
        setPdfDownloadStatus({
          phase: 'success',
          completed: result.reportCount,
          total: result.reportCount,
          pageCount: result.pageCount,
          filename: result.filename,
          legacyExtension: result.legacyExtension,
        });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setPdfDownloadStatus(null);
        setError(error instanceof Error ? error.message : 'No se pudo descargar el PDF combinado.');
      }
    } finally {
      if (requestIdRef.current === requestId) setIsDownloadingSelectedPdfs(false);
    }
  }, [examList, selectedExamIds, selectedRut, setError]);

  return {
    cancelPdfDownload,
    downloadSelectedPdfs,
    isDownloadingSelectedPdfs,
    pdfDownloadStatus,
  };
};
