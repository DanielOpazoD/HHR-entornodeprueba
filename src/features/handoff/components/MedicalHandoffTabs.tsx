import React, { useState } from 'react';
import { BedDefinition } from '@/types/domain/beds';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import { HandoffPatientTable } from './HandoffPatientTable';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import type { HandoffClinicalEventActions, HandoffMedicalActions } from './handoffRowContracts';
import {
  buildMedicalPrintSectionModel,
  hasNamedPatientsInBeds,
  resolveMedicalDisplayBeds,
  resolveMedicalPrintBeds,
  splitMedicalBedsByScope,
  type MedicalPrintMode,
  type MedicalTabMode,
} from '@/features/handoff/controllers/medicalHandoffTabsController';

interface MedicalHandoffTabsProps {
  visibleBeds: BedDefinition[];
  record: HandoffDailyRecordContract;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift' | 'medicalHandoffNote';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  medicalActions?: HandoffMedicalActions;
  clinicalEventActions?: HandoffClinicalEventActions;
  tableHeaderClass: string;
  readOnly: boolean;
  isMedical: boolean;
  shouldShowPatient: (bedId: string) => boolean;
  fixedScope?: MedicalHandoffScope | null;
  hasAnyPatients?: boolean;
  activeTab?: MedicalTabMode;
  printMode?: MedicalPrintMode;
}

export const MedicalHandoffTabs: React.FC<MedicalHandoffTabsProps> = ({
  visibleBeds,
  record,
  noteField,
  onNoteChange,
  medicalActions,
  clinicalEventActions,
  tableHeaderClass,
  readOnly,
  isMedical,
  shouldShowPatient,
  fixedScope = null,
  hasAnyPatients,
  activeTab,
  printMode,
}) => {
  const [internalActiveTab] = useState<MedicalTabMode>('all');
  const internalPrintMode: MedicalPrintMode = 'all';
  const { upcBeds, nonUpcBeds } = splitMedicalBedsByScope(visibleBeds, record);
  const resolvedActiveTab = activeTab ?? internalActiveTab;
  const resolvedPrintMode = printMode ?? internalPrintMode;
  const displayBeds = resolveMedicalDisplayBeds({
    visibleBeds,
    upcBeds,
    nonUpcBeds,
    activeTab: resolvedActiveTab,
    fixedScope,
  });
  const hasDisplayPatients = hasAnyPatients ?? hasNamedPatientsInBeds(displayBeds, record);
  const printBeds = resolveMedicalPrintBeds({
    printMode: resolvedPrintMode,
    upcBeds,
    nonUpcBeds,
  });
  const upcPrintSection = buildMedicalPrintSectionModel('upc', printBeds.upc, record);
  const nonUpcPrintSection = buildMedicalPrintSectionModel('no-upc', printBeds.nonUpc, record);

  return (
    <div className="space-y-3">
      <div className="print:hidden">
        <HandoffPatientTable
          visibleBeds={displayBeds}
          record={record}
          noteField={noteField}
          onNoteChange={onNoteChange}
          medicalActions={medicalActions}
          clinicalEventActions={clinicalEventActions}
          tableHeaderClass={tableHeaderClass}
          readOnly={readOnly}
          isMedical={isMedical}
          hasAnyPatients={hasDisplayPatients}
          shouldShowPatient={shouldShowPatient}
        />
      </div>

      <div className="hidden print:block space-y-4">
        {upcPrintSection.beds.length > 0 && upcPrintSection.hasPatients && (
          <div>
            <h3 className="text-xs font-bold text-red-700 bg-red-50 px-3 py-1 border border-red-200 border-b-0 rounded-t-lg">
              {upcPrintSection.title}
            </h3>
            <HandoffPatientTable
              visibleBeds={upcPrintSection.beds}
              record={record}
              noteField={noteField}
              onNoteChange={onNoteChange}
              medicalActions={medicalActions}
              clinicalEventActions={clinicalEventActions}
              tableHeaderClass={tableHeaderClass}
              readOnly={readOnly}
              isMedical={isMedical}
              hasAnyPatients={true}
              shouldShowPatient={shouldShowPatient}
            />
          </div>
        )}

        {nonUpcPrintSection.beds.length > 0 && nonUpcPrintSection.hasPatients && (
          <div>
            <h3 className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 border border-slate-200 border-b-0 rounded-t-lg">
              {nonUpcPrintSection.title}
            </h3>
            <HandoffPatientTable
              visibleBeds={nonUpcPrintSection.beds}
              record={record}
              noteField={noteField}
              onNoteChange={onNoteChange}
              medicalActions={medicalActions}
              clinicalEventActions={clinicalEventActions}
              tableHeaderClass={tableHeaderClass}
              readOnly={readOnly}
              isMedical={isMedical}
              hasAnyPatients={true}
              shouldShowPatient={shouldShowPatient}
            />
          </div>
        )}
      </div>
    </div>
  );
};
