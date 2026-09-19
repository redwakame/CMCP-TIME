import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only controllable CMCP temporary output; never changes the caller's environment.
export const cmcpProjectRoot = fileURLToPath(new URL('../../', import.meta.url));
export function cmcpProjectTempRoot() {
  const root = fs.realpathSync(cmcpProjectRoot);
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
export function cmcpProjectProcessEnvironment(base = process.env) {
  const temp = cmcpProjectTempRoot();
  return { ...base, TEMP: temp, TMP: temp, TMPDIR: temp };
}
