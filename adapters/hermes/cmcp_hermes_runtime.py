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

def completion_metadata(value):
    """只讀可信 bridge 的階段中繼資料；缺欄位保持未知，不推定整條成功。"""
    if not isinstance(value, dict):
        return None
    reading = value.get("formalReading")
    projection = value.get("projectionCompletion")
    if reading not in ("not_requested", "pending", "completed") or projection not in ("not_requested", "not_performed", "pending", "completed"):
        return None
    ticket = value.get("ticket")
    if ticket is not None and (not isinstance(ticket, str) or not ticket or len(ticket) > 256):
        return None
    return {"formalReading":reading,"projectionCompletion":projection,"ticket":ticket,
            "projectionStatus":value.get("projectionStatus") if value.get("projectionStatus") in ("ready", "partial", "rejected", "unavailable") else None,
            "evidenceLevel":"same_turn_formal_tool_receipts","sourceVersionValidation":"formal_projection_tool_rechecks","semanticAssessment":"not_assessed"}

class HostRuntime:
    def __init__(self, config_file, config, session_id, text, node, authorized, receipt_file, synthetic_evidence=False):
        global _active
        self.config, self.session_id, self.text = config, session_id, text
        self.received_at = utc_now()
        self.turn_id = None
        self.registered = False
        self.finished = False
        self.closed = False
        self.failure = None
        self.authorized = authorized
        self.synthetic_evidence = bool(synthetic_evidence and authorized)
        self.begun = False
        self.receipt_file = Path(receipt_file)
        self.api_calls = 0
        self.api_failures = 0
        self.pending_length_recovery = None
        self.pending_reading_stage = None
        self.stage_assistance_issued = False
        self.length_assistance_issued = False
        self.completion_budget = None
        self.continuity_delivery_proof = None
        self.tool_registration_checks = {}
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
        if self.failure or getattr(self, "closed", False):
            return {"context":"CMCP 已停止；不得聲稱取得本輪正式來源。"}
        if session_id != self.session_id or user_message != self.text or not turn_id:
            self.failure = "hermes_original_input_binding_mismatch"
            return {"context":"CMCP 未取得有效的本輪原始輸入綁定；不得聲稱已讀取或保存 CMCP 來源。"}
        self.turn_id = str(turn_id)
        self.pending_length_recovery = None
        self.pending_reading_stage = None
        self.stage_assistance_issued = False
        self.length_assistance_issued = False
        self.completion_budget = None
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
        completion = None
        if self.authorized and not self.failure:
            try:
                receipt = self.call("finish", {"turnId":self.turn_id,"text":assistant_response,"receivedAt":utc_now()})
                completion = completion_metadata(receipt.get("completion")) if isinstance(receipt, dict) else None
                self.finished = True
                self.pending_reading_stage = None
                self.pending_length_recovery = None
                self.completion_budget = None
                saved = True
            except Exception as error:
                self.failure = safe_error(error)
        value={"sessionId":session_id,"turnId":self.turn_id,"assistantHash":hashlib.sha256(assistant_response.encode()).hexdigest(),"assistantBytes":len(assistant_response.encode()),"cmcpSaved":saved,"completion":completion}
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
            self.observe_formal_stage(name, args, value)
            rendered=json.dumps(value,ensure_ascii=False)
            metadata={"name":name,"turnId":self.turn_id,"renderedSha256":hashlib.sha256(rendered.encode()).hexdigest(),"renderedBytes":len(rendered.encode())}
            if isinstance(value, dict) and value.get("kind") == "cmcp_formal_page_batch":
                metadata["formalChildren"]=[{"ticket":page.get("ticket"),"deliveryId":page.get("delivery",{}).get("id"),
                    "page":page.get("delivery",{}).get("page"),"pageCount":page.get("delivery",{}).get("pageCount"),
                    "resultHash":page.get("delivery",{}).get("resultHash"),"childSha256":hashlib.sha256(json.dumps(page,ensure_ascii=False).encode()).hexdigest(),
                    "childBytes":len(json.dumps(page,ensure_ascii=False).encode()),"provided":page.get("status") == "provided"} for page in value["pages"]]
                metadata["childSerialization"]="python_json_utf8_same_rendered_aggregate"
            self.note("official_tool_rendered",metadata)
            return rendered
        except Exception as error:
            code=safe_error(error)
            if name == "cmcp_read_continuity" or (name == "cmcp_project_continuity" and getattr(self,"config",{}).get("readMaxPages",1) > 1):
                self.continuity_delivery_proof = None
                self.pending_reading_stage = None
                self.completion_budget = None
            if name in ("cmcp_open_history", "cmcp_read_history", "cmcp_reading_progress"):
                self.pending_reading_stage = None
                self.completion_budget = None
            self.note("official_tool_rejected", {"name":name,"error":code,"sourceRead":False})
            return json.dumps({"error":code,"sourceRead":False},ensure_ascii=False)

    def active_binding(self, session_id, turn_id):
        return bool(self.authorized and self.begun and not self.failure and not self.finished and not getattr(self, "closed", False)
                    and session_id == self.session_id and str(turn_id) == self.turn_id)

    def observe_formal_stage(self, name, args, value):
        # 只讀私有 bridge 回傳的正式結果，不從模型內容、工具引數的宣告或歷史文字推斷。
        if not self.active_binding(self.session_id, self.turn_id) or not isinstance(value, dict):
            return
        if name == "cmcp_reading_progress" and isinstance(value.get("reader"), dict):
            value = value["reader"]
        if name == "cmcp_open_history":
            self.pending_reading_stage = None
            self.completion_budget = None
            self.continuity_delivery_proof = None
        elif name == "cmcp_read_continuity" and value.get("kind") == "cmcp_formal_page_batch":
            pages=value.get("pages")
            if (value.get("version") != 1 or value.get("operation") != "continuity-page" or value.get("ticket") != args.get("ticket")
                    or type(value.get("requestedMaxPages")) is not int or not 1 <= value["requestedMaxPages"] <= 2
                    or not isinstance(pages,list) or not 1 <= len(pages) <= value["requestedMaxPages"]):
                raise RuntimeError("hermes_formal_batch_invalid")
            for index,page in enumerate(pages):
                delivery=page.get("delivery",{}) if isinstance(page,dict) else {}
                if (not isinstance(page,dict) or page.get("kind") != "cmcp_continuity_delivery_page" or page.get("status") != "provided"
                        or page.get("ticket") != value["ticket"] or delivery.get("id") != args.get("deliveryId")
                        or delivery.get("page") != int(args["page"])+index):
                    raise RuntimeError("hermes_formal_batch_binding_changed")
                self.observe_formal_stage(name,args,page)
        elif name in ("cmcp_read_history", "cmcp_reading_progress"):
            coverage = value.get("coverage")
            if (isinstance(coverage, dict) and coverage.get("complete") is True and coverage.get("exhausted") is True
                    and type(coverage.get("sourceCount")) is int and coverage["sourceCount"] > 0
                    and coverage.get("completedSources") == coverage["sourceCount"] and coverage.get("unavailableSources") == 0
                    and coverage.get("unread") == [] and isinstance(value.get("ticket"), str) and value["ticket"] == args.get("ticket")):
                self.pending_reading_stage = (self.session_id, self.turn_id, value["ticket"])
            else:
                self.pending_reading_stage = None
                self.completion_budget = None
        elif name in ("cmcp_project_continuity", "cmcp_read_continuity") and value.get("kind") == "cmcp_continuity_delivery_page":
            delivery=value.get("delivery",{});received_all=delivery.get("complete") is True
            if getattr(self,"config",{}).get("readMaxPages",1) > 1:
                identity=(value.get("ticket"),delivery.get("id"),delivery.get("resultHash"),delivery.get("pageCount"),value.get("projectionHash"))
                proof=getattr(self,"continuity_delivery_proof",None)
                if not proof or proof["identity"] != identity:
                    proof={"identity":identity,"pages":set()};self.continuity_delivery_proof=proof
                if type(delivery.get("page")) is not int or type(delivery.get("pageCount")) is not int or not 1 <= delivery["pageCount"] <= 64:
                    raise RuntimeError("hermes_delivery_proof_invalid")
                proof["pages"].add(delivery["page"])
                received_all=received_all and all(index in proof["pages"] for index in range(delivery["pageCount"]))
            if self.pending_reading_stage and self.pending_reading_stage[2] == value.get("ticket") and received_all:
                self.pending_reading_stage = None
        elif name == "cmcp_project_continuity" and value.get("kind") == "cmcp_continuity_projection" and value.get("status") in ("ready", "partial") and value.get("projection"):
            if self.pending_reading_stage and self.pending_reading_stage[2] == value.get("ticket"):
                self.pending_reading_stage = None

    def request_recovery(self, request=None, session_id=None, turn_id=None, **kwargs):
        # 正式閱讀與真正 length 各同回合一次；兩種事件不互相吞掉。
        with self.lock:
            pending = self.pending_length_recovery
            stage = getattr(self, "pending_reading_stage", None)
            if not self.active_binding(session_id, turn_id):
                self.pending_length_recovery = None
                self.pending_reading_stage = None
                self.completion_budget = None
                return None
            length_matches = bool(pending and pending[:2] == (session_id, str(turn_id)) and not getattr(self, "length_assistance_issued", False))
            stage_matches = bool(stage and stage[:2] == (session_id, str(turn_id)) and not getattr(self, "stage_assistance_issued", False))
            if not length_matches:
                self.pending_length_recovery = None
            if not stage_matches:
                self.pending_reading_stage = None
            if not length_matches and not stage_matches:
                return self.maintain_completion_budget(request, session_id, turn_id)
            # length 是正式執行結果；優先處理，其餘尚未使用的階段事件留待下一請求。
            stage_matches = stage_matches and not length_matches
            if stage_matches:
                self.pending_reading_stage = None
            else:
                self.pending_length_recovery = None
            if not isinstance(request, dict):
                return None
            tool_route = self.continuity_tool_route(request) if stage_matches else None
            if stage_matches and tool_route is None:
                self.note("formal_stage_assistance_not_applied", {"reason":"continuity_tool_unavailable"})
                return None
            messages = request.get("messages")
            if not isinstance(messages, list):
                self.note("length_recovery_not_applied", {"reason":"unsupported_request_shape"})
                return None
            try:
                # 可信宿主私有接點；正式服務重新核對 owner、epoch、回合與共用保護。
                visible = pending[2] if not stage_matches and len(pending) == 3 and pending[2] in ("absent", "present", "unknown") else "unknown"
                checked = self.call("stage-check" if stage_matches else "recovery-check", {"turnId":self.turn_id} if stage_matches else {"turnId":self.turn_id,"visibleContent":visible})
            except Exception as error:
                self.note("length_recovery_not_applied", {"reason":safe_error(error)})
                return None
            context = checked.get("context") if isinstance(checked, dict) else None
            if (not self.active_binding(session_id, turn_id) or not isinstance(checked, dict) or checked.get("active") is not True
                    or (stage_matches and checked.get("ticket") != stage[2])
                    or not isinstance(context, str) or not context or len(context.encode()) > 4096):
                self.note("length_recovery_not_applied", {"reason":"hermes_recovery_authorization_unavailable"})
                return None
            # 新增的是宿主規約，原訊息物件／順序與原始 User 保存均不改寫。
            revised = {**request, "messages":[*messages, {"role":"system", "content":context}]}
            if (stage_matches and type(request.get("max_tokens")) is int and request["max_tokens"] == 8192
                    and all(request.get(key) is None for key in ("max_completion_tokens", "max_output_tokens"))):
                revised["max_tokens"] = 16384
                completion = completion_metadata(checked.get("completion"))
                if (completion and completion["formalReading"] == "completed" and completion["ticket"] == stage[2]
                        and all(request.get(key) is None for key in ("max_completion_tokens", "max_output_tokens"))):
                    self.completion_budget = {"sessionId":session_id, "turnId":str(turn_id), "ticket":stage[2], "floor":16384}
            if stage_matches:
                self.stage_assistance_issued = True
            else:
                self.length_assistance_issued = True
            completion = completion_metadata(checked.get("completion"))
            # length 仍只使用自己的額度；附帶的正式階段不算第二次 stage 提醒。
            if not stage_matches and completion and completion.get("ticket"):
                tool_route = self.continuity_tool_route(request)
            self.note("formal_stage_assistance_applied" if stage_matches else "length_recovery_applied", {"sessionId":session_id,"turnId":self.turn_id,
                      "contextSha256":hashlib.sha256(context.encode()).hexdigest(),"contextBytes":len(context.encode()),
                      "originalMessageCount":len(messages),"requestTokenLimits":request_token_limits(revised),
                      "ticket":stage[2] if stage_matches else completion.get("ticket") if completion else None,"toolRoute":tool_route,"visibleContent":visible if not stage_matches else None,"completion":completion,"modelCallsAdded":0})
            if not stage_matches:
                budget = self.maintain_completion_budget(revised, session_id, turn_id)
                if budget:
                    revised = budget["request"]
            return {"request":revised,"source":"cmcp","reason":"same_turn_formal_stage" if stage_matches else "same_turn_length_recovery"}

    def maintain_completion_budget(self, request, session_id, turn_id):
        """同一已讀票券的有限輸出額度；不追加提示、不啟動請求、不重設原生重試。"""
        budget = getattr(self, "completion_budget", None)
        if not budget:
            return None
        if (not self.active_binding(session_id, turn_id) or budget["sessionId"] != session_id
                or budget["turnId"] != str(turn_id)):
            self.completion_budget = None
            return None
        if not isinstance(request, dict) or not isinstance(request.get("messages"), list):
            return None
        # 只補官方入口重建的既有 8192／16384，不改其他明示上限或較高額度。
        cap = request.get("max_tokens")
        if (type(cap) is not int or cap not in (8192, 16384) or cap >= budget["floor"]
                or any(request.get(key) is not None for key in ("max_completion_tokens", "max_output_tokens"))):
            return None
        try:
            checked = self.call("budget-check", {"turnId":self.turn_id, "ticket":budget["ticket"]})
        except Exception as error:
            self.completion_budget = None
            self.note("completion_budget_not_applied", {"reason":safe_error(error)})
            return None
        completion = completion_metadata(checked.get("completion")) if isinstance(checked, dict) else None
        if (self.completion_budget is not budget or not self.active_binding(session_id, turn_id)
                or not isinstance(checked, dict) or checked.get("active") is not True
                or not completion or completion["ticket"] != budget["ticket"] or completion["formalReading"] != "completed"):
            self.completion_budget = None
            self.note("completion_budget_not_applied", {"reason":"hermes_completion_budget_authorization_unavailable"})
            return None
        revised = {**request, "max_tokens":budget["floor"]}
        self.note("completion_budget_applied", {"sessionId":session_id,"turnId":str(turn_id),"ticket":budget["ticket"],
                  "previousMaxTokens":cap,"maxTokens":budget["floor"],"completion":completion,"modelCallsAdded":0,
                  "nativeRetryLimitChanged":False,"contextAdded":False})
        return {"request":revised,"source":"cmcp","reason":"same_turn_formal_completion_budget"}

    def continuity_tool_route(self, request):
        # 官方 lazy disclosure 將工具改由 tool_call 提供；模型文字／arguments 不授權。
        available = request.get("tools") if isinstance(request.get("tools"), list) else []
        names = {tool["function"].get("name") for tool in available
                 if isinstance(tool, dict) and isinstance(tool.get("function"), dict)}
        if "cmcp_project_continuity" in names:
            return "direct"
        if "tool_call" not in names or not getattr(self, "registered", False):
            return None
        check = getattr(self, "tool_registration_checks", {}).get("cmcp_project_continuity")
        try:
            if callable(check) and check() is True:
                return "official_tool_call"
        except Exception:
            pass
        return None

    def observe_execution(self, request=None, next_call=None, session_id=None, turn_id=None, **kwargs):
        # 官方 middleware 單次透傳；只看可見正文有無，不留正文、不讀 reasoning、不自行重試。
        response = next_call(request)
        choices = response.get("choices") if isinstance(response, dict) else getattr(response,"choices",None)
        first = choices[0] if isinstance(choices,(list,tuple)) and choices else None
        reason = first.get("finish_reason") if isinstance(first,dict) else getattr(first,"finish_reason",None)
        reason = reason if reason in ("stop","length","tool_calls","function_call","content_filter") else None
        visible = visible_content_state(first) if reason == "length" else "unknown"
        with self.lock:
            if session_id == self.session_id and str(turn_id) == self.turn_id:
                self.note("official_api_execution", {"index":self.api_calls,"sessionId":session_id,"turnId":self.turn_id,
                          "finishReason":reason,"visibleContent":visible,"requestTokenLimits":request_token_limits(request),
                          "evidenceLayer":"official_llm_execution_middleware_metadata_not_provider_wire"})
                self.pending_length_recovery = (session_id,str(turn_id),visible) if reason == "length" and self.active_binding(session_id,turn_id) else None
                budget = getattr(self, "completion_budget", None)
                if (reason == "length" and budget and self.active_binding(session_id, turn_id)
                        and budget["sessionId"] == session_id and budget["turnId"] == str(turn_id)
                        and isinstance(request, dict) and type(request.get("max_tokens")) is int
                        and request["max_tokens"] >= 16384):
                    # 只有實際 length 才升一次，最高沿官方已使用的 32768；不讀推理。
                    budget["floor"] = 32768
        return response

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
        value["configuredMaxTokens"] = positive_limit(kwargs.get("max_tokens"))
        safe_request = kwargs.get("request")
        value["requestTokenLimits"] = request_token_limits(safe_request.get("body") if isinstance(safe_request,dict) else None)
        self.note("api_started",value)

    def api_finished(self, **kwargs):
        usage=kwargs.get("usage")
        reason=kwargs.get("finish_reason")
        self.note("api_finished", {"index":self.api_calls,"sessionId":self.session_id,"apiDuration":kwargs.get("api_duration"),"usage":usage if isinstance(usage,dict) else None,"finishReason":reason if reason in ("stop","length","tool_calls","function_call","content_filter") else None})

    def api_error(self, **kwargs):
        self.api_failures += 1
        self.note("api_error", {"index":self.api_calls,"sessionId":self.session_id})

    def cancel(self):
        with self.lock:
            if self.finished:
                return
            self.failure = "hermes_cancelled"
            self.pending_length_recovery = None
            self.pending_reading_stage = None
            self.completion_budget = None
            if self.authorized:
                self.call("cancel")
            self.note("cancel_requested", {"sessionId":self.session_id,"state":"stopping"})

    def close(self):
        global _active
        with self.lock:
            self.closed = True
            self.pending_length_recovery = None
            self.pending_reading_stage = None
            self.completion_budget = None
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

def visible_content_state(choice):
    # 未知形狀不得當作「沒有正文」；不列舉物件、不碰 reasoning_content 或其他欄位。
    missing = object()
    try:
        message = choice.get("message", missing) if isinstance(choice, dict) else getattr(choice, "message", missing)
        content = message.get("content", missing) if isinstance(message, dict) else getattr(message, "content", missing)
        if content is None or isinstance(content, str) and content == "":
            return "absent"
        if isinstance(content, str):
            return "present"
    except Exception:
        pass
    return "unknown"

def positive_limit(value):
    return value if type(value) is int and 0 < value <= 1048576 else None

def request_token_limits(request):
    # 只記整數額度；認證、訊息與其他 request 欄位不進回執。
    return {key:positive_limit(request.get(key)) if isinstance(request,dict) else None
            for key in ("max_tokens","max_completion_tokens","max_output_tokens")}
