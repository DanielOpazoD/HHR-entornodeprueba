# `src/features`

## Propósito

Organización principal por módulo funcional (feature-first). Cada feature agrupa UI, hooks, controllers y servicios específicos.

## Mapa de features

Una fila por carpeta de `src/features/`; `featureBoundaryLint.test.ts` falla si falta o sobra una.
De quién puede depender cada feature lo dice
[`scripts/feature-dependency-matrix.json`](../../scripts/feature-dependency-matrix.json), no esta tabla.

| Feature                                               | Qué hace para el hospital                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `admin/`                                              | Panel del administrador: cuentas y roles, auditoría, salud del sistema, mantenimiento de datos y firma médica |
| [`analytics/`](analytics/README.md)                   | Estadísticas MINSAL/DEIS, CUDYR por nivel de cuidado y traslados, en la ruta `/statistics`                    |
| `audit-documents/`                                    | Descarga en ZIP los informes oficiales de Eloísa de una lista de RUT, para auditorías                         |
| `auth/`                                               | Pantalla de ingreso: cuenta Google y acceso de enfermería                                                     |
| [`backup/`](backup/README.md)                         | Explorar, guardar, revisar y mantener los respaldos históricos                                                |
| [`census/`](census/README.md)                         | Censo diario: camas, pacientes, ingresos, altas, traslados y turnos. Núcleo de la aplicación                  |
| [`clinical-documents/`](clinical-documents/README.md) | Epicrisis, evoluciones e informes médicos del episodio: borrador, guardado automático, impresión y PDF        |
| [`clinical-library/`](clinical-library/README.md)     | Botón «Documentos» del censo: formularios para completar, protocolos, infografías y herramientas clínicas     |
| [`cudyr/`](cudyr/README.md)                           | Categorización CUDYR de enfermería: registro, exportación e impresión para la entrega nocturna                |
| `document-scanner/`                                   | Escanea documentos con el teléfono a PDF; quedan en una bandeja temporal hasta confirmar su carga en Eloísa   |
| [`handoff/`](handoff/README.md)                       | Entrega de turno de enfermería y médica                                                                       |
| [`laboratory/`](laboratory/README.md)                 | Exámenes del paciente: visor de Syslab, informes originales de Exalab y bandeja de exámenes del censo         |
| `prescriptions/`                                      | Respaldo fotográfico de recetas por cama: carga con QR y PIN, visor y administración                          |
| [`rayen-import/`](rayen-import/README.md)             | Sincroniza el censo con Eloísa mediante la extensión; los cambios de camas se aplican tras confirmarlos       |
| `rayen-manual-import/`                                | Ingresa en una cama vacía un paciente copiado de Eloísa con un código, avisando si ya está en el censo        |
| [`reminders/`](reminders/README.md)                   | Avisos que jefatura o administración publican para el personal clínico                                        |
| `whatsapp/`                                           | WhatsApp: turnos de pabellón, plantillas de mensajes y configuración                                          |
| [`wound-care/`](wound-care/README.md)                 | Registro fotográfico de curaciones de heridas, con consentimiento, desde la entrega de enfermería             |

## Subestructura esperada por feature

```text
feature/
├── components/   # UI del módulo
├── hooks/        # estado + orquestación de casos de uso
├── controllers/  # lógica pura, validación y transformación
├── domain/       # contratos/reglas de negocio propias
├── services/     # integración de datos específica del módulo
└── types/        # tipos locales del módulo
```

## Detalle por feature principal

### `census/`

- Módulo más extenso del sistema.
- Implementa patrón de comandos tipados para acciones de movimiento (alta/traslado/move-copy).
- Incluye boundaries de runtime y validaciones de fecha/turno centralizadas.
- Incluye los traslados: `TransfersSection` y controllers `censusTransfer*`; el modal está en
  `src/components/modals/actions/TransferModal.tsx`.

### `handoff/`

- Consolida entrega de turno y comunicación clínica.
- Se apoya en `DailyRecordContext` + hooks de handoff.

### `analytics/`

- Dashboard estadístico autónomo, desacoplado del render del censo diario.
- Se monta como módulo independiente en `/statistics`.
- Documentación específica del módulo en [analytics/README.md](analytics/README.md).

### `admin/`

- Herramientas operativas: roles, mantenimiento, auditoría, diagnósticos.
- Puede agregar vistas operativas de otros módulos solo cuando la dependencia esté declarada en
  `scripts/feature-dependency-matrix.json` y el consumo entre por el entrypoint público del feature
  (`@/features/<feature>` o `public.ts`), nunca por subrutas internas.

## Reglas de arquitectura

- `controllers/hooks/domain/types` de una feature no deben importar capas restringidas de otra feature (controlado por script de arquitectura).
- Priorizar contratos locales (`types`, `domain/contracts`) antes de usar tipos ad-hoc en componentes.
- Todo consumo externo a la feature debe entrar por `index.ts` o `public.ts`. Evitar imports profundos desde `src/App.tsx`, `src/views/*` o desde otras features.
- Entre features, ESLint impone la matriz (`scripts/feature-dependency-matrix.json`) y las entradas públicas (`publicModulesByFeature` en `scripts/feature-public-api-allowlist.json`) con `hhr/feature-boundaries`: el editor marca el import prohibido y `npm run lint` falla. La regla cubre imports estáticos, de tipos, reexportaciones, dinámicos y `require`, tanto por alias como por rutas relativas; las pruebas de configuración verifican la paridad entre carpetas y matriz.
- Dentro de la feature, preferir imports relativos para distinguir claramente implementación interna
  de API pública. Los aliases `@/features/<feature>/...` quedan reservados para consumo externo y
  deben apuntar solo al entrypoint público.
- Si una vista/componente debe ser lazy-loaded por el router, exponerla primero desde el entrypoint público de la feature.

## Ejemplo de flujo dentro de una feature

```text
components/Modal
  -> hooks/useXxxForm
  -> controllers/xxxController
  -> hooks/useXxxCommand
  -> controllers/commandRuntimeController
  -> shared/service/context actions
```

## Navegación recomendada

1. `index.ts` de la feature.
2. `components` para entender UI.
3. `hooks` para flujo.
4. `controllers` para reglas de negocio.
5. `domain/types` para contratos.

## Entradas públicas

Cada feature se consume desde fuera solo por su `public.ts` o su `index.ts`. Las entradas adicionales
permitidas están en `publicModulesByFeature` y las excepciones puntuales en `exceptionsByFeature`, ambas en
[`scripts/feature-public-api-allowlist.json`](../../scripts/feature-public-api-allowlist.json); ESLint las
impone.
