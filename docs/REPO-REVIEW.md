# Studai extraction review

Source: `adam-shlomo/studai`, commit `a00925cdf09a1eb89bf238edcbdcf5475d4f6b05`.
The source was inspected from a fresh shallow clone. The original repository was not
modified. It was private and reported no license metadata.

## Reused

| Source                  | Why it matters                                                                      | Changes in the new product                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| src/viz-spec.js         | Restricted expression parser, numerical helpers and 19 diagram normalizers          | Parser length/token limits; prototype-safe function lookup; adaptive discontinuity sampling; strict validation wraps the original normalizers |
| src/VizWidget.jsx       | Interactive SVG diagrams, geometry, circuits, graph layouts and teaching simulators | Standalone styling/localization; offline 3D renderer; no default animation; vector tables/stack figures; clipped plot strokes                 |
| tests/viz-spec.test.mjs | 102 existing engine tests                                                           | Preserved as upstream regression tests, supplemented by strict validation, numerical and product tests                                        |
| src/viz-gallery.jsx     | Representative raw diagram fixtures                                                 | Extracted into test fixtures to preserve examples of the source format                                                                        |

The server's visual routing prompts and figure contracts were inspected for intent and
schema behavior. Their useful principles were rewritten as concise course guidance and
the skill workflow; provider-specific prompting and routing code were not imported.

## Findings that changed the product

The original normalizers were designed for a chat UI that could degrade gracefully.
They could remove a malformed graph edge, replace an invalid matrix entry, default an
invalid distribution parameter, or remove an invalid lower integration surface. Those
choices can change a STEM problem while leaving a plausible figure. The new public
entry point rejects such input instead of presenting a partial figure.

The original surface renderer fetched Plotly from a CDN. It was replaced with an offline
SVG mesh so figures can be shared as self-contained documents. This introduces explicit
mesh/projection limitations; advanced geometry can use the scientific route.

The original browser controls and account-local styling depended on the study app.
The new bundle supplies its own concrete colors, reusable code, initial static markup,
editable JSON and scoped check reports. App-specific save-to-practice flows are not used.

## Excluded

No account, auth, billing, database, session, environment, upload, OCR, private course
material, exam fixture, scraping or provider-credential data was copied. No source
application deployment or configuration was changed. Source copies were selected from
allowlisted code and test files, with per-file provenance hashes recorded.

## Accuracy boundary

The original 102 tests passing established useful regression evidence. They did not
establish universal mathematical accuracy, skill quality or correctness of every rendered
output. The new product therefore measures separate structural, mathematical, security,
portability and visual outcomes, and reports their limits instead of assigning itself a
universal 100/100 score.
