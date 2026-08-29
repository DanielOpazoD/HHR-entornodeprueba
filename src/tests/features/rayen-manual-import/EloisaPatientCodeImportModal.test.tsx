import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EloisaPatientCodeImportModal } from '@/features/rayen-manual-import/components/EloisaPatientCodeImportModal';
import {
  createEloisaPatientCode,
  type EloisaManualPatientPayload,
} from '@/features/rayen-manual-import/domain/eloisaPatientCode';

const payload: EloisaManualPatientPayload = {
  version: 1,
  capturedAt: new Date().toISOString(),
  encounterId: '98765',
  firstName: 'José',
  middleNames: 'Ángel',
  lastName: 'Muñoz',
  secondLastName: 'Rapa Nui',
  rut: '12.345.678-5',
  birthDate: '1980-05-04',
  biologicalSex: 'Masculino',
  admissionDate: '2026-08-28',
  admissionTime: '06:35',
  diagnosis: 'Neumonía',
  devices: ['VVP'],
};

describe('EloisaPatientCodeImportModal', () => {
  it('requires validation and an explicit bed selection before one confirmed write', async () => {
    const onConfirm = vi.fn().mockResolvedValue(null);
    render(
      <EloisaPatientCodeImportModal
        isOpen
        emptyBeds={[{ id: 'H3C1', label: 'H3C1' }]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    const confirm = screen.getByRole('button', { name: /confirmar ingreso/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/código copiado/i), {
      target: { value: await createEloisaPatientCode(payload) },
    });
    fireEvent.click(screen.getByRole('button', { name: /validar y revisar/i }));

    expect(await screen.findByText('José Ángel Muñoz Rapa Nui')).toBeInTheDocument();
    expect(screen.getByText('Neumonía')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/cama de destino/i), { target: { value: 'H3C1' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(payload, 'H3C1');
  });

  it('rejects an invalid RUT and never enables confirmation', async () => {
    render(
      <EloisaPatientCodeImportModal
        isOpen
        emptyBeds={[{ id: 'H3C1', label: 'H3C1' }]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/código copiado/i), {
      target: { value: await createEloisaPatientCode({ ...payload, rut: '12.345.678-9' }) },
    });
    fireEvent.click(screen.getByRole('button', { name: /validar y revisar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/RUT.*no es válido/i);
    expect(screen.getByRole('button', { name: /confirmar ingreso/i })).toBeDisabled();
  });

  it('rejects an expired code before enabling confirmation', async () => {
    render(
      <EloisaPatientCodeImportModal
        isOpen
        emptyBeds={[{ id: 'H3C1', label: 'H3C1' }]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/código copiado/i), {
      target: {
        value: await createEloisaPatientCode({
          ...payload,
          capturedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /validar y revisar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/código venció/i);
    expect(screen.getByRole('button', { name: /confirmar ingreso/i })).toBeDisabled();
  });

  it('cannot restore a stale validation result after the pasted code changes', async () => {
    const firstCode = await createEloisaPatientCode(payload);
    const secondCode = await createEloisaPatientCode({ ...payload, encounterId: '98766' });
    render(
      <EloisaPatientCodeImportModal
        isOpen
        emptyBeds={[{ id: 'H3C1', label: 'H3C1' }]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    const input = screen.getByLabelText(/código copiado/i);
    fireEvent.change(input, { target: { value: firstCode } });
    fireEvent.click(screen.getByRole('button', { name: /validar y revisar/i }));
    fireEvent.change(input, { target: { value: secondCode } });

    await vi.waitFor(() => expect(input).toHaveValue(secondCode));
    expect(screen.queryByLabelText('Vista previa del paciente')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar ingreso/i })).toBeDisabled();
  });

  it('rechecks expiry at confirmation and performs no write after the code expires', async () => {
    const capturedAt = Date.parse(payload.capturedAt);
    const now = vi.spyOn(Date, 'now').mockReturnValue(capturedAt + 11 * 60 * 60 * 1000);
    const onConfirm = vi.fn();
    render(
      <EloisaPatientCodeImportModal
        isOpen
        emptyBeds={[{ id: 'H3C1', label: 'H3C1' }]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    fireEvent.change(screen.getByLabelText(/código copiado/i), {
      target: { value: await createEloisaPatientCode(payload) },
    });
    fireEvent.click(screen.getByRole('button', { name: /validar y revisar/i }));
    expect(await screen.findByText('José Ángel Muñoz Rapa Nui')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/cama de destino/i), { target: { value: 'H3C1' } });

    now.mockReturnValue(capturedAt + 13 * 60 * 60 * 1000);
    fireEvent.click(screen.getByRole('button', { name: /confirmar ingreso/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/código venció/i);
    expect(onConfirm).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('recovers after an unexpected admission failure and allows retrying', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('offline'));
    render(
      <EloisaPatientCodeImportModal
        isOpen
        emptyBeds={[{ id: 'H3C1', label: 'H3C1' }]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    fireEvent.change(screen.getByLabelText(/código copiado/i), {
      target: { value: await createEloisaPatientCode(payload) },
    });
    fireEvent.click(screen.getByRole('button', { name: /validar y revisar/i }));
    expect(await screen.findByText('José Ángel Muñoz Rapa Nui')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/cama de destino/i), { target: { value: 'H3C1' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar ingreso/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo guardar/i);
    expect(screen.getByRole('button', { name: /confirmar ingreso/i })).toBeEnabled();
  });
});
