// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';

import { prescriptionPrint } from './prescriptionPrintTestHarness';

describe('extension prescription operations', () => {
  it('extracts the official folio, emission time and prescriber identity from a compressed PDF', async () => {
    const document = new jsPDF({ compress: true });
    document.text('Fecha impresión', 20, 20);
    document.text('14-07-2026  21:45', 120, 20);
    document.text('Folio: 012D5533', 120, 35);
    document.text('Prescriptor:', 20, 50);
    document.text('RUN:', 20, 65);
    document.text('Fecha:', 120, 50);
    document.text('Daniel Opazo', 60, 50);
    document.text('17.752.753-K', 60, 65);

    const metadata = await prescriptionPrint.extractOfficialPrescriptionMetadata(
      document.output('arraybuffer')
    );

    expect(metadata).toEqual({
      folio: '012D5533',
      emissionDateTime: '14-07-2026 21:45',
      professional: 'Daniel Opazo',
      professionalRun: '17.752.753-K',
    });
    expect(prescriptionPrint.formatRun('17752753K')).toBe('17.752.753-K');
    expect(prescriptionPrint.formatRun('ABC123')).toBe('');
    expect(prescriptionPrint.formatRun('17.752.753-1')).toBe('');
  });

  it('anchors emission time to its labeled header instead of an earlier timestamp', async () => {
    const document = new jsPDF({ compress: true });
    document.text('01-01-2020  00:01', 20, 10);
    document.text('Fecha emisión', 20, 20);
    document.text('15-07-2026  08:56', 120, 20);
    document.text('Folio: 012D5533', 120, 35);

    const metadata = await prescriptionPrint.extractOfficialPrescriptionMetadata(
      document.output('arraybuffer')
    );

    expect(metadata.emissionDateTime).toBe('15-07-2026 08:56');
  });

  it('extracts metadata when the official PDF declares FlateDecode as a filter array', async () => {
    const document = new jsPDF({ compress: true });
    document.text('Fecha impresión', 20, 20);
    document.text('15-07-2026  08:56', 120, 20);
    document.text('Folio: 012D5533', 120, 35);
    const original = new Uint8Array(document.output('arraybuffer'));
    const source = new TextDecoder('latin1').decode(original);
    const needle = '/Filter /FlateDecode';
    const index = source.indexOf(needle);
    expect(index).toBeGreaterThanOrEqual(0);
    const replacement = new TextEncoder().encode('/Filter [/FlateDecode]');
    const modified = new Uint8Array(original.length - needle.length + replacement.length);
    modified.set(original.slice(0, index));
    modified.set(replacement, index);
    modified.set(original.slice(index + needle.length), index + replacement.length);

    const metadata = await prescriptionPrint.extractOfficialPrescriptionMetadata(modified.buffer);
    expect(metadata).toMatchObject({ folio: '012D5533', emissionDateTime: '15-07-2026 08:56' });
  });

  it('extracts equivalent patient, medication and footer content from the official PDF layout', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Fecha impresión', 434, 30);
    document.text('14-07-2026  23:23', 500, 30);
    document.text('Dirección', 20, 56);
    document.text('Simón Paoa N°S/N', 100, 56);
    document.text('Folio: D292620E', 500, 80);
    document.text('Nombres:', 20, 110);
    document.text('Ines Leiva Riroroko', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Sexo:', 180, 130);
    document.text('Mujer', 220, 130);
    document.text('Edad:', 310, 130);
    document.text('59 año(s)', 350, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Insuficiencia cardiaca', 100, 175);
    document.text('descompensada con edema', 20, 187);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);
    document.text('Despacho Farmacia', 500, 205);
    document.line(20, 210, 310, 210);
    document.line(310, 210, 500, 210);
    document.line(500, 210, 590, 210);
    document.text('Espironolactona 25 mg Comprimidos , vía oral', 20, 220);
    document.text('presentación hospitalaria de liberación prolongada', 20, 240);
    document.text('1 comprimido al día vo', 310, 220);
    document.text('con control de presión arterial', 310, 240);
    document.text('Pendiente', 500, 220);
    document.text('09-07-2026 11:15', 20, 252);
    document.line(20, 265, 310, 265);
    document.line(310, 265, 500, 265);
    document.line(500, 265, 590, 265);
    document.text('Prescriptor:', 20, 300);
    document.text('Elena Diaz', 99, 300);
    document.text('RUN:', 20, 320);
    document.text('19.525.925-9', 99, 320);
    document.text('Fecha:', 427, 300);
    document.text('15-07-2026', 473, 300);
    document.text('Impreso por', 20, 360);
    document.text('Valeria Salfate', 71, 360);

    const content = await prescriptionPrint.extractOfficialPrescriptionContent(
      document.output('arraybuffer')
    );

    expect(content).toMatchObject({
      patient: {
        name: 'Ines Leiva Riroroko',
        run: '8.932.066-6',
        sex: 'Mujer',
        age: '59 año(s)',
        bed: 'H6C1',
        room: 'Habitacion 6',
        service: 'Área Médico Quirúrgica',
        diagnosis: 'Insuficiencia cardiaca descompensada con edema',
      },
      professional: 'Elena Diaz',
      professionalRun: '19.525.925-9',
      prescriptionDate: '15-07-2026',
      printedBy: 'Valeria Salfate',
      address: 'Simón Paoa N°S/N',
      emissionDateTime: '14-07-2026 23:23',
      folio: 'D292620E',
    });
    expect(content?.medications).toEqual([
      expect.objectContaining({
        medication:
          'Espironolactona 25 mg Comprimidos , vía oral presentación hospitalaria de liberación prolongada',
        posology: '1 comprimido al día vo con control de presión arterial',
        dispatch: 'Pendiente',
        dateTime: '09-07-2026 11:15',
      }),
    ]);

    // A repeated institutional label inside the inferred medication row means the
    // horizontal border was not trustworthy. Preserve the official PDF in that case.
    document.text('Impreso por: Profesional incorrectamente mezclado', 20, 230);
    await expect(
      prescriptionPrint.extractOfficialPrescriptionContent(document.output('arraybuffer'))
    ).resolves.toBeNull();
  });

  it('uses the official table borders when adjacent medication rows have different heights', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Fecha impresión', 434, 30);
    document.text('14-07-2026  23:23', 500, 30);
    document.text('Dirección', 20, 56);
    document.text('Simón Paoa N°S/N', 100, 56);
    document.text('Folio: D292620E', 500, 80);
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Sexo:', 180, 130);
    document.text('Mujer', 220, 130);
    document.text('Edad:', 310, 130);
    document.text('59 año(s)', 350, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Dolor agudo', 100, 175);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);
    document.text('Despacho Farmacia', 500, 205);
    document.line(20, 210, 310, 210);
    document.line(310, 210, 500, 210);
    document.line(500, 210, 590, 210);

    document.text('Losartán 50 mg Comprimidos , vía oral', 20, 222);
    document.text('1/2 comprimido cada 12 horas', 310, 222);
    document.text('Despachado', 500, 222);
    document.text('09-07-2026 11:15', 20, 242);
    document.line(20, 250, 310, 250);
    document.line(310, 250, 500, 250);
    document.line(500, 250, 590, 250);

    document.text('Tramadol Clorhidrato 100 mg/1 ml Solución para', 20, 262);
    document.text('gotas orales, frasco 10 ml', 20, 278);
    document.text(', vía oral', 20, 294);
    document.text('10 gotas cada 8 horas', 310, 262);
    document.text('SOS en caso de dolor', 310, 278);
    document.text('Indicación por Dr. Jofré', 310, 294);
    document.text('Pendiente de despacho', 500, 262);
    document.text('14-07-2026 19:48', 20, 320);
    document.line(20, 330, 310, 330);
    document.line(310, 330, 500, 330);
    document.line(500, 330, 590, 330);

    document.text('Prescriptor:', 20, 380);
    document.text('Elena Diaz', 99, 380);
    document.text('RUN:', 20, 400);
    document.text('19.525.925-9', 99, 400);
    document.text('Fecha:', 427, 380);
    document.text('15-07-2026', 473, 380);
    document.text('Impreso por', 20, 450);
    document.text('Valeria Salfate', 71, 450);

    const content = await prescriptionPrint.extractOfficialPrescriptionContent(
      document.output('arraybuffer')
    );

    expect(content?.medications).toEqual([
      expect.objectContaining({
        medication: 'Losartán 50 mg Comprimidos , vía oral',
        posology: '1/2 comprimido cada 12 horas',
        dispatch: 'Despachado',
        dateTime: '09-07-2026 11:15',
      }),
      expect.objectContaining({
        medication:
          'Tramadol Clorhidrato 100 mg/1 ml Solución para gotas orales, frasco 10 ml , vía oral',
        posology: '10 gotas cada 8 horas SOS en caso de dolor Indicación por Dr. Jofré',
        dispatch: 'Pendiente de despacho',
        dateTime: '14-07-2026 19:48',
      }),
    ]);
  });

  it('extracts the horizontal-only Jasper variant with its footer on a second page', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Fecha impresión', 434, 30);
    document.text('16-07-2026  18:56', 500, 30);
    document.text('Dirección', 20, 56);
    document.text('Simón Paoa N°S/N', 100, 56);
    document.text('Folio: A68E762F', 500, 80);
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Sexo:', 180, 130);
    document.text('Mujer', 220, 130);
    document.text('Edad:', 310, 130);
    document.text('59 año(s)', 350, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Dolor agudo', 100, 175);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);
    document.text('Despacho Farmacia', 500, 205);
    document.line(20, 210, 590, 210);
    document.text('Matriz de solución inyectable', 20, 220);
    document.text('Administrar lentamente, vía endovenosa', 310, 220);
    document.text('16-07-2026 11:10', 20, 252);
    // This template can place the timestamp baseline less than two points from the row border.
    document.line(20, 253.5, 590, 253.5);
    document.addPage();
    // Continuation pages repeat demographics but not the table header. The institutional
    // separator must not be mistaken for the first medication row's upper border.
    document.line(20, 64, 590, 64);
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Clopidogrel 75 mg Comprimidos, vía oral', 20, 220);
    document.text('1 comprimido al día', 310, 220);
    document.text('16-07-2026 11:15', 20, 252);
    document.line(20, 260, 590, 260);
    document.text('Prescriptor:', 20, 380);
    document.text('Elena Diaz', 99, 380);
    document.text('RUN:', 20, 400);
    document.text('19.525.925-9', 99, 400);
    document.text('Fecha:', 427, 380);
    document.text('16-07-2026', 473, 380);
    document.text('Impreso por', 20, 740);
    document.text('Profesional Prueba', 71, 740);

    const content = await prescriptionPrint.extractOfficialPrescriptionContent(
      document.output('arraybuffer')
    );

    expect(content?.medications).toEqual([
      expect.objectContaining({
        medication: 'Matriz de solución inyectable',
        posology: 'Administrar lentamente, vía endovenosa',
        dateTime: '16-07-2026 11:10',
      }),
      expect.objectContaining({
        medication: 'Clopidogrel 75 mg Comprimidos, vía oral',
        posology: '1 comprimido al día',
        dateTime: '16-07-2026 11:15',
      }),
    ]);
    expect(content).toMatchObject({
      professional: 'Elena Diaz',
      professionalRun: '19.525.925-9',
      printedBy: 'Profesional Prueba',
    });
  });

  it('fails closed when an official-looking PDF does not prove any medication row', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);

    await expect(
      prescriptionPrint.extractOfficialPrescriptionContent(document.output('arraybuffer'))
    ).resolves.toBeNull();
  });

  it('fails closed when an otherwise complete official row has no posology', async () => {
    const document = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    document.text('Fecha impresión', 434, 30);
    document.text('14-07-2026  23:23', 500, 30);
    document.text('Dirección', 20, 56);
    document.text('Simón Paoa N°S/N', 100, 56);
    document.text('Folio: D292620E', 500, 80);
    document.text('Nombres:', 20, 110);
    document.text('Paciente Prueba', 70, 110);
    document.text('RUN:', 20, 130);
    document.text('8.932.066-6', 90, 130);
    document.text('Sexo:', 180, 130);
    document.text('Mujer', 220, 130);
    document.text('Edad:', 310, 130);
    document.text('59 año(s)', 350, 130);
    document.text('Cama:', 20, 150);
    document.text('H6C1', 70, 150);
    document.text('Sala:', 190, 150);
    document.text('Habitacion 6', 240, 150);
    document.text('Servicio:', 364, 150);
    document.text('Área Médico Quirúrgica', 414, 150);
    document.text('Diagnóstico(s):', 20, 175);
    document.text('Medicamento', 20, 205);
    document.text('Posología e indicaciones', 310, 205);
    document.text('Despacho Farmacia', 500, 205);
    document.line(20, 210, 310, 210);
    document.line(310, 210, 500, 210);
    document.line(500, 210, 590, 210);
    document.text('Losartán 50 mg Comprimidos , vía oral', 20, 220);
    document.text('09-07-2026 11:15', 20, 252);
    document.line(20, 265, 310, 265);
    document.line(310, 265, 500, 265);
    document.line(500, 265, 590, 265);
    document.text('Prescriptor:', 20, 300);
    document.text('Elena Diaz', 99, 300);
    document.text('RUN:', 20, 320);
    document.text('19.525.925-9', 99, 320);
    document.text('Fecha:', 427, 300);
    document.text('15-07-2026', 473, 300);
    document.text('Impreso por', 20, 360);
    document.text('Valeria Salfate', 71, 360);

    await expect(
      prescriptionPrint.extractOfficialPrescriptionContent(document.output('arraybuffer'))
    ).resolves.toBeNull();
  });
});
