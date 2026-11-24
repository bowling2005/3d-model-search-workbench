# Security Policy

## Supported Versions

The latest `0.1.x` development line receives security fixes.

## Reporting

Do not include passwords, cookies, API keys, access tokens, or private source
data in a public issue. Report sensitive issues privately to the repository
owner through GitHub's private vulnerability reporting if enabled.

## Local Credential Model

- Credentials are encrypted with Electron `safeStorage`.
- SQLite contains encrypted secrets and non-sensitive profile metadata.
- Site sessions use isolated persistent Electron partitions.
- Logs should never contain credentials or full session values.

## Scope

The project does not bypass login, CAPTCHA, paywalls, region controls, download
quotas, DRM, or other access restrictions.
