# TODO Triage Process

> Playbook para mantener cero `TODO`/`FIXME`/`HACK`/`XXX` markers
> dispersos en el código fuente. La política es deliberada: las
> decisiones postergadas viven en
> [TECHNICAL_DEBT_REGISTER.md](TECHNICAL_DEBT_REGISTER.md) (formal,
> dateado, con criterio de cierre), no como comentarios desperdigados
> que envejecen sin dueño.

## El estado deseado

Snapshot al 2026-05-03: **0 markers en `src/**`, `functions/**`, tests
incluidos**. Cualquier marker nuevo que aparezca en un PR debería
cuestionarse en review.

Mantener este estado se verifica con:

```bash
npm run report:todos
```

Que escribe `reports/source/todos-inventory.{json,md}`. El script no
falla CI; es para feedback en code review y auditorías mensuales.

## Cuando aparece un marker nuevo en un PR

El reviewer pregunta: **¿por qué no se resuelve antes de mergear?**
Respuestas válidas:

| Decisión   | Acción                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `close`    | Resolver en este PR. Eliminar el marker.                                                                                                                                                                                                                                        |
| `activo`   | Eliminar el marker; abrir entrada en `TECHNICAL_DEBT_REGISTER.md` con criterio de cierre.                                                                                                                                                                                       |
| `test_gap` | Convertir el marker a `it.todo('...')` en el test correspondiente.                                                                                                                                                                                                              |
| `document` | Mantener el marker SOLO si va acompañado de un párrafo de contexto explicando por qué se posterga, y un link al activo / issue / ADR que tracquea el cierre. Justificación en review.                                                                                           |
| `accepted` | Igual que `document`, pero el comentario reemplaza el marker por un comentario neutro (no `TODO`). Ejemplo: cambiar `// TODO: validar fecha en zona horaria local` por `// La validación asume hora local porque el censo es per-hospital — ver ADR_DAILY_RECORD_RUNTIME_PATH.` |

## Cuando se quiere mergear con marker pendiente

Si por urgencia un marker se cuela:

1. El comentario del marker debe incluir **fecha** e **issue/activo**:

   ```ts
   // TODO(2026-05-03, command-layer-discharge): wire promotion criteria
   ```

2. Al cierre del próximo sprint, `npm run report:todos` lo lista; el
   responsable lo trie según la tabla anterior.

## Por qué la regla es "cero" y no "pocos"

- Los markers envejecen y pierden contexto. A los 6 meses nadie sabe
  por qué están.
- El tracker formal obliga a definir criterio de cierre y dueño.
- La regex del scanner es estricta (solo dentro de comentarios), por lo
  que strings legítimos como "DESCARGAR TODO" no contaminan el conteo.
- Los activos del tracker tienen revisión periódica. Los markers no.

## Mantenimiento

- Correr `npm run report:todos` antes de cualquier release planificado.
- Si el conteo crece, abrir un activo de cleanup. Si se mantiene en cero,
  no hay que hacer nada.
- Este documento se actualiza solo cuando cambia el playbook, no por
  resultados puntuales del scanner.
