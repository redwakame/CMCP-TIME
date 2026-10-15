/** Read-only interpretation of the existing Runtime wiring; never grants or schedules work. */
export function describeCmcpProactiveExecution({loopTiming={},controls={},observation='configuration',readOnly=false,
  dispatch=null,deliveryPresent=null,deliveryRoutes=null}={}){
  if(!['configuration','runtime'].includes(observation))throw Error('invalid_proactive_observation');
  const live=observation==='runtime'&&!readOnly;
  return {
    kind:'cmcp_proactive_execution_description',version:1,
    observation:observation==='configuration'?'configuration_only':readOnly?'read_only_runtime_inspection':'active_runtime',
    configured:{source:'input.loopTiming',ttlMs:loopTiming.ttlMs??null,inactivityMs:loopTiming.inactivityMs??null,
      activityWindowMs:loopTiming.activityWindowMs??null,usage:'retained_local_loop_compatibility_not_runtime_send_deadline'},
    controls:Object.fromEntries(['enabled','clean','proactive','buffer','pins'].map(key=>[key,typeof controls[key]==='boolean'?controls[key]:null])),
    executor:{name:'shared_runtime_dispatch',externalDispatch:true,retainedLocalInactivityTimerEnabled:false,
      scheduleBasis:['explicit_pin_dueAt','supported_buffer_original_expiry'],
      eligibility:'current_controls_DND_sources_cancellation_deduplication_and_delivery_target',
      liveObserved:live&&dispatch!==null},
    delivery:{presentCallbackRegistered:live?deliveryPresent:null,routes:deliveryRoutes,
      availability:'requires_current_host_target_and_source_checks',successfulDeliveryInferred:false},
    dispatch:live&&dispatch?{reason:dispatch.reason??null,timerScheduled:dispatch.timerScheduled??null,
      scheduledAt:dispatch.scheduledAt??null,generating:dispatch.generating??null,closed:dispatch.closed??null}:null,
    inactivityIsSendDeadline:false,modelCalls:0
  };
}

/** Human summary and structured status describe the same observation. */
export function formatCmcpProactiveDescription(description,{language='en'}={}){
  const enabled=description.controls.proactive,setting=enabled===true?'ON':enabled===false?'OFF':'unknown';
  const observed=description.executor.liveObserved,reason=description.dispatch?.reason??'not_observed';
  if(language==='zh-TW')return `主動共用設定：${setting}。正式 Runtime 使用共用派送器；保留的 inactivityMs=${description.configured.inactivityMs??'未知'} 不代表閒置後必定送出，本機閒置計時器未啟用。排程依合格 Pin 到期時間或 Buffer 原期限，仍須通過控制、DND、來源、取消、去重與送達目標檢查。${observed?`本程序派送觀測：${reason}。`:'目前只有設定或唯讀檢視，未觀測運行中的派送器。'}`;
  return `Shared proactive setting: ${setting}. Runtime uses the shared dispatcher; retained inactivityMs=${description.configured.inactivityMs??'unknown'} is not a send deadline, and the local inactivity timer is disabled. Scheduling uses eligible Pin dueAt or original Buffer expiry and still checks controls, DND, sources, cancellation, deduplication and the delivery target. ${observed?`This Runtime observation: ${reason}.`:'Configuration/read-only inspection does not observe a live dispatcher.'}`;
}
