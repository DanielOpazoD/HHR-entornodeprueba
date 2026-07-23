import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { searchSyslabExams } from '@/services/laboratory/syslabService';
import { queryKeys } from '@/config/queryClient';
import type { LabPatient, SyslabExamItem } from '@/types/domain/labExamTypes';
import {
  buildUniqueLabPatients,
  resolveInitialLabViewerRut,
  resolveLabViewerSearchErrorMessage,
  shouldRetryLabViewerSearchError,
} from '../controllers/labViewerController';
import { resolveLabPatientBirthDateFromPdf } from '../services/labPatientPdfMetadataService';

interface UseLabViewerQueryParams {
  patients: LabPatient[];
  initialPatientRut?: string;
}

export interface UseLabViewerQueryReturn {
  uniquePatients: LabPatient[];
  selectedPatient: LabPatient | null;
  selectedRut: string;
  isLoading: boolean;
  examList: SyslabExamItem[];
  pdfExam: SyslabExamItem | null;
  error: string | null;
  setError: (value: string | null) => void;
  resetQueryState: () => void;
  selectPatient: (rut: string) => void;
  setSelectedRut: (rut: string) => void;
  search: () => Promise<void>;
  openPdf: (exam: SyslabExamItem) => void;
  closePdf: () => void;
}

export const useLabViewerQuery = ({
  patients,
  initialPatientRut,
}: UseLabViewerQueryParams): UseLabViewerQueryReturn => {
  const queryClient = useQueryClient();
  const [selectedRut, setSelectedRut] = useState(
    resolveInitialLabViewerRut(patients, initialPatientRut)
  );
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [pdfExam, setPdfExam] = useState<SyslabExamItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualPatientExtra, setManualPatientExtra] = useState<{
    fullName?: string;
    birthDate?: string;
  } | null>(null);
  const labQueryKey = useMemo(() => queryKeys.laboratory.byPatient(selectedRut), [selectedRut]);

  const examQuery = useQuery({
    queryKey: labQueryKey,
    queryFn: () => searchSyslabExams(selectedRut),
    enabled: searchEnabled && !!selectedRut,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: (failureCount, error) => failureCount < 1 && shouldRetryLabViewerSearchError(error),
  });

  const examList = useMemo(
    () => (examQuery.data?.success ? examQuery.data.data : []),
    [examQuery.data]
  );
  const isLoading = examQuery.isFetching;

  useEffect(() => {
    setError(
      resolveLabViewerSearchErrorMessage({
        queryError: examQuery.error,
        queryData: examQuery.data,
      })
    );
  }, [examQuery.error, examQuery.data]);

  const uniquePatients = useMemo(() => buildUniqueLabPatients(patients), [patients]);

  useEffect(() => {
    if (!selectedRut || uniquePatients.some(patient => patient.rut === selectedRut)) {
      setManualPatientExtra(null);
      return;
    }

    if (examList.length === 0) {
      return;
    }

    let cancelled = false;

    const hydrateManualPatient = async () => {
      let fullName: string | undefined;
      let birthDate: string | undefined;

      try {
        const { getPatientByRut } = await import('@/services/repositories/PatientMasterRepository');
        const master = await getPatientByRut(selectedRut);
        if (cancelled) {
          return;
        }

        fullName = master?.fullName;
        birthDate = master?.birthDate;
      } catch {
        // External RUTs can still be enriched from the Syslab PDF below.
      }

      if (!birthDate) {
        birthDate = await resolveLabPatientBirthDateFromPdf(examList);
      }

      if (!cancelled && (fullName || birthDate)) {
        setManualPatientExtra({
          fullName,
          birthDate,
        });
      }
    };

    hydrateManualPatient();

    return () => {
      cancelled = true;
    };
  }, [selectedRut, examList, uniquePatients]);

  const selectedPatient = useMemo(() => {
    const patientFromBed = uniquePatients.find(patient => patient.rut === selectedRut);
    if (patientFromBed) {
      return patientFromBed;
    }

    if (selectedRut && examList.length > 0) {
      const syslabName = examList[0]?.patientName;
      return {
        bedId: '',
        label: manualPatientExtra?.fullName || syslabName || selectedRut,
        patientName: manualPatientExtra?.fullName || syslabName || '',
        rut: selectedRut,
        birthDate: manualPatientExtra?.birthDate,
      } satisfies LabPatient;
    }

    return null;
  }, [selectedRut, uniquePatients, examList, manualPatientExtra]);

  const resetQueryState = useCallback(() => {
    setSearchEnabled(false);
    setPdfExam(null);
    setError(null);
  }, []);

  const selectPatient = useCallback(
    (rut: string) => {
      setSelectedRut(rut);
      resetQueryState();
    },
    [resetQueryState]
  );

  const search = useCallback(async () => {
    if (!selectedRut) {
      return;
    }

    setError(null);
    setPdfExam(null);
    setSearchEnabled(true);
    await queryClient.invalidateQueries({ queryKey: labQueryKey });
  }, [selectedRut, queryClient, labQueryKey]);

  const openPdf = useCallback((exam: SyslabExamItem) => setPdfExam(exam), []);
  const closePdf = useCallback(() => setPdfExam(null), []);

  return {
    uniquePatients,
    selectedPatient,
    selectedRut,
    isLoading,
    examList,
    pdfExam,
    error,
    setError,
    resetQueryState,
    selectPatient,
    setSelectedRut,
    search,
    openPdf,
    closePdf,
  };
};
