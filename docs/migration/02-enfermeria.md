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
