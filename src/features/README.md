# `src/features`

## Propósito

Organización principal por módulo funcional (feature-first). Cada feature agrupa UI, hooks, controllers y servicios específicos.

## Mapa de features

| Feature      | Contenido típico                                                      | Estado                       |
| ------------ | --------------------------------------------------------------------- | ---------------------------- |
| `census/`    | `components`, `hooks`, `controllers`, `domain`, `types`, `validation` | Núcleo principal del sistema |
| `handoff/`   | Entrega de turno (enfermería/médica), controllers y servicios         | Activo                       |
| `transfers/` | Flujo de gestión de traslados y documentos                            | Activo                       |
| `admin/`     | Paneles de administración, roles, auditoría                           | Activo                       |
| `analytics/` | KPIs MINSAL/DEIS y visualización                                      | Activo                       |
| `backup/`    | Gestión de respaldos y archivos                                       | Activo                       |
| `cudyr/`     | Módulo clínico CUDYR                                                  | Activo                       |
| `whatsapp/`  | Integración y configuración WhatsApp                                  | Activo                       |
| `auth/`      | UI/flows específicos de autenticación                                 | Acotado                      |
| `reports/`   | Espacio para reportes adicionales                                     | Reservado/ligero             |

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

### `admin/`

- Herramientas operativas: roles, mantenimiento, auditoría, diagnósticos.

## Reglas de arquitectura

- `controllers/hooks/domain/types` de una feature no deben importar capas restringidas de otra feature (controlado por script de arquitectura).
- Priorizar contratos locales (`types`, `domain/contracts`) antes de usar tipos ad-hoc en componentes.

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
