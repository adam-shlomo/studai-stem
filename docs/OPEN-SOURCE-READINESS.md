# Open-source release audit

Release: v0.1.1, 5 September 2026. Studai STEM is distributed under MIT, including the
portable skill ZIP. The original Studai application remains private and unchanged.

## Publication boundaries

Only selected visualization source, tests, authored examples, documentation and bundled
runtime dependencies are distributed. Account code, credentials, environment files,
private course materials, provider integrations, databases and operational records are
excluded. Public commit metadata uses the owner's GitHub no-reply address. The original
private preview is retained privately rather than exposing its earlier author metadata.

## Checks

- Gitleaks 8.30.1: no secrets detected in the inspected Git history or release archives.
  Scans use full redaction and cover all published branches/tags, plus extracted ZIPs.
- Tracked-file inspection: no local machine paths or private operational references.
  Credential-related references were reviewed; the native renderer requires no API key.
- npm audit: no known vulnerabilities reported for the resolved dependency tree at
  release preparation. Dependency advisories can change after publication.
- 275 tests pass, including offline browser rendering, hostile strings, restricted
  expressions, output preservation and portable installation.
- The MIT license ships both at repository root and inside the installed skill.
  Bundled dependency licenses are retained; a missing dependency license now fails the
  build instead of being silently omitted.
- CI scans complete Git history for secrets, checks release contents, audits npm
  dependencies and rebuilds/tests the runtime. Actions use pinned commits, read-only
  repository permissions and checkout without persisted credentials.

Generated figures retain the user's supplied model and source JSON. Users must review
those files before sharing their own outputs. The coding-agent host has its own data
handling; the skill's offline renderer does not establish that the host is offline.

## Reproduce the secret checks

Install Gitleaks 8.30.1 from its official project, then run:

```sh
gitleaks git . --log-opts="--all" --redact=100
npm run check:release
npm audit
```

Extract the release ZIP into a fresh temporary directory and scan that directory with
`gitleaks dir PATH --redact=100`. Compare the downloaded ZIP against its published
SHA-256 checksum. Never print or upload an unredacted finding.

These are release checks with a recorded scope, not a certification that every possible
secret or vulnerability is absent. Report issues through [SECURITY.md](../SECURITY.md).
