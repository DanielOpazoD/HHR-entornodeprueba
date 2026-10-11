import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VitalsCell } from '@/features/census/components/patient-row/VitalsCell';
import { ScoresCell } from '@/features/census/components/patient-row/ScoresCell';
import { DataFactory } from '@/tests/factories/DataFactory';

const imports = vi.hoisted(() => {
  let resolveVitals!: () => void;
  let rejectScores!: (reason: Error) => void;
  return {
    vitals: 0,
    scores: 0,
    vitalsReady: new Promise<void>(resolve => {
      resolveVitals = resolve;
    }),
    scoresReady: new Promise<void>((_, reject) => {
      rejectScores = reject;
    }),
    finishVitals: () => resolveVitals(),
    failScores: () => rejectScores(new Error('missing detail chunk')),
  };
});

vi.mock('@/features/census/components/patient-row/VitalsDetailModal', async () => {
  imports.vitals++;
  await imports.vitalsReady;
  return { VitalsDetailModal: () => <div>Detalle de signos listo</div> };
});
vi.mock('@/features/census/components/patient-row/ScoresDetailModal', async () => {
  imports.scores++;
  await imports.scoresReady;
  return { ScoresDetailModal: () => <div>Detalle de scores listo</div> };
});

describe('clinical detail chunks', () => {
  it('loads only the requested detail, allows cancelling, and isolates a failed chunk', async () => {
    const patient = DataFactory.createMockPatient('R1', {
      vitalSigns: {
        recordedDate: '2026-07-11',
        recordedAt: '11-07-2026 10:00',
        systolic: 120,
        diastolic: 80,
        heartRate: 75,
        spo2: 98,
        temperature: 36,
        respiratoryRate: null,
        painEva: null,
        hgt: null,
        insulinUnits: null,
        insulinQuadrant: null,
        observations: '',
        author: '',
        authorRole: '',
      },
      evaluationScores: {
        braden: {
          code: 'BRADEN',
          name: 'Braden',
          encounterEventId: 20260711100000,
          total: 23,
          severity: 'Riesgo bajo',
          recordedDate: '2026-07-11',
          recordedAt: '11-07-2026 10:00',
        },
      },
    });
    render(
      <table>
        <tbody>
          <tr>
            <VitalsCell data={patient} />
            <ScoresCell data={patient} currentDateString="2026-07-11" />
          </tr>
        </tbody>
      </table>
    );
    expect(imports.vitals).toBe(0);
    expect(imports.scores).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Cargando detalle');
    expect(imports.vitals).toBe(1);
    expect(imports.scores).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));
    await act(async () => {
      imports.finishVitals();
    });
    expect(screen.queryByText('Detalle de signos listo')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('120/80')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));
    expect(await screen.findByText('Detalle de signos listo')).toBeVisible();

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de escalas de enfermería' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Cargando detalle');
      await act(async () => {
        imports.failScores();
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el detalle');
      expect(screen.getByText('120/80')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });
});
