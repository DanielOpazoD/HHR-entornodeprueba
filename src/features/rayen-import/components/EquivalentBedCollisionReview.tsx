import React from 'react';
import type {
  BedOccupancyCollision,
  BedOccupancyCollisionResolution,
} from '../contracts/censusImportDiff';

interface CollisionDraft {
  selectedEpisodeId: string;
  action: '' | 'discharge' | 'transfer' | 'remove' | 'move';
  targetBedId: string;
}

interface EquivalentBedCollisionReviewProps {
  collisions: BedOccupancyCollision[];
  reservedTargetBedIds?: string[];
  onChange: (resolutions: BedOccupancyCollisionResolution[]) => void;
}

const toResolutions = (
  collisions: BedOccupancyCollision[],
  drafts: Record<string, CollisionDraft>
): BedOccupancyCollisionResolution[] =>
  collisions.flatMap(collision => {
    const draft = drafts[collision.id];
    if (!draft?.selectedEpisodeId || !draft.action) return [];
    if (draft.action === 'move' && !draft.targetBedId) return [];
    return [
      {
        collisionId: collision.id,
        selectedEpisodeId: draft.selectedEpisodeId,
        otherDisposition:
          draft.action === 'move'
            ? { kind: 'move' as const, targetBedId: draft.targetBedId }
            : { kind: draft.action },
      },
    ];
  });

export const EquivalentBedCollisionReview: React.FC<EquivalentBedCollisionReviewProps> = ({
  collisions,
  reservedTargetBedIds = [],
  onChange,
}) => {
  const [drafts, setDrafts] = React.useState<Record<string, CollisionDraft>>({});

  React.useEffect(() => {
    setDrafts({});
    onChange([]);
  }, [collisions, onChange]);

  const updateDraft = (
    collisionId: string,
    current: CollisionDraft,
    change: Partial<CollisionDraft>
  ): void => {
    const next = { ...drafts, [collisionId]: { ...current, ...change } };
    setDrafts(next);
    onChange(toResolutions(collisions, next));
  };

  return collisions.map(collision => {
    const draft = drafts[collision.id] ?? {
      selectedEpisodeId: '',
      action: '',
      targetBedId: '',
    };
    const other = collision.candidates.find(
      candidate => candidate.clinicalEpisodeId !== draft.selectedEpisodeId
    );
    const targetsSelectedElsewhere = new Set(
      Object.entries(drafts).flatMap(([collisionId, candidateDraft]) =>
        collisionId !== collision.id &&
        candidateDraft.action === 'move' &&
        candidateDraft.targetBedId
          ? [candidateDraft.targetBedId]
          : []
      )
    );
    const availableTargetBedIds = collision.availableAlternativeBedIds.filter(
      bedId => !reservedTargetBedIds.includes(bedId) && !targetsSelectedElsewhere.has(bedId)
    );
    return (
      <div
        key={collision.id}
        className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"
        data-testid="equivalent-bed-collision-review"
      >
        <h4 className="text-sm font-semibold text-red-900">
          Ocupación simultánea CMA {collision.bedId} / {collision.bedId}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-red-800">
          Rayen informa dos episodios para la única cama {collision.bedId} de HHR. Esta decisión es
          manual y se aplicará como una sola operación.
        </p>
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm font-medium text-slate-800">
            ¿Quién queda en {collision.bedId}?
          </legend>
          {collision.candidates.map(candidate => (
            <label
              key={candidate.clinicalEpisodeId}
              className="flex items-start gap-2 text-sm text-slate-800"
            >
              <input
                type="radio"
                name={`keeper-${collision.id}`}
                checked={draft.selectedEpisodeId === candidate.clinicalEpisodeId}
                onChange={() =>
                  updateDraft(collision.id, draft, {
                    selectedEpisodeId: candidate.clinicalEpisodeId,
                    action: '',
                    targetBedId: '',
                  })
                }
              />
              <span>
                <strong>{candidate.patient.patientName}</strong> ·{' '}
                {candidate.sourceKind === 'cma'
                  ? `CMA ${collision.bedId}`
                  : `${collision.bedId} médico-quirúrgica`}
                {candidate.currentBedId ? ` · actualmente en ${candidate.currentBedId}` : ''}
              </span>
            </label>
          ))}
        </fieldset>
        {draft.selectedEpisodeId && other && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-slate-800">
              ¿Qué ocurrirá con {other.patient.patientName}?
              <select
                aria-label={`Acción para ${other.patient.patientName}`}
                value={draft.action}
                onChange={event =>
                  updateDraft(collision.id, draft, {
                    action: event.target.value as CollisionDraft['action'],
                    targetBedId: '',
                  })
                }
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Seleccionar acción…</option>
                <option value="discharge">Alta</option>
                <option value="transfer">Traslado a otro hospital</option>
                <option value="remove">Eliminar del censo sin movimiento</option>
                <option value="move">Mover a otra cama médico-quirúrgica</option>
              </select>
            </label>
            {draft.action === 'move' && (
              <label className="mt-2 block text-sm font-medium text-slate-800">
                Cama destino
                <select
                  aria-label={`Cama destino para ${other.patient.patientName}`}
                  value={draft.targetBedId}
                  onChange={event =>
                    updateDraft(collision.id, draft, {
                      targetBedId: event.target.value,
                    })
                  }
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">Seleccionar cama disponible…</option>
                  {availableTargetBedIds.map(bedId => (
                    <option key={bedId} value={bedId}>
                      {bedId}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>
    );
  });
};
