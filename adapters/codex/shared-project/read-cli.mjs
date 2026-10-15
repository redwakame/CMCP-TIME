import fs from 'node:fs/promises';
import {readTool,safeError,readCapabilities} from './adapter.mjs';

export async function runReadCli({bindingFile,ticketFile,argv = process.argv.slice(2),stdin = process.stdin,stdout = process.stdout,stderr = process.stderr,call}) {
  try {
    if(argv.length===1&&argv[0]==='capabilities'){stdout.write(JSON.stringify(readCapabilities)+'\n');return 0;}
    if (argv.length !== 1 || !['find','open','read','progress','continuity','continuity-page'].includes(argv[0])) throw Error('codex_shared_read_usage');
    const chunks=[]; let bytes=0;
    for await (const chunk of stdin) { bytes+=Buffer.byteLength(chunk); if(bytes>131072) throw Error('codex_shared_input_too_large'); chunks.push(chunk); }
    const body=Buffer.concat(chunks.map(value=>Buffer.from(value))).toString('utf8').trim();
    const args=body?JSON.parse(body):{};
    const [binding,ticket]=await Promise.all([fs.readFile(bindingFile,'utf8').then(JSON.parse),fs.readFile(ticketFile,'utf8').then(JSON.parse)]);
    const result=await readTool({binding,ticket,operation:argv[0],args,call});
    stdout.write(JSON.stringify(result)+'\n'); return 0;
  } catch(error) { stderr.write(safeError(error)+'\n'); return 1; }
}
