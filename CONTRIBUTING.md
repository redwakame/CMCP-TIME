# Contributing to CMCP-TIME

Thank you for helping improve time-aware, source-grounded continuity. The original author and maintainer is **redwakame**. Public discussion, independent testing and collaboration are welcome.

## Start with an observable problem

Use a minimal synthetic conversation. Include the candidate version, OS, Node/host versions, enabled controls, expected behavior and actual behavior. Separate source storage, catalog registration, reading, model input, model output and state/delivery results. A model's confident wording alone is not proof of a stored fact.

Do not upload personal History, access tokens, encrypted credentials, raw development transcripts, full local configuration or complete runtime roots. Screenshots and stack traces can expose usernames and paths. See [privacy](docs/privacy.md) and [security](SECURITY.md).

## Before changing behavior

Preserve original role, time and version. Keep summaries distinct from originals, Buffer expiry distinct from deletion, and Pin completion distinct from sending. A change to these meanings should be discussed before implementation. Ordinary implementation details and focused refactors are open to improvement.

Use existing readers and lifecycle controls rather than creating a competing memory store. Do not hard-code demonstration answers or domain-specific trigger lists to pass a test. Keep unknown and incomplete coverage visible.

## Validate the changed scope

Run `npm run check` after updating the package/file inventory. Run the relevant supplied reading, setup or dispatch suite. The suites use synthetic sources and model substitutes; they do not establish a new live-model success. Keep test artifacts out of a commit. The known timing-sensitive dispatch test is described in [verification](docs/verification.md).

Document what you changed and which checks you ran. Preserve failed evidence locally when useful; share a sanitized minimal reproduction. Do not add external model calls, accounts or paid budgets as an incidental test prerequisite.

## Code and documentation

Use English for product-facing defaults, retaining explicit user/host language preferences. Keep English, Traditional Chinese, Spanish and Japanese introduction pages aligned when user-visible behavior changes. Detailed technical documents are currently maintained mainly in English, with a Traditional Chinese operating guide.

Keep existing notices and identify inherited material correctly. Only contribute material you have the right to contribute. The repository's license and notices govern distribution; this guide does not impose a new contributor license agreement or mandatory advertising rule.
