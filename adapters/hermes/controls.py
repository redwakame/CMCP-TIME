"""父程序的具名取消通道；不從模型文字解析命令。"""
import json, os, threading

def read_initial_payload():
    value=bytearray()
    while len(value)<=524288:
        byte=os.read(0,1)
        if byte in (b"",b"\n"):
            break
        value.extend(byte)
    if len(value)>524288:
        raise RuntimeError("hermes_input_capacity")
    return json.loads(value.decode("utf-8"))

def apply_control(runtime,agent,value,request_id):
    if not isinstance(value,dict) or value!={"type":"cancel","requestId":request_id}:
        return False
    runtime.cancel()
    agent.interrupt(hard_cancel=True)
    return True

def start_control_reader(runtime,agent,request_id):
    def read():
        pending=bytearray()
        try:
            while True:
                chunk=os.read(0,4096)
                if not chunk:
                    return
                pending.extend(chunk)
                if len(pending)>8192:
                    raise RuntimeError("hermes_control_capacity")
                while b"\n" in pending:
                    line,_,pending=pending.partition(b"\n")
                    apply_control(runtime,agent,json.loads(line.decode("utf-8")),request_id)
        except Exception:
            runtime.note("control_channel_error",{"state":"unknown"})
    thread=threading.Thread(target=read,name="cmcp-hermes-control",daemon=True)
    thread.start()
    return thread
