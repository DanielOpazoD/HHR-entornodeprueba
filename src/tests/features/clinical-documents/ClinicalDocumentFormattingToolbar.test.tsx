import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ClinicalDocumentFormattingToolbarProps } from '@/features/clinical-documents/components/ClinicalDocumentFormattingToolbar';
import { ClinicalDocumentFormattingToolbar } from '@/features/clinical-documents/components/ClinicalDocumentFormattingToolbar';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';

const selectedDocument = createClinicalDocumentDraft({
  templateId: 'epicrisis',
  hospitalId: 'hhr',
  actor: { uid: 'u1', email: 'a@b.cl', displayName: 'Test', role: 'admin' },
  episode: {
    patientRut: '11.111.111-1',
    patientName: 'Test',
    episodeKey: '11.111.111-1__2026-03-06',
    admissionDate: '2026-03-06',
    sourceDailyRecordDate: '2026-03-06',
    sourceBedId: 'R1',
    specialty: 'Medicina',
  },
  patientFieldValues: {},
  medico: 'Test',
  especialidad: 'Medicina',
});

/** Builds default props for the toolbar, allowing partial overrides. */
const buildProps = (
  overrides: Partial<ClinicalDocumentFormattingToolbarProps> = {}
): ClinicalDocumentFormattingToolbarProps => ({
  selectedDocument,
  canEdit: true,
  formattingDisabled: false,
  isFormattingOpen: false,
  canUndo: false,
  canRedo: false,
  onPrint: vi.fn(),
  onRestoreTemplate: vi.fn(),
  onToggleFormatting: vi.fn(),
  onApplyFormatting: vi.fn(),
  zoom: 100,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  ...overrides,
});

describe('ClinicalDocumentFormattingToolbar', () => {
  it('renders formatting actions and delegates commands when formatting is open', () => {
    const onPrint = vi.fn();
    const onRestoreTemplate = vi.fn();
    const onToggleFormatting = vi.fn();
    const onApplyFormatting = vi.fn();

    render(
      <ClinicalDocumentFormattingToolbar
        {...buildProps({
          isFormattingOpen: true,
          onPrint,
          onRestoreTemplate,
          onToggleFormatting,
          onApplyFormatting,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Formato' }));
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer plantilla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Negrita' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar formato' }));

    expect(screen.getByText('Formato de texto')).toBeInTheDocument();
    expect(screen.getByText('Listas y sangría')).toBeInTheDocument();
    expect(screen.getAllByText('Tablas y enlaces')).toHaveLength(1);
    expect(screen.queryByText('Imágenes y anexos')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Formato' }).closest('[data-formatting-open]')
    ).toHaveAttribute('data-formatting-open', 'true');
    expect(onToggleFormatting).toHaveBeenCalledTimes(1);
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onRestoreTemplate).toHaveBeenCalledTimes(1);
    expect(onApplyFormatting).toHaveBeenCalledWith('bold');
    expect(onApplyFormatting).toHaveBeenCalledWith('removeFormat');
  });

  // -----------------------------------------------------------------------
  // Undo / Redo
  // -----------------------------------------------------------------------

  it('dispatches undo/redo commands when buttons are clicked', () => {
    const onApplyFormatting = vi.fn();

    render(
      <ClinicalDocumentFormattingToolbar
        {...buildProps({ canUndo: true, canRedo: true, onApplyFormatting })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rehacer' }));

    expect(onApplyFormatting).toHaveBeenCalledWith('undo');
    expect(onApplyFormatting).toHaveBeenCalledWith('redo');
  });

  it('disables undo when canUndo is false', () => {
    render(
      <ClinicalDocumentFormattingToolbar {...buildProps({ canUndo: false, canRedo: true })} />
    );

    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rehacer' })).not.toBeDisabled();
  });

  it('disables redo when canRedo is false', () => {
    render(
      <ClinicalDocumentFormattingToolbar {...buildProps({ canUndo: true, canRedo: false })} />
    );

    expect(screen.getByRole('button', { name: 'Deshacer' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rehacer' })).toBeDisabled();
  });

  it('disables undo/redo when document is locked', () => {
    render(
      <ClinicalDocumentFormattingToolbar
        {...buildProps({
          selectedDocument: { ...selectedDocument, isLocked: true },
          canEdit: false,
          canUndo: true,
          canRedo: true,
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rehacer' })).toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // Zoom
  // -----------------------------------------------------------------------

  it('delegates zoom controls', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();

    render(<ClinicalDocumentFormattingToolbar {...buildProps({ onZoomIn, onZoomOut })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reducir zoom' }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('disables zoom out at minimum and zoom in at maximum', () => {
    const { rerender } = render(
      <ClinicalDocumentFormattingToolbar {...buildProps({ zoom: 60 })} />
    );

    expect(screen.getByRole('button', { name: 'Reducir zoom' })).toBeDisabled();

    rerender(<ClinicalDocumentFormattingToolbar {...buildProps({ zoom: 150 })} />);

    expect(screen.getByRole('button', { name: 'Aumentar zoom' })).toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // Disabled state
  // -----------------------------------------------------------------------

  it('disables controls when editing is unavailable', () => {
    render(
      <ClinicalDocumentFormattingToolbar
        {...buildProps({
          selectedDocument: { ...selectedDocument, isLocked: true },
          canEdit: false,
          formattingDisabled: true,
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Restablecer plantilla' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Formato' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rehacer' })).toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // Floating panel placement (regression: panel was clipped by the modal
  // header's overflow scroll container and never appeared on screen)
  // -----------------------------------------------------------------------

  it('portals the formatting panel to <body> with fixed positioning so it cannot be clipped', () => {
    const { container } = render(
      <ClinicalDocumentFormattingToolbar {...buildProps({ isFormattingOpen: true })} />
    );

    const panel = document.body.querySelector<HTMLElement>(
      '.clinical-document-global-toolbar-modal'
    );

    expect(panel).not.toBeNull();
    // Rendered outside the toolbar's own subtree (the render container), as a
    // direct child of <body>, so an ancestor's overflow can never hide it.
    expect(container.contains(panel)).toBe(false);
    expect(panel?.parentElement).toBe(document.body);
    expect(panel?.style.position).toBe('fixed');
  });

  it('does not render the formatting panel when closed', () => {
    render(<ClinicalDocumentFormattingToolbar {...buildProps({ isFormattingOpen: false })} />);

    expect(document.body.querySelector('.clinical-document-global-toolbar-modal')).toBeNull();
  });

  const mockButtonRect = (button: HTMLElement, rect: { bottom: number; right: number }) => {
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      bottom: rect.bottom,
      right: rect.right,
      top: rect.bottom - 20,
      left: rect.right - 50,
      width: 50,
      height: 20,
      x: rect.right - 50,
      y: rect.bottom - 20,
      toJSON: () => ({}),
    } as DOMRect);
  };

  it('anchors the panel under the button, clamps both edges, and bounds the height', () => {
    render(<ClinicalDocumentFormattingToolbar {...buildProps({ isFormattingOpen: true })} />);

    const button = screen.getByRole('button', { name: 'Formato' });
    const panel = document.body.querySelector<HTMLElement>(
      '.clinical-document-global-toolbar-modal'
    )!;
    // jsdom has no layout; give the panel a real width so clamping is exercised.
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: 220 });

    // Normal anchor: right edge aligned to the button (left = right - width).
    mockButtonRect(button, { bottom: 100, right: 300 });
    fireEvent(window, new Event('resize'));

    expect(panel.style.position).toBe('fixed');
    expect(panel.style.visibility).toBe('visible');
    expect(panel.style.top).toBe('108px');
    expect(panel.style.left).toBe('80px'); // 300 - 220
    expect(panel.style.right).toBe('auto');
    expect(panel.style.maxHeight).toBe(`${window.innerHeight - 116}px`); // viewport - top - margin

    // Button near the left edge: left is clamped to the viewport margin (not negative).
    mockButtonRect(button, { bottom: 100, right: 100 });
    fireEvent(window, new Event('resize'));
    expect(panel.style.left).toBe('8px');
  });

  it('inserts a table through the toolbar dialog', async () => {
    const onInsertHtml = vi.fn();

    render(
      <ClinicalDocumentFormattingToolbar
        {...buildProps({ onInsertHtml, isFormattingOpen: true })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Insertar tabla' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Insertar' }));

    await waitFor(() => {
      expect(onInsertHtml).toHaveBeenCalledTimes(1);
    });
    expect(onInsertHtml.mock.calls[0]?.[0]).toContain('<table');
  });

  it('inserts a link through the toolbar dialog', async () => {
    const onInsertHtml = vi.fn();

    render(
      <ClinicalDocumentFormattingToolbar
        {...buildProps({ onInsertHtml, isFormattingOpen: true })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Insertar enlace' }));
    fireEvent.change(await screen.findByLabelText('URL'), {
      target: { value: 'https://hospital.test/protocolo' },
    });
    fireEvent.change(screen.getByLabelText(/Texto visible/i), {
      target: { value: 'Protocolo local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Insertar' }));

    await waitFor(() => {
      expect(onInsertHtml).toHaveBeenCalledTimes(1);
    });
    expect(onInsertHtml.mock.calls[0]?.[0]).toContain('href="https://hospital.test/protocolo"');
    expect(onInsertHtml.mock.calls[0]?.[0]).toContain('Protocolo local');
  });
});
