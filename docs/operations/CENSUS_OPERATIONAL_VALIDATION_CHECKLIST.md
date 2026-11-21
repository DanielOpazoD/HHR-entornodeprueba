# Censo Operational Validation Checklist

## Objetivo

Validar en operación real los cambios recientes de `Censo Diario` que ya tienen cobertura automatizada, pero que conviene confirmar en Netlify con flujos clínicos reales.

## Cuándo usarlo

- Después de una ola que toque `PatientRow`, `dailyRecord`, catálogos de staff o creación/copia de días.
- Antes de cerrar una iteración clínica importante del censo.
- Cuando soporte o negocio quiera confirmar que una corrección ya quedó bien en UI real.

## Entorno recomendado

- Mismo navegador con dos pestañas para escenarios cross-tab.
- Idealmente un segundo equipo o perfil limpio para validar desfase de storage local.
- Usar una fecha de censo concreta `X` y, cuando aplique, validar también `X-1` y `X+1`.

## Escenarios obligatorios

### 1. Staff cross-tab en segunda pestaña

1. Abrir `Censo Diario` en pestaña `A`.
2. Confirmar que enfermería/TENS ya tiene nombres visibles.
3. Abrir una pestaña `B` del mismo navegador y entrar al mismo día del censo.
4. Verificar que los nombres aparezcan de inmediato sin requerir cambiar de pestaña.
5. Cambiar un nombre en `A`, guardar y recargar o abrir `B`.

Resultado esperado:

- La segunda pestaña no muestra selects vacíos si el `dailyRecord` ya tiene nombres.
- El valor actual se mantiene visible aunque el catálogo tarde un poco en hidratar.
- Al converger el catálogo, la lista queda completa sin perder el valor seleccionado.

### 2. Crear nuevo día por copia

1. Elegir una fecha de censo `X`.
2. Crear `X+1` usando la función de copia.
3. Confirmar que la base copiada corresponde exactamente a `X`, no al “último disponible”.
4. Repetir la prueba con un navegador o perfil que tenga local storage desfasado.

Resultado esperado:

- La copia usa por defecto solo `X-1` del nuevo día.
- Si el equipo local está atrasado, la app sincroniza `X-1` antes de copiar.
- No se copian datos desde `X-2` u otro día más antiguo por error.

### 3. Fecha de ingreso anclada al primer día observado

1. En la pestaña del día `X`, ingresar un paciente nuevo.
2. Configurar por error la `fecha de ingreso` como `X+1`.
3. Intentar volver a editar la fecha en la misma pestaña `X`.
4. Avanzar a la pestaña `X+1` y verificar que allí el campo no quede editable solo por la fecha digitada.

Resultado esperado:

- La edición depende del primer día observado en el censo (`firstSeenDate`), no de la fecha digitada por error.
- Si el paciente apareció por primera vez en `X`, se puede corregir en `X` aunque se haya guardado `X+1`.
- Fuera del día correcto, el campo queda bloqueado.

### 4. Selector integrado de fecha y hora de ingreso

1. Abrir el editor de fecha de ingreso desde una fila editable.
2. Confirmar que fecha y hora aparecen en el mismo cuadro.
3. Verificar que el campo visible no corte el año.
4. Confirmar que el ícono de edición solo aparece cuando la edición está permitida.

Resultado esperado:

- Fecha y hora se configuran en un solo flujo corto.
- La fecha visible usa el ancho de la columna, no un ancho artificial reservado al ícono.
- En filas no editables solo se ve la fecha, sin flecha ni iconografía extra.

### 5. Demografía consistente hacia atrás en el episodio

1. Tomar un paciente con al menos tres días consecutivos en censo.
2. Corregir nombre o demografía en el tercer día.
3. Volver a los días previos del mismo episodio.

Resultado esperado:

- La corrección se propaga hacia atrás dentro del mismo episodio clínico.
- La ancla del episodio es `firstSeenDate`.
- No se propaga a episodios distintos ni a pacientes ambiguos.

### 6. Menú clásico vs Honu

1. Abrir el menú clásico de acciones de una fila.
2. Confirmar que ya no aparecen:
   - `Documentos Clínicos`
   - `Solicitud Exámenes`
   - `Solicitud de Imágenes`
3. Confirmar que esas acciones siguen accesibles desde Honu.

Resultado esperado:

- No hay duplicación de accesos clínicos.
- El menú clásico conserva solo sus acciones propias.

## Evidencia mínima

- Fecha del escenario probado.
- Día de censo usado (`X`).
- Resultado `ok` / `fail` por escenario.
- Captura o nota breve solo si algo falla.

## Cobertura automatizada relacionada

- `src/tests/hooks/useStaffQuery.test.tsx`
- `src/tests/features/census/StaffSelector.test.tsx`
- `src/tests/views/census/admissionInput.test.tsx`
- `src/tests/views/census/admissionInputController.test.ts`
- `src/tests/hooks/useDailyRecord.lifecycle.test.tsx`
- `src/tests/views/census/censusLogicController.test.ts`
- `src/tests/views/census/patientDemographicsEpisodeSyncController.test.ts`
- `src/tests/views/census/usePatientRowInputHandlers.test.ts`

## Criterio de cierre de la iteración operativa

Se considera cerrada cuando:

1. la validación manual de los escenarios obligatorios queda en `ok`;
2. la cobertura automatizada focalizada sigue verde;
3. no aparece un bug nuevo de operación real en `Censo Diario`.
