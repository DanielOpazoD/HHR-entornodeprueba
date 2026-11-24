import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChecklistTemplateEditor } from '@/features/clinical-library/components/tools/ChecklistTemplateEditor';
import type { ChecklistTemplate } from '@/services/clinical-checklists/checklistService';
const save = vi.hoisted(() => vi.fn(async (data: { template: ChecklistTemplate }) => data));
vi.mock('@/services/clinical-checklists/checklistService', () => ({ clinicalChecklist: save }));

it('conserva la dependencia al renombrar una opción y la retira si se elimina el campo', async () => {
  const template: ChecklistTemplate = {
    id: 'ejemplo',
    version: 1,
    title: 'Prueba',
    fields: [
      {
        id: 'primero',
        label: 'Control',
        type: 'choice',
        required: true,
        options: [{ label: 'Sí' }, { label: 'No' }],
      },
      {
        id: 'detalle',
        label: 'Motivo',
        type: 'text',
        required: false,
        requiredWhen: { field: 'primero', equals: 'Sí' },
      },
    ],
  };
  render(<ChecklistTemplateEditor initial={template} onSaved={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Opción 1'), { target: { value: 'Cumple' } });
  expect(screen.getByLabelText('Exigir respuesta si')).toHaveValue(
    JSON.stringify({ field: 'primero', equals: 'Cumple' })
  );
  fireEvent.click(screen.getAllByRole('button', { name: /^Quitar$/ })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar plantilla' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].template.fields).toEqual([
    { ...template.fields[1], requiredWhen: null },
  ]);
});
