export const CMCP_MINIMUM_NODE_VERSION='22.16.0';

// 只檢查版本字串；不探測宿主、不存取憑證，也不代表最低版已實跑。
export function requireCmcpNodeVersion(nodeVersion=process.versions.node){
  const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(nodeVersion??'');
  const parts=match?.slice(1).map(Number);
  if(!parts||!parts.every(Number.isSafeInteger)||parts[0]<22||parts[0]===22&&parts[1]<16)throw Error('node_22_16_or_newer_required');
  return {node:nodeVersion,minimumNode:CMCP_MINIMUM_NODE_VERSION,nodeSupported:true};
}
