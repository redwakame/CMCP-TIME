"""官方 Hermes AIAgent 正常入口；不取代原生推理迴圈或改寫原答。"""
import argparse
import datetime
import json
import os
import sys
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--config",required=True)
    parser.add_argument("--session",required=True)
    parser.add_argument("--node",required=True)
    parser.add_argument("--receipt",required=True)
    parser.add_argument("--authorize-session",action="store_true")
    parser.add_argument("--native-only",action="store_true")
    parser.add_argument("--probe",action="store_true")
    parser.add_argument("--synthetic-evidence",action="store_true")
    args=parser.parse_args()
    config=json.loads(Path(args.config).read_text(encoding="utf-8"))
    home=Path(config["home"])
    os.environ["HERMES_HOME"]=str(home)
    os.environ["HERMES_SKIP_AUTO_UPDATE"]="1"
    os.environ["PYTHONNOUSERSITE"]="1"
    for key in ("TEMP","TMP","TMPDIR"):
        os.environ[key]=str(home/"temp")
    for name in ("temp","cache","receipts"):
        (home/name).mkdir(parents=True,exist_ok=True)
    os.environ["XDG_CACHE_HOME"]=str(home/"cache")
    os.environ["PYTHONPYCACHEPREFIX"]=str(home/"cache"/"pycache")
    if args.probe:
        from cmcp_hermes_runtime import HostRuntime
        runtime=HostRuntime(args.config,config,args.session,"合成零模型載入查核",args.node,False,str(Path(args.receipt).with_suffix(".events.jsonl")))
        import importlib.metadata
        try:
            from hermes_cli.plugins import VALID_HOOKS, get_plugin_manager
            get_plugin_manager().discover_and_load()
            from run_agent import AIAgent
            from tools.registry import registry
            result={"kind":"cmcp_hermes_native_probe","hermesVersion":importlib.metadata.version("hermes-agent"),"python":sys.version.split()[0],"hooks":{name:name in VALID_HOOKS for name in ("pre_llm_call","post_llm_call")},"runConversation":callable(AIAgent.run_conversation),"pluginRegistered":runtime.registered,"nativeReadFileRegistered":registry.get_entry("read_file") is not None,"nativeTerminalRegistered":registry.get_entry("terminal") is not None,"modelCalls":0}
            Path(args.receipt).write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
            print(json.dumps(result,ensure_ascii=False))
            return 0 if runtime.registered and result["nativeReadFileRegistered"] else 2
        finally:
            runtime.close()
    from controls import read_initial_payload, start_control_reader
    payload=read_initial_payload()
    text=payload.get("text")
    if not isinstance(text,str) or not text.strip():
        raise RuntimeError("hermes_user_input_required")
    if not args.authorize_session and not args.native_only:
        raise RuntimeError("hermes_explicit_session_authorization_required")
    from cmcp_hermes_runtime import HostRuntime, safe_error
    runtime=HostRuntime(args.config,config,args.session,text,args.node,args.authorize_session,args.receipt,args.synthetic_evidence)
    agent=None
    database=None
    try:
        from hermes_cli.plugins import get_plugin_manager
        get_plugin_manager().discover_and_load()
        if not runtime.registered:
            raise RuntimeError("hermes_plugin_not_loaded")
        import yaml
        credentials=yaml.safe_load(Path(config["credentialFile"]).read_text(encoding="utf-8"))
        # 官方 credentials-local v1 將字串 secret 置於 refs；records 是另一種具名記錄，不是 ref 轉址。
        key=credentials.get("refs",{}).get(config["credentialRef"]) if isinstance(credentials,dict) and credentials.get("version")==1 else None
        if not isinstance(key,str) or not key:
            raise RuntimeError("hermes_existing_credential_unavailable")
        from run_agent import AIAgent
        from hermes_state import SessionDB
        database=SessionDB()
        history=database.get_messages_as_conversation(args.session)
        agent=AIAgent(model=config["model"],provider="custom",base_url=config["baseUrl"],api_key=key,api_mode="chat_completions",max_iterations=24,enabled_toolsets=config["nativeToolsets"]+(["cmcp"] if args.authorize_session else []),save_trajectories=False,verbose_logging=False,quiet_mode=True,session_id=args.session,session_db=database,platform="cli",cwd=payload["workspace"],interim_assistant_callback=runtime.interim,skip_context_files=False,load_soul_identity=False,skip_memory=True,skip_background_review=True,run_budget_seconds=config["timeoutSeconds"],fallback_model=None,max_tokens=8192)
        key=None
        start_control_reader(runtime,agent,payload["requestId"])
        native_time=datetime.datetime.fromisoformat(runtime.received_at.replace("Z","+00:00")).timestamp()
        result=agent.run_conversation(text,conversation_history=history,task_id=payload["requestId"],persist_user_timestamp=native_time)
        final=result.get("final_response")
        if isinstance(final,str):
            print(final,flush=True)
        receipt={"kind":"cmcp_hermes_turn_result","sessionId":args.session,"model":result.get("model"),"provider":result.get("provider"),"completed":result.get("completed"),"failed":result.get("failed"),"interrupted":result.get("interrupted"),"cmcpEnabled":args.authorize_session,"cmcpSaved":runtime.finished,"cmcpFailure":runtime.failure,"apiCalls":runtime.api_calls,"apiFailures":runtime.api_failures,"nativeHistoryRowsBefore":len(history)}
        if runtime.synthetic_evidence and runtime.finished:
            receipt["finalResponse"]=final
        runtime.note("result",receipt)
        return 0 if result.get("completed") and not result.get("failed") and not runtime.failure and (runtime.finished or args.native_only) else 2
    except Exception as error:
        runtime.note("host_failed",{"code":safe_error(error)})
        print(safe_error(error),file=sys.stderr)
        return 2
    finally:
        if agent is not None:
            agent.close()
        if database is not None:
            database.close()
        runtime.close()

if __name__=="__main__":
    sys.exit(main())
