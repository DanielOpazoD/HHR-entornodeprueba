import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAs } from 'file-saver';
import { AuthContext, type AuthContextType } from '@/context/AuthContext';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { ClinicalFormTool } from '@/features/clinical-library/components/tools/ClinicalFormTool';
const mocks = vi.hoisted(() => ({ load: vi.fn(), pdf: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
vi.mock('@/context/DailyRecordContext', () => ({ useDailyRecordData: () => ({ record: null }) }));
vi.mock('@/services/user-profile/userSignatureService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/user-profile/userSignatureService')>()),
  userSignatureService: { load: mocks.load },
}));
vi.mock('@/features/clinical-library/services/sicFormPdf', () => ({
  generateSicFormPdf: mocks.pdf,
}));
const Wrapper = ({ uid }: { uid: string }) => (
  <AuthContext.Provider value={{ currentUser: { uid } } as unknown as AuthContextType}>
    <ClinicalFormTool
      patients={[]}
      formId="solicitud-interconsulta-hhr"
      onFormChange={vi.fn()}
      onBack={vi.fn()}
      onClose={vi.fn()}
    />
  </AuthContext.Provider>
);
describe('SIC session boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.load.mockResolvedValue(null);
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });
  it.each(['uid', 'epoch'] as const)(
    'drops patient draft, signature and pending export on %s change',
    async change => {
      let finish!: (bytes: Uint8Array) => void;
      mocks.pdf.mockImplementation(
        () =>
          new Promise<Uint8Array>(resolve => {
            finish = resolve;
          })
      );
      const view = render(<Wrapper uid="first" />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'PDF imprimible' })).toBeEnabled()
      );
      fireEvent.change(screen.getByLabelText('Nombre completo (si no hay nombres separados)'), {
        target: { value: 'PACIENTE SINTÉTICO' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'PDF imprimible' }));
      await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
      if (change === 'uid') view.rerender(<Wrapper uid="second" />);
      else act(() => setSessionGeneration(`sic-test-${change}`));
      expect(screen.getByLabelText('Nombre completo (si no hay nombres separados)')).toHaveValue(
        ''
      );
      await act(async () => finish(new Uint8Array([37, 80, 68, 70])));
      expect(saveAs).not.toHaveBeenCalled();
      expect(screen.queryByTitle(/PDF para imprimir/)).not.toBeInTheDocument();
    }
  );
});
