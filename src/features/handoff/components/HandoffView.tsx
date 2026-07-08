import React from 'react';
import { HandoffChecklistSection } from './HandoffChecklistSection';
import { HandoffCudyrPrint } from './HandoffCudyrPrint';
import { HandoffNightCudyrActionButton } from './HandoffNightCudyrActionButton';
import { HandoffPrintHeader } from './HandoffPrintHeader';
import { HandoffMedicalContent } from './HandoffMedicalContent';
import { HandoffNursingContent } from './HandoffNursingContent';
import { ClinicalConflictCenterControl } from '@/components/clinical-conflicts/ClinicalConflictCenterControl';
import { useUIState, UseUIStateReturn } from '@/hooks/useUIState';
import {
  buildHandoffHeaderBindings,
  buildMedicalHandoffContentBindings,
  buildNursingHandoffContentBindings,
} from '@/features/handoff/controllers/handoffViewController';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import { useHandoffViewScreenModel } from '@/features/handoff/hooks/useHandoffViewScreenModel';
interface HandoffViewProps {
  type?: 'nursing' | 'medical';
  readOnly?: boolean;
  ui?: UseUIStateReturn;
  medicalScope?: MedicalHandoffScope;
}

interface HandoffViewContentProps extends Omit<HandoffViewProps, 'ui'> {
  ui: UseUIStateReturn;
}

const HandoffViewContent: React.FC<HandoffViewContentProps> = ({
  type = 'nursing',
  readOnly = false,
  ui: handoffUi,
  medicalScope,
}) => {
  const screenModel = useHandoffViewScreenModel({
    type,
    readOnly,
    ui: handoffUi,
    medicalScope,
  });
  const {
    ui,
    record,
    isMedical,
    role,
    title,
    readOnly: effectiveReadOnly,
    nursesList,
    success,
    schedule,
    noteField,
    deliversList,
    receivesList,
    tensList,
    hasAnyPatients,
    visibleBeds,
    selectedShift,
    setSelectedShift,
    selectedMedicalSpecialty,
    setSelectedMedicalSpecialty,
    medicalBindings,
    medicalCapabilities,
    medicalActions,
    clinicalEventActions,
    formatPrintDate,
    shouldShowPatient,
    handleNursingNoteChange,
    handleShareLink,
    handleSendWhatsAppManual,
    updateHandoffChecklist,
    updateHandoffNovedades,
    updateHandoffStaff,
    updateMedicalHandoffDoctor,
    markMedicalHandoffAsSent,
    resetMedicalHandoffState,
    tableHeaderClass,
    Icon,
  } = screenModel;
  const handleOpenCudyr = () => ui.setCurrentModule('CUDYR');
  if (!record) {
    return (
      <div className="p-8 text-center text-slate-500 font-sans">
        Seleccione una fecha para ver la Entrega de Turno.
      </div>
    );
  }

  const headerBindings = buildHandoffHeaderBindings({
    isMedical,
    selectedShift,
    setSelectedShift,
    readOnly: effectiveReadOnly,
    canShareSignatureLinks: medicalCapabilities.canShareSignatureLinks,
    medicalSignature: medicalBindings.scopedMedicalSignature,
    medicalHandoffSentAt: medicalBindings.scopedMedicalHandoffSentAt,
    onSendWhatsApp: medicalCapabilities.canSendWhatsApp ? handleSendWhatsAppManual : undefined,
    onShareLink: medicalCapabilities.canShareSignatureLinks ? handleShareLink : undefined,
  });
  const medicalContentBindings = buildMedicalHandoffContentBindings({
    record,
    effectiveVisibleBeds: medicalBindings.effectiveVisibleBeds,
    specialtyFilteredBeds: medicalBindings.specialtyFilteredBeds,
    readOnly: effectiveReadOnly,
    role,
    canCopySpecialistLink: medicalCapabilities.canCopySpecialistLink,
    scopedMedicalSignature: medicalBindings.scopedMedicalSignature,
    scopedMedicalHandoffSentAt: medicalBindings.scopedMedicalHandoffSentAt,
    showDeliverySection: medicalCapabilities.canShowDeliverySection,
    canEditDoctorName: medicalCapabilities.canEditDoctorName,
    canSignMedicalHandoff: medicalCapabilities.canSign,
    updateMedicalHandoffDoctor: medicalCapabilities.canEditDoctorName
      ? updateMedicalHandoffDoctor
      : undefined,
    markMedicalHandoffAsSent: medicalCapabilities.canSign ? markMedicalHandoffAsSent : undefined,
    resetMedicalHandoffState: medicalCapabilities.canRestoreSignatures
      ? resetMedicalHandoffState
      : undefined,
    selectedMedicalSpecialty,
    setSelectedMedicalSpecialty,
    medicalSpecialties: medicalBindings.medicalSpecialties,
    success,
    noteField,
    onNoteChange: handleNursingNoteChange,
    medicalActions,
    clinicalEventActions,
    tableHeaderClass,
    shouldShowPatient,
    scopedMedicalScope: medicalBindings.scopedMedicalScope,
    hasAnyVisiblePatients: medicalBindings.hasAnyVisiblePatients,
    onSendWhatsApp: medicalCapabilities.canSendWhatsApp ? handleSendWhatsAppManual : undefined,
    onShareLink: medicalCapabilities.canShareSignatureLinks ? handleShareLink : undefined,
    canPrint: medicalCapabilities.canPrint,
  });
  const nursingContentBindings = buildNursingHandoffContentBindings({
    visibleBeds,
    record,
    noteField,
    onNoteChange: handleNursingNoteChange,
    medicalActions,
    tableHeaderClass,
    readOnly: effectiveReadOnly,
    hasAnyPatients,
    shouldShowPatient,
    clinicalEventActions,
    selectedShift,
    updateHandoffNovedades,
  });
  const clinicalConflictAction = (
    <ClinicalConflictCenterControl
      date={record.date}
      scope={isMedical ? 'medical_handoff' : 'nursing_handoff'}
      currentRecord={record}
      hideButtonLabel={!isMedical}
    />
  );
  const nursingHeaderAction =
    !isMedical &&
    (medicalCapabilities.canOpenNightCudyr && headerBindings.showNightCudyrAction ? (
      <div className="flex items-center gap-2">
        {clinicalConflictAction}
        <HandoffNightCudyrActionButton onClick={handleOpenCudyr} />
      </div>
    ) : (
      clinicalConflictAction
    ));
  return (
    <div className="space-y-3 print:space-y-2 animate-fade-in pb-20 font-sans max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:w-full print:px-0 print:pb-0">
      <HandoffPrintHeader
        title={title}
        dateString={formatPrintDate()}
        Icon={Icon}
        isMedical={isMedical}
        schedule={schedule}
        selectedShift={selectedShift}
        deliversList={deliversList}
        receivesList={receivesList}
        tensList={tensList}
      />
      {/* Header removed for both nursing and medical:
          - Nursing: title redundant (already in navbar tab), shift switcher in checklist section
          - Medical: title redundant, share actions moved to MedicalHandoffHeader */}
      <HandoffChecklistSection
        isMedical={isMedical}
        selectedShift={selectedShift}
        setSelectedShift={setSelectedShift}
        record={record}
        deliversList={deliversList}
        receivesList={receivesList}
        nursesList={nursesList}
        readOnly={effectiveReadOnly}
        onUpdateStaff={updateHandoffStaff}
        onUpdateChecklist={updateHandoffChecklist}
        extraAction={nursingHeaderAction || undefined}
      />
      {isMedical ? (
        <HandoffMedicalContent
          {...medicalContentBindings}
          conflictCenterAction={clinicalConflictAction}
        />
      ) : (
        <HandoffNursingContent {...nursingContentBindings} />
      )}
      {headerBindings.showNightCudyrAction && (
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
