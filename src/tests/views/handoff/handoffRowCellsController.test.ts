import { describe, expect, it } from 'vitest';

import { PatientStatus } from '@/domain/handoff/patientContracts';
import {
  canToggleClinicalEvents,
  resolveClinicalEventsCellState,
  resolveHandoffStatusVariant,
  shouldRenderClinicalEventsPanel,
} from '@/features/handoff/controllers/handoffRowCellsController';

describe('handoffRowCellsController', () => {
  it('maps patient status to badge variants', () => {
    expect(resolveHandoffStatusVariant(PatientStatus.GRAVE)).toBe('red');
    expect(resolveHandoffStatusVariant(PatientStatus.DE_CUIDADO)).toBe('orange');
    expect(resolveHandoffStatusVariant(PatientStatus.ESTABLE)).toBe('green');
    expect(resolveHandoffStatusVariant(undefined)).toBe('green');
  });

  it('enables event toggle only for top-level rows with edit access or existing events', () => {
    expect(
      canToggleClinicalEvents({ isSubRow: false, hasEvents: false, canEditEvents: true })
    ).toBe(true);
    expect(
      canToggleClinicalEvents({ isSubRow: false, hasEvents: true, canEditEvents: false })
    ).toBe(true);
    expect(canToggleClinicalEvents({ isSubRow: true, hasEvents: true, canEditEvents: true })).toBe(
      false
    );
  });

  it('requires full event actions to render the events panel', () => {
    expect(
      shouldRenderClinicalEventsPanel({
        showEvents: true,
        canAdd: true,
        canUpdate: true,
        canDelete: true,
      })
    ).toBe(true);
    expect(
      shouldRenderClinicalEventsPanel({
        showEvents: true,
        canAdd: true,
        canUpdate: false,
        canDelete: true,
      })
    ).toBe(false);
  });

  it('resolves the diagnosis/events cell state from row and permission context', () => {
    expect(
      resolveClinicalEventsCellState({
        patientStatus: PatientStatus.DE_CUIDADO,
        isSubRow: false,
        hasEvents: true,
        canAdd: true,
        canUpdate: true,
        canDelete: true,
        showEvents: false,
      })
    ).toEqual({
      statusVariant: 'orange',
      canToggleEvents: true,
      shouldRenderEventsPanel: false,
      showStatusBadge: true,
    });

    expect(
      resolveClinicalEventsCellState({
        patientStatus: PatientStatus.ESTABLE,
        isSubRow: true,
        hasEvents: true,
        canAdd: true,
        canUpdate: true,
        canDelete: true,
        showEvents: true,
      })
    ).toEqual({
      statusVariant: 'green',
      canToggleEvents: false,
      shouldRenderEventsPanel: true,
      showStatusBadge: false,
    });
  });
});
