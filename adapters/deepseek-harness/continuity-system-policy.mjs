import {CONTINUITY_BEFORE_ANSWER_POLICY,CONTINUITY_POLICY_METADATA} from '../continuity-policy.mjs';

export const CONTINUITY_SYSTEM_SECTION='cmcp:continuity-before-answer';
/** 只記官方 LLM 請求中的 system 位置與固定協定雜湊，不保存 system／私人正文。 */
export function observeContinuitySystemPolicy(messages){
 const indexes=[];for(const [index,message] of (messages??[]).entries()){
  if(message.role!=='system')continue;
  const text=(Array.isArray(message.content)?message.content:[]).filter(block=>block.type==='text').map(block=>block.text).join('');
  if(text.includes(CONTINUITY_BEFORE_ANSWER_POLICY))indexes.push(index);
 }
 return {...CONTINUITY_POLICY_METADATA,placement:'official_system_prompt_assembly',present:indexes.length>0,systemMessageIndexes:indexes};
}
/** 官方非同步 assembly 接點；只追加固定宿主規約，不提升任何原文或工具結果的權威。 */
export function installContinuitySystemPolicy(ctx,{resolveAgent,authorized,onProvided=async()=>{},onError=async()=>{}}){
 return ctx.on('system-prompt/assemble',async(assembly,context,next)=>{
  const inherited=await next();let state;
  try{
   state=resolveAgent(context?.agent);
   if(!state||context?.signal?.aborted)return inherited;
   const proof=await authorized(state,context);
   if(!proof||resolveAgent(context.agent)!==state||context?.signal?.aborted)return inherited;
   if(!Array.isArray(inherited?.sections)||inherited.sections.some(row=>row.name===CONTINUITY_SYSTEM_SECTION))
    throw Error('cmcp_system_policy_section_conflict');
   await onProvided(state,{...CONTINUITY_POLICY_METADATA,placement:'official_system_prompt_assembly',stage:'assembly_prepared_not_model_delivery',
    sectionName:CONTINUITY_SYSTEM_SECTION,...proof.metadata});
   if(proof.valid&&!(await proof.valid()))return inherited;
   if(resolveAgent(context.agent)!==state||context?.signal?.aborted)return inherited;
   return {...inherited,sections:[...inherited.sections,{name:CONTINUITY_SYSTEM_SECTION,
    text:CONTINUITY_BEFORE_ANSWER_POLICY,interpolate:false}]};
  }catch(error){try{await onError(state,error);}catch{}return inherited;}
 });
}
