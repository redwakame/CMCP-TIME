import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
/** Preserve the existing Windows file's ACL instead of inheriting a temporary
 * file's ACL through MoveFileEx. Paths are environment data, never shell code.
 * The caller must have completed its exact preimage and path identity checks. */
export async function replaceExistingFile(source,target,{io=fs,expectedHash}={}){
  if(io.rename!==fs.rename)return io.rename(source,target); // controlled fault-injection seam
  if(process.platform!=='win32')return io.rename(source,target);
  const systemRoot=process.env.SystemRoot??process.env.WINDIR;
  if(!systemRoot||!path.isAbsolute(systemRoot))throw Error('cmcp_windows_system_root_unavailable');
  if(!/^[a-f0-9]{64}$/u.test(expectedHash??''))throw Error('cmcp_windows_replace_preimage_required');
  const powershell=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const command="$ErrorActionPreference='Stop'; $algorithm=[System.Security.Cryptography.SHA256]::Create(); $stream=[System.IO.File]::OpenRead($env:CMCP_REPLACE_TARGET); try { $actual=[BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $algorithm.Dispose() }; if($actual -ne $env:CMCP_REPLACE_PREIMAGE){ throw 'cmcp_profile_changed_before_replace' }; [System.IO.File]::Replace($env:CMCP_REPLACE_SOURCE, $env:CMCP_REPLACE_TARGET, [System.Management.Automation.Language.NullString]::Value, $false)";
  try{
    await execute(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{
      windowsHide:true,timeout:15000,maxBuffer:16384,
      env:{SystemRoot:systemRoot,WINDIR:systemRoot,TEMP:path.dirname(source),TMP:path.dirname(source),CMCP_REPLACE_SOURCE:source,CMCP_REPLACE_TARGET:target,CMCP_REPLACE_PREIMAGE:expectedHash}
    });
  }catch{throw Error('cmcp_windows_preserving_replace_failed');}
}
