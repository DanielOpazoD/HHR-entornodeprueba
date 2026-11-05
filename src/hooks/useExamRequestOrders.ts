/**
 * Laboratory requests for one or more patients. Each order keeps its own marked exams, origin and
 * insurance; all of them print together, one page per patient. The state lives while the dialog
 * is mounted, so every opening starts from the patient it was opened for, with nothing marked.
 */

import { useCallback, useMemo, useState } from 'react';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import { runExamRequestPrint } from '@/hooks/controllers/examRequestPrintController';
import {
  buildExamRequestOpenState,
  toggleExamRequestSelection,
  type ExamRequestOpenState,
} from '@/hooks/controllers/examRequestController';

export interface ExamRequestCandidate {
  /** Who the order is for: bed and episode, never the bed alone (a bed is a place). */
  key: string;
  /** Short label for the tab, such as the bed. */
  label: string;
  patient: PatientData;
}

export interface ExamRequestOrder extends ExamRequestOpenState {
  key: string;
  label: string;
  patient: PatientData;
}

interface UseExamRequestOrdersParams {
  candidates: ExamRequestCandidate[];
  initialKey: string;
}

interface OrdersState {
  keys: string[];
  activeKey: string;
  byKey: Record<string, ExamRequestOpenState>;
}

export interface UseExamRequestOrdersResult {
  /** Orders in the order they were added; a patient that left the census drops out. */
  orders: ExamRequestOrder[];
  active: ExamRequestOrder | undefined;
  isIncluded: (key: string) => boolean;
  selectOrder: (key: string) => void;
  /** Adds the patient and shows its order, or removes it while another order remains. */
  togglePatient: (key: string) => void;
  toggleExam: (examKey: string) => void;
  setProcedencia: (value: string) => void;
  setPrevision: (value: string) => void;
  print: () => void;
}

export const useExamRequestOrders = ({
  candidates,
  initialKey,
}: UseExamRequestOrdersParams): UseExamRequestOrdersResult => {
  const byCandidateKey = useMemo(
    () => new Map(candidates.map(candidate => [candidate.key, candidate])),
    [candidates]
  );
  const [state, setState] = useState<OrdersState>(() => ({
    keys: [initialKey],
    activeKey: initialKey,
    byKey: {
      [initialKey]: buildExamRequestOpenState(
        candidates.find(candidate => candidate.key === initialKey)?.patient.insurance
      ),
    },
  }));

  const orders = state.keys.flatMap(key => {
    const candidate = byCandidateKey.get(key);
    const order = state.byKey[key];
    return candidate && order ? [{ ...order, ...candidate }] : [];
  });
  const active = orders.find(order => order.key === state.activeKey) ?? orders[0];

  // Edits go to the order on screen, even when the one chosen before has left the census.
  const activeKey = active?.key;
  const updateActive = (update: (order: ExamRequestOpenState) => ExamRequestOpenState): void => {
    if (!activeKey) return;
    setState(current => {
      const order = current.byKey[activeKey];
      return order
        ? { ...current, byKey: { ...current.byKey, [activeKey]: update(order) } }
        : current;
    });
  };

  const togglePatient = useCallback(
    (key: string) =>
      setState(current => {
        if (!current.keys.includes(key)) {
          const insurance = byCandidateKey.get(key)?.patient.insurance;
          return {
            keys: [...current.keys, key],
            activeKey: key,
            byKey: { ...current.byKey, [key]: buildExamRequestOpenState(insurance) },
          };
        }
        if (current.keys.length === 1) return current;
        const keys = current.keys.filter(item => item !== key);
        const byKey = Object.fromEntries(
          Object.entries(current.byKey).filter(([orderKey]) => orderKey !== key)
        );
        const position = current.keys.indexOf(key);
        return {
          keys,
          activeKey:
            current.activeKey === key
              ? keys[Math.min(position, keys.length - 1)]
              : current.activeKey,
          byKey,
        };
      }),
    [byCandidateKey]
  );

  return {
    orders,
    active,
    isIncluded: key => state.keys.includes(key),
    selectOrder: key => setState(current => ({ ...current, activeKey: key })),
    togglePatient,
    toggleExam: examKey =>
      updateActive(order => ({
        ...order,
        selectedExams: toggleExamRequestSelection(order.selectedExams, examKey),
      })),
    setProcedencia: value => updateActive(order => ({ ...order, procedencia: value })),
    setPrevision: value => updateActive(order => ({ ...order, prevision: value })),
    print: () => runExamRequestPrint(),
  };
};
