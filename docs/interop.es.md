# MCP opcional y servicio autohospedado

CMCP mantiene Skill-first. El modo local y los adaptadores nativos no requieren un servicio permanente. MCP usa el mismo Core y lector formal; no genera otra respuesta ni sustituye el History original.

```sh
cmcp-time mcp help
cmcp-time service help
cmcp-time data help
```

Consulte la [guía MCP](../adapters/mcp/README.md), los [ejemplos](interop-config-examples.md) y la [matriz de capacidades](interop-capabilities.zh-TW.md). `service` es un alias de `mcp`. Cree un proyecto separado, con autorización explícita y almacenamiento persistente.

El modelo solo recibe herramientas de lectura. Los eventos fiables del host capturan la entrada User y la respuesta Assistant visible; los roles o fechas declarados por el modelo no son originales verificados. La autorización humana, el reintento de registro y los controles compartidos usan entradas separadas. Instalar no autoriza conversaciones ni activa seguimientos.

El estado distingue originales guardados, registro pendiente, registro fallido y elegibilidad actual para lectura formal. El acceso desde otro host necesita además una vinculación autorizada. Consultar no reintenta automáticamente: el menú humano o la operación `retry-registration` aplica las protecciones de OFF, Clean y cancelación, sin aumentar capacidad ni borrar originales.

HTTP se limita a loopback por defecto. El acceso remoto requiere autenticación explícita y HTTPS o un proxy inverso de confianza. JWT preconfigurado no equivale a un servidor OAuth. Separe programa, datos persistentes, temporales y credenciales. Una misma cuenta del sistema con acceso arbitrario a archivos o shell no aísla secretos.

Detenga el servicio antes de `data export/verify/restore`; consulte `data help`. Tras reiniciar, vuelva a comprobar la autorización: un token o sesión de transporte anterior no la restablece. Desactivar o desconectar conserva History y medios. Consulte la [integración Hermes](../adapters/hermes/README.md).

CMCP-TIME 0.1.0 ofrece esta interfaz local/autohospedada opcional. La validación local no equivale a nube ni aprobación de plataforma; consulta [identidad de versión](release-0.1.0.md) y [guía de uso](release-readiness.es.md).

## Entrada normal de Hermes

Instale la versión oficial fijada en un entorno aislado según su README. Sustituya los marcadores por rutas explícitas; no escriba claves en comandos. `credential-file` referencia un archivo de credenciales ya autorizado. En Windows, las herramientas nativas necesitan Git Bash configurado; puede indicar `--git-bash <bash.exe>`.

```text
cmcp-time hermes configure --service <mcp-service.json> --python <Python> --home <nuevo-profile-del-proyecto> --credential-file <credenciales-existentes> --output <hermes.json>
cmcp-time hermes inspect --config <hermes.json>
cmcp-time hermes chat --config <hermes.json> --session <nueva-session> --authorize-session --stdin
```

Inicie primero el servicio MCP correspondiente y envíe la entrada normal por stdin. La misma sesión conserva su historial nativo; una nueva consulta los originales autorizados de CMCP. Sustituya `--authorize-session` por `--native-only` para desactivar la captura CMCP sin borrar originales. Los registros adicionales diarios guardan solo metadatos por defecto; el historial nativo de Hermes tiene su propia responsabilidad de conservación. Cancele y detenga mediante las entradas oficiales, esperando el recibo de liberación.

`hermes harness-configure` y `harness-chat` reutilizan el driver Harness para validación sintética explícita; el segundo exige `--synthetic-evidence`. Ese perfil guarda evidencia sintética completa y no es un perfil diario para conversaciones privadas. Las aprobaciones de otras plataformas se indican aparte.

## Dependencias y comandos del servicio

Usa un entorno nuevo Python 3.11–3.13 (probado 3.12.14). Obtén primero Hermes oficial v2026.9.24, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f` (paquete 0.21.5); la ruta editable debe corresponder a esa fuente verificada, no a otro checkout. Windows necesita Git Bash aparte; se probó portable 2.56.0.windows.1 y `--git-bash <bash.exe>` solo afecta al proceso hijo. No quedó validada la instalación wheel ordinaria. Consulta [reconstrucción](../adapters/hermes/dependencies.md).

```text
python -m venv <new-venv>
<venv-python> -m pip install -r <cmcp-package>/adapters/hermes/requirements-tested.txt
<venv-python> -m pip install --no-deps --no-build-isolation -e <verified-official-hermes-source>
```

```text
cmcp-time mcp init --root <new-project-root> --project <project-name> --hosts generic,hermes,harness --port 8766 --timezone <IANA-timezone>
cmcp-time mcp check --config <new-project-root>/mcp-service.json
cmcp-time mcp start --config <new-project-root>/mcp-service.json
```

```text
cmcp-time mcp health --config <new-project-root>/mcp-service.json
cmcp-time mcp capabilities --config <new-project-root>/mcp-service.json
cmcp-time mcp stop --config <new-project-root>/mcp-service.json
```

`<venv-python>` es el ejecutable propio del entorno; no exige activarlo ni cambiar PATH global. Sustituye todos los marcadores. npm ya incluye dependencias MCP fijas; desde fuentes usa `npm ci`. Ejecuta start en una terminal; health/capabilities y finalmente stop en otra. Init permite guardar User/Assistant en el nuevo proyecto explícito, deja proactive/Pin OFF y exige que cada Session se incorpore; no importa chats existentes. `--stdin` necesita EOF antes de responder; también puedes usar `--message "tu pregunta"`.
