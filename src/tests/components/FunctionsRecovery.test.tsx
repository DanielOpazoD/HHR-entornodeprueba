import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FunctionsRecovery } from '@/components/ui/FunctionsRecovery';

const { attempted } = vi.hoisted(() => ({ attempted: vi.fn() }));
vi.mock('@/components/ui/FunctionsRecoveryNotice', () => {
  attempted();
  throw new TypeError('Failed to fetch dynamically imported module: /notice.js');
});

it('keeps the editable app available when the optional recovery notice cannot load', async () => {
  const { container } = render(
    <>
      <FunctionsRecovery />
      <input aria-label="Borrador" defaultValue="Edición pendiente" />
    </>
  );
  const draft = screen.getByRole('textbox');
  await waitFor(() => expect(attempted).toHaveBeenCalled());
  await waitFor(() => expect(container.children).toHaveLength(1));
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('Edición pendiente');
});
