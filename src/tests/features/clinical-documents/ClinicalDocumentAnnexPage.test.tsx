import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/clinical-documents/components/ClinicalDocumentRichTextEditor', () => ({
  ClinicalDocumentRichTextEditor: ({
    value,
    disabled,
    onChange,
  }: {
    value: string;
    disabled?: boolean;
    onChange: (next: string) => void;
  }) => (
    <textarea
      data-testid="rich-text-editor"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

import { ClinicalDocumentAnnexPage } from '@/features/clinical-documents/components/ClinicalDocumentAnnexPage';

const baseProps = {
  content: '<p>initial</p>',
  canEdit: true,
  isLocked: false,
  patientName: 'Paciente Test',
  currentDateLabel: 'lunes 17 de abril de 2026',
  includedInGlobalPrint: true,
  onChange: vi.fn(),
  onToggleIncludedInGlobalPrint: vi.fn(),
  onPrintAnnex: vi.fn(),
  onClear: vi.fn(),
};

describe('ClinicalDocumentAnnexPage', () => {
  it('renders patient, date label, and editor value', () => {
    render(<ClinicalDocumentAnnexPage {...baseProps} />);

    expect(screen.getByText('Paciente Test')).toBeInTheDocument();
    expect(screen.getByText(/lunes 17 de abril de 2026/)).toBeInTheDocument();
    expect(screen.getByTestId('rich-text-editor')).toHaveValue('<p>initial</p>');
  });

  it('falls back to a non-empty today label when currentDateLabel is missing', () => {
    render(<ClinicalDocumentAnnexPage {...baseProps} currentDateLabel="" />);

    const fechaMetaItem = screen
      .getAllByText((_, node) => node?.textContent?.startsWith('Fecha:') ?? false)
      .find(node => node.classList?.contains('clinical-document-annex-meta-item'));

    expect(fechaMetaItem).toBeTruthy();
    expect(fechaMetaItem!.textContent!.replace(/^Fecha:\s*/, '').trim().length).toBeGreaterThan(0);
  });

  it('propagates print-inclusion toggle and print button click', () => {
    const onToggleIncludedInGlobalPrint = vi.fn();
    const onPrintAnnex = vi.fn();

    render(
      <ClinicalDocumentAnnexPage
        {...baseProps}
        onToggleIncludedInGlobalPrint={onToggleIncludedInGlobalPrint}
        onPrintAnnex={onPrintAnnex}
      />
    );

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onToggleIncludedInGlobalPrint).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByLabelText('Imprimir solo anexo'));
    expect(onPrintAnnex).toHaveBeenCalledTimes(1);
  });

  it('reveals delete controls on title double-click, confirms clear, and resets state', () => {
    const onClear = vi.fn();
    render(<ClinicalDocumentAnnexPage {...baseProps} onClear={onClear} />);

    expect(screen.getByText('Anexo del documento')).toBeInTheDocument();
    expect(screen.getByText('Pertenece solo a este documento')).toBeInTheDocument();

    const title = screen.getByText('Anexo del documento').closest('div[title]') as HTMLElement;
    fireEvent.doubleClick(title);

    const deleteButton = screen.getByTitle('Eliminar anexo del documento');
    fireEvent.click(deleteButton);

    expect(screen.getByText('¿Eliminar anexo del documento?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sí, eliminar'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('¿Eliminar anexo del documento?')).not.toBeInTheDocument();
  });

  it('allows cancelling the delete confirmation', () => {
    const onClear = vi.fn();
    render(<ClinicalDocumentAnnexPage {...baseProps} onClear={onClear} />);

    fireEvent.doubleClick(
      screen.getByText('Anexo del documento').closest('div[title]') as HTMLElement
    );
    fireEvent.click(screen.getByTitle('Eliminar anexo del documento'));
    expect(screen.getByText('¿Eliminar anexo del documento?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('No'));

    expect(onClear).not.toHaveBeenCalled();
    expect(screen.queryByText('¿Eliminar anexo del documento?')).not.toBeInTheDocument();
  });

  it('hides delete controls immediately via the cancel (X) button before confirming', () => {
    render(<ClinicalDocumentAnnexPage {...baseProps} />);

    fireEvent.doubleClick(
      screen.getByText('Anexo del documento').closest('div[title]') as HTMLElement
    );
    fireEvent.click(screen.getByTitle('Cancelar'));

    expect(screen.queryByTitle('Eliminar anexo del documento')).not.toBeInTheDocument();
  });

  it('does not reveal delete controls when the user cannot edit', () => {
    render(<ClinicalDocumentAnnexPage {...baseProps} canEdit={false} />);

    fireEvent.doubleClick(screen.getByText('Anexo del documento').closest('div') as HTMLElement);

    expect(screen.queryByTitle('Eliminar anexo del documento')).not.toBeInTheDocument();
  });

  it('does not reveal delete controls when the document is locked', () => {
    render(<ClinicalDocumentAnnexPage {...baseProps} isLocked />);

    fireEvent.doubleClick(screen.getByText('Anexo del documento').closest('div') as HTMLElement);

    expect(screen.queryByTitle('Eliminar anexo del documento')).not.toBeInTheDocument();
  });

  it('forwards editor changes via onChange', () => {
    const onChange = vi.fn();
    render(<ClinicalDocumentAnnexPage {...baseProps} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('rich-text-editor'), {
      target: { value: '<p>updated</p>' },
    });

    expect(onChange).toHaveBeenCalledWith('<p>updated</p>');
  });
});
