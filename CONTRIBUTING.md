# Contributing

Thanks for helping! Bug reports, fixes and improvements are welcome.

## Development

Requires Node.js 22.12+ for the tooling (the published package itself supports Node 20+).

```sh
git clone https://github.com/jianan1104/linepay-v4.git
cd linepay-v4
npm ci
npm test              # unit tests (mocked fetch, no network)
npm run coverage      # unit tests + coverage thresholds: 100% lines/functions/statements, 95% branches
npm run typecheck
npm run build         # ESM + CJS + type declarations into dist/
npm run lint:package  # publint + "are the types wrong" on the packed package
```

### Testing against the LINE Pay sandbox

The live tests are skipped unless sandbox credentials are set. See
[README → Testing against the LINE Pay sandbox](README.md#testing-against-the-line-pay-sandbox):
copy `.env.example` to `.env.sandbox`, then `npm run test:sandbox`, and
`npm run build && npm run sandbox:flow` for a payment you approve by hand.
If your change depends on how LINE Pay really answers, add or adjust a case
in `tests/sandbox.test.ts`.

## Pull requests

- One topic per pull request, with tests for the change.
- Keep the package dependency-free at runtime.
- Add an entry under **Unreleased** in `CHANGELOG.md`.
- Commit messages: imperative mood, say what changes and why ("Keep refund ids as strings").
- Never commit credentials, real transaction IDs or customer data.

CI runs type checks, unit tests with coverage thresholds on Node 22 and 24
(and Windows), package checks, a Node 20 load test, and CodeQL.

## Releasing (maintainers)

Releases are published by GitHub Actions (`.github/workflows/release.yml`)
when a version tag is pushed.

1. Move the **Unreleased** entries in `CHANGELOG.md` under a new
   `## [x.y.z] - YYYY-MM-DD` heading, and update the links at the bottom.
2. Bump the version and tag it:
   ```sh
   npm version patch   # or minor / major — updates package.json and creates tag vX.Y.Z
   git push --follow-tags
   ```
3. The workflow checks the tag matches `package.json` and has a CHANGELOG
   entry, runs every check (and the sandbox tests when the secrets are set),
   then publishes `linepay-v4` to npm with provenance and
   `@jianan1104/linepay-v4` to GitHub Packages, and creates the GitHub
   Release (notes from the CHANGELOG entry, tarball and SHA-256 attached).
   A version with a hyphen (`npm version prerelease --preid beta`) goes out
   under the `next` dist-tag as a pre-release.

### One-time setup

- **First release:** npm Trusted Publishing can only be configured for a
  package that exists, so publish 0.1.0 by hand: `npm login`, then
  `npm publish` (the `prepublishOnly` script runs every check first).
- **Trusted Publishing:** on npmjs.com → the package → *Settings* →
  *Trusted Publisher* → GitHub Actions: owner `jianan1104`, repository
  `linepay-v4`, workflow `release.yml`, environment `npm`. From then on the
  workflow publishes with OIDC — no npm token is stored in GitHub. Afterwards,
  in the same settings, choose to *require two-factor authentication and
  disallow tokens* for publishing.
- **GitHub Packages:** nothing to set up — the workflow publishes with the
  built-in `GITHUB_TOKEN`. After the first release, the package appears under
  the repository's *Packages*; make it public in its settings if it isn't.
- **GitHub environment `npm`:** *Settings → Environments → New environment* →
  `npm`; add yourself under *Required reviewers* to approve each publish.
- **Sandbox secrets (optional):** *Settings → Secrets and variables →
  Actions*: `LINEPAY_CHANNEL_ID`, `LINEPAY_CHANNEL_SECRET` (sandbox
  credentials) to run the live tests on `main`, weekly, and before releases.
- **Private vulnerability reporting:** *Settings → Security → Private
  vulnerability reporting → Enable* (see SECURITY.md).
