import React from 'react';
import './nursingHandoff.css';
import { HandoffChecklistSection } from './HandoffChecklistSection';
import { HandoffCudyrPrint } from './HandoffCudyrPrint';
import { HandoffPrintHeader } from './HandoffPrintHeader';
import { HandoffNursingContent } from './HandoffNursingContent';
import { useUIState, UseUIStateReturn } from '@/hooks/useUIState';
import {
  buildNursingHandoffContentBindings,
  shouldShowNightCudyrActions,
} from '@/features/handoff/controllers/handoffViewController';
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
  const screenModel = useHandoffViewScreenModel({
    readOnly,
    ui: handoffUi,
  });
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
    updateHandoffStaff,
    tableHeaderClass,
    Icon,
  } = screenModel;
  if (!record) {
    return (
      <div className="p-8 text-center text-slate-500 font-sans">
        Seleccione una fecha para ver la Entrega de Turno.
      </div>
    );
  }

  const nursingContentBindings = buildNursingHandoffContentBindings({
    visibleBeds,
    record,
    noteField,
    onNoteChange: handleNursingNoteChange,
    tableHeaderClass,
    readOnly: effectiveReadOnly,
    hasAnyPatients,
    shouldShowPatient,
    clinicalEventActions,
    selectedShift,
    updateHandoffNovedades,
  });
  return (
    <div className="nursing-handoff space-y-3 print:space-y-2 animate-fade-in pb-20 font-sans max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:w-full print:px-0 print:pb-0">
      <HandoffPrintHeader
        title={title}
        dateString={formatPrintDate()}
        Icon={Icon}
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
        onUpdateStaff={updateHandoffStaff}
        onUpdateChecklist={updateHandoffChecklist}
      />
      <HandoffNursingContent {...nursingContentBindings} />
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
