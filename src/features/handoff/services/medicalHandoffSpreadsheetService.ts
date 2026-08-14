import { httpsCallable } from 'firebase/functions';
import { z } from 'zod';

import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { MedicalHandoffSpreadsheetRow } from '@/features/handoff/controllers/medicalHandoffSpreadsheetController';

interface OpenMedicalHandoffSpreadsheetRequest {
  date: string;
  rows: MedicalHandoffSpreadsheetRow[];
}

const responseSchema = z.object({
  spreadsheetUrl: z.string().url(),
  created: z.boolean(),
  rowCount: z.number().int().nonnegative(),
  date: z.string(),
  storageStatus: z.enum(['configured', 'created', 'recovered', 'unknown']).default('unknown'),
});

export type OpenMedicalHandoffSpreadsheetResult = z.infer<typeof responseSchema>;

export const createMedicalHandoffSpreadsheetService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => ({
  openOrCreate: async (
    payload: OpenMedicalHandoffSpreadsheetRequest
  ): Promise<OpenMedicalHandoffSpreadsheetResult> => {
    const functions = await functionsRuntime.getFunctions();
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
