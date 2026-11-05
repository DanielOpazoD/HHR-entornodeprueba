/**
 * ExamRequestModal Component
 *
 * Laboratory request form with print. From a census row it serves one patient; the clinical
 * explorer passes the census patients, and each one added gets its own tab and printed page.
 *
 * @see /docs/LABORATORY_FORM_GUIDE.md for design specifications
 */

import React, { useId, useMemo } from 'react';
import { Printer, FlaskConical, UserRound } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useExamRequestOrders, type ExamRequestCandidate } from '@/hooks/useExamRequestOrders';
import type { PatientData } from '@/types/domain/patient';
import { EXAM_REQUEST_PRINT_STYLES } from '@/components/modals/examRequestPrintStyles';
import { buildExamRequestModalShellModel } from '@/components/modals/controllers/examRequestModalController';
import { ExamRequestForm } from '@/components/exam-request/ExamRequestForm';
import {
  ExamRequestPatientTabs,
  examRequestPanelId,
  examRequestTabId,
} from '@/components/exam-request/ExamRequestPatientTabs';

interface ExamRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: PatientData;
  recordDate?: string;
  /** Census patients that may join this request: a tab each, printed one page per patient. */
  candidates?: ExamRequestCandidate[];
  /** Key of `patient` among `candidates`. */
  patientKey?: string;
}

const SINGLE_PATIENT_KEY = 'patient';

/** Mounted only while open, so every opening starts with nothing marked. */
export const ExamRequestModal: React.FC<ExamRequestModalProps> = props =>
  props.isOpen ? <ExamRequestDialog {...props} /> : null;

const ExamRequestDialog: React.FC<ExamRequestModalProps> = ({
  isOpen,
  onClose,
  patient,
  recordDate,
  candidates,
  patientKey,
}) => {
  const severalPatients = Boolean(
    patientKey && candidates?.some(candidate => candidate.key === patientKey)
  );
  const pool = useMemo<ExamRequestCandidate[]>(
    () =>
      severalPatients && candidates
        ? candidates
        : [{ key: SINGLE_PATIENT_KEY, label: '', patient }],
    [severalPatients, candidates, patient]
  );
  const requests = useExamRequestOrders({
    candidates: pool,
    initialKey: severalPatients && patientKey ? patientKey : SINGLE_PATIENT_KEY,
  });
  const shellModel = buildExamRequestModalShellModel(requests.active?.patient ?? patient);
  const idPrefix = useId();
  const orderCount = requests.orders.length;

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
          onClick={requests.print}
          title={
            orderCount > 1
              ? `Imprime las ${orderCount} órdenes en un solo documento, una página por paciente`
              : undefined
          }
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 py-2 text-[13px] font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 active:scale-[0.98] print:hidden"
        >
          <Printer size={14} />
          {orderCount > 1 ? `Imprimir ${orderCount} órdenes` : 'Imprimir'}
        </button>
      }
    >
      {severalPatients && candidates && (
        <ExamRequestPatientTabs
          idPrefix={idPrefix}
          candidates={candidates}
          orders={requests.orders}
          activeKey={requests.active?.key}
          isIncluded={requests.isIncluded}
          onSelect={requests.selectOrder}
          onTogglePatient={requests.togglePatient}
        />
      )}

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

      {/* Only the active order shows; printing takes every order, one page each. */}
      <div className="flex flex-col gap-4">
        {requests.orders.map((order, index) => (
          <ExamRequestForm
            key={order.key}
            patient={order.patient}
            recordDate={recordDate}
            selectedExams={order.selectedExams}
            procedencia={order.procedencia}
            prevision={order.prevision}
            onToggleExam={requests.toggleExam}
            onProcedenciaChange={requests.setProcedencia}
            onPrevisionChange={requests.setPrevision}
            className={order.key === requests.active?.key ? undefined : 'hidden print:block'}
            style={index < orderCount - 1 ? { breakAfter: 'page' } : undefined}
            panel={
              severalPatients
                ? {
                    id: examRequestPanelId(idPrefix, index),
                    labelledBy: examRequestTabId(idPrefix, index),
                  }
                : undefined
            }
          />
        ))}
      </div>

      <style dangerouslySetInnerHTML={{ __html: EXAM_REQUEST_PRINT_STYLES }} />
    </BaseModal>
  );
};
