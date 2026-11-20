import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MedicalIndicationRecord,
  MedicalIndicationTemplate,
  MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';

const ports = vi.hoisted(() => ({
  lookups: 0,
  storedRecords: [] as MedicalIndicationRecord[],
  createdRecords: [] as MedicalIndicationRecord[],
  templates: [] as MedicalIndicationTemplate[],
  releaseMarkUsed: null as null | (() => void),
}));

vi.mock('@/application/ports/medicalIndicationPort', () => ({
  defaultMedicalIndicationRecordPort: {
    listByEpisodeAndTargetDate: async () => {
      ports.lookups += 1;
      return ports.storedRecords;
    },
    create: async () => undefined,
    createWithAuditEvent: async (record: MedicalIndicationRecord) => {
      ports.createdRecords.push(record);
    },
  },
  defaultMedicalIndicationTemplatePort: {
    listActiveByUser: async () => ports.templates,
    create: async () => undefined,
    update: async () => undefined,
    archive: async () => undefined,
    markUsed: () =>
      new Promise<void>(resolve => {
        ports.releaseMarkUsed = resolve;
      }),
  },
}));

vi.mock('@/application/audit/writeAuditEventUseCaseLoader', () => ({
  loadExecuteWriteAuditEvent: async () => async () => ({
    status: 'success',
    data: null,
    errors: [],
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'user_test', email: 'medico@example.test', displayName: 'Médico Test' },
    role: 'doctor_urgency',
  }),
}));

import { MedicalIndicationsDialog } from '@/components/layout/date-strip/MedicalIndicationsDialog';

const TARGET_DATE = '2026-11-19';

const patient: MedicalIndicationsPatientOption = {
  bedId: 'R1',
  label: 'R1 - Paciente Test',
  patientName: 'Paciente Test',
  rut: '12.345.678-5',
  diagnosis: 'Diagnóstico de prueba',
  age: '60',
  birthDate: '1966-01-01',
  allergies: 'No conocidas',
  admissionDate: '2026-11-18',
  clinicalEpisodeId: 'ep_test_20261118',
  sourceDailyRecordDate: TARGET_DATE,
  daysOfStay: '2',
  treatingDoctor: 'Equipo de prueba',
};

const storedRecordWith = (
  indications: string[],
  generatedFromTemplateIds: string[] = ['template_previous']
): MedicalIndicationRecord => ({
  id: 'record_test',
  patientRut: patient.rut,
  patientName: patient.patientName,
  episodeId: 'ep_test_20261118',
  bedId: patient.bedId,
  targetDate: TARGET_DATE,
  generatedAt: '2026-11-19T12:00:00.000Z',
  generatedByUserId: 'user_test',
  generatedByName: 'Médico Test',
  generatedFromTemplateIds,
  admissionDate: patient.admissionDate,
  daysOfStayForTargetDate: '2',
  treatingDoctor: patient.treatingDoctor,
  reposo: '',
  regimen: '',
  kineType: 'ninguna',
  kineTimes: '',
  pendingNotes: '',
  indications,
  pdfPrintedAt: null,
});

const personalTemplate: MedicalIndicationTemplate = {
  id: 'template_test',
  userId: 'user_test',
  text: 'Plantilla de prueba',
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  createdByName: 'Médico Test',
  lastUsedAt: null,
  useCount: 0,
  isArchived: false,
};

/** Clicks «Insertar» and returns once the template's audit is pending; call the result to finish it. */
const insertTemplateWithPendingAudit = async (user: ReturnType<typeof userEvent.setup>) => {
  const templateCard = screen.getByText('Plantilla de prueba').parentElement as HTMLElement;
  await user.click(within(templateCard).getByRole('button', { name: /Insertar/ }));
  await waitFor(() => expect(ports.releaseMarkUsed).not.toBeNull());
  return async () => {
    await act(async () => ports.releaseMarkUsed?.());
  };
};

const numberedLines = (count: number) =>
  Array.from({ length: count }, (_, index) => `Indicación previa ${index + 1}`);

const renderDialog = async (expectedLines: number) => {
  const user = userEvent.setup();
  render(<MedicalIndicationsDialog isOpen onClose={() => undefined} patients={[patient]} />);
  // The applied-record lookup resets the editor when it resolves, so type only after it lands.
  await waitFor(() => expect(ports.lookups).toBe(1));
  await act(async () => undefined);
  expect(screen.getByText(new RegExp(`^${expectedLines} de 15`))).toBeInTheDocument();
  return {
    user,
    input: screen.getByPlaceholderText(/Escribe una indicación/) as HTMLInputElement,
    addButton: screen.getByRole('button', { name: 'Agregar' }),
  };
};

// The personal library also prints template texts, so read only the indications section.
const listedIndications = () => {
  const section = screen.getByText('Indicaciones clínicas').closest('div.overflow-hidden');
  return within(section as HTMLElement)
    .queryAllByText(/^(Texto|Indicación previa|Plantilla)/)
    .filter(node => node.tagName === 'P')
    .map(node => node.textContent);
};

const saveAndReadDeliveredLines = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Guardar indicaciones' }));
  await waitFor(() => expect(ports.createdRecords).toHaveLength(1));
  return ports.createdRecords[0].indications;
};

describe('MedicalIndicationsDialog free-text draft', () => {
  beforeEach(() => {
    ports.lookups = 0;
    ports.storedRecords = [];
    ports.createdRecords = [];
    ports.templates = [];
    ports.releaseMarkUsed = null;
  });

  it('clears the box after each Enter and a second Enter without typing adds nothing', async () => {
    const { user, input, addButton } = await renderDialog(0);

    for (const text of ['Texto A', 'Texto B', 'Texto C']) {
      await user.type(input, `${text}{Enter}`);
      expect(input).toHaveValue('');
      expect(addButton).toBeDisabled();
    }
    await user.type(input, '{Enter}');

    expect(listedIndications()).toEqual(['Texto A', 'Texto B', 'Texto C']);
    expect(await saveAndReadDeliveredLines(user)).toEqual(['Texto A', 'Texto B', 'Texto C']);
  });

  it('clears the box after each «Agregar» and a second click without typing adds nothing', async () => {
    const { user, input, addButton } = await renderDialog(0);

    for (const text of ['Texto A', 'Texto B', 'Texto C']) {
      await user.type(input, text);
      await user.click(addButton);
      expect(input).toHaveValue('');
      expect(addButton).toBeDisabled();
    }
    await user.click(addButton);

    expect(listedIndications()).toEqual(['Texto A', 'Texto B', 'Texto C']);
    expect(await saveAndReadDeliveredLines(user)).toEqual(['Texto A', 'Texto B', 'Texto C']);
  });

  it('keeps the rejected draft in the box when the last slot is already taken', async () => {
    ports.storedRecords = [storedRecordWith(numberedLines(15))];
    const { user, input, addButton } = await renderDialog(15);

    await user.type(input, 'Texto sin plaza{Enter}');

    expect(input).toHaveValue('Texto sin plaza');
    expect(addButton).toBeDisabled();
    expect(listedIndications()).toEqual(numberedLines(15));
  });

  it('a template that lands after its audit takes the last slot without touching the draft', async () => {
    ports.storedRecords = [storedRecordWith(numberedLines(14))];
    ports.templates = [personalTemplate];
    const { user, input } = await renderDialog(14);
    await waitFor(() => expect(screen.getByText('Plantilla de prueba')).toBeInTheDocument());

    await user.type(input, 'Texto en espera');
    const finishAudit = await insertTemplateWithPendingAudit(user);
    await finishAudit();
    await waitFor(() => expect(screen.getByText(/^15 de 15/)).toBeInTheDocument());

    await user.type(input, '{Enter}');

    expect(input).toHaveValue('Texto en espera');
    const expected = [...numberedLines(14), 'Plantilla de prueba'];
    expect(listedIndications()).toEqual(expected);
    expect(await saveAndReadDeliveredLines(user)).toEqual(expected);
    expect(ports.createdRecords[0].generatedFromTemplateIds).toEqual([
      'template_previous',
      'template_test',
    ]);
  });

  it('a template that finds the last slot taken during its audit is neither credited nor silent', async () => {
    ports.storedRecords = [storedRecordWith(numberedLines(14))];
    ports.templates = [personalTemplate];
    const { user, input } = await renderDialog(14);
    await waitFor(() => expect(screen.getByText('Plantilla de prueba')).toBeInTheDocument());

    const finishAudit = await insertTemplateWithPendingAudit(user);
    await user.type(input, 'Texto manual{Enter}');
    await finishAudit();

    expect(
      screen.getByText('No quedan espacios disponibles para insertar más indicaciones.')
    ).toBeInTheDocument();
    const expected = [...numberedLines(14), 'Texto manual'];
    expect(listedIndications()).toEqual(expected);
    expect(await saveAndReadDeliveredLines(user)).toEqual(expected);
    expect(ports.createdRecords[0].generatedFromTemplateIds).toEqual(['template_previous']);
  });
});
