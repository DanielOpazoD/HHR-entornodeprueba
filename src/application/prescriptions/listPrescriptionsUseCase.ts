/**
 * Use case: list prescription records for the visor. Optionally filtered
 * by ISO date range so the UI can scope the listing to "today" / "this
 * week" without paging the full 30-day window.
 */

import {
  defaultPrescriptionPort,
  type PrescriptionPort,
} from '@/application/ports/prescriptionPort';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

export interface ListPrescriptionsInput {
  hospitalId?: string;
  /** ISO date string (inclusive). Combined with `to` for a range query. */
  from?: string;
  /** ISO date string (inclusive). Combined with `from` for a range query. */
  to?: string;
}

interface ListPrescriptionsDeps {
  prescriptionPort?: PrescriptionPort;
}

export const executeListPrescriptions = async (
  input: ListPrescriptionsInput = {},
  dependencies: ListPrescriptionsDeps = {}
): Promise<PrescriptionRecord[]> => {
  const port = dependencies.prescriptionPort || defaultPrescriptionPort;

  if (input.from && input.to) {
    return port.listByDateRange(input.from, input.to, input.hospitalId);
  }

  return port.list(input.hospitalId);
};
