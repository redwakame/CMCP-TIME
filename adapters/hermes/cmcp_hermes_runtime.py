"""可信宿主接線；模型只看唯讀工具，不能直接提交保存或控制事件。"""
import datetime
import hashlib
import json
import os
import subprocess
import threading
import uuid
from pathlib import Path

_active = None

def active_runtime():
    return _active

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def safe_error(error):
    text = str(error)
    return text if text.startswith("hermes_") and text.replace("_", "").isalnum() else "hermes_host_operation_failed"

class HostRuntime:
    def __init__(self, config_file, config, session_id, text, node, authorized, receipt_file, synthetic_evidence=False):
        global _active
        self.config, self.session_id, self.text = config, session_id, text
        self.received_at = utc_now()
        self.turn_id = None
        self.registered = False
        self.finished = False
        self.failure = None
        self.authorized = authorized
        self.synthetic_evidence = bool(synthetic_evidence and authorized)
        self.begun = False
        self.receipt_file = Path(receipt_file)
        self.api_calls = 0
        self.api_failures = 0
        self.lock = threading.RLock()
        env = {k:v for k,v in os.environ.items() if not any(s in k.upper() for s in ["API_KEY", "TOKEN", "SECRET", "PASSWORD"])}
        self.child = subprocess.Popen([node, str(Path(__file__).with_name("bridge.mjs")), "--config", config_file, "--session", session_id, "--authorized", "true" if authorized else "false", "--synthetic-evidence", "true" if self.synthetic_evidence else "false"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        self.tools = self.call("inspect")["tools"] if authorized else []
        self.note("entry", {"sessionId":session_id,"receivedAt":self.received_at,"authorized":authorized,"userHash":hashlib.sha256(text.encode()).hexdigest(),"userBytes":len(text.encode()),"syntheticEvidence":self.synthetic_evidence})
        _active = self

    def note(self, kind, value):
        self.receipt_file.parent.mkdir(parents=True, exist_ok=True)
        with self.receipt_file.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"at":utc_now(),"kind":kind,**value}, ensure_ascii=False)+"\n")

    def call(self, operation, args=None):
        with self.lock:
            identifier = str(uuid.uuid4())
            self.child.stdin.write(json.dumps({"id":identifier,"sessionId":self.session_id,"operation":operation,"args":args or {}}, ensure_ascii=False)+"\n")
            self.child.stdin.flush()
            line = self.child.stdout.readline(1048577)
            if not line or len(line.encode("utf-8"))>1048576:
                raise RuntimeError("hermes_bridge_unavailable")
            value = json.loads(line)
            if value.get("id") != identifier or not value.get("ok"):
                raise RuntimeError(value.get("error","hermes_bridge_invalid_reply"))
            return value["result"]

    def before(self, session_id=None, user_message=None, turn_id=None, **kwargs):
        if self.failure:
            return {"context":"CMCP 已停止；不得聲稱取得本輪正式來源。"}
        if session_id != self.session_id or user_message != self.text or not turn_id:
            self.failure = "hermes_original_input_binding_mismatch"
            return {"context":"CMCP 未取得有效的本輪原始輸入綁定；不得聲稱已讀取或保存 CMCP 來源。"}
        self.turn_id = str(turn_id)
        if not self.authorized:
            return None
        try:
            value = self.call("begin", {"userMessage":user_message,"turnId":self.turn_id,"receivedAt":self.received_at})
            self.begun = True
            self.note("official_pre_llm_call", {"sessionId":session_id,"turnId":self.turn_id,"userHash":hashlib.sha256(user_message.encode()).hexdigest(),"contextHash":hashlib.sha256(value["context"].encode()).hexdigest()})
            return {"context":value["context"]}
        except Exception as error:
            self.failure = safe_error(error)
            self.note("cmcp_failed", {"code":self.failure})
            return {"context":"CMCP 本輪未能提供正式來源："+self.failure+"。不要宣稱已取得 CMCP 歷史；無關的原生工作仍可正常進行。"}

    def after(self, session_id=None, assistant_response=None, turn_id=None, **kwargs):
        if session_id != self.session_id or str(turn_id) != self.turn_id:
            self.failure = "hermes_original_answer_binding_mismatch"
            return
        if not isinstance(assistant_response,str) or not assistant_response:
            self.failure = "hermes_final_answer_missing"
            return
        saved = False
        if self.authorized and not self.failure:
            try:
                self.call("finish", {"turnId":self.turn_id,"text":assistant_response,"receivedAt":utc_now()})
                self.finished = True
                saved = True
            except Exception as error:
                self.failure = safe_error(error)
        value={"sessionId":session_id,"turnId":self.turn_id,"assistantHash":hashlib.sha256(assistant_response.encode()).hexdigest(),"assistantBytes":len(assistant_response.encode()),"cmcpSaved":saved}
        if self.synthetic_evidence and saved:
            value["assistantText"]=assistant_response
        self.note("official_post_llm_call", value)

    def interim(self, text, **kwargs):
        if not isinstance(text,str) or not text:
            return
        print(text, flush=True)
        saved = False
        if self.authorized and not self.failure:
            try:
                self.call("assistant", {"turnId":self.turn_id,"text":text,"receivedAt":utc_now()})
                saved = True
            except Exception as error:
                self.failure = safe_error(error)
        value={"sessionId":self.session_id,"turnId":self.turn_id,"assistantHash":hashlib.sha256(text.encode()).hexdigest(),"assistantBytes":len(text.encode()),"cmcpSaved":saved}
        if self.synthetic_evidence and saved:
            value["assistantText"]=text
        self.note("official_visible_interim",value)

    def tool(self, name, args):
        try:
            if self.failure:
                raise RuntimeError(self.failure)
            value = self.call("tool", {"turnId":self.turn_id,"name":name,"arguments":args})
            rendered=json.dumps(value,ensure_ascii=False)
            self.note("official_tool_rendered",{"name":name,"turnId":self.turn_id,"renderedSha256":hashlib.sha256(rendered.encode()).hexdigest(),"renderedBytes":len(rendered.encode())})
            return rendered
        except Exception as error:
            return json.dumps({"error":safe_error(error),"sourceRead":False},ensure_ascii=False)

    def api_started(self, **kwargs):
        # 正式 observer 的可見材料投影；排除 reasoning、認證及供應商 wire。
        self.api_calls += 1
        messages=[]
        request_messages=kwargs.get("request_messages")
        observed=isinstance(request_messages,list)
        for message in request_messages if observed else []:
            if not isinstance(message,dict) or message.get("role") not in ("user","assistant","tool"):
                continue
            projected={"role":message["role"]}
            if isinstance(message.get("content"),str):
                projected["content"]=message["content"]
            elif isinstance(message.get("content"),list):
                projected["content"]=[{"type":"text","text":part["text"]} for part in message["content"] if isinstance(part,dict) and part.get("type")=="text" and isinstance(part.get("text"),str)]
            if message.get("tool_call_id"):
                projected["tool_call_id"]=message["tool_call_id"]
            if isinstance(message.get("tool_calls"),list):
                projected["tool_calls"]=[{"id":item.get("id"),"function":{"name":item.get("function",{}).get("name"),"arguments":item.get("function",{}).get("arguments")}} for item in message["tool_calls"] if isinstance(item,dict)]
            messages.append(projected)
        material=[]
        for message in messages:
            content=message.get("content")
            raw=content if isinstance(content,str) else json.dumps(content,ensure_ascii=False)
            material.append({"role":message["role"],"contentSha256":hashlib.sha256(raw.encode()).hexdigest(),"contentBytes":len(raw.encode()),"toolCallId":message.get("tool_call_id")})
        value={"index":self.api_calls,"model":kwargs.get("model"),"sessionId":self.session_id,"visibleProjectionHash":hashlib.sha256(json.dumps(messages,ensure_ascii=False).encode()).hexdigest() if observed else None,"materialHashes":material,"materialObservation":{"status":"observed" if observed else "unavailable","source":"pre_api_request.request_messages" if observed else None,"reason":None if observed else "official_request_messages_missing"},"evidenceLayer":"official_sanitized_observer_hashes_not_provider_wire"}
        self.note("api_started",value)

    def api_finished(self, **kwargs):
        usage=kwargs.get("usage")
        self.note("api_finished", {"index":self.api_calls,"sessionId":self.session_id,"apiDuration":kwargs.get("api_duration"),"usage":usage if isinstance(usage,dict) else None})

    def api_error(self, **kwargs):
        self.api_failures += 1
        self.note("api_error", {"index":self.api_calls,"sessionId":self.session_id})

    def cancel(self):
        with self.lock:
            if self.finished:
                return
            self.failure = "hermes_cancelled"
            if self.authorized:
                self.call("cancel")
            self.note("cancel_requested", {"sessionId":self.session_id,"state":"stopping"})

    def close(self):
        global _active
        try:
            if self.authorized and not self.finished:
                self.call("cancel")
            result = self.call("close")
            self.note("closed", result)
        finally:
            _active = None
            self.child.stdin.close()
            try:
                self.child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.note("close_pending", {"state":"stopping","pid":self.child.pid})
                raise RuntimeError("hermes_bridge_release_pending")
            self.child.stdout.close()
            self.child.stderr.close()
