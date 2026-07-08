/**
 * Subscribes to the prescriptions collection and exposes filtering helpers
 * the visor uses to narrow the listing without re-querying Firestore.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrescriptionRepository } from '@/services/repositories/PrescriptionRepository';
import {
  PRESCRIPTION_TYPES,
  resolvePrescriptionAssignmentScope,
  type PrescriptionRecord,
  type PrescriptionType,
} from '@/types/prescriptionTypes';

export type PrescriptionListPhase = 'loading' | 'ready';

export type PrescriptionTypeFilter = PrescriptionType | 'all';
export type PrescriptionPatientFilter = 'all' | 'unassigned' | 'assigned' | 'hospitalized_stock';

export interface PrescriptionListFilters {
  type: PrescriptionTypeFilter;
  patient: PrescriptionPatientFilter;
  /** Free-text search across `bedId`, `patientName`, `patientRut`, `notes`. */
  search: string;
  /**
   * ISO yyyy-mm-dd. When set, the visor only shows records whose
   * `createdAt` falls on that day (local time). `null` means "all days".
   */
  selectedDate: string | null;
}

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const buildDefaultFilters = (): PrescriptionListFilters => ({
  type: 'all',
  patient: 'all',
  search: '',
  selectedDate: todayIso(),
});

const matchesPatientFilter = (
  record: PrescriptionRecord,
  filter: PrescriptionPatientFilter
): boolean => {
  if (filter === 'all') return true;
  const scope = resolvePrescriptionAssignmentScope(record);
  if (filter === 'assigned') return scope === 'patient';
  if (filter === 'hospitalized_stock') return scope === 'hospitalized_stock';
  return scope === 'unassigned';
};

const matchesSearch = (record: PrescriptionRecord, query: string): boolean => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = [
    record.bedId,
    record.patientName,
    record.patientRut,
    record.notes,
    record.uploader?.displayName,
    record.uploader?.email,
  ]
    .filter(Boolean)
    .map(value => String(value).toLowerCase())
    .join(' ');
  return haystack.includes(trimmed);
};

const matchesSelectedDate = (record: PrescriptionRecord, isoDate: string | null): boolean => {
  if (!isoDate) return true;
  const created = new Date(record.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const recordIsoDay = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
  return recordIsoDay === isoDate;
};

export interface UsePrescriptionListControllerOptions {
  hospitalId?: string;
}

export interface PrescriptionListControllerHandle {
  phase: PrescriptionListPhase;
  records: PrescriptionRecord[];
  filteredRecords: PrescriptionRecord[];
  filters: PrescriptionListFilters;
  setFilter: <K extends keyof PrescriptionListFilters>(
    field: K,
    value: PrescriptionListFilters[K]
  ) => void;
  resetFilters: () => void;
  prescriptionTypes: typeof PRESCRIPTION_TYPES;
  /** Total count before filtering — useful for empty-state messaging. */
  totalCount: number;
}

export const usePrescriptionListController = ({
  hospitalId,
}: UsePrescriptionListControllerOptions = {}): PrescriptionListControllerHandle => {
  const [records, setRecords] = useState<PrescriptionRecord[]>([]);
  const [phase, setPhase] = useState<PrescriptionListPhase>('loading');
  const [filters, setFilters] = useState<PrescriptionListFilters>(() => buildDefaultFilters());

  useEffect(() => {
    let active = true;
    const unsubscribe = PrescriptionRepository.subscribeToList(next => {
      if (!active) return;
      setRecords(next);
      setPhase('ready');
    }, hospitalId);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [hospitalId]);

  const setFilter = useCallback(
    <K extends keyof PrescriptionListFilters>(field: K, value: PrescriptionListFilters[K]) => {
      setFilters(prev => ({ ...prev, [field]: value }));
    },
    []
  );

  const resetFilters = useCallback(() => setFilters(buildDefaultFilters()), []);

  const filteredRecords = useMemo(
    () =>
      records.filter(record => {
        if (filters.type !== 'all' && record.prescriptionType !== filters.type) return false;
        if (!matchesPatientFilter(record, filters.patient)) return false;
        if (!matchesSearch(record, filters.search)) return false;
        if (!matchesSelectedDate(record, filters.selectedDate)) return false;
        return true;
      }),
    [records, filters]
  );

  return {
    phase,
    records,
    filteredRecords,
    filters,
    setFilter,
    resetFilters,
    prescriptionTypes: PRESCRIPTION_TYPES,
    totalCount: records.length,
  };
};
