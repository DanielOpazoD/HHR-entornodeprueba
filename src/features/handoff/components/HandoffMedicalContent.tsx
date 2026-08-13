import React, { useMemo, useState } from 'react';
import type { BedDefinition } from '@/types/domain/beds';
import type { Specialty } from '@/domain/handoff/patientContracts';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import type { HandoffClinicalEventActions, HandoffMedicalActions } from './handoffRowContracts';
import { buildMedicalSpecialtyFilterChips } from '@/features/handoff/controllers/handoffMedicalContentController';
import { MedicalHandoffHeader, type MedicalHandoffBedStatsData } from './MedicalHandoffHeader';
import { MedicalShareActions } from './MedicalShareActions';
import { MedicalHandoffTabs } from './MedicalHandoffTabs';
import type { MedicalHandoffScope as ScopeType } from '@/types/medicalHandoff';
import {
  countScopedPatients,
  splitMedicalBedsByScope,
  type MedicalPrintMode,
  type MedicalTabMode,
} from '@/features/handoff/controllers/medicalHandoffTabsController';
import { MedicalHandoffTabSwitcher } from './MedicalHandoffTabSwitcher';
import { MedicalHandoffPrintMenu } from './MedicalHandoffPrintMenu';
import { MedicalHandoffSpreadsheetAction } from './MedicalHandoffSpreadsheetAction';
import { buildMedicalHandoffSpreadsheetRows } from '@/features/handoff/controllers/medicalHandoffSpreadsheetController';
import { useStaffContext } from '@/context/StaffContext';

interface HandoffMedicalContentProps {
  record: DailyRecord;
  effectiveVisibleBeds: BedDefinition[];
  specialtyFilteredBeds: BedDefinition[];
  readOnly: boolean;
  role?: string;
  canCopySpecialistLink: boolean;
  scopedMedicalSignature: { doctorName: string; signedAt: string } | null;
  scopedMedicalHandoffSentAt: string | null;
  showDeliverySection: boolean;
  canEditDoctorName: boolean;
  canSignMedicalHandoff: boolean;
  updateMedicalHandoffDoctor?: (doctorName: string) => Promise<void>;
  markMedicalHandoffAsSent?: (doctorName?: string, scope?: ScopeType) => Promise<void>;
  resetMedicalHandoffState?: () => Promise<void>;
  selectedMedicalSpecialty: Specialty | 'all';
  setSelectedMedicalSpecialty: (specialty: Specialty | 'all') => void;
  medicalSpecialties: Specialty[];
  success: (message: string, description?: string) => void;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift' | 'medicalHandoffNote';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  medicalActions: HandoffMedicalActions;
  clinicalEventActions: HandoffClinicalEventActions;
  tableHeaderClass: string;
  shouldShowPatient: (bedId: string) => boolean;
  scopedMedicalScope: MedicalHandoffScope;
  hasAnyVisiblePatients: boolean;
  onSendWhatsApp?: () => void;
  onShareLink?: (scope: MedicalHandoffScope) => void;
  canPrint: boolean;
  conflictCenterAction?: React.ReactNode;
}

export const HandoffMedicalContent: React.FC<HandoffMedicalContentProps> = ({
  record,
  effectiveVisibleBeds,
  specialtyFilteredBeds,
  readOnly,
  role: _role,
  canCopySpecialistLink: _canCopySpecialistLink,
  scopedMedicalSignature,
  scopedMedicalHandoffSentAt,
  showDeliverySection,
  canEditDoctorName,
  canSignMedicalHandoff,
  updateMedicalHandoffDoctor,
  markMedicalHandoffAsSent,
  resetMedicalHandoffState,
  selectedMedicalSpecialty,
  setSelectedMedicalSpecialty,
  medicalSpecialties,
  success: _success,
  noteField,
  onNoteChange,
  medicalActions,
  clinicalEventActions,
  tableHeaderClass,
  shouldShowPatient,
  scopedMedicalScope,
  hasAnyVisiblePatients,
  onSendWhatsApp,
  onShareLink,
  canPrint,
  conflictCenterAction,
}) => {
  const { professionalsCatalog = [] } = useStaffContext();
  const [bedStats, setBedStats] = useState<MedicalHandoffBedStatsData | null>(null);
  const [activeTab, setActiveTab] = useState<MedicalTabMode>('all');
  const [printMode, setPrintMode] = useState<MedicalPrintMode>('all');
  const headerRecord = useMemo(
    () => ({
      ...record,
      medicalSignature: scopedMedicalSignature || undefined,
      medicalHandoffSentAt: scopedMedicalHandoffSentAt || undefined,
    }),
    [record, scopedMedicalHandoffSentAt, scopedMedicalSignature]
  );
  const filterChips = buildMedicalSpecialtyFilterChips(
    selectedMedicalSpecialty,
    medicalSpecialties
  );
  const { upcBeds, nonUpcBeds } = splitMedicalBedsByScope(specialtyFilteredBeds, record);
  const upcPatientCount = countScopedPatients(upcBeds, record);
  const nonUpcPatientCount = countScopedPatients(nonUpcBeds, record);
  const spreadsheetRows = useMemo(
    () => buildMedicalHandoffSpreadsheetRows(record, effectiveVisibleBeds, professionalsCatalog),
    [effectiveVisibleBeds, professionalsCatalog, record]
  );

  const handlePrint = (mode: MedicalPrintMode) => {
    setPrintMode(mode);
    setTimeout(() => window.print(), 100);
  };

  return (
    <div className="space-y-3">
      <MedicalHandoffHeader
        onBedStats={setBedStats}
        record={headerRecord}
        visibleBeds={effectiveVisibleBeds}
        readOnly={readOnly}
        canRestoreSignatures={Boolean(resetMedicalHandoffState)}
        showDeliverySection={showDeliverySection}
        canEditDoctorName={canEditDoctorName}
        canSignMedicalHandoff={canSignMedicalHandoff}
        updateMedicalHandoffDoctor={updateMedicalHandoffDoctor}
        markMedicalHandoffAsSent={markMedicalHandoffAsSent}
        resetMedicalHandoffState={resetMedicalHandoffState}
        shareActions={
          conflictCenterAction || (onSendWhatsApp && onShareLink) ? (
            <div className="flex items-center gap-2">
              {conflictCenterAction}
              {onSendWhatsApp && onShareLink ? (
                <MedicalShareActions
                  medicalSignature={scopedMedicalSignature}
                  onSendWhatsApp={onSendWhatsApp}
                  onShareLink={onShareLink}
                />
              ) : null}
            </div>
          ) : undefined
        }
      />

      {/* Unified filter bar: Specialty + UPC scope + Bed stats */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2 print:hidden ring-1 ring-black/[0.02]">
        {/* Specialty selector */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400 shrink-0">
            Especialidad
          </label>
          <select
            value={selectedMedicalSpecialty}
            onChange={e =>
              setSelectedMedicalSpecialty(e.target.value as typeof selectedMedicalSpecialty)
            }
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
          >
            {filterChips.map(chip => (
              <option key={chip.key} value={chip.key}>
                {chip.label}
              </option>
            ))}
          </select>
        </div>

        <div className="h-5 w-px bg-slate-200/60" />

        {/* Bed stats inline */}
        {bedStats && (
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-slate-400">
              Ocu: <strong className="text-blue-600">{bedStats.occupiedBeds}</strong>
            </span>
            <span className="text-slate-400">
              Lib: <strong className="text-green-600">{bedStats.freeBeds}</strong>
            </span>
            <span className="text-slate-300">
              Cap: <strong className="text-slate-500">{bedStats.totalBeds}</strong>
            </span>
          </div>
        )}

        {!scopedMedicalScope || scopedMedicalScope === 'all' ? (
          <>
            <div className="h-5 w-px bg-slate-200/60" />

            <MedicalHandoffTabSwitcher
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              upcPatientCount={upcPatientCount}
              nonUpcPatientCount={nonUpcPatientCount}
            />

            {canPrint && (
              <div className="ml-auto flex items-center gap-2">
                <MedicalHandoffSpreadsheetAction date={record.date} rows={spreadsheetRows} />
                <MedicalHandoffPrintMenu
                  upcPatientCount={upcPatientCount}
                  nonUpcPatientCount={nonUpcPatientCount}
                  onPrint={handlePrint}
                />
              </div>
            )}
          </>
        ) : null}
      </div>

      <MedicalHandoffTabs
        visibleBeds={specialtyFilteredBeds}
        record={record}
        noteField={noteField}
        onNoteChange={onNoteChange}
        medicalActions={medicalActions}
        clinicalEventActions={clinicalEventActions}
        tableHeaderClass={tableHeaderClass}
        readOnly={readOnly}
        isMedical={true}
        shouldShowPatient={shouldShowPatient}
        fixedScope={scopedMedicalScope === 'all' ? null : scopedMedicalScope}
        hasAnyPatients={hasAnyVisiblePatients}
        activeTab={activeTab}
        printMode={printMode}
      />
    </div>
  );
};
