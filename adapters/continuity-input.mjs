import {z} from 'zod';
import {CMCP_CONTINUITY_PROJECTION_LIMITS as limits} from '../src/cmcp-guard/cmcp-continuity-projection.js';

// 同一個型別定義供宿主 JSON schema 與 MCP 驗證使用；v6 相容，v7 可明示條件的適用對象。
const object=shape=>z.object(shape).strict();
const text=max=>z.string().min(1).refine(value=>!!value.trim()&&[...value].length<=max).meta({maxLength:max});
const id=text(80),quote=text(limits.maxQuoteCodePoints),reasonQuote=text(limits.maxReasonCodePoints);
const temporalUse=z.enum(['current','historical','unspecified']);
const planStatus=z.enum(['planned','paused','cancelled']);
const citation={ref:id,quote};
const relation=object({kind:z.enum(['independent','supersedes','related','unresolved','revises']),targetNodeIds:z.array(id).max(limits.maxRelationTargets)});
const common={id,...citation,topic:text(128),aspect:text(128),temporalUse};
const reason=object({id,ref:id,quote:reasonQuote}).describe('來源明說為何作此決定的原因／顧慮；不是決定本身、門檻內容或目前狀態。沒有明說原因則省略，不能用狀態句補成理由。');
const changedReason=object({id,ref:id,quote:reasonQuote,kind:z.enum(['adds','prioritizes','accepts_tradeoff']).optional()}).describe('只引用 User 明說此次修改的因果、優先或取捨。暫停／取消決定本身放 status，不因出現該決定就建立 adds 理由；同句若另有原因，精確引用原因片段。');
const reasons=z.array(changedReason).max(limits.maxNodes).describe('可省略／空陣列；只有原文明說為什麼、優先或接受取捨才填。已知狀態不需要再有一個理由才能成立。');
const edit=z.discriminatedUnion('kind',[
 object({quote,kind:z.literal('replace'),replacement:object(citation)}),
 object({quote,kind:z.literal('withdraw')})
]);
const change=z.discriminatedUnion('kind',[
 object({...citation,kind:z.literal('content'),edits:z.array(edit).min(1).max(limits.maxPlanParts),reasons:reasons.optional()}),
 object({...citation,kind:z.literal('status'),planStatus,reasons:reasons.optional()}).describe('狀態作用於此 plan 的完整面向，不能只暫停其中一個對象卻把含多個對象的整個基底設為 paused。先依正式原話分成可獨立改狀態的 plans，再只對被指定者套用狀態；其餘照常不是這個暫停計畫的 retention。狀態決定與恢復門檻保留在 quote；門檻存在不證明已滿足或未滿足。原因未明說就不填 reasons。'),
 object({...citation,kind:z.literal('reason'),reasons:reasons.min(1)})
]);
const plan=object({...common,planStatus:planStatus.optional(),reasons:z.array(reason).max(limits.maxNodes).optional(),
 orderedChanges:z.array(change).max(limits.maxPlanChanges).optional(),
 retentions:z.array(object({...citation,temporalUse})).max(limits.maxRetentions).optional(),
 reasonWithdrawals:z.array(object({...citation,temporalUse,targetReasonId:id})).max(limits.maxReasonRelations).optional()}).describe('一筆 plan 只承擔可一起修訂／暫停的面向。同句的不同對象若可獨立修改，分成不同 plans，topic/aspect 明確指出各自對象；可引用共同的完整原句，不改寫原文或補造數量。共用引文不表示共用狀態。');
const contextual=object({...common,relation:relation.optional()});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const pointer=object({version:z.literal(1),providerNamespace:text(256),scopeId:text(256),itemId:text(256),sessionId:text(256),revisionId:text(256)});
const scopeResolution=object({findingId:hash,kind:z.literal('independent_retention'),
 source:object({ref:id,pointer,evidenceHash:hash,range:object({unit:z.literal('unicode_code_points'),start:z.number().int().nonnegative(),end:z.number().int().positive()})}),
 retainedPlan:object({nodeId:id,planVersion:hash}),changedPlan:object({nodeId:id,planVersion:hash,changeId:id}),evidence:object(citation)});
const reportScopeResolution=object({findingId:hash,kind:z.enum(['reported_state_in_status_clause','reported_state_in_status_message']),reportRef:id,reportQuote:quote})
 .describe('只解目前 finding。contained reason 沿 reported_state_in_status_clause：回報子句須在原回報與狀態兩個支持範圍內。同訊息 reason 才用 reported_state_in_status_message：reportRef／reportQuote／範圍必須精確等於目前已提回報，不接受縮句或換來源。兩者不能互用。這是來源用途的明示宿主解釋，不是語意已驗或執行權；若是指令或前提，修正 reports 並保留計畫條件，不用 ACK 或改標名求通過。');
const proposalFields={plans:z.array(plan).max(limits.maxNodes),
 reports:z.array(contextual).max(limits.maxNodes).describe('User 明說的現況回報（含未完成／尚未同意）；保留回報層，不升格工具核實。計畫、修改與本輪指令不放這裡。').optional(),suggestions:z.array(contextual).max(limits.maxNodes).optional(),
 context:z.array(object({...common,kind:z.enum(['user_report','user_question','user_instruction','assistant_suggestion','assistant_statement','tool_observation']),relation:relation.optional()})).max(limits.maxNodes)
  .describe('user_instruction 只承載 User 明示的一般工作限制或當輪指令，不是事實回報、待執行計畫、提問或新的執行授權。已有計畫的暫停／取消／局部修訂仍使用該 plan 的 orderedChanges；不改標指令逃避正式變更。').optional(),
 scopeResolutions:z.array(scopeResolution).max(8).describe('只處理目前 finding 的明示獨立保留：綁定兩個 planVersion、正式 Pointer/hash/range，evidence 須已作 retainedPlan 的 User retention。來源核對不代表語意已驗；同案請修正精確 edits。').optional(),
 reportScopeResolutions:z.array(reportScopeResolution).max(limits.maxNodes).optional(),
 unknowns:z.array(text(256)).max(limits.maxUnknowns).describe('只列來源未說的資訊。先核對 currentPlans 的有效條件與 reports/currentClaims；原文已明示的數量、時段或限制不列未知，已回報某條件未滿足仍是已知回報。外部是否落實、未明說的未來變更才可未知。沒有新回報只代表最新外部狀態未觀測，不代表條件未完成；必要時明列這個證據層差別。')};
const scopeIds=z.array(id).min(1).max(limits.maxRelationTargets);
const scopedTarget={conditionId:id,scopeIds};
const scopedChange=z.discriminatedUnion('kind',[
 object({...scopedTarget,...citation,kind:z.literal('content'),replacement:object(citation),reasons:reasons.optional()}),
 object({...scopedTarget,...citation,kind:z.literal('status'),planStatus,reasons:reasons.optional()}),
 object({...scopedTarget,...citation,kind:z.literal('reason'),reasons:reasons.min(1)})
]);
const scopedPlan=object({id,topic:text(128),
 scopes:z.array(object({id,...citation})).min(1).max(limits.maxNodes),
 conditions:z.array(object({id,...citation,aspect:text(128),temporalUse,scopeIds,
  planStatus:planStatus.optional(),reasons:z.array(reason).max(limits.maxNodes).optional()})).min(1).max(limits.maxNodes),
 orderedChanges:z.array(scopedChange).max(limits.maxPlanChanges).optional(),
 retentions:z.array(object({...scopedTarget,...citation,temporalUse})).max(limits.maxRetentions).optional(),
 reasonWithdrawals:z.array(object({...scopedTarget,...citation,temporalUse,targetReasonId:id})).max(limits.maxReasonRelations).optional()
}).describe('將共用條件與明示對象分開。scopes 的 quote 是 User 原文中的對象名稱；conditions 的 scopeIds 列出原文支持的適用對象。修改只作用於 conditionId 與 scopeIds 指定的既有組合；未指定組合保留原值及來源，不因共用引文被一併替換或暫停。content 的 replacement 是新條件的完整原文值。系統只驗已宣告的來源與作用範圍，不替宿主推定語意；原文歧義列 unknowns。共用引文仍須通過原有範圍覆核；不能以 scopedPlans 迴避 finding。');
export const continuityProposalSchema=object({version:z.union([z.literal(6),z.literal(7)]),...proposalFields,
 scopedPlans:z.array(scopedPlan).max(limits.maxNodes).optional()})
 .refine(value=>value.version===7||!Object.hasOwn(value,'scopedPlans'),{message:'continuity_scoped_plans_require_v7'})
 .meta({allOf:[{if:{properties:{version:{const:6}}},then:{not:{required:['scopedPlans']}}}]});
const exclusive=[{required:['proposal']},{required:['proposalJson']}];
export const continuityToolSchema=object({ticket:z.string().min(1).max(256),proposal:continuityProposalSchema.optional(),
 proposalJson:z.string().min(2).max(limits.maxProposalBytes).describe('舊版相容輸入；新呼叫優先使用 proposal 物件，兩者不得同時提供。').optional()})
 .refine(args=>Object.hasOwn(args,'proposal')!==Object.hasOwn(args,'proposalJson'),{message:'continuity_proposal_exactly_one_required'})
 .refine(args=>{try{return Buffer.byteLength(Object.hasOwn(args,'proposal')?JSON.stringify(args.proposal):args.proposalJson??'')<=limits.maxProposalBytes;}catch{return false;}},{message:'continuity_proposal_too_large'})
 .meta({oneOf:exclusive});
const {$schema,...parameters}=z.toJSONSchema(continuityToolSchema,{target:'draft-7',io:'input'});
export const CONTINUITY_TOOL_PARAMETERS=Object.freeze(parameters);
export const CONTINUITY_MAX_PROPOSAL_BYTES=limits.maxProposalBytes;
// 一個 JSON 成員至少占一個輸入 byte；保持有限解析上限，不讓物件表示額外縮小原有 bytes 契約。
export const CONTINUITY_MAX_TOOL_ELEMENTS=limits.maxProposalBytes+256;

/** 僅驗入口外殼及原有 bytes 上限；完整提案仍送既有 Core，舊版字串不改寫。 */
export function readContinuityProposal(args){
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['ticket','proposal','proposalJson'].includes(k))
  ||typeof args.ticket!=='string'||!args.ticket||args.ticket.length>256)throw Error('continuity_invalid_tool_arguments');
 const typed=Object.hasOwn(args,'proposal'),legacy=Object.hasOwn(args,'proposalJson');
 if(typed===legacy)throw Error('continuity_proposal_exactly_one_required');
 if(typed&&(!args.proposal||typeof args.proposal!=='object'||Array.isArray(args.proposal)||![6,7].includes(args.proposal.version)))throw Error('continuity_typed_v6_or_v7_required');
 if(legacy&&typeof args.proposalJson!=='string')throw Error('continuity_invalid_tool_arguments');
 let serialized;try{serialized=typed?JSON.stringify(args.proposal):args.proposalJson;}catch{throw Error('continuity_invalid_tool_arguments');}
 if(Buffer.byteLength(serialized)>limits.maxProposalBytes)throw Error('continuity_proposal_too_large');
 try{return JSON.parse(serialized);}catch{throw Error('continuity_invalid_proposal_json');}
}
