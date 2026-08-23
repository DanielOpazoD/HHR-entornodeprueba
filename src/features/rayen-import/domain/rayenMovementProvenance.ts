import { buildMovementProvenance } from '@/application/census/movementProvenancePolicy';

interface MovementProvenanceContext {
  now: Date;
  actor?: string;
  syncRunId: string;
}

export const buildRayenMovementProvenance = (
  id: string,
  ctx: MovementProvenanceContext,
  source: 'manual' | 'gestion_camas'
) =>
  source === 'manual'
    ? buildMovementProvenance({
        movementId: id,
        source,
        actor: ctx.actor,
        at: ctx.now.toISOString(),
      })
    : buildMovementProvenance({
        movementId: id,
        source,
        actor: ctx.actor,
        at: ctx.now.toISOString(),
        syncRunId: ctx.syncRunId,
      });
