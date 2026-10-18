import { z } from 'zod';
export const RayenSyncDiagnosticContextSchema = z
  .object({
    patientName: z.string().max(240).optional(),
    document: z.string().max(80).optional(),
    clinicalEpisodeId: z.string().max(100).optional(),
    bedId: z.string().max(80).optional(),
    censusDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    detail: z.string().max(1500).optional(),
    sourceTimestamp: z.string().max(100).optional(),
    sourceClinicalDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    source: z.string().max(100).optional(),
  })
  .optional()
  .catch(undefined);
