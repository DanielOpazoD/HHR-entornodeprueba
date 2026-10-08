import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../src/export.mjs';
import { initialMonth } from '../src/domain/month.mjs';
const template = JSON.parse(
  await readFile(new URL('../public/assets/planilla-hospitalizados.json', import.meta.url), 'utf8')
);
test('Excel round trip preserves template, night column, cached totals, print and empty-record summary', async () => {
  const sheets = initialMonth().sheets.filter(sheet => sheet.group === 'TENS');
  const book = await buildWorkbook(template, sheets, ExcelJS);
  const decoded = new ExcelJS.Workbook();
  await decoded.xlsx.load(await book.xlsx.writeBuffer());
  assert.equal(decoded.worksheets.length, 2);
  assert.equal(decoded.worksheets[0].name, 'Sin registros');
  assert.equal(decoded.worksheets[0].getCell('A4').value, 'María Ejemplo');
  const sheet = decoded.worksheets[1];
  assert.equal(sheet.getCell('E12').value, 'Turno noche (20:00–09:00)');
  assert.equal(sheet.getCell('B12').value, null);
  assert.equal(sheet.getCell('B23').value, 'Turno largo (08:00–20:00)');
  assert.equal(sheet.getCell('D4').value, 'HOSPITALIZADOS');
  for (const cell of ['D3', 'D5', 'A44']) assert.equal(sheet.getCell(cell).value, null);
  for (const [cell, total] of [
    ['C40', 25],
    ['D40', 13],
    ['E40', 12],
    ['C41', 25],
    ['C42', 13],
    ['C43', 12],
  ])
    assert.equal(sheet.getCell(cell).result, total);
  for (let col = 7; col <= 16; col++) assert.equal(sheet.getColumn(col).hidden, true);
  assert.equal(sheet.pageSetup.printArea, 'A1:E47');
  assert.equal(sheet.pageSetup.paperSize, 1);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 1);
});
test('empty staff are identified as without records; duplicate names keep separate forms', async () => {
  const sheets = initialMonth().sheets;
  sheets[1].name = sheets[0].name;
  const book = await buildWorkbook(template, sheets, ExcelJS);
  assert.equal(book.worksheets[0].rowCount, 4);
  assert.match(book.worksheets[0].getCell('A2').value, /sin turnos registrados/);
  assert.equal(book.worksheets.length, 4);
  assert.equal(new Set(book.worksheets.map(sheet => sheet.name)).size, 4);
});

test('calendar-sized exports keep day 31 in totals and hide invalid February dates', async () => {
  const { makeShift } = await import('../src/domain/overtime.mjs');
  for (const [period, count] of [
    ['2026-10', 31],
    ['2027-02', 28],
  ]) {
    const person = initialMonth(period).sheets[0];
    person.shifts = [makeShift({ date: `${period}-${count}`, kind: 'night' })];
    const book = await buildWorkbook(template, [person], ExcelJS, period);
    const roundTrip = new ExcelJS.Workbook();
    await roundTrip.xlsx.load(await book.xlsx.writeBuffer());
    const sheet = roundTrip.worksheets[1];
    assert.equal(sheet.getCell(`A${count + 8}`).value, count);
    assert.match(sheet.getCell(`E${count + 8}`).value, /Turno noche/);
    assert.equal(sheet.getCell('C40').formula, 'SUM(N9:N39)');
    assert.equal(sheet.getCell('C40').result, count === 31 ? 13 : 12);
    if (count === 28) for (const row of [37, 38, 39]) assert.equal(sheet.getRow(row).hidden, true);
  }
  await assert.rejects(buildWorkbook(template, initialMonth().sheets, ExcelJS, '2027-02'));
});
