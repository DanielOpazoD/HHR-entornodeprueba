# `src/tests`

## Propósito

Cobertura de calidad técnica en múltiples niveles (unit, integración y contratos).

## Estructura

| Path           | Tipo de pruebas                                 |
| -------------- | ----------------------------------------------- |
| `components/`  | UI y controllers de componentes                 |
| `hooks/`       | Hooks de aplicación y controllers auxiliares    |
| `services/`    | Servicios de datos, exportadores, storage, etc. |
| `views/`       | Composición de vistas/feature controllers       |
| `integration/` | Flujos transversales entre capas                |
| `security/`    | Reglas Firestore y validaciones de seguridad    |
| `schemas/`     | Validaciones de esquemas                        |
| `utils/`       | Utilidades puras                                |
| `types/`       | Contratos/tipos                                 |
| `factories/`   | Data factories para tests                       |
| `setup.ts`     | Setup global de testing                         |

## Estrategia

- Unit tests para controllers puros y utilidades.
- Integration tests para hooks + repositorios + estado.
- Pruebas de regresión en módulos críticos (`census`, `handoff`, `transfers`).

## Comandos útiles

```bash
npm run test
npm run test:watch
npm run test:coverage
npx vitest run src/tests/views/census
```

## Convenciones

1. Nombre: `*.test.ts` o `*.test.tsx`.
2. Priorizar tests de comportamiento observable.
3. Mockear integración externa (Firebase, browser runtime) cuando corresponda.
4. Evitar acoplar tests a detalles internos no estables.
