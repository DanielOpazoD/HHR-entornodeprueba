# Engineering Definition Of Done

Una change queda lista solo si cumple todo lo siguiente:

1. `npm run typecheck`, `npm run lint`, `npm run check:quality` y `npm run build` pasan en verde.
2. No introduce warnings en `src/`.
3. Si toca flujos críticos, agrega o ajusta tests automatizados.
4. Si cambia boundaries, wiring o contratos, actualiza documentación/ADR en la misma change.
5. No agrega bypasses a `application`, `shared/access` ni providers obligatorios.
6. No deja excepciones abiertas sin owner, motivo y criterio de cierre documentados.
7. Si toca un subsistema crítico, mantiene actualizado `scripts/config/technical-ownership-map.json` con owner, gate y runbook vigentes.
8. Si la change entra en una categoría gobernada, sigue `scripts/config/sustainable-change-policy.json` y deja evidencia del gate o artefacto requerido.
9. Si incluye lógica de app, assets estáticos o snapshots de `reports/`, separa esos concerns en commits distintos cuando no dependan del mismo fix.

Para instrumentación de transacciones clínicas, demostrar que los callbacks
fallidos y reintentados se cuentan sin duplicar etapas, que la telemetría no incorpora
campos ni identificadores clínicos y que el replay exacto mantiene sus escrituras
idempotentes. Los tiempos internos orientan una optimización posterior; no prueban
por sí solos una mejora de velocidad. Conservar orden de lecturas, autoridad y
atomicidad, y ejecutar el pack de confianza de release para cambios del handler.

El rollout regional clínico conserva el endpoint anterior mientras existan clientes
que lo usen. Verificar ambas regiones desplegadas antes de cambiar el cliente;
no confundir una región declarada con un despliegue disponible ni con una mejora medida.

Un cambio del cliente regional requiere demostrar invocación autenticada y rechazo
sin sesión, conservar el timeout y no duplicar solicitudes ante errores. Separar
replays de recibos de escrituras nuevas al medir rendimiento; conservar las muestras
lentas y declarar el tamaño y alcance del experimento. Una mejor mediana no acredita
mejorar la cola de latencia ni el tiempo de la sincronización completa.

Para cambios en inicio de sesión o recarga autenticada, verificar que el eco inicial
del observer no readmita una sesión idéntica, sin saltar la admisión pendiente,
los cambios de permisos ni el cierre de sesión. Los providers diferidos no deben
remontar la interfaz clínica ni borrar estado de controles al completar su carga.

Para exportaciones y respaldos, el vencimiento de la espera de guardado no equivale
a un censo listo. Probar el guardado pendiente, el fallo de guardado y el cambio de
día durante la espera o la confirmación; ninguno debe generar archivos, abrir la
impresión ni marcar un respaldo como archivado. Una copia local válida no exige
confirmación remota. Un getter que devuelve `null` no autoriza reutilizar un registro
anterior. La impresión del DOM vuelve a comprobar el día justo antes de abrirse.

El Excel mensual conserva su rango explícito hasta el día elegido y puede incluir
días anteriores aunque ese día esté vacío. Este permiso no aplica a exportaciones
o respaldos diarios y no evita comprobar guardado, fallo y cambio de fecha.

Los detalles de signos y scores se cargan al activarlos, manteniendo el resumen
del censo disponible. Verificar apertura, cierre durante la carga, respuesta tardía
y fallo del módulo sin remontar el censo ni recargar una edición. Las lecturas,
rangos clínicos e historiales conservan sus contratos. Medir la unión de chunks
estáticos del shell y del censo con la misma configuración: mover código entre
archivos sin reducir esa unión no acredita una mejora del arranque.

El historial completo debe recorrer todas las páginas sin inventar episodios
a partir de un prefijo. Mantener identidad de RN, movimientos borrados y
continuidad entre páginas; diferenciar servidor completo de fallback local.
Probar cancelación, progreso y resultados tardíos contra la selección vigente,
y no persistir una lectura parcial en la caché de historias completas. Una
proyección reducida no autoriza eliminar datos de los censos editables ni acredita
menor uso de memoria del SDK. Documentar los límites de consistencia y latencia.

Para cambios de renderizado del censo, medir con el proveedor real y con JSX nuevo
del padre; una identidad estable aislada no demuestra que se omita el subárbol.
Probar cambios de fecha, ausencia de registro, dotación, movimientos, tombstones
y permisos. Conservar las revisiones del registro en los consumidores que las
necesitan para escribir. Un conteo de renders no acredita una mejora de INP.
