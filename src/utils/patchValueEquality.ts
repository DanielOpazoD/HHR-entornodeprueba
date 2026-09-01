/**
 * Igualdad profunda con semántica de PARCHE del registro diario: los valores
 * son JSON-planos (primitivos, arreglos, objetos simples) y una clave con
 * `undefined` equivale a una clave ausente (así se expresa el borrado, y así
 * normaliza Firestore). Se usa para emitir solo los campos que realmente
 * cambian en un gesto del censo — los reenvíos del paciente completo con
 * valores idénticos disparaban side-effects y escrituras vacías.
 */
export const arePatchValuesDeepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const bArray = b as unknown[];
    return (
      (a as unknown[]).length === bArray.length &&
      (a as unknown[]).every((item, index) => arePatchValuesDeepEqual(item, bArray[index]))
    );
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)]);
  for (const key of keys) {
    if (!arePatchValuesDeepEqual(aRecord[key], bRecord[key])) return false;
  }
  return true;
};
