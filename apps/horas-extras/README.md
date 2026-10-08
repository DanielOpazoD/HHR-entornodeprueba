# Horas extras de Hospitalizados — etapa 2

Prototipo web autónomo para TENS y Enfermería. Combina registro rápido,
calendario personal, revisión mensual y descarga Excel. No está importado por
la aplicación clínica ni publicado por su build de Netlify. No requiere `.env`,
Firebase, credenciales ni datos institucionales. Se abre como una aplicación
independiente; el enlace desde el login de HHR pertenece a la etapa de despliegue.

## Ejecutar

Node 22, desde `apps/horas-extras`:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 8799
npm test
npm run build
npm run test:sites
```

La cuenta inicial de ejemplo es Ana Ejemplo, RUT sintético `11111111-1`,
contraseña inicial `11111111`. El selector ofrece otras tres cuentas ficticias.
El primer ingreso obliga a crear una contraseña de demostración de al menos
12 caracteres. Usar una inventada: **no es autenticación real**. Contraseñas,
turnos, estados y actividad viven solo en memoria y desaparecen al recargar.
Ana y María son trabajadoras TENS; Pedro es trabajador de Enfermería; Luis es
enfermero con permiso ADMIN (coordinación). Solo Luis ve Gestión del equipo; todas
tienen Mis horas. La autorización del prototipo valida el permiso asignado a la cuenta,
además del rol del actor; aún no constituye seguridad de servidor. La política de
autoaprobación sigue pendiente institucionalmente; la demo permite aprobar la propia
planilla enviada, al igual que otra planilla, sin excepción de permisos.

## Contrato implementado

- Selector de año (2026/2027) y los doce meses; cada período conserva sus registros,
  estado y cierre en memoria. Datos precargados solo en septiembre de 2026.
- Inhábiles: sábados, domingos y feriados nacionales de `calendar-sources.md`.
  Se rechazan años fuera de cobertura; 1 de enero de 2028 solo como fin de turno.
- Gestión separada en pestañas TENS y Enfermería, exportación por grupo e impresión
  del resumen seleccionado (rotulado DEMO/BORRADOR o CERRADO). Excel conserva la
  plantilla institucional para impresión formal.
- Largo: 08:00–20:00 hábil; 09:00–20:00 inhábil.
- Noche: 20:00–08:00 si el día siguiente es hábil, hasta 09:00 si es inhábil.
- Diurnas: 07:00 inclusive a 21:00 exclusive en días hábiles. Las demás son
  nocturnas/festivas. Se calcula cada tramo del intervalo, no su etiqueta.
- Horas nominales del reloj local del establecimiento, sin conversión a la zona
  del navegador. Fechas ISO y minutos enteros; se conserva cada minuto registrado.
  El criterio de nómina frente a cambios de hora debe ratificarse antes de producción.
- Cada turno completo se atribuye al mes de inicio en esta demostración. Ese
  criterio de cierre cruzando meses queda pendiente de ratificación institucional.
- No hay solapamientos por funcionario, incluso entre meses cargados; dos intervalos que se tocan sí se admiten.
- Borrador/observado → enviado → aprobado → cierre manual. Devolver una planilla
  exige motivo. Reabrir exige motivo y conserva las aprobaciones: una corrección
  posterior requiere devolver el mes y someterlo nuevamente a aprobación.
- Para cerrar, todas las planillas deben estar aprobadas. Una planilla vacía no
  equivale a cero: el funcionario declara no haber realizado extras y envía el mes.
- Todos los perfiles administrativos acordados, incluida Enfermería Diurna,
  disponen de aprobación, devolución, exportación, cierre y reapertura.

Las propuestas de cierre de dotación completa, mínimo de contraseña y atribución
al mes de inicio son decisiones demostrables en este prototipo, no normativa legal.

## Excel

Plantilla original vacía en `public/assets/planilla-hospitalizados.json` (modelo textual de ExcelJS, revisable en Git), sin
identificadores personales reales. La biblioteca ExcelJS se carga al descargar.
Un solo motor calcula los totales de pantalla y planilla. Exportación individual
o por grupo (TENS/Enfermería), con `BORRADOR` o `CERRADO` y `DEMO` en el nombre.
Los borradores de grupo incluyen las horas registradas, aunque no se hayan aprobado;
no deben usarse para pago. Quienes no han informado horas y tampoco declarado cero
no aparecen en el listado de personas sin extras.

- Primera hoja: quienes declararon no realizar horas extras. Sin hoja individual.
- Hojas individuales para quienes tienen registros. Turno noche y su horario en E,
  «Nocturnas y Festivos». Largos e intervalos parciales en B.
- Total diario en C/D; sumas de C40:E40 y C41:C43 con resultados calculados.
- Calidad y grado vacíos, Hospitalizados, sin CONTRATA ni nota al pie.
- Cálculos auxiliares ocultos G:P; área de impresión A1:E47, carta vertical,
  una página por funcionario y firmas de la plantilla.

Los tests vuelven a abrir el XLSX generado para comprobar valores, fórmulas,
ubicaciones, visibilidad de columnas y configuración de impresión.

## Límites de etapa y continuación

No hay servidor, cuentas reales, permisos persistentes, notificaciones ni escritura
clínica. No introducir datos reales ni publicar este demo como servicio de personal.
La fase de producción necesita backend separado, autorización por funcionario y
nombramientos administrativos con vigencia, hash de contraseñas, limitación de
intentos, sesiones, recuperación, auditoría persistente y operaciones atómicas.
El cambio obligatorio y las restricciones deben verificarse en servidor. La clave
inicial predecible elegida por el usuario no prueba identidad: la habilitación de
cuentas reales requiere definir cómo verificar el primer acceso.

Pendientes antes de habilitar personal: URL/subdominio HHR, responsables variables,
política de autoaprobación, ratificación institucional y mantenimiento de feriados excepcionales/locales,
regla de cambio de hora y criterio de atribución entre meses. El protocolo de
integración/hosting se define entonces; este PR no modifica HHR clínico ni su login.

## Verificación

`npm test` ejecuta cálculo, referencia independiente de septiembre y casos de otros meses/años,
flujo de mes, permisos simulados y exportación Excel. El workflow dedicado ejecuta
los mismos tests y build en cada cambio de la aplicación. La revisión de navegador
móvil/escritorio y comparación visual se documenta en `design-qa.md`.

Reversión: retirar este directorio y su workflow, sin migración de datos ni efectos
sobre el sistema clínico.

La auditoría de dependencias exige cero hallazgos altos/críticos. Queda un aviso
moderado de uuid transitivo en ExcelJS, asociado a APIs v3/v5/v6 con buffers
externos; este prototipo no utiliza esas APIs. No se fuerza un cambio incompatible
de ExcelJS ni se oculta el aviso. Vite y transitivos vulnerables del starter se
actualizaron dentro del paquete aislado, sin cambios al lockfile clínico.
