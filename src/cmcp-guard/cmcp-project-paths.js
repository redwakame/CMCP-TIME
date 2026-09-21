import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only controllable CMCP temporary output; never changes the caller's environment.
export const cmcpProjectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const cmcpPackageRoot = cmcpProjectRoot;
// Installed assets are not a data authorization root. Source checkouts retain their legacy default.
export function resolveCmcpWorkspaceRoot(workspace) {
  const installed = cmcpPackageRoot.split(path.sep).includes('node_modules');
  if (workspace === undefined && installed) throw Error('installed_package_requires_explicit_workspace');
  if (workspace !== undefined && (typeof workspace !== 'string' || !workspace.trim())) throw Error('explicit_workspace_required');
  const selected = path.resolve(workspace ?? cmcpProjectRoot);
  if (!fs.statSync(selected).isDirectory()) throw Error('workspace_directory_required');
  const root = fs.realpathSync(selected);
  const relative = path.relative(cmcpPackageRoot, root);
  if (installed && (!relative || !relative.startsWith('..') && !path.isAbsolute(relative))) throw Error('workspace_must_not_be_installed_assets');
  return root;
}
export function cmcpWorkspacePath(workspace, value) {
  if (typeof value !== 'string' || !value) throw Error('explicit_workspace_path_required');
  const root = resolveCmcpWorkspaceRoot(workspace), target = path.resolve(root,value), relative = path.relative(root,target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('workspace_path_outside_root');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current,part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('workspace_redirect_forbidden'); }
    catch(error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
export function cmcpProjectTempRoot(workspace) {
  const root = resolveCmcpWorkspaceRoot(workspace);
  const target = path.join(root, 'runtime-data', 'tmp');
  for (const part of ['runtime-data', 'tmp']) {
    const parent = part === 'runtime-data' ? root : path.join(root, 'runtime-data');
    const dir = path.join(parent, part);
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('project_temp_redirect_forbidden');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.realpathSync(dir).toLowerCase() !== dir.toLowerCase()) throw Error('project_temp_redirect_forbidden');
  }
  return target;
}
export function cmcpProjectProcessEnvironment(base = process.env, workspace) {
  const temp = cmcpProjectTempRoot(workspace);
  return { ...base, TEMP: temp, TMP: temp, TMPDIR: temp };
}
