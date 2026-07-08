import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MedicalIndicationsQuickAction } from '@/components/layout/date-strip/MedicalIndicationsQuickAction';
import {
  defaultMedicalIndicationRecordPort,
  defaultMedicalIndicationTemplatePort,
} from '@/application/ports/medicalIndicationPort';
import { printMedicalIndicationsPdf } from '@/services/pdf/medicalIndicationsPdfService';

vi.mock('@/services/pdf/medicalIndicationsPdfService', () => ({
  printMedicalIndicationsPdf: vi.fn(),
}));

const TEST_TARGET_DATE = '2026-06-30';

describe('MedicalIndicationsQuickAction', () => {
  beforeEach(() => {
    vi.spyOn(defaultMedicalIndicationTemplatePort, 'listActiveByUser').mockResolvedValue([]);
    vi.spyOn(defaultMedicalIndicationRecordPort, 'listByEpisodeAndTargetDate').mockResolvedValue(
      []
    );
    vi.spyOn(defaultMedicalIndicationRecordPort, 'create').mockResolvedValue(undefined);
    vi.spyOn(defaultMedicalIndicationRecordPort, 'createWithAuditEvent').mockResolvedValue(
      undefined
    );
  });

  const patients = [
    {
      bedId: 'A-01',
      label: 'A-01 · Juan Pérez',
      patientName: 'Juan Pérez',
      rut: '11.111.111-1',
      diagnosis: 'Neumonía',
      age: '66',
      birthDate: '1960-01-02',
      allergies: 'Ninguna',
      admissionDate: '2026-03-31',
      clinicalEpisodeId: 'episode-juan-20260331',
      daysOfStay: '2',
      treatingDoctor: 'Dra. Rapa Nui',
    },
  ];

  const openDialog = async () => {
    fireEvent.click(screen.getByTitle('Indicaciones médicas'));
    await screen.findByText('Mis indicaciones');
    await waitFor(() => expect(screen.queryByText('Cargando...')).not.toBeInTheDocument());
  };

  it('habilita edición de indicaciones por defecto', async () => {
    render(<MedicalIndicationsQuickAction patients={patients} />);

    await openDialog();

    expect(screen.getByRole('button', { name: 'Editando' })).toBeInTheDocument();

    const draftInput = screen.getByPlaceholderText('Escribe una indicación y presiona Enter...');
    expect(draftInput).toBeEnabled();
  });

  it('muestra acciones con iconos para editar y quitar indicaciones', async () => {
    render(<MedicalIndicationsQuickAction patients={patients} />);

    await openDialog();

    fireEvent.change(screen.getByPlaceholderText('Escribe una indicación y presiona Enter...'), {
      target: { value: 'Control de signos vitales cada 6 horas' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(screen.getByTitle('Editar indicación #1')).toBeInTheDocument();
    expect(screen.getByTitle('Quitar indicación #1')).toBeInTheDocument();
  });

  it('carga la biblioteca personal una sola vez al abrir el modal', async () => {
    const listActiveByUserSpy = vi.spyOn(defaultMedicalIndicationTemplatePort, 'listActiveByUser');
    listActiveByUserSpy.mockClear();

    render(<MedicalIndicationsQuickAction patients={patients} />);

    await openDialog();
    await waitFor(() => expect(listActiveByUserSpy).toHaveBeenCalledTimes(1));
  });

  it('hidrata las últimas indicaciones aplicadas compartidas al abrir el modal', async () => {
    vi.spyOn(defaultMedicalIndicationRecordPort, 'listByEpisodeAndTargetDate').mockResolvedValue([
      {
        id: 'record-shared',
        patientRut: '11.111.111-1',
        patientName: 'Juan Pérez',
        episodeId: 'episode-juan-20260331',
        bedId: 'A-01',
        targetDate: TEST_TARGET_DATE,
        generatedAt: '2026-05-29T12:00:00.000Z',
        generatedByUserId: 'doctor-1',
        generatedByName: 'Dra. Test',
        generatedByRole: 'doctor_specialist',
        generatedFromTemplateIds: [],
        admissionDate: '2026-03-31',
        daysOfStayForTargetDate: '60',
        treatingDoctor: 'Dra. Persistida',
        reposo: 'Reposo relativo',
        regimen: 'Régimen liviano',
        kineType: 'respiratoria',
        kineTimes: '3 veces/día',
        pendingNotes: 'Revisar gases',
        indications: ['Control de signos vitales cada 4 horas'],
        pdfPrintedAt: null,
      },
    ]);

    render(<MedicalIndicationsQuickAction patients={patients} />);

    await openDialog();

    expect(await screen.findByText('Control de signos vitales cada 4 horas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Reposo relativo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Régimen liviano')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dra. Persistida')).toBeInTheDocument();
  });

  it('limpia indicaciones previas al cambiar a paciente sin registro aplicado', async () => {
    const patientsWithTwoBeds = [
      patients[0],
      {
        bedId: 'B-02',
        label: 'B-02 · María Rapa',
        patientName: 'María Rapa',
        rut: '22.222.222-2',
        diagnosis: 'Colecistitis',
        age: '54',
        birthDate: '1972-04-12',
        allergies: 'Penicilina',
        admissionDate: '2026-05-28',
        clinicalEpisodeId: 'episode-maria-20260528',
        daysOfStay: '1',
        treatingDoctor: 'Dr. Tavake',
      },
    ];
    vi.spyOn(defaultMedicalIndicationRecordPort, 'listByEpisodeAndTargetDate').mockImplementation(
      episodeId =>
        Promise.resolve(
          episodeId === 'episode-juan-20260331'
            ? [
                {
                  id: 'record-shared',
                  patientRut: '11.111.111-1',
                  patientName: 'Juan Pérez',
                  episodeId: 'episode-juan-20260331',
                  bedId: 'A-01',
                  targetDate: TEST_TARGET_DATE,
                  generatedAt: '2026-05-29T12:00:00.000Z',
                  generatedByUserId: 'doctor-1',
                  generatedByName: 'Dra. Test',
                  generatedByRole: 'doctor_specialist',
                  generatedFromTemplateIds: [],
                  admissionDate: '2026-03-31',
                  daysOfStayForTargetDate: '60',
                  treatingDoctor: 'Dra. Persistida',
                  reposo: 'Reposo relativo',
                  regimen: 'Régimen liviano',
                  kineType: 'respiratoria',
                  kineTimes: '3 veces/día',
                  pendingNotes: 'Revisar gases',
                  indications: ['Control de signos vitales cada 4 horas'],
                  pdfPrintedAt: null,
                },
              ]
            : []
        )
    );

    render(<MedicalIndicationsQuickAction patients={patientsWithTwoBeds} />);

    await openDialog();
    expect(await screen.findByText('Control de signos vitales cada 4 horas')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Seleccionar paciente'), { target: { value: 'B-02' } });

    await waitFor(() =>
      expect(screen.queryByText('Control de signos vitales cada 4 horas')).not.toBeInTheDocument()
    );
    expect(screen.getByDisplayValue('Dr. Tavake')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar indicaciones' })).toBeDisabled();
  });

  it('guarda indicaciones aplicadas compartidas sin imprimir PDF', async () => {
    const createRecordSpy = vi.spyOn(defaultMedicalIndicationRecordPort, 'createWithAuditEvent');

    render(<MedicalIndicationsQuickAction patients={patients} />);

    await openDialog();

    fireEvent.change(screen.getByPlaceholderText('Escribe una indicación y presiona Enter...'), {
      target: { value: 'Mantener control de signos vitales cada 6 horas' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar indicaciones' }));

    await waitFor(() => {
      expect(createRecordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          patientRut: '11.111.111-1',
          patientName: 'Juan Pérez',
          episodeId: 'episode-juan-20260331',
          indications: ['Mantener control de signos vitales cada 6 horas'],
        }),
        expect.objectContaining({
          action: 'MEDICAL_INDICATION_RECORD_CREATED',
          entityType: 'medicalIndicationRecord',
          patientRut: '11.111.111-1',
        }),
        undefined
      );
    });
    expect(printMedicalIndicationsPdf).not.toHaveBeenCalled();
  });

  it('explica que la generación se registra al guardar o imprimir', async () => {
    render(<MedicalIndicationsQuickAction patients={patients} />);

    await openDialog();

    expect(
      screen.getByText(/La generación quedará registrada al guardar o imprimir/i)
    ).toBeInTheDocument();
  });
});
