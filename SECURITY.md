# Security policy

## Supported versions

Security fixes go into the latest release. This project follows semantic
versioning; upgrade within the same major version to get fixes.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them
privately through GitHub:
[Report a vulnerability](https://github.com/jianan1104/linepay-v4/security/advisories/new)
(Security → Advisories → Report a vulnerability).

Include what you found, how to reproduce it, and the impact you see. You'll
get an acknowledgement within a few days, and a fix or a plan once it's
understood. Please give us a reasonable time to release a fix before
disclosing it.

## Handling credentials

- The channel secret signs every request: keep it on your server only —
  never in a browser, LIFF page or mobile app bundle.
- Never paste channel secrets, real transaction IDs or customer data into
  issues, pull requests or logs.
- Sandbox credentials for this repo's live tests belong in `.env.sandbox`
  (git-ignored) locally, and in repository secrets on GitHub.
