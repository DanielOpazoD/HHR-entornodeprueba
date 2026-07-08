/**
 * DeviceSelector Component Tests
 * Tests for read-only mode display behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeviceSelector } from '@/components/DeviceSelector';

describe('DeviceSelector', () => {
  const mockOnChange = vi.fn();
  const mockOnDetailsChange = vi.fn();
  const mockOnRetireChange = vi.fn();
  const mockOnConfigChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when disabled (readOnly mode)', () => {
    it('should render device badges when disabled with devices', () => {
      const devices = ['VVP#1', 'CVC', 'SNG'];

      render(
        <DeviceSelector
          devices={devices}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={true}
          currentDate="2025-12-25"
        />
      );

      // Should render the container with devices
      const container = document.querySelector('.flex.flex-wrap');
      expect(container).toBeTruthy();

      // Should not render empty placeholder
      expect(screen.queryByText('-')).not.toBeInTheDocument();
    });

    it('normalizes legacy VVP values before rendering badges', () => {
      render(
        <DeviceSelector
          devices={['2 VVP', 'CVC']}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={true}
          currentDate="2025-12-25"
        />
      );

      expect(screen.getByText('CVC')).toBeInTheDocument();
      expect(screen.getByText('VVP')).toBeInTheDocument();
      expect(screen.getByText('VVP#2')).toBeInTheDocument();
    });

    it('should render placeholder when disabled with no devices', () => {
      render(
        <DeviceSelector
          devices={[]}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={true}
          currentDate="2025-12-25"
        />
      );

      // Should render the dash placeholder for empty devices
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('should not be clickable when disabled', () => {
      const devices = ['VVP#1'];

      render(
        <DeviceSelector
          devices={devices}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={true}
          currentDate="2025-12-25"
        />
      );

      // The container should not have cursor-pointer class
      const container = document.querySelector('.flex.flex-wrap');
      expect(container?.classList.contains('cursor-pointer')).toBe(false);
    });
  });

  describe('when enabled (edit mode)', () => {
    it('should render clickable container with devices', () => {
      const devices = ['VVP#1', 'CVC'];

      render(
        <DeviceSelector
          devices={devices}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={false}
          currentDate="2025-12-25"
        />
      );

      // Should render clickable container
      const container = document.querySelector('.cursor-pointer');
      expect(container).toBeTruthy();
    });

    it('should render plus icon when no devices', () => {
      render(
        <DeviceSelector
          devices={[]}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={false}
          currentDate="2025-12-25"
        />
      );

      // Should render the Plus icon (within a span with opacity-50)
      const plusContainer = document.querySelector('.opacity-50');
      expect(plusContainer).toBeTruthy();
    });

    it('closes device menu on Escape key', () => {
      render(
        <DeviceSelector
          devices={[]}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={false}
          currentDate="2025-12-25"
        />
      );

      const clickableContainer = document.querySelector('.cursor-pointer');
      expect(clickableContainer).toBeTruthy();
      if (!clickableContainer) {
        throw new Error('Clickable container not found');
      }
      fireEvent.click(clickableContainer);

      expect(screen.getByText('Dispositivos')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('Dispositivos')).not.toBeInTheDocument();
    });

    it('closes device menu on outside click without backdrop', () => {
      render(
        <DeviceSelector
          devices={[]}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          disabled={false}
          currentDate="2025-12-25"
        />
      );

      const clickableContainer = document.querySelector('.cursor-pointer');
      expect(clickableContainer).toBeTruthy();
      if (!clickableContainer) {
        throw new Error('Clickable container not found');
      }
      fireEvent.click(clickableContainer);

      expect(screen.getByText('Dispositivos')).toBeInTheDocument();
      expect(document.querySelector('.fixed.inset-0.z-40')).toBeNull();

      fireEvent.mouseDown(document.body);
      expect(screen.queryByText('Dispositivos')).not.toBeInTheDocument();
    });

    it('routes invasive device retirement through the atomic retire callback', () => {
      render(
        <DeviceSelector
          devices={['CVC', 'TET']}
          deviceDetails={{
            CVC: { installationDate: '2026-02-14' },
            TET: { installationDate: '2026-02-13' },
          }}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          onRetireChange={mockOnRetireChange}
          disabled={false}
          currentDate="2026-02-16"
        />
      );

      const clickableContainer = document.querySelector('.cursor-pointer');
      expect(clickableContainer).toBeTruthy();
      if (!clickableContainer) {
        throw new Error('Clickable container not found');
      }
      fireEvent.click(clickableContainer);

      const retireButtons = screen.getAllByTitle('Retirar');
      fireEvent.click(retireButtons[1]);
      fireEvent.click(screen.getByText('Confirmar Retiro'));

      expect(mockOnRetireChange).toHaveBeenCalledWith(
        ['CVC'],
        expect.objectContaining({
          TET: expect.objectContaining({
            installationDate: '2026-02-13',
            removalDate: '2026-02-16',
          }),
          CVC: expect.objectContaining({
            installationDate: '2026-02-14',
          }),
        })
      );
      expect(mockOnChange).not.toHaveBeenCalled();
      expect(mockOnDetailsChange).not.toHaveBeenCalled();
    });

    it('keeps successive device additions in the same pending bundle before parent rehydrates', () => {
      render(
        <DeviceSelector
          devices={[]}
          deviceDetails={{}}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          onConfigChange={mockOnConfigChange}
          disabled={false}
          currentDate="2026-02-16"
        />
      );

      const clickableContainer = document.querySelector('.cursor-pointer');
      expect(clickableContainer).toBeTruthy();
      if (!clickableContainer) {
        throw new Error('Clickable container not found');
      }
      fireEvent.click(clickableContainer);

      fireEvent.click(screen.getByText('CVC'));
      fireEvent.click(screen.getByText('Confirmar e Instalar'));

      fireEvent.click(screen.getByText('TET'));
      fireEvent.click(screen.getByText('Confirmar e Instalar'));

      fireEvent.click(screen.getByText('LA'));
      fireEvent.click(screen.getByText('Confirmar e Instalar'));

      expect(mockOnConfigChange).toHaveBeenCalledTimes(3);
      expect(mockOnConfigChange.mock.calls[0][0]).toEqual(['CVC']);
      expect(mockOnConfigChange.mock.calls[1][0]).toEqual(['CVC', 'TET']);
      expect(mockOnConfigChange.mock.calls[2][0]).toEqual(['CVC', 'TET', 'LA']);
      expect(mockOnConfigChange.mock.calls[2][1]).toEqual({
        CVC: { installationDate: '2026-02-16' },
        TET: { installationDate: '2026-02-16' },
        LA: { installationDate: '2026-02-16' },
      });
    });

    it('drops an unconfirmed local device draft after closing the editor without parent rehydration', () => {
      const { rerender } = render(
        <DeviceSelector
          devices={['VVP#1']}
          deviceDetails={{ 'VVP#1': { installationDate: '2026-02-15' } }}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          onConfigChange={mockOnConfigChange}
          disabled={false}
          currentDate="2026-02-16"
        />
      );

      const clickableContainer = document.querySelector('.cursor-pointer');
      expect(clickableContainer).toBeTruthy();
      if (!clickableContainer) {
        throw new Error('Clickable container not found');
      }
      fireEvent.click(clickableContainer);

      fireEvent.click(screen.getByText('Añadir'));
      fireEvent.click(screen.getByText('Confirmar e Instalar'));
      expect(mockOnConfigChange).toHaveBeenCalledWith(
        ['VVP#1', 'VVP#2'],
        expect.objectContaining({
          'VVP#1': { installationDate: '2026-02-15' },
          'VVP#2': { installationDate: '2026-02-16' },
        })
      );

      expect(screen.getByText('VVP#2')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });

      rerender(
        <DeviceSelector
          devices={['VVP#1']}
          deviceDetails={{ 'VVP#1': { installationDate: '2026-02-15' } }}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          onConfigChange={mockOnConfigChange}
          disabled={false}
          currentDate="2026-02-16"
        />
      );

      expect(screen.queryByText('VVP#2')).not.toBeInTheDocument();
      expect(screen.getByText('VVP')).toBeInTheDocument();
    });

    it('allows renaming a configured custom device without treating it as a new unrelated device', () => {
      render(
        <DeviceSelector
          devices={['drenaje pleural izquierdo']}
          deviceDetails={{
            'drenaje pleural izquierdo': {
              installationDate: '2026-02-16',
              note: 'instalado en urgencia',
            },
          }}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          onConfigChange={mockOnConfigChange}
          disabled={false}
          currentDate="2026-02-17"
        />
      );

      const clickableContainer = document.querySelector('.cursor-pointer');
      expect(clickableContainer).toBeTruthy();
      if (!clickableContainer) {
        throw new Error('Clickable container not found');
      }
      fireEvent.click(clickableContainer);

      fireEvent.click(screen.getByTitle('Configurar'));
      const nameInput = screen.getByLabelText('Nombre del dispositivo');
      fireEvent.change(nameInput, { target: { value: 'drenaje pleural' } });
      fireEvent.click(screen.getByText('Confirmar e Instalar'));

      expect(mockOnConfigChange).toHaveBeenCalledWith(
        ['drenaje pleural'],
        {
          'drenaje pleural': {
            installationDate: '2026-02-16',
            note: 'instalado en urgencia',
          },
        },
        {
          renamedDevice: {
            from: 'drenaje pleural izquierdo',
            to: 'drenaje pleural',
          },
        }
      );
    });

    it('blocks renaming a custom device to another active device name', () => {
      render(
        <DeviceSelector
          devices={['CVC', 'drenaje pleural izquierdo']}
          deviceDetails={{
            CVC: {
              installationDate: '2026-02-15',
              note: 'central',
            },
            'drenaje pleural izquierdo': {
              installationDate: '2026-02-16',
            },
          }}
          onChange={mockOnChange}
          onDetailsChange={mockOnDetailsChange}
          onConfigChange={mockOnConfigChange}
          disabled={false}
          currentDate="2026-02-17"
        />
      );

      const clickableContainer = document.querySelector('.cursor-pointer');
      expect(clickableContainer).toBeTruthy();
      if (!clickableContainer) {
        throw new Error('Clickable container not found');
      }
      fireEvent.click(clickableContainer);

      const configureButtons = screen.getAllByTitle('Configurar');
      fireEvent.click(configureButtons[configureButtons.length - 1]);
      const nameInput = screen.getByLabelText('Nombre del dispositivo');
      fireEvent.change(nameInput, { target: { value: 'CVC' } });

      expect(screen.getByText('Ya existe un dispositivo activo con ese nombre.')).toBeVisible();
      const saveButton = screen.getByText('Confirmar e Instalar');
      expect(saveButton).toBeDisabled();
      fireEvent.click(saveButton);

      expect(mockOnConfigChange).not.toHaveBeenCalled();
    });
  });
});
