# Validación del diseño mínimo

El usuario pidió priorizar ingreso, clave libre, turnos propios y descarga mensual
por ADMIN. La propuesta anterior de aprobación/cierre queda sustituida.

## Decisiones visuales

Blanco `#ffffff`, texto `#203246`, secundario `#607080`, líneas `#dce3e7`, acento
`#17687b`. Inter como única familia. Encabezado HHR discreto y contenido centrado;
sin barra lateral, tarjetas de estados o panel de actividad. Año/mes antes del
calendario; calendario a la izquierda y registros a la derecha en PC, apilados en
móvil. El único acento fuerte marca el día elegido y el botón Registrar turno.

ADMIN: dos secciones visibles (TENS/Enfermería), cada una con descarga y tabla simple.
Trabajador: calendario, tres totales y registros editables. Ingreso: RUT/clave y
selector de perfiles ficticios plegado. Cambio inicial y posterior sin requisitos
de longitud/complejidad, solo presencia y confirmación.

## Comprobación

Las pruebas de dominio cubren cambios directos sin estados, restricciones de
pertenencia, superposición, separación por período, cálculo y exportación. Las
acciones de cierre/aprobación anteriores se rechazan por no estar disponibles.
Las pruebas de clave cubren un carácter y cambios posteriores en la sesión.
La exportación enumera personas sin registros sin atribuirles declaración de cero.

La evidencia de navegador se entrega en el chat. No se ha probado hardware móvil
real ni lectores de pantalla. No es un servicio productivo: estado solo en memoria.

Validación en navegador completada a 390 y 1440 px: primer acceso con clave de un
carácter, cambio posterior y reingreso (la clave anterior se rechaza), alta/edición/
eliminación sin envío ni aprobación, cambio de mes conservando registros y ADMIN
con ambas descargas separadas. Sin errores de consola ni desborde horizontal.
Las capturas finales muestran calendario/registro móvil y administración en ambos
anchos. El aviso de descarga se comprobó; el contenido XLSX se valida por round-trip.

La revisión independiente detectó que el primer cambio aceptaba reutilizar la clave
inicial. Se corrigió: ese paso exige una clave distinta, sin longitud ni complejidad
mínima adicional. Los cambios posteriores conservan la elección libre. Prueba de
regresión específica incluida.

## Compactación — 8 de octubre de 2026

Se comprobaron las vistas de trabajador, registro y ADMIN a 390 y 1440 px.
La descarga personal conserva el mismo generador institucional; ADMIN mantiene
archivos separados para TENS y Enfermería. La observación opcional se pliega para
dejar Guardar turno visible. Este PR conserva la demo en memoria.

## Compactación y servicio en nube — 8 de octubre de 2026

- Encabezado y separaciones reducidos; descarga personal visible junto al título.
- Formulario con horario y total en una fila, observación plegada y acciones juntas.
- ADMIN conserva Mis horas y Planillas del equipo, con archivos por grupo separados.
- API con Firestore independiente: sesiones, cambio de clave, lectura mensual y
  escritura transaccional propia. Demo y modo nube explícitos y sin fallback.
- Verificación local: clave de un carácter, turno previo a festivo, recarga con
  lectura persistente, exportación personal y consulta de ambos grupos como ADMIN.
- Pruebas de servidor: permisos, cambio inicial, conflictos de revisión, solapamiento
  entre meses, sesión caducada, cierre de sesión y bloqueo de intentos repetidos.
- Integración con Firestore Emulator: escritura concurrente, nueva instancia de API,
  lectura posterior y conjunto ADMIN, usando exclusivamente perfiles sintéticos.
