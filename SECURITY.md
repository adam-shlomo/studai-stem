# Security

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/adam-shlomo/studai-stem/security/advisories/new).
Please include the affected version, a minimal reproduction with invented data, expected
behavior and observed impact. Never post API keys, credentials or private coursework in
an issue, pull request, screenshot or illustration.

## Scope

The latest release is the supported version. Reports about expression parsing, HTML/SVG
injection, unsafe paths, installation, bundled dependencies or the skill workflow are
welcome. There is no paid support or guaranteed response time.

The native renderer requires no API keys, makes no service calls and includes no
telemetry. The coding agent that invokes the skill has its own permissions and data
handling; this project does not control that host. Installing development dependencies
or using uv for the first time can contact package registries.

JSON expressions use a restricted arithmetic parser. Python recipes are executable code:
review code from other people before running it. The renderer is not an operating-system
sandbox. Mathematical assertions and secret scanners have limited scope; they cannot
establish universal correctness or the absence of every vulnerability.

## Maintainer checks

Run the test suite, `npm run check:release`, `npm audit` and Gitleaks against the complete
history and an extracted release archive before publishing. CI scans all fetched history
with redacted output and read-only repository permissions. If a real credential is found,
revoke it first, then clean affected history and artifacts before distribution.
