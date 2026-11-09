import { createContext } from 'react';
import type { ExamRequestCandidate } from '@/hooks/useExamRequestOrders';

/**
 * Census day on which Shift + click on a name chooses patients for a laboratory order; null where
 * the census cannot prepare orders. A plain string, so census updates do not re-render every row.
 */
export const CensusExamOrderDateContext = createContext<string | null>(null);

/** Patients of the census day that a laboratory request may include, once each. */
export const CensusExamRequestCandidatesContext = createContext<ExamRequestCandidate[] | null>(
  null
);
