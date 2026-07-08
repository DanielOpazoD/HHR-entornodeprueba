import { describe, expect, it } from 'vitest';

import {
  resolveRowHoverActionFromGlobalPointer,
  resolveRowHoverActionFromRowPointer,
  resolveLauncherPosition,
  resolveLauncherTriggerVisibility,
  resolveVisibilityHiddenLauncherState,
  shouldReleaseLauncherOwnership,
} from '@/features/census/components/patient-row/patientRowOrbitalLauncherRuntimeSupport';

const baseInput = {
  hasQuickActions: true,
  supportsHoverFine: true,
  isOpen: false,
  isLauncherHovered: false,
  isRowHovered: false,
  isHoverGraceActive: false,
  rowId: 'R1',
  activeLauncherRowId: null,
  ownerLauncherRowId: null,
};

describe('resolveLauncherTriggerVisibility', () => {
  it('blocks rows without quick actions and rows shadowed by another open launcher', () => {
    expect(resolveLauncherTriggerVisibility({ ...baseInput, hasQuickActions: false })).toBe(false);
    expect(resolveLauncherTriggerVisibility({ ...baseInput, activeLauncherRowId: 'R2' })).toBe(
      false
    );
  });

  it('reveals the trigger for touch devices or direct launcher activity', () => {
    expect(resolveLauncherTriggerVisibility({ ...baseInput, supportsHoverFine: false })).toBe(true);
    expect(resolveLauncherTriggerVisibility({ ...baseInput, isOpen: true })).toBe(true);
    expect(resolveLauncherTriggerVisibility({ ...baseInput, isLauncherHovered: true })).toBe(true);
  });

  it('reveals the trigger while the current row owns, hovers, or keeps grace ownership', () => {
    expect(resolveLauncherTriggerVisibility({ ...baseInput, ownerLauncherRowId: 'R1' })).toBe(true);
    expect(resolveLauncherTriggerVisibility({ ...baseInput, isRowHovered: true })).toBe(true);
    expect(resolveLauncherTriggerVisibility({ ...baseInput, isHoverGraceActive: true })).toBe(true);
  });

  it('does not let a hovered row steal ownership from another row', () => {
    expect(
      resolveLauncherTriggerVisibility({
        ...baseInput,
        isRowHovered: true,
        ownerLauncherRowId: 'R2',
      })
    ).toBe(false);
  });
});

describe('shouldReleaseLauncherOwnership', () => {
  it('releases ownership only when the current row owns the launcher and nothing is active', () => {
    expect(
      shouldReleaseLauncherOwnership({
        ownerLauncherRowId: 'R1',
        rowId: 'R1',
        isOpen: false,
        isLauncherHovered: false,
        isRowHovered: false,
      })
    ).toBe(true);
  });

  it('keeps ownership when another row owns it or interaction is still active', () => {
    expect(
      shouldReleaseLauncherOwnership({
        ownerLauncherRowId: 'R2',
        rowId: 'R1',
        isOpen: false,
        isLauncherHovered: false,
        isRowHovered: false,
      })
    ).toBe(false);

    expect(
      shouldReleaseLauncherOwnership({
        ownerLauncherRowId: 'R1',
        rowId: 'R1',
        isOpen: true,
        isLauncherHovered: false,
        isRowHovered: false,
      })
    ).toBe(false);
  });
});

describe('resolveVisibilityHiddenLauncherState', () => {
  it('always resets hover state and only clears ownership for the current row', () => {
    expect(
      resolveVisibilityHiddenLauncherState({
        ownerLauncherRowId: 'R1',
        rowId: 'R1',
      })
    ).toEqual({
      shouldResetHoverState: true,
      shouldClearOwnership: true,
    });

    expect(
      resolveVisibilityHiddenLauncherState({
        ownerLauncherRowId: 'R2',
        rowId: 'R1',
      })
    ).toEqual({
      shouldResetHoverState: true,
      shouldClearOwnership: false,
    });
  });
});

describe('row hover actions', () => {
  const rowRect = {
    left: 100,
    right: 300,
    top: 20,
    bottom: 60,
  };

  const createRow = (): HTMLTableRowElement => {
    const row = document.createElement('tr');
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => rowRect,
    });
    const rutCell = document.createElement('td');
    rutCell.className = 'group/rut';
    Object.defineProperty(rutCell, 'getBoundingClientRect', {
      value: () => ({ ...rowRect, right: 180 }),
    });
    row.appendChild(rutCell);
    return row as HTMLTableRowElement;
  };

  it('activates or deactivates row hover from row-local pointer movement', () => {
    const row = createRow();

    expect(resolveRowHoverActionFromRowPointer(150, row)).toBe('activate');
    expect(resolveRowHoverActionFromRowPointer(220, row)).toBe('deactivate');
  });

  it('activates from the external left band, deactivates outside, and preserves inside-row movement', () => {
    const row = createRow();

    expect(
      resolveRowHoverActionFromGlobalPointer({
        pointerX: 90,
        pointerY: 40,
        row,
        targetInsideRow: false,
      })
    ).toBe('activate');

    expect(
      resolveRowHoverActionFromGlobalPointer({
        pointerX: 250,
        pointerY: 90,
        row,
        targetInsideRow: false,
      })
    ).toBe('deactivate');

    expect(
      resolveRowHoverActionFromGlobalPointer({
        pointerX: 250,
        pointerY: 40,
        row,
        targetInsideRow: true,
      })
    ).toBe('preserve');
  });
});

describe('resolveLauncherPosition', () => {
  const createRow = (left: number, top = 120, height = 44): HTMLTableRowElement => {
    const row = document.createElement('tr');
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({
        x: left,
        y: top,
        left,
        right: left + 680,
        top,
        bottom: top + height,
        width: 680,
        height,
        toJSON: () => ({}),
      }),
    });
    return row as HTMLTableRowElement;
  };

  it('keeps the launcher anchored outside the table when lateral room is tight', () => {
    const row = createRow(220);

    expect(resolveLauncherPosition(row, 80, 158, 206, 80, 36)).toEqual({
      left: 60,
      top: 106,
    });
  });

  it('keeps the natural launcher position when there is enough lateral room', () => {
    const row = createRow(360);

    expect(resolveLauncherPosition(row, 80, 158, 206, 80, 36)).toEqual({
      left: 200,
      top: 106,
    });
  });
});
