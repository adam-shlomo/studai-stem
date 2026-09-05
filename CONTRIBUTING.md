# Contributing

Use an issue to describe a bug or propose a course example. Include a small, shareable
problem with independently derived expected results. Use the private route in
[SECURITY.md](SECURITY.md) for vulnerabilities.

## Development

Use Node.js 22+ and Python 3.11+ with uv for scientific recipes.

```sh
npm ci
npx playwright install chromium
npm run build
npm test
npm run gallery
npm run check:release
```

Edit renderer code in `src/`, then rebuild the bundled runtime. The installed skill must
continue to work without node_modules or a network connection. When adding a kind or
changing its contract, update the schema, references, examples and affected checks.

Derive expected values independently. Inspect the actual output, including relevant
control settings, SVG exports and mobile layout. Explain whether the figure is schematic
or scaled, its assumptions and what was checked. Add a regression for a meaningful bug;
a passing parser test alone does not establish that a picture is correct.

## Pull requests

Describe the problem, resulting behavior and checks you ran. Include a small screenshot
when the rendering changes. Do not include credentials, environment files, private
coursework, exams you cannot redistribute, generated output folders or node_modules.
Contributions must be yours to share and are submitted under this project's MIT License.
Keep discussions specific, respectful and focused on improving the work.

## Release

Update package and skill versions together. Keep the MIT license and dependency notices
inside the portable skill. Run `npm run build` and verify the committed runtime matches.
CI must pass before tagging a release. Generate the ZIP from the committed skill directory,
scan the full history and extracted ZIP, and publish a SHA-256 checksum alongside it.
The repository's `private` package flag prevents accidental npm publication; installation
uses the repository installer or release ZIP.
