import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const text = value => String(value ?? '').replace(/[|<>\r\n]/g, ' ');
const seconds = milliseconds => `${(milliseconds / 1000).toFixed(1)} s`;

export const renderPreviewSummary = report => {
  if (!Array.isArray(report.suites) || !report.stats) throw new Error('Informe incompleto');
  const groups = new Map();
  const failures = [];
  const walk = suites => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        const group = spec.file?.endsWith('clinical-library-smoke.spec.ts')
          ? 'Biblioteca: documentos y herramientas'
          : spec.file?.endsWith('census-preview-bootstrap.spec.ts')
            ? spec.title.startsWith('keeps navigation')
              ? 'Censo: navegación adaptable'
              : 'Censo: arranque y recargas'
            : 'Otras comprobaciones';
        const row = groups.get(group) ?? { passed: 0, total: 0, duration: 0 };
        for (const test of spec.tests ?? []) {
          row.total += 1;
          row.passed += Number(test.status === 'expected');
          row.duration += (test.results ?? []).reduce((sum, result) => sum + result.duration, 0);
          if (test.status !== 'expected') {
            failures.push(
              `- ${text(spec.file)}:${spec.line} — ${text(spec.title)} (${text(test.status)})`
            );
          }
        }
        groups.set(group, row);
      }
      walk(suite.suites ?? []);
    }
  };
  walk(report.suites);
  const rows = [...groups].map(
    ([label, row]) =>
      `| ${label} | ${row.total > 0 && row.passed === row.total ? '✅' : '⚠️'} ${row.passed}/${row.total} | ${seconds(row.duration)} |`
  );
  return [
    '## Preview: censo y biblioteca',
    '',
    '| Comprobación | Aprobadas | Tiempo de pruebas |',
    '|---|---:|---:|',
    ...rows,
    '',
    `Duración total: ${seconds(report.stats.duration)}.`,
    ...(rows.length ? [] : ['⚠️ No se ejecutaron pruebas.']),
    ...(report.errors?.length ? ['⚠️ Hubo errores globales: revisar el reporte completo.'] : []),
    ...(failures.length ? ['', '### Revisar', ...failures] : []),
    '',
    'Reporte, capturas y trazas disponibles en los artefactos de esta ejecución.',
  ].join('\n');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let summary;
  try {
    summary = renderPreviewSummary(
      JSON.parse(fs.readFileSync('reports/e2e/preview-bootstrap/report.json', 'utf8'))
    );
  } catch {
    summary =
      '## Preview: censo y biblioteca\n\n⚠️ Reporte ausente o inválido. Revisar el paso de compilación/preview y sus logs.';
    process.exitCode = 1;
  }
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID) {
    summary += `\n\n[Ver ejecución y artefactos](https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}#artifacts)`;
  }
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}
