import test from "node:test";
import assert from "node:assert/strict";
import {
  parseExpr,
  evalExpr,
  validateSpec,
  sampleCurve,
  distPdf,
  distRange,
  lgamma,
  graphLayout,
  eigen2x2,
  inRegion,
  regionBBox,
  regionBoundary,
  estimateDoubleIntegral,
  evalLogic,
  gateOutput,
  inclineVertices,
  inclineBlock,
  circuitJunctions,
} from "../src/viz-spec.js";

const ev = (src, scope = {}, vars = Object.keys(scope)) =>
  evalExpr(parseExpr(src, vars), scope);

test("eigen2x2: diagonal, symmetric, and a rotation (complex → real:false)", () => {
  const diag = eigen2x2([
    [2, 0],
    [0, 3],
  ]);
  assert.equal(diag.real, true);
  assert.deepEqual(
    diag.values.map((v) => Math.round(v)),
    [3, 2],
  ); // λ = 3, 2
  const rot = eigen2x2([
    [0, -1],
    [1, 0],
  ]); // 90° rotation
  assert.equal(rot.real, false); // no real eigenvectors
  const sym = eigen2x2([
    [2, 1],
    [1, 2],
  ]);
  assert.equal(sym.real, true);
  assert.deepEqual(
    sym.values.map((v) => Math.round(v)),
    [3, 1],
  );
  assert.ok(
    Math.abs(Math.abs(sym.vectors[0][0]) - Math.abs(sym.vectors[0][1])) < 1e-9,
  ); // λ=3 eigenvector along (1,1)
});

test("validateSpec: transform2d coerces the matrix, defaults toggles, fails soft on a singular map", () => {
  const ok = validateSpec({
    v: 1,
    kind: "transform2d",
    matrix: [
      [2, 1],
      [0, 1],
    ],
    show: { eigen: true },
    vectors: [{ x: 1, y: 1, label: "v" }],
    range: 99,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.spec.matrix, [
    [2, 1],
    [0, 1],
  ]);
  assert.equal(ok.spec.show.grid, true); // default on
  assert.equal(ok.spec.show.eigen, true);
  assert.equal(ok.spec.range, 12); // clamped
  assert.equal(ok.spec.vectors.length, 1);
  const fb = validateSpec({
    v: 1,
    kind: "transform2d",
    matrix: [["x", 5], [null]],
  }); // garbage entries → identity's
  assert.deepEqual(fb.spec.matrix, [
    [1, 5],
    [0, 1],
  ]);
  assert.equal(
    validateSpec({
      v: 1,
      kind: "transform2d",
      matrix: [
        [1, 1],
        [1, 1],
      ],
    }).ok,
    true,
  ); // singular still renders
});

test("graph validates nodes/edges, dedupes, drops dangling + self-loops, filters highlight", () => {
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "graph",
    title: "net",
    directed: false,
    nodes: [
      { id: "a", label: "A" },
      { id: "b" },
      { id: "c", color: "success" },
    ],
    edges: [
      { from: "a", to: "b", weight: 5 },
      { from: "b", to: "a" },
      { from: "a", to: "a" },
      { from: "a", to: "ghost" },
      { from: "b", to: "c" },
    ],
    highlight: {
      nodes: ["a", "zzz"],
      edges: [
        ["b", "a"],
        ["a", "ghost"],
      ],
    },
  });
  assert.equal(ok, true);
  assert.equal(spec.nodes.length, 3);
  assert.equal(spec.nodes[1].label, "b"); // label defaults to id
  assert.equal(spec.edges.length, 2); // reciprocal a-b deduped; self-loop + dangling dropped
  assert.equal(spec.edges[0].weight, 5);
  assert.equal(spec.edges[0].label, "5"); // weight → label
  assert.deepEqual(spec.highlight.nodes, ["a"]); // unknown node filtered
  assert.deepEqual(spec.highlight.edges, [["a", "b"]]); // ["b","a"] → canonical sorted pair; a-ghost dropped
});

test("graph directed keeps reciprocal edges; rejects empty; caps nodes", () => {
  const dir = validateSpec({
    v: 1,
    kind: "graph",
    directed: true,
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
  });
  assert.equal(dir.spec.edges.length, 2); // directed: a→b and b→a are distinct
  assert.equal(validateSpec({ v: 1, kind: "graph", nodes: [] }).ok, false);
  const big = validateSpec({
    v: 1,
    kind: "graph",
    nodes: Array.from({ length: 25 }, (_, i) => ({ id: `n${i}` })),
  });
  assert.equal(big.spec.nodes.length, 16); // node cap
});

test("graphLayout is deterministic and stays inside the unit box", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "d", to: "a" },
  ];
  const p1 = graphLayout(nodes, edges, "force"),
    p2 = graphLayout(nodes, edges, "force");
  assert.deepEqual(p1, p2); // deterministic (no RNG)
  for (const id of ["a", "b", "c", "d"]) {
    assert.ok(
      p1[id].x >= 0 && p1[id].x <= 1 && p1[id].y >= 0 && p1[id].y <= 1,
      "inside unit box",
    );
  }
  assert.equal(Object.keys(graphLayout(nodes, edges, "circular")).length, 4);
});

test("lgamma matches known values (main + reflection paths)", () => {
  assert.ok(Math.abs(lgamma(1)) < 1e-9); // Γ(1)=1 → 0
  assert.ok(Math.abs(lgamma(5) - Math.log(24)) < 1e-9); // Γ(5)=4!=24
  assert.ok(Math.abs(lgamma(0.5) - 0.5 * Math.log(Math.PI)) < 1e-9); // Γ(½)=√π (boundary)
  assert.ok(Math.abs(lgamma(0.25) - Math.log(3.6256099082)) < 1e-6); // reflection branch (x<0.5)
});

test("distPdf: shapes, support, and total probability ≈ 1", () => {
  assert.ok(
    Math.abs(
      distPdf("normal", { mu: 0, sigma: 1 }, 0) - 1 / Math.sqrt(2 * Math.PI),
    ) < 1e-9,
  );
  assert.ok(
    distPdf("normal", { mu: 0, sigma: 1 }, 0) >
      distPdf("normal", { mu: 0, sigma: 1 }, 2),
  ); // peak at the mean
  assert.equal(distPdf("chisq", { df: 3 }, -1), 0); // 0 outside support
  assert.equal(distPdf("exponential", { lambda: 1 }, -0.5), 0);
  assert.equal(distPdf("uniform", { a: 0, b: 2 }, 1), 0.5);
  assert.equal(distPdf("uniform", { a: 0, b: 2 }, 3), 0);
  for (const [dist, p, lo, hi] of [
    ["normal", { mu: 0, sigma: 1 }, -8, 8],
    ["t", { df: 5 }, -40, 40],
    ["chisq", { df: 3 }, 0, 40],
    ["exponential", { lambda: 1.5 }, 0, 25],
  ]) {
    let area = 0;
    const n = 4000,
      dx = (hi - lo) / n;
    for (let i = 0; i < n; i += 1)
      area += distPdf(dist, p, lo + (i + 0.5) * dx) * dx;
    assert.ok(Math.abs(area - 1) < 0.02, `${dist} integrates to ${area}`);
  }
});

test("distRange is support-aware", () => {
  assert.deepEqual(distRange("normal", { mu: 0, sigma: 1 }), [-4, 4]);
  assert.equal(distRange("chisq", { df: 3 })[0], 0); // chi-squared starts at 0
  assert.equal(distRange("exponential", { lambda: 1 })[0], 0);
});

test("validateSpec: distribution normalizes, defaults, and fails soft", () => {
  const ok = validateSpec({
    v: 1,
    kind: "distribution",
    dist: "normal",
    params: { mu: 0, sigma: 1 },
    shade: { from: 1.64, to: null, label: "α=0.05" },
    marks: [{ x: 1.64, label: "z*" }],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.spec.dist, "normal");
  assert.equal(ok.spec.shade.to, null); // open right tail preserved
  assert.equal(ok.spec.marks.length, 1);
  const fb = validateSpec({
    v: 1,
    kind: "distribution",
    dist: "weird",
    params: { sigma: -3 },
  }); // unknown dist → normal; bad params → defaults
  assert.equal(fb.ok, true);
  assert.equal(fb.spec.dist, "normal");
  assert.equal(fb.spec.params.sigma, 1);
  assert.ok(fb.spec.xRange[1] > fb.spec.xRange[0]); // xRange auto-filled
  const u = validateSpec({
    v: 1,
    kind: "distribution",
    dist: "uniform",
    params: { a: 5, b: 2 },
  }); // b<=a → defaults
  assert.equal(u.spec.params.a, 0);
  assert.equal(u.spec.params.b, 1);
  const s = validateSpec({
    v: 1,
    kind: "distribution",
    dist: "t",
    params: { df: 10 },
    shade: { from: null, to: null },
    marks: Array.from({ length: 9 }, (_, i) => ({ x: i })),
  });
  assert.equal(s.spec.shade, null); // fully-null shade drops
  assert.equal(s.spec.marks.length, 6); // marks cap
});

test("arithmetic precedence and associativity", () => {
  assert.equal(ev("1 + 2 * 3"), 7);
  assert.equal(ev("(1 + 2) * 3"), 9);
  assert.equal(ev("2 ^ 3 ^ 2"), 512); // ^ is right-associative
  assert.equal(ev("-2 ^ 2"), -4); // unary binds looser than ^ → -(2^2)
  assert.equal(ev("10 / 2 / 5"), 1); // / left-associative
});

test("functions, constants, and variables", () => {
  assert.ok(Math.abs(ev("exp(0)") - 1) < 1e-9);
  assert.ok(Math.abs(ev("sqrt(16)") - 4) < 1e-9);
  assert.equal(ev("min(3, 7)"), 3);
  assert.equal(ev("max(3, 7)"), 7);
  assert.ok(Math.abs(ev("cos(pi)") + 1) < 1e-9);
  assert.ok(
    Math.abs(ev("3 * exp(-t / (R * 0.1))", { t: 0, R: 10 }) - 3) < 1e-9,
  );
});

test("expanded function whitelist: inverse-trig, hyperbolic, cbrt, atan2 (still no-eval)", () => {
  assert.ok(Math.abs(ev("atan(1)") - Math.PI / 4) < 1e-9);
  assert.ok(Math.abs(ev("asin(1)") - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(ev("acos(1)")) < 1e-9);
  assert.ok(Math.abs(ev("cosh(0)") - 1) < 1e-9);
  assert.ok(Math.abs(ev("tanh(0)")) < 1e-9);
  assert.ok(Math.abs(ev("cbrt(27)") - 3) < 1e-9);
  assert.ok(Math.abs(ev("atan2(1, 1)") - Math.PI / 4) < 1e-9);
  assert.throws(() => parseExpr("sec(x)", ["x"])); // unknown fn still rejected (whitelist holds)
});

test("whitelist: unknown identifiers and functions are rejected (no eval surface)", () => {
  assert.throws(() => parseExpr("alert(1)")); // unknown function
  assert.throws(() => parseExpr("window")); // unknown identifier
  assert.throws(() => parseExpr("x", [])); // var not declared
  assert.throws(() => parseExpr("constructor")); // not whitelisted
  assert.throws(() => parseExpr("2 +")); // syntax error
  assert.throws(() => parseExpr("1; drop table")); // bad characters
  assert.throws(() => parseExpr("`a`")); // bad character
  assert.throws(() => parseExpr("min(1)")); // wrong arity
});

test("node cap rejects pathological input", () => {
  const huge = Array.from({ length: 300 }, () => "1").join("+");
  assert.throws(() => parseExpr(huge), /too large/);
});

test("non-finite values do not throw — they sample as null (a gap)", () => {
  const ast = parseExpr("1 / x", ["x"]);
  const pts = sampleCurve(ast, "x", -1, 1, {}, 4);
  assert.ok(pts.some((p) => p.y === null)); // division by zero at x=0 → gap
  assert.ok(pts.some((p) => typeof p.y === "number"));
});

test("validateSpec accepts a well-formed parametric-plot", () => {
  const { ok, errors, spec } = validateSpec({
    v: 1,
    kind: "parametric-plot",
    title: "RC",
    x: { var: "t", min: 0, max: 10, label: "t" },
    params: [{ var: "R", min: 2, max: 50, default: 10, label: "R", unit: "Ω" }],
    curves: [{ label: "Q(t)", expr: "3*exp(-t/(R*0.1))", color: "accent" }],
  });
  assert.equal(ok, true, errors.join(";"));
  assert.ok(spec.curves[0]._ast, "curve gets a parsed AST");
});

test("validateSpec rejects bad specs and bad exprs", () => {
  assert.equal(validateSpec({ v: 2, kind: "parametric-plot" }).ok, false);
  assert.equal(validateSpec({ v: 1, kind: "evil" }).ok, false);
  assert.equal(
    validateSpec({
      v: 1,
      kind: "parametric-plot",
      x: { var: "t", min: 5, max: 1 },
      curves: [{ expr: "t" }],
    }).ok,
    false,
  );
  const r = validateSpec({
    v: 1,
    kind: "parametric-plot",
    x: { var: "t", min: 0, max: 1 },
    curves: [{ expr: "hack(t)" }],
  });
  assert.equal(r.ok, false); // unknown function in a curve
});

test("bracket-sim validates pure config, caps + sanitizes, rejects bracket-less input", () => {
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "bracket-sim",
    title: "בדיקת סוגריים",
    input: "{[(a+b)*c]}",
    examples: [
      "(()",
      "()",
      "[)",
      "{[()]}",
      "[c-d]*(a+b)",
      "()",
      "extra-no-bracket",
      "[seventh]",
    ],
  });
  assert.equal(ok, true);
  assert.equal(spec.input, "{[(a+b)*c]}");
  assert.equal(
    spec.examples.length,
    6,
    "≤6 examples, deduped, bracket-less dropped",
  );
  // sanitization: angle brackets / scripts can't survive into the rendered text
  const sani = validateSpec({
    v: 1,
    kind: "bracket-sim",
    input: "{[a]}<script>x</script>",
  });
  assert.ok(sani.ok && !/[<>]/.test(sani.spec.input));
  // must contain brackets, and not be empty
  assert.equal(
    validateSpec({ v: 1, kind: "bracket-sim", input: "a+b*c" }).ok,
    false,
  );
  assert.equal(
    validateSpec({ v: 1, kind: "bracket-sim", input: "" }).ok,
    false,
  );
});

test("slope-field validates a 2-var ODE expr, rejects unknown vars, defaults range/density", () => {
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "slope-field",
    title: "y'",
    expr: "x*y - sin(y)",
  });
  assert.equal(ok, true);
  assert.ok(spec._ast, "carries the parsed AST for the renderer");
  assert.deepEqual(spec.xRange, [-3, 3]);
  assert.equal(spec.density, 13);
  assert.equal(
    validateSpec({ v: 1, kind: "slope-field", expr: "x*z" }).ok,
    false,
  ); // z is not an allowed var
  assert.equal(validateSpec({ v: 1, kind: "slope-field", expr: "" }).ok, false);
  assert.equal(
    validateSpec({ v: 1, kind: "slope-field", expr: "x", density: 99 }).spec
      .density,
    17,
  ); // capped
});

test("geometry2d tolerance: per-type arrays / {x,y,dx,dy} vectors normalize into items (don't vanish)", () => {
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "geometry2d",
    vectors: [
      { x: 0, y: 0, dx: 1, dy: 2, color: "evTeal" },
      { x1: 1, y1: 1, x2: 3, y2: 1 },
    ],
    curves: [{ expr: "x^2", color: "accent" }],
    points: [{ x: 2, y: 2, label: "P" }],
  });
  assert.equal(
    ok,
    true,
    "no items key, but per-type arrays normalize instead of rejecting",
  );
  assert.deepEqual(spec.items.map((i) => i.type).sort(), [
    "function",
    "point",
    "vector",
    "vector",
  ]);
  const v = spec.items.find((i) => i.type === "vector" && i.x1 === 0);
  assert.deepEqual([v.x2, v.y2], [1, 2], "{x,y,dx,dy} → endpoint (x+dx, y+dy)");
});

test("geometry2d tolerance: `elements` array key + tuple coords ([x,y]) render (real prod annulus)", () => {
  // The EXACT spec a model emitted for "אני רוצה הדמיה" that silently vanished: the
  // primitives were under `elements` (not `items`), with `center`/`pos` as [x,y] tuples.
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "geometry2d",
    title: "טבעת 1 ≤ r ≤ 2",
    elements: [
      { type: "circle", center: [0, 0], radius: 2, color: "evTeal" },
      { type: "circle", center: [0, 0], radius: 1, color: "evOrange" },
      { type: "point", pos: [0, 0], label: "מרכז" },
      { type: "point", pos: [2, 0], label: "r=2" },
    ],
  });
  assert.equal(
    ok,
    true,
    "`elements` key + tuple coords must render, not vanish",
  );
  assert.deepEqual(
    spec.items.map((i) => i.type),
    ["circle", "circle", "point", "point"],
  );
  const outer = spec.items[0];
  assert.deepEqual(
    [outer.cx, outer.cy, outer.r],
    [0, 0, 2],
    "center:[0,0] radius:2 → cx/cy/r",
  );
  assert.equal(outer.color, "evTeal", "named color preserved");
  assert.deepEqual(
    [spec.items[3].x, spec.items[3].y],
    [2, 0],
    "pos:[2,0] → x/y",
  );
});

test("geometry2d tolerance: from/to & start/end tuple endpoints fold into x1/y1/x2/y2", () => {
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "geometry2d",
    shapes: [
      // `shapes` alias too
      { type: "segment", from: [0, 0], to: [3, 4] },
      { type: "vector", start: [1, 1], end: [2, 5] },
    ],
  });
  assert.equal(ok, true);
  const seg = spec.items.find((i) => i.type === "segment");
  assert.deepEqual([seg.x1, seg.y1, seg.x2, seg.y2], [0, 0, 3, 4]);
  const vec = spec.items.find((i) => i.type === "vector");
  assert.deepEqual([vec.x1, vec.y1, vec.x2, vec.y2], [1, 1, 2, 5]);
});

test("function-compare validates like a multi-curve plot", () => {
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "function-compare",
    x: { var: "x", min: -3, max: 3 },
    curves: [
      { expr: "x*x", color: "accent" },
      { expr: "x*x*x", color: "evTeal" },
    ],
  });
  assert.equal(ok, true);
  assert.equal(spec.curves.length, 2);
});

test("diagram validates nodes/edges and drops dangling edges", () => {
  const { ok, spec } = validateSpec({
    v: 1,
    kind: "diagram",
    title: "flow",
    nodes: [
      { id: "a", label: "התחלה", x: 0.1, y: 0.5 },
      { id: "b", label: "סוף", x: 0.9, y: 0.5, color: "#bad" },
    ],
    edges: [
      { from: "a", to: "b", label: "→" },
      { from: "a", to: "ghost" },
    ],
  });
  assert.equal(ok, true);
  assert.equal(spec.nodes.length, 2);
  assert.equal(spec.edges.length, 1); // edge to non-existent "ghost" dropped
  assert.equal(spec.nodes[1].color, "accent"); // off-brand color coerced
});

test("diagram rejects when it has no nodes", () => {
  assert.equal(validateSpec({ v: 1, kind: "diagram", nodes: [] }).ok, false);
});

test("validateSpec coerces an off-brand color to accent and clamps default", () => {
  const { spec } = validateSpec({
    v: 1,
    kind: "parametric-plot",
    x: { var: "t", min: 0, max: 10 },
    params: [{ var: "R", min: 2, max: 50, default: 999 }],
    curves: [{ expr: "R + t", color: "#ff0000" }],
  });
  assert.equal(spec.curves[0].color, "accent");
  assert.ok(spec.params[0].default >= 2 && spec.params[0].default <= 50);
});

// ---- memory-sim (stepped Java stack/heap illustration) ----
const memBase = () => ({
  v: 1,
  kind: "memory-sim",
  title: "Stack vs Heap",
  code: ["void main() {", "  int age = 25;", "  User u1 = new User();", "}"],
  frames: [
    { id: "main", label: "main()" },
    { id: "calc", label: "calculate()" },
  ],
  slots: [
    {
      id: "age",
      frame: "main",
      label: "age = 25",
      type: "primitive",
      color: "accent",
    },
    {
      id: "u1",
      frame: "main",
      label: "u1 = ref",
      type: "reference",
      color: "evPurple",
    },
    { id: "p_age", frame: "calc", label: "n = 25", type: "primitive" },
  ],
  objects: [{ id: "userObj", label: "User Object", color: "evGreen" }],
  refs: [{ id: "r1", from: "u1", to: "userObj", label: "Reference" }],
  steps: [
    { line: 1, caption: "a", show: ["main", "age"], focus: ["age"] },
    {
      line: 2,
      caption: "b",
      show: ["main", "age", "u1", "userObj", "r1"],
      focus: ["u1", "r1"],
    },
    {
      line: 3,
      caption: "c",
      show: ["main", "age", "u1", "userObj", "r1", "calc", "p_age"],
      focus: ["calc"],
    },
  ],
});

test("memory-sim accepts a well-formed stepped spec", () => {
  const { ok, errors, spec } = validateSpec(memBase());
  assert.equal(ok, true, errors.join(","));
  assert.equal(spec.kind, "memory-sim");
  assert.equal(spec.steps.length, 3);
  assert.equal(spec.slots.length, 3);
  assert.equal(spec.refs.length, 1);
});

test("memory-sim clamps every array + string to its cap (DoS envelope)", () => {
  const s = {
    v: 1,
    kind: "memory-sim",
    title: "T".repeat(200),
    code: Array.from({ length: 50 }, () => "x".repeat(200)),
    frames: Array.from({ length: 20 }, (_, i) => ({
      id: "f" + i,
      label: "F".repeat(99),
    })),
    slots: Array.from({ length: 50 }, (_, i) => ({
      id: "s" + i,
      frame: "f0",
      label: "L",
    })),
    objects: Array.from({ length: 30 }, (_, i) => ({
      id: "o" + i,
      label: "O",
    })),
    refs: Array.from({ length: 20 }, (_, i) => ({
      id: "r" + i,
      from: "s0",
      to: "o0",
    })),
    steps: Array.from({ length: 40 }, () => ({
      line: 0,
      caption: "c".repeat(500),
      show: Array(40).fill("f0"),
      focus: [],
    })),
  };
  const { ok, spec } = validateSpec(s);
  assert.equal(ok, true);
  assert.equal(spec.title.length, 80);
  assert.equal(spec.code.length, 10);
  assert.ok(spec.code.every((l) => l.length <= 80));
  assert.equal(spec.frames.length, 6);
  assert.ok(spec.frames.every((f) => f.label.length <= 40));
  assert.equal(spec.slots.length, 16);
  assert.equal(spec.objects.length, 6);
  assert.equal(spec.refs.length, 8);
  assert.equal(spec.steps.length, 12);
  assert.ok(spec.steps[0].caption.length <= 120);
  assert.ok(spec.steps[0].show.length <= 24);
});

test("memory-sim drops orphan slots, dangling refs, and unknown show ids", () => {
  const s = memBase();
  s.slots.push({ id: "orphan", frame: "ghost", label: "x" }); // frame doesn't exist
  s.refs.push({ id: "r2", from: "age", to: "ghostObj" }); // object doesn't exist
  s.steps[0].show = ["main", "age", "nope"]; // unknown id
  const { ok, spec } = validateSpec(s);
  assert.equal(ok, true);
  assert.equal(
    spec.slots.find((x) => x.id === "orphan"),
    undefined,
  );
  assert.equal(spec.refs.length, 1);
  assert.ok(!spec.steps[0].show.includes("nope"));
});

test("memory-sim per-step coherence is fail-closed", () => {
  // ref shown without its object -> ref dropped from that step; slot kept (frame shown)
  const s1 = memBase();
  s1.steps[1].show = ["main", "u1", "r1"]; // missing userObj
  const r1 = validateSpec(s1).spec.steps[1].show;
  assert.ok(!r1.includes("r1"));
  assert.ok(r1.includes("u1"));
  // slot shown without its frame -> dropped
  const s2 = memBase();
  s2.steps[0].show = ["age"]; // frame "main" not shown
  assert.ok(!validateSpec(s2).spec.steps[0].show.includes("age"));
  // focus intersected with final show
  const s3 = memBase();
  s3.steps[0].focus = ["age", "u1"]; // u1 not in step-0 show
  const f3 = validateSpec(s3).spec.steps[0].focus;
  assert.ok(f3.includes("age") && !f3.includes("u1"));
});

test("memory-sim coerces injected/off-brand colors to type defaults", () => {
  const s = memBase();
  s.slots[0].color = "#fff"; // primitive -> accent
  s.slots[1].color = "javascript:alert(1)"; // reference -> evPurple
  s.objects[0].color = "red"; // object -> evGreen
  const { spec } = validateSpec(s);
  assert.equal(spec.slots[0].color, "accent");
  assert.equal(spec.slots[1].color, "evPurple");
  assert.equal(spec.objects[0].color, "evGreen");
  const json = JSON.stringify(spec);
  assert.ok(
    !json.includes("javascript:") &&
      !json.includes("#fff") &&
      !json.includes('"red"'),
  );
});

test("memory-sim requires at least one step", () => {
  assert.equal(
    validateSpec({
      v: 1,
      kind: "memory-sim",
      frames: [{ id: "a", label: "A" }],
      steps: [],
    }).ok,
    false,
  );
  const noSteps = memBase();
  delete noSteps.steps;
  assert.equal(validateSpec(noSteps).ok, false);
});

test("memory-sim rejects a malformed frame (like diagram's bad node)", () => {
  const s = memBase();
  s.frames.push({ id: "123bad", label: "x" }); // id fails ID_RE
  assert.equal(validateSpec(s).ok, false);
});

test("memory-sim accepts empty code and clamps step line to 0", () => {
  const s = memBase();
  s.code = [];
  const { ok, spec } = validateSpec(s);
  assert.equal(ok, true);
  assert.ok(spec.steps.every((st) => st.line === 0));
});

test("memory-sim defaults reference slots to evPurple, primitives to accent", () => {
  const s = memBase();
  delete s.slots[0].color; // primitive
  delete s.slots[1].color; // reference
  const { spec } = validateSpec(s);
  assert.equal(spec.slots[0].color, "accent");
  assert.equal(spec.slots[1].color, "evPurple");
});

test("memory-sim rebuilds frames to exactly {id,label}, dropping junk keys", () => {
  const s = memBase();
  s.frames[0] = {
    id: "main",
    label: "main()",
    x: 0.9,
    evil: "<script>",
    extra: 123,
  };
  const { spec } = validateSpec(s);
  assert.deepEqual(Object.keys(spec.frames[0]).sort(), ["id", "label"]);
});

test("memory-sim clamps step.line to the code range (upper, negative, fractional)", () => {
  const s = memBase(); // code has 4 lines (indices 0..3)
  s.steps = [
    { line: 99, show: ["main", "age"] }, // over the top -> code.length-1
    { line: -7, show: ["main", "age"] }, // negative -> 0
    { line: 1.9, show: ["main", "age"] }, // fractional -> truncated
  ];
  const { spec } = validateSpec(s);
  assert.equal(spec.steps[0].line, 3);
  assert.equal(spec.steps[1].line, 0);
  assert.equal(spec.steps[2].line, 1);
});

// ---- Region shading (area under a curve / between two curves) ----
const PLOT2 = {
  v: 1,
  kind: "parametric-plot",
  title: "t",
  x: { var: "x", min: 0, max: 10, label: "x" },
  curves: [
    { label: "f", expr: "x", color: "accent" },
    { label: "g", expr: "x^2/10", color: "evTeal" },
  ],
};

test("region: 'under' resolves a curve label to its index and clamps the range", () => {
  const r = validateSpec({
    ...PLOT2,
    regions: [
      {
        type: "under",
        curve: "f",
        from: -5,
        to: 50,
        color: "success",
        label: "אינטגרל",
      },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.regions.length, 1);
  assert.equal(r.spec.regions[0].type, "under");
  assert.equal(r.spec.regions[0].curve, 0); // "f" → 0
  assert.equal(r.spec.regions[0].from, 0); // clamped to x.min
  assert.equal(r.spec.regions[0].to, 10); // clamped to x.max
  assert.equal(r.spec.regions[0].color, "success");
});

test("region: 'between' needs two DISTINCT curves; from/to default to full range", () => {
  const r = validateSpec({
    ...PLOT2,
    regions: [{ type: "between", curve: "f", curve2: "g", color: "warning" }],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.regions[0].type, "between");
  assert.equal(r.spec.regions[0].curve2, 1);
  assert.equal(r.spec.regions[0].from, 0);
  assert.equal(r.spec.regions[0].to, 10);
});

test("region: fail-soft drops unknown refs, inverted ranges, same-curve 'between', off-brand colors; caps at 4", () => {
  const r = validateSpec({
    ...PLOT2,
    regions: [
      { type: "under", curve: "missing" }, // unknown curve → drop
      { type: "under", curve: "f", from: 8, to: 2 }, // inverted range → drop
      { type: "between", curve: "f", curve2: "f" }, // same curve → drop
      { type: "under", curve: "f", from: 1, to: 4, color: "#ff0000" }, // off-brand color → accent
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.regions.length, 1);
  assert.equal(r.spec.regions[0].color, "accent");

  const many = validateSpec({
    ...PLOT2,
    regions: Array.from({ length: 9 }, () => ({ type: "under", curve: "f" })),
  });
  assert.ok(many.spec.regions.length <= 4);
});

test("region: a plot without regions back-compat carries regions:[]", () => {
  const r = validateSpec({
    v: 1,
    kind: "parametric-plot",
    x: { var: "x", min: 0, max: 5 },
    curves: [{ expr: "x", color: "accent" }],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.spec.regions, []);
});

// ---- Chart (bar / line / pie / scatter) ----
test("chart bar: pads/truncates series data to labels, auto-colors, never throws", () => {
  const r = validateSpec({
    v: 1,
    kind: "chart",
    chartType: "bar",
    labels: ["A", "B", "C"],
    series: [{ name: "x", data: [1, 2] }, { data: [9, 8, 7, 6] }],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.spec.series[0].data, [1, 2, 0]); // padded to labels.length
  assert.equal(r.spec.series[1].data.length, 3); // truncated to labels.length
  assert.ok(r.spec.series[0].color && r.spec.series[1].color);
});

test("chart pie keeps a single series; unknown chartType falls back to bar", () => {
  const r = validateSpec({
    v: 1,
    kind: "chart",
    chartType: "pie",
    labels: ["x", "y"],
    series: [{ data: [3, 7] }, { data: [1, 1] }],
  });
  assert.equal(r.spec.chartType, "pie");
  assert.equal(r.spec.series.length, 1);
  assert.equal(
    validateSpec({
      v: 1,
      kind: "chart",
      chartType: "donut",
      labels: ["x"],
      series: [{ data: [1] }],
    }).spec.chartType,
    "bar",
  );
});

test("chart scatter: keeps finite xy points, drops junk, requires at least one", () => {
  const r = validateSpec({
    v: 1,
    kind: "chart",
    chartType: "scatter",
    series: [
      {
        name: "obs",
        points: [
          { x: 1, y: 2 },
          { x: "z", y: 3 },
          { x: 4, y: NaN },
          { x: 5, y: 6 },
        ],
      },
    ],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.spec.series[0].points, [
    { x: 1, y: 2 },
    { x: 5, y: 6 },
  ]);
  assert.equal(
    validateSpec({
      v: 1,
      kind: "chart",
      chartType: "scatter",
      series: [{ points: [] }],
    }).ok,
    false,
  );
});

test("chart rejects categorical data missing labels or series", () => {
  assert.equal(
    validateSpec({
      v: 1,
      kind: "chart",
      chartType: "bar",
      series: [{ data: [1] }],
    }).ok,
    false,
  );
  assert.equal(
    validateSpec({ v: 1, kind: "chart", chartType: "bar", labels: ["a"] }).ok,
    false,
  );
});

// ---- Table (matrix / truth table / Punnett) ----
test("table pads ragged rows to a rectangle, caps, validates highlights", () => {
  const r = validateSpec({
    v: 1,
    kind: "table",
    headerRow: true,
    rows: [["p", "q", "r"], ["T"], ["F", "T"]],
    highlight: [
      { r: 1, c: 0, color: "success" },
      { r: 9, c: 0, color: "warning" },
      { r: 0, c: 0, color: "#zzz" },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.cols, 3);
  assert.deepEqual(r.spec.rows[1], ["T", "", ""]); // padded to a rectangle
  assert.equal(r.spec.headerRow, true);
  assert.equal(r.spec.highlight.length, 2); // out-of-range one dropped
  assert.ok(r.spec.highlight.every((h) => h.r < 3 && h.c < 3));
  assert.equal(r.spec.highlight.find((h) => h.r === 0).color, "accent"); // off-brand → accent
});

test("table rejects when empty", () => {
  assert.equal(validateSpec({ v: 1, kind: "table", rows: [] }).ok, false);
});

// ---- Tree (auto-laid hierarchy) ----
test("tree drops dangling/self parents to roots and keeps real links", () => {
  const r = validateSpec({
    v: 1,
    kind: "tree",
    nodes: [
      { id: "root", label: "8" },
      { id: "a", label: "3", parent: "root" },
      { id: "b", label: "10", parent: "ghost" }, // dangling parent → root
      { id: "c", label: "1", parent: "c" }, // self parent → root
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.nodes.find((n) => n.id === "a").parent, "root");
  assert.equal(r.spec.nodes.find((n) => n.id === "b").parent, null);
  assert.equal(r.spec.nodes.find((n) => n.id === "c").parent, null);
});

test("tree breaks cycles, dedups ids, requires ≥1 node", () => {
  const r = validateSpec({
    v: 1,
    kind: "tree",
    nodes: [
      { id: "a", label: "A", parent: "b" },
      { id: "b", label: "B", parent: "a" },
      { id: "a", label: "DUP" }, // duplicate id → dropped
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.nodes.length, 2);
  assert.ok(r.spec.nodes.some((n) => n.parent === null)); // cycle was cut → a root exists
  assert.equal(validateSpec({ v: 1, kind: "tree", nodes: [] }).ok, false);
});

// ---- geometry2d (coordinate canvas of primitives) ----
test("geometry2d validates primitives, defaults range/grid/axes, drops bad items", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    items: [
      {
        type: "vector",
        x1: 0,
        y1: 0,
        x2: 3,
        y2: 2,
        label: "v",
        color: "accent",
      },
      { type: "point", x: 1, y: 1 },
      { type: "circle", cx: 0, cy: 0, r: 2 },
      {
        type: "polygon",
        points: [
          [0, 0],
          [2, 0],
          [1, 2],
        ],
        fill: true,
      },
      { type: "segment", x1: 0, y1: 0, x2: 1 }, // missing y2 → dropped
      { type: "circle", cx: 0, cy: 0, r: -1 }, // r<=0 → dropped
      { type: "blob", x: 1, y: 1 }, // unknown type → dropped
    ],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.spec.xRange, [-5, 5]);
  assert.equal(r.spec.grid, true);
  assert.equal(r.spec.axes, true);
  assert.deepEqual(r.spec.items.map((i) => i.type).sort(), [
    "circle",
    "point",
    "polygon",
    "vector",
  ]);
});

test("geometry2d grid: 'polar' is preserved (for the polar-coordinate view); bool semantics unchanged", () => {
  const base = {
    v: 1,
    kind: "geometry2d",
    items: [{ type: "point", x: 0, y: 0 }],
  };
  assert.equal(validateSpec({ ...base, grid: "polar" }).spec.grid, "polar"); // string kept verbatim
  assert.equal(validateSpec({ ...base, grid: false }).spec.grid, false); // off
  assert.equal(validateSpec({ ...base }).spec.grid, true); // default square
  assert.equal(validateSpec({ ...base, grid: "square" }).spec.grid, true); // any other truthy → square
});

test("geometry2d sector: arc-bounded polar region (annular / disk / aliases / normalized)", () => {
  const base = { v: 1, kind: "geometry2d" };
  const s = validateSpec({
    ...base,
    items: [
      {
        type: "sector",
        r1: 1,
        r2: 2,
        theta1: 0,
        theta2: 1.5708,
        fill: true,
        color: "success",
        label: "D",
      },
    ],
  });
  assert.ok(s.ok);
  assert.equal(s.spec.items[0].type, "sector");
  assert.deepEqual(
    [
      s.spec.items[0].r1,
      s.spec.items[0].r2,
      s.spec.items[0].cx,
      s.spec.items[0].cy,
    ],
    [1, 2, 0, 0],
  ); // center defaults to origin
  const disk = validateSpec({
    ...base,
    items: [{ type: "sector", r: 3, startAngle: 0, endAngle: 1 }],
  }); // r/startAngle/endAngle aliases; r1 defaults to 0
  assert.deepEqual([disk.spec.items[0].r1, disk.spec.items[0].r2], [0, 3]);
  const swapped = validateSpec({
    ...base,
    items: [{ type: "sector", r1: 4, r2: 1, theta1: 0, theta2: 1 }],
  }); // inner=min, outer=max
  assert.deepEqual(
    [swapped.spec.items[0].r1, swapped.spec.items[0].r2],
    [1, 4],
  );
  const ring = validateSpec({
    ...base,
    items: [{ type: "sector", r1: 1, r2: 2 }],
  }); // no angles → a FULL ring (0..2π)
  assert.ok(ring.ok);
  assert.ok(
    Math.abs(
      ring.spec.items[0].theta2 - ring.spec.items[0].theta1 - 2 * Math.PI,
    ) < 1e-9,
  );
  assert.equal(
    validateSpec({ ...base, items: [{ type: "sector", theta1: 0, theta2: 1 }] })
      .ok,
    false,
  ); // no radius → dropped → nothing survives
});

test("geometry2d 'function' routes through the no-eval engine; off-whitelist exprs drop", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    xRange: [-3, 3],
    yRange: [-1, 9],
    items: [
      { type: "function", expr: "x^2", color: "accent" },
      { type: "function", expr: "alert(1)" }, // not whitelisted → dropped, never evaluated
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.items.length, 1);
  assert.ok(r.spec.items[0]._ast);
});

test("geometry2d rejects when nothing valid survives; inverted range falls back", () => {
  assert.equal(
    validateSpec({ v: 1, kind: "geometry2d", items: [{ type: "blob" }] }).ok,
    false,
  );
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    xRange: [5, 1],
    items: [{ type: "point", x: 0, y: 0 }],
  });
  assert.deepEqual(r.spec.xRange, [-5, 5]);
});

test("geometry2d tolerates {center,radius} circles (don't drop a slightly-off shape)", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    circles: [{ center: { x: 1, y: 0 }, radius: 1, label: "c" }],
  });
  assert.ok(r.ok);
  assert.deepEqual(
    [r.spec.items[0].cx, r.spec.items[0].cy, r.spec.items[0].r],
    [1, 0, 1],
  );
});

test("geometry2d maps a spatial 'regions' array into a filled domain (the integration-region bug)", () => {
  // The exact spec the platform produced for the moment-of-inertia disk D: only the
  // center point used to survive — the circle + region were silently dropped.
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    title: "D",
    points: [{ x: 1, y: 0, label: "(1,0)" }],
    circles: [{ center: { x: 1, y: 0 }, radius: 1, label: "(x-1)²+y²=1" }],
    regions: [
      { type: "circle", center: { x: 1, y: 0 }, radius: 1, label: "D" },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.items.length, 3); // point + boundary circle + filled disk
  const filled = r.spec.items.filter((it) => it.type === "circle" && it.fill);
  assert.equal(filled.length, 1); // the region became a shaded disk
  assert.deepEqual([filled[0].cx, filled[0].cy, filled[0].r], [1, 0, 1]);
});

test("geometry2d maps a rect/polygon region to a filled polygon", () => {
  const rect = validateSpec({
    v: 1,
    kind: "geometry2d",
    regions: [{ x: [0, 2], y: [0, 3], label: "R" }],
  });
  assert.ok(rect.ok);
  assert.equal(rect.spec.items[0].type, "polygon");
  assert.ok(rect.spec.items[0].fill && rect.spec.items[0].points.length === 4);
});

// ---- memory-sim interactivity (action buttons → closed reducer) ----
test("memory-sim: optional action buttons jump to a valid step; bad ones drop", () => {
  const base = {
    v: 1,
    kind: "memory-sim",
    frames: [{ id: "main", label: "main()" }],
    slots: [],
    objects: [],
    refs: [],
    steps: [
      { line: 0, show: ["main"] },
      { line: 1, show: ["main"] },
    ],
  };
  const r = validateSpec({
    ...base,
    buttons: [
      { label: "Call", step: 1 },
      { label: "OOR", step: 9 },
      { label: "", step: 0 },
      { label: "NoStep" },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.buttons.length, 1); // only the in-range, labeled button survives
  assert.deepEqual(r.spec.buttons[0], { label: "Call", step: 1 });
  assert.deepEqual(validateSpec(base).spec.buttons, []); // none → [] (back-compat)
});

// ---- numberline (1D axis: points + open/closed intervals) ----
test("numberline clamps to range, normalizes intervals, validates colors", () => {
  const r = validateSpec({
    v: 1,
    kind: "numberline",
    min: 0,
    max: 10,
    points: [
      { x: 5, label: "a", color: "accent", open: true },
      { x: 99, label: "clamped", color: "#bad" }, // x clamped to max; bad color → accent
    ],
    intervals: [
      { from: 8, to: 2, color: "success", openFrom: true }, // from/to swapped → normalized
      { from: 3, to: 3 }, // zero-width → dropped
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.points[1].x, 10);
  assert.equal(r.spec.points[1].color, "accent");
  assert.equal(r.spec.points[0].open, true);
  assert.equal(r.spec.intervals.length, 1);
  assert.deepEqual([r.spec.intervals[0].from, r.spec.intervals[0].to], [2, 8]);
  assert.equal(r.spec.intervals[0].openFrom, true);
});

test("numberline defaults a bad range and rejects when empty", () => {
  const r = validateSpec({
    v: 1,
    kind: "numberline",
    min: 5,
    max: 1,
    points: [{ x: 0 }],
  });
  assert.deepEqual([r.spec.min, r.spec.max], [5, 15]); // max<=min → min+10
  assert.equal(
    validateSpec({ v: 1, kind: "numberline", points: [], intervals: [] }).ok,
    false,
  );
});

// ---- timeline (ordered events) ----
test("timeline keeps labeled events in order, auto-cycles colors, caps at 10", () => {
  const events = Array.from({ length: 14 }, (_, i) => ({
    label: `e${i}`,
    at: `${1990 + i}`,
  }));
  const r = validateSpec({
    v: 1,
    kind: "timeline",
    title: "t",
    events: [...events, { at: "no label" }],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.events.length, 10); // capped
  assert.equal(r.spec.events[0].label, "e0");
  assert.ok(r.spec.events.every((e) => e.color)); // every event got a color
});

test("timeline rejects when no valid events", () => {
  assert.equal(
    validateSpec({ v: 1, kind: "timeline", events: [{ at: "x" }, {}] }).ok,
    false,
  );
});

// ---- venn (2–3 sets + region labels keyed by cells) ----
test("venn normalizes cell keys, drops invalid regions, requires ≥2 sets", () => {
  const r = validateSpec({
    v: 1,
    kind: "venn",
    sets: [{ label: "A", color: "accent" }, { label: "B" }],
    regions: [
      { cells: "ba", label: "intersect" }, // normalized → "AB"
      { cells: "A", label: "only A" },
      { cells: "ABC", label: "no such set" }, // C doesn't exist (2 sets) → dropped
      { cells: "z", label: "garbage" }, // empty after norm → dropped
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.sets.length, 2);
  assert.ok(r.spec.sets[1].color); // 2nd set got a palette color
  const cells = r.spec.regions.map((x) => x.cells).sort();
  assert.deepEqual(cells, ["A", "AB"]);
});

test("venn accepts 3 sets and ABC region; rejects <2 sets", () => {
  const r = validateSpec({
    v: 1,
    kind: "venn",
    sets: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }],
    regions: [{ cells: "abc", label: "all" }],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.sets.length, 3); // 4th set capped off
  assert.equal(r.spec.regions[0].cells, "ABC");
  assert.equal(
    validateSpec({ v: 1, kind: "venn", sets: [{ label: "A" }] }).ok,
    false,
  );
});

// ---- surface3d (3D surfaces + a double-integral region) ----
test("surface3d validates surfaces + an ellipse region and parses asts (vars x AND y)", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    title: "∬",
    xRange: [-15, 15],
    yRange: [-10, 10],
    zRange: [0, 3],
    surfaces: [{ expr: "exp(1-(x^2/36+y^2/4))", color: "evTeal" }],
    region: { base: { type: "ellipse", cx: 0, cy: 0, a: 6, b: 2 }, label: "D" },
  });
  assert.ok(r.ok);
  assert.equal(r.spec.surfaces.length, 1);
  assert.ok(r.spec.surfaces[0]._ast); // expr parsed to an ast
  assert.equal(r.spec.region.base.type, "ellipse");
  assert.equal(r.spec.region.color, "success"); // default region color
  assert.ok(r.spec.region._surfaceAst); // integrand defaults to first surface
});

test("surface3d numerically integrates: ∬_D e^(1-(x²/36+y²/4)) dA = 12π(e-1)", () => {
  const { spec } = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "exp(1-(x^2/36+y^2/4))" }],
    region: { base: { type: "ellipse", cx: 0, cy: 0, a: 6, b: 2 } },
  });
  const val = estimateDoubleIntegral(
    spec.region._surfaceAst,
    spec.region.base,
    200,
  );
  assert.ok(Math.abs(val - 12 * Math.PI * (Math.E - 1)) < 0.8, `got ${val}`);
});

test("surface3d is fail-soft: off-whitelist surface exprs drop, a valid one survives", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "alert(1)" }, { expr: "x*y" }, { expr: "window" }],
  });
  assert.ok(r.ok);
  assert.deepEqual(
    r.spec.surfaces.map((s) => s.expr),
    ["x*y"],
  );
  assert.equal(r.spec.region, null); // no region given
});

test("surface3d rejects only when NO surface survives", () => {
  assert.equal(
    validateSpec({
      v: 1,
      kind: "surface3d",
      surfaces: [{ expr: "constructor" }],
    }).ok,
    false,
  );
  assert.equal(
    validateSpec({ v: 1, kind: "surface3d", surfaces: [] }).ok,
    false,
  );
});

test("surface3d caps at 3 surfaces, clamps opacity, defaults a bad range", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    xRange: [5, 1], // inverted → default
    surfaces: [
      { expr: "x", opacity: 9 },
      { expr: "y", opacity: 0.001 },
      { expr: "x+y" },
      { expr: "x-y" },
      { expr: "x*y" },
    ],
  });
  assert.equal(r.spec.surfaces.length, 3);
  assert.equal(r.spec.surfaces[0].opacity, 1); // clamped down
  assert.equal(r.spec.surfaces[1].opacity, 0.05); // clamped up
  assert.deepEqual(r.spec.xRange, [-5, 5]); // inverted range fell back
});

test("surface3d region: a bad base drops the region but keeps the surfaces", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x+y" }],
    region: { base: { type: "ellipse", a: -1, b: 2 } },
  });
  assert.ok(r.ok);
  assert.equal(r.spec.region, null);
  assert.equal(r.spec.surfaces.length, 1);
});

// The domain D is the part students most need to see, and the part the model most often
// serializes off-schema — historically the whole region was silently dropped (a bare
// surface). coerceBase3D folds the common drift into the canonical base so D still renders.
test("surface3d region: base as a STRING enum with fields flattened onto the region (the dropped-domain bug)", () => {
  // Exactly what the model emitted for the cone-inside-cylinder share: base:"ellipse" with
  // cx/cy AND rx/ry hoisted onto the region — previously → region null (no domain drawn).
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "sqrt(x^2+y^2)" }],
    region: { base: "ellipse", cx: 1, cy: 0, rx: 1, ry: 1 },
  });
  assert.ok(r.ok);
  assert.ok(r.spec.region, "the domain D must survive, not be dropped");
  assert.deepEqual(r.spec.region.base, {
    type: "ellipse",
    cx: 1,
    cy: 0,
    a: 1,
    b: 1,
  });
  assert.ok(r.spec.region._surfaceAst); // integrand defaults to the cone
});

test("surface3d region: ellipse semi-axes named rx/ry (nested) or a single radius/r are folded to a/b", () => {
  const rxry = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x+y" }],
    region: { base: { type: "ellipse", cx: 0, cy: 0, rx: 3, ry: 2 } },
  });
  assert.deepEqual(rxry.spec.region.base, {
    type: "ellipse",
    cx: 0,
    cy: 0,
    a: 3,
    b: 2,
  });
  const disk = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x+y" }],
    region: { base: "disk", cx: 2, cy: 0, r: 1.5 },
  }); // disk/circle → ellipse, r → a=b
  assert.deepEqual(disk.spec.region.base, {
    type: "ellipse",
    cx: 2,
    cy: 0,
    a: 1.5,
    b: 1.5,
  });
});

test("surface3d region: base as a 'rect' string with x/y flattened onto the region is folded to a rect base", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x*y" }],
    region: { base: "rect", x: [0, 2], y: [0, 3] },
  });
  assert.ok(r.ok);
  assert.deepEqual(r.spec.region.base, { type: "rect", x: [0, 2], y: [0, 3] });
});

test("surface3d region: coercion is idempotent and still rejects a truly malformed base", () => {
  const canon = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x" }],
    region: { base: { type: "ellipse", cx: 0, cy: 0, a: 6, b: 2 } },
  });
  assert.deepEqual(canon.spec.region.base, {
    type: "ellipse",
    cx: 0,
    cy: 0,
    a: 6,
    b: 2,
  }); // canonical passes through unchanged
  const nada = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x" }],
    region: { base: "ellipse" },
  }); // no coords at all
  assert.equal(nada.spec.region, null); // still dropped, surfaces kept
  assert.equal(nada.spec.surfaces.length, 1);
});

test("surface3d region.surface override goes through the no-eval engine; bad falls back to surface[0]", () => {
  const good = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x" }],
    region: {
      surface: "x^2+y^2",
      base: { type: "rect", x: [0, 1], y: [0, 1] },
    },
  });
  assert.equal(good.spec.region.surface, "x^2+y^2");
  const bad = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x" }],
    region: {
      surface: "alert(1)",
      base: { type: "rect", x: [0, 1], y: [0, 1] },
    },
  });
  assert.equal(bad.spec.region.surface, "x"); // fell back to first surface
});

test("surface3d region.lower (volume between two surfaces): parses _lowerAst; ∬(upper−lower) = 18", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "4" }, { expr: "1" }],
    region: {
      surface: "4",
      lower: "1",
      base: { type: "rect", x: [0, 2], y: [0, 3] },
    },
  });
  assert.ok(r.ok);
  assert.equal(r.spec.region.lower, "1");
  assert.ok(r.spec.region._lowerAst); // lower expr went through the no-eval parser
  const upper = estimateDoubleIntegral(
    r.spec.region._surfaceAst,
    r.spec.region.base,
    200,
  );
  const lower = estimateDoubleIntegral(
    r.spec.region._lowerAst,
    r.spec.region.base,
    200,
  );
  assert.ok(Math.abs(upper - lower - 18) < 0.05, `got ${upper - lower}`); // (4−1)·area(6)=18
});

test("surface3d region.lower is fail-soft: a bad lower expr drops to null (→ floor stays at z=0)", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "x^2+y^2" }],
    region: {
      lower: "alert(1)",
      base: { type: "ellipse", cx: 0, cy: 0, a: 1, b: 1 },
    },
  });
  assert.ok(r.ok); // region survives
  assert.equal(r.spec.region._lowerAst, null);
  assert.equal(r.spec.region.lower, "");
});

test("surface3d 'between' region: ∬ 1 dA over 0≤y≤x, 0≤x≤2 equals the area 2", () => {
  const { spec } = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "1" }],
    region: { base: { type: "between", x: [0, 2], lower: "0", upper: "x" } },
  });
  assert.equal(spec.region.base.type, "between");
  const area = estimateDoubleIntegral(
    spec.region._surfaceAst,
    spec.region.base,
    300,
  );
  assert.ok(Math.abs(area - 2) < 0.05, `got ${area}`);
});

test("surface3d geometry helpers: inRegion / regionBBox / regionBoundary", () => {
  const ellipse = { type: "ellipse", cx: 0, cy: 0, a: 6, b: 2 };
  assert.ok(inRegion(ellipse, 0, 0) && inRegion(ellipse, 5.9, 0));
  assert.ok(!inRegion(ellipse, 6.1, 0) && !inRegion(ellipse, 0, 2.1));
  assert.deepEqual(regionBBox(ellipse), [-6, 6, -2, 2]);
  const loop = regionBoundary(ellipse, 120);
  assert.ok(loop.length > 100);
  assert.ok(Math.abs(loop[0][0] - loop[loop.length - 1][0]) < 1e-6); // closed loop

  const rect = { type: "rect", x: [0, 2], y: [0, 3] };
  assert.ok(inRegion(rect, 1, 1) && !inRegion(rect, 3, 1));

  const { spec } = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "1" }],
    region: { base: { type: "between", x: [0, 2], lower: "0", upper: "x" } },
  });
  assert.ok(inRegion(spec.region.base, 1, 0.5)); // 0 ≤ 0.5 ≤ 1
  assert.ok(!inRegion(spec.region.base, 1, 1.5)); // 1.5 > upper(1)=1
});

// ---- generic coverage: parametric surfaces, type-II regions, 2D ellipse & parametric ----
test("surface3d parametric surface (sphere) validates with x,y,z of u,v", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [
      {
        x: "cos(u)*sin(v)",
        y: "sin(u)*sin(v)",
        z: "cos(v)",
        uRange: [0, 6.2832],
        vRange: [0, 3.1416],
      },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.spec.surfaces[0].kind, "param");
  assert.ok(
    r.spec.surfaces[0]._xAst &&
      r.spec.surfaces[0]._yAst &&
      r.spec.surfaces[0]._zAst,
  );
});

test("surface3d mixes parametric + explicit; region binds to the explicit integrand", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ x: "u", y: "v", z: "u*v" }, { expr: "x^2+y^2" }],
    region: { base: { type: "ellipse", cx: 0, cy: 0, a: 1, b: 1 } },
  });
  assert.ok(r.ok && r.spec.region && r.spec.region._surfaceAst);
});

test("surface3d type-II region (between-y): ∬ over 0≤x≤y, 0≤y≤2 = area 2", () => {
  const r = validateSpec({
    v: 1,
    kind: "surface3d",
    surfaces: [{ expr: "1" }],
    region: { base: { type: "between-y", y: [0, 2], left: "0", right: "y" } },
  });
  assert.equal(r.spec.region.base.type, "between-y");
  assert.ok(
    inRegion(r.spec.region.base, 0.5, 1) &&
      !inRegion(r.spec.region.base, 1.5, 1),
  );
  assert.ok(
    Math.abs(
      estimateDoubleIntegral(
        r.spec.region._surfaceAst,
        r.spec.region.base,
        300,
      ) - 2,
    ) < 0.05,
  );
});

test("geometry2d ellipse primitive validates (+ {a,b} alias)", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    ellipses: [{ cx: 1, cy: 0, rx: 6, ry: 2, fill: true }],
  });
  assert.equal(r.spec.items[0].type, "ellipse");
  assert.deepEqual([r.spec.items[0].rx, r.spec.items[0].ry], [6, 2]);
  const alias = validateSpec({
    v: 1,
    kind: "geometry2d",
    items: [{ type: "ellipse", cx: 0, cy: 0, a: 3, b: 1 }],
  });
  assert.deepEqual([alias.spec.items[0].rx, alias.spec.items[0].ry], [3, 1]);
});

test("geometry2d parametric curve routes through no-eval engine; bad one drops", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    parametrics: [{ x: "sin(3*t)", y: "sin(2*t)", t: [0, 6.2832] }],
  });
  assert.equal(r.spec.items[0].type, "parametric");
  assert.ok(r.spec.items[0]._xAst && r.spec.items[0]._yAst);
  const bad = validateSpec({
    v: 1,
    kind: "geometry2d",
    parametrics: [{ x: "foo(t)", y: "t" }],
    points: [{ x: 0, y: 0 }],
  });
  assert.equal(bad.spec.items.length, 1); // bad parametric dropped, point kept
  assert.equal(bad.spec.items[0].type, "point");
});

test("geometry2d region given as an ellipse → filled ellipse", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    regions: [{ cx: 0, cy: 0, rx: 3, ry: 1, label: "R" }],
  });
  assert.equal(r.spec.items[0].type, "ellipse");
  assert.ok(r.spec.items[0].fill);
});

// ---- logic-circuit (digital-logic schematic + boolean evaluation) ----
test("gateOutput: n-ary AND/OR + XOR odd-parity + inverted (NAND/NOR/XNOR)", () => {
  assert.equal(gateOutput("and", [1, 1, 1]), true);
  assert.equal(gateOutput("and", [1, 0, 1]), false);
  assert.equal(gateOutput("or", [0, 0, 1]), true);
  assert.equal(gateOutput("nand", [1, 1]), false);
  assert.equal(gateOutput("nor", [0, 0]), true);
  assert.equal(gateOutput("xor", [1, 1, 1]), true); // odd number of 1s
  assert.equal(gateOutput("xor", [1, 1, 0]), false); // even
  assert.equal(gateOutput("xnor", [1, 0]), false);
  assert.equal(gateOutput("not", [0]), true);
  assert.equal(gateOutput("buffer", [1]), true);
});

test("logic-circuit half-adder validates, auto-derives sink outputs, and evaluates", () => {
  const r = validateSpec({
    v: 1,
    kind: "logic-circuit",
    title: "half adder",
    inputs: [{ id: "A" }, { id: "B" }],
    gates: [
      { id: "S", type: "xor", inputs: ["A", "B"], label: "Sum" },
      { id: "C", type: "and", inputs: ["A", "B"], label: "Carry" },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.spec.outputs.map((o) => o.from).sort(), ["C", "S"]); // both are sinks
  const table = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ].map(([A, B]) => {
    const v = evalLogic(r.spec, { A, B });
    return [v.S, v.C];
  });
  assert.deepEqual(table, [
    [0, 0],
    [1, 0],
    [1, 0],
    [0, 1],
  ]);
});

test("logic-circuit is fail-soft: an unresolved ref drops its gate; valid gates survive", () => {
  const r = validateSpec({
    v: 1,
    kind: "logic-circuit",
    inputs: [{ id: "A" }, { id: "B" }],
    gates: [
      { id: "g1", type: "and", inputs: ["A", "NOPE"] },
      { id: "g2", type: "or", inputs: ["A", "B"] },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.spec.gates.map((g) => g.id),
    ["g2"],
  ); // g1 under-fed → dropped
  assert.deepEqual(
    r.spec.outputs.map((o) => o.from),
    ["g2"],
  );
});

test("logic-circuit prunes to a fixed point (a dropped gate dangles its consumer)", () => {
  const r = validateSpec({
    v: 1,
    kind: "logic-circuit",
    inputs: [{ id: "A" }],
    gates: [
      { id: "g1", type: "and", inputs: ["A", "X"] },
      { id: "g2", type: "or", inputs: ["g1", "A"] },
    ],
  });
  assert.equal(r.ok, false); // g1 drops (bad ref) → g2 loses a ref → also drops → nothing left
});

test("logic-circuit rejects with no inputs or no valid gate", () => {
  assert.equal(
    validateSpec({
      v: 1,
      kind: "logic-circuit",
      gates: [{ id: "g", type: "and", inputs: [] }],
    }).ok,
    false,
  );
  assert.equal(
    validateSpec({
      v: 1,
      kind: "logic-circuit",
      inputs: [{ id: "A" }],
      gates: [],
    }).ok,
    false,
  );
});

test("logic-circuit caps inputs (≤4) and honors explicit outputs", () => {
  const r = validateSpec({
    v: 1,
    kind: "logic-circuit",
    inputs: [1, 2, 3, 4, 5, 6].map((i) => ({ id: "i" + i })),
    gates: [{ id: "g", type: "or", inputs: ["i1", "i2"] }],
    outputs: [{ from: "g", label: "Y" }],
  });
  assert.equal(r.spec.inputs.length, 4);
  assert.deepEqual(r.spec.outputs, [{ from: "g", label: "Y" }]);
});

test("logic-circuit evaluation is cycle-safe (never hangs; back-edge → 0)", () => {
  const r = validateSpec({
    v: 1,
    kind: "logic-circuit",
    inputs: [{ id: "A" }],
    gates: [
      { id: "g1", type: "or", inputs: ["A", "g2"] },
      { id: "g2", type: "and", inputs: ["g1", "A"] },
    ],
  });
  assert.equal(r.ok, true);
  const v = evalLogic(r.spec, { A: 1 });
  assert.equal(v.g1, 1);
  assert.equal(v.g2, 0); // g2 sees g1 as 0 on the back-edge
});

// ---- geometry2d mechanics primitives (free-body / statics / dynamics) ----
test("geometry2d validates mechanics furniture and drops malformed ones", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    xRange: [-1, 6],
    yRange: [-1, 5],
    items: [
      {
        type: "incline",
        x: 0,
        y: 0,
        run: 4,
        angle: 30,
        face: "right",
        angleLabel: "θ",
        block: { at: 0.55, size: 0.8, label: "m" },
      },
      { type: "ground", y: 0 },
      { type: "spring", x1: 0, y1: 3, x2: 3, y2: 3, coils: 6, label: "k" },
      { type: "support", x: 5, y: 0, kind: "roller" },
      {
        type: "dimension",
        x1: 0,
        y1: -0.5,
        x2: 4,
        y2: -0.5,
        label: "L",
        offset: -0.3,
      },
      { type: "angle", x: 0, y: 0, start: 0, end: 30, label: "30°" },
      { type: "ramp", x: 0, y: 0, run: 2, angle: 200 }, // angle out of range → dropped
      { type: "support", x: 1, y: 0, kind: "bogus" }, // bad kind → coerced to pin
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.spec.items.map((i) => i.type),
    ["incline", "ground", "spring", "support", "dimension", "angle", "support"],
  );
  assert.equal(r.spec.items[0].block.color, "accent"); // block color defaulted (token)
  assert.equal(r.spec.items[6].kind, "pin"); // bad support kind coerced
});

test("geometry2d mechanics aliases normalize (ramp→incline, surface→ground, arc→angle)", () => {
  const r = validateSpec({
    v: 1,
    kind: "geometry2d",
    items: [
      { type: "ramp", x: 0, y: 0, run: 3, angle: 25 },
      { type: "surface", y: 0 },
      { type: "arc", x: 0, y: 0, start: 0, end: 45 },
    ],
  });
  assert.deepEqual(
    r.spec.items.map((i) => i.type),
    ["incline", "ground", "angle"],
  );
});

test("inclineVertices places the acute corner, right-angle corner, and top correctly", () => {
  const { A, B, C } = inclineVertices(0, 0, 4, 45, "right");
  assert.deepEqual(A, [0, 0]);
  assert.deepEqual(B, [4, 0]);
  assert.ok(Math.abs(C[0] - 4) < 1e-9 && Math.abs(C[1] - 4) < 1e-9); // 45° ⇒ rise = run
  const left = inclineVertices(0, 0, 4, 45, "left");
  assert.deepEqual(left.B, [-4, 0]); // face:left mirrors the base
});

test("inclineBlock sits flush on the ramp (base along A→C) on the outward side", () => {
  const c = inclineBlock(0, 0, 4, 45, "right", 0.5, 1);
  assert.equal(c.length, 4);
  // base edge (c0→c1) is parallel to the ramp A→C (slope 1) ⇒ equal Δx and Δy
  assert.ok(Math.abs(c[1][0] - c[0][0] - (c[1][1] - c[0][1])) < 1e-9);
  // the block is pushed to the upper-left (outward) side ⇒ its centroid is left of the base midpoint (2,2)
  const cxAvg = c.reduce((a, p) => a + p[0], 0) / 4;
  assert.ok(cxAvg < 2);
});

// ---- circuit (analog schematic on a grid) ----
test("circuit validates components, keeps polarity/ac/closed flags, rejects malformed", () => {
  const r = validateSpec({
    v: 1,
    kind: "circuit",
    title: "RC",
    components: [
      { type: "battery", at: [0, 0], to: [0, 4], label: "9V" },
      { type: "resistor", at: [0, 4], to: [5, 4], label: "R" },
      { type: "capacitor", at: [5, 4], to: [5, 0], label: "C" },
      { type: "switch", at: [2, 0], to: [4, 0], closed: true },
      { type: "source", at: [6, 0], to: [6, 3], ac: true },
      { type: "wire", at: [5, 0], to: [0, 0] },
      { type: "ground", at: [0, 0] },
      { type: "resistor", at: [0, 0], to: [3, 3] }, // diagonal → dropped
      { type: "lamp", at: [9, 9], to: [9, 9] }, // zero length → dropped
      { type: "flux_capacitor", at: [1, 1], to: [2, 1] }, // unknown type → dropped
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.spec.components.map((c) => c.type),
    ["battery", "resistor", "capacitor", "switch", "source", "wire", "ground"],
  );
  assert.equal(r.spec.components.find((c) => c.type === "switch").closed, true);
  assert.equal(r.spec.components.find((c) => c.type === "source").ac, true);
  assert.equal(r.spec.components[0].flip, false); // battery is polar → carries a flip flag
});

test("circuit ground infers a direction from at→to (default down)", () => {
  const r = validateSpec({
    v: 1,
    kind: "circuit",
    components: [
      { type: "wire", at: [0, 0], to: [2, 0] },
      { type: "ground", at: [2, 0], to: [2, 2] }, // downward
      { type: "ground", at: [0, 0] }, // default
    ],
  });
  assert.equal(r.spec.components[1].dir, "down");
  assert.equal(r.spec.components[2].dir, "down");
});

test("circuit rejects when nothing valid survives", () => {
  assert.equal(
    validateSpec({
      v: 1,
      kind: "circuit",
      components: [{ type: "resistor", at: [0, 0], to: [2, 2] }],
    }).ok,
    false,
  );
  assert.equal(
    validateSpec({ v: 1, kind: "circuit", components: [] }).ok,
    false,
  );
});

test("circuitJunctions marks only grid points where ≥3 terminals meet", () => {
  const { spec } = validateSpec({
    v: 1,
    kind: "circuit",
    components: [
      { type: "battery", at: [0, 0], to: [0, 4] },
      { type: "resistor", at: [0, 4], to: [4, 4] }, // [0,4]: battery.to + resistor.at = 2 (corner, no dot)
      { type: "wire", at: [0, 0], to: [4, 0] },
      { type: "wire", at: [0, 0], to: [-2, 0] }, // [0,0]: 3 terminals → junction
    ],
  });
  const j = circuitJunctions(spec.components);
  assert.deepEqual(j, [[0, 0]]);
});

// ---- geometry2d parametric tracer flag ----
test("geometry2d parametric carries a `trace` flag (moving-dot animation), default false", () => {
  const on = validateSpec({
    v: 1,
    kind: "geometry2d",
    items: [
      {
        type: "parametric",
        x: "cos(t)",
        y: "sin(t)",
        t: [0, 6.283],
        trace: true,
      },
    ],
  });
  assert.equal(on.spec.items[0].trace, true);
  const off = validateSpec({
    v: 1,
    kind: "geometry2d",
    parametrics: [{ x: "t", y: "t*t" }],
  });
  assert.equal(off.spec.items[0].trace, false);
});

// ---- plot time-animation (animate a parameter over a loop) ----
test("plot animate: keeps a valid param sweep, clamps period, drops an unknown param", () => {
  const base = {
    v: 1,
    kind: "parametric-plot",
    x: { var: "x", min: 0, max: 10 },
    params: [{ var: "phi", min: 0, max: 6.28, default: 0 }],
    curves: [{ expr: "sin(x - phi)" }],
  };
  assert.deepEqual(
    validateSpec({
      ...base,
      animate: { param: "phi", period: 3, loop: "bounce" },
    }).spec.animate,
    { param: "phi", period: 3, loop: "bounce" },
  );
  assert.deepEqual(
    validateSpec({ ...base, animate: { param: "phi", period: 999 } }).spec
      .animate,
    { param: "phi", period: 30, loop: "cycle" },
  ); // clamp + default loop
  assert.equal(
    validateSpec({ ...base, animate: { param: "nope" } }).spec.animate,
    null,
  ); // must reference a declared param
  assert.equal(validateSpec(base).spec.animate, null);
});
