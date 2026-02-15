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
  });
});
