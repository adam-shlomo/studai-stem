import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { parseExpr, evalExpr, sampleCurve } from "../src/viz-spec.js";
import { strictSpec, validateDocument, specSchemas } from "../src/schema.js";
import {
  integrate,
  differentiate,
  shortestPath,
  doubleIntegral,
  logicTable,
  verify,
} from "../src/numerics.js";
import { alpha } from "../src/theme.js";
const plot = {
  v: 1,
  kind: "parametric-plot",
  x: { var: "x", min: -2, max: 2 },
  curves: [{ expr: "x^2" }],
};
const graph = {
  v: 1,
  kind: "graph",
  nodes: [
    { id: "A", label: "A" },
    { id: "B", label: "B" },
  ],
  edges: [{ from: "A", to: "B", weight: 2 }],
};
const logic = {
  v: 1,
  kind: "logic-circuit",
  inputs: [{ id: "A" }, { id: "B" }],
  gates: [{ id: "g", type: "xor", inputs: ["A", "B"] }],
  outputs: [{ from: "g" }],
};
const wrap = (spec, checks = []) => ({
  version: 1,
  title: "Test",
  course: "Test",
  description: "Known model",
  assumptions: [],
  diagrams: [{ id: "d", caption: "Test diagram", spec }],
  checks: checks.map((c, i) => ({
    id: `c${i}`,
    diagram: "d",
    label: "Test assertion",
    ...c,
  })),
});
for (const [expr, expected] of [
  ["-2^2", -4],
  ["2^-2", 0.25],
  ["2^3^2", 512],
  ["ln(e)", 1],
  ["log(100)", 2],
  ["sin(pi/2)", 1],
])
  test(`Math convention ${expr}`, () =>
    assert.ok(Math.abs(evalExpr(parseExpr(expr)) - expected) < 1e-12));
for (const expr of [
  "globalThis.process.exit()",
  "constructor(x)",
  "__proto__",
  "x[0]",
  "x=1",
  "Math.sin(x)",
  "2x",
  ";fetch(1)",
  "+".repeat(401) + "1",
  "(".repeat(600) + "1" + ")".repeat(600),
])
  test(`Reject expression ${expr.slice(0, 30)}`, () =>
    assert.throws(() => parseExpr(expr, ["x"])));
test("Nested alpha resolves without losing previous opacity", () =>
  assert.equal(alpha(alpha("#526078", 0.42), 0.18), "#52607813"));
test("Strict version check applies even to legacy branches that discard errors", () =>
  assert.throws(() => strictSpec({ ...graph, v: 2 })));
test("Unknown keys fail instead of disappearing", () =>
  assert.throws(() => strictSpec({ ...plot, colour: "red" })));
test("An omitted edge is an error, not a partial graph", () =>
  assert.throws(() =>
    strictSpec({
      ...graph,
      edges: [...graph.edges, { from: "A", to: "missing" }],
    }),
  ));
test("Duplicate IDs fail", () =>
  assert.throws(() =>
    strictSpec({ ...graph, nodes: [...graph.nodes, { id: "A", label: "A" }] }),
  ));
test("Parallel edges fail", () =>
  assert.throws(() =>
    strictSpec({ ...graph, edges: [...graph.edges, ...graph.edges] }),
  ));
test("Self loop requires another route", () =>
  assert.throws(() =>
    strictSpec({ ...graph, edges: [{ from: "A", to: "A" }] }),
  ));
test("Excess nodes are not truncated", () =>
  assert.throws(() =>
    strictSpec({
      ...graph,
      nodes: Array.from({ length: 17 }, (_, i) => ({
        id: `n${i}`,
        label: `${i}`,
      })),
    }),
  ));
test("Non-numeric matrix entry is never identity", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "transform2d",
      matrix: [
        [1, "bad"],
        [0, 1],
      ],
    }),
  ));
test("Oversize matrix entry is never clamped", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "transform2d",
      matrix: [
        [100, 0],
        [0, 1],
      ],
    }),
  ));
test("Singular matrix remains singular", () =>
  assert.deepEqual(
    strictSpec({
      v: 1,
      kind: "transform2d",
      matrix: [
        [1, 0],
        [0, 0],
      ],
    }).matrix,
    [
      [1, 0],
      [0, 0],
    ],
  ));
test("Invalid sigma is not defaulted", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "distribution",
      dist: "normal",
      params: { mu: 0, sigma: -1 },
    }),
  ));
test("Distribution parameter family must match", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "distribution",
      dist: "t",
      params: { mu: 0, sigma: 1 },
    }),
  ));
test("Data mismatch is not padded with zeros", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "chart",
      chartType: "bar",
      labels: ["a", "b"],
      series: [{ data: [1] }],
    }),
  ));
test("Negative pie data fails", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "chart",
      chartType: "pie",
      labels: ["a", "b"],
      series: [{ data: [1, -2] }],
    }),
  ));
test("Ragged matrix table fails", () =>
  assert.throws(() =>
    strictSpec({ v: 1, kind: "table", rows: [["1", "2"], ["3"]] }),
  ));
test("Tree cycles fail", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "tree",
      nodes: [
        { id: "a", label: "a", parent: "b" },
        { id: "b", label: "b", parent: "a" },
      ],
    }),
  ));
test("Logic cycles fail rather than evaluate a back edge as false", () =>
  assert.throws(() =>
    strictSpec({
      ...logic,
      gates: [
        { id: "g", type: "not", inputs: ["h"] },
        { id: "h", type: "not", inputs: ["g"] },
      ],
    }),
  ));
test("Logic arity is exact", () =>
  assert.throws(() =>
    strictSpec({
      ...logic,
      gates: [{ id: "g", type: "not", inputs: ["A", "B"] }],
    }),
  ));
test("Boolean false is numeric 0, never string coercion", () =>
  assert.throws(() =>
    strictSpec({
      ...logic,
      inputs: [{ id: "A", value: "false" }, { id: "B" }],
    }),
  ));
test("Invalid geometry item fails the whole document", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "geometry2d",
      xRange: [-2, 2],
      yRange: [-2, 2],
      items: [
        { type: "point", x: 0, y: 0 },
        { type: "circle", cx: 0, cy: 0, r: -1 },
      ],
    }),
  ));
test("Bad lower surface never becomes z=0", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "surface3d",
      xRange: [0, 1],
      yRange: [0, 1],
      surfaces: [{ expr: "2" }],
      region: {
        base: { type: "rect", x: [0, 1], y: [0, 1] },
        lower: "nope(x)",
      },
    }),
  ));
test("Circuit diagonal cannot vanish silently", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "circuit",
      components: [{ type: "resistor", at: [0, 0], to: [1, 1] }],
    }),
  ));
test("Missing required circuit endpoint fails", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "circuit",
      components: [{ type: "resistor", at: [0, 0] }],
    }),
  ));
test("Point outside numberline fails rather than moves", () =>
  assert.throws(() =>
    strictSpec({
      v: 1,
      kind: "numberline",
      min: 0,
      max: 1,
      points: [{ x: 2 }],
    }),
  ));
test("Repeated parameter is rejected", () =>
  assert.throws(() =>
    strictSpec({
      ...plot,
      params: [{ var: "x", min: 0, max: 1, default: 0.5, step: 0.1 }],
    }),
  ));
test("Unknown animation parameter fails", () =>
  assert.throws(() =>
    strictSpec({ ...plot, animate: { param: "t", period: 1, loop: "cycle" } }),
  ));
test("Quoted HTML remains inert data", () =>
  assert.equal(
    validateDocument({
      ...wrap(plot),
      title: "</script><script>alert(1)</script>",
    }).title,
    "</script><script>alert(1)</script>",
  ));
test("Unknown check types and fields fail", () =>
  assert.throws(() =>
    validateDocument(
      wrap(plot, [
        { kind: "value", curve: 0, at: { x: 1 }, expected: 1, execute: "evil" },
      ]),
    ),
  ));
test("Check target must exist", () =>
  assert.throws(() =>
    validateDocument({
      ...wrap(plot),
      checks: [
        {
          id: "c",
          diagram: "absent",
          label: "bad",
          kind: "value",
          curve: 0,
          at: { x: 0 },
          expected: 0,
        },
      ],
    }),
  ));
test("Incorrect expected values fail", () =>
  assert.equal(
    verify(
      validateDocument(
        wrap(plot, [{ kind: "value", curve: 0, at: { x: 2 }, expected: 5 }]),
      ),
    ).status,
    "failed",
  ));
test("No checks never means verified", () => {
  const r = verify(validateDocument(wrap(plot)));
  assert.equal(r.status, "unchecked");
  assert.deepEqual(r.uncheckedDiagrams, ["d"]);
});
test("Wrong variable cannot be ignored in an assertion", () =>
  assert.equal(
    verify(
      validateDocument(
        wrap(plot, [{ kind: "value", curve: 0, at: { t: 2 }, expected: 4 }]),
      ),
    ).status,
    "failed",
  ));
test("Ambiguous scalar reference fails", () =>
  assert.equal(
    verify(
      validateDocument(
        wrap(plot, [
          { kind: "value", curve: 0, item: 0, at: { x: 2 }, expected: 4 },
        ]),
      ),
    ).status,
    "failed",
  ));
test("Adaptive proper integral matches analytic x^4", () =>
  assert.ok(Math.abs(integrate((x) => x ** 4, 0, 2).value - 32 / 5) < 1e-8));
test("Improper endpoint integral fails finite calculator", () =>
  assert.throws(() => integrate((x) => 1 / x, 0, 1)));
test("Numerical derivative matches analytic exp", () =>
  assert.ok(
    Math.abs(differentiate(Math.exp, 0.4).value - Math.exp(0.4)) < 1e-8,
  ));
test("Dijkstra gives actual distance", () =>
  assert.deepEqual(shortestPath(strictSpec(graph), "A", "B"), {
    distance: 2,
    path: ["A", "B"],
    reachable: true,
  }));
test("Dijkstra rejects negative weights", () =>
  assert.throws(() =>
    shortestPath(
      strictSpec({ ...graph, edges: [{ from: "A", to: "B", weight: -1 }] }),
      "A",
      "B",
    ),
  ));
test("Directed graph does not invent reverse edges", () =>
  assert.deepEqual(
    shortestPath(strictSpec({ ...graph, directed: true }), "B", "A"),
    { distance: null, path: [], reachable: false },
  ));
test("Logic table computed exhaustively", () =>
  assert.deepEqual(logicTable(strictSpec(logic)), [[0], [1], [1], [0]]));
test("Offset pole produces a discontinuity gap", () => {
  const p = sampleCurve(parseExpr("1/(x-0.13)", ["x"]), "x", -2, 2);
  assert.ok(p.some((p) => p.y === null && Math.abs(p.x - 0.13) < 0.002));
});
test("Smooth parabola is not broken at zero", () =>
  assert.ok(
    sampleCurve(parseExpr("x^2", ["x"]), "x", -2, 2).every((p) => p.y !== null),
  ));
test("Polynomial triangular-domain integral meets default tolerance", () => {
  const s = strictSpec({
    v: 1,
    kind: "surface3d",
    xRange: [0, 2],
    yRange: [0, 2],
    surfaces: [{ expr: "x^2" }],
    region: { base: { type: "between", x: [0, 2], lower: "0", upper: "x" } },
  });
  assert.ok(Math.abs(doubleIntegral(s) - 4) < 1e-10);
});
const names = (await readdir("skills/studai-stem/assets/examples")).filter(
  (f) => f.endsWith(".json"),
);
const seen = new Set();
for (const name of names)
  test(`Example model and assertions: ${name}`, async () => {
    const input = JSON.parse(
        await readFile(`skills/studai-stem/assets/examples/${name}`, "utf8"),
      ),
      snapshot = JSON.stringify(input),
      doc = validateDocument(input),
      report = verify(doc);
    assert.notEqual(report.status, "failed", JSON.stringify(report));
    assert.equal(
      JSON.stringify(input),
      snapshot,
      "validation must not mutate source",
    );
    doc.diagrams.forEach((d) => seen.add(d.spec.kind));
  });
test("Every advertised native diagram kind has an example", () =>
  assert.deepEqual([...seen].sort(), Object.keys(specSchemas).sort()));

for (const scale of ["1e-8", "1e8"])
  test(`Pole sampling follows signal scale ${scale}`, () => {
    const points = sampleCurve(
      parseExpr(`${scale}/(x-0.13)`, ["x"]),
      "x",
      -2,
      2,
    );
    assert.ok(points.some((p) => p.y === null && Math.abs(p.x - 0.13) < 0.002));
  });

test("Upstream gallery migration accepts canonical forms and rejects six legacy shorthand forms", async () => {
  const { SAMPLES } = await import("./upstream-samples.js");
  const legacy = new Set([
    "parametric-plot — ANIMATED traveling wave (play/pause)",
    "tree — binary search tree",
    "geometry2d — integration region (disk D + axis, the tolerated shapes)",
    "surface3d — parametric sphere (aspect:data, no integrand)",
    "geometry2d — parametric curve (Lissajous)",
    "geometry2d — 2D ellipse region",
  ]);
  for (const sample of SAMPLES) {
    if (legacy.has(sample.name))
      assert.throws(() => strictSpec(sample.raw), sample.name);
    else
      assert.equal(strictSpec(sample.raw).kind, sample.raw.kind, sample.name);
  }
  assert.equal(SAMPLES.length - legacy.size, 49);
});
