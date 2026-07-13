/**
 * Small "syncing" indicator for the clinical census cells (Signos / DMI / Scores) — three pulsing
 * dots in the cell's top-right corner, shown while the Rayen background fill runs. Unlike the
 * empty-cell skeleton (which only appears when there is NO data yet), this shows during EVERY sync,
 * so a re-sync of a patient who already has data still gives visible loading feedback on the column.
 * Purely decorative (the fill status is announced elsewhere), so it's aria-hidden.
 */

import React from 'react';

export const CellSyncIndicator: React.FC = () => (
  <span
    className="pointer-events-none absolute right-1 top-1 flex gap-0.5"
    aria-hidden
    title="Sincronizando desde Eloísa…"
  >
    <span className="h-1 w-1 rounded-full bg-teal-400 animate-pulse motion-reduce:animate-none" />
    <span className="h-1 w-1 rounded-full bg-teal-400 animate-pulse motion-reduce:animate-none [animation-delay:150ms]" />
    <span className="h-1 w-1 rounded-full bg-teal-400 animate-pulse motion-reduce:animate-none [animation-delay:300ms]" />
  </span>
);
