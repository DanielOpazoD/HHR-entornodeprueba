# Hooks Reference

## Objetivo

Taxonomía operativa para el core del sistema. La idea es reducir carga cognitiva y dejar claro qué rol cumple cada hook antes de abrir más fragmentación.

## Categorías

| Categoría                  | Propósito                                                                               | Convención recomendada        |
| -------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| `facade`                   | API pública estable para una vista o subdominio. Coordina estado, bootstrap y acciones. | `useX`                        |
| `state`                    | Estado local/UI o draft; no debería conocer infraestructura remota.                     | `useXState`                   |
| `bootstrap`                | Carga inicial, selección base, hidratación o suscripción.                               | `useXBootstrap`               |
| `delivery`                 | Acciones remotas de envío, exportación o comunicación.                                  | `useXDeliveryActions`         |
| `persistence`              | Save/patch/delete o coordinación con write use-cases.                                   | `useXPersistence`             |
| `query`                    | Lectura reactiva/caché/Query wrapper.                                                   | `useXQuery`                   |
| `compat`                   | Bridge temporal para compatibilidad legacy.                                             | `useXCompat`                  |
| `policy/controller-backed` | Hook liviano que delega decisiones puras a `controllers/`.                              | `useX*` + controller dedicado |

## Guía de decisión

### Cuándo algo va a `application/`

- Si coordina side effects remotos.
- Si devuelve `ApplicationOutcome`.
- Si debe ser reusable sin React.

### Cuándo algo va a `controllers/`

- Si transforma datos.
- Si clasifica outcomes.
- Si resuelve copy/labels/validaciones puras.
- Si puede probarse sin React ni repositorios.

### Cuándo sigue siendo hook local

- Si administra estado local, timers, refs o wiring de UI.
- Si no aporta valor moverlo fuera de React.

## Dónde encontrar los hooks vigentes

En lugar de mantener un inventario manual que queda desactualizado cuando los hooks migran a su
feature dueño, la fuente viva del código es:

- [scripts/config/feature-map.json](../scripts/config/feature-map.json): mapa verificado por CI de
  cada flujo clínico, su carpeta dueña, puerta de entrada y pruebas asociadas.
- [src/hooks/README.md](../src/hooks/README.md): reglas y alcance de los hooks transversales
  compartidos entre dos o más áreas (registro diario, autenticación, respaldos y exportación).
- `src/features/<área>/hooks/`: hooks exclusivos de cada subdominio (por ejemplo,
  `src/features/census/hooks/`, `src/features/handoff/hooks/`,
  `src/features/clinical-documents/hooks/`).

## Naming rules

- Usar `useXState` para estado UI/draft.
- Usar `useXBootstrap` para selección/carga inicial.
- Usar `useXDeliveryActions` para envío/export/comunicación.
- Usar `useXPersistence` para save/patch/delete.
- Evitar `useXFacade` en nombres públicos; el hook raíz ya cumple ese rol.

## Contratos

- Si un contrato es semántico y cruza más de un archivo, debe vivir en `*Contracts.ts` o `*Types.ts`.
- Evitar `ReturnType<typeof hook>` cuando el core ya necesita un contrato estable y reusable.

## Regla de poda

Un wrapper se conserva solo si encapsula al menos una de estas cosas:

- policy reusable,
- adapter técnico,
- contrato estable,
- separación real de bootstrap/state/delivery/persistence.

Si solo reexporta o pasa parámetros sin valor semántico, se fusiona con su owner inmediato.
