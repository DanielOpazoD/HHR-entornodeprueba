import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PharmacyDisposalTool,
  PharmacyReturnTool,
} from '@/features/clinical-library/components/tools/pharmacy/PharmacyActTool';
import { ClinicalLibraryDrawer } from '@/features/clinical-library/components/ClinicalLibraryDrawer';
import { pharmacyProfileStorageKey } from '@/features/clinical-library/components/tools/pharmacy/pharmacyProfessionalProfile';

const { auth, generate, readIdentity } = vi.hoisted(() => ({
  auth: {
    currentUser: {
      uid: 'admin-a',
      displayName: 'Profesional A',
      email: 'test@example.invalid',
      role: 'admin',
    },
  },
  generate: vi.fn(),
  readIdentity: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/features/clinical-library/services/pharmacyActPdf', () => ({
  generatePharmacyActPdf: generate,
}));
vi.mock('@/context/DailyRecordContext', () => ({ useDailyRecordData: () => ({ record: null }) }));
vi.mock('@/services/user-profile/sessionProfessionalIdentity', () => ({
  readSessionProfessionalIdentity: readIdentity,
}));

const props = () => ({ onBack: vi.fn(), onClose: vi.fn(), patients: [], onDirtyChange: vi.fn() });
const fillProfessional = (): void => {
  fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Médico' } });
  fireEvent.change(screen.getByLabelText('RUT del responsable'), {
    target: { value: '12.345.678-5' },
  });
};
const selectParacetamol = (): void => {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar fármaco o insumo' }), {
    target: { value: 'paracetamol 500' },
  });
  fireEvent.click(screen.getByRole('button', { name: /PARACETAMOL COMPRIMIDO 500 MG/ }));
};

describe('pharmacy act tool', () => {
  beforeEach(() => {
    localStorage.clear();
    readIdentity.mockReset().mockReturnValue(null);
    auth.currentUser = {
      uid: 'admin-a',
      displayName: 'Profesional A',
      email: 'test@example.invalid',
      role: 'admin',
    };
    generate.mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:pharmacy-ui'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('prefills only the session name, selects an exact presentation, and prepares a PDF', async () => {
    render(<PharmacyReturnTool {...props()} />);
    expect(screen.getByLabelText('Nombre del responsable')).toHaveValue('Profesional A');
    expect(screen.getByLabelText('Cargo')).toHaveValue('');
    expect(screen.getByLabelText('RUT del responsable')).toHaveValue('');
    fillProfessional();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'metoclopramida' } });
    const options = within(
      screen.getByRole('list', { name: 'Resultados del arsenal, registro 1' })
    ).getAllByRole('button');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('COMPRIMIDO');
    expect(options[1]).toHaveTextContent('AMPOLLA');
    fireEvent.click(options[0]);
    expect(screen.getByText('METOCLOPRAMIDA COMPRIMIDO 10 MG')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Cantidad (comprimido)'), { target: { value: '2,5' } });
    fireEvent.change(screen.getByLabelText('Fundamento de la devolución'), {
      target: { value: 'Tratamiento suspendido' },
    });
    fireEvent.change(screen.getByLabelText('Paciente (opcional)'), {
      target: { value: 'Paciente sintético' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar mis datos en este equipo' }));
    const stored = localStorage.getItem(pharmacyProfileStorageKey('admin-a')) ?? '';
    expect(stored).toContain('Profesional A');
    expect(stored).not.toContain('Paciente sintético');
    expect(stored).not.toContain('METOCLOPRAMIDA');
    fireEvent.click(screen.getByRole('button', { name: 'Preparar vista previa' }));
    expect(await screen.findByTitle('Vista previa · Devolución de fármacos')).toHaveAttribute(
      'src',
      'blob:pharmacy-ui'
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        professional: expect.objectContaining({ role: 'Médico' }),
        lines: [
          expect.objectContaining({
            name: 'METOCLOPRAMIDA COMPRIMIDO 10 MG',
            presentation: 'COMPRIMIDO',
            quantity: '2,5',
          }),
        ],
      })
    );
    fireEvent.change(screen.getByLabelText('Cantidad (comprimido)'), { target: { value: '3' } });
    expect(screen.queryByTitle('Vista previa · Devolución de fármacos')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument();
  });

  it('supports multiple lines and explicit manual entry without treating it as official arsenal', () => {
    render(<PharmacyReturnTool {...props()} />);
    selectParacetamol();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar fármaco o insumo' }));
    const second = screen.getByRole('group', { name: 'Registro 2' });
    fireEvent.click(within(second).getByRole('button', { name: 'Ingresar fuera del arsenal' }));
    fireEvent.change(within(second).getByLabelText('Nombre del fármaco o insumo'), {
      target: { value: 'Insumo de prueba' },
    });
    fireEvent.change(within(second).getByLabelText('Presentación / unidad de cantidad'), {
      target: { value: 'Unidad' },
    });
    expect(within(second).getByText('Ingreso fuera del arsenal')).toBeInTheDocument();
    fireEvent.click(within(second).getByRole('button', { name: 'Eliminar registro 2' }));
    expect(screen.queryByRole('group', { name: 'Registro 2' })).not.toBeInTheDocument();
    expect(screen.getByText('PARACETAMOL COMPRIMIDO 500 MG')).toBeInTheDocument();
  });

  it.each(['return', 'disposal'])(
    'switches A4 and Carta for %s while preserving fields and invalidating the prepared PDF',
    async kind => {
      const Component = kind === 'return' ? PharmacyReturnTool : PharmacyDisposalTool;
      render(<Component {...props()} />);
      fillProfessional();
      selectParacetamol();
      fireEvent.change(screen.getByLabelText('Cantidad (comprimido)'), { target: { value: '4' } });
      if (kind === 'return') {
        fireEvent.change(screen.getByLabelText('Fundamento de la devolución'), {
          target: { value: 'Tratamiento suspendido' },
        });
      } else {
        fireEvent.change(screen.getByLabelText('N.° / año (obligatorio)'), {
          target: { value: '12 / 2026' },
        });
        fireEvent.change(screen.getByLabelText('Causa de eliminación'), {
          target: { value: 'damaged' },
        });
      }
      const paperSize = screen.getByRole('combobox', { name: 'Tamaño de papel' });
      expect(paperSize).toHaveValue('a4');
      expect(within(paperSize).getByRole('option', { name: 'A4' })).toBeInTheDocument();
      expect(within(paperSize).getByRole('option', { name: 'Carta' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Preparar vista previa' }));
      const preview =
        kind === 'return'
          ? 'Vista previa · Devolución de fármacos'
          : 'Vista previa · Entrega de fármacos eliminados';
      expect(await screen.findByTitle(preview)).toBeInTheDocument();
      expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ paperSize: 'a4' }));
      expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
      fireEvent.change(paperSize, { target: { value: 'letter' } });
      expect(paperSize).toHaveValue('letter');
      expect(screen.queryByTitle(preview)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Descargar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('Nombre del responsable')).toHaveValue('Profesional A');
      expect(screen.getByLabelText('RUT del responsable')).toHaveValue('12.345.678-5');
      expect(screen.getByLabelText('Cantidad (comprimido)')).toHaveValue('4');
      expect(screen.getByText('PARACETAMOL COMPRIMIDO 500 MG')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Preparar vista previa' }));
      expect(await screen.findByTitle(preview)).toBeInTheDocument();
      expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ paperSize: 'letter' }));
      fireEvent.change(paperSize, { target: { value: 'a4' } });
      expect(paperSize).toHaveValue('a4');
      expect(screen.queryByTitle(preview)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Cantidad (comprimido)')).toHaveValue('4');
    }
  );

  it('requires the cause and expiry of expired items before generating an elimination act', async () => {
    render(<PharmacyDisposalTool {...props()} />);
    fillProfessional();
    fireEvent.change(screen.getByLabelText('N.° / año (obligatorio)'), {
      target: { value: '12 / 2026' },
    });
    selectParacetamol();
    fireEvent.change(screen.getByLabelText('Cantidad (comprimido)'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Causa de eliminación'), {
      target: { value: 'expired' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar vista previa' }));
    expect(screen.getByRole('alert')).toHaveTextContent('indica la fecha de vencimiento');
    expect(generate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Vencimiento (obligatorio)'), {
      target: { value: '2026-09-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar vista previa' }));
    await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  });

  it('clears the act and uses the new account profile when the signed-in UID changes', () => {
    const toolProps = props();
    const { rerender } = render(<PharmacyReturnTool {...toolProps} />);
    fillProfessional();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar mis datos en este equipo' }));
    fireEvent.change(screen.getByLabelText('Paciente (opcional)'), {
      target: { value: 'Paciente sintético A' },
    });
    auth.currentUser = {
      uid: 'user-b',
      displayName: 'Profesional B',
      email: 'second@example.invalid',
      role: 'admin',
    };
    rerender(<PharmacyReturnTool {...toolProps} />);
    expect(screen.getByLabelText('Nombre del responsable')).toHaveValue('Profesional B');
    expect(screen.getByLabelText('RUT del responsable')).toHaveValue('');
    expect(screen.getByLabelText('Cargo')).toHaveValue('');
    expect(screen.getByLabelText('Paciente (opcional)')).toHaveValue('');
  });

  it('prefills the nursing login identity once and preserves subsequent manual corrections', () => {
    auth.currentUser = { ...auth.currentUser, uid: 'nurse-a', role: 'nurse_hospital' };
    readIdentity.mockReturnValue({
      uid: 'nurse-a',
      name: 'Nombre de acceso RUT',
      rut: '12.345.678-5',
    });
    const toolProps = props();
    const { rerender } = render(<PharmacyReturnTool {...toolProps} />);
    expect(readIdentity).toHaveBeenCalledWith('nurse-a');
    expect(screen.getByLabelText('Nombre del responsable')).toHaveValue('Nombre de acceso RUT');
    expect(screen.getByLabelText('RUT del responsable')).toHaveValue('12.345.678-5');
    expect(screen.getByLabelText('Cargo')).toHaveValue('Enfermero/a');
    fireEvent.change(screen.getByLabelText('Nombre del responsable'), {
      target: { value: 'Nombre corregido' },
    });
    fireEvent.change(screen.getByLabelText('Cargo'), {
      target: { value: 'Enfermera supervisora' },
    });
    readIdentity.mockReturnValue({ uid: 'nurse-a', name: 'Nombre posterior', rut: '12.345.678-5' });
    rerender(<PharmacyReturnTool {...toolProps} />);
    expect(readIdentity).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Nombre del responsable')).toHaveValue('Nombre corregido');
    expect(screen.getByLabelText('Cargo')).toHaveValue('Enfermera supervisora');
  });

  it.each(['doctor_urgency', 'doctor_specialist'])(
    'suggests an editable medical role for %s',
    role => {
      auth.currentUser = { ...auth.currentUser, role };
      render(<PharmacyReturnTool {...props()} />);
      expect(screen.getByLabelText('Cargo')).toHaveValue('Médico/a');
      expect(screen.getByLabelText('RUT del responsable')).toHaveValue('');
      fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Médico de turno' } });
      expect(screen.getByLabelText('Cargo')).toHaveValue('Médico de turno');
    }
  );
});

describe('pharmacy drawer protection', () => {
  it('opens from Formularios, guards Escape/back/close and discards only after confirmation', async () => {
    const onClose = vi.fn();
    render(<ClinicalLibraryDrawer onClose={onClose} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Completar Acta de devolución de fármacos' })
    );
    const editor = await screen.findByTestId('library-tool-pharmacy-return');
    const input = within(editor).getByLabelText('Paciente (opcional)');
    fireEvent.change(input, { target: { value: 'Borrador sintético' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '¿Salir del acta de farmacia?'
    );
    expect(screen.getByRole('button', { name: 'Seguir editando' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(input).toHaveValue('Borrador sintético');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar documentos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la biblioteca' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salir y descartar' }));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Completar Acta de devolución de fármacos' })
    );
    expect(await screen.findByLabelText('Paciente (opcional)')).toHaveValue('');
  });
});
