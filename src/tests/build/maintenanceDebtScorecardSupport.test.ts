import { describe, expect, it } from 'vitest';
import {
  buildLegacyRetirementDebtRows,
  buildMaintenanceDebtWatchlistRows,
} from '../../../scripts/maintenanceDebtScorecardSupport.mjs';

describe('maintenanceDebtScorecardSupport', () => {
  it('adds configured hotspot limits and remaining headroom to watchlist rows', () => {
    expect(
      buildMaintenanceDebtWatchlistRows({
        watchlistFiles: ['firestore.rules', 'src/hooks/useCensusEmailRecipientLists.ts'],
        countLines: (file: string) => (file === 'firestore.rules' ? 989 : 150),
        hookLimits: {
          'src/hooks/useCensusEmailRecipientLists.ts': 180,
        },
        moduleLimits: {},
        rulesLimits: {
          'firestore.rules': 1050,
        },
      })
    ).toEqual([
      {
        file: 'firestore.rules',
        lines: 989,
        limit: 1050,
        limitSource: 'rules-governance',
        remainingLines: 61,
      },
      {
        file: 'src/hooks/useCensusEmailRecipientLists.ts',
        lines: 150,
        limit: 180,
        limitSource: 'hook-hotspot',
        remainingLines: 30,
      },
    ]);
  });

  it('summarizes legacy retirement debt surfaces for the maintenance scorecard', () => {
    expect(
      buildLegacyRetirementDebtRows({
        status: 'ok',
        openSurfaceCount: 2,
        maxOpenSurfaces: 4,
        surfaces: [
          {
            id: 'legacy-read-bridge',
            label: 'Legacy read bridge',
            owner: 'storage/repositories',
            phase: 'restrict',
            status: 'ok',
            signal: 'entrypoints=2/2, importers=1/1',
            nextAction: 'Keep bridge import surface flat.',
          },
          {
            id: 'role-aliases',
            label: 'Role aliases',
            owner: 'auth/security',
            phase: 'observe',
            status: 'ok',
            signal: 'governedEntries=4/4, missing=0',
            nextAction: 'Audit production role sources.',
          },
        ],
      })
    ).toEqual({
      status: 'ok',
      openSurfaceCount: 2,
      maxOpenSurfaces: 4,
      rows: [
        {
          id: 'legacy-read-bridge',
          label: 'Legacy read bridge',
          owner: 'storage/repositories',
          phase: 'restrict',
          status: 'ok',
          signal: 'entrypoints=2/2, importers=1/1',
          nextAction: 'Keep bridge import surface flat.',
        },
        {
          id: 'role-aliases',
          label: 'Role aliases',
          owner: 'auth/security',
          phase: 'observe',
          status: 'ok',
          signal: 'governedEntries=4/4, missing=0',
          nextAction: 'Audit production role sources.',
        },
      ],
    });
  });
});
