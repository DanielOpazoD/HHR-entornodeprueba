# Horas extras de Hospitalizados

Prototipo mínimo para TENS y Enfermería, utilizable en celular y PC. Aplicación
independiente en esta carpeta, sin cambios al runtime clínico, Firebase o login de HHR.

## Flujo actual

1. Iniciar sesión con RUT. Primera clave: RUT sin dígito verificador.
2. Elegir una clave en el primer ingreso. Basta que esté escrita y coincida con su
   confirmación; en el primer ingreso debe diferir de la clave inicial. No hay longitud mínima adicional ni reglas de composición. Se puede
   volver a cambiar con el botón «Cambiar clave» del encabezado.
3. Seleccionar año, mes y día; registrar turno largo, noche u otro horario.
4. Editar o eliminar registros propios directamente. No hay envío, aprobación,
   devolución, estados, cierre administrativo ni bloqueo mensual.
5. Descargar el Excel personal. El administrador dispone además de Planillas del
   equipo con descargas completas por mes, separadas en TENS y Enfermería.
   El permiso administrativo no impide registrar sus propios turnos.

La demo incluye Ana/María (TENS), Pedro (Enfermería) y Luis (Enfermería con permiso
ADMIN). El selector de ejemplos está plegado debajo del ingreso. La clave inicial
precargada de Ana es `11111111`, asociada al RUT sintético `11111111-1`.

**Solo demostración:** claves, turnos y cambios viven en memoria y desaparecen al
recargar. No usar información real. Los controles de perfil del navegador no
constituyen autorización de servidor. El backend, cuentas, almacenamiento y
subdominio productivos quedan para la siguiente etapa.

## Calendario y cálculo

- Años 2026/2027, doce meses independientes. Fechas y límites en [calendar-sources.md](calendar-sources.md).
- Largo: 08:00–20:00 hábil; 09:00–20:00 inhábil.
- Noche: 20:00–08:00 si el día siguiente es hábil, hasta 09:00 si es inhábil.
- Diurnas: 07:00 inclusive a 21:00 exclusive en días hábiles; resto nocturnas/festivas.
- Minutos nominales del reloj local; sin convertir por la zona horaria del navegador.
- Se atribuye el turno completo a su mes de inicio. Criterio por ratificar antes de
  uso institucional, junto con el tratamiento de cambios de hora.
- Se rechazan fechas/horarios inválidos y solapamientos, incluso entre meses cargados.

## Excel

Modelo revisable de la plantilla vacía: `public/assets/planilla-hospitalizados.json`.

- Primera hoja «Sin registros»: personas sin turnos ingresados en el mes. No afirma
  que hayan declarado cero horas. Estas personas no tienen hoja individual.
- Hojas individuales: turno noche y horario en E; largos/parciales en B; totales
  diarios y del mes, incluidos meses de 28, 30 y 31 días.
- Hospitalizados; calidad/grado vacíos; sin CONTRATA ni nota al pie.
- Auxiliares G:P ocultos; carta vertical, área A1:E47 y firmas originales.
- Nombre `HORAS_EXTRAS_<grupo o persona>_hospitalizados_<año-mes>_DEMO.xlsx`.
  Sin etiquetas de aprobación o cierre.

La exportación usa el mismo cálculo que la pantalla. ExcelJS se carga al descargar.

## Ejecutar y comprobar

Node 22 desde esta carpeta:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 8799
npm test
npm run build
npm run test:sites
```

Tests: cálculo, límites de calendario, pertenencia de turnos, períodos independientes,
Excel con reapertura del archivo y claves libres. CI dedicado ejecuta estas pruebas,
build, empaquetado y auditoría de dependencias. Ver [design-qa.md](design-qa.md).

La auditoría exige cero hallazgos altos/críticos. Permanece el aviso moderado transitivo
ExcelJS/uuid previamente documentado; el prototipo no utiliza sus APIs afectadas de
buffers externos. No se rebaja el umbral ni se cambia el lockfile de HHR clínico.

Reversión: retirar esta aplicación y su workflow. No hay migraciones ni escrituras clínicas.
