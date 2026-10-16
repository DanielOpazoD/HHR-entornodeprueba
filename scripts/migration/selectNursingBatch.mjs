import { readFileSync } from 'node:fs';
import { selectNursingRootBatch } from './planNursing.mjs';

try {
  if (process.argv.length !== 2) throw new Error('no_mutation_mode');
  const { report } = selectNursingRootBatch(JSON.parse(readFileSync(0, 'utf8')));
  console.log(JSON.stringify(report));
} catch {
  console.error('Selección detenida; revise fechas e identidad. No se modificaron datos.');
  process.exitCode = 1;
}
