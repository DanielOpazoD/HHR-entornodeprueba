import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { fetchSyslabExamDetails } from '@/services/laboratory/syslabService';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import type { AnalysisViewTab, LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { ProgressState } from '../types/labViewerTypes';
import { ANALYSIS_STEPS, SEARCH_STEPS, STEP_INTERVAL_MS } from '../constants/labProgressConstants';
import { buildAnalysisData } from '../controllers/labAnalyticsController';
import { buildLabSummaryText } from '../controllers/labSummaryController';
import {
  resolveLabViewerAnalysisErrorMessage,
  resolveSelectedLabAnalysisLinks,
} from '../controllers/labViewerController';
import { saveLabResults } from '../services/labFirestoreService';
import { enrichMicrobiologyDetailsFromPdf } from '../services/labMicrobiologyPdfService';
import { enrichUrineRatioDetailsFromPdf } from '../services/labUrinePdfService';

interface UseLabViewerAnalysisParams {
  examList: SyslabExamItem[];
  selectedExamIds: Set<string>;
  selectedRut: string;
  isLoading: boolean;
  setError: (value: string | null) => void;
}

export interface UseLabViewerAnalysisReturn {
  progress: ProgressState | null;
  isAnalyzing: boolean;
  analysisData: LabAnalysisData | null;
  analysisView: AnalysisViewTab;
  analyzeSelected: () => Promise<void>;
  copyExamSummary: (exam: SyslabExamItem) => Promise<boolean>;
  closeAnalysis: () => void;
  setAnalysisView: (tab: AnalysisViewTab) => void;
  resetAnalysis: () => void;
}

export const useLabViewerAnalysis = ({
  examList,
  selectedExamIds,
  selectedRut,
  isLoading,
  setError,
}: UseLabViewerAnalysisParams): UseLabViewerAnalysisReturn => {
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisData, setAnalysisData] = useState<LabAnalysisData | null>(null);
  const [analysisView, setAnalysisView] = useState<AnalysisViewTab>('trends');
  const progressRef = useRef<ProgressState | null>(null);
  const mountedRef = useRef(true);
  const selectionVersion = useRef(0);
  const analysisVersion = useRef(0);

  // Invalidate at commit time, before a stale promise can resume after selection changes.
  useLayoutEffect(() => {
    mountedRef.current = true;
    setIsAnalyzing(false);
    setAnalysisData(null);
    setAnalysisView('trends');
    return () => {
      mountedRef.current = false;
      selectionVersion.current += 1;
    };
  }, [selectedRut]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const active = isLoading || isAnalyzing;

    if (!active) {
      if (progressRef.current) {
        setProgress({ pct: 100, text: '¡Completado!' });
        const timeoutId = setTimeout(() => setProgress(null), 600);
        return () => clearTimeout(timeoutId);
      }

      return;
    }

    const steps = isAnalyzing ? ANALYSIS_STEPS : SEARCH_STEPS;
    let stepIndex = 1;
    setProgress(steps[0]);

    const intervalId = setInterval(() => {
      if (stepIndex < steps.length) {
        setProgress(steps[stepIndex]);
        stepIndex += 1;
        return;
      }

      setProgress(previousProgress =>
        previousProgress && previousProgress.pct < 95
          ? {
              pct: Math.min(previousProgress.pct + 1, 95),
              text: 'Finalizando consulta...',
            }
          : previousProgress
      );
    }, STEP_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isLoading, isAnalyzing]);

  const analyzeSelected = useCallback(async () => {
    const links = resolveSelectedLabAnalysisLinks({ examList, selectedExamIds });
    if (links.length === 0) {
      return;
    }

    const selection = selectionVersion.current;
    const analysis = ++analysisVersion.current;
    const isCurrent = () =>
      mountedRef.current &&
      selection === selectionVersion.current &&
      analysis === analysisVersion.current;
    setIsAnalyzing(true);
    setAnalysisData(null);
    setError(null);

    try {
      const data = await fetchSyslabExamDetails(links);
      if (!isCurrent()) {
        return;
      }

      if (!data.success) {
        setError(data.error || 'No se pudieron obtener los detalles de los exámenes.');
        return;
      }

      const microbiologyEnrichedDetails = await enrichMicrobiologyDetailsFromPdf(
        data.data,
        examList
      );
      if (!isCurrent()) return;
      const enrichedDetails = await enrichUrineRatioDetailsFromPdf(
        microbiologyEnrichedDetails,
        examList
      );
      if (!isCurrent()) {
        return;
      }

      setAnalysisData(buildAnalysisData(enrichedDetails, examList));
      setAnalysisView('trends');

      const patientName = examList[0]?.patientName || '';
      saveLabResults(selectedRut, patientName, enrichedDetails, examList);
    } catch (error) {
      if (!isCurrent()) {
        return;
      }

      setError(resolveLabViewerAnalysisErrorMessage(error));
    } finally {
      if (isCurrent()) {
        setIsAnalyzing(false);
      }
    }
  }, [examList, selectedExamIds, selectedRut, setError]);

  const copyExamSummary = useCallback(
    async (exam: SyslabExamItem): Promise<boolean> => {
      if (!exam.link) {
        setError('El examen seleccionado no tiene PDF disponible para construir el resumen.');
        return false;
      }

      const selection = selectionVersion.current;
      const isCurrent = () => mountedRef.current && selection === selectionVersion.current;
      setError(null);

      try {
        const data = await fetchSyslabExamDetails([exam.link]);
        if (!isCurrent()) {
          return false;
        }

        if (!data.success) {
          setError(data.error || 'No se pudieron obtener los detalles del examen seleccionado.');
          return false;
        }

        const detail = data.data[0];
        const findings = detail?.findings || [];
        if (findings.length === 0) {
          setError('El examen seleccionado no tiene resultados estructurados para copiar.');
          return false;
        }

        const summary = buildLabSummaryText(findings, exam.date, exam.time);
        if (!summary) {
          setError('No se pudo construir el resumen clínico del examen seleccionado.');
          return false;
        }

        await writeClipboardText(summary);
        return true;
      } catch (error) {
        if (!isCurrent()) {
          return false;
        }

        setError(resolveLabViewerAnalysisErrorMessage(error));
        return false;
      }
    },
    [setError]
  );

  const resetAnalysis = useCallback(() => {
    selectionVersion.current += 1;
    setProgress(null);
    setIsAnalyzing(false);
    setAnalysisData(null);
    setAnalysisView('trends');
  }, []);

  const closeAnalysis = useCallback(() => {
    selectionVersion.current += 1;
    setIsAnalyzing(false);
    setAnalysisData(null);
    setAnalysisView('trends');
  }, []);

  return {
    progress,
    isAnalyzing,
    analysisData,
    analysisView,
    analyzeSelected,
    copyExamSummary,
    closeAnalysis,
    setAnalysisView,
    resetAnalysis,
  };
};
