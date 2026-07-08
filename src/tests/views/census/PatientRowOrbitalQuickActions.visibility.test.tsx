import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  mockMatchMedia,
  parsePx,
  renderMultiPatientRowOrbitalQuickActions,
  renderSinglePatientRowOrbitalQuickActions,
} from '@/tests/views/census/patientRowOrbitalQuickActionsTestSupport';

describe('PatientRowOrbitalQuickActions visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchMedia(true);
  });

  it('keeps the trigger visible on touch-like devices', async () => {
    mockMatchMedia(false);
    renderSinglePatientRowOrbitalQuickActions();

    const trigger = await screen.findByRole('button', { name: /acciones clínicas rápidas/i });
    expect(trigger.className).toContain('opacity-100');
  });

  it('reveals the trigger while hovering the patient row on desktop pointers', async () => {
    renderSinglePatientRowOrbitalQuickActions();

    const trigger = await screen.findByRole('button', { name: /acciones clínicas rápidas/i });
    expect(trigger.className).toContain('opacity-0');

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });

    await waitFor(() => {
      expect(trigger.className).toContain('opacity-100');
    });

    expect(trigger).toHaveStyle({
      width: '48px',
      height: '48px',
    });
  });

  it('reveals the trigger from the full left gutter when the pointer is aligned with the row', async () => {
    renderSinglePatientRowOrbitalQuickActions();

    const row = screen.getByTestId('patient-row');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      x: 240,
      y: 120,
      top: 120,
      left: 240,
      right: 920,
      bottom: 164,
      width: 680,
      height: 44,
      toJSON: () => ({}),
    } as DOMRect);

    const trigger = await screen.findByRole('button', { name: /acciones clínicas rápidas/i });
    expect(trigger.className).toContain('opacity-0');

    fireEvent.mouseMove(window, { clientX: 4, clientY: 140 });

    await waitFor(() => {
      expect(trigger.className).toContain('opacity-100');
    });
  });

  it('uses enlarged hitboxes for trigger and orbital actions', async () => {
    renderSinglePatientRowOrbitalQuickActions();

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    const trigger = await screen.findByRole('button', { name: /acciones clínicas rápidas/i });
    fireEvent.click(trigger);

    const documentsButton = screen.getByRole('button', { name: /documentos clínicos/i });

    expect(trigger).toHaveStyle({
      width: '48px',
      height: '48px',
    });
    expect(documentsButton).toHaveStyle({
      minHeight: '44px',
    });
  });

  it('keeps launcher layers below the sticky app bars', async () => {
    renderSinglePatientRowOrbitalQuickActions();

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    const trigger = await screen.findByRole('button', { name: /acciones clínicas rápidas/i });
    fireEvent.click(trigger);

    const documentsButton = screen.getByRole('button', { name: /documentos clínicos/i });
    const wrapper = trigger.closest('.fixed');
    const actionStack = documentsButton.closest('[data-state="open"]');
    const backdrop = document.querySelector('.fixed.inset-0.z-\\[38\\]');

    expect(wrapper).toHaveClass('z-[39]');
    expect(actionStack).toHaveClass('z-10');
    expect(backdrop).toBeInTheDocument();
  });

  it('keeps the honu in the same screen position after opening the menu', async () => {
    const originalInnerWidth = window.innerWidth;
    try {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 280,
      });

      renderSinglePatientRowOrbitalQuickActions();

      const row = screen.getByTestId('patient-row');
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        x: 240,
        y: 120,
        top: 120,
        left: 240,
        right: 920,
        bottom: 164,
        width: 680,
        height: 44,
        toJSON: () => ({}),
      } as DOMRect);

      fireEvent.mouseMove(row, { clientX: 0 });

      const trigger = await screen.findByRole('button', { name: /acciones clínicas rápidas/i });
      const closedWrapper = trigger.closest('.fixed');
      if (!(closedWrapper instanceof HTMLDivElement)) {
        throw new Error('Launcher wrapper not found');
      }

      const closedTriggerScreenLeft =
        parsePx(closedWrapper.style.left) + parsePx(trigger.style.left);
      const closedTriggerScreenTop = parsePx(closedWrapper.style.top) + parsePx(trigger.style.top);

      fireEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /documentos clínicos/i })).toBeInTheDocument();
      });

      const openWrapper = trigger.closest('.fixed');
      if (!(openWrapper instanceof HTMLDivElement)) {
        throw new Error('Open launcher wrapper not found');
      }

      const openTriggerScreenLeft = parsePx(openWrapper.style.left) + parsePx(trigger.style.left);
      const openTriggerScreenTop = parsePx(openWrapper.style.top) + parsePx(trigger.style.top);

      expect(openTriggerScreenLeft).toBe(closedTriggerScreenLeft);
      expect(openTriggerScreenTop).toBe(closedTriggerScreenTop);
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: originalInnerWidth,
      });
    }
  });

  it('keeps other launchers hidden while one row launcher is open', async () => {
    renderMultiPatientRowOrbitalQuickActions();

    const triggers = await screen.findAllByRole('button', { name: /acciones clínicas rápidas/i });
    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(triggers[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /documentos clínicos/i })).toBeInTheDocument();
    });

    fireEvent.mouseMove(screen.getByTestId('patient-row-secondary'), { clientX: 0 });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /acciones clínicas rápidas/i })).toHaveLength(1);
    });
  });

  it('keeps the hovered row active while moving toward the launcher', async () => {
    renderMultiPatientRowOrbitalQuickActions();

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /acciones clínicas rápidas/i })).toHaveLength(1);
    });

    fireEvent.mouseLeave(screen.getByTestId('patient-row'));
    fireEvent.mouseMove(screen.getByTestId('patient-row-secondary'), { clientX: 0 });

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /acciones clínicas rápidas/i })).toHaveLength(1);
    });
  });

  it('shows only one visible honu while moving quickly across rows', async () => {
    renderMultiPatientRowOrbitalQuickActions({
      rows: [
        { testId: 'patient-row', bedId: 'R2' },
        { testId: 'patient-row-secondary', bedId: 'R3' },
        { testId: 'patient-row-tertiary', bedId: 'R4' },
      ],
    });

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.mouseLeave(screen.getByTestId('patient-row'));
    fireEvent.mouseMove(screen.getByTestId('patient-row-secondary'), { clientX: 0 });
    fireEvent.mouseLeave(screen.getByTestId('patient-row-secondary'));
    fireEvent.mouseMove(screen.getByTestId('patient-row-tertiary'), { clientX: 0 });

    await waitFor(() => {
      const triggers = screen.getAllByRole('button', { name: /acciones clínicas rápidas/i });
      const visibleTriggers = triggers.filter(trigger => trigger.className.includes('opacity-100'));
      expect(visibleTriggers).toHaveLength(1);
    });
  });
});
