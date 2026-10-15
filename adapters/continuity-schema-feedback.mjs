import {continuityToolSchema,CONTINUITY_TOOL_PARAMETERS} from './continuity-input.mjs';

export const CONTINUITY_SCHEMA_FEEDBACK_LIMITS=Object.freeze({maxIssues:8,maxPathSegments:16,maxArrayIndex:4095,maxBytes:4096});
const limits=CONTINUITY_SCHEMA_FEEDBACK_LIMITS;
const codes=new Set(['invalid_type','invalid_value','too_small','too_big','unrecognized_keys','invalid_union','invalid_format','custom']);
const types=new Set(['string','number','boolean','array','object','undefined','null','int']);
// 路徑只取自同一正式 JSON schema；未知輸入鍵與驗證器原始訊息不進回饋。
const schemaPaths=new Set();
function collect(schema,path=[]){
 if(!schema||typeof schema!=='object')return;
 schemaPaths.add(JSON.stringify(path));
 for(const [key,child]of Object.entries(schema.properties??{}))collect(child,[...path,key]);
 if(schema.items&&!Array.isArray(schema.items))collect(schema.items,[...path,'*']);
 for(const key of ['oneOf','anyOf','allOf'])for(const child of schema[key]??[])collect(child,path);
}
collect(CONTINUITY_TOOL_PARAMETERS);
function safePath(value){
 if(!Array.isArray(value)||value.length>limits.maxPathSegments)return null;
 const normalized=[];
 for(const part of value){
  if(typeof part==='number'){
   if(!Number.isSafeInteger(part)||part<0||part>limits.maxArrayIndex)return null;
   normalized.push('*');
  }else if(typeof part==='string')normalized.push(part);else return null;
 }
 return schemaPaths.has(JSON.stringify(normalized))?[...value]:null;
}

/** 呼叫端先完成 readContinuityProposal 的外殼／bytes 檢查；舊字串仍由原 SDK／Core 處理。 */
export function projectContinuitySchemaFeedback(args){
 if(!Object.hasOwn(args,'proposal'))return null;
 const parsed=continuityToolSchema.safeParse(args);
 if(parsed.success)return null;
 const issues=[],seen=new Set();let omitted=false;
 for(const issue of parsed.error.issues){
  const path=safePath(issue.path),code=codes.has(issue.code)?issue.code:'schema_invalid';
  if(!path){omitted=true;continue;}
  const row={path,code,...types.has(issue.expected)?{expectedType:issue.expected}:{}};
  const key=JSON.stringify(row);if(seen.has(key))continue;seen.add(key);
  if(issues.length===limits.maxIssues){omitted=true;continue;}issues.push(row);
 }
 const result={kind:'cmcp_continuity_input_rejection',status:'rejected',reason:'continuity_tool_schema_invalid',
  sourceRead:false,inputSchemaValidated:false,formalProjection:false,semanticVerification:'not_performed',executionAuthority:'none',
  correction:{kind:'input_schema_fields',schema:'cmcp_project_continuity',proposalVersion:[6,7].includes(args.proposal?.version)?args.proposal.version:null,issues,complete:!omitted,
   omittedIssues:omitted,valuesIncluded:false,autoFilled:false,limits}};
 if(Buffer.byteLength(JSON.stringify(result))>limits.maxBytes){result.correction.issues=[];result.correction.complete=false;result.correction.omittedIssues=true;result.correction.reason='feedback_capacity_exceeded';}
 return result;
}
