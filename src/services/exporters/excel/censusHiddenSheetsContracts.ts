import type { PatientData } from '@/types/domain/patient';

import type { CensusWorkbookSheetDescriptor } from '@/services/exporters/excel/censusWorkbookContracts';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';

export interface CensusWorkbookSnapshotSheet {
  record: CensusExportRecord;
  descriptor: CensusWorkbookSheetDescriptor;
  resolvedSheetName: string;
}

export interface CensusLogicalSnapshotSheet extends CensusWorkbookSnapshotSheet {
  displaySheetName: string;
}

export interface ExtractedPatientRow {
  patient: PatientData;
  bedCode: string;
}

export interface SummaryDayRow {
  displaySheetName: string;
  occupiedBeds: number;
  availableCapacity: number;
  blockedBeds: number;
  cribs: number;
  occupancyRate: number | null;
  discharges: number;
  transfers: number;
  cma: number;
  deceased: number;
  specialtyCounts: Record<string, number>;
}

export interface UpcPatientAggregate {
  key: string;
  patientName: string;
  rut: string;
  age: string;
  diagnosis: string;
  specialty: string;
  admissionDate: string;
  firstSeenDate: string;
  dailyRecords: Array<{
    date: string;
    bedCode: string;
    classification: 'UCI' | 'UTI';
  }>;
  uciDays: number;
  utiDays: number;
}

export interface UpcPatientPresentation extends UpcPatientAggregate {
  totalDays: number;
  daysDetail: string;
  history: string;
  changedBed: boolean;
  periodLabel: 'UCI' | 'UTI' | 'Mixto';
}

export interface CensusHiddenSheetMonthContext {
  year: string;
  monthIndex: number;
  monthName: string;
  daysInMonth: number;
}
