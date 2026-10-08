# Horas extras: decisiones del prototipo

Aplicación web responsive para Hospitalizados, TENS y Enfermería. Mantenerla aislada
del runtime clínico, Firebase, identidades reales y login HHR hasta implementar la
etapa de servicio real. Ejecutar y comprobar el servidor local, sin pedir al usuario
que lo arranque si puedes hacerlo.

## Alcance vigente: simplificación solicitada el 7 de octubre de 2026

Priorizar únicamente ingreso, cambio de clave, registro propio de turnos y descarga
mensual por grupo para ADMIN. Clave libre: sin longitud mínima adicional ni reglas
de complejidad; campo escrito y confirmación coincidente. Cambio obligatorio inicial
(debe ser distinta a la inicial) y opción de volver a cambiarla después del ingreso.

Eliminar envío, aprobación, observaciones de revisión, cierres/reaperturas,
bloqueos, declaraciones y actividad administrativa. El permiso ADMIN se suma a
Mis turnos; no otorga edición de turnos ajenos. TENS/Enfermería deben aparecer
separados en la descarga. Año/mes preceden a días, con registros independientes.

Diseño mínimo: fondo blanco, Inter, encabezado discreto HHR, un acento azul petróleo,
navegación horizontal y sin barra lateral. Calendario y registros, sin paneles de
estados. Conservar nombre/horario de turnos y totales legibles en móvil.

Excel institucional: noche en E, calidad/grado vacíos, sin nota al pie, 28/30/31 días.
Primera hoja identifica personas sin registros; no generarles hoja individual ni
atribuirles una declaración de cero. Demostración explícita, datos sintéticos,
estado solo en memoria. Años cubiertos 2026/2027.

Mantener `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`
y `tests/sites-worker.test.mjs` para posible handoff. Validar con build y test:sites.
Registrar aquí futuras decisiones duraderas de diseño, sin reintroducir funciones
administrativas retiradas hasta que el usuario las solicite.

Compactación del 8 de octubre: descargar Excel personal junto al título; reducir
separaciones; observación del turno opcional y plegada; guardar/cancelar en una fila.
