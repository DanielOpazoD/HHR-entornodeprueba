import React from 'react';
import { MessageSquare } from 'lucide-react';
import './nursingHandoff.css';
import { HandoffChecklistSection } from './HandoffChecklistSection';
import { HandoffCudyrPrint } from './HandoffCudyrPrint';
import { HandoffPrintHeader } from './HandoffPrintHeader';
import { HandoffNursingContent } from './HandoffNursingContent';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';
import { useDailyRecordSync } from '@/context/DailyRecordContext';
import { useUIState, UseUIStateReturn } from '@/hooks/useUIState';
import { shouldShowNightCudyrActions } from '@/features/handoff/controllers/handoffViewController';
import { useHandoffViewScreenModel } from '@/features/handoff/hooks/useHandoffViewScreenModel';

/**
 * Mounted only when `record` is null so subscribing to sync status never
 * re-renders the active handoff table on routine saves.
 */
const HandoffNoRecordState: React.FC = () => {
  const { bootstrapPhase } = useDailyRecordSync();

  if (bootstrapPhase === 'confirmed_empty') {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-center font-sans text-slate-600">
        <p className="font-medium text-slate-700">Este día no tiene censo.</p>
        <p className="mt-1.5 text-sm text-slate-500">
          La entrega de turno aparece cuando existe el censo del día.
        </p>
      </div>
    );
  }

  if (bootstrapPhase === 'remote_record_timeout') {
    return (
      <div
        className="mx-auto mt-8 max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-5 text-center font-sans text-slate-800"
        role="alert"
      >
        <p className="font-medium">No se pudo leer la entrega de turno de este día.</p>
        <p className="mt-2 text-sm text-slate-700">
          Revisa tu conexión. Se volverá a intentar al recuperarla o al volver a esta ventana.
        </p>
      </div>
    );
  }

  return <CensusLoadingState />;
};

interface HandoffViewProps {
  readOnly?: boolean;
  ui?: UseUIStateReturn;
}

interface HandoffViewContentProps extends Omit<HandoffViewProps, 'ui'> {
  ui: UseUIStateReturn;
}

const HandoffViewContent: React.FC<HandoffViewContentProps> = ({
  readOnly = false,
  ui: handoffUi,
}) => {
  const {
    record,
    title,
    readOnly: effectiveReadOnly,
    nursesList,
    schedule,
    noteField,
    deliversList,
    receivesList,
    tensList,
    hasAnyPatients,
    visibleBeds,
    selectedShift,
    setSelectedShift,
    clinicalEventActions,
    formatPrintDate,
    shouldShowPatient,
    handleNursingNoteChange,
    updateHandoffChecklist,
    updateHandoffNovedades,
    updateHandoffReceives,
    tableHeaderClass,
  } = useHandoffViewScreenModel({ readOnly, ui: handoffUi });
  if (!record) {
    return <HandoffNoRecordState />;
  }

  return (
    <div className="nursing-handoff space-y-3 print:space-y-2 animate-fade-in pb-20 font-sans max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:w-full print:px-0 print:pb-0">
      <HandoffPrintHeader
        title={title}
        dateString={formatPrintDate()}
        Icon={MessageSquare}
        schedule={schedule}
        selectedShift={selectedShift}
        deliversList={deliversList}
        receivesList={receivesList}
        tensList={tensList}
      />
      {/* No on-screen header: the title is already in the navbar tab, and the shift switcher
          lives in the checklist section. */}
      <HandoffChecklistSection
        selectedShift={selectedShift}
        setSelectedShift={setSelectedShift}
        record={record}
        deliversList={deliversList}
        receivesList={receivesList}
        nursesList={nursesList}
        readOnly={effectiveReadOnly}
        onUpdateReceives={updateHandoffReceives}
        onUpdateChecklist={updateHandoffChecklist}
      />
      <HandoffNursingContent
        visibleBeds={visibleBeds}
        record={record}
        noteField={noteField}
        onNoteChange={handleNursingNoteChange}
        tableHeaderClass={tableHeaderClass}
        readOnly={effectiveReadOnly}
        hasAnyPatients={hasAnyPatients}
        shouldShowPatient={shouldShowPatient}
        clinicalEventActions={clinicalEventActions}
        selectedShift={selectedShift}
        updateHandoffNovedades={updateHandoffNovedades}
      />
      {shouldShowNightCudyrActions(selectedShift) && (
        <div className="print:break-before-page">
          <HandoffCudyrPrint />
        </div>
      )}
    </div>
  );
};

const HandoffViewWithLocalUi: React.FC<Omit<HandoffViewProps, 'ui'>> = props => {
  const localUi = useUIState();
  return <HandoffViewContent {...props} ui={localUi} />;
};

export const HandoffView: React.FC<HandoffViewProps> = props => {
  if (props.ui) {
    return <HandoffViewContent {...props} ui={props.ui} />;
  }

  return <HandoffViewWithLocalUi {...props} />;
};
