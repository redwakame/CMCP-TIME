import sys, unittest, threading, json, copy
from types import SimpleNamespace
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cmcp_hermes_runtime import HostRuntime
from controls import apply_control

def fixture(enabled=True, synthetic=False, save=True):
    r=HostRuntime.__new__(HostRuntime)
    r.session_id='s';r.turn_id='t';r.text='合成原文';r.authorized=enabled;r.synthetic_evidence=synthetic;r.begun=enabled;r.failure=None;r.finished=False;r.api_calls=0;r.api_failures=0
    r.lock=threading.RLock()
    r.pending_length_recovery=None
    r.pending_reading_stage=None;r.stage_assistance_issued=False;r.length_assistance_issued=False;r.closed=False
    r.completion_budget=None
    r.rows=[];r.note=lambda kind,value:r.rows.append({'kind':kind,**value})
    def call(op,args=None):
        if not save and op in ('assistant','finish'):raise RuntimeError('hermes_assistant_not_saved')
        return {'status':'stored','sourcePointer':{'synthetic':True}}
    r.call=call
    return r

class Tests(unittest.TestCase):
    def test_exact_batch_children_keep_observer_hashes_and_require_received_full_delivery(self):
        r=fixture();r.config={'readMaxPages':2};r.pending_reading_stage=('s','t','ticket-a')
        def page(index):
            return {'kind':'cmcp_continuity_delivery_page','status':'provided','ticket':'ticket-a','projectionHash':'a'*64,
                    'delivery':{'id':'d','page':index,'pageCount':4,'complete':index==3,'resultHash':'b'*64},'sections':[{'path':'/original','value':'完整原文與原時間'}]}
        r.observe_formal_stage('cmcp_project_continuity',{'ticket':'ticket-a'},page(0))
        batch={'kind':'cmcp_formal_page_batch','version':1,'operation':'continuity-page','ticket':'ticket-a','requestedMaxPages':2,'pages':[page(1),page(2)]}
        r.call=lambda op,args:batch
        rendered=r.tool('cmcp_read_continuity',{'ticket':'ticket-a','deliveryId':'d','page':'1'})
        self.assertEqual(json.loads(rendered),batch);self.assertEqual(r.pending_reading_stage,('s','t','ticket-a'))
        self.assertEqual(len(r.rows[-1]['formalChildren']),2);self.assertEqual(r.rows[-1]['formalChildren'][0]['page'],1)
        self.assertEqual(r.rows[-1]['formalChildren'][0]['childBytes'],len(json.dumps(page(1),ensure_ascii=False).encode()))
        r.observe_formal_stage('cmcp_read_continuity',{'ticket':'ticket-a'},page(3));self.assertIsNone(r.pending_reading_stage)
    def test_batch_failure_invalidates_proof_progress_cannot_restore_missing_children(self):
        r=fixture();r.config={'readMaxPages':2};r.pending_reading_stage=('s','t','ticket-a')
        r.continuity_delivery_proof={'identity':('ticket-a','d','b'*64,4,'a'*64),'pages':{0}}
        def fail(op,args):raise RuntimeError('mcp_request_cancelled')
        r.call=fail;r.tool('cmcp_read_continuity',{'ticket':'ticket-a','deliveryId':'d','page':'1'})
        self.assertIsNone(r.continuity_delivery_proof);self.assertIsNone(r.pending_reading_stage);self.assertIsNone(r.completion_budget)
        progress={'ticket':'ticket-a','coverage':{'complete':True,'exhausted':True,'sourceCount':1,'completedSources':1,'unavailableSources':0,'unread':[]}}
        r.observe_formal_stage('cmcp_reading_progress',{'ticket':'ticket-a'},progress)
        last={'kind':'cmcp_continuity_delivery_page','status':'provided','ticket':'ticket-a','projectionHash':'a'*64,
              'delivery':{'id':'d','page':3,'pageCount':4,'complete':True,'resultHash':'b'*64}}
        r.observe_formal_stage('cmcp_read_continuity',{'ticket':'ticket-a'},last)
        self.assertEqual(r.pending_reading_stage,('s','t','ticket-a'))
    def test_invalid_batch_ticket_delivery_or_consecutive_page_is_not_rendered(self):
        for changed in ['ticket','id','page']:
            r=fixture();r.config={'readMaxPages':2}
            page={'kind':'cmcp_continuity_delivery_page','status':'provided','ticket':'ticket-a','projectionHash':'a'*64,
                  'delivery':{'id':'d','page':1,'pageCount':4,'complete':False,'resultHash':'b'*64}}
            if changed=='ticket':page['ticket']='other'
            else:page['delivery'][changed]='other' if changed=='id' else 3
            value={'kind':'cmcp_formal_page_batch','version':1,'operation':'continuity-page','ticket':'ticket-a','requestedMaxPages':2,'pages':[page]}
            r.call=lambda op,args:value;r.tool('cmcp_read_continuity',{'ticket':'ticket-a','deliveryId':'d','page':'1'})
            self.assertEqual(r.rows[-1]['kind'],'official_tool_rejected');self.assertIsNone(r.continuity_delivery_proof)
    def test_length_metadata_keeps_formal_ticket_without_consuming_stage(self):
        r=fixture();r.registered=True;r.tool_registration_checks={'cmcp_project_continuity':lambda:True}
        completion={'formalReading':'completed','projectionCompletion':'not_performed','ticket':'ticket-a','projectionStatus':None}
        r.call=lambda op,args:{'active':True,'ticket':'ticket-a','context':'正式狀態 ticket-a；未投影不等於回答失敗。','completion':completion}
        r.pending_length_recovery=('s','t','absent');r.pending_reading_stage=('s','t','ticket-a')
        request={'messages':[{'role':'user','content':'正常問題'}],'tools':[{'function':{'name':'read_file'}},{'function':{'name':'tool_call'}}],'max_tokens':8192,'extra_body':{'thinking':{'type':'enabled'}},'tool_choice':'auto'}
        before=copy.deepcopy(request)
        first=r.request_recovery(request=request,session_id='s',turn_id='t')
        self.assertEqual(r.rows[-1]['completion']['projectionCompletion'],'not_performed')
        self.assertEqual(r.rows[-1]['ticket'],'ticket-a');self.assertEqual(r.rows[-1]['toolRoute'],'official_tool_call')
        self.assertEqual(r.pending_reading_stage,('s','t','ticket-a'));self.assertFalse(r.stage_assistance_issued);self.assertTrue(r.length_assistance_issued)
        self.assertEqual(request,before)
        for key in ['tools','max_tokens','extra_body','tool_choice']:self.assertEqual(first['request'][key],before[key])
        self.assertIsNotNone(r.request_recovery(request=copy.deepcopy(before),session_id='s',turn_id='t'))
        self.assertTrue(r.stage_assistance_issued)
    def test_saved_original_and_projection_completion_are_independent(self):
        for status in ['not_requested','not_performed','pending','completed']:
            r=fixture(synthetic=True);calls=[]
            def call(op,args):
                calls.append((op,args))
                return {'sourcePointer':{'synthetic':True},'completion':{'formalReading':'not_requested' if status=='not_requested' else 'completed','projectionCompletion':status,'ticket':None if status=='not_requested' else 'ticket-a','projectionStatus':'partial' if status=='completed' else None,'unexpectedBody':'不可複製'}}
            r.call=call;r.after(session_id='s',turn_id='t',assistant_response='真正可見原答')
            self.assertTrue(r.finished);self.assertTrue(r.rows[-1]['cmcpSaved'])
            self.assertEqual(r.rows[-1]['assistantText'],'真正可見原答');self.assertEqual(calls[0][1]['text'],'真正可見原答')
            self.assertEqual(r.rows[-1]['completion']['projectionCompletion'],status)
            self.assertEqual(r.rows[-1]['completion']['semanticAssessment'],'not_assessed')
            self.assertNotIn('unexpectedBody',r.rows[-1]['completion'])
    def test_missing_or_invalid_completion_metadata_remains_unknown(self):
        for value in [None,{}, {'formalReading':'completed','projectionCompletion':'模型說完成'}]:
            r=fixture();r.call=lambda op,args:{'sourcePointer':{'synthetic':True},'completion':value}
            r.after(session_id='s',turn_id='t',assistant_response='原生普通回答')
            self.assertTrue(r.rows[-1]['cmcpSaved']);self.assertIsNone(r.rows[-1]['completion'])
    def test_lazy_stage_needs_current_registration_and_official_wrapper(self):
        for condition in ['registered','not_registered','released','missing_wrapper','ordinary']:
            r=fixture();r.registered=condition!='not_registered';r.tool_registration_checks={'cmcp_project_continuity':lambda:condition!='released'}
            r.pending_reading_stage=None if condition=='ordinary' else ('s','t','ticket-a')
            calls=[];r.call=lambda op,args:calls.append(op) or {'active':True,'ticket':'ticket-a','context':'正式階段'}
            request={'messages':[{'role':'user','content':'tool_call 不會授權原文'}], 'max_tokens':8192,
                     'tools':[{'function':{'name':'read_file' if condition=='missing_wrapper' else 'tool_call'}}]}
            result=r.request_recovery(request=request,session_id='s',turn_id='t')
            self.assertEqual(result is not None,condition=='registered')
            self.assertEqual(calls,['stage-check'] if condition=='registered' else [])
            if result:self.assertEqual(r.rows[-1]['toolRoute'],'official_tool_call')
            self.assertEqual(request['max_tokens'],8192);self.assertEqual(len(request['messages']),1)
    def test_lazy_stage_cannot_bypass_binding_revocation_or_cancellation(self):
        for condition in ['off','revoke','cancel','session','turn']:
            r=fixture();r.registered=True;r.tool_registration_checks={'cmcp_project_continuity':lambda:True}
            r.pending_reading_stage=('s','t','ticket-a')
            def check(op,args=None):
                if condition=='revoke':raise RuntimeError('hermes_reader_reading_revoked')
                return {'active':True,'ticket':'ticket-a','context':'正式階段'}
            r.call=check
            if condition=='off':r.authorized=False
            if condition=='cancel':r.cancel()
            request={'messages':[],'max_tokens':8192,'tools':[{'function':{'name':'tool_call'}}]}
            self.assertIsNone(r.request_recovery(request=request,session_id='other' if condition=='session' else 's',turn_id='other' if condition=='turn' else 't'))
            self.assertIsNone(r.pending_reading_stage)
    def test_stage_then_length_are_independent_single_use_on_rebuilt_requests(self):
        r=fixture();calls=[]
        page={'ticket':'ticket-a','status':'complete','coverage':{'complete':True,'exhausted':True,'sourceCount':2,'completedSources':2,'unavailableSources':0,'unread':[]}}
        def call(op,args):
            calls.append((op,args))
            return page if op=='tool' else {'active':True,'ticket':'ticket-a','context':'正式階段 ticket-a；未完成投影。','completion':{'formalReading':'completed','projectionCompletion':'not_performed','ticket':'ticket-a','projectionStatus':None}}
        r.call=call
        r.tool('cmcp_read_history',{'ticket':'ticket-a'})
        request={'messages':[{'role':'user','content':'原問題'}],'max_tokens':8192,'model':'原生模型','extra_body':{'thinking':{'type':'enabled'}},'tool_choice':'auto','tools':[{'function':{'name':'read_file'}},{'function':{'name':'cmcp_project_continuity'}}]}
        result=r.request_recovery(request=request,session_id='s',turn_id='t')['request']
        self.assertEqual(result['max_tokens'],16384);self.assertEqual(request['max_tokens'],8192)
        for key in ['model','extra_body','tool_choice','tools']:self.assertEqual(result[key],request[key])
        self.assertEqual(result['messages'][:-1],request['messages'])
        self.assertEqual(calls[-1],('stage-check',{'turnId':'t'}))
        self.assertEqual(r.rows[-1]['kind'],'formal_stage_assistance_applied')
        r.observe_execution(request=result,next_call=lambda q:{'choices':[{'finish_reason':'length','message':{'content':None}}]},session_id='s',turn_id='t')
        r.tool('cmcp_read_history',{'ticket':'ticket-a'})
        # 官方下一次會重建請求，不能拿前次 middleware 的提示當成持續存在。
        rebuilt=copy.deepcopy(request)
        length=r.request_recovery(request=rebuilt,session_id='s',turn_id='t')['request']
        self.assertEqual(length['max_tokens'],32768)
        self.assertEqual(length['messages'][:-1],request['messages'])
        self.assertEqual(len(rebuilt['messages']),1)
        self.assertIn(('recovery-check',{'turnId':'t','visibleContent':'absent'}),calls)
        self.assertEqual(calls[-1],('budget-check',{'turnId':'t','ticket':'ticket-a'}))
        r.observe_execution(request=rebuilt,next_call=lambda q:{'choices':[{'finish_reason':'length','message':{'content':None}}]},session_id='s',turn_id='t')
        r.tool('cmcp_read_history',{'ticket':'ticket-a'})
        self.assertEqual(r.request_recovery(request=rebuilt,session_id='s',turn_id='t')['request']['max_tokens'],32768)
        self.assertEqual(sum(op=='stage-check' for op,args in calls),1)
        self.assertEqual(sum(op=='recovery-check' for op,args in calls),1)
    def test_completion_floor_survives_tool_roundtrips_and_ready_projection(self):
        r=fixture();calls=[]
        completion={'formalReading':'completed','projectionCompletion':'not_performed','ticket':'ticket-a','projectionStatus':None}
        r.call=lambda op,args:calls.append((op,args)) or {'active':True,'ticket':'ticket-a','context':'正式階段','completion':dict(completion)}
        r.pending_reading_stage=('s','t','ticket-a')
        request={'messages':[{'role':'user','content':'原問題'}],'max_tokens':8192,'tools':[{'function':{'name':'cmcp_project_continuity'}}],'model':'原生模型','extra_body':{'thinking':{'type':'enabled'}},'tool_choice':'auto'}
        original=copy.deepcopy(request)
        stage=r.request_recovery(request=request,session_id='s',turn_id='t')['request']
        self.assertEqual(stage['max_tokens'],16384)
        for _ in range(2):
            r.observe_execution(request=stage,next_call=lambda q:{'choices':[{'finish_reason':'tool_calls'}]},session_id='s',turn_id='t')
            continued=r.request_recovery(request=copy.deepcopy(request),session_id='s',turn_id='t')['request']
            self.assertEqual(continued['max_tokens'],16384)
            self.assertEqual(continued['messages'],request['messages'])
        r.observe_execution(request=stage,next_call=lambda q:{'choices':[{'finish_reason':'length','message':{'content':None}}]},session_id='s',turn_id='t')
        recovery=r.request_recovery(request=copy.deepcopy(request),session_id='s',turn_id='t')['request']
        self.assertEqual(recovery['max_tokens'],32768)
        completion.update(projectionCompletion='completed',projectionStatus='ready')
        r.observe_formal_stage('cmcp_project_continuity',{'ticket':'ticket-a'},{'kind':'cmcp_continuity_projection','status':'ready','ticket':'ticket-a','projection':{'synthetic':True}})
        for _ in range(3):
            after=r.request_recovery(request=copy.deepcopy(request),session_id='s',turn_id='t')['request']
            self.assertEqual(after,{**original,'max_tokens':32768})
        self.assertEqual(request,original)
        self.assertEqual(sum(op=='stage-check' for op,args in calls),1)
        self.assertEqual(sum(op=='recovery-check' for op,args in calls),1)
        self.assertEqual(r.rows[-1]['completion']['projectionCompletion'],'completed')
        self.assertFalse(r.rows[-1]['nativeRetryLimitChanged']);self.assertFalse(r.rows[-1]['contextAdded'])
    def test_completion_floor_rechecks_binding_and_control_after_tools(self):
        for condition in ['off','clean','revoke','source_ticket','pending','cancel','finished','closed','session','turn','cancel_in_check']:
            with self.subTest(condition=condition):
                r=fixture();r.completion_budget={'sessionId':'s','turnId':'t','ticket':'ticket-a','floor':32768};calls=[]
                def call(op,args=None):
                    calls.append(op)
                    if condition in ['clean','revoke']:raise RuntimeError('hermes_reader_shared_project_controls_disabled')
                    if condition=='cancel_in_check' and op=='budget-check':r.cancel()
                    return {'active':True,'completion':{'formalReading':'pending' if condition=='pending' else 'completed','projectionCompletion':'completed','ticket':'different' if condition=='source_ticket' else 'ticket-a','projectionStatus':'ready'}}
                r.call=call
                if condition=='off':r.authorized=False
                if condition=='cancel':r.cancel()
                if condition=='finished':r.finished=True
                if condition=='closed':r.closed=True
                request={'messages':[],'max_tokens':8192}
                self.assertIsNone(r.request_recovery(request=request,session_id='other' if condition=='session' else 's',turn_id='other' if condition=='turn' else 't'))
                self.assertIsNone(r.completion_budget);self.assertEqual(request,{'messages':[],'max_tokens':8192})
    def test_completion_floor_preserves_other_limits_and_native_settings(self):
        for cap in [2048,4096,12000,32768,65536,None,True]:
            r=fixture();r.completion_budget={'sessionId':'s','turnId':'t','ticket':'ticket-a','floor':32768}
            r.call=lambda *a: self.fail('不改其他明示額度時，不需要新的回查')
            request={'messages':[],'max_tokens':cap,'extra_body':{'thinking':{'type':'enabled'}},'tools':[{'name':'native'}]}
            self.assertIsNone(r.request_recovery(request=request,session_id='s',turn_id='t'))
            self.assertEqual(request['max_tokens'],cap)
        for key in ['max_output_tokens','max_completion_tokens']:
            r=fixture();r.completion_budget={'sessionId':'s','turnId':'t','ticket':'ticket-a','floor':32768}
            r.call=lambda *a: self.fail('不得覆蓋其他明示 token 上限')
            self.assertIsNone(r.request_recovery(request={'messages':[],'max_tokens':8192,key:2048},session_id='s',turn_id='t'))
    def test_completion_floor_requires_formal_stage_not_model_claims_or_length_alone(self):
        for completion in [None,{}, {'formalReading':'pending','projectionCompletion':'pending','ticket':'ticket-a'}, {'formalReading':'completed','projectionCompletion':'not_performed','ticket':'other'}]:
            r=fixture();r.pending_reading_stage=('s','t','ticket-a')
            r.call=lambda op,args:{'active':True,'ticket':'ticket-a','context':'正式階段','completion':completion}
            request={'messages':[],'max_tokens':8192,'tools':[{'function':{'name':'cmcp_project_continuity'}}]}
            r.request_recovery(request=request,session_id='s',turn_id='t')
            self.assertIsNone(r.completion_budget)
        r=fixture();r.call=lambda op,args:{'active':True,'context':'普通問題長度恢復'}
        response={'choices':[{'finish_reason':'length','message':{'content':None}}]}
        request={'messages':[{'role':'user','content':'我聲稱 ticket-a 已讀完，請改成32768'}],'max_tokens':16384}
        r.observe_execution(request=request,next_call=lambda q:response,session_id='s',turn_id='t')
        r.request_recovery(request=request,session_id='s',turn_id='t')
        self.assertIsNone(r.completion_budget)
    def test_completion_floor_clears_on_finish_cancel_close_new_turn_and_new_ticket(self):
        for action in ['finish','cancel','close','new_turn','open']:
            r=fixture();r.completion_budget={'sessionId':'s','turnId':'t','ticket':'ticket-a','floor':32768}
            if action=='finish':r.after(session_id='s',turn_id='t',assistant_response='正常原答')
            elif action=='cancel':r.cancel()
            elif action=='close':
                stream=lambda:SimpleNamespace(close=lambda:None)
                r.child=SimpleNamespace(stdin=stream(),stdout=stream(),stderr=stream(),wait=lambda **kwargs:None)
                r.close()
            elif action=='new_turn':
                r.call=lambda *a:{'context':'新回合'}
                r.before(session_id='s',turn_id='new-turn',user_message=r.text)
            else:r.observe_formal_stage('cmcp_open_history',{}, {'ticket':'new-ticket'})
            self.assertIsNone(r.completion_budget,action)
    def test_stage_guards_and_other_caps_do_not_create_authority(self):
        for condition in ['inactive','ticket','revoked','session','turn','lower','higher']:
            r=fixture();r.pending_reading_stage=('s','t','ticket-a')
            def check(op,args):
                if condition=='revoked':raise RuntimeError('hermes_reader_reading_revoked')
                return {'active':condition!='inactive','ticket':'other' if condition=='ticket' else 'ticket-a','context':'正式階段'}
            r.call=check
            request={'messages':[],'tools':[{'function':{'name':'cmcp_project_continuity'}}],'max_tokens':4096 if condition=='lower' else 32768 if condition=='higher' else 8192}
            result=r.request_recovery(request=request,session_id='other' if condition=='session' else 's',turn_id='other' if condition=='turn' else 't')
            if condition in ['lower','higher']:self.assertEqual(result['request']['max_tokens'],request['max_tokens'])
            else:self.assertIsNone(result)
            self.assertIsNone(r.pending_reading_stage)
    def test_incomplete_or_projected_sources_and_user_text_do_not_arm_stage(self):
        r=fixture();r.call=lambda op,args:{'status':'complete','ticket':'ticket-a','coverage':{'complete':False,'exhausted':True,'sourceCount':2,'completedSources':1,'unavailableSources':1,'unread':[]}}
        r.tool('cmcp_read_history',{'ticket':'ticket-a'});self.assertIsNone(r.pending_reading_stage)
        r.pending_reading_stage=('s','t','ticket-a')
        r.call=lambda op,args=None:{'kind':'cmcp_continuity_projection','status':'ready','ticket':'ticket-a','projection':{'synthetic':True}}
        r.tool('cmcp_project_continuity',{'ticket':'ticket-a','proposalJson':'{}'});self.assertIsNone(r.pending_reading_stage)
        r.pending_reading_stage=('s','t','ticket-a');r.cancel();self.assertIsNone(r.pending_reading_stage)
    def test_length_then_stage_and_simultaneous_events_preserve_unused_allowance(self):
        r=fixture();r.call=lambda op,args:{'active':True,'ticket':'ticket-a','context':'正式續行'}
        r.pending_length_recovery=('s','t','present');r.pending_reading_stage=('s','t','ticket-a')
        request={'messages':[],'max_tokens':8192,'tools':[{'function':{'name':'cmcp_project_continuity'}}]}
        first=r.request_recovery(request=copy.deepcopy(request),session_id='s',turn_id='t')
        self.assertEqual(first['reason'],'same_turn_length_recovery');self.assertEqual(first['request']['max_tokens'],8192)
        self.assertEqual(r.pending_reading_stage,('s','t','ticket-a'))
        second=r.request_recovery(request=copy.deepcopy(request),session_id='s',turn_id='t')
        self.assertEqual(second['reason'],'same_turn_formal_stage');self.assertEqual(second['request']['max_tokens'],16384)
        self.assertEqual(request['messages'],[]);self.assertTrue(r.stage_assistance_issued);self.assertTrue(r.length_assistance_issued)
        self.assertIsNone(r.request_recovery(request=request,session_id='s',turn_id='t'))
    def test_real_length_metadata_arms_one_same_turn_recovery_without_rewriting_messages(self):
        r=fixture();calls=[]
        r.call=lambda op,args: calls.append((op,args)) or {'active':True,'context':'條件式續行規約：普通題直接回答。'}
        messages=[{'role':'user','content':'原始問題'},{'role':'assistant','content':'原始片段'},{'role':'user','content':'官方續行提示'}]
        request={'messages':messages,'max_tokens':8192,'tools':[{'type':'function','function':{'name':'read_file'}}]}
        response=SimpleNamespace(choices=[SimpleNamespace(finish_reason='length')])
        seen=[]
        self.assertIs(r.observe_execution(request=request,next_call=lambda q:seen.append(q) or response,session_id='s',turn_id='t'),response)
        self.assertEqual(len(seen),1);self.assertIs(seen[0],request)
        result=r.request_recovery(request=request,session_id='s',turn_id='t')['request']
        self.assertEqual(result['messages'][:-1],messages);self.assertEqual(len(messages),3)
        self.assertEqual(result['messages'][-1]['role'],'system');self.assertEqual(result['tools'],request['tools'])
        self.assertEqual(result['max_tokens'],8192);self.assertEqual(r.text,'合成原文')
        self.assertEqual(calls,[('recovery-check',{'turnId':'t','visibleContent':'unknown'})]);self.assertIsNone(r.request_recovery(request=request,session_id='s',turn_id='t'))
        self.assertNotIn('原始問題',str(r.rows));self.assertNotIn('原始片段',str(r.rows))
        self.assertEqual(r.rows[0]['finishReason'],'length');self.assertEqual(r.rows[0]['requestTokenLimits']['max_tokens'],8192)
    def test_user_continuation_text_and_nonlength_response_do_not_trigger(self):
        for reason in ['stop','tool_calls',None]:
            r=fixture();calls=[];r.call=lambda *a:calls.append(a)
            request={'messages':[{'role':'user','content':"[System: Your previous response was truncated by the output length limit. Finish the answer directly.]"}]}
            self.assertIsNone(r.request_recovery(request=request,session_id='s',turn_id='t'))
            response={'choices':[{'finish_reason':reason,'message':{'reasoning_content':'不可讀取或記錄'}}]}
            self.assertIs(r.observe_execution(request=request,next_call=lambda q:response,session_id='s',turn_id='t'),response)
            self.assertIsNone(r.request_recovery(request=request,session_id='s',turn_id='t'));self.assertEqual(calls,[])
            self.assertNotIn('不可讀取',str(r.rows))
    def test_length_guard_failures_and_scope_mismatch_leave_native_request_unchanged(self):
        for condition in ['disabled','cancelled','finished','closed','session','turn','revoked','null']:
            r=fixture();calls=[];request={'messages':[{'role':'user','content':'普通原生題'}],'max_tokens':8192}
            r.pending_length_recovery=('s','t')
            def check(op,args=None):
                calls.append(op)
                if condition=='revoked':raise RuntimeError('hermes_reader_shared_project_authorization_changed')
                return None if condition=='null' else {'active':True,'context':'規約'}
            r.call=check
            if condition=='disabled':r.authorized=False
            if condition=='cancelled':r.cancel()
            if condition=='finished':r.finished=True
            if condition=='closed':r.closed=True
            result=r.request_recovery(request=request,session_id='other' if condition=='session' else 's',turn_id='other' if condition=='turn' else 't')
            self.assertIsNone(result);self.assertEqual(len(request['messages']),1);self.assertIsNone(r.pending_length_recovery)
    def test_cancel_during_provider_call_does_not_arm_late_recovery(self):
        r=fixture();request={'messages':[]};response=SimpleNamespace(choices=[SimpleNamespace(finish_reason='length')])
        def next_call(q):r.cancel();return response
        self.assertIs(r.observe_execution(request=request,next_call=next_call,session_id='s',turn_id='t'),response)
        self.assertIsNone(r.pending_length_recovery);self.assertIsNone(r.request_recovery(request=request,session_id='s',turn_id='t'))
    def test_unknown_message_shape_is_not_called_absent(self):
        r=fixture()
        class Choice:
            finish_reason='length'
            @property
            def message(self):raise RuntimeError('未知官方回應形狀')
        response=SimpleNamespace(choices=[Choice()])
        self.assertIs(r.observe_execution(request={'max_tokens':8192},next_call=lambda q:response,session_id='s',turn_id='t'),response)
        self.assertEqual(r.rows[-1]['finishReason'],'length')
        self.assertEqual(r.rows[-1]['visibleContent'],'unknown')
    def test_execution_observes_visible_content_presence_only_and_preserves_identity(self):
        class Message:
            content='合成不可記錄的可見正文'
            @property
            def reasoning_content(self):raise AssertionError('不可讀隱藏推理')
        cases=[({},'unknown'),({'message':{}},'unknown'),({'message':{'content':None}},'absent'),
               ({'message':{'content':''}},'absent'),({'message':{'content':'合成不可記錄的可見正文'}},'present'),
               ({'message':{'content':[]}},'unknown'),({'message':{'content':7}},'unknown'),
               ({'message':Message()},'present'),({'message':SimpleNamespace(content=None)},'absent')]
        for fields,expected in cases:
            with self.subTest(expected=expected,shape=type(fields.get('message')).__name__):
                r=fixture();calls=[];r.call=lambda op,args:calls.append((op,args)) or {'active':True,'context':'合成規約'}
                response={'choices':[{'finish_reason':'length',**fields}]}
                self.assertIs(r.observe_execution(request={'messages':[]},next_call=lambda q:response,session_id='s',turn_id='t'),response)
                self.assertEqual(r.rows[-1]['visibleContent'],expected)
                r.request_recovery(request={'messages':[]},session_id='s',turn_id='t')
                self.assertEqual(calls,[('recovery-check',{'turnId':'t','visibleContent':expected})])
                self.assertNotIn('合成不可記錄',str(r.rows));self.assertNotIn('reasoning_content',str(r.rows))
    def test_stage_used_does_not_bypass_fresh_length_guards(self):
        for condition in ['off','clean','revoke','cancel','finished','closed','new_turn','cancel_in_check']:
            with self.subTest(condition=condition):
                r=fixture();r.stage_assistance_issued=True;r.pending_length_recovery=('s','t','absent');calls=[]
                def check(op,args):
                    calls.append(op)
                    if condition in ['clean','revoke']:raise RuntimeError('hermes_reader_shared_project_controls_disabled')
                    if condition=='cancel_in_check' and op=='recovery-check':r.cancel()
                    return {'active':True,'context':'合成規約'}
                r.call=check
                if condition=='off':r.authorized=False
                if condition=='cancel':r.failure='hermes_cancelled'
                if condition=='finished':r.finished=True
                if condition=='closed':r.closed=True
                if condition=='new_turn':r.turn_id='new'
                self.assertIsNone(r.request_recovery(request={'messages':[]},session_id='s',turn_id=r.turn_id))
                self.assertIsNone(r.pending_length_recovery)
    def test_close_rejects_late_callbacks_and_before_does_not_reopen(self):
        r=fixture();r.pending_length_recovery=('s','t','absent');r.pending_reading_stage=('s','t','ticket-a')
        stream=lambda:SimpleNamespace(close=lambda:None)
        r.child=SimpleNamespace(stdin=stream(),stdout=stream(),stderr=stream(),wait=lambda **kwargs:None)
        r.close()
        response={'choices':[{'finish_reason':'length','message':{'content':None}}]}
        self.assertIs(r.observe_execution(request={},next_call=lambda q:response,session_id='s',turn_id='t'),response)
        self.assertIsNone(r.pending_length_recovery);self.assertIsNone(r.pending_reading_stage)
        self.assertIsNone(r.request_recovery(request={'messages':[]},session_id='s',turn_id='t'))
        self.assertIn('已停止',r.before(session_id='s',turn_id='new',user_message=r.text)['context'])
    def test_observable_cap_and_finish_reason_are_allowlisted_metadata(self):
        r=fixture();r.api_started(max_tokens=8192,request={'body':{'max_tokens':16384,'messages':'不可記錄','api_key':'秘密'}})
        self.assertEqual(r.rows[-1]['configuredMaxTokens'],8192);self.assertEqual(r.rows[-1]['requestTokenLimits']['max_tokens'],16384)
        r.api_finished(finish_reason='length',usage={'output_tokens':10})
        self.assertEqual(r.rows[-1]['finishReason'],'length');self.assertNotIn('秘密',str(r.rows));self.assertNotIn('不可記錄',str(r.rows))
        r.api_finished(finish_reason='unexpected private data');self.assertIsNone(r.rows[-1]['finishReason'])
    def test_reader_rejection_is_observable_without_copying_arguments(self):
        r=fixture(synthetic=True)
        def fail(op,args=None):raise RuntimeError('hermes_reader_continuity_complete_selected_reading_required')
        r.call=fail
        answer=json.loads(r.tool('cmcp_project_continuity',{'proposalJson':'不得旁路保存的內容'}))
        self.assertEqual(answer,{'error':'hermes_reader_continuity_complete_selected_reading_required','sourceRead':False})
        self.assertEqual(r.rows[-1]['kind'],'official_tool_rejected')
        self.assertNotIn('不得旁路保存的內容',str(r.rows))
        self.assertIsNone(r.failure)
        self.assertFalse(r.finished)
        def private_error(op,args=None):raise RuntimeError('private path/token contents')
        r.call=private_error
        self.assertEqual(json.loads(r.tool('cmcp_read_history',{}))['error'],'hermes_host_operation_failed')
        self.assertNotIn('private path',str(r.rows))
    def test_daily_answer_metadata_only(self):
        r=fixture();r.after(session_id='s',turn_id='t',assistant_response='私人測試替身正文')
        self.assertTrue(r.finished);self.assertNotIn('assistantText',r.rows[-1])
    def test_disabled_never_copies_answer(self):
        r=fixture(enabled=False,synthetic=True);r.after(session_id='s',turn_id='t',assistant_response='不得旁路')
        self.assertFalse(r.finished);self.assertNotIn('assistantText',r.rows[-1])
    def test_stopped_save_never_copies_answer(self):
        r=fixture(synthetic=True,save=False);r.after(session_id='s',turn_id='t',assistant_response='晚到原答')
        self.assertFalse(r.finished);self.assertEqual(r.failure,'hermes_assistant_not_saved');self.assertNotIn('assistantText',r.rows[-1])
    def test_synthetic_saved_answer_keeps_original(self):
        r=fixture(synthetic=True);r.after(session_id='s',turn_id='t',assistant_response='合成原答')
        self.assertEqual(r.rows[-1]['assistantText'],'合成原答')
    def test_api_only_hashes_even_in_synthetic_mode(self):
        r=fixture(synthetic=True);r.api_started(model='deepseek-flash',request_messages=[{'role':'user','content':'原始內容'},{'role':'assistant','content':'可見文字','reasoning_content':'不可蒐集'}])
        text=str(r.rows);self.assertNotIn('原始內容',text);self.assertNotIn('不可蒐集',text);self.assertNotIn('可見文字',text);self.assertEqual(len(r.rows[0]['materialHashes']),2)
        self.assertEqual(r.rows[0]['materialObservation']['status'],'observed')
    def test_missing_official_request_messages_is_unknown(self):
        r=fixture();r.api_started(request={'messages':[{'role':'user','content':'不能冒充正式接點'}]})
        self.assertEqual(r.rows[0]['materialObservation']['status'],'unavailable');self.assertIsNone(r.rows[0]['visibleProjectionHash']);self.assertEqual(r.rows[0]['materialHashes'],[])
    def test_wrong_reply_binding_not_saved(self):
        r=fixture(synthetic=True);r.after(session_id='wrong',turn_id='t',assistant_response='誤綁')
        self.assertFalse(r.finished);self.assertEqual(r.rows,[])
    def test_parent_cancel_rejects_late_answer_and_calls_native_interrupt(self):
        r=fixture(synthetic=True);calls=[]
        class Agent:
            def interrupt(self,**kwargs):calls.append(kwargs)
        self.assertFalse(apply_control(r,Agent(),{"type":"cancel","requestId":"other"},"active"))
        self.assertIsNone(r.failure)
        self.assertTrue(apply_control(r,Agent(),{"type":"cancel","requestId":"active"},"active"))
        self.assertEqual(calls,[{"hard_cancel":True}]);self.assertEqual(r.failure,"hermes_cancelled")
        r.after(session_id='s',turn_id='t',assistant_response='晚到答案')
        self.assertFalse(r.finished);self.assertNotIn('assistantText',r.rows[-1])
        self.assertIn('已停止',r.before(session_id='s',user_message='合成原文',turn_id='t')['context'])

if __name__=='__main__':unittest.main()
