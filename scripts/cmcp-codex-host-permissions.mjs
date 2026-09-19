/** Pass one TOML value to -c; quoted path keys must not become dotted CLI override paths. */
export function codexHostPermissionsOverride(grants){
  const q=s=>JSON.stringify(s.replaceAll('\\','/'));
  return 'permissions={cmcp_host_trial={network={enabled=true},filesystem={'+grants.map(([p,a])=>q(p)+'='+JSON.stringify(a)).join(',')+'}}}';
}
