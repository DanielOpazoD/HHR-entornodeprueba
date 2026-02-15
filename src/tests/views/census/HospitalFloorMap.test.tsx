import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { BedDefinition } from '@/types';
import { BedType } from '@/types';
import { HospitalFloorMap } from '@/features/census/components/3d/HospitalFloorMap';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => (
    <div data-testid="hospital-floor-canvas">{children}</div>
  ),
}));

vi.mock('@react-three/drei', () => ({
  ContactShadows: () => <div data-testid="contact-shadows" />,
  Environment: () => <div data-testid="environment" />,
  OrbitControls: ({ onChange }: { onChange?: () => void }) => (
    <button type="button" data-testid="orbit-controls" onClick={onChange}>
      orbit-controls
    </button>
  ),
}));

vi.mock('@/features/census/components/3d/HospitalFloorMapBedMesh', () => ({
  HospitalFloorMapBedMesh: ({ bed, onClick }: { bed: BedDefinition; onClick?: () => void }) => (
    <button type="button" data-testid={`bed-${bed.id}`} onClick={onClick}>
      {bed.id}
    </button>
  ),
}));

vi.mock('@/features/census/components/3d/HospitalFloorMapZoomControls', () => ({
  HospitalFloorMapZoomControls: ({
    isEditMode,
    onZoomIn,
    onZoomOut,
  }: {
    isEditMode: boolean;
    onZoomIn: () => void;
    onZoomOut: () => void;
  }) => (
    <div>
      <span data-testid="zoom-edit-mode">{String(isEditMode)}</span>
      <button type="button" data-testid="zoom-in" onClick={onZoomIn}>
        +
      </button>
      <button type="button" data-testid="zoom-out" onClick={onZoomOut}>
        -
      </button>
    </div>
  ),
}));

vi.mock('@/features/census/components/3d/HospitalFloorMapToolbar', () => ({
  HospitalFloorMapToolbar: ({
    isEditMode,
    showConfig,
    onToggleEditMode,
    onToggleConfig,
  }: {
    isEditMode: boolean;
    showConfig: boolean;
    onToggleEditMode: () => void;
    onToggleConfig: () => void;
  }) => (
    <div>
      <span data-testid="toolbar-edit-mode">{String(isEditMode)}</span>
      <span data-testid="toolbar-show-config">{String(showConfig)}</span>
      <button type="button" data-testid="toggle-edit-mode" onClick={onToggleEditMode}>
        edit
      </button>
      <button type="button" data-testid="toggle-config" onClick={onToggleConfig}>
        config
      </button>
    </div>
  ),
}));

vi.mock('@/features/census/components/3d/HospitalFloorMapConfigPanel', () => ({
  HospitalFloorMapConfigPanel: ({ onSave }: { onSave: () => void }) => (
    <button type="button" data-testid="config-panel-save" onClick={onSave}>
      save
    </button>
  ),
}));

vi.mock('@/features/census/components/3d/HospitalFloorMapLegend', () => ({
  HospitalFloorMapLegend: () => <div data-testid="hospital-floor-legend" />,
}));

describe('HospitalFloorMap', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const beds: BedDefinition[] = [{ id: 'R1', name: 'R1', type: BedType.UTI, isCuna: false }];

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('delegates bed click to callback', () => {
    const onBedClick = vi.fn();
    render(<HospitalFloorMap beds={beds} patients={{}} onBedClick={onBedClick} />);

    fireEvent.click(screen.getByTestId('bed-R1'));
    expect(onBedClick).toHaveBeenCalledWith('R1');
  });

  it('toggles edit mode and configuration panel through toolbar wiring', () => {
    render(<HospitalFloorMap beds={beds} patients={{}} />);

    expect(screen.getByTestId('toolbar-edit-mode')).toHaveTextContent('false');
    expect(screen.getByTestId('toolbar-show-config')).toHaveTextContent('false');
    expect(screen.queryByTestId('config-panel-save')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle-edit-mode'));
    fireEvent.click(screen.getByTestId('toggle-config'));

    expect(screen.getByTestId('toolbar-edit-mode')).toHaveTextContent('true');
    expect(screen.getByTestId('toolbar-show-config')).toHaveTextContent('true');
    expect(screen.getByTestId('config-panel-save')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-edit-mode')).toHaveTextContent('true');
  });
});
