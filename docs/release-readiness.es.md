# CMCP-TIME 0.1.1: guía de uso

[English](release-readiness.en.md) · [繁體中文](release-readiness.zh-TW.md) · [Español](release-readiness.es.md) · [日本語](release-readiness.ja.md)

Esta guía describe **0.1.1**; conserva el nombre del archivo para no romper enlaces existentes. El canal, el hash del paquete, el commit y `PUBLIC-FILES.json` identifican la fuente; compartir número de versión o etiqueta no significa que GitHub y npm tengan los mismos bytes. Autor original: redwakame; Apache-2.0. Conserva LICENSE y NOTICE.

Instala la versión fija npm **`@redwakame-skill/cmcp-time@0.1.1`** con el comando siguiente y comprueba `--version`. El anterior [Release v0.1.1 exclusivo de GitHub](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) y su tag fijo permanecen intactos; su tarball es un artefacto distinto. La fuente posterior de npm cambia ajustes de publicación/documentación, no el Runtime. Consulta [instalación e identidad](npm-installation.md#version-and-publication-evidence) y [cambios históricos y límites](release-0.1.1.md).

## Prefijo persistente y espacio independiente

Prepara Node.js >=22.16.0 y npm. El último incremento se ejecutó en Windows Node 24.18.0; las pruebas anteriores Linux/22.16.0 no cubren automáticamente lo añadido. Separa el prefijo del programa y el espacio persistente existente. No guardes History en `node_modules` ni enlaces hooks persistentes a la caché `npx`.

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-0.1.1'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.1 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

`setup` pregunta por guardado, idioma, zona horaria y conexión opcional de Codex. No instala el host, importa datos privados, concede llamadas de pago ni activa avisos. En POSIX usa `<prefix>/node_modules/.bin/cmcp-time`; en Windows `<prefix>/node_modules/.bin/cmcp-time.cmd`. Sustituye `cmcp-time` por ese ejecutable completo en los ejemplos; no se presupone un cambio de PATH. Desde fuentes usa `node bin/cmcp-time.mjs` y antes `npm ci` para las dependencias MCP bloqueadas. Consulta [instalación](npm-installation.md).

Para hooks locales de Codex, revisa el proyecto generado y su aprobación nativa. Harness Desktop oficial es otro host: npm setup no crea automáticamente su despliegue. En uno ya configurado, usa el profile y las operaciones inspeccionadas que se detallan abajo. Copiar el programa no equivale a configurar su integración.

### Mantenimiento de 0.1.1: terminal y Codex opcional

Estas correcciones forman parte de ambos canales 0.1.1; el paquete npm 0.1.0 publicado anteriormente permanece intacto. Sin `--answers`, `setup`/`update` requiere un terminal (TTY) y respuestas una por una. Los lotes por tubería y stdin vacío se rechazan antes de escribir la configuración; EOF cancela y nunca implica consentimiento. Para automatizar, completa las opciones explícitas a partir de `examples/setup-host.json` y ejecuta `cmcp-time setup --workspace <espacio-existente> --answers <answers.json-dentro-del-espacio>`. Elige `attachCodex: false` si no quieres Codex; no hace falta instalarlo ni iniciarlo.

`setup --status` conserva `state` y `cmcp_codex_binding` por compatibilidad; `stateScope=managed_codex_hook_binding` limita su significado a esa conexión. Consulta por separado `layers.configuration`, `layers.hostConnection`, `layers.runtime` y `layers.sources`: configuración, conexión del host, controles efectivos, originales guardados y elegibilidad del lector formal son estados distintos. Otros hosts muestran `not_inspected` hasta su comprobación independiente; elegibilidad no prueba recepción por el modelo. `disable` desconecta Codex administrado y conserva controles Runtime e History. Las entradas sin Codex siguen necesitando autorización válida propia.

### Mantenimiento de 0.1.1: estado actual bajo demanda

En una conversación autorizada, pide de forma natural organizar el estado actual; el host usa las herramientas formales existentes y no necesitas escribir JSON. Si `partial` devuelve un finding sobre el uso de una fuente, el host debe revisar el mensaje original completo y seguir el `finding.requiredResolutionKind` actual y el `finding.report.source.ref` formal; `nodeId` no sustituye a `reportRef`. Si hay páginas, continúa mediante `delivery.nextPage` de esa misma entrega hasta `complete`, sin reenviar la propuesta como si fuera la página siguiente. Fuentes ausentes o ambigüedad real conservan `partial`; `ready` estructural y de fuentes no significa aceptación semántica ni permiso de ejecución.

La comprobación H4 separó correctamente los tres informes explícitos de las instrucciones de pausa y entregó todas las páginas de las proyecciones resultantes. El host normal seleccionó cláusulas exactas; las resoluciones explícitas de uso de fuente se comprobaron aparte con originales fijos. Entregar toda la proyección no prueba que cada original seleccionado llegara al modelo: una respuesta larga adicional del Assistant quedó sin leer y la cobertura global conservó correctamente `partial`. Dos casos anteriores de gran volumen C27 aún superan 65.536 bytes; son límites conocidos, no pruebas de capacidad completa superadas. Consulta [los límites de evidencia de 0.1.1](release-0.1.1.md).

## Primera conexión con Desktop oficial

Usa el Desktop oficial ya instalado, no otro lanzador Web. Confirma que no haya generación, herramientas ni trabajo sin enviar y sal normalmente. Identifica la instalación y el profile reales desde su entrada de configuración habitual; no adivines rutas de otro SDK o despliegue anterior.

`<official-llm-module>` es la raíz de instalación verificada más `resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js`. Es una ruta virtual Electron ASAR; el sistema de archivos Node común puede no mostrar el archivo interno. Prepare verifica el ASAR físico y el sufijo esperado, no la carga correcta en el host ejecutándose. Compruébala tras iniciar.

Elige espacio existente autorizado, nombre de scope y zona IANA. El ejemplo permite guardar User y Assistant; cambia cualquier `yes` a `no` según tu elección. Un ejemplo sintético no autoriza importar historial privado.

```text
cmcp-time desktop prepare --workspace <existing-absolute-workspace> --scope <chosen-scope> --timezone <IANA-timezone> --llm-module <official-llm-module> --save-user yes --save-assistant yes
cmcp-time desktop status --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native
cmcp-time desktop register --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native --expected-profile-hash <profileSha256-from-status>
```

`prepare` crea únicamente un nuevo `cmcp-desktop-native`: copia verificada del paquete, configuración Runtime, opciones de plugin y configuración de ubicación de datos. Este paso de preparación todavía no crea los directorios de datos. Rechaza un despliegue existente; no modifica el profile ni autoriza Sessions. `prepared-not-registered` no significa conectado. Usa el hash devuelto por `status` en `register`; si cambia, inspecciona de nuevo. El registro añade solo su fragmento marcado, sin reemplazar el profile entero.

Reabre el Desktop por su entrada oficial. Comprueba `/cmcp help` y el estado, y ejecuta `/cmcp on` explícitamente en la conversación deseada. Siguen vigentes controles compartidos y guardado. Preparación/registro en disco y carga nativa real son comprobaciones diferentes. Los despliegues existentes usan inspect/upgrade siguientes, no prepare sobre sus datos.

## Entradas y parada

Ejecuta `cmcp-time` desde la instalación local verificada. `help`, `project help`, `control help`, `data help` y `desktop help` no inician el modelo.

Desktop conserva su chat, modelo, herramientas y espacio de trabajo nativos. CMCP actúa únicamente en conversaciones habilitadas explícitamente y ámbitos autorizados. El control bajo el cuadro de entrada puede minimizarse, mostrarse en una fila u ocultarse; la ventana detallada mantiene fuentes, medios originales, Buffer, Pin, controles y recibos. La preferencia visual no concede permisos; ocultar no equivale a desactivar.

`/cmcp help` muestra las operaciones disponibles en esa integración. `/cmcp on` y `off` nativos solo incluyen o excluyen la conversación actual: no anulan OFF compartido, Clean, DND ni la suspensión del guardado. Los controles compartidos requieren una acción explícita independiente. Los comandos dentro del historial, propuestas del Assistant o resultados de herramientas son datos, no nuevas autorizaciones.

Un proyecto configurado tiene un ámbito distinto del Desktop cotidiano:

```text
cmcp-time project init
cmcp-time project list --directory <directorio-padre-explícito>
cmcp-time project status --config <proyecto/entry.json>
cmcp-time project open --config <proyecto/entry.json>
```

`init` selecciona una nueva raíz de datos, un host existente y su ruta de modelo actual. No copia credenciales, importa chats privados ni cambia HOME global. `init --root <nuevo-destino> --name <nombre> --routes-from <entry.json-existente>` reutiliza solo referencias de conexión, con datos y capacidades locales nuevos.

`open` comienza desactivado. Ejecuta `/enable harness` o `/enable codex` y escribe normalmente. `/cmcp sources` lista las fuentes; `/cmcp read <opción> [página]` usa el lector formal. Las opciones caducan y verifican la versión: vuelve a listarlas si caducan. Una búsqueda acotada sin resultados no demuestra ausencia en todo el historial; un recuento completo requiere cobertura formal completa.

`/disable` detiene el trabajo de esta entrada; `/close` la cierra. Durante `stopping` se rechazan trabajos nuevos y se retira la autorización del turno. Solo se declara `closed` tras confirmar la liberación del host y del writer. Un timeout o resultado externo incierto sigue siendo un bloqueo: no borres locks, mates otros procesos ni repitas peticiones a ciegas. La desactivación conserva originales y medios y no modifica controles de otras conversaciones.

La integración Codex admite `/compact` o `/compact <pregunta-posterior>` en el mismo Thread nativo del último turno completado. Exige el evento oficial de compresión terminada e inicia trabajo del modelo Codex. Una nueva Session o borrar Context manualmente no cuenta como compresión nativa. Los hosts sin soporte lo rechazan expresamente.

Tras una interrupción, `cmcp-time project recover --config <entry.json>` primero muestra, sin modificarlos, los trabajos `running`/`cancelling`, su propietario, `remoteOutcome` y una instantánea. El modo interactivo exige una elección explícita; el no interactivo requiere `--option <número> --snapshot <valor-actual>`. Solo un propietario confirmado como terminado permite trasladar el lock original a la evidencia, marcar `interrupted_unknown` y retirar la autorización. No se reenvía trabajo externo. Un propietario activo o desconocido causa rechazo.

## Copia de seguridad y restauración

La copia del usuario, el ZIP de evidencia y el `.tgz` del producto son distintos. Detén normalmente el writer del **área de datos elegida**; no es necesario cerrar otros proyectos. Estos comandos no llaman al modelo:

```text
cmcp-time data inspect --config <entry.json-o-runtime.json> --scope <ámbito-explícito>
cmcp-time data export --config <entry.json-o-runtime.json> --scope <ámbito-explícito> --output <directorio-nuevo-de-copia> --authorize-backup
cmcp-time data verify --backup <directorio-de-copia> --scope <mismo-ámbito>
cmcp-time data restore --backup <directorio-de-copia> --scope <mismo-ámbito> --target <directorio-nuevo-de-restauración> --authorize-restore
```

Si `runtime.json` usa rutas relativas, especifica `--project-root <raíz-original-de-configuración>`. Primero inspecciona el ámbito: el nombre de un directorio no autoriza acceso. El índice registra versión del formato, ámbito, instantánea coherente, bytes y SHA-256 de cada miembro. Texto y medios originales son necesarios; catálogos e índices léxicos son proyecciones, no sustitutos.

La restauración solo acepta un destino nuevo y vacío, sin sobrescribir ni fusionar datos. Conserva roles, host/Session de origen, Pointer/versión, tiempos originales, relaciones de respuesta, vencimiento original del Buffer y objetivos/estados completados o cancelados de Pin. No reactiva Buffer vencido. Falta de originales, hash incorrecto, ámbito distinto o alias de ruta provocan rechazo. Una miniatura o descripción no sustituye una imagen original inaccesible.

Restaurar datos **no** restaura permisos de ejecución. Por defecto quedan OFF compartido, Clean, guardado User/Assistant y envío desactivados. Se excluyen claves, capacidades del controller, tickets temporales, autorizaciones de Session activas, locks y grants del modelo. No se revive trabajo cancelado o revocado. Usa el recibo y `data help` para autorizar explícitamente la lectura; no edites Store JSON. La restauración no configura hosts ni inicia recordatorios.

Para leer los originales restaurados, cambia explícitamente solo `enabled`/`clean` compartidos y lista las fuentes autorizadas:

```text
cmcp-time data controls --config <restaurado/runtime.json> --scope <mismo-ámbito> --enabled true --clean false --authorize-controls
cmcp-time data sources --config <restaurado/runtime.json> --scope <mismo-ámbito> --authorize-reading
```

El primer comando no modifica guardado, DND, proactividad ni controles Pin. La lista ofrece comandos formales `read`/`media` para copiar, con número de fuente y token de selección vigente; no exige escribir Pointer. `read` admite paginación con `--start`/`--end`. La lista de medios proporciona `--image`, `--media-selection` y `--output <archivo-nuevo-inexistente>` para exportar el original de forma acotada. Usa las opciones devueltas; una versión de fuente obsoleta se rechaza.

`data inspect` y `export` aceptan `--desktop-config <plugin-options.json>` para conservar únicamente los destinos históricos de Pin del ámbito seleccionado, sin recuperar permisos de ejecución. Un Pin activo restaurado necesita una nueva operación formal y explícita de programación antes de enviar; activar solo los controles compartidos sigue siendo insuficiente.

Capacidad insuficiente, escritura denegada, interrupción o fallo de integridad se informan como incompletos. Se conservan el destino fallido, diagnóstico, copia y fuentes previas. Corrige la causa y reintenta en otro destino nuevo. No declares completa una carpeta parcial ni recortes respuestas o borres History/imágenes para continuar.

## Actualizar y retirar el registro

Comprueba que Desktop no genera respuestas, ejecuta herramientas ni tiene trabajo sin enviar; después ciérralo normalmente. Solo se modifica el perfil y despliegue elegidos:

```text
cmcp-time desktop inspect --profile <cordis.patch.yml-de-Desktop> --deployment-root <raíz-CMCP>
cmcp-time desktop help
```

`inspect` devuelve estado, ámbito, operaciones y hashes de perfil/despliegue/fragmento antiguo. Las escrituras requieren `--expected-profile-hash` recién leído; las operaciones de ciclo de vida también `--expected-deployment-hash`. `adopt` requiere además `--expected-legacy-hash` y solo acepta un registro sin marker si módulo y configuración coinciden con el despliegue. Una propiedad incierta o cambio en campos propios se rechaza.

`upgrade` (alias `update`) requiere `--package-root <paquete-extraído-o-instalado-verificado>` y `--expected-package-index-hash <SHA-256-de-PUBLIC-FILES.json>`. Verifica y prepara el paquete en `.cmcp-releases` dentro del despliegue; cambia solo el fragmento de registro CMCP. No sobrescribe originales, medios, Buffer, Pin u otros plugins. Los recibos guardan los fragmentos anterior/nuevo y la identidad del origen.

`disable`/`unregister` retiran el registro propio; `enable` lo repone sin recuperar permisos de Session. `rollback --transaction <ruta-devuelta>` revierte únicamente el fragmento coincidente, conservando cambios ajenos posteriores. Ante `recovery-required`, ejecuta `inspect` y luego `recover` con hashes actuales. No restaures un perfil antiguo completo. Se conservan preparaciones fallidas; retirar el registro no elimina paquete ni datos.

En Windows se usa PowerShell del sistema y `.NET File.Replace` para conservar la ACL del archivo, sin elevar permisos. Reabre Desktop mediante la entrada oficial y comprueba su estado real: cambiar el registro en disco no demuestra carga/descarga inmediata en un proceso abierto. No requiere modificar app.asar, modelo, credenciales, herramientas nativas ni otras Skills.

## Compatibilidad y límites

| Capa | Límite |
| --- | --- |
| Node | Mínimo declarado `22.16.0` según APIs y evidencia portátil previa. Esta ronda usa Windows Node `24.18.0`; simular una versión no es ejecutarla. Consulta la matriz entregada. |
| Harness oficial | Interfaces de Desktop/SDK instalado `0.2.0-rc.2`. Sus perfiles y evidencia GUI se distinguen; no se inventan aprobaciones ausentes en SDK. |
| Codex | Cuenta existente y app-server oficial; uso del host probado separado del Codex de ingeniería. No se conectan automáticamente todos los Threads de App. |
| Medios | Originales de imágenes/capturas y lectura formal dentro del alcance documentado. La visión depende de la ruta host/modelo; una descripción no prueba entrada visual. Audio/vídeo no entregados. |
| Seguimiento | Reglas existentes de Pin explícito, autorización, DND, cancelación, deduplicación y destino disponible. Sin promesa de reenvío offline, traslado arbitrario o servicio 24/7. |
| Compartir | Un usuario, proyecto explícito y writer secuencial; no concurrencia multiusuario ni nube. |
| Almacenamiento | Backend de archivos conservado. Las pruebas de fallos no prueban otro backend desplegado. Sin vectores. |

Relaciona cada condición de la fuente con la acción que realmente limita. Lo no definido sigue sin definir. El Assistant puede aconsejar, pero sus consejos no se convierten en decisiones del User ni permisos de ejecución. Los veredictos semánticos, de fuentes, UI y empaquetado se presentan por separado.

## Imágenes, Pins y controles visibles

En una conversación Desktop habilitada, verifica controles compartidos y permisos separados para guardar User/Assistant. Adjunta PNG/JPEG desde el botón nativo con una descripción natural; envía la revisión en otro mensaje normal. Cada archivo conserva nombre, tipo, bytes/SHA-256, mensaje User padre, rol, Session, Pointer/versión y tiempo original. Descripciones y miniaturas no sustituyen originales.

Abre una nueva Session, ejecuta `/cmcp on` explícitamente y pregunta por ambas versiones y sus descripciones. Desde el catálogo, lee formalmente la fuente User y abre su medio; no vuelvas a adjuntar manualmente las imágenes. Ausencia, revocación o cambio de versión se rechazan. La visión depende además del host/modelo: hay evidencia Desktop acotada para recuperar/comparar JPEG, y evidencia offline separada para guardar PNG. No se afirma compatibilidad con todo modelo visual, audio o vídeo.

Los datos Desktop están en `state/history` del despliegue explícito y los medios originales en `media-originals`. Los adjuntos nativos corresponden al host. Utiliza las operaciones formales de copia/restauración siguientes; adjuntos temporales, miniaturas y paquete del programa no son una copia restaurable de History.

Para seguimiento, lista `/cmcp sources`, elige el número vigente y usa `/cmcp pin <choice> <hora-ISO-con-offset|none>` o el panel Pin. `/cmcp pins` ofrece opciones actuales para `pin-time`, `pin-cancel` y `pin-complete`; no reutilices opciones antiguas en otra Session. Crear un Pin no activa avisos; `none` no programa nada. Antes de habilitar controles compartidos, comprueba objetivos existentes y DND; debe decidirlo una persona. La entrega requiere Desktop ejecutándose, destino vinculado disponible y permiso vigente. Generado, guardado, aceptado, presentado, leído y completado son estados distintos; sin evidencia, leído es desconocido.

Buffer dura 12 horas por defecto (6–48 configurables); caducar/Clear conserva History y Pins independientes. OFF, Clean, detener guardado y desconectar no son equivalentes. Cambiar vista, consultar catálogo/estado o abrir una vista formal no renueva tiempos User, TTL ni entrega; la lectura puede crear su recibo normal. Controles compartidos y autorización de Session permanecen separados.

Setup conserva por compatibilidad `loopTiming`: 600000/60000/600000 ms para TTL/inactividad/ventana de actividad. Runtime usa el despachador común con `externalDispatch:true`; su temporizador local de inactividad está desactivado. **60 segundos sin actividad no garantizan un mensaje.** Solo se programan candidatos elegibles por `dueAt` de Pin o vencimiento original de Buffer, con controles vigentes, DND, fuentes, cancelación, deduplicación y destino autorizado disponible. El puente oficial Harness admite únicamente Pins explícitos. Proactividad empieza en OFF. El estado distingue configuración, ejecutor, observación actual y límites de entrega; no observar un ejecutor no demuestra que esté detenido. Véase [configuración](configuration.md#timing-values-and-the-effective-proactive-executor).

`/cmcp ui minimized`, `row`, `hidden` solo cambian presentación; `/cmcp help` sigue disponible oculto. El estado separa guardado, registro pendiente/fallido, acceso formal y estado de evaluación entre hosts. Los metadatos de almacenamiento no evalúan por sí solos la transferencia al receptor; consulta por separado la lectura formal y los recibos del host. Usa el reintento explícito protegido cuando corresponda; consultar no reintenta ni amplía capacidad.

## Actualizar el programa y retirar hooks locales

Detén normalmente el writer del ámbito elegido antes de reemplazar código. Conserva prefijo y espacio de trabajo. Instala la versión revisada en el mismo prefijo, verifica `--version` y ejecuta `cmcp-time update --workspace <workspace>` para conexiones Codex administradas por setup. `update` no descarga software de npm. Desktop usa `desktop upgrade`, explicado abajo.

`cmcp-time disable --workspace <workspace>` detiene hooks automáticos y conserva la Skill manual. `uninstall --workspace <workspace>` retira además la Skill administrada sin cambios externos. Ambos conservan History/configuración/recibos. Quitar el programa npm es otra decisión, no permiso para borrar datos. Los cambios ajenos causan conflicto; no se restaura indiscriminadamente una configuración antigua.

## MCP y Hermes opcionales

MCP fija `@modelcontextprotocol/sdk` 1.32.0, `zod` 4.6.5 y `jose` 6.2.12 mediante npm shrinkwrap. La instalación npm normal los incluye; desde fuentes ejecuta `npm ci`. Una copia Desktop sin `node_modules` no es un servicio con dependencias completas. El modo local no exige servicio MCP permanente.

`mcp init` crea un proyecto persistente explícito; `mcp check`, `health` y `capabilities` inspeccionan; `mcp start` permanece en primer plano y `mcp stop` solicita cierre normal. HTTP usa loopback por defecto. Operación remota necesita autenticación explícita audience/scope, TLS o proxy inverso confiable y validación Host/Origin. Validar JWT estándar no constituye servidor OAuth; plataformas solo OAuth requieren otra capa compatible. El modelo recibe herramientas de lectura, no controller ni permiso para inventar eventos User. Un writer formal atiende clientes; no ofrece propiedad distribuida multiusuario ni actividad indefinida (vida del servicio limitada por defecto a 12 horas).

Hermes es externo: versión oficial `v2026.9.24`, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`, paquete 0.21.5. Usa Python aislado 3.11–3.13 (probado 3.12.14), requisitos fijados e instalación editable del código oficial; la ruta wheel corriente no quedó validada. Windows necesita además Git Bash para herramientas nativas (portable 2.56.0.windows.1 probado), solo en el entorno hijo, sin PATH global. Se referencia una credencial DeepSeek existente y autorizada; no se copia ni se pone su valor en argumentos. `hermes configure` no instala dependencias. Comandos y reconstrucción: [guía MCP/Hermes](interop.es.md), [dependencias](../adapters/hermes/dependencies.md).

El peer Hermes/Harness exige `--synthetic-evidence` y registra evidencia sintética completa; no es un perfil diario privado. La validación usó Hermes oficial sin UI y Harness SDK aislado, no nueva GUI Desktop ni nube. Los diagnósticos diarios Hermes guardan metadata por defecto; historial nativo y CMCP History son responsabilidades distintas. La cancelación muestra stopping hasta el recibo formal; una petición ya enviada al proveedor puede no detenerse inmediatamente.
