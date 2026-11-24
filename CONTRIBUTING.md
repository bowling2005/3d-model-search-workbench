# Contributing

## Development

```powershell
git submodule update --init --recursive
npm install
npm run setup:discovery
npm run typecheck
npm test
npm run build
```

## Pull Requests

- Keep changes focused.
- Add tests for source parsing, downloads, migrations, or pipeline behavior.
- Do not commit downloaded assets, databases, credentials, cookies, API keys, or personal paths.
- Do not add automation that bypasses login, CAPTCHA, paywalls, quotas, DRM, or access controls.
- New source adapters must document their license and rate limits.

## Commit Messages

Use concise imperative messages:

```text
Add source candidate probing
Fix Unity import result handling
Update Blender inspection metrics
```

## Security

Do not open public issues for credential or session vulnerabilities. Follow
[SECURITY.md](SECURITY.md).
