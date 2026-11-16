// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getHandoffStaffInfo } from '@/services/pdf/handoffPdfUtils';

describe('handoffPdfUtils', () => {
  it('formats extra staffing and custom schedules for nursing handoff PDFs', () => {
    const result = getHandoffStaffInfo(
      {
        date: '2026-04-18',
        nursesDayShift: ['Enf Base', ''],
        nursesNightShift: ['Enf Noche 1', 'Enf Noche 2'],
        tensDayShift: ['Tens Base 1', 'Tens Base 2', ''],
        tensNightShift: ['Tens Noche 1', '', ''],
        handoffNightReceives: ['Enf Relevo'],
        staffingDetailsV1: {
          day: {
            nurses: [
              {
                id: 'day-nurse-standard-0',
                name: 'Enf Base',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 0,
                startTime: '08:00',
                endTime: '20:00',
              },
              {
                id: 'day-nurse-standard-1',
                name: '',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 1,
                startTime: '08:00',
                endTime: '20:00',
              },
              {
                id: 'day-nurse-extra-0',
                name: 'Enf Refuerzo',
                role: 'nurse',
                slotType: 'extra',
                startTime: '10:00',
                endTime: '18:00',
              },
            ],
            tens: [
              {
                id: 'day-tens-standard-0',
                name: 'Tens Base 1',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 0,
                startTime: '09:00',
                endTime: '20:00',
              },
              {
                id: 'day-tens-standard-1',
                name: 'Tens Base 2',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 1,
                startTime: '09:00',
                endTime: '20:00',
              },
              {
                id: 'day-tens-standard-2',
                name: '',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 2,
                startTime: '09:00',
                endTime: '20:00',
              },
              {
                id: 'day-tens-extra-0',
                name: 'Tens Refuerzo',
                role: 'tens',
                slotType: 'extra',
                startTime: '12:00',
                endTime: '20:00',
              },
            ],
          },
          night: {
            nurses: [
              {
                id: 'night-nurse-standard-0',
                name: 'Enf Noche 1',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 0,
                startTime: '20:00',
                endTime: '09:00',
              },
              {
                id: 'night-nurse-standard-1',
                name: 'Enf Noche 2',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 1,
                startTime: '20:00',
                endTime: '09:00',
              },
            ],
            tens: [
              {
                id: 'night-tens-standard-0',
                name: 'Tens Noche 1',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 0,
                startTime: '20:00',
                endTime: '09:00',
              },
            ],
          },
        },
      } as never,
      'day'
    );

    expect(result.delivers).toContain('Enf Base (08:00-20:00)');
    expect(result.delivers).toContain('Vacante');
    expect(result.delivers).toContain('Enf Refuerzo (10:00-18:00)');
    expect(result.tens).toContain('Tens Refuerzo (12:00-20:00)');
  });

  it('normalizes vacancy markers when night handoff receives come from legacy arrays', () => {
    const result = getHandoffStaffInfo(
      {
        date: '2026-04-18',
        nursesDayShift: ['Enf Día 1', 'Enf Día 2'],
        nursesNightShift: ['Enf Noche 1', 'Enf Noche 2'],
        tensDayShift: ['', '', ''],
        tensNightShift: ['', '', ''],
        handoffNightReceives: [' -- ', ''],
      } as never,
      'night'
    );

    expect(result.receives).toEqual(['Vacante', 'Vacante']);
  });
});
