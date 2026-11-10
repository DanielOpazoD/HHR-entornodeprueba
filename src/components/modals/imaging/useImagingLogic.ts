import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';
import { useState, useEffect } from 'react';
import type { PatientData } from '@/types/domain/patient';
import type { CustomMark } from '@/services/pdf/imagingRequestPdfService';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { DocumentOption, ActiveTextMark } from './types';
import {
  buildImagingClosedState,
  resolveImagingCanvasIntent,
  runImagingPrintAction,
} from '../controllers/imagingRequestDialogController';

interface UseImagingLogicProps {
  isOpen: boolean;
  patient: PatientData;
}

const imagingDialogLogger = createScopedLogger('ImagingDialog');

const loadImagingPdfService = createCachedRuntimeLoader(
  () => import('@/services/pdf/imagingRequestPdfService')
);

export const useImagingLogic = ({ isOpen, patient }: UseImagingLogicProps) => {
  const [selectedDoc, setSelectedDoc] = useState<DocumentOption>('solicitud');
  const [requestingPhysician, setRequestingPhysician] = useState('');
  const [debouncedPhysician, setDebouncedPhysician] = useState('');
  const [marks, setMarks] = useState<CustomMark[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [toolMode, setToolMode] = useState<'cross' | 'text'>('cross');
  const [activeText, setActiveText] = useState<ActiveTextMark | null>(null);

  // Debounce the physician name input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPhysician(requestingPhysician);
    }, 300);
    return () => clearTimeout(timer);
  }, [requestingPhysician]);

  // Cleanup when closing
  useEffect(() => {
    if (!isOpen) {
      const closedState = buildImagingClosedState();
      setMarks(closedState.marks);
      setIsPrinting(closedState.isPrinting);
      setToolMode(closedState.toolMode);
      setActiveText(closedState.activeText);
    }
  }, [isOpen]);

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const imagingPdfService = await loadImagingPdfService();
      await runImagingPrintAction(
        imagingPdfService,
        selectedDoc,
        patient,
        debouncedPhysician,
        marks
      );
    } catch (err) {
      imagingDialogLogger.error('Error printing imaging document', err);
    } finally {
      // Re-enable button quickly
      setIsPrinting(false);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      selectedDoc !== 'solicitud' &&
      selectedDoc !== 'encuesta' &&
      selectedDoc !== 'consentimiento'
    )
      return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const canvasIntent = resolveImagingCanvasIntent(selectedDoc, toolMode, { x, y });

    if (canvasIntent.nextMark) {
      setMarks(prev => [...prev, canvasIntent.nextMark!]);
    }
    setActiveText(canvasIntent.nextActiveText);
  };

  const handleUndoMark = () => {
    setMarks(prev => prev.slice(0, -1));
  };

  return {
    selectedDoc,
    setSelectedDoc,
    requestingPhysician,
    setRequestingPhysician,
    debouncedPhysician,
    marks,
    setMarks,
    isPrinting,
    toolMode,
    setToolMode,
    activeText,
    setActiveText,
    handlePrint,
    handleCanvasClick,
    handleUndoMark,
  };
};
