// Current explicit project authorization. Historical manifests are evidence, not authorization.
export const CMCP_PROVIDER_POLICY = Object.freeze({version:1,provider:'deepseek',endpoint:'https://api.deepseek.com/responses',
  model:'deepseek-flash',reasoning:'none',fallback:null});
export function assertCmcpProvider(provider){if(provider!=='deepseek')throw Error('provider_disabled_by_project_decision');}
export function assertCmcpTransport(config){
  if(config?.providerId!=='deepseek-responses'||config.endpoint!==CMCP_PROVIDER_POLICY.endpoint||config.model!==CMCP_PROVIDER_POLICY.model)
    throw Error('provider_disabled_by_project_decision');
}
