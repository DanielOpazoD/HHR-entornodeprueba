/**
 * The printed laboratory request of one patient: a replica of the paper form, with the marked
 * exams, origin and insurance. Several forms print together, one page each.
 *
 * @see /docs/LABORATORY_FORM_GUIDE.md for design specifications
 */

import React from 'react';
import clsx from 'clsx';
import type { PatientData } from '@/types/domain/patient';
import type {
  ExamRequestFreeText,
  ExamRequestFreeTextField,
} from '@/hooks/controllers/examRequestController';
import {
  buildExamRequestFooterFields,
  buildExamRequestFooterSection,
  buildExamRequestFormColumns,
} from '@/components/modals/controllers/examRequestModalController';
import { ExamCheckbox } from './ExamCheckbox';
import { ExamFormHeader } from './ExamFormHeader';
import { ExamPatientInfo } from './ExamPatientInfo';
import { ExamMetadata } from './ExamMetadata';

interface ExamRequestFormProps {
  patient: PatientData;
  recordDate?: string;
  selectedExams: ReadonlySet<string>;
  procedencia: string;
  prevision: string;
  freeText: ExamRequestFreeText;
  onToggleExam: (examKey: string) => void;
  onProcedenciaChange: (value: string) => void;
  onPrevisionChange: (value: string) => void;
  onFreeTextChange: (field: ExamRequestFreeTextField, value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  /** With several patients, the form is the panel of its tab. */
  panel?: { id: string; labelledBy: string };
}

const examRequestColumns = buildExamRequestFormColumns();
const examRequestFooterSection = buildExamRequestFooterSection();
const examRequestFooterFields = buildExamRequestFooterFields();

const FREE_TEXT_LINE_PX = 16;
/** One rule under every text line, so wrapped text stays on the form's lines. */
const RULED_LINES: React.CSSProperties = {
  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${FREE_TEXT_LINE_PX - 1}px, #0f172a ${FREE_TEXT_LINE_PX - 1}px ${FREE_TEXT_LINE_PX}px)`,
};

export const ExamRequestForm: React.FC<ExamRequestFormProps> = ({
  patient,
  recordDate,
  selectedExams,
  procedencia,
  prevision,
  freeText,
  onToggleExam,
  onProcedenciaChange,
  onPrevisionChange,
  onFreeTextChange,
  className,
  style,
  panel,
}) => {
  const renderExamItem = (exam: string, categoryTitle: string) => (
    <ExamCheckbox
      key={`${categoryTitle}|${exam}`}
      exam={exam}
      categoryTitle={categoryTitle}
      isSelected={selectedExams.has(`${categoryTitle}|${exam}`)}
      onToggle={onToggleExam}
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

  // Long text wraps onto the next ruled line and the box grows: a request never loses text in
  // print. Printing uses a plain copy, because a field prints only what fits in its box.
  const renderFreeText = (field: ExamRequestFreeTextField, label: string, lineCount: number) => (
    <div className="flex-1 min-w-0">
      <textarea
        rows={lineCount}
        // Shared computers: the browser must not remember what one person typed.
        autoComplete="off"
        aria-label={label}
        value={freeText[field]}
        onChange={event => onFreeTextChange(field, event.target.value)}
        className="block w-full resize-none overflow-y-auto border-0 rounded-none bg-transparent px-1 py-0 text-[10px] font-medium leading-4 text-slate-900 outline-none [field-sizing:content] focus:bg-emerald-50 print:hidden"
        style={{ ...RULED_LINES, minHeight: lineCount * FREE_TEXT_LINE_PX }}
      />
      <p
        data-testid={`exam-request-print-${field}`}
        aria-hidden="true"
        className="hidden print:block whitespace-pre-wrap break-words px-1 text-[10px] font-medium leading-4 text-slate-900"
        style={{ ...RULED_LINES, minHeight: lineCount * FREE_TEXT_LINE_PX }}
      >
        {freeText[field]}
      </p>
    </div>
  );

  return (
    <div
      data-testid="exam-request-form"
      id={panel?.id}
      role={panel ? 'tabpanel' : undefined}
      aria-labelledby={panel?.labelledBy}
      className={clsx(
        'exam-request-form bg-white p-2 border border-slate-300 shadow-sm mx-auto max-w-[800px] font-sans text-slate-900 print:p-0 print:border-none print:shadow-none print:m-0 print:max-w-none',
        className
      )}
      style={style}
    >
      <ExamFormHeader />
      <ExamMetadata
        procedencia={procedencia}
        prevision={prevision}
        onProcedenciaChange={onProcedenciaChange}
        onPrevisionChange={onPrevisionChange}
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
                <span className="text-[9px] font-black text-slate-400 uppercase block mb-1 underline">
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
              {field.freeText ? (
                renderFreeText(field.freeText, field.label, field.lines ?? 1)
              ) : field.lines === 2 ? (
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
  );
};
