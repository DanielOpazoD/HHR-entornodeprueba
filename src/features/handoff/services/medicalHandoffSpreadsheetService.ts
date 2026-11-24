import * as z from 'zod/mini';

import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { MedicalHandoffSpreadsheetRow } from '@/features/handoff/controllers/medicalHandoffSpreadsheetController';

interface OpenMedicalHandoffSpreadsheetRequest {
  date: string;
  rows: MedicalHandoffSpreadsheetRow[];
}

const responseSchema = z.object({
  spreadsheetUrl: z.url(),
  created: z.boolean(),
  rowCount: z.int().check(z.nonnegative()),
  date: z.string(),
  storageStatus: z._default(z.enum(['configured', 'created', 'recovered', 'unknown']), 'unknown'),
});

export type OpenMedicalHandoffSpreadsheetResult = z.infer<typeof responseSchema>;

export const createMedicalHandoffSpreadsheetService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => ({
  openOrCreate: async (
    payload: OpenMedicalHandoffSpreadsheetRequest
  ): Promise<OpenMedicalHandoffSpreadsheetResult> => {
    const functions = await functionsRuntime.getFunctions();
    const { httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<
      OpenMedicalHandoffSpreadsheetRequest,
      OpenMedicalHandoffSpreadsheetResult
    >(functions, 'openMedicalHandoffSpreadsheet');
    const response = await callable(payload);
    return responseSchema.parse(response.data);
  },
});

const service = createMedicalHandoffSpreadsheetService();
export const openOrCreateMedicalHandoffSpreadsheet = service.openOrCreate;
