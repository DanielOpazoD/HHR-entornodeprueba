# `src/features/analytics`

## Propósito

Feature autónoma para indicadores MINSAL/DEIS, tendencias y exportación analítica del hospital.

## Alcance

- Renderiza el dashboard de estadísticas desde una ruta propia del shell: `/statistics`.
- Consume datos históricos del censo para calcular KPIs, tendencias y desgloses.
- Compara la categorización CUDYR nocturna con la ubicación física y la clasificación clínica
  UPC-UTI/UPC-UCI, expresando el período como observaciones paciente-día y no como pacientes únicos.
- Presenta la clasificación CUDYR por nivel de cuidado: crítico (A1, A2, A3, B1, B2), medio
  (B3, C1, C2) y básico (C3, D1, D2, D3). Cada gráfico informa recuento y porcentaje.
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
- Los porcentajes por nivel de cuidado excluyen del denominador los registros sin CUDYR completo y
  nunca sustituyen la clasificación clínica HHR.
- El cruce de UPC muestra por separado el nivel de cuidado de UPC–UCI, UPC–UTI y UPC histórico; las
  tres procedencias forman parte del total UPC observado sin perder trazabilidad.
- La pestaña `UPC clínico` resume exclusivamente pacientes clasificados por checklist HHR, separa
  UTI/UCI, ubicación de cama y expone detalle de criterios, identidad, diagnóstico y CUDYR.
- Para fechas anteriores al `30-04-2026`, una marca manual `UPC` sin desglose se contabiliza como
  UTI asumida y conserva el origen `Registro manual UPC`; desde la fecha de corte no se infiere UTI.
- Una clasificación UPC solo es estadísticamente válida en R1–R4 o NEO1–NEO2; cualquier rótulo
  UPC/UTI/UCI persistido en otra cama se ignora en recuentos y listados UPC.
- Una observación UPC sin nombre ni documento de identidad se excluye de totales, porcentajes y
  tablas. Basta uno de ambos campos para conservar registros extranjeros o históricos trazables.
- Los links de vuelta al censo deben navegar a una fecha concreta sin reintroducir acoplamiento estructural con `census`.

## Validación recomendada

- `npx vitest run src/tests/features/analytics/AnalyticsView.test.tsx`
- `npm run typecheck`
