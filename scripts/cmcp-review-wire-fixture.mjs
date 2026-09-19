// TEST ONLY: explicitly constructed, already valid fixtures. Never repair a saved model reply.
import {validateEventContentReview} from '../src/cmcp-guard/cmcp-event-content-review.js';
import {mapDialogueWire} from '../src/cmcp-guard/cmcp-dialogue-source-binding.js';
export function declaredReviewFixtureV4(value, sourceText) {
  const fixture=structuredClone(value);
  if(fixture.eventReview?.version!==3)return fixture;
  const canonical=fixture.dialogue?.currentSupport?mapDialogueWire(fixture):fixture;
  validateEventContentReview(canonical.eventReview,canonical.proposal,{content:{body:sourceText}},canonical.dialogue);
  fixture.eventReview.version=4;
  if(fixture.proposal.status==='proposed')fixture.proposal.proposals.forEach((item,index)=>{
    item.supportRefs=fixture.eventReview.segments.flatMap((segment,i)=>segment.targets.includes('p'+(index+1))?['r'+(i+1)]:[]);
    delete item.quote;
  });
  return fixture;
}
// Current v5 fixture construction; never invoke this on actual model evidence.
export function declaredReviewFixtureV5(value, sourceText) {
  const fixture=declaredReviewFixtureV4(value,sourceText);
  if(fixture.eventReview?.version!==4)return fixture;
  const {segments}=fixture.eventReview;
  fixture.eventReview={version:5,segments:segments.map(({quote,processing})=>({quote,anchor:'',processing})),
    dialogueRefs:segments.flatMap((segment,index)=>segment.targets.includes('dialogue')?['r'+(index+1)]:[])};
  return fixture;
}
export function declaredReviewFixtureV6(value, sourceText) {
  const fixture=declaredReviewFixtureV5(value,sourceText);
  if(fixture.eventReview?.version!==5)return fixture;
  fixture.eventReview.version=6;
  fixture.eventReview.segments=fixture.eventReview.segments.map(({quote,processing,anchor})=>{
    if(anchor!=='')throw Error('fixture_v6_requires_explicit_unique_quote');
    return {quote,processing};
  });
  return fixture;
}
// Current fixtures choose one declared source-table entry; saved model replies
// must never be passed through this test-only constructor.
export function declaredReviewFixtureV7(value, sourceText) {
  if(value?.eventReview?.version!==3)throw Error('fixture_v7_requires_declared_canonical_fixture');
  const fixture=declaredReviewFixtureV6(value,sourceText);
  if(fixture.eventReview?.version!==6)return fixture;
  if(fixture.dialogue.status!=='unknown'){
    const matches=fixture.eventReview.segments.flatMap((segment,index)=>segment.quote===fixture.dialogue.currentSupport.quote?['r'+(index+1)]:[]);
    if(matches.length!==1||fixture.dialogue.currentSupport.ref!=='input')throw Error('fixture_v7_requires_explicit_current_segment');
    fixture.dialogue.currentSupportRef=matches[0];delete fixture.dialogue.currentSupport;
  }
  if(fixture.proposal.status==='no_event_change'){
    // These legacy synthetic fixtures already explicitly declare no change and
    // handled dialogue segments. This helper is never used on recorded output.
    fixture.proposal.supportRefs=value.eventReview.segments.flatMap((segment,index)=>
      segment.processing==='handled'&&segment.targets.includes('dialogue')?['r'+(index+1)]:[]);
    if(!fixture.proposal.supportRefs.length)throw Error('fixture_v7_requires_explicit_no_change_support');
  }
  fixture.eventReview.version=7;delete fixture.eventReview.dialogueRefs;return fixture;
}
