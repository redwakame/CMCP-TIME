"""正式 Hermes plugin 接點＋產品階段邏輯；provider／授權替身，零模型。"""
import copy, datetime, hashlib, importlib.util, json, os, socket, sys, threading
from pathlib import Path
from unittest.mock import patch

official,out=(Path(x).resolve() for x in sys.argv[1:3]);out.mkdir(parents=True,exist_ok=False)
home=out/'home';home.mkdir()
os.environ.update(HERMES_HOME=str(home),HERMES_SKIP_AUTO_UPDATE='1',PYTHONNOUSERSITE='1')
adapter=Path(__file__).resolve().parents[1];sys.path[:0]=[str(adapter),str(official)]
import cmcp_hermes_runtime as runtime
from hermes_cli import plugins
from hermes_cli.plugins import PluginContext,PluginManager,PluginManifest
from hermes_cli.middleware import apply_llm_request_middleware,run_llm_execution_middleware
from tools.tool_search import assemble_tool_defs,ToolSearchConfig
from tools.registry import registry
spec=importlib.util.spec_from_file_location('cmcp_stage_product_plugin',adapter/'plugin/__init__.py')
plugin=importlib.util.module_from_spec(spec);spec.loader.exec_module(plugin)

checks=[];rows=[];provider_calls=[]
page={'ticket':'synthetic-ticket','status':'complete','coverage':{'complete':True,'exhausted':True,'sourceCount':2,'completedSources':2,'unavailableSources':0,'unread':[]}}
request={'messages':[{'role':'user','content':'合成正常回查'}], 'model':'deepseek-flash','max_tokens':8192,
         'tools':[{'type':'function','function':{'name':name}} for name in ['read_file','terminal','cmcp_project_continuity']],
         'extra_body':{'thinking':{'type':'enabled'}},'tool_choice':'auto'}
with patch.object(socket.socket,'connect',side_effect=AssertionError('零模型驗證禁止網路連線')):
    for condition in ['stage','stage_visible','stage_unknown','official_lazy','missing_wrapper','unregistered','ordinary','off','clean','revoke','cancel','already_projected','native_only']:
        r=runtime.HostRuntime.__new__(runtime.HostRuntime)
        r.session_id='s';r.turn_id='t';r.text='合成正常回查';r.authorized=True;r.begun=True;r.failure=None;r.finished=False;r.registered=False
        r.pending_length_recovery=None;r.pending_reading_stage=None;r.stage_assistance_issued=False;r.length_assistance_issued=False;r.closed=False;r.api_calls=0;r.api_failures=0;r.lock=threading.RLock()
        r.tools=[{'name':'cmcp_project_continuity','description':'正式接續投影','inputSchema':{'type':'object','properties':{'ticket':{'type':'string'},'proposalJson':{'type':'string'}},'required':['ticket','proposalJson']}}]
        r.note=lambda kind,value:rows.append({'condition':condition,'kind':kind,**value})
        calls=[]
        def call(op,args=None):
            calls.append(op)
            if op=='tool':return copy.deepcopy(page)
            if op=='stage-check':
                if condition in ['off','clean','revoke']:raise RuntimeError('hermes_reader_shared_project_controls_disabled')
                return {'active':True,'ticket':page['ticket'],'context':'正式來源先前讀完；未執行投影，不代表回答失敗。','completion':{'formalReading':'completed','projectionCompletion':'not_performed','ticket':page['ticket'],'projectionStatus':None}}
            if op=='recovery-check':
                assert args['visibleContent'] in ['absent','present','unknown']
                if condition in ['off','clean','revoke']:raise RuntimeError('hermes_reader_shared_project_controls_disabled')
                return {'active':True,'context':'沿原始問題及正式工具規約完成本輪；未投影不等於回答失敗，這是長度恢復替身。','completion':{'formalReading':'completed','projectionCompletion':'not_performed','ticket':page['ticket'],'projectionStatus':None}}
            return {'state':'cancelled'}
        r.call=call;runtime._active=r;manager=PluginManager();manager._discovered=True
        with patch.object(plugins,'_delivery_manager',return_value=manager):
            plugin.register(PluginContext(PluginManifest(name='cmcp-official-stage-test',version='1'),manager))
            if condition!='ordinary':r.tool('cmcp_read_history',{'ticket':page['ticket']})
            if condition=='cancel':r.cancel()
            if condition=='already_projected':r.observe_formal_stage('cmcp_project_continuity',{}, {'kind':'cmcp_continuity_projection','status':'ready','ticket':page['ticket'],'projection':{'synthetic':True}})
            initial=copy.deepcopy(request)
            if condition=='native_only':initial['tools']=initial['tools'][:2]
            if condition in ['official_lazy','missing_wrapper','unregistered']:
                assembled=assemble_tool_defs(initial['tools'],config=ToolSearchConfig.from_raw({'enabled':'on'}))
                initial['tools']=assembled.tool_defs
                names=[tool['function']['name'] for tool in initial['tools']]
                assert assembled.activated and 'tool_call' in names and 'cmcp_project_continuity' not in names
                if condition=='missing_wrapper':initial['tools']=[tool for tool in initial['tools'] if tool['function']['name']!='tool_call']
                if condition=='unregistered':
                    for handle in list(manager._registration_order):
                        if handle.kind=='tool' and handle.key=='cmcp_project_continuity':handle.dispose()
                    assert registry.get_entry('cmcp_project_continuity') is None
            before=copy.deepcopy(initial);result=apply_llm_request_middleware(initial,session_id='s',turn_id='t')
            expected=condition in ['stage','stage_visible','stage_unknown','official_lazy'];assert result.changed is expected,condition
            assert initial==before,condition
            for key in ['model','tools','extra_body','tool_choice']:assert result.payload[key]==before[key],(condition,key)
            assert result.payload['messages'][:len(before['messages'])]==before['messages'],condition
            assert result.payload['max_tokens']==(16384 if expected else 8192),condition
            message={} if condition=='stage_unknown' else {'message':{'content':'合成可見片段，禁止記錄' if condition=='stage_visible' else None}}
            response={'choices':[{'finish_reason':'length',**message}]}
            def provider(payload):provider_calls.append(condition);return response
            answer=run_llm_execution_middleware(result.payload,provider,session_id='s',turn_id='t')
            assert answer is response;assert provider_calls.count(condition)==1
            # 官方會重建下一請求；不假設前次階段提示或額度修改仍在。
            length_applied=False
            if expected:
                r.tool('cmcp_read_history',{'ticket':page['ticket']})
                rebuilt=copy.deepcopy(initial)
                length=apply_llm_request_middleware(rebuilt,session_id='s',turn_id='t')
                assert length.changed;length_applied=True
                assert rebuilt==before and length.payload['messages'][:-1]==rebuilt['messages']
                assert length.payload['max_tokens']==8192
                for key in ['model','tools','extra_body','tool_choice']:assert length.payload[key]==before[key]
                event=rows[-1]
                assert event['kind']=='length_recovery_applied' and event['completion']['projectionCompletion']=='not_performed'
                assert event['ticket']==page['ticket'] and event['completion']['semanticAssessment']=='not_assessed'
                r.pending_length_recovery=('s','t','absent');r.tool('cmcp_read_history',{'ticket':page['ticket']})
                assert not apply_llm_request_middleware(copy.deepcopy(initial),session_id='s',turn_id='t').changed
                assert calls.count('stage-check')==1 and calls.count('recovery-check')==1
            checks.append({'condition':condition,'applied':result.changed,'maxTokens':result.payload['max_tokens'],'providerCalls':1,
                           'modelThinkingNativeToolsPreserved':True,'originalMessagesPreserved':True,'rebuiltRequestLengthApplied':length_applied,
                           'visibleContent':'unknown' if condition=='stage_unknown' else 'present' if condition=='stage_visible' else 'absent'})
            for handle in list(reversed(manager._registration_order)):handle.dispose()
        runtime._active=None

result={'kind':'official_hermes_product_stage_zero_model','status':'PASS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'officialSource':str(official),'productModelCalls':0,'provider':'替身，禁止網路連線','freshState':'替身；正式 Core 控制與原件異動另由 recovery.test.mjs 覆核',
        'checks':checks,'events':rows,'limitation':'不是真模型語意驗收；沒有切換或判定實際 provider thinking。',
        'files':[{'path':str(p.relative_to(adapter)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [adapter/'cmcp_hermes_runtime.py',adapter/'plugin/__init__.py',Path(__file__)]]}
(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','cases':len(checks),'productModelCalls':0,'out':str(out)},ensure_ascii=False))
