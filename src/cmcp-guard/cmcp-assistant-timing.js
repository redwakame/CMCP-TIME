import {resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';

// A Host observation clock, separate from the operation's frozen temporal context.
// Explicit invalid observations fail closed; there is no parser/system fallback.
export function observeCmcpAssistantTime(clock,timezone){
  if(typeof clock!=='function')throw Error('assistant_observation_clock_required');
  return resolveCmcpTimeContext({now:clock(),timezone}).now;
}

/** Call only after the adapter has returned a complete response. These are local
 * observations, not provider generation timestamps, disk flush times, or reads. */
export function createCmcpAssistantTiming(operationTime,clock){
  if(operationTime===undefined)throw Error('assistant_operation_time_required');
  const temporal=resolveCmcpTimeContext(operationTime);
  return {kind:'assistant_local_observation_timing',version:1,
    operationTime:{now:temporal.now,timezone:temporal.timezone},
    responseReceivedAt:observeCmcpAssistantTime(clock,temporal.timezone),
    sourceSaveAcknowledgedAt:null,presentationStartedAt:null,presentationAcknowledgedAt:null};
}
