import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExamRequestModal } from '@/components/modals/ExamRequestModal';
import { AuthContext, type AuthContextType } from '@/context/AuthContext';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { PatientData } from '@/types/domain/patient';

const loadSignature = vi.hoisted(() => vi.fn());
vi.mock('@/services/user-profile/userSignatureService', () => ({
  userSignatureService: { load: loadSignature },
}));
vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));

const patient = {
  bedId: 'bed-1',
  patientName: 'Paciente Sintetico',
  rut: '11.111.111-1',
  insurance: 'Fonasa',
} as PatientData;

const renderAs = (uid: string | null) =>
  render(
    <AuthContext.Provider
      value={{ currentUser: uid ? { uid } : null } as unknown as AuthContextType}
    >
      <ExamRequestModal isOpen={true} onClose={vi.fn()} patient={patient} />
    </AuthContext.Provider>
  );

/** The FIRMA row of the printed form: its label and the line next to it. */
const signatureRow = () => screen.getByText('FIRMA:').parentElement as HTMLElement;

describe('Lab request signature', () => {
  const createObjectURL = vi.fn(() => 'blob:firma-sintetica');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });
  afterEach(() => {
    cleanup();
  });

  it("prints the signed-in person's own signature on the FIRMA line", async () => {
    loadSignature.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderAs('firmante-1');

    const image = await within(signatureRow()).findByRole('img', { name: 'Firma' });
    expect(image).toHaveAttribute('src', 'blob:firma-sintetica');
    expect(loadSignature).toHaveBeenCalledWith('firmante-1');
    // Only the FIRMA line carries it, not OTROS or MÉDICO TRATANTE.
    expect(screen.getAllByRole('img', { name: 'Firma' })).toHaveLength(1);
  });

  it('leaves the line blank when the person has no signature, or nobody is signed in', async () => {
    loadSignature.mockResolvedValue(null);
    renderAs('sin-firma');
    await waitFor(() => expect(loadSignature).toHaveBeenCalledWith('sin-firma'));
    expect(within(signatureRow()).queryByRole('img')).not.toBeInTheDocument();
    cleanup();

    renderAs(null);
    expect(within(signatureRow()).queryByRole('img')).not.toBeInTheDocument();
    expect(loadSignature).toHaveBeenCalledTimes(1);
  });

  it('says so when the signature cannot be read, and prints the line blank', async () => {
    loadSignature.mockRejectedValue({ code: 'storage/unknown' });
    renderAs('firmante-1');

    expect(await screen.findByRole('status')).toHaveTextContent('No se pudo cargar su firma');
    expect(within(signatureRow()).queryByRole('img')).not.toBeInTheDocument();
  });

  it('forgets the signature as soon as the session changes, and revokes its URL', async () => {
    loadSignature.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    loadSignature.mockReturnValue(new Promise(() => {}));
    renderAs('firmante-1');
    await within(signatureRow()).findByRole('img', { name: 'Firma' });

    act(() => setSessionGeneration(`gen-${Date.now()}`));

    expect(within(signatureRow()).queryByRole('img')).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:firma-sintetica');
  });
});
