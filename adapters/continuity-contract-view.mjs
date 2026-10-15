import {CONTINUITY_READING_CONTRACT,CONTINUITY_READING_CONTRACT_METADATA} from './continuity-policy.mjs';

/** 僅為成功的正式 open 加入靜態宿主契約；不新增來源、讀取或授權。 */
export function withContinuityReadingContract(value){
  if(value?.kind!=='cmcp_reading_collection'||value.status!=='ready'||typeof value.ticket!=='string'||!value.ticket
    ||!Array.isArray(value.collection?.sources))return value;
  const contract={...CONTINUITY_READING_CONTRACT_METADATA,text:CONTINUITY_READING_CONTRACT};
  if(JSON.stringify(value.continuityContract)===JSON.stringify(contract))return value;
  return {...value,continuityContract:contract};
}
