import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {assertCmcpProvider} from './cmcp-provider-policy.js';
import {resolveCmcpWorkspaceRoot, cmcpProjectProcessEnvironment, cmcpWorkspacePath} from './cmcp-project-paths.js';
/** Read only an explicit CMCP credential reference through a private captured pipe. */
export async function readCmcpProtectedCredential(referencePath, provider = "deepseek", {workspace} = {}) {
  assertCmcpProvider(provider); // Before reading any reference or spawning the credential helper.
  if (!["deepseek", "groq"].includes(provider)) throw Error("unsupported_credential_provider");
  if (process.platform !== "win32" || !path.isAbsolute(referencePath)) throw Error("windows_credential_reference_required");
  const root=resolveCmcpWorkspaceRoot(workspace);
  cmcpWorkspacePath(root,referencePath);
  const script = fileURLToPath(new URL("../../scripts/cmcp-protected-credential.ps1", import.meta.url));
  const executable = path.join(process.env.ProgramFiles ?? "C:/Program Files", "PowerShell/7/pwsh.exe");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-NoProfile", "-NonInteractive", "-File", script, "-Operation", "Read", "-Provider", provider, "-ReferencePath", referencePath, "-Workspace", root],
      { cwd: root, env: cmcpProjectProcessEnvironment(process.env,root), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let secret = "", invalid = false;
    const timer = setTimeout(() => { invalid = true; child.kill(); }, 10000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", data => { secret += data; if (Buffer.byteLength(secret) > 8192) { invalid = true; child.kill(); } });
    child.stderr.resume();
    child.once("error", () => { clearTimeout(timer); secret = undefined; reject(Error("credential_reader_unavailable")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code !== 0 || invalid || !secret?.trim()) { secret = undefined; reject(Error("credential_unavailable")); }
      else { resolve(secret); secret = undefined; }
    });
  });
}
