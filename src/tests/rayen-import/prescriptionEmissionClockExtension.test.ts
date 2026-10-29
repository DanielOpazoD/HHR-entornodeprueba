// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { prescriptionPrint } from './prescriptionPrintTestHarness';
import { extractPageText, prescriptionPdf } from './prescriptionPdfTestHarness';

const emissionLabel = (stamp: string) => {
  const groups = prescriptionPrint.deriveProfessionalPrescriptionGroups([
    {
      patientPharmaIndicationResume: [
        {
          MRE_ID: 900001,
          HCP_NAME: 'Profesional de prueba',
          DESCRIPTOR: 'Medicamento sintético',
          PUBLISH_DATETIME: stamp,
        },
      ],
    },
  ]);
  const [group] = prescriptionPrint.applyProfessionalValidationDates(groups, [], null);
  return {
    label: prescriptionPrint.formatDateTimeLabel(group.printDateTime),
    date: group.printDate,
  };
};

describe('prescription emission source clock', () => {
  it('prints the same hospital clock in the emission and medication rows', async () => {
    const [source] = prescriptionPrint.deriveProfessionalPrescriptionGroups([
      {
        patientPharmaIndicationResume: [
          {
            MRE_ID: 900002,
            HCP_NAME: 'Profesional de prueba',
            PREFERRED_IDENTIFIER_CODE: '111111111',
            DESCRIPTOR: 'Medicamento sintético',
            PUBLISH_DATETIME: '2026-10-29T15:34:00',
          },
        ],
      },
    ]);
    const [dated] = prescriptionPrint.applyProfessionalValidationDates([source], [], null);
    const emission = prescriptionPrint.resolvePrescriptionEmissionDateTime(
      dated,
      '29-10-2026 10:34'
    );
    const pdf = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: { name: 'Paciente sintético', bed: 'R9' },
        professional: source.professional,
        professionalRun: source.professionalRun,
        validationDate: '',
        dateSource: 'indication',
        emissionDateTime: prescriptionPrint.formatDateTimeLabel(emission),
        medications: source.medications.map(({ medication, posology, route, dateTime }) => ({
          medication,
          posology,
          route,
          dateTime,
        })),
      },
      jsPDF
    );
    const text = (await extractPageText(pdf)).join(' ');
    expect(text.match(/10:34/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain('15:34');
  });

  it('keeps the prescription calendar date coherent across midnight', () => {
    expect(emissionLabel('2026-10-29T02:15:00')).toEqual({
      label: '28-10-2026 21:15',
      date: '2026-10-28',
    });
  });
  it.each([
    ['2026-10-29T15:34:00', '29-10-2026 10:34'],
    ['2026-07-20T15:34:00', '20-07-2026 09:34'],
    ['2026-10-29T02:15:00', '28-10-2026 21:15'],
    ['2026-10-29T15:34:00Z', '29-10-2026 10:34'],
    ['2026-10-29T10:34:00-05:00', '29-10-2026 10:34'],
    ['29-10-2026 10:34', '29-10-2026 10:34'],
  ])('renders %s in the hospital time zone as %s', (stamp, expected) => {
    expect(emissionLabel(stamp).label).toBe(expected);
  });
});
