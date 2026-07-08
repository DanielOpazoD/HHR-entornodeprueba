import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentIndicationsItems } from '@/features/clinical-documents/components/ClinicalDocumentIndicationsItems';

describe('ClinicalDocumentIndicationsItems', () => {
  it('lets the editor blur normally before inserting a saved indication', () => {
    const onInsertIndication = vi.fn();

    render(
      <ClinicalDocumentIndicationsItems
        items={[{ id: 'item-1', text: 'Reposo relativo', source: 'custom' }]}
        canEdit={true}
        isSavingCustomIndication={false}
        editingItemId={null}
        editingText=""
        onChangeEditingText={vi.fn()}
        onInsertIndication={onInsertIndication}
        onStartEditing={vi.fn()}
        onSaveEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onDeleteIndication={vi.fn()}
      />
    );

    const insertButton = screen.getByRole('button', { name: /^Reposo relativo$/i });
    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    insertButton.dispatchEvent(mouseDownEvent);

    expect(mouseDownEvent.defaultPrevented).toBe(false);

    fireEvent.click(insertButton);

    expect(onInsertIndication).toHaveBeenCalledWith('Reposo relativo');
  });
});
