import { calculateRutVerifier } from '@/utils/rutUtils';
export interface NursingCandidate {
  name: string;
  rut: string;
  sourceReference: string;
  issue?: string;
}
export const parseNursingCandidates = (
  text: string,
  existingRuts: string[]
): NursingCandidate[] => {
  if (text.length > 20000) throw new Error('Importa hasta 100 candidatos por vez.');
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length > 100) throw new Error('Importa hasta 100 candidatos por vez.');
  const normalized = (rut: string) => rut.replace(/[.\s-]/g, '').toUpperCase();
  const existing = new Set(existingRuts.map(normalized));
  const counts = new Map<string, number>();
  const rows = lines.map(line => {
    const [name = '', rut = '', sourceReference = '', extra] = line
      .split(/[;\t]/)
      .map(value => value.trim());
    const key = normalized(rut);
    counts.set(key, (counts.get(key) || 0) + 1);
    const validRut =
      /^[1-9]\d{6,7}[0-9K]$/.test(key) && calculateRutVerifier(key.slice(0, -1)) === key.at(-1);
    return {
      name,
      rut,
      sourceReference,
      issue: !validRut
        ? 'RUT inválido'
        : name.length < 3 ||
            name.length > 120 ||
            sourceReference.length < 3 ||
            sourceReference.length > 120 ||
            extra !== undefined
          ? 'Usa nombre; RUT; referencia de origen'
          : undefined,
    };
  });
  return rows.map(row => ({
    ...row,
    issue:
      row.issue ||
      (existing.has(normalized(row.rut))
        ? 'Cuenta ya registrada'
        : counts.get(normalized(row.rut))! > 1
          ? 'RUT repetido: revisar identidad'
          : undefined),
  }));
};
