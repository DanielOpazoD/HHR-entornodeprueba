# LAB UX Compact Comparison Design

Fecha: `2026-04-21`
Estado: `proposed`
Scope: `src/features/laboratory`

## Objetivo

Mejorar la legibilidad clínica y el aprovechamiento vertical del módulo `LAB` sin rehacer su arquitectura ni abrir un programa de refactor visual grande.

El bloque cubre cinco mejoras concretas:

1. compactar la cabecera del modal
2. agrupar la tabla de comparación en bloques clínicos colapsables
3. permitir anclar variables importantes en comparación
4. reducir el ruido cromático para que el color vuelva a significar algo clínico
5. refinar las tarjetas de órdenes para escaneo más rápido

## No objetivos

- no rehacer el flujo de búsqueda
- no cambiar contratos de datos del módulo
- no abrir persistencia remota nueva
- no crear una vista paralela de comparación
- no introducir IA ni nuevos pipelines de análisis

## Estado actual

La UI actual del módulo ya funciona, pero tiene tres costos claros:

- la cabecera consume demasiada altura para el valor que entrega
- la tabla de comparación se vuelve pesada cuando crecen las columnas y variables
- las tarjetas de órdenes muestran la información correcta, pero con jerarquía visual débil

Además, el color actual compite demasiado entre valores normales y alterados, lo que hace más lenta la lectura clínica.

## Enfoque recomendado

Se mantendrá la estructura existente del módulo y se actuará sobre la capa de presentación más una costura chica de modelado UI.

La idea no es crear un sub-sistema nuevo, sino:

- reordenar el layout de controles
- introducir agrupación visual sobre la tabla ya existente
- añadir un estado de anclado local en memoria para variables relevantes
- simplificar semántica visual de colores y badges

Esto preserva la lógica clínica y evita sobreingeniería.

## Diseño

### 1. Cabecera compacta

La cabecera del modal debe pasar de un bloque alto a una franja de control más baja.

Cambios:

- el selector de paciente y el botón `Buscar` quedarán en una fila principal compacta
- el acceso a `Buscar por RUT externo` pasa a una línea secundaria discreta
- los selectores rápidos (`7 días`, `14 días`, rango de fecha) bajan padding y separación vertical
- los chips de filtro de categorías se mantienen, pero con menor altura y espaciado más denso

Resultado esperado:

- más viewport útil para órdenes, tendencias y comparación
- menos sensación de “módulo pesado” al abrir el modal

### 2. Comparación por grupos clínicos

La tabla de comparación conservará fechas como columnas y variables como filas, pero se organizará en bloques clínicos colapsables.

Grupos iniciales:

- `Hemograma`
- `Inflamación`
- `Función renal / electrolitos`
- `Coagulación`
- `Perfil hepático`
- `RPC / RAC`
- `Otros`

Reglas:

- todos los grupos se renderizan expandidos por defecto
- cada grupo tendrá header visual claro y toggle de colapso
- el colapso es solo de presentación; no altera datos ni exportación
- si una búsqueda por variable está activa, el grupo sigue visible cuando tenga coincidencias

Resultado esperado:

- menos fatiga visual
- lectura clínica por bloque
- mejor escaneo cuando hay muchas columnas

### 3. Variables anclables

La comparación debe permitir fijar variables importantes.

Variables candidatas por defecto:

- `Creatinina`
- `Proteina C Reactiva`
- `RPC`
- `RAC`
- `Hemoglobina`

Reglas:

- el usuario puede anclar o desanclar desde la propia fila
- las variables ancladas se muestran primero dentro de su grupo
- no habrá persistencia remota; el estado vive en memoria mientras el modal esté abierto
- el anclado no cambia la exportación Excel en esta fase

Resultado esperado:

- menor tiempo para encontrar variables críticas
- más valor clínico real que seguir agregando color o decoraciones

### 4. Color con disciplina clínica

Se reducirá el uso expresivo de color.

Reglas:

- color fuerte solo para:
  - valor fuera de rango
  - resultado cualitativo positivo o relevante
  - estados realmente accionables
- valores normales quedan en tono neutro oscuro
- badges y chips bajan saturación visual
- headers y secciones mantienen una señal de color leve, no protagonista

Resultado esperado:

- el color vuelve a comunicar prioridad clínica
- menos competencia visual entre datos normales y alterados

### 5. Tarjetas de órdenes

Las órdenes deben seguir mostrando lo mismo, pero con mejor jerarquía.

Cambios:

- fecha más dominante
- hora y `#orden` como metadata secundaria compacta
- chips más discretos, con menor padding y menos “ruido”
- mejor alineación y consistencia entre `Ver PDF` y `Copiar resumen`
- los botones se mantienen, pero con jerarquía clara: PDF primero, copy segundo

Resultado esperado:

- escaneo más rápido
- menos volumen visual por tarjeta
- mejor lectura en listas largas

## Componentes afectados

### `LabResultsViewerModal`

Responsabilidad:

- reducir densidad vertical del shell general
- mantener el mismo flujo funcional

### `LabViewerControls`

Responsabilidad:

- compactar la zona `paciente + buscar`
- mover contenido secundario a una línea menos dominante

### `LabViewerExamList`

Responsabilidad:

- compactar filtros rápidos
- mejorar jerarquía de tarjetas
- mantener acciones existentes

### `LabViewerComparisonTable`

Responsabilidad:

- introducir grupos clínicos colapsables
- incorporar anclado de variables
- sobriedad cromática de celdas y headers

### Costura nueva pequeña

Se permite una costura liviana para modelar grupos/anclado de comparación, idealmente en `controllers` o `hooks`, pero solo si evita lógica visual compleja inline.

No se debe crear una mini-arquitectura nueva.

## Estado y persistencia

El nuevo estado UI será local al modal:

- grupos colapsados/expandidos
- variables ancladas

No se persistirá en backend ni en settings remotos en esta fase.

Si más adelante se quisiera persistencia por usuario, eso sería un bloque aparte.

## Impacto en exportación

La exportación existente no cambia en esta fase.

Reglas:

- exporta las mismas variables que hoy exporta la tabla de comparación
- el colapso o anclado no modifica el dataset exportado
- evitar que UX local cambie contratos downstream

## Riesgos

1. romper el layout del modal en pantallas pequeñas
2. introducir demasiada lógica de agrupación dentro del render de tabla
3. mezclar orden clínico, orden anclado y orden de búsqueda de forma confusa

Mitigaciones:

- mantener el orden clínico actual como base
- aplicar anclado solo como prioridad local dentro del grupo
- tests de render y smoke visual del modal

## Validación

### Tests

- render de grupos expandidos por defecto
- toggle de colapso por grupo
- anclado y desanclado de variables
- preservación de filas esperadas en comparación
- jerarquía de tarjetas y acciones disponibles

### Validación manual

En `localhost:8888` revisar:

1. apertura del modal
2. altura visible ganada en la cabecera
3. lectura de órdenes en lista larga
4. comparación con grupos abiertos
5. anclado de `Creatinina`, `PCR`, `RPC`, `RAC`, `Hemoglobina`
6. color sobrio con resaltado solo de hallazgos relevantes

## Archivos probables

- `src/features/laboratory/components/LabResultsViewerModal.tsx`
- `src/features/laboratory/components/LabViewerControls.tsx`
- `src/features/laboratory/components/LabViewerExamList.tsx`
- `src/features/laboratory/components/LabViewerComparisonTable.tsx`
- `src/features/laboratory/constants/labConstants.ts`
- opcionalmente una costura pequeña en `controllers/` o `hooks/`

## Criterio de terminado

Este bloque se considera terminado si:

- la cabecera del modal ocupa menos alto sin perder funcionalidad
- la comparación se lee por grupos clínicos colapsables
- todas las filas empiezan expandidas
- existen variables anclables y funcionan
- el color deja de competir visualmente en valores normales
- las tarjetas de órdenes escanean más rápido que antes
- los tests añadidos/ajustados quedan en verde
