/**
 * @module LabResultsViewerModal
 * @description Modal for viewing laboratory exams from the Syslab system.
 */

import React, { useEffect, useRef } from 'react';
import { ClipboardPlus, FlaskConical } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useLabViewer } from '../hooks/useLabViewer';
import type { LabPatient } from '@/types/domain/labExamTypes';
import { buildLabViewerModalShellModel } from '../controllers/labViewerController';
import { LabViewerControls } from './LabViewerControls';
import { LabViewerProgress } from './LabViewerProgress';
import { LabViewerExamList } from './LabViewerExamList';
import { LabViewerAnalyzeBar } from './LabViewerAnalyzeBar';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { LabViewerEmptyState } from './LabViewerEmptyState';
import { SyslabAccessPrompt } from './SyslabAccessPrompt';
import { useSyslabAccess } from '../hooks/useSyslabAccess';
import { useInitialLabViewerAutoSearch } from '../hooks/useInitialLabViewerAutoSearch';

const LabViewerPdf = lazyWithRetry(() =>
  import('./LabViewerPdf').then(module => ({ default: module.LabViewerPdf }))
);
const LabViewerAnalysis = lazyWithRetry(() =>
  import('./LabViewerAnalysis').then(module => ({ default: module.LabViewerAnalysis }))
);

interface LabResultsViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: LabPatient[];
  initialPatientRut?: string;
  autoSearchInitialPatient?: boolean;
  onRequestExams?: () => void;
}

export const LabResultsViewerModal: React.FC<LabResultsViewerModalProps> = ({
  isOpen,
  onClose,
  patients,
  initialPatientRut,
  autoSearchInitialPatient = false,
  onRequestExams,
}) => {
  const lab = useLabViewer(patients, initialPatientRut);
  const syslabAccess = useSyslabAccess(isOpen);
  const { reset, search } = lab;
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      reset();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, reset]);

  useInitialLabViewerAutoSearch({
    isOpen,
    enabled: autoSearchInitialPatient,
    initialPatientRut,
    accessState: syslabAccess.state,
    search,
  });

  if (!isOpen) return null;

  const shellModel = buildLabViewerModalShellModel({
    pdfExam: lab.pdfExam,
    analysisData: lab.analysisData,
    examList: lab.examList,
    isLoading: lab.isLoading,
    isAnalyzing: lab.isAnalyzing,
    error: lab.error,
  });

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      variant="white"
      size={shellModel.modalSize}
      dataModule="laboratory"
      dataTestId="lab-results-viewer-modal"
      className="!rounded-2xl ring-1 ring-black/[0.03]"
      bodyClassName="max-h-[90vh] overflow-y-auto px-5 pt-3 pb-0"
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/20">
            <FlaskConical size={16} />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-slate-800">
            Laboratorio / Exámenes Syslab
          </span>
        </span>
      }
      headerActions={
        onRequestExams ? (
          <button
            type="button"
            onClick={onRequestExams}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-500"
          >
            <ClipboardPlus size={14} aria-hidden="true" />
            Solicitar exámenes
          </button>
        ) : undefined
      }
    >
      {shellModel.shouldShowControls && (
        <>
          <LabViewerControls
            uniquePatients={lab.uniquePatients}
            selectedRut={lab.selectedRut}
            isLoading={
              lab.isLoading ||
              lab.isAnalyzing ||
              lab.isDownloadingSelectedPdfs ||
              syslabAccess.state === 'checking' ||
              syslabAccess.state === 'login-required'
            }
            onPatientChange={lab.selectPatient}
            onSearch={lab.search}
          />
          <SyslabAccessPrompt access={syslabAccess} />
        </>
      )}

      <LabViewerProgress progress={lab.progress} />

      {lab.error && (
        <div className="mb-4 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {lab.error}
        </div>
      )}

      {shellModel.shouldShowPdf && (
        <React.Suspense fallback={<p role="status">Cargando visor PDF…</p>}>
          <LabViewerPdf exam={lab.pdfExam!} onBack={lab.closePdf} />
        </React.Suspense>
      )}

      {shellModel.shouldShowAnalysis && (
        <React.Suspense fallback={<p role="status">Cargando análisis…</p>}>
          <LabViewerAnalysis
            data={lab.analysisData!}
            patient={lab.selectedPatient}
            activeTab={lab.analysisView}
            onTabChange={lab.setAnalysisView}
            onBack={lab.closeAnalysis}
            onOpenPdf={lab.openPdf}
          />
        </React.Suspense>
      )}

      {shellModel.shouldShowExamList && (
        <>
          <LabViewerExamList
            exams={lab.filteredExamList}
            selectedIds={lab.selectedExamIds}
            filterCategories={lab.examFilterCategories}
            activeFilter={lab.activeExamFilter}
            onFilterChange={lab.setExamFilter}
            onToggleSelect={lab.toggleExamSelection}
            onSelectAll={lab.selectAllExams}
            onSelectByDays={lab.selectByDays}
            onSelectByDateRange={lab.selectByDateRange}
            onViewPdf={lab.openPdf}
            onCopySummary={lab.copyExamSummary}
            isDownloadingSelectedPdfs={lab.isDownloadingSelectedPdfs}
            pdfDownloadStatus={lab.pdfDownloadStatus}
            onDownloadSelectedPdfs={lab.downloadSelectedPdfs}
          />
          <LabViewerAnalyzeBar
            selectedCount={lab.selectedExamIds.size}
            isAnalyzing={lab.isAnalyzing}
            onAnalyze={lab.analyzeSelected}
            onClear={lab.clearSelection}
          />
        </>
      )}

      {shellModel.shouldShowEmptyState && <LabViewerEmptyState />}
    </BaseModal>
  );
};
