# Security Policy

## Sensitive data

Do not commit API keys, access tokens, cookies, local databases, generated media, or exported account authorization files. Rainbow AI stores runtime credentials outside the repository and encrypts supported secrets with Electron `safeStorage` on Windows.

If a secret is committed accidentally, revoke it at the provider immediately and remove it from the complete Git history before publishing the repository.

## Reporting a vulnerability

Please report security issues privately to the repository owner. Include the affected component, reproduction steps, potential impact, and any suggested mitigation. Avoid opening a public issue for vulnerabilities that could expose credentials or execute local commands.

## Agent permissions

PI Agent can read or modify files and execute terminal commands when Agent mode is enabled. Use the **Ask for approval** or **Smart approval** permission level for untrusted prompts and review every proposed external or terminal operation.
