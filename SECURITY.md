# Security

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository if it is enabled: [report a vulnerability](https://github.com/matusaelhorch/OnunSpace/security/advisories/new). If that option is unavailable, contact the repository maintainer to arrange private disclosure. Do not put credentials, personal project data, or an exploitable proof of concept in a public issue.

Include the affected revision, operating system, reproduction steps, impact, and any proposed fix. Security fixes target the current codebase; there is no separate long-term-support release policy.

## Local runtime boundary

The standalone API is intended for one user on their own computer and binds to loopback. It has origin and request checks, but it is not a multi-user authenticated service. Do not expose port 4318 directly to the internet or an untrusted network.

Provider credentials stored through the local UI are plaintext in the configured data directory, protected by owner-only permissions where the operating system supports them. Project exports omit credentials. Protect the account and device that hold this data; deleting a stored key does not remove a separate environment-provided key.

MCP clients can modify projects and start provider requests or local renders. Connect only clients you trust, and review their permission settings. Provider generation can incur charges on your account.

Custom scene code runs in an isolated browser preview/render context with restricted network access. That is not an operating-system sandbox for arbitrary hostile code, resource exhaustion, or every browser vulnerability. Use trusted scene code and keep dependencies current.

The hosted Onun platform has separate account and storage services. This repository's local security model does not describe those services.
