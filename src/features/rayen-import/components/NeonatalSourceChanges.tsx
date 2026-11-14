import React from 'react';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { SYNC_TONE, SYNC_TONE_ICON } from './syncTone';

const DecisionIcon = SYNC_TONE_ICON.action;
export const NeonatalSourceChanges: React.FC<{
  changes: CensusImportDiff['neonatalSourceChanges'];
  acceptedEpisodes: string[];
  onChange: (episodes: string[]) => void;
}> = ({ changes, acceptedEpisodes, onChange }) =>
  !changes?.length ? null : (
    <section
      className={`mt-3 rounded-lg p-3 ${SYNC_TONE.action.surface}`}
      aria-label="Cambio de ubicación del RN"
    >
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        <DecisionIcon size={16} className={SYNC_TONE.action.icon} aria-hidden="true" />
        Revisa la ubicación del RN
      </h4>
      {changes.map(c => (
        <label key={c.episodeId} className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={acceptedEpisodes.includes(c.episodeId)}
            onChange={e =>
              onChange(
                e.target.checked
                  ? [...acceptedEpisodes, c.episodeId]
                  : acceptedEpisodes.filter(id => id !== c.episodeId)
              )
            }
          />
          Confirmo la ubicación de {c.patientName} · Eloísa: {c.sourceMode} {c.sourceBedId} · HHR:{' '}
          {c.hhrMode} {c.hhrBedId}
        </label>
      ))}
      <p className="mt-1 text-xs text-slate-600">
        Confirma la ubicación mostrada en el censo antes de continuar.
      </p>
    </section>
  );
