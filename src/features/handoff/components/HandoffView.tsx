import React, { useEffect } from 'react';
import { useDailyRecordData, useDailyRecordHandoffActions } from '@/context/DailyRecordContext';
import { useStaffContext } from '@/context/StaffContext';
import { MessageSquare, Stethoscope, Activity } from 'lucide-react';
import { HandoffHeader } from './HandoffHeader';
import { HandoffChecklistSection } from './HandoffChecklistSection';
import { HandoffNovedades } from './HandoffNovedades';
import { HandoffCudyrPrint } from './HandoffCudyrPrint';
import { HandoffPrintHeader } from './HandoffPrintHeader';
import { MedicalHandoffHeader } from './MedicalHandoffHeader';
import { MedicalHandoffTabs } from './MedicalHandoffTabs';
import { MovementsSummary } from './MovementsSummary';
import { HandoffPatientTable } from './HandoffPatientTable';

import { useNotification } from '@/context/UIContext';
import { useHandoffLogic } from '@/hooks';
import { useAuditContext } from '@/context/AuditContext';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { useUIState, UseUIStateReturn } from '@/hooks/useUIState';
import {
  resolveHandoffDocumentTitle,
  resolveHandoffNovedadesValue,
  resolveHandoffTableHeaderClass,
  resolveHandoffTitle,
  shouldShowNightCudyrActions,
} from '@/features/handoff/controllers';

interface HandoffViewProps {
  type?: 'nursing' | 'medical';
  readOnly?: boolean;
  ui?: UseUIStateReturn;
}

export const HandoffView: React.FC<HandoffViewProps> = ({
  type = 'nursing',
  readOnly = false,
  ui: propUi,
}) => {
  const { record } = useDailyRecordData();
  const {
    updateHandoffChecklist,
    updateHandoffNovedades,
    updateHandoffStaff,
    updateMedicalHandoffDoctor,
    markMedicalHandoffAsSent,
  } = useDailyRecordHandoffActions();
  const { nursesList } = useStaffContext();
  const { success } = useNotification();
  const { logEvent } = useAuditContext();

  // Use prop UI state (shared) or local UI state (if direct mount)
  const localUi = useUIState();
  const ui = propUi || localUi;

  const {
    selectedShift,
    setSelectedShift,
    isMedical,
    visibleBeds,
    hasAnyPatients,
    schedule,
    noteField,
    deliversList,
    receivesList,
    tensList,
    shouldShowPatient,
    handleNursingNoteChange,
    handleShareLink,
    handleSendWhatsAppManual,
    formatPrintDate,
    // Clinical Events handlers
    handleClinicalEventAdd,
    handleClinicalEventUpdate,
    handleClinicalEventDelete,
  } = useHandoffLogic({
    type,
    selectedShift: ui.selectedShift,
    setSelectedShift: ui.setSelectedShift,
    onSuccess: success,
  });

  // MINSAL Traceability: Log when clinical data is viewed
  const { userId } = useAuditContext();
  useEffect(() => {
    if (record && record.date) {
      // Attribution logic for shared accounts (MINSAL requirement)
      const authors = getAttributedAuthors(
        userId,
        record,
        isMedical ? undefined : (selectedShift as 'day' | 'night')
      );

      logEvent(
        isMedical ? 'VIEW_MEDICAL_HANDOFF' : 'VIEW_NURSING_HANDOFF',
        'dailyRecord',
        record.date,
        {
          view: isMedical ? 'medical_handoff' : 'nursing_handoff',
          shift: selectedShift,
        },
        undefined,
        record.date,
        authors
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.date, type, selectedShift, isMedical, userId]); // Only log when essential state changes

  // Update document title for PDF export filename
  useEffect(() => {
    const nextTitle = resolveHandoffDocumentTitle({
      isMedical,
      selectedShift,
      recordDate: record?.date,
    });
    if (!nextTitle) return;
    document.title = nextTitle;

    // Cleanup: Reset title when unmounting
    return () => {
      document.title = 'Hospital Hanga Roa';
    };
  }, [record?.date, selectedShift, isMedical]);

  const title = resolveHandoffTitle({ isMedical, selectedShift });

  const handleOpenCudyr = () => {
    if (ui) ui.setCurrentModule('CUDYR');
  };
  const Icon = isMedical ? Stethoscope : MessageSquare;
  // Removed unused headerColor
  const tableHeaderClass = resolveHandoffTableHeaderClass({ isMedical, selectedShift });

  if (!record) {
    return (
      <div className="p-8 text-center text-slate-500 font-sans">
        Seleccione una fecha para ver la Entrega de Turno.
      </div>
    );
  }

  return (
    <div className="space-y-3 print:space-y-2 animate-fade-in pb-20 font-sans max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:w-full print:px-0 print:pb-0">
      {/* Print-only Header */}
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

      {/* Main Header (Visible) with integrated Shift Switcher & Actions */}
      <HandoffHeader
        isMedical={isMedical}
        selectedShift={selectedShift}
        setSelectedShift={setSelectedShift}
        readOnly={readOnly}
        medicalSignature={record.medicalSignature}
        medicalHandoffSentAt={record.medicalHandoffSentAt}
        onSendWhatsApp={handleSendWhatsAppManual}
        onShareLink={handleShareLink}
        extraAction={
          shouldShowNightCudyrActions({ isMedical, selectedShift }) ? (
            <button
              onClick={handleOpenCudyr}
              className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-black transition-all shadow-lg flex items-center gap-2"
            >
              <Activity size={14} />
              CUDYR
            </button>
          ) : undefined
        }
      />

      {/* Medical Handoff Header (Doctor to Doctor) */}
      {isMedical && (
        <MedicalHandoffHeader
          record={record}
          visibleBeds={visibleBeds}
          readOnly={readOnly}
          updateMedicalHandoffDoctor={updateMedicalHandoffDoctor}
          markMedicalHandoffAsSent={markMedicalHandoffAsSent}
        />
      )}

      {/* Compact Staff & Checklist Section (Monitor view) */}
      <HandoffChecklistSection
        isMedical={isMedical}
        selectedShift={selectedShift}
        record={record}
        deliversList={deliversList}
        receivesList={receivesList}
        nursesList={nursesList}
        readOnly={readOnly}
        onUpdateStaff={updateHandoffStaff}
        onUpdateChecklist={updateHandoffChecklist}
      />

      {/* Patient Table - Tabbed UPC/Non-UPC for Medical Handoff */}
      {isMedical ? (
        <MedicalHandoffTabs
          visibleBeds={visibleBeds}
          record={record}
          noteField={noteField}
          onNoteChange={handleNursingNoteChange}
          tableHeaderClass={tableHeaderClass}
          readOnly={readOnly}
          isMedical={isMedical}
          shouldShowPatient={shouldShowPatient}
        />
      ) : (
        <HandoffPatientTable
          visibleBeds={visibleBeds}
          record={record}
          noteField={noteField}
          onNoteChange={handleNursingNoteChange}
          tableHeaderClass={tableHeaderClass}
          readOnly={readOnly}
          isMedical={isMedical}
          hasAnyPatients={hasAnyPatients}
          shouldShowPatient={shouldShowPatient}
          // Clinical Events
          onClinicalEventAdd={handleClinicalEventAdd}
          onClinicalEventUpdate={handleClinicalEventUpdate}
          onClinicalEventDelete={handleClinicalEventDelete}
        />
      )}

      <div className="hidden print:block print:h-4" aria-hidden="true" />
      {/* Print-only spacer */}

      {/* Additional Sections for Nursing Handoff (Altas, Traslados, CMA) */}
      {!isMedical && <MovementsSummary record={record} selectedShift={selectedShift} />}

      {/* Novedades Section (Unified) */}
      <HandoffNovedades
        value={resolveHandoffNovedadesValue({ isMedical, selectedShift, record })}
        onChange={val => updateHandoffNovedades(isMedical ? 'medical' : selectedShift, val)}
        readOnly={readOnly}
      />

      {/* CUDYR - Night Nursing Print Only */}
      {shouldShowNightCudyrActions({ isMedical, selectedShift }) && (
        <div className="print:break-before-page">
          <HandoffCudyrPrint />
        </div>
      )}
    </div>
  );
};
