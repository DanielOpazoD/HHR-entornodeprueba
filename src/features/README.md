# `src/features`

## Propósito

Organización principal por módulo funcional (feature-first). Cada feature agrupa UI, hooks, controllers y servicios específicos.

## Mapa de features

| Feature             | Contenido típico                                                                                        | Estado                       |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `census/`           | `components`, `hooks`, `controllers`, `domain`, `types`, `validation`                                   | Núcleo principal del sistema |
| `handoff/`          | Entrega de turno (enfermería/médica), controllers y servicios                                           | Activo                       |
| `transfers/`        | Flujo de gestión de traslados y documentos                                                              | Activo                       |
| `admin/`            | Paneles de administración, roles, auditoría                                                             | Activo                       |
| `analytics/`        | KPIs MINSAL/DEIS, visualización y ruta propia `/statistics`                                             | Activo                       |
| `backup/`           | Gestión de respaldos y archivos                                                                         | Activo                       |
| `cudyr/`            | Módulo clínico CUDYR                                                                                    | Activo                       |
| `clinical-library/` | Biblioteca del censo: formularios, protocolos, infografías y herramientas clínicas (botón «Documentos») | Activo                       |
| `whatsapp/`         | Integración y configuración WhatsApp                                                                    | Activo                       |
| `auth/`             | UI/flows específicos de autenticación                                                                   | Acotado                      |
| `reports/`          | Espacio para reportes adicionales                                                                       | Reservado/ligero             |

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

### `handoff/`

- Consolida entrega de turno y comunicación clínica.
- Se apoya en `DailyRecordContext` + hooks de handoff.

### `transfers/`

- Gestión de solicitud/confirmación/cancelación de traslados.
- Integración con generación documental y Google Drive.
- Documentación específica del módulo en [transfers/README.md](transfers/README.md).

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

## Entry points públicos actuales

- `auth/index.ts`: autenticación de alto nivel.
- `auth/public.ts`: API pública mínima de autenticación (`LoginPage` + props).
- `census/public.ts`: vistas públicas y read-model helpers permitidos para `application`.
- `clinical-documents/public.ts`: contratos y helpers permitidos para `application`/`shared`.
- `reminders/index.ts` y `reminders/public.ts`: vista administrativa pública del feature.
- `admin/index.ts`: vistas operativas del panel admin.
- `analytics/index.ts` y `analytics/public.ts`: vista pública del dashboard MINSAL/DEIS.
- `backup/index.ts`: explorador de respaldos.
- `census/index.ts`: vistas y modales públicos del módulo.
- `cudyr/index.ts` y `cudyr/public.ts`: vistas y utilidades permitidas.
- `clinical-library/index.ts`, `clinical-library/public.ts` y `clinical-library/quick-action.ts`: botón «Documentos» y panel lateral de la biblioteca clínica.
- `handoff/index.ts` y `handoff/public.ts`: shell público de entrega de turno y helpers permitidos.
- `transfers/index.ts` y `transfers/public.ts`: vista pública de gestión de traslados.
- `whatsapp/index.ts`: integración principal de WhatsApp.
