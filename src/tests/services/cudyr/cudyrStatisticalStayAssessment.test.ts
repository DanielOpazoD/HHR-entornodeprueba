import { describe, it, expect } from 'vitest';
import { assessCudyrStatisticalDay } from '@/services/cudyr/cudyrStatisticalStayAssessment';
import type { StatisticalDischargeEvidence } from '@/features/rayen-import/mapping/parseStatisticalDischargeReport';
const source = (): StatisticalDischargeEvidence => ({
  run: '1234560',
  admissionAt: '2026-08-02T14:00:00',
  admissionUnit: 'Área Médico Quirúrgico Cuidados Medios',
  dischargeAt: '2026-08-03T13:30:00',
  transfers: [],
});
const input = { document: '123.456-0', date: '2026-08-02' };
describe('statistical admission evidence for missing daily census', () => {
  it('retains completed duration when a hospital interval ends at exactly the reference', () => {
    const e = source();
    e.admissionAt = '2026-08-02T17:00:00';
    e.transfers = [{ changedAt: '2026-08-03T01:00:00', unit: 'Urgencias' }];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      hoursAtReference: 8,
      meetsEightHours: true,
    });
  });
  it('does not consider a zero-duration transfer at discharge a possible application unit', () => {
    const e = source();
    e.dischargeAt = '2026-08-03T06:00:00';
    e.transfers = [{ changedAt: e.dischargeAt, unit: 'Urgencias' }];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      possibleUnits: [e.admissionUnit],
      unitAtApplication: e.admissionUnit,
    });
  });
  it('does not invent a first hospital admission from a transfer at discharge', () => {
    const e = source();
    e.admissionUnit = 'Urgencias';
    e.transfers = [{ changedAt: e.dischargeAt, unit: source().admissionUnit }];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      firstHospitalAdmissionAt: null,
      hoursAtReference: null,
      meetsEightHours: null,
      presentInNight: false,
    });
  });
  it('bounds duration by discharge before the fixed reference', () => {
    const e = source();
    e.admissionAt = '2026-08-02T17:00:00';
    e.dischargeAt = '2026-08-03T00:30:00';
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      hoursAtReference: 7.5,
      meetsEightHours: false,
    });
  });
  it.each(['00:30:00', '01:00:00'])(
    'excludes a completed eight-hour stay discharged at %s',
    time => {
      const e = source();
      e.admissionAt = '2026-08-02T16:00:00';
      e.dischargeAt = `2026-08-03T${time}`;
      expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
        presentInNight: true,
        meetsEightHours: false,
      });
    }
  );
  it('keeps first entry for display but restarts duration after leaving and returning to Hospitalizados', () => {
    const e = source();
    e.admissionAt = '2026-08-01T10:00:00';
    e.transfers = [
      { changedAt: '2026-08-02T10:00:00', unit: 'Urgencias' },
      { changedAt: '2026-08-02T16:00:00', unit: e.admissionUnit },
    ];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      firstHospitalAdmissionAt: e.admissionAt,
      hospitalSegmentAdmissionAt: '2026-08-02T16:00:00',
      hoursAtReference: 9,
      meetsEightHours: true,
    });
  });
  it('has zero current-segment hours after a pre-cutoff exit and later return', () => {
    const e = source();
    e.admissionAt = '2026-08-01T10:00:00';
    e.transfers = [
      { changedAt: '2026-08-02T23:00:00', unit: 'Urgencias' },
      { changedAt: '2026-08-03T03:00:00', unit: e.admissionUnit },
    ];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      presentInNight: true,
      firstHospitalAdmissionAt: e.admissionAt,
      hospitalSegmentAdmissionAt: null,
      hoursAtReference: 0,
      meetsEightHours: false,
    });
  });
  it('proves the missing night without copying a physical bed', () => {
    expect(assessCudyrStatisticalDay(source(), input)).toMatchObject({
      presentInNight: true,
      meetsEightHours: true,
      hoursAtReference: 11,
      bedId: null,
    });
  });
  it.each(['00:05', '03:00', '11:59'])('does not reject CUDYR performed at %s', clock => {
    expect(
      assessCudyrStatisticalDay(source(), {
        ...input,
        applicationAt: `2026-08-03T${clock}:00-06:00`,
      })
    ).toMatchObject({ presentInNight: true, meetsEightHours: true, applicationWithinStay: true });
  });
  it.each(['08:00', '10:58'])(
    'ignores a transfer at %s for the assumed madrugada window',
    clock => {
      const e = source();
      e.admissionUnit = 'Área Cuidados Intermedios Adulto';
      e.transfers = [{ changedAt: `2026-08-03T${clock}:00`, unit: source().admissionUnit }];
      expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
        unitAtApplication: e.admissionUnit,
        possibleUnits: [e.admissionUnit],
        applicationTimingBasis: 'assumed_before_0800',
        applicationWithinStay: null,
      });
      expect(
        assessCudyrStatisticalDay(e, {
          ...input,
          applicationAt: '2026-08-03T11:59:00-06:00',
        })
      ).toMatchObject({
        unitAtApplication: e.transfers[0].unit,
        applicationTimingBasis: 'recorded_time',
      });
    }
  );
  it('retains a transfer before 08:00 when the exact application time is unknown', () => {
    const e = source();
    e.transfers = [{ changedAt: '2026-08-03T07:59:00', unit: 'Área Cuidados Intermedios Adulto' }];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      unitAtApplication: null,
      possibleUnits: [e.admissionUnit, e.transfers[0].unit],
      applicationTimingBasis: 'assumed_before_0800',
    });
  });
  it('retains both units if a transfer occurred in a morning with unknown application time', () => {
    const e = source();
    e.admissionUnit = 'Área Cuidados Intermedios Adulto';
    e.transfers = [
      { changedAt: '2026-08-03T03:18:00', unit: 'Área Médico Quirúrgico Cuidados Medios' },
    ];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      unitAtApplication: null,
      possibleUnits: [e.admissionUnit, e.transfers[0].unit],
      meetsEightHours: true,
    });
    expect(
      assessCudyrStatisticalDay(e, { ...input, applicationAt: '2026-08-03T03:17:00-06:00' })
        ?.unitAtApplication
    ).toBe(e.admissionUnit);
    expect(
      assessCudyrStatisticalDay(e, { ...input, applicationAt: '2026-08-03T03:18:00-06:00' })
        ?.unitAtApplication
    ).toBe(e.transfers[0].unit);
  });
  it('associates a madrugada admission to the prior night but excludes its duration', () => {
    const e = source();
    e.admissionAt = '2026-08-03T00:39:00';
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      presentInNight: true,
      meetsEightHours: false,
    });
  });
  it('keeps a 03:00 admission in the night even though it occurs after the virtual reference', () => {
    const e = source();
    e.admissionAt = '2026-08-03T03:00:00';
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      presentInNight: true,
      meetsEightHours: false,
      hoursAtReference: 0,
    });
  });
  it.each([
    { admissionUnit: 'Urgencias', transfers: [] },
    {
      admissionUnit: 'Urgencias',
      transfers: [{ changedAt: '2026-08-03T10:00:00', unit: source().admissionUnit }],
    },
    {
      admissionUnit: source().admissionUnit,
      transfers: [{ changedAt: '2026-08-02T23:00:00', unit: 'Urgencias' }],
    },
  ])('does not prove a hospital night from an Urgencias-only interval', movement => {
    expect(assessCudyrStatisticalDay({ ...source(), ...movement }, input)?.presentInNight).toBe(
      false
    );
  });
  it('includes a madrugada transfer into Hospitalizados in the previous night', () => {
    const e = source();
    e.admissionUnit = 'Urgencias';
    e.transfers = [{ changedAt: '2026-08-03T03:00:00', unit: source().admissionUnit }];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      presentInNight: true,
      hoursAtReference: 0,
      meetsEightHours: false,
    });
  });
  it('does not borrow Urgencias time as hospital time', () => {
    const e = source();
    e.admissionUnit = 'Urgencias';
    e.transfers = [
      { changedAt: '2026-08-02T20:00:00', unit: 'Área Médico Quirúrgico Cuidados Medios' },
    ];
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      hoursAtReference: 5,
      meetsEightHours: false,
    });
  });
  it('does not resolve an absent or different document', () => {
    expect(assessCudyrStatisticalDay(source(), { ...input, document: '' })).toBeNull();
    expect(assessCudyrStatisticalDay(source(), { ...input, document: '63218804' })).toBeNull();
  });
  it('separates a discharge on the census day from an available result', () => {
    const e = source();
    e.dischargeAt = '2026-08-02T23:00:00';
    expect(assessCudyrStatisticalDay(e, input)).toMatchObject({
      presentInNight: false,
      applicationWithinStay: null,
    });
  });
  it('does not use a later admission or an application outside the source day', () => {
    const e = source();
    e.admissionAt = '2026-08-03T10:00:00';
    expect(assessCudyrStatisticalDay(e, input)?.presentInNight).toBe(false);
    expect(
      assessCudyrStatisticalDay(e, { ...input, applicationAt: '2026-08-04T01:00:00-06:00' })
    ).toBeNull();
  });
});
