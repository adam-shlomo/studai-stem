# Document contract

The CLI is `scripts/studai.mjs`, relative to the installed skill. It accepts UTF-8 JSON,
never executable expressions, raw HTML, SVG strings, or arbitrary JavaScript. Use `list`
and `example NAME --out FILE` to copy a complete working document.

## Envelope

```json
{
  "version": 1,
  "title": "A tangent at x = 1",
  "description": "Compare x² with its local linear model.",
  "course": "Calculus I",
  "assumptions": ["Real x; tangent at x = 1."],
  "diagrams": [
    {
      "id": "curve",
      "caption": "The curves meet at (1, 1) with slope 2.",
      "spec": {
        "v": 1,
        "kind": "function-compare",
        "title": "Parabola and tangent",
        "x": { "var": "x", "min": -1, "max": 3, "label": "x" },
        "curves": [
          { "expr": "x^2", "label": "f" },
          { "expr": "2*x-1", "label": "tangent" }
        ]
      }
    }
  ],
  "checks": [
    {
      "id": "tangent_slope",
      "diagram": "curve",
      "kind": "derivative",
      "label": "Slope at x = 1",
      "curve": 0,
      "at": 1,
      "expected": 2,
      "tolerance": 0.000001
    }
  ]
}
```

`language` optionally selects `en` or `he`. Sources are optional objects with `title`
and an HTTP(S) `url`. Do not invent citations. Captions must fully explain each diagram
and its units or refer to explicit document assumptions.

`checks: []` is allowed for a schematic; its status is `unchecked`. Every check names the
actual diagram it evaluates. A diagram without assertions is listed separately even if
another diagram passes. Reports are bound to the input JSON by a SHA-256 digest.
Interactive controls change the picture; the saved report describes initial values.

## Strict schemas

Get the exact field schema with:

```sh
node "<skill>/scripts/studai.mjs" schema geometry2d
node "<skill>/scripts/studai.mjs" schema surface3d
```

`schema` without a kind prints the document envelope. The emitted JSON Schema describes
structure; the validator also enforces semantic rules such as graph references and
increasing ranges. Unknown keys and excess array elements are errors, not silently
removed data. The original application's aliases are intentionally not accepted here.

## Expressions and axes

Supported: finite numbers (including scientific notation), named variables, `pi`, `e`,
`+ - * / ^`, parentheses and these functions:

`exp ln log sin cos tan sqrt cbrt abs asin acos atan sinh cosh tanh min max pow atan2`.

`ln` is natural log; `log` is base 10. Trig functions use radians. Multiplication must be
explicit: `2*x`, not `2x`. Powers associate right: `2^3^2 = 512`; `-2^2 = -4`.
No implicit multiplication, LaTeX syntax, comparisons, conditional expressions, units in
formulas, indexing, property access, or user-defined functions. For piecewise formulas,
split into explicitly bounded curves or use scientific code. Never invoke `eval` or
SymPy's string parser on untrusted text.

The historical `parametric-plot` name means y=f(x, parameters), not a parametric plane
curve. For x(t), y(t), use a `geometry2d` `parametric` item. Real 3D parametric surfaces
use `surface3d` with `x`, `y`, `z`, `uRange`, and `vRange`.

Plot parameters require `var`, `min`, `max`, `default`, and `step`. The axis variable and
parameters must be distinct; `pi` and `e` cannot be reassigned. Parameter checks evaluate
initial values unless `at` specifies another declared value.

## Choosing a diagram kind

| Kind                               | Intended use                                                 | Capacity / limitation                                     |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| parametric-plot / function-compare | Real function curves, parameters, shaded intervals           | 3 curves, 4 parameters; numerical sampling                |
| geometry2d                         | Equal-scale coordinate geometry, vectors, mechanics          | 24 primitives; circles retain their aspect ratio          |
| surface3d                          | Explicit or parametric 3D surfaces, typed integration region | 3 surfaces; offline SVG mesh, orthographic projection     |
| slope-field                        | dy/dx = f(x,y)                                               | Direction field only; use ODE recipe for trajectories     |
| transform2d                        | 2×2 linear maps, basis, eigenvectors, unit circle            | Entries in [−50,50]; initial view is the final map        |
| graph                              | Directed/undirected weighted networks                        | 16 nodes, 30 edges; no self-loops or parallel edges       |
| tree                               | Ordered hierarchy or forest                                  | 24 nodes; no cycles; not a precise binary-tree slot model |
| diagram                            | Hand-positioned signal/block/flow diagrams                   | 14 nodes, 24 edges; positions are schematic               |
| circuit                            | Grid-based analog circuit symbols                            | 24 parts; no solver; shared endpoint topology             |
| logic-circuit                      | Combinational Boolean DAG                                    | 4 inputs, 14 gates, 3 outputs; exhaustive truth table     |
| distribution                       | Normal, t, χ², exponential, uniform densities                | Explicit parameters; finite plot range truncates tails    |
| chart                              | Discrete bars, lines, pies, scatter data                     | 12 categories; 4 series; 60 scatter points per series     |
| table                              | Matrices and supplied tabular values                         | 12 rows, 8 columns; supplied cells are not executed       |
| numberline                         | Finite intervals, endpoint inclusion                         | 12 points, 6 intervals; no implicit infinite endpoints    |
| venn                               | Two or three sets                                            | Areas do not encode cardinalities                         |
| timeline                           | Ordered event sequence                                       | 10 events; equal spacing does not encode duration         |
| memory-sim                         | Authored stack/heap teaching trace                           | 12 steps; inert code text, not a language runtime         |
| bracket-sim                        | Executed bracket-stack walkthrough                           | 60 input characters; fixed algorithm                      |

Most in-diagram labels have a 24-character limit; circuit labels allow 20. Put detailed
notation in the caption, or use the scientific route for long typeset formulas. Do not
truncate a symbol, edge, unit or distinction that carries meaning.

For 2D mechanics, `angle` and `incline.angle` use degrees; polar `sector.theta1/theta2`
and parametric trig functions use radians. Analog circuit coordinates are integers with
y increasing downward. Polarized parts point toward `to`; use `flip` to reverse.
Connect through matching endpoints. Split wires at intended T-junctions; a crossing
without shared terminals is not a connection. The circuit renderer is not SPICE.

## Mathematical check types

All comparisons use an explicit absolute tolerance, default 1e-6. Choose it from units,
scale and numerical error; do not enlarge it merely to hide a failure.

| Kind            | Fields beyond id, diagram, label, tolerance                                                    |
| --------------- | ---------------------------------------------------------------------------------------------- |
| value           | exactly one of curve/item/surface index where applicable; `at` variable map; `expected` number |
| integral        | `curve`, finite `from`, `to`, `expected`; proper integral within plotted range                 |
| derivative      | `curve`, `at` number, `expected`; central difference, not a proof of differentiability         |
| determinant     | `expected`; reads the actual 2×2 matrix                                                        |
| matrix-vector   | `vector: [x,y]`, `expected: [x,y]`; column-vector convention                                   |
| logic-table     | `expected: [[output bits], ...]`; rows ordered from all-zero inputs, first input MSB           |
| shortest-path   | `from`, `to`, `expectedDistance`, optional `expectedPath`; Dijkstra, nonnegative weights       |
| force-balance   | `items: [vector indices]`, `expected: [Fx,Fy]`; common drawing force scale required            |
| distance        | `items: [two point indices]`, `expected`; world-coordinate Euclidean distance                  |
| double-integral | `expected`; reads integrand minus lower surface over the displayed base domain                 |
| probability     | finite `from`, `to`, `expected`; integrates the displayed density                              |

Improper integrals, highly oscillatory expressions, nonsmooth derivative points and
ill-conditioned systems need a specialized method. Finite samples can miss narrow
features. Do not label those results proved by a passing check.

## Output bundle

`render INPUT --out NEW_DIRECTORY` writes `index.html`, one editable SVG per diagram,
`source.json` and `verification.json`. It refuses existing directories and failed checks.
The HTML contains its own JavaScript/CSS and initial figures; it opens from disk, with
no server or CDN. Initial figures remain visible with JavaScript disabled.
Use the browser's Print / save PDF for a document export. SVG exports describe initial
values; the JSON remains the source for revisions and rerendering.
