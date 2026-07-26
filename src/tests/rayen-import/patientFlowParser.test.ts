import { describe, expect, it } from 'vitest';
import {
  firstPatientFlowTimestamp,
  latestPatientFlowMovement,
  parsePatientFlowMovements,
} from '@/features/rayen-import';

const patientFlowText = `
Flujo del Paciente
Paciente: Paciente Anterior RUN: 111111111
FECHA Y HORA CAMBIO SERVICIO AREA FUNCIONAL ESTACIÓN DE ENFERMERÍA SALA TIPO CAMA CAMA
23/07/2026 13:21:41 Área Médico Quirúrgica Cuidados Medios Hospitalizados Neo 1 Básica Neo1
23/07/2026 23:10:09 Área Médico Quirúrgica Cuidados Medios Hospitalizados Habitación 2 Básica C2
Pág. 1 de 1
`;

describe('patient-flow parser', () => {
  it('parses the visual row layout emitted by the official Jasper traceability report', () => {
    const jasperLayout = `
      Flujo del Paciente
      Paciente: Paciente Ejemplo RUN: 111111111
      FECHA Y HORA CAMBIO SERVICIO AREA FUNCIONAL ESTACIÓN DE ENFERMERÍA SALA TIPO CAMA CAMA
      08/07/2026 14:19:46 Área Médico Quirúrgica Área Médico Quirúrgico Servicio Hospitalizados HHR Habitacion 1 Básica H1C2
      Indiferenciada Cuidados Medios
      12/07/2026 18:32:23 Área Médico Quirúrgica Área Médico Quirúrgico Servicio Hospitalizados HHR Habitacion 6 Básica H6C2
      Indiferenciada Cuidados Medios
      13/07/2026 09:33:07 Área Médico Quirúrgica Área Médico Quirúrgico Servicio Hospitalizados HHR Habitacion 1 Básica H1C2
    `;

    expect(parsePatientFlowMovements(jasperLayout)).toEqual([
      { changedAt: '2026-07-08T14:19:46', bedId: 'H1C2', sourceBedLabel: 'H1C2' },
      { changedAt: '2026-07-12T18:32:23', bedId: 'H6C2', sourceBedLabel: 'H6C2' },
      { changedAt: '2026-07-13T09:33:07', bedId: 'H1C2', sourceBedLabel: 'H1C2' },
    ]);
  });

  it('returns known HHR beds in chronological order and ignores report identity fields', () => {
    expect(parsePatientFlowMovements(patientFlowText)).toEqual([
      { changedAt: '2026-07-23T13:21:41', bedId: 'NEO1', sourceBedLabel: 'Neo1' },
      { changedAt: '2026-07-23T23:10:09', bedId: 'H2C2', sourceBedLabel: 'C2' },
    ]);
    expect(latestPatientFlowMovement(patientFlowText)).toMatchObject({ bedId: 'H2C2' });
    expect(firstPatientFlowTimestamp(patientFlowText)).toBe('2026-07-23T13:21:41');
  });

  it('fails closed when the final location cannot be mapped', () => {
    expect(
      parsePatientFlowMovements('23/07/2026 23:10:09 Servicio Sala Básica DESCONOCIDA')
    ).toEqual([]);
  });

  it.each([
    '31/02/2026 12:00:00 Servicio Sala Básica H2C2',
    '01/13/2026 12:00:00 Servicio Sala Básica H2C2',
    '01/01/0099 12:00:00 Servicio Sala Básica H2C2',
    '22/07/2026 25:00:00 Servicio Sala Básica H2C2',
  ])('rejects impossible report timestamp: %s', row => {
    expect(parsePatientFlowMovements(row)).toEqual([]);
    expect(latestPatientFlowMovement(row)).toBeNull();
  });

  it('does not reuse an earlier known bed when a later row has an unknown location', () => {
    expect(
      latestPatientFlowMovement(`
        23/07/2026 13:21:41 Servicio Sala Básica Neo1
        23/07/2026 23:10:09 Servicio Sala Básica DESCONOCIDA
      `)
    ).toBeNull();
  });

  it('fails the whole report closed when a later movement-shaped row has an invalid timestamp', () => {
    const partiallyMalformed = `
      23/07/2026 13:21:41 Servicio Sala Básica H2C2
      31/02/2026 23:10:09 Servicio Sala Básica H3C1
    `;

    expect(parsePatientFlowMovements(partiallyMalformed)).toEqual([]);
    expect(latestPatientFlowMovement(partiallyMalformed)).toBeNull();
    expect(firstPatientFlowTimestamp(partiallyMalformed)).toBeNull();
  });

  it('selects the latest placement at or before the census snapshot cutoff', () => {
    expect(
      latestPatientFlowMovement(
        `
          23/07/2026 23:10:09 Servicio Sala Básica H2C2
          24/07/2026 13:00:00 Servicio Sala Básica H2C3
        `,
        { notAfter: '2026-07-24T12:30:00' }
      )
    ).toMatchObject({ bedId: 'H2C2', changedAt: '2026-07-23T23:10:09' });
  });

  it('rejects conflicting beds at the same latest timestamp', () => {
    expect(
      latestPatientFlowMovement(`
        23/07/2026 23:10:09 Servicio Sala Básica H2C2
        23/07/2026 23:10:09 Servicio Sala Básica H2C3
      `)
    ).toBeNull();
  });
});
