import * as z from 'zod/mini';

/** Restore No UPC after legacy null normalization; retain optional legacy audit data. */
const UpcEvaluationSnapshotSchema = z.looseObject({
  evaluationId: z.optional(z.string()),
  criterionLabels: z.optional(z.array(z.string())),
  uciCriteria: z.prefault(z.array(z.string()), []),
  utiCriteria: z.prefault(z.array(z.string()), []),
  classification: z.prefault(z.nullable(z.enum(['UPC_UCI', 'UPC_UTI'])), null),
  evaluatedAt: z.prefault(z.string(), ''),
  evaluatedBy: z.optional(z.object({ uid: z.string(), displayName: z.string() })),
  evaluatedForDate: z.optional(z.string()),
  evaluatedBedId: z.optional(z.string()),
  responsibleNurse: z.optional(
    z.object({
      name: z.string(),
      shift: z.optional(z.enum(['day', 'night'])),
      source: z.enum(['assigned', 'manual']),
    })
  ),
});

export const UpcChecklistSchema = z.extend(UpcEvaluationSnapshotSchema, {
  reviewRequired: z.optional(z.boolean()),
  history: z.optional(z.array(UpcEvaluationSnapshotSchema)),
});
