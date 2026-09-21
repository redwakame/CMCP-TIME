# CMCP-TIME

### Conserva las palabras originales. Entiende el tiempo transcurrido.

[English](README.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [日本語](README.ja.md)

**Una skill de continuidad temporal para agentes de IA.** CMCP ayuda a un agente existente a retomar una conversación con las fuentes, las fechas y el estado adecuados, sin volver a introducir todo el historial en cada solicitud al modelo.

**Candidato npm local `0.1.0-rc.2` · Apache-2.0 · Autor original: [redwakame](https://github.com/redwakame)**

![Ejemplo ilustrativo de continuidad temporal; no es una prueba grabada](docs/assets/timeline.es.png)

## Por qué existe

Una propuesta de ayer no es una decisión de hoy. Un borrador ya entregado no debería volver a tratarse como una tarea pendiente de empezar. Que una conversación salga del contexto activo del modelo no es motivo para perder sus palabras originales.

CMCP conserva las fuentes de texto autorizadas, sus roles y sus marcas de tiempo. Un catálogo de fuentes y tiempos permite localizarlas. Antes de responder, entrega al modelo únicamente el contexto pertinente y acotado; cuando importa la redacción exacta, vuelve a la fuente original.

**No sustituye los conocimientos, el razonamiento, la personalidad ni las políticas de seguridad del modelo anfitrión.** Tampoco reescribe sus respuestas para simular un estilo. El modelo todavía puede equivocarse: el objetivo es fundamentar mejor la continuidad, no prometer una memoria perfecta.

## Qué ofrece esta versión

| Necesidad | Función | Límite importante |
|---|---|---|
| Retomar una conversación tras una pausa | Tarjetas temporales por turno y captura autorizada | Requiere los controles habilitados y una conexión operativa |
| Comprobar qué se dijo y cuándo | Catálogo, candidatos locales y lectura exacta | La fecha del mensaje no prueba cuándo ocurrió el hecho |
| Ver lo esencial | **READ**: esquema respaldado por fuentes, fechas y cobertura | El resumen no reemplaza el original |
| Ver el contexto completo de la selección | **READ-ALL**: colección autorizada y congelada, paginada | No equivale a todo el historial de una cuenta |
| Comprobar o contar mensajes del historial | Verificación por lotes con cobertura y reanudación | Menciones, planes y relatos del usuario no son equivalentes |
| Mantener asuntos recientes pendientes | **Buffer**: 12 horas por defecto, ajustable entre 6 y 48 | Caducar o vaciarlo no borra History ni los Pins independientes |
| Fijar un seguimiento concreto | **Pin**: objetivo explícito y hora opcional | Sin hora no se programa un aviso; enviar no significa completar |
| Controlar la intervención | Guardado, recuperación, tiempo, Buffer, Pin, Clean, OFF y DND | Los avisos automáticos están **desactivados por defecto** |

Esta versión no necesita una base de datos vectorial ni descargar un modelo de embeddings. Ya combina localización local e interpretación semántica asistida por el modelo; eso no garantiza una recuperación semántica exhaustiva.

## Componentes con responsabilidades distintas

![Historial, catálogo temporal, contexto acotado y avisos opcionales](docs/assets/architecture.es.png)

**History** conserva el texto autorizado; el **catálogo temporal y de fuentes** lo localiza. **Buffer** representa continuidad reciente elegible. Los **Pins** son objetivos fijados explícitamente. No son cuatro copias de la misma conversación.

El catálogo no caduca con las entradas de Buffer. Una charla cotidiana puede quedar fuera de Buffer y seguir siendo consultable. Solo se aporta al modelo lo necesario ahora. Las propuestas del asistente no se convierten en decisiones del usuario, y las fechas desconocidas siguen siendo desconocidas.

## Instalar el candidato npm local

El nombre propuesto es `@redwakame-skill/cmcp-time`; **todavía no está publicado en npm**. Instala el `.tgz` suministrado en un prefijo persistente con permisos de usuario y ejecuta `cmcp-time setup --workspace <directorio-existente>`. Los archivos del programa y los datos persistentes están separados. En Windows usa `<prefix>/cmcp-time.cmd`; en POSIX, `<prefix>/bin/cmcp-time`. Consulta la [guía de instalación y actualización](docs/npm-installation.md), en inglés, para los comandos completos. No se admite una conexión persistente de Hook/Skill basada en la caché de `npx`. Instalar no conecta un Host, lee History, concede llamadas de pago ni activa avisos automáticos.

## Obtener el código e iniciar la configuración

```sh
git clone https://github.com/redwakame/CMCP-TIME.git
cd CMCP-TIME
```

También: `gh repo clone redwakame/CMCP-TIME`, SSH `git clone git@github.com:redwakame/CMCP-TIME.git`, o **Code → Download ZIP** en GitHub. Las etiquetas y los archivos de una publicación identifican versiones fijas cuando estén disponibles. Esta distribución de fuentes no implica que exista una publicación en npm; no supongas que `npm install cmcp` instala este proyecto.

Instala Node.js por separado. El mínimo declarado es Node 18. La verificación de configuración en Windows utilizó **Node 24.18.0, PowerShell 7.6.6 y Codex CLI 0.154.0**; no es una matriz completa de compatibilidad.

```sh
node scripts/cmcp-setup.mjs --help
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --host-workspace local-data/my-cmcp-host
```

El asistente confirma guardado, alcance autorizado, zona horaria, idioma y controles. Configura CMCP y, opcionalmente, hooks locales de Codex. **No instala Node ni agentes, no inicia sesión, no concede llamadas de pago y no autoriza avisos en tu nombre.** No hay dependencias de ejecución de npm que instalar.

**Con Codex:** selecciona el modo host y revisa los hooks generados. Se utiliza el modelo del anfitrión y no hace falta una clave de DeepSeek. Consulta [inicio rápido](docs/quick-start.md) y [límites de instalación y hosts](docs/installation-and-hosts.md), en inglés.

**Playground independiente:** necesita un proveedor configurado, una credencial protegida y autorización finita. La ruta de credenciales incluida actualmente depende de **Windows DPAPI y PowerShell 7**. DeepSeek es la integración de referencia implementada, no una restricción conceptual del núcleo. Consulta [configuración](docs/configuration.md).

## Controles utilizables

Estos comandos pertenecen a **CMCP Playground**, no al intérprete nativo de todos los agentes:

```text
/controls
/read ¿Qué hablamos ayer sobre el plan de entrega?
/read-all Muestra el contexto completo de esa discusión.
/next
/set bufferRetentionHours 24
/proactive off
/pins
/clean on
```

Para fijar un objetivo, usa un número real devuelto por `/topics` con `/pin`, o una fuente registrada con `/pin-source`. `/pin-time`, `/pin-complete` y `/pin-cancel` cambian su hora o estado. Los parámetros se documentan en la [referencia de comandos](docs/commands.md); no hay que inventar identificadores.

Los avisos necesitan un Runtime y un canal activos. Buffer y Pin comparten el interruptor principal, el horario de no molestar, las comprobaciones de fuentes y la deduplicación. Una salida de consola no es una notificación móvil, una confirmación de lectura ni un servicio permanente.

## Verificación y límites

Es una **versión candidata de ingeniería utilizable**, no una garantía universal de producción. Las pruebas del programa, la integridad de las fuentes, la semántica del modelo y la integración del anfitrión se describen por separado en [verificación](docs/verification.md).

La base revisada incluye recuperación acotada, tarjetas temporales, controles separados, avisos locales Buffer/Pin y una ruta probada de hooks y compactación manual de Codex. El empaquetado también tuvo verificaciones reales del asistente y helper en Windows sin token de administrador. Las pruebas sintéticas no son nuevas pruebas con modelos reales.

**No se afirma** compatibilidad completa con todos los hosts, sistemas operativos o versiones; compactación automática totalmente fiable; capacidad ilimitada; interpretación perfecta; sincronización en la nube; avisos móviles; ni gestión integral de borrado de History. Claude Code, OpenClaw, Hermes, DeepSeek Harness y Grok Bot siguen siendo destinos de adaptación, no una lista de integraciones verificadas. La traducción de documentos no certifica el comportamiento del producto en cada idioma.

## Autoría y colaboración

Las ideas, incidencias reproducibles, evaluaciones independientes y propuestas de colaboración son bienvenidas. No publiques conversaciones privadas ni credenciales. Consulta [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [privacidad](docs/privacy.md) y [hoja de ruta](docs/roadmap.md).

Autor original y mantenedor: **redwakame**. Distribución actual bajo [Apache-2.0](LICENSE), con [NOTICE](NOTICE) y [procedencia de licencias](docs/license-provenance-v0.1.md). No se revocan permisos anteriores ni se añade una obligación publicitaria por cada uso. El identificador interno sigue siendo `cmcp`; el nombre público es **CMCP-TIME**. [CITATION.cff](CITATION.cff) facilita su cita.
