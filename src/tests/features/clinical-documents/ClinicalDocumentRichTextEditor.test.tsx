import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentRichTextEditor } from '@/features/clinical-documents/components/ClinicalDocumentRichTextEditor';

vi.mock('@/features/clinical-documents/components/ClinicalDocumentImageEditor', () => ({
  ClinicalDocumentImageEditor: ({
    onUpdate,
    onClose,
  }: {
    onUpdate: () => void;
    onClose: () => void;
  }) => (
    <div>
      <button type="button" onClick={onUpdate}>
        aplicar imagen
      </button>
      <button type="button" onClick={onClose}>
        cerrar imagen
      </button>
    </div>
  ),
}));

describe('ClinicalDocumentRichTextEditor', () => {
  it.each([
    { delay: 0, modifier: 'Control', ctrlKey: true, metaKey: false },
    { delay: 520, modifier: 'Control', ctrlKey: true, metaKey: false },
    { delay: 0, modifier: 'Command', ctrlKey: false, metaKey: true },
    { delay: 520, modifier: 'Command', ctrlKey: false, metaKey: true },
  ])(
    'undoes and redoes the first edit in an empty section ($modifier, $delay ms)',
    ({ delay, ctrlKey, metaKey }) => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const ControlledEditor = () => {
        const [value, setValue] = useState('');
        return (
          <ClinicalDocumentRichTextEditor
            sectionId="antecedentes"
            sectionTitle="Antecedentes"
            value={value}
            onChange={nextValue => {
              setValue(nextValue);
              onChange(nextValue);
            }}
          />
        );
      };
      const { unmount } = render(<ControlledEditor />);
      try {
        const editor = screen.getByRole('textbox', { name: /contenido antecedentes/i });
        expect(editor.innerHTML).toBe('');
        act(() => {
          editor.focus();
        });

        editor.innerHTML = 'Primera edición';
        fireEvent.input(editor);
        expect(onChange).toHaveBeenLastCalledWith('Primera edición');
        act(() => {
          vi.advanceTimersByTime(delay);
        });

        fireEvent.keyDown(editor, { key: 'z', ctrlKey, metaKey });
        expect(editor.innerHTML).toBe('');
        expect(onChange).toHaveBeenLastCalledWith('');

        fireEvent.keyDown(editor, { key: 'z', ctrlKey, metaKey, shiftKey: true });
        expect(editor.innerHTML).toBe('Primera edición');
        expect(onChange).toHaveBeenLastCalledWith('Primera edición');
      } finally {
        unmount();
        vi.useRealTimers();
      }
    }
  );

  it('keeps the focused editor content stable until blur when an external value arrives', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ClinicalDocumentRichTextEditor
        sectionId="analisis"
        sectionTitle="Análisis"
        value="Inicial"
        onChange={onChange}
      />
    );

    const editor = screen.getByRole('textbox', { name: /contenido análisis/i });

    await waitFor(() => {
      expect(editor.innerHTML).toBe('Inicial');
    });

    editor.focus();
    expect(document.activeElement).toBe(editor);
    rerender(
      <ClinicalDocumentRichTextEditor
        sectionId="analisis"
        sectionTitle="Análisis"
        value="Actualizado externamente"
        onChange={onChange}
      />
    );

    expect(editor.innerHTML).toBe('Inicial');

    fireEvent.blur(editor);

    await waitFor(() => {
      expect(editor.innerHTML).toBe('Actualizado externamente');
    });
  });

  it('commits image edits through the same editor mutation pipeline', async () => {
    const onChange = vi.fn();
    render(
      <ClinicalDocumentRichTextEditor
        sectionId="analisis"
        sectionTitle="Análisis"
        value={'<img src="x" alt="grafico">'}
        onChange={onChange}
      />
    );

    const editor = screen.getByRole('textbox', { name: /contenido análisis/i });

    await waitFor(() => {
      expect(editor.querySelector('img')).not.toBeNull();
    });

    const image = editor.querySelector('img') as HTMLImageElement;
    fireEvent.click(image);
    image.style.marginLeft = '24px';

    fireEvent.click(screen.getByRole('button', { name: /aplicar imagen/i }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('margin-left: 24px'));
    });
  });

  it('normalises pasted Word-like HTML through the shared editor pipeline', async () => {
    const onChange = vi.fn();
    render(
      <ClinicalDocumentRichTextEditor
        sectionId="analisis"
        sectionTitle="Análisis"
        value=""
        onChange={onChange}
      />
    );

    const editor = screen.getByRole('textbox', { name: /contenido análisis/i });
    editor.focus();

    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => {
          if (type === 'text/html') {
            return '<!--StartFragment--><p class="MsoNormal">Informe<o:p></o:p></p><!--EndFragment-->';
          }
          if (type === 'text/plain') {
            return 'Informe';
          }
          return '';
        },
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('Informe'));
    });

    expect(editor.innerHTML).not.toContain('MsoNormal');
    expect(editor.innerHTML).not.toContain('o:p');
  });

  it('merges soft-wrapped PDF text and keeps report headings separated on paste', async () => {
    const onChange = vi.fn();
    render(
      <ClinicalDocumentRichTextEditor
        sectionId="analisis"
        sectionTitle="Análisis"
        value=""
        onChange={onChange}
      />
    );

    const editor = screen.getByRole('textbox', { name: /contenido análisis/i });
    editor.focus();

    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => {
          if (type === 'text/plain') {
            return 'Hallazgos radiológicos\ndescritos en detalle.\n\nCONCLUSIÓN:\nSin derrame pleural.';
          }
          return '';
        },
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        'Hallazgos radiológicos descritos en detalle.<br><br>CONCLUSIÓN:<br>Sin derrame pleural.'
      );
    });
  });
});
