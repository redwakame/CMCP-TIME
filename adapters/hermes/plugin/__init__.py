"""只在明確設定的 CMCP Hermes 入口啟用，不攔截其他 Hermes profile。"""
def register(ctx):
    from cmcp_hermes_runtime import active_runtime
    runtime = active_runtime()
    if runtime is None:
        raise RuntimeError("hermes_cmcp_trusted_entry_required")
    ctx.register_hook("pre_llm_call", runtime.before)
    ctx.register_hook("post_llm_call", runtime.after)
    ctx.register_hook("pre_api_request", runtime.api_started)
    ctx.register_hook("post_api_request", runtime.api_finished)
    ctx.register_hook("api_request_error", runtime.api_error)
    ctx.register_middleware("llm_request", runtime.request_recovery)
    ctx.register_middleware("llm_execution", runtime.observe_execution)
    runtime.tool_registration_checks = {}
    for tool in runtime.tools:
        name = tool["name"]
        def invoke(args, _name=name, **kwargs):
            return runtime.tool(_name, args)
        registration = ctx.register_tool(name=name, toolset="cmcp", schema={"name": name, "description": tool["description"], "parameters": tool["inputSchema"]}, handler=invoke, description=tool["description"])
        if registration is not None:
            def current_registration(_name=name, _registration=registration, _handler=invoke):
                from tools.registry import registry
                entry = registry.get_entry(_name)
                return bool(_registration.active and entry is not None and entry.handler is _handler)
            runtime.tool_registration_checks[name] = current_registration
    runtime.registered = True
