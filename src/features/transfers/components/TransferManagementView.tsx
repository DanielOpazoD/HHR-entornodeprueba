/**
 * Transfer Management View
 * Main view for managing patient transfer requests
 */

import React from 'react';
import { ArrowRightLeft, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { TransferTable } from './internal/TransferTable';
import { TransferFormModal } from './internal/TransferFormModal';
import { StatusChangeModal } from './internal/StatusChangeModal';
import { ConfirmTransferModal } from './internal/ConfirmTransferModal';
import { CancelTransferModal } from './internal/CancelTransferModal';
import { useTransferManagementViewRuntime } from '../hooks/useTransferManagementViewRuntime';
import {
  buildTransferCancelModalBindings,
  buildTransferConfirmModalBindings,
  buildTransferDocumentPackageModalBindings,
  buildTransferFinalizedSectionModel,
  buildTransferFormModalBindings,
  buildTransferHeaderModel,
  buildTransferMonthButtonModels,
  buildTransferProcessingOverlayModel,
  buildTransferStatusModalBindings,
  buildTransferTableActions,
  buildTransferTableSectionModel,
  buildTransferQuestionnaireModalBindings,
  buildTransferTableBindings,
  buildTransferYearButtonModels,
} from './controllers/transferManagementViewController';

const TransferQuestionnaireModal = React.lazy(() =>
  import('./internal/TransferQuestionnaireModal').then(module => ({
    default: module.TransferQuestionnaireModal,
  }))
);

const TransferDocumentPackageModal = React.lazy(() =>
  import('./internal/TransferDocumentPackageModal').then(module => ({
    default: module.TransferDocumentPackageModal,
  }))
);

export const TransferManagementView: React.FC = () => {
  const {
    selectedYear,
    setSelectedYear,
    selectedMonth,
    setSelectedMonth,
    showFinalizedTransfers,
    setShowFinalizedTransfers,
    monthLabels,
    transferManagement,
    viewStates,
    periodModel,
    selectedHospital,
  } = useTransferManagementViewRuntime();
  const {
    isLoading,
    error,
    setTransferStatus,
    updateTransfer,
    undoTransfer,
    archiveTransfer,
    deleteHistoryEntry,
    deleteTransfer,
    deleteFinalizedTransfer,
    getHospitalizedPatients,
  } = transferManagement;
  const { modals, selectedTransfer, isGenerating, generatedDocs, patientDataForDocs, handlers } =
    viewStates;
  const { availableYears, filteredActiveCount, activeTransfers, finalizedTransfers } = periodModel;
  const tableActions = buildTransferTableActions({
    setTransferStatus,
    updateTransfer,
    undoTransfer,
    archiveTransfer,
    deleteHistoryEntry,
    deleteTransfer,
    deleteFinalizedTransfer,
  });
  const activeTableBindings = buildTransferTableBindings({
    transfers: activeTransfers,
    handlers,
    actions: tableActions,
  });
  const finalizedTableBindings = buildTransferTableBindings({
    transfers: finalizedTransfers,
    mode: 'finalized',
    handlers,
    actions: tableActions,
  });
  const yearButtonModels = buildTransferYearButtonModels({
    availableYears,
    selectedYear,
  });
  const headerModel = buildTransferHeaderModel({
    filteredActiveCount,
  });
  const monthButtonModels = buildTransferMonthButtonModels({
    monthLabels,
    selectedMonth,
  });
  const activeSectionModel = buildTransferTableSectionModel({
    isLoading,
    loadingMessage: 'Cargando solicitudes...',
  });
  const finalizedSectionModel = buildTransferFinalizedSectionModel({
    finalizedTransfersCount: finalizedTransfers.length,
    showFinalizedTransfers,
    isLoading,
  });
  const processingOverlayModel = buildTransferProcessingOverlayModel();

  return (
    <div
      className="max-w-7xl mx-auto px-4 py-6 animate-in fade-in duration-500"
      data-testid="transfer-management-view"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-md shadow-sky-500/20">
            <ArrowRightLeft size={18} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">{headerModel.title}</h1>
            <p className="text-[11px] text-slate-400">{headerModel.activeCountLabel}</p>
          </div>
        </div>
        <button
          onClick={handlers.handleNewRequest}
          data-testid="transfer-new-request-button"
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-sky-500 to-sky-600 px-4 py-2 text-[13px] font-semibold text-white shadow-md shadow-sky-600/25 transition-all hover:from-sky-600 hover:to-sky-700 hover:shadow-lg active:scale-[0.98]"
        >
          <Plus size={15} />
          {headerModel.newRequestLabel}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          <span className="font-semibold">Error:</span> {error}
        </div>
      )}

      {/* Year + Month Selector */}
      <div className="mb-4 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm ring-1 ring-black/[0.02]">
        <div className="flex items-center gap-4">
          {/* Year pills */}
          <div className="flex items-center gap-1">
            {yearButtonModels.map(yearButton => (
              <button
                key={yearButton.key}
                onClick={() => setSelectedYear(yearButton.value)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  yearButton.isSelected
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {yearButton.label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-slate-200/60" />

          {/* Month pills — horizontal */}
          <div className="flex flex-1 items-center gap-1 overflow-x-auto">
            {monthButtonModels.map(monthButton => (
              <button
                key={monthButton.key}
                onClick={() => setSelectedMonth(monthButton.value)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  monthButton.isSelected
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                }`}
              >
                {monthButton.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Active Transfers Table */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-black/[0.02] overflow-visible">
        {activeSectionModel.shouldShowLoadingState ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="h-8 w-8 rounded-full border-[3px] border-sky-500 border-t-transparent animate-spin" />
            <p className="mt-3 text-[13px] text-slate-400 font-medium">
              {activeSectionModel.loadingMessage}
            </p>
          </div>
        ) : (
          <TransferTable {...activeTableBindings} />
        )}
      </div>

      {/* Finalized Transfers */}
      <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-black/[0.02] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFinalizedTransfers(prev => !prev)}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50/60"
        >
          <div>
            <h2 className="text-[14px] font-bold text-slate-700">{finalizedSectionModel.title}</h2>
            <p className="text-[11px] text-slate-400">{finalizedSectionModel.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {finalizedSectionModel.countLabel}
            </span>
            {finalizedSectionModel.toggleIcon === 'down' ? (
              <ChevronDown size={15} className="text-slate-400" />
            ) : (
              <ChevronRight size={15} className="text-slate-400" />
            )}
          </div>
        </button>

        {finalizedSectionModel.shouldShowContent && (
          <div className="border-t border-slate-100">
            {finalizedSectionModel.shouldShowLoadingState ? (
              <div className="py-8 text-center text-[13px] text-slate-400">
                {finalizedSectionModel.loadingMessage}
              </div>
            ) : (
              <TransferTable {...finalizedTableBindings} />
            )}
          </div>
        )}
      </div>

      {/* Modals Orchestration */}
      {modals.form && (
        <TransferFormModal
          {...buildTransferFormModalBindings({
            selectedTransfer,
            onClose: handlers.handleCloseFormModal,
            onSave: handlers.handleSave,
          })}
          patients={getHospitalizedPatients()}
        />
      )}

      {modals.status && selectedTransfer && (
        <StatusChangeModal
          {...buildTransferStatusModalBindings({
            selectedTransfer,
            onClose: handlers.handleCloseStatusModal,
            onConfirm: handlers.handleConfirmStatusChange,
          })}
        />
      )}

      {modals.transfer && selectedTransfer && (
        <ConfirmTransferModal
          {...buildTransferConfirmModalBindings({
            selectedTransfer,
            onClose: handlers.handleCloseTransferModal,
            onConfirm: handlers.handleConfirmTransfer,
          })}
        />
      )}

      {modals.cancel && selectedTransfer && (
        <CancelTransferModal
          {...buildTransferCancelModalBindings({
            selectedTransfer,
            onClose: handlers.handleCloseCancelModal,
            onConfirm: handlers.handleConfirmCancel,
          })}
        />
      )}

      {modals.questionnaire && selectedTransfer && (
        <React.Suspense fallback={null}>
          <TransferQuestionnaireModal
            {...buildTransferQuestionnaireModalBindings({
              isOpen: modals.questionnaire,
              selectedTransfer,
              onClose: handlers.handleCloseQuestionnaire,
              onComplete: handlers.handleQuestionnaireComplete,
            })}
            hospital={selectedHospital!}
          />
        </React.Suspense>
      )}

      {modals.package && selectedTransfer && patientDataForDocs && (
        <React.Suspense fallback={null}>
          <TransferDocumentPackageModal
            {...buildTransferDocumentPackageModalBindings({
              isOpen: modals.package,
              patientDataForDocs,
              generatedDocs,
              onClose: handlers.handleClosePackageModal,
            })}
            hospital={selectedHospital!}
          />
        </React.Suspense>
      )}

      {/* Processing Overlay */}
      {isGenerating && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white px-8 py-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 border border-slate-200/80 ring-1 ring-black/[0.04]">
            <div className="h-10 w-10 rounded-full border-[3px] border-sky-500 border-t-transparent animate-spin" />
            <div className="text-center">
              <p className="font-bold text-slate-800 text-[15px] tracking-tight">
                {processingOverlayModel.title}
              </p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                {processingOverlayModel.description}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransferManagementView;
