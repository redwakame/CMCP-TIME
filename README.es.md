# CMCP-TIME

**Conserva las palabras originales. Comprende el tiempo entre ellas.**

[English](README.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [日本語](README.ja.md)

**Una skill de continuidad temporal para agentes de IA:** retoma una conversación mediante palabras, imágenes, roles y tiempos originales, manteniendo tu host y modelo habituales.

**0.1.0 · Apache-2.0 · Autor original: [redwakame](https://github.com/redwakame)**

## Recupera el original correcto

Ayer redactaste un plan; hoy cambias un detalle. En una conversación nueva, CMCP ayuda a recuperar ambas versiones y distinguir una decisión del User de una propuesta del Assistant. Cada imagen revisada conserva su archivo original y su relación con la fuente, no solo una descripción.

![Ejemplo de original, revisión y lectura formal entre conversaciones](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.0/docs/assets/continuity-source-flow.png)

Σ representa el concepto de resumen derivado; el diagrama no anuncia una función nueva de resumen.

El diagrama explica un uso; no reproduce una respuesta medida. CMCP aporta fuentes, sin sustituir el razonamiento del host ni reescribir su respuesta final. El modelo aún puede interpretar mal una fuente correcta.

## Instala 0.1.0

Paquete: [`@redwakame-skill/cmcp-time`](https://www.npmjs.com/package/@redwakame-skill/cmcp-time/v/0.1.0). Fuente fija: [v0.1.0](https://github.com/redwakame/CMCP-TIME/tree/v0.1.0); `main` puede contener cambios posteriores. Usa la versión exacta: `latest` y `next` son canales modificables, no identidades de versión.

Prepara Node.js **22.16.0 o superior** y npm. Elige dos directorios persistentes: programa y datos autorizados del espacio de trabajo. Ejemplo PowerShell sin permisos de administrador ni cambios globales de PATH:

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.0 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

El asistente configura el modo local y la conexión administrada de Codex. Harness Desktop oficial y MCP/Hermes opcionales tienen pasos propios en la [guía de uso](docs/release-readiness.es.md). Instalar no conecta un host, importa chats privados, autoriza modelos de pago ni activa avisos. No enlaces integraciones persistentes a la caché temporal de `npx`.

[POSIX, paquete local y actualizaciones](docs/npm-installation.md) · [Inicio rápido](docs/quick-start.md)

## Elige una ruta con evidencia

![Un almacén autorizado de originales y conexiones opcionales de hosts y MCP](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.0/docs/assets/host-interoperability.png)

Dos rutas secuenciales demostradas por separado: Codex ↔ Harness y Hermes ↔ Harness. No es una prueba concurrente de tres hosts; MCP discontinuo es opcional y comparte Core.

| Ruta | Alcance demostrado | Límite |
|---|---|---|
| DeepSeek Harness Desktop oficial 0.2.0-rc.2 | Texto nativo, imágenes originales, recuperación en otra conversación, controles y Pins internos explícitos | GUI nativa y SDK aislado se verifican por separado; sin promesa de servicio 24/7 ni avisos móviles |
| Codex | Skill/hooks, traspaso de texto mediante app-server oficial y compactación nativa acotada | Proyecto y cuenta explícitos; no captura automáticamente cualquier chat de la App |
| Hermes v2026.9.24 / 0.21.5 | Ciclo oficial sin UI, herramientas nativas y traspaso de texto con Harness SDK | Dependencias externas Python/Git Bash; ruta DeepSeek probada; no certifica TUI ni GUI Desktop |
| MCP stdio / Streamable HTTP | Clientes reales, lectura formal, handles de medios, ámbito/revocación y servicio local persistente | Transporte opcional; pruebas locales no certifican nube, TLS remoto ni aprobación de plataformas |

OpenClaw, dots, Grok Bot y Muse tienen requisitos distintos: consulta la [matriz](docs/interop-capabilities.zh-TW.md). El último incremento de interoperabilidad se probó en Windows Node 24.18.0; pruebas anteriores en Linux/Node 22.16.0 no certifican cada nuevo adaptador u OS. Traducir la documentación tampoco certifica el comportamiento en cuatro idiomas.

## Utiliza, inspecciona y detén

![Entrada mínima, detalle bajo demanda y controles separados de permiso y guardado](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.0/docs/assets/controls-modes.png)

Esquemas conceptuales, no capturas GUI reales: 1 minimizado, 2 una fila, 3 oculto.

| Necesidad | Entrada |
|---|---|
| Controles nativos Desktop | `/cmcp help`; `/cmcp on` incorpora esta conversación; `/cmcp off` la retira |
| UI mínima, una fila u oculta | `/cmcp ui minimized`, `/cmcp ui row`, `/cmcp ui hidden`; ocultar no desactiva CMCP |
| Fuentes, tiempo e imágenes | Catálogo → lectura formal → vista autorizada del medio; **READ-ALL** abarca el conjunto autorizado seleccionado completo, no top-k |
| Traspaso sin UI | `cmcp-time project init`, después `project open --config <entry.json>`; habilita explícitamente el host elegido |
| Seguimiento explícito | Selecciona fuente formal, objetivo y hora opcional en Pin; sin hora no hay recordatorio automático |
| Datos y ciclo de vida | `data help`, `desktop help`, `mcp help`, `hermes help`; copia/restauración y desconexión reversible |

History, Buffer y Pin tienen responsabilidades diferentes. Buffer dura 12 horas por defecto, configurable de 6 a 48; caducar o Clear no borra History ni Pins independientes. Los avisos empiezan OFF. Se aplican DND, autorización vigente, cancelación y deduplicación; entregar no significa completar ni leer. Incorporar una conversación no elimina OFF/Clean compartidos ni cambia el guardado.

**Guardado no significa recuperable.** El estado separa originales guardados, registro pendiente/fallido, acceso formal y estado de evaluación entre hosts. Los metadatos de almacenamiento no evalúan por sí solos la transferencia al receptor; consulta por separado la lectura formal y los recibos del host. Consultar o cambiar la UI no renueva tiempos/TTL, crea permisos ni envía avisos. Originales ausentes, versiones obsoletas o fuentes revocadas se rechazan.

Antes de actualizar, consulta [copia, restauración y actualización](docs/release-readiness.es.md). Programa, History, historial nativo del host y credenciales tienen responsabilidades separadas. Desconectar conserva originales; no borra el historial nativo ni constituye una política completa de eliminación. 0.1.0 no entrega vectores, audio/vídeo, sincronización en la nube ni writers concurrentes multiusuario.

## Documentación y proyecto

[Guía de uso](docs/release-readiness.es.md) · [MCP/Hermes y autohospedaje](docs/interop.es.md) · [Comandos](docs/commands.md) · [Configuración](docs/configuration.md) · [Privacidad](docs/privacy.md) · [Evidencia y límites](docs/verification.md) · [Hoja de ruta](docs/roadmap.md)

**CMCP-TIME es la línea actual.** [OpenClaw Continuity](https://github.com/redwakame/openclaw-continuity) y [cmcp](https://github.com/redwakame/cmcp) conservan trabajos anteriores, con sus propias licencias y evidencia; no implican sustitución directa ni migración automática.

## Autoría y colaboración


Las ideas, incidencias reproducibles, evaluaciones independientes y propuestas de colaboración son bienvenidas. No publiques conversaciones privadas ni credenciales. Consulta [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [privacidad](docs/privacy.md) y [hoja de ruta](docs/roadmap.md).

¿Te interesa CMCP-TIME? Me encantará intercambiar ideas y conocer tu experiencia. Si el proyecto te resulta útil, puedes apoyarlo con una estrella en GitHub. Seguiré mejorándolo y actualizándolo; también son bienvenidas las propuestas de colaboración comercial. Escríbeme a [adarobot666@gmail.com](mailto:adarobot666@gmail.com) o [redwakame616@gmail.com](mailto:redwakame616@gmail.com).

Autor original y mantenedor: **redwakame**. Distribución actual bajo [Apache-2.0](LICENSE), con [NOTICE](NOTICE) y [procedencia de licencias](docs/license-provenance-v0.1.md). No se revocan permisos anteriores ni se añade una obligación publicitaria por cada uso. El identificador interno sigue siendo `cmcp`; el nombre público es **CMCP-TIME**. [CITATION.cff](CITATION.cff) facilita su cita.

[0.1.0](docs/release-0.1.0.md) · [Pruebas reproducibles](docs/testing.md)
