/**
 * report-parser.js  (extension — UMD: importScripts() in the SW, require() in a node test)
 *
 * Parses the Eloísa "Lista de Pacientes con Alta Administrativa" Jasper .xls (BIFF8) into
 * plain egreso rows. Columns are matched by HEADER NAME (not a fixed index), so the parser
 * survives Jasper padding/reordering columns. Structure (confirmed live): a few title rows,
 * then a header row containing "N° Ident." + "Destino de Alta", then one row per egreso.
 *
 * Returns rows: { run, patientName, bedLabel, servicio, edad, destino, motivo, fechaEgreso }.
 */
(function (root) {
  'use strict';

  var normalize = function (value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  };

  // field -> predicate on a normalized header cell. First matching column wins.
  var FIELD_MATCHERS = [
    ['run', function (h) { return h.indexOf('ident') !== -1; }], // "N° Ident."
    ['patientName', function (h) { return h.indexOf('nombre') !== -1; }], // "Nombre Paciente"
    ['bedLabel', function (h) { return h.indexOf('cama') !== -1; }], // "Cama"
    ['servicio', function (h) { return h.indexOf('servicio') !== -1; }], // "Servicio"
    ['edad', function (h) { return h.indexOf('edad') !== -1; }], // "Edad"
    ['destino', function (h) { return h.indexOf('destino') !== -1; }], // "Destino de Alta"
    ['motivo', function (h) { return h.indexOf('motivo') !== -1; }], // "Motivo de Alta"
    ['fechaEgreso', function (h) { return h.indexOf('egreso') !== -1 && h.indexOf('fecha') !== -1; }],
    ['diagnostico', function (h) { return h.indexOf('diagnostico') !== -1 && h.indexOf('principal') !== -1; }], // "Diagnóstico Principal"
  ];

  var looksLikeRun = function (value) {
    var digits = String(value == null ? '' : value).replace(/[^0-9kK]/g, '');
    return digits.length >= 2;
  };

  // rows: array-of-arrays. Returns { headerRowIndex, colMap } or null.
  var findHeader = function (rows) {
    for (var r = 0; r < rows.length; r++) {
      var norm = (rows[r] || []).map(normalize);
      var hasIdent = norm.some(function (h) { return h.indexOf('ident') !== -1; });
      var hasDestino = norm.some(function (h) { return h.indexOf('destino') !== -1; });
      if (!hasIdent || !hasDestino) continue;
      var colMap = {};
      for (var c = 0; c < norm.length; c++) {
        for (var m = 0; m < FIELD_MATCHERS.length; m++) {
          var field = FIELD_MATCHERS[m][0];
          if (colMap[field] === undefined && norm[c] && FIELD_MATCHERS[m][1](norm[c])) {
            colMap[field] = c;
          }
        }
      }
      return { headerRowIndex: r, colMap: colMap };
    }
    return null;
  };

  var cellText = function (row, index) {
    if (index === undefined || index === null) return '';
    var v = row[index];
    return v == null ? '' : String(v).trim();
  };

  var parseRows = function (rows) {
    var header = findHeader(rows);
    if (!header || header.colMap.run === undefined) return [];
    var colMap = header.colMap;
    var out = [];
    for (var r = header.headerRowIndex + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var run = cellText(row, colMap.run);
      if (!looksLikeRun(run)) continue;
      out.push({
        run: run,
        patientName: cellText(row, colMap.patientName),
        bedLabel: cellText(row, colMap.bedLabel),
        servicio: cellText(row, colMap.servicio),
        edad: cellText(row, colMap.edad),
        destino: cellText(row, colMap.destino),
        motivo: cellText(row, colMap.motivo),
        fechaEgreso: cellText(row, colMap.fechaEgreso),
        diagnostico: cellText(row, colMap.diagnostico),
      });
    }
    return out;
  };

  // XLSX = SheetJS; data = ArrayBuffer / Uint8Array of the .xls file.
  var parseWorkbook = function (XLSX, data) {
    var wb = XLSX.read(data, { type: 'array' });
    var sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    return parseRows(rows);
  };

  var api = { parseWorkbook: parseWorkbook, parseRows: parseRows, findHeader: findHeader };
  root.RayenReportParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
