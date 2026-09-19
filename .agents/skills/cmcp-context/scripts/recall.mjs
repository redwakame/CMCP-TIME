import {runCmcpHostContextCli} from '../../../../scripts/cmcp-host-context-cli.mjs';
import {runCmcpHostOperation} from '../../../../scripts/cmcp-host-operation.mjs';
try{
  if(process.argv.slice(2).some(arg=>arg==='--request'||arg.startsWith('--request=')))await runCmcpHostOperation();
  else await runCmcpHostContextCli();
}catch(error){console.error(error.message);process.exitCode=1;}
