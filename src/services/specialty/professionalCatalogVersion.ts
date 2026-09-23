/**
 * Versión de contenido del catálogo profesional. La misma cadena se calcula
 * en el cliente (fábrica de evidencia) y en el backend de recomendaciones:
 * depende SOLO del contenido relevante del catálogo (identidad estable +
 * especialidad asignada), nunca de metadatos del documento — así la huella
 * de evidencia coincide en ambos lados para los mismos datos.
 */
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { professionalCatalogKey } from '@/services/staff/treatingPhysicianCatalog';

const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const professionalCatalogVersionOf = (
  catalog: readonly ProfessionalCatalogItem[]
): string => {
  const canonical = catalog
    .map(item => `${professionalCatalogKey(item)}|${item.specialty?.trim() ?? ''}`)
    .sort()
    .join('||');
  return `prof:${catalog.length}:${fnv1a(canonical)}`;
};
