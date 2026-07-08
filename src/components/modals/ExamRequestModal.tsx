/**
 * ExamRequestModal Component
 *
 * Modularized laboratory exam request form with print functionality.
 * Uses extracted components and hooks for better maintainability.
 * Premium aesthetic matching MedicalIndicationsDialog style.
 *
 * @see /docs/LABORATORY_FORM_GUIDE.md for design specifications
 */

import React from 'react';
import { Printer, FlaskConical, UserRound } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useExamRequest } from '@/hooks/useExamRequest';
import type { PatientData } from '@/types/domain/patient';
import { EXAM_REQUEST_PRINT_STYLES } from '@/components/modals/examRequestPrintStyles';
import {
  buildExamRequestFooterFields,
  buildExamRequestFooterSection,
  buildExamRequestFormColumns,
  buildExamRequestModalShellModel,
} from '@/components/modals/controllers/examRequestModalController';
import { ExamCheckbox } from '@/components/exam-request/ExamCheckbox';
import { ExamFormHeader } from '@/components/exam-request/ExamFormHeader';
import { ExamPatientInfo } from '@/components/exam-request/ExamPatientInfo';
import { ExamMetadata } from '@/components/exam-request/ExamMetadata';

interface ExamRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: PatientData;
  recordDate?: string;
}

const examRequestColumns = buildExamRequestFormColumns();
const examRequestFooterSection = buildExamRequestFooterSection();
const examRequestFooterFields = buildExamRequestFooterFields();

export const ExamRequestModal: React.FC<ExamRequestModalProps> = ({
  isOpen,
  onClose,
  patient,
  recordDate,
}) => {
  const {
    selectedExams,
    procedencia,
    prevision,
    setProcedencia,
    setPrevision,
    toggleExam,
    handlePrint,
  } = useExamRequest({ patient, isOpen });
  const shellModel = buildExamRequestModalShellModel(patient);

  const renderExamItem = (exam: string, categoryTitle: string) => (
    <ExamCheckbox
      key={`${categoryTitle}|${exam}`}
      exam={exam}
      categoryTitle={categoryTitle}
      isSelected={selectedExams.has(`${categoryTitle}|${exam}`)}
      onToggle={toggleExam}
    />
  );

  const renderSection = (
    title: string,
    exams: string[],
    options?: {
      tube?: string;
      columns?: 1 | 2;
      muted?: boolean;
      withTopBorder?: boolean;
      withBottomBorder?: boolean;
    }
  ) => (
    <React.Fragment key={title}>
      <div
        className={[
          'bg-white text-slate-900 py-0.5 text-center flex flex-col items-center',
          options?.withTopBorder ? 'border-t-2 border-slate-900' : '',
          'border-b-2 border-slate-900',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="text-[9px] font-black tracking-widest uppercase">{title}</span>
        {options?.tube ? (
          <span className="text-[6px] text-slate-500 font-bold">({options.tube})</span>
        ) : null}
      </div>
      <div
        className={[
          'p-2 flex flex-col gap-0.5',
          options?.muted ? 'bg-slate-50/50 flex-1' : '',
          options?.withBottomBorder ? 'border-b border-slate-200' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {options?.columns === 2 ? (
          <div className="grid grid-cols-2 gap-x-2">
            {exams.map(exam => renderExamItem(exam, title))}
          </div>
        ) : (
          exams.map(exam => renderExamItem(exam, title))
        )}
      </div>
    </React.Fragment>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      printable={true}
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/20">
            <FlaskConical size={16} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight text-slate-800">
              {shellModel.title}
            </span>
            <span className="text-[11px] font-medium text-slate-400">{shellModel.subtitle}</span>
          </span>
        </span>
      }
      size="full"
      variant="white"
      dataModule="exam-request"
      dataTestId="exam-request-modal"
      className="!rounded-2xl ring-1 ring-black/[0.03]"
      bodyClassName="max-h-[90vh] overflow-y-auto px-5 py-4"
      headerActions={
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 py-2 text-[13px] font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 active:scale-[0.98] print:hidden"
        >
          <Printer size={14} />
          Imprimir
        </button>
      }
    >
      {/* Patient info banner */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/80 via-emerald-50/40 to-transparent px-4 py-3 print:hidden">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <UserRound size={16} />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <span className="font-semibold text-slate-700">{shellModel.patientName}</span>
          {shellModel.patientRut && (
            <>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500">{shellModel.patientRut}</span>
            </>
          )}
          {shellModel.patientPathology && (
            <>
              <span className="text-slate-400">|</span>
              <span
                className="max-w-[260px] truncate text-slate-500"
                title={shellModel.patientPathology}
              >
                {shellModel.patientPathology}
              </span>
            </>
          )}
          {shellModel.patientBedName && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              {shellModel.patientBedName}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* PDF Replica Container */}
        <div
          id="exam-request-form"
          className="bg-white p-2 border border-slate-300 shadow-sm mx-auto max-w-[800px] font-sans text-slate-900 print:p-0 print:border-none print:shadow-none print:m-0 print:max-w-none"
        >
          <ExamFormHeader />
          <ExamMetadata
            procedencia={procedencia}
            prevision={prevision}
            onProcedenciaChange={setProcedencia}
            onPrevisionChange={setPrevision}
          />
          <ExamPatientInfo patient={patient} recordDate={recordDate} />

          {/* Exams Grid */}
          <div className="grid grid-cols-12 border-2 border-slate-900 rounded-lg overflow-hidden min-h-[480px]">
            {examRequestColumns.map((column, columnIndex) => (
              <div
                key={`column-${columnIndex}`}
                className={[
                  'col-span-4 flex flex-col',
                  columnIndex < examRequestColumns.length - 1 ? 'border-r-2 border-slate-900' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {column.sections.map((section, sectionIndex) =>
                  renderSection(section.title, section.exams, {
                    tube: section.tube,
                    columns: section.columns,
                    muted: section.muted,
                    withTopBorder: sectionIndex > 0,
                    withBottomBorder:
                      columnIndex === examRequestColumns.length - 1 &&
                      sectionIndex < column.sections.length - 1,
                  })
                )}
                {column.footerLabel && column.footerExams ? (
                  <div className="bg-white border-t border-slate-300 p-2">
                    <span className="text-[8px] font-black text-slate-400 uppercase block mb-1 underline">
                      {column.footerLabel}
                    </span>
                    {column.footerExams.map(exam => renderExamItem(exam, column.footerLabel!))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Footer Section */}
          <div className="grid grid-cols-12 border-2 border-slate-900 rounded-lg mt-0.5 overflow-hidden">
            <div className="col-span-4 border-r-2 border-slate-900 flex flex-col">
              {renderSection(examRequestFooterSection.title, examRequestFooterSection.exams, {
                tube: examRequestFooterSection.tube,
              })}
            </div>

            <div className="col-span-8 p-2 flex flex-col gap-4 justify-center">
              {examRequestFooterFields.map(field => (
                <div key={field.label} className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-slate-900 uppercase whitespace-nowrap">
                    {field.label}:
                  </span>
                  {field.lines === 2 ? (
                    <div className="flex-1 flex flex-col gap-3">
                      <div className="border-b border-slate-900 h-0.5 w-full"></div>
                      <div className="border-b border-slate-900 h-0.5 w-full"></div>
                    </div>
                  ) : (
                    <div className="border-b border-slate-900 flex-1 h-0.5 mt-1"></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: EXAM_REQUEST_PRINT_STYLES }} />
    </BaseModal>
  );
};
