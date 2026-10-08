# Horas extras: decisiones del prototipo

Aplicación web responsive para Hospitalizados, TENS y Enfermería. Mantenerla aislada
del runtime clínico, Firebase clínico y login HHR. Servicio propio en proyecto
Firebase independiente, autorizado por Daniel el 8 de octubre de 2026. Ejecutar y comprobar el servidor local, sin pedir al usuario
que lo arranque si puedes hacerlo.

## Alcance vigente: simplificación solicitada el 7 de octubre de 2026

Priorizar únicamente ingreso, cambio de clave, registro propio de turnos y descarga
mensual por grupo para ADMIN. Clave libre: sin longitud mínima adicional ni reglas
de complejidad; campo escrito y confirmación coincidente. Cambio obligatorio inicial
(debe ser distinta a la inicial) y opción de volver a cambiarla después del ingreso.

Decisión reafirmada por Daniel el 8 de octubre de 2026: la clave inicial es el
RUT sin puntos ni dígito verificador. Tras el primer login, exigir cambio antes de
acceder a datos o turnos. Se informó el riesgo de acceso anticipado por conocer el
RUT; Daniel mantuvo expresamente este flujo. No agregar enlaces de activación ni
claves iniciales aleatorias. Conservar hash, sesiones privadas y límites de intentos.

Eliminar envío, aprobación, observaciones de revisión, cierres/reaperturas,
bloqueos, declaraciones y actividad administrativa. El permiso ADMIN se suma a
Mis turnos; no otorga edición de turnos ajenos. TENS/Enfermería deben aparecer
separados en la descarga. Año/mes preceden a días, con registros independientes.

Diseño mínimo: fondo blanco, Inter, encabezado discreto HHR, un acento azul petróleo,
navegación horizontal y sin barra lateral. Calendario y registros, sin paneles de
estados. Conservar nombre/horario de turnos y totales legibles en móvil.

Excel institucional: noche en E, calidad/grado vacíos, sin nota al pie, 28/30/31 días.
Primera hoja identifica personas sin registros; no generarles hoja individual ni
atribuirles una declaración de cero. La demo conserva datos sintéticos en memoria;
el modo nube usa exclusivamente el servidor. Años cubiertos 2026/2027.

Interfaz compacta con descarga personal visible. Confirmar guardado solo tras
respuesta exitosa del servidor. Mantener claves libres y permisos por propietario.
ADMIN descarga TENS y Enfermería por separado. No añadir cierres ni aprobaciones.
No mezclar cuentas de prueba con funcionarios en la base publicada.
La profesión y ADMIN son independientes: Daniel es Médico; otros ADMIN pueden
pertenecer a Enfermería. Admitir Médico en perfil/Excel personal, sin incluirlo en
los archivos de equipo TENS/Enfermería ni atribuir ADMIN por la profesión.
Consultar cloud-setup.md antes de configurar o desplegar el servicio.

Mantener `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`
y `tests/sites-worker.test.mjs` para posible handoff. Validar con build y test:sites.
Registrar aquí futuras decisiones duraderas de diseño, sin reintroducir funciones
administrativas retiradas hasta que el usuario las solicite.

Compactación del 8 de octubre: descargar Excel personal junto al título; reducir
separaciones; observación del turno opcional y plegada; guardar/cancelar en una fila.
