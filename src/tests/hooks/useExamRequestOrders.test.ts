import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExamRequestOrders, type ExamRequestCandidate } from '@/hooks/useExamRequestOrders';
import type { PatientData } from '@/types/domain/patient';

const candidate = (key: string, name: string, insurance?: string): ExamRequestCandidate => ({
  key,
  label: key,
  patient: { patientName: name, insurance } as PatientData,
});
const census = [
  candidate('R1', 'PRIMERA SINTÉTICA', 'Fonasa'),
  candidate('R2', 'SEGUNDO SINTÉTICO', 'Isapre'),
  candidate('R3', 'TERCERA SINTÉTICA'),
];

describe('useExamRequestOrders', () => {
  it('keeps the order of a patient moved to another bed: the key is patient and episode', () => {
    const { result, rerender } = renderHook(
      ({ candidates }) => useExamRequestOrders({ candidates, initialKey: '111:ep-1' }),
      {
        initialProps: {
          candidates: [
            { ...candidate('111:ep-1', 'PRIMERA SINTÉTICA'), label: 'R1' },
            { ...candidate('222:ep-2', 'SEGUNDO SINTÉTICO'), label: 'R2' },
          ],
        },
      }
    );
    act(() => result.current.togglePatient('222:ep-2'));
    act(() => result.current.toggleExam('HEMATOLOGIA|HEMOGRAMA'));
    rerender({
      candidates: [
        { ...candidate('111:ep-1', 'PRIMERA SINTÉTICA'), label: 'R1' },
        { ...candidate('222:ep-2', 'SEGUNDO SINTÉTICO'), label: 'R3' },
      ],
    });
    expect(result.current.orders).toHaveLength(2);
    expect(result.current.active?.label).toBe('R3');
    expect([...(result.current.active?.selectedExams ?? [])]).toEqual(['HEMATOLOGIA|HEMOGRAMA']);
  });

  it('never hands an order to a new occupant of the same bed', () => {
    const { result, rerender } = renderHook(
      ({ candidates }) => useExamRequestOrders({ candidates, initialKey: 'R1:ep-1' }),
      {
        initialProps: {
          candidates: [
            candidate('R1:ep-1', 'PRIMERA SINTÉTICA'),
            candidate('R2:ep-2', 'SEGUNDO SINTÉTICO'),
          ],
        },
      }
    );
    act(() => result.current.togglePatient('R2:ep-2'));
    act(() => result.current.toggleExam('HEMATOLOGIA|HEMOGRAMA'));
    // Bed R2 now holds another episode: the order of the previous patient leaves with them.
    rerender({
      candidates: [
        candidate('R1:ep-1', 'PRIMERA SINTÉTICA'),
        candidate('R2:ep-9', 'NUEVO SINTÉTICO'),
      ],
    });
    expect(result.current.orders.map(order => order.patient.patientName)).toEqual([
      'PRIMERA SINTÉTICA',
    ]);
    expect(result.current.isIncluded('R2:ep-9')).toBe(false);
    act(() => result.current.togglePatient('R2:ep-9'));
    expect(result.current.active?.selectedExams.size).toBe(0);
  });

  it('starts with the patient it was opened for, nothing marked and its insurance', () => {
    const { result } = renderHook(() =>
      useExamRequestOrders({ candidates: census, initialKey: 'R1' })
    );
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.active?.key).toBe('R1');
    expect(result.current.active?.selectedExams.size).toBe(0);
    expect(result.current.active?.procedencia).toBe('Hospitalización');
    expect(result.current.active?.prevision).toBe('FONASA');
  });

  it('marks exams, origin and insurance on the active order only', () => {
    const { result } = renderHook(() =>
      useExamRequestOrders({ candidates: census, initialKey: 'R1' })
    );
    act(() => result.current.toggleExam('HEMATOLOGIA|HEMOGRAMA'));
    act(() => result.current.setProcedencia('Urgencia'));
    act(() => result.current.togglePatient('R2'));
    expect(result.current.active?.key).toBe('R2');
    expect(result.current.active?.prevision).toBe('ISAPRE');
    act(() => result.current.toggleExam('BIOQUIMICA|GLICEMIA'));
    act(() => result.current.setPrevision('FONASA B'));

    const [first, second] = result.current.orders;
    expect([...first.selectedExams]).toEqual(['HEMATOLOGIA|HEMOGRAMA']);
    expect(first.procedencia).toBe('Urgencia');
    expect(first.prevision).toBe('FONASA');
    expect([...second.selectedExams]).toEqual(['BIOQUIMICA|GLICEMIA']);
    expect(second.procedencia).toBe('Hospitalización');
    expect(second.prevision).toBe('FONASA B');

    act(() => result.current.toggleExam('BIOQUIMICA|GLICEMIA'));
    expect(result.current.active?.selectedExams.size).toBe(0);
  });

  it('removes a patient but always keeps one order, and moves to a neighbour', () => {
    const { result } = renderHook(() =>
      useExamRequestOrders({ candidates: census, initialKey: 'R1' })
    );
    act(() => result.current.togglePatient('R1'));
    expect(result.current.orders.map(order => order.key)).toEqual(['R1']);

    act(() => result.current.togglePatient('R2'));
    act(() => result.current.togglePatient('R3'));
    act(() => result.current.selectOrder('R2'));
    act(() => result.current.togglePatient('R2'));
    expect(result.current.orders.map(order => order.key)).toEqual(['R1', 'R3']);
    expect(result.current.active?.key).toBe('R3');
    expect(result.current.isIncluded('R2')).toBe(false);

    // Added again, it starts from nothing marked.
    act(() => result.current.togglePatient('R2'));
    expect(result.current.active?.key).toBe('R2');
    expect(result.current.active?.selectedExams.size).toBe(0);
  });

  it('shows the current census data and drops a patient that left the census', () => {
    const { result, rerender } = renderHook(
      ({ candidates }) => useExamRequestOrders({ candidates, initialKey: 'R1' }),
      { initialProps: { candidates: census } }
    );
    act(() => result.current.togglePatient('R2'));
    act(() => result.current.toggleExam('HEMATOLOGIA|HEMOGRAMA'));
    rerender({
      candidates: [candidate('R1', 'PRIMERA ACTUALIZADA', 'Fonasa'), census[2]],
    });
    expect(result.current.orders.map(order => order.patient.patientName)).toEqual([
      'PRIMERA ACTUALIZADA',
    ]);
    expect(result.current.active?.key).toBe('R1');
    act(() => result.current.toggleExam('BIOQUIMICA|GLICEMIA'));
    expect([...(result.current.active?.selectedExams ?? [])]).toEqual(['BIOQUIMICA|GLICEMIA']);
  });
});
