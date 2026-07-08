import type {
  SystemHealthIncidentResolution,
  SystemHealthIncidentResolutionActor,
  SystemHealthIncidentResolutionState,
} from '@/services/admin/healthService';

const actorName = (actor: SystemHealthIncidentResolutionActor): string =>
  actor.displayName || actor.email || 'Usuario del sistema';

export const buildResolvedIncidentResolution = ({
  resolutionKey,
  previous,
  resolvedAt,
  actor,
  note,
}: {
  resolutionKey: string;
  previous: SystemHealthIncidentResolutionState;
  resolvedAt: string;
  actor: SystemHealthIncidentResolutionActor;
  note?: string;
}): SystemHealthIncidentResolution => ({
  resolutionKey,
  status: 'resolved',
  updatedAt: resolvedAt,
  resolvedAt,
  resolvedByUid: actor.uid || 'unknown',
  resolvedByEmail: actor.email || 'unknown@local',
  resolvedByName: actorName(actor),
  note: note || '',
  history: [
    ...(previous[resolutionKey]?.history || []),
    {
      action: 'resolved',
      at: resolvedAt,
      actorUid: actor.uid || 'unknown',
      actorEmail: actor.email || 'unknown@local',
      actorName: actorName(actor),
      note,
    },
  ],
});

export const buildReopenedIncidentResolution = ({
  resolutionKey,
  previous,
  reopenedAt,
  actor,
}: {
  resolutionKey: string;
  previous: SystemHealthIncidentResolutionState;
  reopenedAt: string;
  actor: SystemHealthIncidentResolutionActor;
}): SystemHealthIncidentResolution => ({
  ...(previous[resolutionKey] || {
    resolutionKey,
    history: [],
  }),
  resolutionKey,
  status: 'open',
  updatedAt: reopenedAt,
  reopenedAt,
  reopenedByUid: actor.uid || 'unknown',
  reopenedByEmail: actor.email || 'unknown@local',
  reopenedByName: actorName(actor),
  history: [
    ...(previous[resolutionKey]?.history || []),
    {
      action: 'reopened',
      at: reopenedAt,
      actorUid: actor.uid || 'unknown',
      actorEmail: actor.email || 'unknown@local',
      actorName: actorName(actor),
    },
  ],
});
