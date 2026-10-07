# Complemento histórico CUDYR — plan vivo

Solicitud: incorporar el informe mensual Eloísa como respaldo y recuperación
histórica, sin desordenar la tabla principal ni cambiar automáticamente su cálculo.
Base inicial: PR #761 (`ebbc8c5b`). El alcance de cada bloque se puede ajustar
según contratos y pruebas, dejando aquí el motivo antes de ampliar un PR.

## Invariantes de toda la entrega

- El complemento no escribe censos, evaluaciones, fechas estadísticas ni altas.
- No modifica filas, categorías, elegibilidad o totales del modelo principal.
- Una celda fuente no equivale a una aplicación CUDYR individual.
- Conservar mes/día original, identidad, diagnóstico, servicio y condición de alta
  como fueron informados. No inferir episodio, autor, hora ni cama histórica.
- RUT identifica persona; un vínculo con episodio requiere evidencia adicional.
- Repetir un contenido no duplica categorías. Las versiones y diferencias permanecen.
- Consultar/exportar sólo lee HHR; nunca dispara sincronización Eloísa.
- Tabla principal sin columnas nuevas. Evidencia en detalle desplegable y acceso
  separado a históricos adicionales. Excel: hoja complementaria, mismos totales.

## Bloques / PR previstos

| Bloque | Alcance                                                                     | Cierre                                                                                             | Estado                               |
| ------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| A      | Contrato de informe/celda y normalizador de matriz XLS                      | Rechaza formatos ambiguos; reconoce encabezados repetidos y días no contiguos; fixtures sintéticos | Integrado: PR #762                   |
| B      | Archivo persistente complementario, versiones y lectura autorizada          | Idempotencia, permisos, límites, pruebas de servidor/emulador; no escritura clínica                | Pendiente                            |
| C      | Lector XLS, previsualización/importación y consulta discreta con hoja Excel | Navegador escritorio/móvil; principal antes/después idéntico; consulta sin Eloísa                  | Pendiente                            |
| D      | Captura mensual automatizada como adquisición separada                      | Respuesta real validada; identidad de establecimiento/período, completitud y reintentos            | Condicionado a evidencia de descarga |

Cada bloque lleva su propio PR; revisión independiente antes del commit, gates
del repositorio, CI del head y merge autorizado. Las decisiones manuales clínicas,
la sustitución de categorías y la conciliación que altere totales quedan fuera de
este complemento. El cierre mensual inmutable es una ampliación posterior del
respaldo existente, no un requisito para introducir evidencia consultiva.

## Validación transversal

Usar fixtures sintéticos para commits/CI. Analizar archivos reales sólo localmente,
sin datos personales en logs. Probar reingresos, ausencia de documento, cuna/CMA,
medias/intermedias, fechas sin hora, múltiples aplicaciones, discrepancias, límites
de mes y archivos repetidos. Los vínculos no seguros se presentan como posibles
coincidencias, sin asignación automática de episodio/día estadístico.

La publicación de los sitios fijados de Netlify se verifica por separado del merge;
no deducir disponibilidad en vivo a partir de un PR aprobado.

## Actualización de ejecución

- A: integrado en PR #762 (`bc26076a`); 17 casos de normalización y lectura local
  del XLS original (23 pacientes, 68 categorías). Revisión independiente limpia.
- B: servidor documental implementado; pruebas locales de permisos, idempotencia
  concurrente y ausencia de cambios clínicos aprobadas. PR separado.
- C: consulta desplegable, importación confirmada, lectura XLS en worker y hojas
  complementarias. Lector oficial SheetJS 0.20.3 fijado con integridad; worker
  sólo al elegir archivo y fuera del precache, sin aumentar presupuesto global.
- D: los HAR aportados permiten ver la solicitud del informe mensual, pero la
  descarga figura con estado 0 y sin cuerpo de respuesta. Falta verificar una
  respuesta exitosa y su integridad para automatizarla. La importación del archivo
  descargado funciona independientemente; no se simula una captura automática.

Las coincidencias de RUT se muestran como candidatas, nunca como vínculo de
hospitalización. Otros documentos permanecen consultables en el archivo fuente.
La lectura complementaria debe completarse antes de ofrecer el Excel completo;
si falla, se muestra el error y la opción de reintentar. No se oculta una omisión
bajo el nombre de descarga completa.
