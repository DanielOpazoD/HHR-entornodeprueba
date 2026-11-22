import { z } from 'zod';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

const identity = z.object({
  bedId: z.string(),
  patientName: z.string(),
  rut: z.string(),
  documentType: z.string(),
  clinicalEpisodeId: z.string(),
});
const summary = z.object({
  lastUpdated: z.string(),
  revision: z.number(),
  occupiedBeds: z.array(identity),
  clinicalCribs: z.array(identity),
  discharges: z.array(identity),
  transfers: z.array(identity),
  cma: z.array(identity),
  warnings: z.array(z.string()),
  episodeDocuments: z.array(
    z.object({
      clinicalEpisodeId: z.string(),
      lastUpdated: z.string().nullable(),
      currentGeneration: z.boolean(),
    })
  ),
});
const previewSchema = z.object({ date: z.string(), current: summary, selected: summary });
const resultSchema = z.object({
  success: z.literal(true),
  date: z.string(),
  lastUpdated: z.string(),
  revision: z.number(),
  backupId: z.string(),
  backupExpiresAt: z.string(),
});
export type DailyRestoreSummary = z.infer<typeof summary>;
export type DailyRestorePreview = z.infer<typeof previewSchema>;
export type DailyRestoreResult = z.infer<typeof resultSchema>;
export type DailyRestoreSource = { date: string } & (
  | { readTime: string; backupId?: never }
  | { backupId: string; readTime?: never }
);
export type DailyRestoreRequest = DailyRestoreSource & {
  expectedLastUpdated: string;
  confirmationDate: string;
};

const call = async (name: string, payload: DailyRestoreSource | DailyRestoreRequest) => {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  const { httpsCallable } = await import('firebase/functions');
  const response = await httpsCallable<typeof payload, unknown>(functions, name)(payload);
  return response.data;
};
export const previewDailyRecordRestore = async (source: DailyRestoreSource) =>
  previewSchema.parse(await call('previewDailyRecordRestore', source));
export const restoreDailyRecord = async (request: DailyRestoreRequest) =>
  resultSchema.parse(await call('restoreDailyRecord', request));
