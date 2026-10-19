# Excepciones individuales y evidencia de recuperación

Owner: responsable de transición HHR. Alcance: recuperación acotada en
`hhr-pruebas`, con el antiguo en lectura. Esta guía no autoriza ejecuciones ni
el cambio oficial. Complementa [fuentes y alcance](00-fuentes-y-alcance.md).

## Qué puede ser una excepción

La regla desde julio sigue siendo conservar fechas y horas de pruebas y completar
solo el medio confirmado. Confirmar que dos nombres pertenecen a la misma persona
o que dos registros son el mismo traslado **no autoriza cambiar sus fechas**.

Una excepción requiere confirmación humana expresa del caso y de los campos:

- **Ingreso real durante la transición papel–Eloísa:** distinguir hospitalización
  real de registro informático posterior. Corregir solo las apariciones aprobadas
  del episodio y el ingreso de su movimiento; conservar identificadores existentes
  y no inventar los ausentes. No propagar por cama ni por coincidencia de nombre.
- **Hora de traslado:** tomar la del antiguo únicamente cuando la autorización
  individual la incluya explícitamente. No extenderla a otros eventos o días.
- **Traslado que era alta a domicilio:** reclasificar con los constructores del
  programa, identificador estable y procedencia `reclassified`. Mantener el
  movimiento anterior marcado `converted_to_discharge`, sin duplicarlo entre los
  activos; preservar la hora de pruebas, su ficha original y campos desconocidos.
  No inventar un medio para un alta.

Estas excepciones no reabren septiembre/octubre ni habilitan cambios de CUDYR.
El CUDYR saneado, sus excepciones, cierres y elegibilidad no se recalculan.
Los nombres, documentos, fechas de los casos reales y confirmaciones textuales
se guardan con el respaldo privado, nunca como fixtures, documentación o CI.

## Comprobar el lote aprobado

`scripts/migration/recoveryEvidence.mjs` ofrece comprobaciones puras y reutiliza
`inventoryDigest` para las huellas SHA-256. No tiene cliente Firebase ni escritor.
El CLI `checkRecoveryPlan.mjs` recibe un sobre JSON privado por entrada estándar:

- `approval`: `sourceProject`, `targetProject`, `confirmedBy`, `reason` y `cases`.
- Cada caso: identificador interno `caseId`, versiones `sourceVersion` y
  `targetVersion`, huellas completas `sourceHash` y `targetHash`, y `changes`.
- Cada cambio: `path` como arreglo y valores explícitos `before` y `after`.
  Si importa distinguir un campo ausente de `null`, usar objetos de presencia
  explícita, por ejemplo `{ "present": false }`, en ambos lados del contrato.
- `plan`: exactamente `{ "cases": [...] }`, sin propiedades extra; casos,
  versiones, orden y cambios deben coincidir con lo aprobado.
- `readback`, opcional: `expectedVersion`, `actualVersion`, `expectedHash`,
  `actualHash`, `cudyrBeforeHash` y `cudyrAfterHash`.

Tras revisar el lote, guardar su `inventoryDigest(approval)` por separado. Pasar
esa huella aprobada, no una recalculada automáticamente del archivo que se intenta
validar. Ejemplo de invocación (variables y ruta privadas del operador):

```sh
node scripts/migration/checkRecoveryPlan.mjs "$APPROVED_RECOVERY_SHA256" < /ruta/privada/lote.json
npx vitest run src/tests/build/migrationRecoveryEvidence.test.ts
```

El resultado solo informa conteos/estados, `cloudWrites: 0` y
`authorizesExecution: false`. La ausencia de `readback` se declara `not_provided`;
no significa que se haya comprobado el guardado. Una huella verifica consistencia,
no demuestra por sí sola identidad clínica, autorización humana ni veracidad de
la evidencia. El comprobador **no calcula diferencias clínicas ni determina si
un campo está permitido**: eso se revisa antes de fijar la aprobación.

## Obligaciones del ejecutor y cierre

El ejecutor debe derivar las escrituras del mismo plan comprobado, no de otro
arreglo paralelo. Antes de escribir: respaldo privado, código/versiones fijados,
verificación paciente–episodio–evento, comparación de campos permitidos y
precondición de versión del destino. Un cambio no autorizado exige detenerse.

Guardar intención antes del intento y recibo/auditoría con la escritura atómica
del destino. Ante resultado desconocido, reconciliar por lectura; no reintentar
ciegamente. Comprobar registro completo esperado, versión persistida y CUDYR
protegido; luego hacer una segunda lectura independiente. Repetir el lote debe
producir cero escrituras o rechazarlo como ya aplicado.

Las huellas CUDYR deben cubrir todos los documentos protegidos y el contenido
CUDYR dentro de los registros afectados. El ejecutor calcula esa cobertura; el
comprobador solo compara las huellas que recibe. La igualdad de un subconjunto
no certifica el resto. No presentar una comparación local como prueba en Firebase
ni como comprobación de una nueva sincronización de la extensión.

Dos proyectos Firebase no comparten una transacción. Conservar la evidencia
aprobada del antiguo y verificar su versión antes y después; una variación detiene
los bloques posteriores y exige revisión. No prometer atomicidad entre proyectos
ni escribir en el antiguo para simularla.

Riesgo: aprobar un alcance equivocado o evidencia incompleta. Mitigación: revisión
individual, plan exacto, precondiciones y lectura posterior. Rollback: preparar una
reversión de los campos afectados desde el respaldo, con nuevas precondiciones y
revisión; nunca restaurar ciegamente el documento completo sobre cambios recientes.
Cierre técnico de esta herramienta: `ci:pre-merge`, revisión independiente y CI del
head publicado. Su aprobación no autoriza un lote clínico ni reemplaza su validación.
