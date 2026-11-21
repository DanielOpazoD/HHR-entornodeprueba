import React from 'react';
import { MessageSquare } from 'lucide-react';
import './nursingHandoff.css';
import { HandoffChecklistSection } from './HandoffChecklistSection';
import { HandoffCudyrPrint } from './HandoffCudyrPrint';
import { HandoffPrintHeader } from './HandoffPrintHeader';
import { HandoffNursingContent } from './HandoffNursingContent';
import { useUIState, UseUIStateReturn } from '@/hooks/useUIState';
import { shouldShowNightCudyrActions } from '@/features/handoff/controllers/handoffViewController';
import { useHandoffViewScreenModel } from '@/features/handoff/hooks/useHandoffViewScreenModel';
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
    return (
      <div className="p-8 text-center text-slate-500 font-sans">
        Seleccione una fecha para ver la Entrega de Turno.
      </div>
    );
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
