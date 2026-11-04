import React from 'react';
import { FileText, Printer, UserRound } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { ImagingRequestDialogProps } from './imaging/types';
import { useImagingLogic } from './imaging/useImagingLogic';
import { ImagingSidebar } from './imaging/ImagingSidebar';
import { ImagingViewer } from './imaging/ImagingViewer';
import {
  buildImagingDialogShellModel,
  IMAGING_DOCUMENT_OPTIONS,
} from './controllers/imagingRequestDialogController';

export const ImagingRequestDialog: React.FC<ImagingRequestDialogProps> = ({
  isOpen,
  onClose,
  patient,
}) => {
  const {
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
  } = useImagingLogic({ isOpen, patient });
  const shellModel = buildImagingDialogShellModel(patient);

  if (!isOpen) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      printable={false}
      variant="white"
      className="!rounded-2xl ring-1 ring-black/[0.04] shadow-2xl"
      bodyClassName="max-h-[92vh] overflow-y-auto px-4 py-3"
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md shadow-indigo-500/25">
            <FileText size={16} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight text-slate-800">
              {shellModel.title}
            </span>
            {shellModel.subtitle && (
              <span className="text-[11px] font-medium text-slate-400">{shellModel.subtitle}</span>
            )}
          </span>
        </span>
      }
      headerActions={
        <button
          onClick={handlePrint}
          disabled={isPrinting}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 py-1.5 text-[12px] font-semibold text-white shadow-md shadow-indigo-600/25 transition-all hover:from-indigo-600 hover:to-indigo-700 hover:shadow-lg hover:shadow-indigo-600/30 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none group"
        >
          <Printer
            size={14}
            className={isPrinting ? 'animate-bounce' : 'group-hover:rotate-12 transition-transform'}
          />
          <span>{isPrinting ? 'Preparando…' : 'Imprimir'}</span>
        </button>
      }
      size="full"
    >
      {/* Patient info banner */}
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-indigo-50/40 to-transparent px-4 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
          <UserRound size={14} />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <span className="font-semibold text-slate-700">{shellModel.patientName}</span>
          {shellModel.patientRut && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-slate-500">{shellModel.patientRut}</span>
            </>
          )}
          {shellModel.patientPathology && (
            <>
              <span className="text-slate-300">|</span>
              <span
                className="max-w-[200px] truncate text-slate-500"
                title={shellModel.patientPathology}
              >
                {shellModel.patientPathology}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex h-[calc(100vh-180px)] w-full gap-3 pb-2">
        <ImagingSidebar
          documents={IMAGING_DOCUMENT_OPTIONS}
          selectedDoc={selectedDoc}
          setSelectedDoc={setSelectedDoc}
          requestingPhysician={requestingPhysician}
          setRequestingPhysician={setRequestingPhysician}
          toolMode={toolMode}
          setToolMode={setToolMode}
          marks={marks}
          handleUndoMark={handleUndoMark}
        />
        <ImagingViewer
          selectedDoc={selectedDoc}
          patient={patient}
          debouncedPhysician={debouncedPhysician}
          handleCanvasClick={handleCanvasClick}
          marks={marks}
          setMarks={setMarks}
          activeText={activeText}
          setActiveText={setActiveText}
        />
      </div>
    </BaseModal>
  );
};
