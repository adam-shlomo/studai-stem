# Validation record

Version 0.1.0, tested on 5 September 2026. These results describe the shipped examples
and tested behaviors. They are not a universal skill score or a guarantee for a new problem.

## Automated evidence

| Check                    | Result         | Scope                                                                                                                                                                                                 |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node test suite          | 275/275 passed | Parser, strict schemas, numerical methods, upstream regressions, CLI, installation and browser behavior                                                                                               |
| Native example models    | 45/45 rendered | 47 figures across all 19 native diagram kinds; 56 supplied mathematical assertions passed                                                                                                             |
| Offline browser examples | 45/45 passed   | No page errors or network requests; finite SVG geometry; valid standalone SVG XML; no whole-page horizontal overflow at 390 px                                                                        |
| Browser behavior         | 9/9 passed     | Parameter updates, keyboard logic controls, 18 3D camera settings, static markup without JavaScript, hostile strings, Hebrew hydration, polar arc geometry, acute incline angle and projectile labels |
| Scientific recipes       | 6/6 rendered   | SVG, PDF, PNG, source and reports; 20/20 assertions passed                                                                                                                                            |
| Skill structure          | Passed         | Skill-creator validator accepts the canonical SKILL.md                                                                                                                                                |
| Portable installation    | Passed         | Both host directory layouts installed in a fresh temporary project; copied skill rendered outside the development tree without node_modules                                                           |
| Legacy gallery migration | Passed         | 49 canonical specimens accepted; six legacy shorthand forms rejected explicitly                                                                                                                       |

The 275-test total includes the browser and example checks above; the rows are not
additive. The original engine contributes 102 regression tests. The scientific recipes
run separately from the Node suite.

The tests cover malicious expressions and prototype names, oversized JSON, invalid
parameters, missing graph endpoints, cyclic logic, zero-length geometry, incompatible
checks, failed-assertion output refusal, path traversal, existing-file preservation,
source retention and script injection. They do not constitute a general security audit.

## Independent agent trials

A separate agent read the installed skill and authored two unfamiliar problems without
using the implementation as its specification:

- **Integration:** show the domain and solid for ∫₀² ∫₀ˣ x² dy dx. The independently
  derived answer is 4. The final renderer computed 3.9999999999999916 at the original
  absolute tolerance of 10⁻⁶. An earlier midpoint method missed that tolerance; it was
  replaced with adaptive tensor Simpson quadrature, not a looser expected value.
- **Half adder:** construct XOR and AND outputs from inputs A and B. All four truth-table
  rows, mouse states, keyboard input controls and keyboard table rows matched S = A ⊕ B
  and C = A ∧ B. Distinct input signals have distinct routing rails; only shared signals
  have junction dots. Final inspection found no overlapping labels or browser errors.

The agent also inspected the integration figure at desktop and mobile sizes and checked
18 rotation/elevation combinations. Corrections from these trials included 3D framing,
React hydration, nested color opacity, logic wiring and label spacing.

## Visual review

All 45 native example previews were inspected in a five-sheet contact atlas. All six
scientific figures were inspected individually. The original polar-sector sweep and
left-facing incline angle were wrong despite structurally valid input; both were fixed.
Browser regressions now measure the rendered annular boundary and area, and the rendered
incline arc length. Projectile labels were separated and checked at launch, midpoint and
landing. Selected README images are actual rendered output.

This review covers the supplied layouts. Arbitrary combinations of objects, labels,
parameter extremes, complex surfaces and course-specific notation still need inspection.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run build
npm test
npm run gallery
mkdir -p outputs/scientific
for recipe in symbolic bode dipole ode fft dc-circuit; do
  uv run --locked --script skills/studai-stem/scripts/scientific.py "$recipe" --out "outputs/scientific/$recipe"
done
```

Use new output directories if a recipe has already run. CI runs the same checks on
Ubuntu with Node.js 22 and verifies that the committed runtime matches its source.
Local validation used macOS ARM64, Node.js 24.2.0 and Playwright Chromium. Python
reports retain the resolved library versions; the uv lockfile pins the environments.

Claude Code and Codex installation paths and invocation syntax were checked against
current official documentation. Installation and runtime portability were tested;
automatic skill selection was not measured in a live session of both hosts. No claim is
made about model-dependent skill selection or success rates on unseen course problems.

## Remaining boundaries

Numerical error estimates are heuristic. Narrow features, singularities, ill-conditioned
models and misleading source interpretation require further analysis. Assertions only
cover their named quantities, and interactive reports remain scoped to initial values.
The native 3D mesh uses approximate visibility ordering. General circuit solving, large
matrices, PDE solvers and complex branch choices need suitable scientific code. Native
SVG text is plain text; publication math typography needs a typesetting workflow.

The original source application remains private. Studai STEM is released separately
under MIT; see the [open-source readiness audit](OPEN-SOURCE-READINESS.md).
