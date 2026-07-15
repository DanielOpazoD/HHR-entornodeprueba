// @vitest-environment node

import '../../../extension/prescription-print.js';

export const prescriptionPrint = (
  globalThis as typeof globalThis & {
    HhrPrescriptionPrint: {
      INDICATIONS_REPORT_FILE: string;
      PRESCRIPTION_REPORT_FILE: string;
      REGIMEN_REPORT_FILE: string;
      resolveNursingEncounterId: (url: unknown) => string;
      resolveEncounterId: (url: unknown) => string;
      isNursingRouteUrl: (url: unknown) => boolean;
      derivePrescriptionDates: (events: unknown[]) => Array<{
        date: string;
        label: string;
        count: number;
        prescribers: string[];
      }>;
      deriveProfessionalPrescriptionGroups: (events: unknown[]) => Array<{
        key: string;
        professional: string;
        professionalRun: string;
        prescriberVerified: boolean;
        count: number;
        externalCount: number;
        latestDate: string;
        latestDateTime: string;
        medications: Array<{
          id: string;
          medication: string;
          posology: string;
          route: string;
          note: string;
          date: string;
          dateTime: string;
          external?: boolean;
        }>;
      }>;
      applyCurrentMedicationMetadata: (events: unknown[], entries: unknown[]) => unknown[];
      deriveExternalPrescriptionGroups: (groups: Array<Record<string, unknown>>) => Array<{
        key: string;
        external: boolean;
        medication: string;
        professional: string;
        professionalRun: string;
        validationDateTime: string;
        medications: Array<Record<string, unknown>>;
      }>;
      applyProfessionalValidationDates: (
        groups: Array<{
          key: string;
          professional: string;
          professionalRun: string;
          count: number;
          externalCount: number;
          latestDate: string;
          latestDateTime: string;
          medications: Array<Record<string, unknown>>;
        }>,
        events: unknown[],
        currentValidation: unknown
      ) => Array<{
        key: string;
        professional: string;
        professionalRun: string;
        prescriberVerified: boolean;
        count: number;
        externalCount: number;
        latestDate: string;
        latestDateTime: string;
        validationDate: string;
        validationDateTime: string;
        printDate: string;
        printDateTime: string;
        printDateSource: string;
        medications: Array<Record<string, unknown>>;
      }>;
      buildPrescriptionReportUrl: (
        apiOrigin: string,
        encounterId: string,
        practitionerId: string,
        patientId: string
      ) => string;
      buildIndicationsReportUrl: (
        apiOrigin: string,
        encounterId: string,
        practitionerId: string,
        patientId: string
      ) => string;
      buildRegimenReportUrl: (apiOrigin: string, facilityId: string) => string;
      deriveLatestBraden: (
        events: unknown[],
        forms: unknown[]
      ) => null | {
        total: number;
        severity: string;
        dateTime: string;
        author: string;
        source: string;
      };
      deriveScaleHistory: (
        events: unknown[],
        forms: unknown[],
        scaleName: string
      ) => Array<{ total: number; severity: string; dateTime: string; author: string }>;
      deriveLatestNutritionOrder: (entry: unknown) => null | {
        diet: string;
        observation: string;
        dateTime: string;
        author: string;
      };
      deriveLatestShiftChange: (entries: unknown) => null | {
        observation: string;
        dateTime: string;
        author: string;
        isSigned: boolean;
      };
      calculateCudyrCategory: (fields: Array<{ typeId: number; value: number }>) => {
        dependency: number;
        risk: number;
        value: string;
      };
      buildPrescriptionFilename: (
        encounterId: string,
        professional?: string,
        printFormat?: string
      ) => string;
      formatRun: (value: unknown) => string;
      formatDateTimeLabel: (value: unknown) => string;
      formatAgeLabel: (birthDate: unknown, referenceValue?: unknown) => string;
      activeHospitalizedEncounters: (snapshot: unknown) => Array<{
        encounterId: string;
        name: string;
        run: string;
        service: string;
        room: string;
        bed: string;
      }>;
      buildHospitalizedPrescriptionSummary: (
        patient: Record<string, unknown>,
        groups: Array<Record<string, unknown>>,
        currentEncounterId?: string
      ) => {
        encounterId: string;
        name: string;
        medicationCount: number;
        isCurrent: boolean;
        prescribers: Array<{
          professional: string;
          professionalRun: string;
          count: number;
          validationDateTime: string;
        }>;
      };
      buildBatchPrescriptionFilename: (count: number, printFormat: string, date?: string) => string;
      buildBatchIndicationsFilename: (count: number, date?: string) => string;
      buildRegimenFilename: (date?: string) => string;
      extractOfficialPrescriptionMetadata: (buffer: ArrayBuffer) => Promise<{
        folio: string;
        emissionDateTime: string;
        professional: string;
        professionalRun: string;
      }>;
      extractOfficialPrescriptionContent: (buffer: ArrayBuffer) => Promise<{
        patient: Record<string, string>;
        professional: string;
        professionalRun: string;
        prescriptionDate: string;
        printedBy: string;
        address: string;
        emissionDateTime: string;
        folio: string;
        medications: Array<Record<string, string>>;
      } | null>;
    };
  }
).HhrPrescriptionPrint;
