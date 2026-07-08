# ADR: Daily Census Clinical Data Ownership

**Estado:** Vigente

## Decisión

El censo diario debe tratar la información clínica como propiedad del episodio clínico, no de la cama.

La cama representa una ubicación operativa. El paciente puede moverse entre camas durante la misma hospitalización, pero su narrativa clínica, documentos, diagnósticos, especialidad, estado y movimientos deben seguir asociados al mismo episodio. En cambio, un alta real seguida de un nuevo ingreso debe crear o resolver un episodio distinto, incluso si ocurre el mismo día y corresponde al mismo RUT.

## Reglas de identidad

La identidad preferida es `clinicalEpisodeId`.

Mientras existan registros legacy, el fallback aceptado es:

1. `clinicalEpisodeId`.
2. RUT + fecha de ingreso o `firstSeenDate` + hora de ingreso.
3. RUT + fecha de ingreso o `firstSeenDate`, solo como compatibilidad legacy mínima.

RUT + fecha por sí solo no es suficiente para modelar reingresos del mismo día. Los pacientes nuevos deben recibir `clinicalEpisodeId` al ingreso; el fallback existe para lectura y compatibilidad, no como modelo futuro.

## Paciente en cama activa

Una cama activa muestra el paciente actualmente hospitalizado en esa ubicación.

Debe resolver documentos e indicadores desde el episodio del paciente activo. Si la cama fue ocupada antes por otro paciente, esos documentos no deben aparecer como presencia documental del nuevo paciente.

## Cambio de cama durante hospitalización

Un cambio de cama sin alta no crea un nuevo episodio.

La ubicación cambia, pero se preservan:

- `clinicalEpisodeId`.
- Documentos clínicos.
- Narrativa y eventos clínicos.
- Diagnóstico, especialidad y estado clínico.
- Datos administrativos del ingreso.

El traslado interno debe registrarse como hecho operacional, pero no debe partir la historia clínica.

## Alta domiciliaria y CMA

Alta y CMA son movimientos históricos del episodio.

Cada movimiento debe conservar un snapshot suficiente del paciente/caso al momento del egreso. Ese snapshot es la fuente para abrir documentos clínicos, generar egresos estadísticos o revisar el caso después de que la cama ya fue reutilizada.

Las acciones de alta y CMA deben permitir visualizar documentos clínicos asociados al caso histórico sin depender de la cama activa.

## Alta y reingreso el mismo día

Un alta real seguida de reingreso es un nuevo episodio, aunque el RUT y la fecha calendario sean iguales.

El nuevo episodio no debe heredar automáticamente:

- Documentos clínicos.
- Evoluciones o narrativa.
- Estado clínico.
- Especialidad u otra especialidad libre.
- Diagnósticos.

Si el registro nuevo tiene `clinicalEpisodeId` canónico, no debe consultar claves legacy del episodio anterior para mostrar presencia documental.

## Persistencia y sincronización

La persistencia debe proteger hechos clínicos contra sesiones antiguas o datos locales atrasados.

- Los movimientos eliminados deben quedar con tombstone (`deletedAt`, `deletedBy`, `deletedReason`) en vez de desaparecer de forma destructiva.
- Un tombstone remoto debe impedir que una cola local antigua resucite el movimiento.
- La cola local debe revalidar versión, episodio y cama esperada antes de publicar mutaciones pendientes.
- Las reconciliaciones de especialidad, otra especialidad, estado, diagnóstico y documentos deben respetar el episodio, no solo la posición de la cama.

## Documentos clínicos

Los documentos clínicos pertenecen al episodio.

En cama activa, los indicadores y accesos deben considerar solo documentos compatibles con el episodio y RUT actual. En altas y CMA, los accesos deben abrir documentos usando el snapshot histórico del movimiento y su `clinicalEpisodeId`, no la cama activa.

Si un documento clínico permite editar datos demográficos usados por documentos derivados, esos datos editados deben ser la fuente de los derivados, no una relectura posterior de la cama.

## Compatibilidad legacy

La compatibilidad histórica debe ser mínima y explícita.

El sistema puede hidratar o resolver datos antiguos para lectura, pero no debe relajar las validaciones de escritura nuevas ni seguir ampliando heurísticas como modelo principal. Cualquier fallback que use RUT + fecha debe considerarse débil y reemplazable por `clinicalEpisodeId` cuando el caso tenga datos modernos.

## Resultado esperado

Estos escenarios deben mantenerse seguros:

1. Paciente cambia de cama: conserva documentos e historia porque conserva episodio.
2. Paciente egresa y la cama se reutiliza: el nuevo paciente no ve documentos del anterior.
3. Paciente egresa y reingresa el mismo día: son dos episodios distintos.
4. CMA queda egresado: sus documentos siguen accesibles desde el movimiento.
5. Una sesión antigua no pisa cambios clínicos más nuevos sin revalidación.
6. Un movimiento eliminado no reaparece por sincronización vieja.
