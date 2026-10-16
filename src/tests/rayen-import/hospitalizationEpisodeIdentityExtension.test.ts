// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

it('forwards only index identity metadata, separating own and maternal RUN episodes', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(readFileSync('extension/hospitalization-reports-runtime.js', 'utf8'), context);
  const runtime = context.HhrHospitalizationReportsRuntime as {
    listEpisodes: (input: unknown) => unknown;
  };
  expect(
    runtime.listEpisodes({
      patientRun: '12345678-5',
      rows: [
        {
          encounterId: 300,
          patientIdentifier: '123456785',
          patientName: ' Paciente Sintetico ',
          patientIdentifierTypeId: 2,
          startPeriod: '2030-09-20',
          endPeriod: '2030-09-21',
          diagnosis: 'private',
        },
        {
          encounterId: 301,
          patientIdentifier: '123456785',
          patientName: 'RN de Paciente Sintetico',
          patientIdentifierTypeId: 4,
          startPeriod: '2030-09-21',
          endPeriod: '2030-09-21',
        },
        {
          encounterId: 999,
          patientIdentifier: '111111111',
          patientName: 'Other identity',
          patientIdentifierTypeId: 2,
          startPeriod: '2030-09-20',
          endPeriod: '2030-09-21',
        },
      ],
    })
  ).toEqual({
    ok: true,
    episodes: [
      {
        encId: '301',
        patientName: 'RN de Paciente Sintetico',
        identifierType: 4,
        startDate: '2030-09-21',
        endDate: '2030-09-21',
        active: false,
      },
      {
        encId: '300',
        patientName: 'Paciente Sintetico',
        identifierType: 2,
        startDate: '2030-09-20',
        endDate: '2030-09-21',
        active: false,
      },
    ],
  });
});
