# `src/` - Mapa del Código Fuente

Este documento es la puerta de entrada para navegar el código rápidamente. El objetivo es que un desarrollador (humano o IA) entienda:

1. dónde vive cada responsabilidad,
2. cómo se conectan las capas,
3. en qué README profundizar según el tipo de cambio.

## Orden recomendado de lectura

1. [`/README.md`](../README.md)
2. [`/docs/CODEBASE_CANON.md`](../docs/CODEBASE_CANON.md)
3. [`/docs/architecture.md`](../docs/architecture.md)
4. Este archivo (`src/README.md`)
5. README del directorio que vas a modificar (tabla de abajo)

## Árbol principal de `src/`

```text
src/
├── App.tsx
├── index.tsx
├── index.css
├── firebaseConfig.ts
├── service-worker.ts
├── app-shell/
├── application/
├── assets/
├── components/
├── config/
├── constants/
├── context/
├── docs/
├── domain/
├── features/
├── hooks/
├── schemas/
├── services/
├── shared/
├── styles/
├── tests/
├── types/
└── utils/
```

## Archivo raíz -> propósito

| Archivo                                  | Propósito                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/index.tsx`                          | Bootstrap React, `StrictMode` y gate de `firebaseReady`                             |
| `src/App.tsx`                            | Orquestación principal de auth, date nav, record sync, providers globales y routing |
| `src/index.css`                          | Estilos globales y variables CSS base                                               |
| `src/firebaseConfig.ts`                  | Inicialización/configuración de Firebase                                            |
| `src/service-worker.ts`                  | Lógica PWA/offline                                                                  |
| `src/env.d.ts` / `src/vitest.shims.d.ts` | Tipados de entorno/soporte testing                                                  |

## Mapa por directorio (con documentación asociada)

| Directorio        | Qué contiene                                     | README                                           |
| ----------------- | ------------------------------------------------ | ------------------------------------------------ |
| `src/app-shell`   | Vistas lazy, rutas y armado de la aplicación     | [Arquitectura](../docs/architecture.md)          |
| `src/application` | Casos de uso y coordinación                      | [Codebase Canon](../docs/CODEBASE_CANON.md)      |
| `src/assets`      | Recursos estáticos internos                      | [src/assets/README.md](assets/README.md)         |
| `src/components`  | UI compartida, layout, modales, componentes base | [src/components/README.md](components/README.md) |
| `src/config`      | Configuración transversal (query client, etc.)   | [src/config/README.md](config/README.md)         |
| `src/constants`   | Catálogos y constantes de negocio/UI             | [src/constants/README.md](constants/README.md)   |
| `src/context`     | Estado global por providers y hooks de acceso    | [src/context/README.md](context/README.md)       |
| `src/docs`        | Guías técnicas internas de código                | [src/docs/README.md](docs/README.md)             |
| `src/domain`      | Dominio transversal (independiente de React)     | [src/domain/README.md](domain/README.md)         |
| `src/features`    | Módulos por feature (census/admin/transfers/...) | [src/features/README.md](features/README.md)     |
| `src/hooks`       | Hooks de aplicación y controllers de hooks       | [src/hooks/README.md](hooks/README.md)           |
| `src/schemas`     | Validación y contratos de entrada                | [src/schemas/README.md](schemas/README.md)       |
| `src/services`    | Repositorios, storage, integraciones externas    | [src/services/README.md](services/README.md)     |
| `src/shared`      | Contratos/runtime adapter reutilizable           | [src/shared/README.md](shared/README.md)         |
| `src/styles`      | CSS específico por contexto (p.ej. impresión)    | [src/styles/README.md](styles/README.md)         |
| `src/tests`       | Pruebas unitarias/integración por capas/features | [src/tests/README.md](tests/README.md)           |
| `src/types`       | Tipos TypeScript globales de dominio/DTO         | [src/types/README.md](types/README.md)           |
| `src/utils`       | Utilidades puras compartidas                     | [src/utils/README.md](utils/README.md)           |

### Profundización recomendada (alta complejidad)

| Módulo                  | Documento                                                              |
| ----------------------- | ---------------------------------------------------------------------- |
| `features/census`       | [src/features/census/README.md](features/census/README.md)             |
| `hooks/controllers`     | [src/hooks/controllers/README.md](hooks/controllers/README.md)         |
| `components/modals`     | [src/components/modals/README.md](components/modals/README.md)         |
| `services/repositories` | [src/services/repositories/README.md](services/repositories/README.md) |
| `services/storage`      | [src/services/storage/README.md](services/storage/README.md)           |

## Flujo de navegación técnico (rápido)

```text
UI event
  -> component/view
  -> feature hook
  -> controller/domain validation
  -> context action
  -> service/repository
  -> storage (IndexedDB/Firestore)
  -> query cache update + subscription
  -> re-render UI
```

## Inventario y trazabilidad

Para obtener inventario completo del árbol en cualquier momento:

```bash
find src -type f | sort
```

Para ubicar rápidamente responsabilidades por feature:

```bash
find src/features -maxdepth 3 -type d | sort
```

## Reglas de mantenimiento

- Si agregas un archivo en un directorio principal, actualiza su `README.md`.
- Si mueves responsabilidades entre capas, actualiza también `docs/architecture.md`.
- Si cambias ownership de capas, actualiza `docs/CODEBASE_CANON.md`.
- Si cambias contratos (`types`, `schemas`, `domain/contracts`), documenta el impacto en el README del módulo.
- Los contratos de controller reutilizados entre features deben vivir en `src/shared/contracts/`, no dentro de una feature.
- Las imports desde `src/App.tsx`, `src/app-shell/*` y cualquier consumidor externo a una feature deben pasar por el `index.ts` o `public.ts` del módulo correspondiente.
