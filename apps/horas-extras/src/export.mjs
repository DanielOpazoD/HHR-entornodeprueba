import { shiftLabel, totals, periodInfo, PERIOD } from './domain/overtime.mjs';

export async function buildWorkbook(templateModel, sheets, ExcelJS, period = PERIOD) {
  const calendar = periodInfo(period);
  if (sheets.some(person => person.shifts.some(shift => shift.date.slice(0, 7) !== period)))
    throw new Error('La planilla contiene turnos de otro mes.');
  const template = new ExcelJS.Workbook();
  template.addWorksheet('Plantilla').model = structuredClone(templateModel);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hospital Hanga Roa';
  const zero = workbook.addWorksheet('Sin registros');
  zero.addRows([
    [`HOSPITALIZADOS · ${calendar.label.toLocaleUpperCase('es')}`],
    ['Funcionarios sin turnos registrados en este mes'],
    ['Nombre', 'RUT', 'Cargo'],
    ...sheets
      .filter(sheet => !sheet.shifts.length)
      .map(sheet => [sheet.name, sheet.rut, sheet.group]),
  ]);
  zero.columns = [{ width: 48 }, { width: 20 }, { width: 24 }];
  zero.getRow(3).font = { bold: true };
  zero.pageSetup = {
    paperSize: 1,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
  };
  for (const [index, person] of sheets.filter(sheet => sheet.shifts.length).entries()) {
    const name = `${index + 1} ${person.name}`.replace(/[\\/*?:\[\]]/g, '').slice(0, 31);
    const sheet = workbook.addWorksheet(name);
    sheet.model = { ...structuredClone(template.worksheets[0].model), name, id: sheet.id };
    sheet.getCell('D1').value = calendar.label.toLocaleUpperCase('es');
    sheet.getCell('D2').value = person.group.toLocaleUpperCase('es');
    sheet.getCell('D3').value = null;
    sheet.getCell('D4').value = 'HOSPITALIZADOS';
    sheet.getCell('D5').value = null;
    sheet.getCell('A6').value = `NOMBRE: ${person.name}`;
    sheet.getCell('E6').value = person.rut;
    sheet.getCell('A44').value = null;
    for (let day = 1; day <= 31; day++) {
      const row = day + 8;
      sheet.getRow(row).hidden = day > calendar.count;
      sheet.getCell(`A${row}`).value = day <= calendar.count ? day : null;
      const shifts = person.shifts.filter(shift => Number(shift.date.slice(-2)) === day);
      const sum = totals(shifts);
      const other = shifts.filter(shift => shift.kind !== 'night');
      const nights = shifts.filter(shift => shift.kind === 'night');
      sheet.getCell(`B${row}`).value = other.map(shiftLabel).join('\n') || null;
      sheet.getCell(`C${row}`).value = shifts.length ? sum.total / 60 : null;
      sheet.getCell(`D${row}`).value = sum.diurnal ? sum.diurnal / 60 : null;
      sheet.getCell(`E${row}`).value = nights.length
        ? nights.map(shiftLabel).join('\n')
        : sum.nocturnal
          ? sum.nocturnal / 60
          : null;
      ['B', 'E'].forEach(column => {
        sheet.getCell(`${column}${row}`).alignment = {
          ...sheet.getCell(`${column}${row}`).alignment,
          wrapText: true,
          vertical: 'middle',
        };
      });
      ['N', 'O', 'P'].forEach((column, i) => {
        sheet.getCell(`${column}${row}`).value = [sum.total, sum.diurnal, sum.nocturnal][i] / 60;
      });
      if (shifts.length > 1)
        sheet.getRow(row).height = Math.max(sheet.getRow(row).height || 20, shifts.length * 16);
    }
    const sum = totals(person.shifts);
    ['C', 'D', 'E'].forEach((column, i) => {
      const helper = ['N', 'O', 'P'][i];
      sheet.getCell(`${column}40`).value = {
        formula: `SUM(${helper}9:${helper}39)`,
        result: [sum.total, sum.diurnal, sum.nocturnal][i] / 60,
      };
      sheet.getCell(`C${41 + i}`).value = {
        formula: `${column}40`,
        result: [sum.total, sum.diurnal, sum.nocturnal][i] / 60,
      };
    });
    for (let column = 7; column <= 16; column++) sheet.getColumn(column).hidden = true;
    sheet.pageSetup = {
      ...sheet.pageSetup,
      printArea: 'A1:E47',
      orientation: 'portrait',
      paperSize: 1,
      fitToPage: true,
      fitToHeight: 1,
      fitToWidth: 1,
    };
  }
  return workbook;
}

export async function downloadWorkbook(sheets, group, period = PERIOD, { demo = true } = {}) {
  const [module, response] = await Promise.all([
    import('exceljs'),
    fetch(`${import.meta.env.BASE_URL}assets/planilla-hospitalizados.json`),
  ]);
  if (!response.ok) throw new Error('No se pudo cargar la plantilla. Inténtalo de nuevo.');
  const workbook = await buildWorkbook(await response.json(), sheets, module.default, period);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `HORAS_EXTRAS_${group}_hospitalizados_${period}${demo ? '_DEMO' : ''}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
