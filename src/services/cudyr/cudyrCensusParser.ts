import type { CudyrSupplementMatrix } from '@/types/domain/cudyrSupplement';
import type { CudyrCensusSource } from '@/types/domain/cudyrCensusEvidence';
export const parseCudyrCensusSource = (matrix: CudyrSupplementMatrix): CudyrCensusSource => {
  const { rows } = matrix;
  const dateLabel = rows
    .slice(0, 6)
    .flat()
    .map(String)
    .find(v => /^Fecha: \d{2}-\d{2}-\d{4}$/.test(v.trim()));
  const d = dateLabel?.match(/(\d{2})-(\d{2})-(\d{4})/);
  const headerIndex = rows.findIndex(r =>
    ['NOMBRES Y APELLIDOS', 'ALTA', 'TRASLADO', 'FALLECIDO'].every(column => r.includes(column))
  );
  if (!d || headerIndex < 0 || !rows.slice(0, 6).flat().includes('CENSO DIARIO DE PACIENTES'))
    throw new Error('Formato de censo Eloísa no reconocido.');
  const date = `${d[3]}-${d[2]}-${d[1]}`;
  const h = rows[headerIndex];
  const nonempty = rows.slice(headerIndex + 1).filter(r => r.some(v => String(v ?? '').trim()));
  const body = nonempty.filter(r => {
    if (String(r[h.indexOf('NOMBRES Y APELLIDOS')] || '').trim() === 'TOTALES' && !r[0])
      return false;
    if (!/^\d+$/.test(String(r[0])) || Number(r[0]) < 1)
      throw new Error('Fila censal no reconocida; lectura incompleta.');
    return true;
  });
  if (body.length > 500) throw new Error('Censo fuera de límites.');
  const patients = body.map(r => {
    const name = String(r[h.indexOf('NOMBRES Y APELLIDOS')] || '').trim();
    const flag = (column: string) => {
      const v = String(r[h.indexOf(column)] || '')
        .trim()
        .toUpperCase();
      if (!['SI', 'NO'].includes(v)) throw new Error('Movimiento censal no reconocido.');
      return v === 'SI';
    };
    if (!name) throw new Error('Identidad censal vacía.');
    return {
      name,
      discharged: flag('ALTA'),
      transferred: flag('TRASLADO'),
      deceased: flag('FALLECIDO'),
    };
  });
  return { date, patients };
};
