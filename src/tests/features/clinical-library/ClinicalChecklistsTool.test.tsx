import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ClinicalChecklistsTool } from '@/features/clinical-library/components/tools/ClinicalChecklistsTool';
const api = vi.hoisted(() => vi.fn());
const print = vi.hoisted(() => vi.fn(() => 'printed'));
vi.mock('@/services/clinical-checklists/checklistService', () => ({ clinicalChecklist: api }));
vi.mock('@/features/clinical-library/services/printHtmlDocument', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/features/clinical-library/services/printHtmlDocument')
  >()),
  printHtmlDocument: print,
}));

it('imprime la versión recuperada por código y retira el documento al cambiar la búsqueda', async () => {
  const code = 'PT-00000000-0000-4000-8000-000000000001';
  api.mockImplementation(async ({ action }) =>
    action === 'templates'
      ? { templates: [], manage: false }
      : {
          record: {
            code,
            template: { title: 'Registro de prueba', version: 2 },
            patient: { name: 'Persona de prueba', episode: '901', document: 'TEST-X' },
            evolution: 'Control <sintético> · ' + code,
          },
        }
  );
  render(<ClinicalChecklistsTool patients={[]} onClose={() => {}} onBack={() => {}} />);
  const input = screen.getByLabelText('Código de la evolución');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Verificar pauta' }));
  fireEvent.click(await screen.findByRole('button', { name: /Imprimir/ }));
  expect(api).toHaveBeenCalledWith({ action: 'get', code });
  expect(print.mock.calls[0]).toEqual([
    expect.objectContaining({
      body: expect.stringContaining('Control &lt;sintético&gt; · ' + code),
    }),
  ]);
  fireEvent.change(input, { target: { value: 'PT-' } });
  expect(screen.queryByRole('button', { name: /Imprimir/ })).toBeNull();
  expect(screen.queryByText('Configurar plantillas')).toBeNull();
});
