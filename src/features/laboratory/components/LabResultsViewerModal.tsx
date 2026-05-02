/**
 * @module LabResultsViewerModal
 * @description Modal for viewing laboratory exams from the Syslab system.
 */

import React, { useEffect, useRef } from 'react';
import { FlaskConical } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useLabViewer } from '../hooks/useLabViewer';
import type { LabPatient } from '@/types/domain/labExamTypes';
import { buildLabViewerModalShellModel } from '../controllers/labViewerController';
import { LabViewerControls } from './LabViewerControls';
import { LabViewerProgress } from './LabViewerProgress';
import { LabViewerExamList } from './LabViewerExamList';
import { LabViewerAnalyzeBar } from './LabViewerAnalyzeBar';
import { LabViewerPdf } from './LabViewerPdf';
import { LabViewerAnalysis } from './LabViewerAnalysis';
import { LabViewerEmptyState } from './LabViewerEmptyState';

interface LabResultsViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: LabPatient[];
  initialPatientRut?: string;
}

export const LabResultsViewerModal: React.FC<LabResultsViewerModalProps> = ({
  isOpen,
  onClose,
  patients,
  initialPatientRut,
}) => {
  const lab = useLabViewer(patients, initialPatientRut);
  const { reset } = lab;
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      reset();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, reset]);

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
    >
      {shellModel.shouldShowControls && (
        <LabViewerControls
          uniquePatients={lab.uniquePatients}
          selectedRut={lab.selectedRut}
          isLoading={lab.isLoading || lab.isAnalyzing}
          onPatientChange={lab.selectPatient}
          onSearch={lab.search}
        />
      )}

      <LabViewerProgress progress={lab.progress} />

      {lab.error && (
        <div className="mb-4 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {lab.error}
        </div>
      )}

      {shellModel.shouldShowPdf && <LabViewerPdf exam={lab.pdfExam!} onBack={lab.closePdf} />}

      {shellModel.shouldShowAnalysis && (
        <LabViewerAnalysis
          data={lab.analysisData!}
          patient={lab.selectedPatient}
          activeTab={lab.analysisView}
          onTabChange={lab.setAnalysisView}
          onBack={lab.closeAnalysis}
          onOpenPdf={lab.openPdf}
        />
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
