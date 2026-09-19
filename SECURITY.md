# Security and responsible reporting

CMCP processes authorized conversation sources and can invoke a configured model or delivery channel. Source text, retrieved content and model output are data, not new execution authorization.

## Report safely

Do not disclose credentials, private conversations, unredacted installation paths or exploit details in a public issue. Where this repository has GitHub private vulnerability reporting enabled, use its Security reporting flow. Otherwise use a private contact channel explicitly published by the maintainer on the [redwakame profile](https://github.com/redwakame). No private-reporting service or response-time guarantee is claimed by this file.

For non-sensitive defects, use a synthetic minimal reproduction. Report the exact release/commit, environment, affected control boundary and impact. Do not prove a vulnerability by accessing another person's data.

## Operational boundaries

Review project hooks before trusting them. Use a scoped, writable project and normal permissions; administrator or sandbox bypass is not a default requirement. Only one writer should own a data root at a time.

Configured model access requires separate credentials and finite authorization. A setup run or restart does not create paid quota. Keep local data, grants, credentials and logs out of Git.

Guarded source reads do not prove model interpretation is correct. OFF, Clean, stopping new body saving, clearing Buffer, revoking a ticket and deleting History are different operations. Complete History-deletion governance is not implemented in this RC.

This is a release candidate, not an audited isolation boundary or a promise that arbitrary host/plugin code is safe. See [privacy](docs/privacy.md), [host constraints](docs/installation-and-hosts.md) and [verification](docs/verification.md).
