import React from 'react';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
export const NeonatalSourceChanges: React.FC<{
  changes: CensusImportDiff['neonatalSourceChanges'];
  acceptedEpisodes: string[];
  onChange: (episodes: string[]) => void;
}> = ({ changes, acceptedEpisodes, onChange }) =>
  !changes?.length ? null : (
    <section
      className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
      aria-label="Cambio de ubicación del RN"
    >
      <h4 className="text-sm font-semibold">Revisa la ubicación del RN</h4>
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
