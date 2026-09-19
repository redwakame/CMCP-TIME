import {loopHash} from './cmcp-local-loop-journal.js';

/** Framing only: never search for JSON, complete syntax, alter fields or infer meaning. */
export function parseCmcpJsonOutput(raw,{mode='strict_json'}={}){
  if(!['strict_json','single_json_fence'].includes(mode))throw new TypeError('invalid_json_framing_mode');
  if(typeof raw!=='string')throw new SyntaxError('invalid_json');
  let parsed,content=raw,start=0,end=raw.length,format='bare_json';
  try{parsed=JSON.parse(raw);}catch(original){
    if(mode==='strict_json')throw original;
    // One whole fenced block only, exact language tag and independent fence lines.
    // Prefix/suffix whitespace is framing; every byte inside remains unchanged.
    const match=/^([ \t\r\n]*```json\r?\n)([\s\S]*?)(\r?\n```[ \t\r\n]*)$/.exec(raw);
    if(!match||/^[ \t]*```/m.test(match[2]))throw new SyntaxError('invalid_json');
    content=match[2];start=match[1].length;end=start+content.length;format='single_json_code_fence';
    parsed=JSON.parse(content);
  }
  return {value:parsed,framing:{version:1,mode,format,
    contentRange:{unit:'utf16_code_units',start,end},rawBytes:Buffer.byteLength(raw),jsonBytes:Buffer.byteLength(content),
    rawSha256:loopHash(raw),jsonSha256:loopHash(content),semanticEdits:false}};
}
