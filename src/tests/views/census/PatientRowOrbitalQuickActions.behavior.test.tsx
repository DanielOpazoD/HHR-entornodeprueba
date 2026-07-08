import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import {
  ACTION_ROW_WIDTH,
  ACTION_STACK_HORIZONTAL_SHIFT,
  resolveActionStackHorizontalShift,
} from '@/features/census/components/patient-row/patientRowOrbitalQuickActionLayout';
import {
  mockMatchMedia,
  renderSinglePatientRowOrbitalQuickActions,
} from '@/tests/views/census/patientRowOrbitalQuickActionsTestSupport';

describe('PatientRowOrbitalQuickActions behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchMedia(true);
  });

  it('opens the orbital launcher and dispatches each clinical callback', async () => {
    const onViewClinicalDocuments = vi.fn();
    const onViewExamRequest = vi.fn();
    const onViewImagingRequest = vi.fn();

    renderSinglePatientRowOrbitalQuickActions({
      onViewClinicalDocuments,
      onViewExamRequest,
      onViewImagingRequest,
    });

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
    fireEvent.click(await screen.findByRole('button', { name: /documentos clínicos/i }));
    expect(onViewClinicalDocuments).toHaveBeenCalledTimes(1);

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
    fireEvent.click(await screen.findByRole('button', { name: /solicitud exámenes/i }));
    expect(onViewExamRequest).toHaveBeenCalledTimes(1);

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
    fireEvent.click(await screen.findByRole('button', { name: /solicitud de imágenes/i }));
    expect(onViewImagingRequest).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard opening and arrow navigation across actions', async () => {
    renderSinglePatientRowOrbitalQuickActions({
      showMedicalIndicationsAction: true,
    });

    const trigger = await screen.findByRole('button', { name: /acciones clínicas rápidas/i });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const documentsButton = await screen.findByRole('button', { name: /documentos clínicos/i });
    await waitFor(() => {
      expect(documentsButton).toHaveFocus();
    });

    fireEvent.keyDown(documentsButton, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /solicitud exámenes/i })).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByRole('button', { name: /solicitud exámenes/i }), {
      key: 'Escape',
    });

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /documentos clínicos/i })
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('closes when clicking the invisible backdrop', async () => {
    renderSinglePatientRowOrbitalQuickActions({
      showExamRequestAction: false,
      showImagingRequestAction: false,
    });

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
    expect(await screen.findByRole('button', { name: /documentos clínicos/i })).toBeInTheDocument();

    const backdrop = document.querySelector('.fixed.inset-0.z-\\[38\\]');
    if (!backdrop) {
      throw new Error('Backdrop not found');
    }
    fireEvent.click(backdrop);

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /documentos clínicos/i })
      ).not.toBeInTheDocument();
    });
  });

  it('renders the quick actions as a vertical column below the honu', async () => {
    renderSinglePatientRowOrbitalQuickActions({
      showMedicalIndicationsAction: true,
    });

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));

    const documentsButton = await screen.findByRole('button', { name: /documentos clínicos/i });
    const laboratoryButton = screen.getByRole('button', { name: /solicitud exámenes/i });
    const imagingButton = screen.getByRole('button', { name: /solicitud de imágenes/i });
    const indicationsButton = screen.getByRole('button', { name: /indicaciones médicas/i });

    expect(documentsButton).toHaveTextContent('Documentos');
    expect(laboratoryButton).toHaveTextContent('Laboratorio');
    expect(imagingButton).toHaveTextContent('Imágenes');
    expect(indicationsButton).toHaveTextContent('Indicaciones');

    const stack = documentsButton.parentElement!.parentElement!;
    expect(stack.className).toContain('flex-col');
    expect(stack).toHaveStyle({
      marginLeft: `-${resolveActionStackHorizontalShift({
        actionRowWidth: ACTION_ROW_WIDTH,
        preferredShift: ACTION_STACK_HORIZONTAL_SHIFT,
        wrapperLeft: 8,
        wrapperWidth: 158,
      })}px`,
    });

    const wrapperDivs = Array.from(stack.children);
    expect(wrapperDivs).toHaveLength(4);

    const buttonsInOrder = wrapperDivs.map(wrapper => wrapper.querySelector('button'));
    expect(buttonsInOrder).toEqual([
      documentsButton,
      laboratoryButton,
      imagingButton,
      indicationsButton,
    ]);
  });

  it('keeps the open menu fully visible on narrow screens', () => {
    const shift = resolveActionStackHorizontalShift({
      actionRowWidth: ACTION_ROW_WIDTH,
      preferredShift: ACTION_STACK_HORIZONTAL_SHIFT,
      wrapperLeft: 8,
      wrapperWidth: 158,
    });

    expect(shift).toBe(14);
  });

  it('uses the preferred left offset when the viewport has enough room', () => {
    const shift = resolveActionStackHorizontalShift({
      actionRowWidth: ACTION_ROW_WIDTH,
      preferredShift: ACTION_STACK_HORIZONTAL_SHIFT,
      wrapperLeft: 220,
      wrapperWidth: 158,
    });

    expect(shift).toBe(ACTION_STACK_HORIZONTAL_SHIFT);
  });

  it('action buttons show cursor pointer across entire area', async () => {
    renderSinglePatientRowOrbitalQuickActions();

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));

    const documentsButton = await screen.findByRole('button', { name: /documentos clínicos/i });
    const examButton = screen.getByRole('button', { name: /solicitud exámenes/i });
    const imagingButton = screen.getByRole('button', { name: /solicitud de imágenes/i });

    for (const button of [documentsButton, examButton, imagingButton]) {
      expect(button.className).toContain('cursor-pointer');
    }
  });

  it('backdrop does not intercept clicks on action buttons', async () => {
    renderSinglePatientRowOrbitalQuickActions({
      showImagingRequestAction: false,
    });

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
    await screen.findByRole('button', { name: /documentos clínicos/i });

    const outerWrapper = document.querySelector('.pointer-events-none.fixed.z-\\[39\\]');
    expect(outerWrapper).toBeTruthy();
    expect(outerWrapper!.className).toContain('pointer-events-none');

    const actionContainer = document.querySelector('.pointer-events-auto.absolute');
    expect(actionContainer).toBeTruthy();
    expect(actionContainer!.className).toContain('pointer-events-auto');
  });

  it('does not leak quick-action button clicks to document listeners', async () => {
    const documentClick = vi.fn();
    document.addEventListener('click', documentClick);
    const onViewMedicalIndications = vi.fn();

    renderSinglePatientRowOrbitalQuickActions({
      showMedicalIndicationsAction: true,
      onViewMedicalIndications,
    });

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /acciones clínicas rápidas/i }));
    documentClick.mockClear();

    fireEvent.click(await screen.findByRole('button', { name: /indicaciones médicas/i }));

    expect(onViewMedicalIndications).toHaveBeenCalledTimes(1);
    expect(documentClick).not.toHaveBeenCalled();

    document.removeEventListener('click', documentClick);
  });

  it('resets hover state when tab loses visibility', async () => {
    renderSinglePatientRowOrbitalQuickActions();

    fireEvent.mouseMove(screen.getByTestId('patient-row'), { clientX: 0 });

    await waitFor(() => {
      const trigger = screen.getByRole('button', { name: /acciones clínicas rápidas/i });
      expect(trigger.className).toContain('opacity-100');
    });

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      const triggers = screen.queryAllByRole('button', { name: /acciones clínicas rápidas/i });
      const visibleTriggers = triggers.filter(t => t.className.includes('opacity-100'));
      expect(visibleTriggers).toHaveLength(0);
    });

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
});
