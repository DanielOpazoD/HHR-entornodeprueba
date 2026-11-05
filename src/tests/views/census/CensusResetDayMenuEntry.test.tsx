import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CensusResetDayMenuEntry } from '@/features/census/components/CensusResetDayMenuEntry';
import { resolveResetDayMenuEntryState } from '@/features/census/controllers/censusResetDayController';
import { CensusToolbarMenuTargetContext } from '@/shared/ui/CensusToolbarMenuTargetContext';

let menu: HTMLElement | null = null;
const renderEntry = (props: {
  readOnly: boolean;
  canDeleteRecord: boolean;
  onClearAll?: () => Promise<void>;
}) => {
  menu = document.createElement('div');
  document.body.appendChild(menu);
  render(
    <CensusToolbarMenuTargetContext.Provider value={menu}>
      <CensusResetDayMenuEntry
        readOnly={props.readOnly}
        canDeleteRecord={props.canDeleteRecord}
        deniedMessage="No autorizado"
        onClearAll={props.onClearAll ?? vi.fn().mockResolvedValue(undefined)}
      />
    </CensusToolbarMenuTargetContext.Provider>
  );
  return within(menu);
};

describe('CensusResetDayMenuEntry', () => {
  afterEach(() => {
    menu?.remove();
    menu = null;
  });

  it('clears the day from the «⋯» menu when the role may do it', () => {
    const onClearAll = vi.fn().mockResolvedValue(undefined);
    const entry = renderEntry({ readOnly: false, canDeleteRecord: true, onClearAll }).getByRole(
      'button',
      { name: 'Limpiar datos del día' }
    );
    expect(entry).toHaveAttribute('title', 'Eliminar todos los datos del día');
    fireEvent.click(entry);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('shows why it is off for an editor without the permission', () => {
    const entry = renderEntry({ readOnly: false, canDeleteRecord: false }).getByRole('button', {
      name: 'Limpiar datos del día',
    });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAttribute('title', 'No autorizado');
  });

  it('is not offered to a read-only viewer without the permission, nor outside the census', () => {
    expect(
      renderEntry({ readOnly: true, canDeleteRecord: false }).queryByRole('button')
    ).toBeNull();
    render(
      <CensusResetDayMenuEntry
        readOnly={false}
        canDeleteRecord
        deniedMessage=""
        onClearAll={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Limpiar datos del día' })).toBeNull();
  });

  it('keeps the same visibility rule the table corner had', () => {
    expect(
      resolveResetDayMenuEntryState({ readOnly: true, canDeleteRecord: true, deniedMessage: '' })
    ).toEqual({ visible: true, enabled: true, title: 'Eliminar todos los datos del día' });
    expect(
      resolveResetDayMenuEntryState({ readOnly: true, canDeleteRecord: false, deniedMessage: 'x' })
        .visible
    ).toBe(false);
  });
});
