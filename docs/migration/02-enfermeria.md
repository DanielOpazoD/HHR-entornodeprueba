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

Cada lote selecciona como máximo cuatro pacientes y ocho campos por día. La salida
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
