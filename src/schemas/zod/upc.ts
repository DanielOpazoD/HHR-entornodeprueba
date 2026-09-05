import { z } from 'zod';

/** Restore No UPC after legacy null normalization; retain optional legacy audit data. */
const UpcEvaluationSnapshotSchema = z
  .object({
    evaluationId: z.string().optional(),
    criterionLabels: z.array(z.string()).optional(),
    uciCriteria: z.array(z.string()).default([]),
    utiCriteria: z.array(z.string()).default([]),
    classification: z.enum(['UPC_UCI', 'UPC_UTI']).nullable().default(null),
    evaluatedAt: z.string().default(''),
    evaluatedBy: z.object({ uid: z.string(), displayName: z.string() }).optional(),
    evaluatedForDate: z.string().optional(),
    evaluatedBedId: z.string().optional(),
    responsibleNurse: z
      .object({
        name: z.string(),
        shift: z.enum(['day', 'night']).optional(),
        source: z.enum(['assigned', 'manual']),
      })
      .optional(),
  })
  .passthrough();

export const UpcChecklistSchema = UpcEvaluationSnapshotSchema.extend({
  reviewRequired: z.boolean().optional(),
  history: z.array(UpcEvaluationSnapshotSchema).optional(),
});
