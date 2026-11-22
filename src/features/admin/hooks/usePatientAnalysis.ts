import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentUserEmail } from '@/services/admin/utils/auditUtils';
import {
  executeAnalyzePatients,
  executeMigratePatients,
  executeResolvePatientConflict,
  type AnalysisResult,
} from '@/features/admin/patient-flow/patientAnalysisUseCase';
import {
  defaultDailyRecordAnalysisPort,
  type DailyRecordAnalysisPort,
} from '@/application/ports/dailyRecordPort';
import {
  defaultPatientMasterWritePort,
  type PatientMasterWritePort,
} from '@/application/ports/patientMasterPort';
import { defaultAuditPort, type AuditPort } from '@/application/ports/auditPort';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import { patientAnalysisLogger } from '@/hooks/hookLoggers';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';

export type {
  Conflict,
  AnalysisResult,
} from '@/features/admin/patient-flow/patientAnalysisUseCase';

export interface PatientAnalysisDependencies {
  dailyRecordRepository: DailyRecordAnalysisPort;
  patientMasterRepository: PatientMasterWritePort;
  auditPort: Pick<AuditPort, 'writeEvent'>;
  getCurrentUserEmail: () => string;
}

const defaultPatientAnalysisDependencies: PatientAnalysisDependencies = {
  dailyRecordRepository: defaultDailyRecordAnalysisPort,
  patientMasterRepository: defaultPatientMasterWritePort,
  auditPort: defaultAuditPort,
  getCurrentUserEmail,
};

const resolvePatientAnalysisDependencies = (
  dependencies?: Partial<PatientAnalysisDependencies>
): PatientAnalysisDependencies => ({
  dailyRecordRepository:
    dependencies?.dailyRecordRepository || defaultPatientAnalysisDependencies.dailyRecordRepository,
  patientMasterRepository:
    dependencies?.patientMasterRepository ||
    defaultPatientAnalysisDependencies.patientMasterRepository,
  auditPort: dependencies?.auditPort || defaultPatientAnalysisDependencies.auditPort,
  getCurrentUserEmail:
    dependencies?.getCurrentUserEmail || defaultPatientAnalysisDependencies.getCurrentUserEmail,
});

export const usePatientAnalysis = (dependencies?: Partial<PatientAnalysisDependencies>) => {
  const resolvedDependencies = useMemo(
    () => resolvePatientAnalysisDependencies(dependencies),
    [dependencies]
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isHarmonizing, setIsHarmonizing] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [migrationResult, setMigrationResult] = useState<{
    successes: number;
    errors: number;
  } | null>(null);
  const analysisRef = useRef<AnalysisResult | null>(null);
  const isAnalyzingRef = useRef(false);
  const storeChangedDuringAnalysisRef = useRef(false);
  const suppressedHarmonizationSaveDatesRef = useRef<string[]>([]);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const consumeSuppressedHarmonizationSave = (
      detail: DailyRecordStoreChangedEventDetail | undefined
    ): boolean => {
      const savedDate =
        detail?.operation === 'save' && detail.dates?.length === 1 ? detail.dates[0] : undefined;
      if (!savedDate) {
        return false;
      }

      const suppressedIndex = suppressedHarmonizationSaveDatesRef.current.indexOf(savedDate);
      if (suppressedIndex === -1) {
        return false;
      }

      suppressedHarmonizationSaveDatesRef.current.splice(suppressedIndex, 1);
      return true;
    };

    const handleStoreChanged = (event: Event) => {
      const detail = (event as CustomEvent<DailyRecordStoreChangedEventDetail>).detail;

      if (consumeSuppressedHarmonizationSave(detail)) {
        return;
      }

      if (isAnalyzingRef.current) {
        storeChangedDuringAnalysisRef.current = true;
        return;
      }

      if (analysisRef.current) {
        setIsStale(true);
      }
    };

    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
    return () => window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
  }, []);

  const resolveConflict = useCallback(
    async (rut: string, correctName: string, harmonizeHistory: boolean = false) => {
      if (harmonizeHistory) {
        setIsHarmonizing(true);
      }

      const dailyRecordRepository = harmonizeHistory
        ? {
            ...resolvedDependencies.dailyRecordRepository,
            updatePartial: async (
              date: string,
              patch: Parameters<DailyRecordAnalysisPort['updatePartial']>[1]
            ) => {
              suppressedHarmonizationSaveDatesRef.current.push(date);

              try {
                return await resolvedDependencies.dailyRecordRepository.updatePartial(date, patch);
              } finally {
                const suppressedIndex = suppressedHarmonizationSaveDatesRef.current.indexOf(date);
                if (suppressedIndex !== -1) {
                  suppressedHarmonizationSaveDatesRef.current.splice(suppressedIndex, 1);
                }
              }
            },
          }
        : resolvedDependencies.dailyRecordRepository;

      try {
        const outcome = await executeResolvePatientConflict({
          analysis,
          rut,
          correctName,
          harmonizeHistory,
          dailyRecordRepository,
          auditPort: resolvedDependencies.auditPort,
          currentUserEmail: resolvedDependencies.getCurrentUserEmail(),
        });

        if (outcome.data) {
          setAnalysis(outcome.data);
          analysisRef.current = outcome.data;
        }
      } catch (error) {
        patientAnalysisLogger.error('Harmonization failed', error);
      } finally {
        if (harmonizeHistory) {
          setIsHarmonizing(false);
        }
      }
    },
    [analysis, resolvedDependencies]
  );

  const runAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    isAnalyzingRef.current = true;
    storeChangedDuringAnalysisRef.current = false;
    setAnalysis(null);
    analysisRef.current = null;
    setMigrationResult(null);

    try {
      const outcome = await executeAnalyzePatients({
        dailyRecordRepository: resolvedDependencies.dailyRecordRepository,
      });
      if (outcome.status === 'failed') {
        patientAnalysisLogger.error(
          'Analysis failed',
          new Error(resolveApplicationOutcomeMessage(outcome, 'Analysis failed'))
        );
      } else {
        setIsStale(storeChangedDuringAnalysisRef.current);
      }
      setAnalysis(outcome.data);
      analysisRef.current = outcome.data;
    } finally {
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
    }
  }, [resolvedDependencies]);

  const runMigration = useCallback(async () => {
    if (!analysis || analysis.validPatients.length === 0) return;

    setIsMigrating(true);
    try {
      const outcome = await executeMigratePatients({
        analysis,
        patientMasterRepository: resolvedDependencies.patientMasterRepository,
      });
      if (outcome.status === 'failed') {
        patientAnalysisLogger.error(
          'Migration failed',
          new Error(resolveApplicationOutcomeMessage(outcome, 'Migration failed'))
        );
      }
      if (outcome.data) {
        setMigrationResult(outcome.data);
      }
    } finally {
      setIsMigrating(false);
    }
  }, [analysis, resolvedDependencies]);

  return {
    isAnalyzing,
    isMigrating,
    isHarmonizing,
    isStale,
    analysis,
    migrationResult,
    runAnalysis,
    runMigration,
    resolveConflict,
  };
};
