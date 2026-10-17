# Plan conservador de recuperación de enfermería

```sh
node scripts/migration/planNursing.mjs < /ruta/privada/comparacion.json
npx vitest run src/tests/build/migrationNursingPlanner.test.ts
```

Node 24; el planificador reutiliza la validación de RUT de la aplicación. La entrada
privada es `{ "source": { "AAAA-MM-DD": censo }, "target": { "AAAA-MM-DD": censo } }`,
con documentos decodificados y `date` igual a la clave. No guardar entradas clínicas
en Git ni en artefactos CI. No requiere credenciales ni accede a Firebase.

Esta primera vía propone únicamente completar textos diurnos/nocturnos vacíos de
pacientes adultos con RUT válido coincidente, mismo día y turno, sin conflicto
de episodio real o fecha de nacimiento. Se confirma mayoría de edad al día del
censo, mediante nacimiento o edad en años informada. Sin un episodio real común,
se exige fecha de ingreso válida e igual; una diferencia de hora no reemplaza el
ingreso corregido del destino. Se validan también los días exclusivos del destino. No utiliza la cama como identidad. Los IDs
locales `ep_` y `legacy_ep_` no prueban un episodio común entre proyectos.

Los RN, documentos compartidos con RN en cualquier día del lote, pasaportes sin
identidad global verificada, identidad sin documento, copias ambiguas,
reingresos con episodios distintos y textos contradictorios quedan para revisión.
No se infiere un turno para notas antiguas sin turno. La fecha y hora de ingreso del
destino se conserva, aunque la hora antigua difiera. No se mueve ningún paciente,
no se cambia su clasificación y no se recalcula el CUDYR.

La función devuelve propuestas en memoria con ruta y valor previo esperado. El CLI
**solo imprime** fechas, motivos, cantidades y huellas completas de los censos;
jamás los textos, documentos, nombres o rutas de pacientes. No tiene `--apply`.
Una propuesta no es autorización de escritura: antes de una futura importación
se deben releer ambas versiones y aplicar un cambio acotado con precondición y
recibo verificable. El objeto `patches` contiene datos clínicos y no debe persistirse
en informes o logs.

## Selección explícita de un lote de adultos

```sh
node scripts/migration/selectNursingBatch.mjs < /ruta/privada/lote.json
npx vitest run src/tests/build/migrationNursingBatch.test.ts
```

La entrada conserva `source` y `target` y añade `dates` (entre uno y tres días
concretos, desde julio de 2026) y `throughDate` (último día autorizado del lote).
El operador debe fijar ese límite a un día histórico cerrado y excluir el día
actual. No es un reloj clínico ni cambia la fecha de los censos o ingresos.

Reutiliza el planificador anterior y exige además una única representación raíz
por paciente en cada programa, RUT propio válido, nacimiento e ingreso conocidos e
iguales, mayoría de edad, sin cuna ni vínculo RN. El contexto completo aportado
mantiene la protección de documentos maternos compartidos incluso en otros días.
No reducir ese contexto a los días elegidos antes de planificar.

Se aceptan nombres completos iguales, diferencias de puntuación y ampliaciones
ordenadas del nombre. Estas últimas deben conservar el primer nombre y al menos
tres palabras significativas en ambos registros. No se acepta semejanza fonética,
una inicial, reordenamiento de palabras ni la sustitución de un nombre por otro.
El nombre de pruebas siempre se conserva. Estas reglas complementan la identidad;
no reemplazan el RUT, nacimiento ni episodio.

Cada lote selecciona como máximo cuatro pacientes y ocho campos por día, en orden
estable de ruta de destino, independiente del orden de claves devuelto por Firebase.
Una relectura debe verificar las rutas y textos exactos aprobados, sin volver a
escoger otros pacientes por el límite del lote. `resolveNursingNameEvidence`
centraliza solo la comparación de nombres; nunca reemplaza las pruebas de RUT,
nacimiento, episodio y representación única. La salida
incluye cantidades, motivos de retención y huellas de selección; no nombres, RUT,
camas ni textos. La función `selectNursingRootBatch` conserva los cambios propuestos
solo en memoria. No hay red, credenciales ni modo de escritura. Si la entrada ya
contiene el texto guardado, no vuelve a seleccionarlo. Una selección vacía no
demuestra que todos los pendientes estén resueltos.

Antes de escribir se mantienen los controles del ejecutor: versiones exactas de
ambos proyectos, validación clínica y de esquema del día, protección de CUDYR,
transacción acotada, recibo, lectura posterior y repetición sin nuevas escrituras.
Los casos de movimientos, RN, nombres contradictorios y episodios cerrados aún
activos no se fuerzan mediante esta vía.

## Contrato de la entrega completa en el programa receptor

Recuperar las notas individuales no acredita la migración de toda la entrega.
El destino conserva sus componentes, estructura, columnas y formato de impresión;
se adaptan datos al modelo vigente, sin importar HTML, estilos ni contenedores del
programa antiguo. Una descripción extensa debe ajustarse dentro de la tarjeta.
En pantallas estrechas, el desplazamiento pertenece a la tabla, no a toda la página.

La comprobación por fecha del censo debe incluir:

| Bloque                       | Información que debe cotejarse                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Pacientes                    | Notas de enfermería de día y noche, asociadas al paciente y episodio verificados.                           |
| Checklist largo              | Braden, riesgo de caídas y evaluación LPP.                                                                  |
| Checklist nocturno           | Estadística, CUDYR, encuestas de camas, conteos de medicamentos y próxima fecha de conteo.                  |
| Personal                     | Enfermeros que entregan y reciben cada turno, TENS y dotación detallada compatible con las listas vigentes. |
| Altas                        | Paciente/episodio, cama, diagnóstico, tipo, estado y fecha/hora real del egreso.                            |
| Traslados                    | Paciente/episodio, ubicación, diagnóstico, medio, destino, acompañante y fecha/hora del movimiento.         |
| Hospitalización diurna / CMA | Paciente/episodio, ubicación, diagnóstico, especialidad y tipo de intervención.                             |
| Novedades                    | Texto general del turno largo y texto general del turno noche, por separado.                                |

Las tres secciones de movimientos y Novedades deben seguir presentes, incluso sin
registros. Se conserva el filtro vigente por turno: las horas de madrugada
pertenecen al turno nocturno del censo correspondiente; la fecha real del egreso
no se reemplaza por la fecha del censo. CMA mantiene su presentación diurna actual.

Una casilla `false` es un registro desmarcado; no equivale a campo ausente. No se
marca una tarea como realizada por inferencia. La casilla CUDYR del checklist no
es el CUDYR clínico ni modifica el informe oficial, elegibilidad o cumplimiento.

El día entrega la dotación diurna y recibe la nocturna. La noche entrega la
nocturna y recibe la selección explícita `handoffNightReceives`; no se inventa a
partir del día siguiente. Se cotejan `staffingDetailsV1`, listas canónicas y sus
espejos heredados como un conjunto. La dotación no identifica al autor de una nota.
Las firmas históricas se conservan; el catálogo puede reconocer alias explícitos.

Para movimientos se cotejan identidad y episodio, fecha/hora y clasificación;
el ID de fila antiguo por sí solo no prueba igualdad entre proyectos. Se respetan
movimientos corregidos, reclasificaciones y eliminaciones registradas. No se
duplican eventos ni se reemplazan arreglos o snapshots completos del destino.

Las novedades se comparan con los campos almacenados de cada turno. Que la
interfaz muestre el texto diurno como respaldo de una noche vacía no demuestra
que exista una novedad nocturna: ese respaldo visual no se importa como tal.
Se completan únicamente vacíos verificados; textos distintos y valores de
personal ya corregidos se conservan para revisión.

El planificador de notas anterior **no implementa** estos otros bloques. Antes
de recuperarlos se requiere comparación, selección explícita, versiones exactas,
cambio acotado, recibo, relectura y repetición sin duplicados. No se copia el
documento del censo completo ni se recalcula el CUDYR saneado.

## Checklist y novedades almacenadas

```sh
node scripts/migration/planHandoffContext.mjs < /ruta/privada/contexto.json
npx vitest run src/tests/build/migrationHandoffContext.test.ts
```

La entrada contiene `source`, `target`, `dates` y `throughDate`, con la misma forma
por fecha descrita arriba. Seleccionar entre uno y tres días históricos cerrados;
`throughDate` es el último día autorizado. Debe ser anterior al día actual en
Rapa Nui, obtenido del reloj del proceso; no se acepta un corte actual o futuro.
El informe siempre registra selección, corte, día observado y huella del alcance,
incluso cuando no existan candidatos. El reloj del operador debe ser correcto. Ambos documentos deben
existir y declarar exactamente esa fecha. El ejecutor verifica además hospital,
proyectos y versiones; esta herramienta offline no acredita esas comprobaciones.

Propone únicamente casillas booleanas **ausentes** y próximas fechas de conteo
válidas ausentes. Un `false`, `null` o texto vacío ya almacenado en una casilla se
conserva para revisión; no se interpreta como ausencia. Las novedades generales se
completan solo si el campo del mismo turno está ausente, nulo o en blanco. Se usa
el texto almacenado; nunca el respaldo visual del otro turno. No se infieren
cumplimiento, fechas, firmas ni autores. No incluye notas de pacientes, dotación,
movimientos, datos clínicos ni CUDYR saneado.

La salida pública del CLI contiene estados, cantidades, fechas y huellas, sin
textos ni personal. Las propuestas completas permanecen en memoria y requieren
relectura de las versiones exactas, comparación de los campos seleccionados,
precondición de escritura, recibo y verificación posterior. No hay modo de
aplicación ni conexión a Firebase. Repetir sobre datos ya completados no propone
otra escritura. El estado del checklist CUDYR no modifica el informe oficial.
