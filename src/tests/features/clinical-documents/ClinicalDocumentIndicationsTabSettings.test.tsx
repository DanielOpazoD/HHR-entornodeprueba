import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentIndicationsTabSettings } from '@/features/clinical-documents/components/ClinicalDocumentIndicationsTabSettings';

const tabs = [
  { id: 'general', label: 'General', items: [] },
  { id: 'farmacos', label: 'Fármacos', items: [] },
];

describe('ClinicalDocumentIndicationsTabSettings', () => {
  it('asks for confirmation before deleting a personal indications tab', () => {
    const onDeleteTab = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <ClinicalDocumentIndicationsTabSettings
        tabs={tabs}
        canEdit={true}
        isSavingCustomIndication={false}
        newTabLabel=""
        editingTabId={null}
        editingTabLabel=""
        onChangeNewTabLabel={vi.fn()}
        onCreateTab={vi.fn()}
        onStartEditingTab={vi.fn()}
        onChangeEditingTabLabel={vi.fn()}
        onSaveTab={vi.fn()}
        onCancelEditingTab={vi.fn()}
        onDeleteTab={onDeleteTab}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /eliminar pestaña fármacos/i }));

    expect(confirmSpy).toHaveBeenCalledWith(
      '¿Eliminar la pestaña "Fármacos" y sus indicaciones guardadas? Esta acción no se puede deshacer.'
    );
    expect(onDeleteTab).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /eliminar pestaña fármacos/i }));

    expect(onDeleteTab).toHaveBeenCalledWith('farmacos');

    confirmSpy.mockRestore();
  });

  it('keeps create, rename and delete tab actions explicit and testable', () => {
    const onCreateTab = vi.fn();
    const onStartEditingTab = vi.fn();
    const onSaveTab = vi.fn();
    const onCancelEditingTab = vi.fn();
    const onDeleteTab = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { rerender } = render(
      <ClinicalDocumentIndicationsTabSettings
        tabs={tabs}
        canEdit={true}
        isSavingCustomIndication={false}
        newTabLabel=""
        editingTabId={null}
        editingTabLabel=""
        onChangeNewTabLabel={vi.fn()}
        onCreateTab={onCreateTab}
        onStartEditingTab={onStartEditingTab}
        onChangeEditingTabLabel={vi.fn()}
        onSaveTab={onSaveTab}
        onCancelEditingTab={onCancelEditingTab}
        onDeleteTab={onDeleteTab}
      />
    );

    expect(screen.getByRole('button', { name: /crear pestaña de indicaciones/i })).toBeDisabled();

    rerender(
      <ClinicalDocumentIndicationsTabSettings
        tabs={tabs}
        canEdit={true}
        isSavingCustomIndication={false}
        newTabLabel="Post operatorio"
        editingTabId={null}
        editingTabLabel=""
        onChangeNewTabLabel={vi.fn()}
        onCreateTab={onCreateTab}
        onStartEditingTab={onStartEditingTab}
        onChangeEditingTabLabel={vi.fn()}
        onSaveTab={onSaveTab}
        onCancelEditingTab={onCancelEditingTab}
        onDeleteTab={onDeleteTab}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /crear pestaña de indicaciones/i }));
    fireEvent.click(screen.getByRole('button', { name: /renombrar pestaña general/i }));
    fireEvent.click(screen.getByRole('button', { name: /eliminar pestaña fármacos/i }));

    expect(onCreateTab).toHaveBeenCalledTimes(1);
    expect(onStartEditingTab).toHaveBeenCalledWith(tabs[0]);
    expect(onDeleteTab).toHaveBeenCalledWith('farmacos');

    confirmSpy.mockRestore();
  });

  it('renders save and cancel actions when a tab is being renamed', () => {
    const onSaveTab = vi.fn();
    const onCancelEditingTab = vi.fn();

    render(
      <ClinicalDocumentIndicationsTabSettings
        tabs={tabs}
        canEdit={true}
        isSavingCustomIndication={false}
        newTabLabel=""
        editingTabId="general"
        editingTabLabel="General alta"
        onChangeNewTabLabel={vi.fn()}
        onCreateTab={vi.fn()}
        onStartEditingTab={vi.fn()}
        onChangeEditingTabLabel={vi.fn()}
        onSaveTab={onSaveTab}
        onCancelEditingTab={onCancelEditingTab}
        onDeleteTab={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /guardar nombre de pestaña general/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancelar edición de pestaña general/i }));

    expect(onSaveTab).toHaveBeenCalledWith('general');
    expect(onCancelEditingTab).toHaveBeenCalledTimes(1);
  });
});
