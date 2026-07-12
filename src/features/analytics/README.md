# `src/features/analytics`

## Propósito

Feature autónoma para indicadores MINSAL/DEIS, tendencias y exportación analítica del hospital.

## Alcance

- Renderiza el dashboard de estadísticas desde una ruta propia del shell: `/statistics`.
- Consume datos históricos del censo para calcular KPIs, tendencias y desgloses.
- Compara la categorización CUDYR nocturna con la ubicación física y la clasificación clínica
  UPC-UTI/UPC-UCI, expresando el período como observaciones paciente-día y no como pacientes únicos.
- Presenta porcentajes y gráficos de equivalencia CUDYR/MINSAL para registros sin criterio UPC HHR:
  UCI (A1, A2, B1), UTI (A3, B2, B1) y categorías no equivalentes a UPC. Como B1 figura en ambas
  filas ministeriales, los porcentajes excluyentes aplican precedencia UCI.
- Resume los traslados del período separando LATAM/avión comercial, avión ambulancia y otros
  medios; el grupo aeromédico se desglosa en Aerocardal, FACH, Armada y otras empresas.
- Los recuentos de traslados permiten abrir trazabilidad con paciente, RUT, diagnóstico, cama,
  especialidad, destino, medio y el valor libre ingresado cuando el medio registrado fue `Otro`.
- Todo traslado cuyo medio seleccionado sea `Otro` se clasifica por defecto como aeroevacuación
  médica de otra empresa; el texto libre no es requisito para incorporarlo a ese grupo.
- Mantiene separados los contratos de visualización analítica de la UI operativa del censo diario.

## Entry points públicos

- `index.ts`: entrypoint principal para lazy-loading del módulo.
- `public.ts`: superficie pública mínima para consumo explícito de `AnalyticsView`.

## Invariantes

- El módulo de analytics no debe renderizarse desde `CensusView`; se monta como módulo/ruta propia.
- Los cálculos y labels analíticos deben salir de controllers y hooks del feature, no de componentes del censo.
- La cama R1-R4 no basta para clasificar un paciente como UPC: el análisis debe mantener separadas
  la capacidad potencial, el checklist clínico UTI/UCI y la complejidad CUDYR.
- Los porcentajes de equivalencia MINSAL excluyen del denominador los registros sin CUDYR completo y
  los UPC históricos sin desglose, y nunca sustituyen la clasificación clínica HHR.
- El cruce de UPC clínico muestra por separado la distribución CUDYR/MINSAL de quienes fueron
  calificados UPC–UCI y UPC–UTI; cada barra exhibe recuento y porcentaje para UCI, UTI y no UPC.
- La pestaña `UPC clínico` resume exclusivamente pacientes clasificados por checklist HHR, separa
  UTI/UCI, ubicación de cama y expone detalle de criterios, identidad, diagnóstico y CUDYR.
- Para fechas anteriores al `30-04-2026`, una marca manual `UPC` sin desglose se contabiliza como
  UTI asumida y conserva el origen `Registro manual UPC`; desde la fecha de corte no se infiere UTI.
- Una clasificación UPC solo es estadísticamente válida en R1–R4 o NEO1–NEO2; cualquier rótulo
  UPC/UTI/UCI persistido en otra cama se ignora en recuentos y listados UPC.
- Los links de vuelta al censo deben navegar a una fecha concreta sin reintroducir acoplamiento estructural con `census`.

## Validación recomendada

- `npx vitest run src/tests/features/analytics/AnalyticsView.test.tsx`
- `npm run typecheck`
