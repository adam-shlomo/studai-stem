// Pure, dependency-free math engine for "Visual Explainers". The AI emits curve
// formulas as STRINGS; we must NEVER eval() them. This tokenizes →
// recursive-descent parses to an AST (whitelisted operators / functions / vars
// only, with a hard node cap) → evaluates numerically. Anything off the
// whitelist throws, and callers degrade gracefully (render the formula as text,
// never a broken chart). Pure → node:test. This module is the security boundary.

const FUNCS = {
  exp: { arity: 1, fn: (a) => Math.exp(a) },
  ln: { arity: 1, fn: (a) => Math.log(a) },
  log: { arity: 1, fn: (a) => Math.log10(a) },
  sin: { arity: 1, fn: (a) => Math.sin(a) },
  cos: { arity: 1, fn: (a) => Math.cos(a) },
  tan: { arity: 1, fn: (a) => Math.tan(a) },
  sqrt: { arity: 1, fn: (a) => Math.sqrt(a) },
  cbrt: { arity: 1, fn: (a) => Math.cbrt(a) },
  abs: { arity: 1, fn: (a) => Math.abs(a) },
  asin: { arity: 1, fn: (a) => Math.asin(a) },
  acos: { arity: 1, fn: (a) => Math.acos(a) },
  atan: { arity: 1, fn: (a) => Math.atan(a) },
  sinh: { arity: 1, fn: (a) => Math.sinh(a) },
  cosh: { arity: 1, fn: (a) => Math.cosh(a) },
  tanh: { arity: 1, fn: (a) => Math.tanh(a) },
  min: { arity: 2, fn: (a, b) => Math.min(a, b) },
  max: { arity: 2, fn: (a, b) => Math.max(a, b) },
  pow: { arity: 2, fn: (a, b) => Math.pow(a, b) },
  atan2: { arity: 2, fn: (a, b) => Math.atan2(a, b) },
};
const CONSTS = { pi: Math.PI, e: Math.E };
const MAX_NODES = 200;

// Curve colors are TOKEN NAMES (resolved against theme.js by the renderer) — the
// model can never inject a raw hex / off-brand color.
export const VIZ_COLORS = [
  "accent",
  "success",
  "warning",
  "evPurple",
  "evTeal",
  "evOrange",
  "evGreen",
  "textMuted",
];
const COLOR_SET = new Set(VIZ_COLORS);
const PLOT_KINDS = new Set(["parametric-plot", "function-compare"]);
// Exported so the client viz detector (RichText) and the answer sanitizer share ONE
// source of truth — a stale copy here is how a valid geometry2d spec leaked to the
// student as raw text instead of rendering.
export const VIZ_KINDS = new Set([
  ...PLOT_KINDS,
  "diagram",
  "memory-sim",
  "bracket-sim",
  "chart",
  "distribution",
  "table",
  "tree",
  "graph",
  "geometry2d",
  "transform2d",
  "slope-field",
  "surface3d",
  "numberline",
  "timeline",
  "venn",
  "logic-circuit",
  "circuit",
]);
const KINDS = VIZ_KINDS;
const NL = { POINTS: 12, INTERVALS: 6, LABEL: 24 }; // numberline caps
const TL = { EVENTS: 10, LABEL: 30, SUB: 20 }; // timeline caps
const VN = { SETS: 3, REGIONS: 7, LABEL: 24 }; // venn caps

// chart caps + sub-types. No expressions → no eval surface: numbers + bounded
// strings + token colors only.
const CHART_TYPES = new Set(["bar", "line", "pie", "scatter"]);
const CH = { LABELS: 12, SERIES: 4, POINTS: 60, NAME: 28, AXIS: 30 };
const TB = { ROWS: 12, COLS: 8, CELL: 40, HI: 24 }; // table caps
const TR = { NODES: 24, LABEL: 24 }; // tree caps
// geometry2d: a coordinate canvas of typed primitives. The ONLY expression field is
// a "function" item's expr, routed through the SAME no-eval parseExpr. Everything
// else is numbers + bounded strings + token colors.
const GEO = { ITEMS: 24, POLY: 12, LABEL: 24 };
const GEO_TYPES = new Set([
  "point",
  "vector",
  "segment",
  "line",
  "circle",
  "ellipse",
  "polygon",
  "sector",
  "label",
  "function",
  "parametric",
  // mechanics furniture (free-body / statics / dynamics): the renderer owns the tricky
  // geometry (a block always flush on the ramp, evenly-spaced hatching / coils) so the
  // model only picks placement. Aliases: ramp→incline, surface→ground, arc→angle.
  "incline",
  "ramp",
  "ground",
  "surface",
  "wall",
  "spring",
  "support",
  "dimension",
  "angle",
  "arc",
]);
const MECH_SUPPORTS = new Set(["pin", "roller", "fixed"]);

// surface3d: a 3D scene of z=f(x,y) surfaces (each expr routed through the SAME no-eval
// parser, allowed vars x AND y) plus ONE optional INTEGRATION REGION — the solid under a
// surface over a typed base domain D, which is exactly what ∬_D f dA measures.
const SURF = { SURFACES: 3, LABEL: 40 };
const BASE_TYPES = new Set(["rect", "ellipse", "between", "between-y"]);

// logic-circuit: a digital-logic schematic — boolean input sources feed a DAG of gates
// (AND/OR/NOT/…). No expressions → no eval surface: ids + a gate-type enum only. The
// renderer lays it out, evaluates it live as the student toggles inputs, and derives the
// truth table; evalLogic (below) is the shared, pure, cycle-safe boolean evaluator.
const GATE_TYPES = new Set([
  "and",
  "or",
  "not",
  "nand",
  "nor",
  "xor",
  "xnor",
  "buffer",
]);
const UNARY_GATES = new Set(["not", "buffer"]);
const LC = { INPUTS: 4, GATES: 14, OUTPUTS: 3, FANIN: 4, LABEL: 24, TITLE: 80 }; // ≤4 inputs → ≤16 truth-table rows

// circuit: an analog schematic. Components live on an integer GRID; each 2-terminal part
// spans an axis-aligned segment at→to (the renderer draws its standard symbol along the
// segment + lead wires), while `ground` is a single-terminal marker. No expressions →
// a component-type enum + integer coords only. circuitJunctions (below) is a pure helper.
const CIRCUIT_TWO = new Set([
  "wire",
  "resistor",
  "capacitor",
  "inductor",
  "battery",
  "source",
  "current_source",
  "diode",
  "led",
  "switch",
  "lamp",
  "fuse",
  "box",
]);
const CIRCUIT_TYPES = new Set([...CIRCUIT_TWO, "ground"]);
const POLAR = new Set(["battery", "source", "current_source", "diode", "led"]); // have a direction/polarity
const CIRC = { PARTS: 24, LABEL: 20, TITLE: 80, MIN: -2, MAX: 24 };

// memory-sim caps + helpers. This kind has NO expressions → it never touches the
// math engine; `code` lines are INERT display strings, never tokenized/evaluated.
const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MS = {
  CODE: 10,
  LINE: 80,
  FRAMES: 6,
  SLOTS: 16,
  OBJECTS: 6,
  REFS: 8,
  STEPS: 12,
  SHOW: 24,
  LABEL: 40,
  REFLBL: 24,
  CAP: 120,
};
const msColor = (c, fallback) => (c && COLOR_SET.has(c) ? c : fallback);

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function tokenize(src) {
  if (typeof src !== "string" || src.length > 2048)
    throw new Error("expression must be a string of at most 2048 characters");
  const s = src;
  const tokens = [];
  const isDigit = (c) => c >= "0" && c <= "9";
  const isAlpha = (c) =>
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(s[i + 1]))) {
      let j = i + 1;
      while (j < s.length && (isDigit(s[j]) || s[j] === ".")) j += 1;
      if (s[j] === "e" || s[j] === "E") {
        let k = j + 1;
        if (s[k] === "+" || s[k] === "-") k += 1;
        if (isDigit(s[k])) {
          j = k + 1;
          while (j < s.length && isDigit(s[j])) j += 1;
        }
      }
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new Error("bad number");
      tokens.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < s.length && (isAlpha(s[j]) || isDigit(s[j]))) j += 1;
      tokens.push({ t: "ident", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    throw new Error(`bad character: ${c}`);
  }
  return tokens;
}

// Recursive descent: expr → term (+/-) → factor (*//) → power (^, right-assoc)
// → unary (-) → primary (number | const | var | func(args) | (expr)).
export function parseExpr(src, allowedVars = []) {
  const tokens = tokenize(src);
  if (tokens.length > 400) throw new Error("expression too large");
  if (
    tokens.some(
      (t) =>
        t.t === "ident" &&
        ["__proto__", "prototype", "constructor"].includes(t.v),
    )
  )
    throw new Error("reserved identifier");
  const allowed = new Set(allowedVars);
  let pos = 0;
  let nodes = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  const node = (n) => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new Error("expression too large");
    return n;
  };

  function expr() {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = next().v;
      left = node({ type: "bin", op, left, right: term() });
    }
    return left;
  }
  function term() {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = next().v;
      left = node({ type: "bin", op, left, right: unary() });
    }
    return left;
  }
  // Unary minus binds looser than ^ (math convention: -2^2 = -(2^2) = -4).
  function unary() {
    if (isOp("-")) {
      next();
      return node({ type: "neg", arg: unary() });
    }
    if (isOp("+")) {
      next();
      return unary();
    }
    return power();
  }
  // ^ is right-associative; its exponent is a unary so 2^-1 parses.
  function power() {
    const base = primary();
    if (isOp("^")) {
      next();
      return node({ type: "bin", op: "^", left: base, right: unary() });
    }
    return base;
  }
  function primary() {
    const tk = next();
    if (!tk) throw new Error("unexpected end of expression");
    if (tk.t === "num") return node({ type: "num", value: tk.v });
    if (tk.t === "op" && tk.v === "(") {
      const e = expr();
      if (!isOp(")")) throw new Error("missing )");
      next();
      return e;
    }
    if (tk.t === "ident") {
      const name = tk.v;
      if (isOp("(")) {
        next();
        const fn = Object.hasOwn(FUNCS, name) ? FUNCS[name] : null;
        if (!fn) throw new Error(`unknown function: ${name}`);
        const args = [expr()];
        while (isOp(",")) {
          next();
          args.push(expr());
        }
        if (!isOp(")")) throw new Error("missing )");
        next();
        if (args.length !== fn.arity)
          throw new Error(`${name}() expects ${fn.arity} argument(s)`);
        return node({ type: "call", name, args });
      }
      if (Object.prototype.hasOwnProperty.call(CONSTS, name))
        return node({ type: "num", value: CONSTS[name] });
      if (allowed.has(name)) return node({ type: "var", name });
      throw new Error(`unknown identifier: ${name}`);
    }
    throw new Error("unexpected token");
  }

  const ast = expr();
  if (pos !== tokens.length) throw new Error("trailing tokens");
  return ast;
}

export function evalExpr(ast, scope = {}) {
  switch (ast.type) {
    case "num":
      return ast.value;
    case "var": {
      const v = scope[ast.name];
      return isNum(v) ? v : NaN;
    }
    case "neg":
      return -evalExpr(ast.arg, scope);
    case "bin": {
      const a = evalExpr(ast.left, scope);
      const b = evalExpr(ast.right, scope);
      if (ast.op === "+") return a + b;
      if (ast.op === "-") return a - b;
      if (ast.op === "*") return a * b;
      if (ast.op === "/") return a / b;
      if (ast.op === "^") return Math.pow(a, b);
      return NaN;
    }
    case "call":
      return FUNCS[ast.name].fn(...ast.args.map((x) => evalExpr(x, scope)));
    default:
      return NaN;
  }
}

// Validate + normalize a viz spec. Returns { ok, errors, spec } where each curve
// gets a parsed `_ast`. Mutates a shallow-normalized copy only.
export function validateSpec(input) {
  if (!input || typeof input !== "object")
    return { ok: false, errors: ["not an object"], spec: null };
  const spec = { ...input };
  const errors = [];
  if (spec.v !== 1) errors.push("unsupported version");
  if (!KINDS.has(spec.kind)) {
    errors.push(`unknown kind: ${spec.kind}`);
    return { ok: false, errors, spec: null };
  }
  if (spec.kind === "diagram") return validateDiagram(spec, errors);
  if (spec.kind === "memory-sim") return validateMemSim(spec, errors);
  if (spec.kind === "bracket-sim") return validateBracketSim(spec, errors);
  if (spec.kind === "chart") return validateChart(spec, errors);
  if (spec.kind === "distribution") return validateDistribution(spec, errors);
  if (spec.kind === "table") return validateTable(spec, errors);
  if (spec.kind === "tree") return validateTree(spec, errors);
  if (spec.kind === "graph") return validateGraph(spec, errors);
  if (spec.kind === "geometry2d") return validateGeometry(spec, errors);
  if (spec.kind === "transform2d") return validateTransform2D(spec, errors);
  if (spec.kind === "slope-field") return validateSlopeField(spec, errors);
  if (spec.kind === "surface3d") return validateSurface3D(spec, errors);
  if (spec.kind === "numberline") return validateNumberline(spec, errors);
  if (spec.kind === "timeline") return validateTimeline(spec, errors);
  if (spec.kind === "venn") return validateVenn(spec, errors);
  if (spec.kind === "logic-circuit") return validateLogicCircuit(spec, errors);
  if (spec.kind === "circuit") return validateCircuit(spec, errors);

  const x = spec.x;
  if (
    !x ||
    typeof x.var !== "string" ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x.var) ||
    !isNum(x.min) ||
    !isNum(x.max) ||
    x.max <= x.min
  ) {
    errors.push("bad x axis");
  }
  const vars = new Set();
  if (x && typeof x.var === "string") vars.add(x.var);

  const params = (Array.isArray(spec.params) ? spec.params : [])
    .slice(0, 4)
    .map((p) => ({ ...p }));
  params.forEach((p) => {
    if (
      !p ||
      typeof p.var !== "string" ||
      !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.var) ||
      !isNum(p.min) ||
      !isNum(p.max) ||
      p.max <= p.min
    ) {
      errors.push("bad param");
      return;
    }
    if (!isNum(p.default) || p.default < p.min || p.default > p.max)
      p.default = (p.min + p.max) / 2;
    if (!isNum(p.step) || p.step <= 0) p.step = (p.max - p.min) / 100;
    vars.add(p.var);
  });
  spec.params = params;

  const allowed = [...vars];
  const curves = (Array.isArray(spec.curves) ? spec.curves : [])
    .slice(0, 3)
    .map((c) => ({ ...c }));
  if (!curves.length) errors.push("need at least one curve");
  curves.forEach((c) => {
    if (!c || typeof c.expr !== "string") {
      errors.push("bad curve");
      return;
    }
    if (!c.color || !COLOR_SET.has(c.color)) c.color = "accent";
    try {
      c._ast = parseExpr(c.expr, allowed);
    } catch (e) {
      errors.push(`expr "${String(c.expr).slice(0, 40)}": ${e.message}`);
    }
  });
  spec.curves = curves;
  spec.regions = validateRegions(spec.regions, curves, x, errors);
  spec.animate = validateAnimate(spec.animate, params);

  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// Optional TIME ANIMATION for a plot: sweep ONE existing parameter over its [min,max] on a
// loop, so the curves recompute each frame — a traveling wave, a phase sweep, damping over
// time. The model only names the param to drive; the RENDERER owns the clock (rAF). Drops
// (→ null) if it doesn't reference a declared param.
function validateAnimate(raw, params) {
  if (!raw || typeof raw !== "object") return null;
  const p = (params || []).find((q) => q.var === raw.param);
  if (!p) return null;
  const period = isNum(raw.period)
    ? Math.max(0.5, Math.min(30, raw.period))
    : 5;
  return {
    param: p.var,
    period,
    loop: raw.loop === "bounce" ? "bounce" : "cycle",
  };
}

// Optional shaded regions on a plot — area UNDER a curve (integral / Riemann sum /
// p-value tail) or BETWEEN two curves (consumer-producer surplus, deadweight loss).
// No expressions of its own: it references existing curves by label (or index) and
// the renderer reuses their samples. Unknown references drop (fail-soft, like edges).
function validateRegions(raw, curves, x, errors) {
  if (!Array.isArray(raw)) return [];
  const byLabel = new Map();
  curves.forEach((c, i) => {
    if (c.label && !byLabel.has(c.label)) byLabel.set(c.label, i);
  });
  const idxOf = (ref) =>
    typeof ref === "number" && ref >= 0 && ref < curves.length
      ? ref
      : byLabel.has(ref)
        ? byLabel.get(ref)
        : undefined;
  const xMin = isNum(x && x.min) ? x.min : null,
    xMax = isNum(x && x.max) ? x.max : null;
  const clampX = (v, d) =>
    isNum(v) && xMin != null ? Math.max(xMin, Math.min(xMax, v)) : d;
  const out = [];
  for (const r of raw.slice(0, 4)) {
    if (!r || typeof r !== "object") continue;
    const type = r.type === "between" ? "between" : "under";
    const ci = idxOf(r.curve);
    if (ci === undefined) continue; // shades a curve that isn't there → drop
    let c2 = null;
    if (type === "between") {
      c2 = idxOf(r.curve2);
      if (c2 === undefined || c2 === ci) continue;
    }
    const from = clampX(r.from, xMin),
      to = clampX(r.to, xMax);
    if (xMin != null && !(to > from)) continue; // empty / inverted range → drop
    out.push({
      type,
      curve: ci,
      curve2: c2,
      from,
      to,
      color: COLOR_SET.has(r.color) ? r.color : "accent",
      label: typeof r.label === "string" ? r.label.slice(0, 40) : "",
    });
  }
  return out;
}

// Diagram: nodes (normalized 0..1 positions) + directed labeled edges. No
// expressions → no eval surface; just bounded strings/numbers + token colors.
function validateDiagram(spec, errors) {
  const nodes = (Array.isArray(spec.nodes) ? spec.nodes : [])
    .slice(0, 14)
    .map((n) => ({ ...n }));
  if (!nodes.length) errors.push("diagram needs nodes");
  const ids = new Set();
  nodes.forEach((n) => {
    if (
      !n ||
      typeof n.id !== "string" ||
      typeof n.label !== "string" ||
      !n.label.trim()
    ) {
      errors.push("bad node");
      return;
    }
    if (!isNum(n.x) || n.x < 0 || n.x > 1) n.x = 0.5;
    if (!isNum(n.y) || n.y < 0 || n.y > 1) n.y = 0.5;
    if (!n.color || !COLOR_SET.has(n.color)) n.color = "accent";
    n.label = String(n.label).slice(0, 60);
    ids.add(n.id);
  });
  spec.nodes = nodes;
  spec.edges = (Array.isArray(spec.edges) ? spec.edges : [])
    .slice(0, 24)
    .map((e) => ({ ...e }))
    .filter((e) => e && ids.has(e.from) && ids.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      label: typeof e.label === "string" ? e.label.slice(0, 40) : "",
    }));
  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// graph: a general network — nodes + edges (directed or not, optionally weighted), with the
// renderer computing a deterministic auto-LAYOUT (the model supplies NO coordinates, like tree).
// Optional `highlight` emphasizes a subset of nodes/edges — a shortest path, an MST, a visited
// set. No expressions → no eval surface; ids + bounded strings/numbers + token colors. Fail-soft,
// house style: an edge to a missing node drops (like a diagram edge), self-loops drop, duplicate
// edges dedupe; rejects only if no node survives. Edge identity: directed → ordered (from,to),
// undirected → the unordered pair, so a↔b is one edge and highlight matches either direction.
const GR = { NODES: 16, EDGES: 30, LABEL: 24, TITLE: 80, HL: 30 };

function validateGraph(spec, errors) {
  const title =
    typeof spec.title === "string" ? spec.title.slice(0, GR.TITLE) : "";
  const directed = !!spec.directed;
  const layout = spec.layout === "circular" ? "circular" : "force";
  const lab = (s, d = "") =>
    typeof s === "string" && s.trim() ? s.slice(0, GR.LABEL) : d;
  const col = (c, d) => (COLOR_SET.has(c) ? c : d);
  const edgeKey = (a, b) => (directed ? `${a} ${b}` : [a, b].sort().join(" "));

  const nodes = [],
    ids = new Set();
  for (const n of Array.isArray(spec.nodes) ? spec.nodes : []) {
    if (nodes.length >= GR.NODES) break;
    if (!n || typeof n.id !== "string" || !n.id.trim() || ids.has(n.id))
      continue;
    ids.add(n.id);
    nodes.push({
      id: n.id,
      label: lab(n.label, n.id),
      color: col(n.color, "accent"),
    });
  }
  if (!nodes.length) {
    errors.push("graph needs at least one node");
    return { ok: false, errors, spec: null };
  }

  const edges = [],
    seen = new Set();
  for (const e of Array.isArray(spec.edges) ? spec.edges : []) {
    if (edges.length >= GR.EDGES) break;
    if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue; // dangling / self-loop
    const key = edgeKey(e.from, e.to);
    if (seen.has(key)) continue; // dedupe
    seen.add(key);
    const weight = isNum(e.weight) ? e.weight : null;
    edges.push({
      from: e.from,
      to: e.to,
      weight,
      label: lab(e.label, weight != null ? String(weight) : ""),
      color: col(e.color, "textMuted"),
    });
  }

  let highlight = null;
  if (spec.highlight && typeof spec.highlight === "object") {
    const hn = [
      ...new Set(
        (Array.isArray(spec.highlight.nodes)
          ? spec.highlight.nodes
          : []
        ).filter((id) => ids.has(id)),
      ),
    ].slice(0, GR.HL);
    const present = new Set(edges.map((e) => edgeKey(e.from, e.to)));
    const he = [],
      heSeen = new Set();
    for (const p of Array.isArray(spec.highlight.edges)
      ? spec.highlight.edges
      : []) {
      if (he.length >= GR.EDGES) break;
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        !ids.has(p[0]) ||
        !ids.has(p[1]) ||
        p[0] === p[1]
      )
        continue;
      const key = edgeKey(p[0], p[1]);
      if (!present.has(key) || heSeen.has(key)) continue;
      heSeen.add(key);
      he.push(directed ? [p[0], p[1]] : [p[0], p[1]].slice().sort()); // canonical pair → idempotent re-validation
    }
    if (hn.length || he.length) highlight = { nodes: hn, edges: he };
  }

  return {
    ok: true,
    errors,
    spec: {
      v: 1,
      kind: "graph",
      title,
      directed,
      layout,
      nodes,
      edges,
      highlight,
    },
  };
}

// Chart: discrete data as bar / line / pie (categorical, aligned to `labels`) or
// scatter (xy point clouds). No expressions → no eval surface; numbers + bounded
// strings + token colors only. Series colors cycle the palette when unspecified.
function validateChart(spec, errors) {
  const type = CHART_TYPES.has(spec.chartType) ? spec.chartType : "bar";
  spec.chartType = type;
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  spec.x =
    spec.x && typeof spec.x.label === "string"
      ? { label: spec.x.label.slice(0, CH.AXIS) }
      : null;
  spec.y =
    spec.y && typeof spec.y.label === "string"
      ? { label: spec.y.label.slice(0, CH.AXIS) }
      : null;
  const color = (c, i) =>
    COLOR_SET.has(c) ? c : VIZ_COLORS[i % VIZ_COLORS.length];
  const name = (s) =>
    typeof (s && s.name) === "string" ? s.name.slice(0, CH.NAME) : "";

  if (type === "scatter") {
    spec.labels = [];
    spec.series = (Array.isArray(spec.series) ? spec.series : [])
      .slice(0, CH.SERIES)
      .map((s, i) => ({
        name: name(s),
        color: color(s && s.color, i),
        points: (Array.isArray(s && s.points) ? s.points : [])
          .slice(0, CH.POINTS)
          .filter((p) => p && isNum(p.x) && isNum(p.y))
          .map((p) => ({ x: p.x, y: p.y })),
      }))
      .filter((s) => s.points.length);
    if (!spec.series.length) errors.push("scatter chart needs points");
    return {
      ok: errors.length === 0,
      errors,
      spec: errors.length === 0 ? spec : null,
    };
  }

  // bar / line / pie — categorical: each series' data aligns to labels (pad/truncate).
  const labels = (Array.isArray(spec.labels) ? spec.labels : [])
    .slice(0, CH.LABELS)
    .map((l) => String(l == null ? "" : l).slice(0, CH.NAME));
  if (!labels.length) errors.push("chart needs labels");
  spec.labels = labels;
  let series = (Array.isArray(spec.series) ? spec.series : [])
    .slice(0, CH.SERIES)
    .map((s, i) => {
      const data = (Array.isArray(s && s.data) ? s.data : [])
        .slice(0, labels.length)
        .map((v) => (isNum(v) ? v : 0));
      while (data.length < labels.length) data.push(0);
      return { name: name(s), color: color(s && s.color, i), data };
    })
    .filter((s) => s.data.length);
  if (type === "pie") series = series.slice(0, 1); // a pie has one ring of slices
  if (!series.length) errors.push("chart needs a data series");
  spec.series = series;
  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// distribution: a named probability distribution (normal / t / chi-squared / exponential /
// uniform) drawn as its DENSITY curve, with an OPTIONAL shaded region (a tail or interval —
// p-value, rejection region, confidence area) and OPTIONAL vertical marks (a critical value
// z*, an observed statistic, the mean). This kind has the SMALLEST eval surface of any: a
// `dist` enum + numeric params only — NO expression is ever tokenized; the renderer builds
// the curve from the vetted pure `distPdf` below. Fail-soft, house style: bad params fall
// back to the distribution's defaults; a malformed shade / mark drops.
const DISTS = new Set(["normal", "t", "chisq", "exponential", "uniform"]);
const DIST_DEFAULTS = {
  normal: { mu: 0, sigma: 1 },
  t: { df: 5 },
  chisq: { df: 3 },
  exponential: { lambda: 1 },
  uniform: { a: 0, b: 1 },
};
const DST = { MARKS: 6, LABEL: 40 };

function validateDistribution(spec, errors) {
  const dist = DISTS.has(spec.dist) ? spec.dist : "normal";
  const title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const col = (c, d) => (COLOR_SET.has(c) ? c : d);
  const lab = (s) => (typeof s === "string" ? s.slice(0, DST.LABEL) : "");
  const raw = spec.params && typeof spec.params === "object" ? spec.params : {};
  const num = (v, d) => (isNum(v) ? v : d);
  const pos = (v, d) => (isNum(v) && v > 0 ? v : d);
  const D = DIST_DEFAULTS[dist];
  let params;
  if (dist === "normal")
    params = { mu: num(raw.mu, D.mu), sigma: pos(raw.sigma, D.sigma) };
  else if (dist === "t" || dist === "chisq") params = { df: pos(raw.df, D.df) };
  else if (dist === "exponential")
    params = {
      lambda: pos(isNum(raw.lambda) ? raw.lambda : raw.rate, D.lambda),
    };
  else {
    let a = num(raw.a, D.a),
      b = num(raw.b, D.b);
    if (!(b > a)) {
      a = D.a;
      b = D.b;
    }
    params = { a, b };
  }

  const [d0, d1] = distRange(dist, params);
  const xRange =
    Array.isArray(spec.xRange) &&
    isNum(spec.xRange[0]) &&
    isNum(spec.xRange[1]) &&
    spec.xRange[1] > spec.xRange[0]
      ? [spec.xRange[0], spec.xRange[1]]
      : [d0, d1];

  // shade: an optional highlighted probability region. from/to are x-values; EITHER may be
  // null for an OPEN tail (to:null = right tail X>from, from:null = left tail X<to). Needs at
  // least one finite endpoint; a fully-null shade drops.
  let shade = null;
  if (spec.shade && typeof spec.shade === "object") {
    let from = isNum(spec.shade.from) ? spec.shade.from : null;
    let to = isNum(spec.shade.to) ? spec.shade.to : null;
    if (from != null && to != null && to < from) {
      const t = from;
      from = to;
      to = t;
    }
    if (from != null || to != null)
      shade = {
        from,
        to,
        color: col(spec.shade.color, "warning"),
        label: lab(spec.shade.label),
      };
  }

  const marks = (Array.isArray(spec.marks) ? spec.marks : [])
    .slice(0, DST.MARKS)
    .filter((m) => m && isNum(m.x))
    .map((m) => ({
      x: m.x,
      label: lab(m.label),
      color: col(m.color, "accent"),
    }));

  return {
    ok: errors.length === 0,
    errors,
    spec:
      errors.length === 0
        ? {
            v: 1,
            kind: "distribution",
            title,
            dist,
            params,
            xRange,
            shade,
            marks,
          }
        : null,
  };
}

// Table / matrix: a rectangular grid of cell strings (truth tables, matrices, Punnett
// squares, comparison tables). Optional header row/col styling + per-cell highlights.
// No expressions → no eval surface; cells are inert display strings.
function validateTable(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const rows = (Array.isArray(spec.rows) ? spec.rows : [])
    .slice(0, TB.ROWS)
    .map((row) =>
      (Array.isArray(row) ? row : [])
        .slice(0, TB.COLS)
        .map((c) => String(c == null ? "" : c).slice(0, TB.CELL)),
    );
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (!rows.length || !cols) {
    errors.push("table needs rows");
    return { ok: false, errors, spec: null };
  }
  rows.forEach((r) => {
    while (r.length < cols) r.push("");
  }); // pad to a rectangle
  spec.rows = rows;
  spec.cols = cols;
  spec.headerRow = !!spec.headerRow;
  spec.headerCol = !!spec.headerCol;
  spec.highlight = (Array.isArray(spec.highlight) ? spec.highlight : [])
    .slice(0, TB.HI)
    .filter(
      (h) =>
        h &&
        Number.isInteger(h.r) &&
        Number.isInteger(h.c) &&
        h.r >= 0 &&
        h.r < rows.length &&
        h.c >= 0 &&
        h.c < cols,
    )
    .map((h) => ({
      r: h.r,
      c: h.c,
      color: COLOR_SET.has(h.color) ? h.color : "accent",
    }));
  return { ok: true, errors, spec };
}

// Tree: a hierarchy of {id, label, parent?} nodes. The RENDERER computes a tidy
// deterministic leveled layout (the model never supplies coordinates → no cramped
// hand-placement, no 14-node ceiling). Dangling/self/cyclic parents become roots
// (fail-soft, a forest is allowed). No expressions → no eval surface.
function validateTree(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const nodes = [],
    ids = new Set();
  for (const n of (Array.isArray(spec.nodes) ? spec.nodes : []).slice(
    0,
    TR.NODES,
  )) {
    if (
      !n ||
      typeof n.id !== "string" ||
      ids.has(n.id) ||
      typeof n.label !== "string" ||
      !n.label.trim()
    )
      continue;
    ids.add(n.id);
    nodes.push({
      id: n.id,
      label: n.label.slice(0, TR.LABEL),
      parent: typeof n.parent === "string" ? n.parent : null,
      color: COLOR_SET.has(n.color) ? n.color : "accent",
    });
  }
  if (!nodes.length) {
    errors.push("tree needs nodes");
    return { ok: false, errors, spec: null };
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  nodes.forEach((n) => {
    if (n.parent && (!byId.has(n.parent) || n.parent === n.id)) n.parent = null;
  }); // dangling/self → root
  nodes.forEach((n) => {
    // break cycles: walk up, cut on revisit
    const seen = new Set([n.id]);
    let cur = n.parent;
    while (cur) {
      if (seen.has(cur)) {
        n.parent = null;
        break;
      }
      seen.add(cur);
      cur = (byId.get(cur) || {}).parent || null;
    }
  });
  spec.nodes = nodes;
  return { ok: true, errors, spec };
}

// geometry2d — a coordinate canvas (xRange × yRange) of typed primitives: point,
// vector (arrow), segment, line, circle, polygon, label, and function (y=f(x), the
// ONLY expression field, parsed by the same no-eval engine). For vectors, free-body
// diagrams, geometry figures, ε-δ bands. Fail-soft: a primitive with bad coords / a
// bad function expr is dropped; the spec rejects only if NOTHING survives.
function validateGeometry(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const range = (r, d0, d1) =>
    Array.isArray(r) && isNum(r[0]) && isNum(r[1]) && r[1] > r[0]
      ? [r[0], r[1]]
      : [d0, d1];
  spec.xRange = range(spec.xRange, -5, 5);
  spec.yRange = range(spec.yRange, -5, 5);
  // grid: true (square, default) | false (off) | "polar" (concentric rings + radial
  // spokes) — the polar grid shows a region/curve in its polar coordinates (r, θ).
  spec.grid = spec.grid === "polar" ? "polar" : spec.grid !== false;
  spec.axes = spec.axes !== false;
  // Optional axis names drawn at the arrow tips (e.g. "x"/"y") — off unless provided.
  spec.xLabel = typeof spec.xLabel === "string" ? spec.xLabel.slice(0, 12) : "";
  spec.yLabel = typeof spec.yLabel === "string" ? spec.yLabel.slice(0, 12) : "";
  const col = (c, d = "accent") => (COLOR_SET.has(c) ? c : d);
  const lab = (s) => (typeof s === "string" ? s.slice(0, GEO.LABEL) : "");
  // Models also name the mixed-primitive array `elements`/`shapes`/`objects` — accept
  // those as aliases for `items` so a typed-primitive array under any of those keys
  // renders instead of vanishing (the whole array was silently ignored otherwise).
  if (!Array.isArray(spec.items)) {
    const aliased = [spec.elements, spec.shapes, spec.objects].find(
      Array.isArray,
    );
    if (aliased) spec.items = aliased;
  }
  // Tolerance: models sometimes emit per-type arrays (points/vectors/segments/…) or
  // vectors as {x,y,dx,dy} instead of the canonical items:[{type,…}] — normalize the
  // common shapes into `items` so a slightly-off spec renders instead of vanishing.
  if (!Array.isArray(spec.items)) {
    const merged = [];
    const add = (arr, map) =>
      (Array.isArray(arr) ? arr : []).forEach((o) => {
        if (o) merged.push(map(o));
      });
    add(spec.points, (o) => ({ type: "point", ...o }));
    add(spec.vectors, (o) =>
      isNum(o.x) && isNum(o.y) && (isNum(o.dx) || isNum(o.dy))
        ? {
            type: "vector",
            x1: o.x,
            y1: o.y,
            x2: o.x + (Number(o.dx) || 0),
            y2: o.y + (Number(o.dy) || 0),
            color: o.color,
            label: o.label,
          }
        : { ...o, type: "vector" },
    );
    add(spec.segments, (o) => ({ ...o, type: "segment" }));
    add(spec.lines, (o) => ({ ...o, type: "line" }));
    add(spec.circles, (o) => ({ ...o, type: "circle" }));
    add(spec.polygons, (o) => ({ ...o, type: "polygon" }));
    add(spec.labels, (o) => ({ ...o, type: "label" }));
    add(spec.functions, (o) => ({ ...o, type: "function" }));
    add(spec.curves, (o) => ({ ...o, type: "function" }));
    add(spec.ellipses, (o) => ({ ...o, type: "ellipse" }));
    add(spec.parametrics, (o) => ({ ...o, type: "parametric" }));
    // A spatial "regions" array (a habit models borrow from plots) → filled shapes, so an
    // integration domain D renders as a shaded disk/ellipse/polygon instead of being dropped.
    add(spec.regions, (o) => {
      if (Array.isArray(o.points)) return { ...o, type: "polygon", fill: true };
      if (
        Array.isArray(o.x) &&
        Array.isArray(o.y) &&
        o.x.length === 2 &&
        o.y.length === 2
      )
        return {
          type: "polygon",
          points: [
            [o.x[0], o.y[0]],
            [o.x[1], o.y[0]],
            [o.x[1], o.y[1]],
            [o.x[0], o.y[1]],
          ],
          color: o.color,
          label: o.label,
          fill: true,
        };
      if (isNum(o.rx) || isNum(o.ry) || (isNum(o.a) && isNum(o.b)))
        return { ...o, type: "ellipse", fill: true };
      return { ...o, type: "circle", fill: true };
    });
    if (merged.length) spec.items = merged;
  }
  // Tolerance: models address coordinates as tuples ([x,y]) or under aliases
  // (pos/p/at/center/c for anchors; from/to/start/end/p1/p2 for endpoints) instead of
  // the canonical flat fields (x/y, cx/cy, x1/y1/x2/y2). Fold those in so a
  // geometrically-valid primitive renders instead of being dropped on a shape nitpick.
  const asXY = (v) =>
    Array.isArray(v) && isNum(v[0]) && isNum(v[1])
      ? [v[0], v[1]]
      : v && isNum(v.x) && isNum(v.y)
        ? [v.x, v.y]
        : null;
  const foldCoords = (it) => {
    const t = it.type;
    if (t === "point" || t === "label" || t === "circle" || t === "ellipse") {
      const anc =
        asXY(it.pos) ||
        asXY(it.p) ||
        asXY(it.at) ||
        asXY(it.center) ||
        asXY(it.c);
      if (anc) {
        if (t === "circle" || t === "ellipse") {
          if (!isNum(it.cx)) it.cx = anc[0];
          if (!isNum(it.cy)) it.cy = anc[1];
        } else {
          if (!isNum(it.x)) it.x = anc[0];
          if (!isNum(it.y)) it.y = anc[1];
        }
      }
    } else if (t === "vector" || t === "segment" || t === "line") {
      const pts = Array.isArray(it.points) ? it.points : null;
      const a =
        asXY(it.from) ||
        asXY(it.start) ||
        asXY(it.p1) ||
        (pts ? asXY(pts[0]) : null);
      const b =
        asXY(it.to) ||
        asXY(it.end) ||
        asXY(it.p2) ||
        (pts ? asXY(pts[1]) : null);
      if (a) {
        if (!isNum(it.x1)) it.x1 = a[0];
        if (!isNum(it.y1)) it.y1 = a[1];
      }
      if (b) {
        if (!isNum(it.x2)) it.x2 = b[0];
        if (!isNum(it.y2)) it.y2 = b[1];
      }
    }
    return it;
  };
  const items = [];
  for (const raw of Array.isArray(spec.items) ? spec.items : []) {
    if (items.length >= GEO.ITEMS || !raw || !GEO_TYPES.has(raw.type)) continue;
    const it = foldCoords(raw);
    const t = it.type;
    if (t === "point") {
      if (isNum(it.x) && isNum(it.y))
        items.push({
          type: "point",
          x: it.x,
          y: it.y,
          label: lab(it.label),
          color: col(it.color),
        });
    } else if (t === "label") {
      if (isNum(it.x) && isNum(it.y))
        items.push({
          type: "label",
          x: it.x,
          y: it.y,
          text: lab(it.text || it.label),
          color: col(it.color, "textMuted"),
        });
    } else if (t === "vector" || t === "segment" || t === "line") {
      if (isNum(it.x1) && isNum(it.y1) && isNum(it.x2) && isNum(it.y2))
        items.push({
          type: t,
          x1: it.x1,
          y1: it.y1,
          x2: it.x2,
          y2: it.y2,
          label: lab(it.label),
          color: col(it.color, t === "vector" ? "accent" : "textMuted"),
          dashed: !!it.dashed,
        });
    } else if (t === "circle") {
      // Tolerate the circle shapes models emit: {cx,cy,r} | {center:{x,y},radius} | {x,y,r}.
      const ccx = isNum(it.cx)
        ? it.cx
        : it.center && isNum(it.center.x)
          ? it.center.x
          : it.x;
      const ccy = isNum(it.cy)
        ? it.cy
        : it.center && isNum(it.center.y)
          ? it.center.y
          : it.y;
      const cr = isNum(it.r) ? it.r : it.radius;
      if (isNum(ccx) && isNum(ccy) && isNum(cr) && cr > 0)
        items.push({
          type: "circle",
          cx: ccx,
          cy: ccy,
          r: cr,
          color: col(it.color),
          fill: !!it.fill,
          label: lab(it.label),
        });
    } else if (t === "ellipse") {
      const ecx = isNum(it.cx)
        ? it.cx
        : it.center && isNum(it.center.x)
          ? it.center.x
          : it.x;
      const ecy = isNum(it.cy)
        ? it.cy
        : it.center && isNum(it.center.y)
          ? it.center.y
          : it.y;
      const erx = isNum(it.rx) ? it.rx : it.a,
        ery = isNum(it.ry) ? it.ry : it.b;
      if (
        isNum(ecx) &&
        isNum(ecy) &&
        isNum(erx) &&
        isNum(ery) &&
        erx > 0 &&
        ery > 0
      )
        items.push({
          type: "ellipse",
          cx: ecx,
          cy: ecy,
          rx: erx,
          ry: ery,
          color: col(it.color),
          fill: !!it.fill,
          label: lab(it.label),
        });
    } else if (t === "parametric") {
      // Any plane curve x(t), y(t): conics, polar r(θ), spirals, Lissajous, cycloids…
      if (typeof it.x === "string" && typeof it.y === "string") {
        try {
          const _xAst = parseExpr(it.x, ["t"]),
            _yAst = parseExpr(it.y, ["t"]);
          const tr =
            Array.isArray(it.t) &&
            isNum(it.t[0]) &&
            isNum(it.t[1]) &&
            it.t[1] > it.t[0]
              ? [it.t[0], it.t[1]]
              : [0, 2 * Math.PI];
          items.push({
            type: "parametric",
            x: it.x,
            y: it.y,
            _xAst,
            _yAst,
            t: tr,
            color: col(it.color),
            dashed: !!it.dashed,
            label: lab(it.label),
            trace: !!it.trace,
          });
        } catch {
          /* drop a bad parametric curve, fail-soft */
        }
      }
    } else if (t === "polygon") {
      const pts = (Array.isArray(it.points) ? it.points : [])
        .slice(0, GEO.POLY)
        .filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))
        .map((p) => [p[0], p[1]]);
      if (pts.length >= 2)
        items.push({
          type: "polygon",
          points: pts,
          color: col(it.color),
          fill: !!it.fill,
          label: lab(it.label),
        });
    } else if (t === "sector") {
      // A polar region bounded by REAL arcs r=const and rays θ=const: a FULL ring/disk
      // (omit the angles), an annular sector (r1>0 + angles), or a disk sector (r1=0). theta
      // in RADIANS (matches the polar grid + parametric t). The renderer draws the arcs, so a
      // region hugs the rings instead of being a chorded polygon. Aliases: r/radius, startAngle/endAngle.
      const scx = isNum(it.cx)
        ? it.cx
        : it.center && isNum(it.center.x)
          ? it.center.x
          : 0;
      const scy = isNum(it.cy)
        ? it.cy
        : it.center && isNum(it.center.y)
          ? it.center.y
          : 0;
      const rOuter = isNum(it.r2) ? it.r2 : isNum(it.r) ? it.r : it.radius;
      const rInner = isNum(it.r1) ? it.r1 : 0;
      const th1 = isNum(it.theta1)
        ? it.theta1
        : isNum(it.startAngle)
          ? it.startAngle
          : 0;
      let th2 = isNum(it.theta2)
        ? it.theta2
        : isNum(it.endAngle)
          ? it.endAngle
          : null;
      if (th2 == null) th2 = th1 + 2 * Math.PI; // no end angle → a FULL ring / disk
      if (isNum(rOuter) && rOuter > 0 && Math.abs(th2 - th1) > 1e-6) {
        const ro = Math.max(Math.abs(rInner), rOuter),
          ri = Math.min(Math.abs(rInner), rOuter);
        items.push({
          type: "sector",
          cx: scx,
          cy: scy,
          r1: ri,
          r2: ro,
          theta1: th1,
          theta2: th2,
          color: col(it.color),
          fill: it.fill !== false,
          label: lab(it.label),
        });
      }
    } else if (t === "function") {
      if (typeof it.expr === "string") {
        try {
          items.push({
            type: "function",
            expr: it.expr,
            _ast: parseExpr(it.expr, ["x"]),
            color: col(it.color),
          });
        } catch {
          /* drop a bad function, fail-soft */
        }
      }
    } else if (t === "incline" || t === "ramp") {
      // right-triangle ramp: {x,y}=the acute-angle corner ON the ground, run=base length,
      // angle=slope degrees (0<θ<89), face=which way it descends. Optional flush `block`.
      if (
        isNum(it.x) &&
        isNum(it.y) &&
        isNum(it.run) &&
        it.run > 0 &&
        isNum(it.angle) &&
        it.angle > 0 &&
        it.angle < 89
      ) {
        const b = it.block;
        const block =
          b && typeof b === "object" && isNum(b.size) && b.size > 0
            ? {
                at: isNum(b.at) ? Math.max(0, Math.min(1, b.at)) : 0.5,
                size: b.size,
                label: lab(b.label),
                color: col(b.color, "accent"),
              }
            : null;
        items.push({
          type: "incline",
          x: it.x,
          y: it.y,
          run: it.run,
          angle: it.angle,
          face: it.face === "left" ? "left" : "right",
          angleLabel: lab(it.angleLabel),
          label: lab(it.label),
          color: col(it.color, "textMuted"),
          block,
        });
      }
    } else if (t === "ground" || t === "surface") {
      if (isNum(it.y))
        items.push({
          type: "ground",
          y: it.y,
          x1: isNum(it.x1) ? it.x1 : null,
          x2: isNum(it.x2) ? it.x2 : null,
          label: lab(it.label),
          color: col(it.color, "textMuted"),
        });
    } else if (t === "wall") {
      if (isNum(it.x) && isNum(it.y) && isNum(it.h) && it.h !== 0)
        items.push({
          type: "wall",
          x: it.x,
          y: it.y,
          h: it.h,
          face: it.face === "left" ? "left" : "right",
          label: lab(it.label),
          color: col(it.color, "textMuted"),
        });
    } else if (t === "spring") {
      if (isNum(it.x1) && isNum(it.y1) && isNum(it.x2) && isNum(it.y2))
        items.push({
          type: "spring",
          x1: it.x1,
          y1: it.y1,
          x2: it.x2,
          y2: it.y2,
          coils: isNum(it.coils)
            ? Math.max(3, Math.min(20, Math.trunc(it.coils)))
            : null,
          label: lab(it.label),
          color: col(it.color, "textMuted"),
        });
    } else if (t === "support") {
      if (isNum(it.x) && isNum(it.y))
        items.push({
          type: "support",
          x: it.x,
          y: it.y,
          kind: MECH_SUPPORTS.has(it.kind) ? it.kind : "pin",
          label: lab(it.label),
          color: col(it.color, "textMuted"),
        });
    } else if (t === "dimension") {
      if (isNum(it.x1) && isNum(it.y1) && isNum(it.x2) && isNum(it.y2))
        items.push({
          type: "dimension",
          x1: it.x1,
          y1: it.y1,
          x2: it.x2,
          y2: it.y2,
          offset: isNum(it.offset) ? it.offset : 0,
          label: lab(it.label),
          color: col(it.color, "textMuted"),
        });
    } else if (t === "angle" || t === "arc") {
      if (
        isNum(it.x) &&
        isNum(it.y) &&
        isNum(it.start) &&
        isNum(it.end) &&
        it.end !== it.start
      )
        items.push({
          type: "angle",
          x: it.x,
          y: it.y,
          start: it.start,
          end: it.end,
          r: isNum(it.r) && it.r > 0 ? it.r : null,
          label: lab(it.label),
          color: col(it.color, "warning"),
        });
    }
  }
  if (!items.length) errors.push("geometry2d needs at least one valid item");
  spec.items = items;
  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// transform2d: a 2×2 linear map acting on the plane — the visual heart of linear algebra. The
// model gives ONLY a numeric matrix (+ a few display toggles), so this has essentially NO eval
// surface. The renderer animates the identity→M deformation of the unit grid, draws the transformed
// basis vectors (the COLUMNS of M), and — on request — the unit circle→ellipse and the real
// eigenvector directions (via the pure eigen2x2 below). Fail-soft: a non-finite matrix entry falls
// back to the identity's; a singular matrix still renders (the grid collapses onto a line — the point).
const TF = { LABEL: 24, VECS: 4 };

function validateTransform2D(spec, errors) {
  const title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const col = (c, d) => (COLOR_SET.has(c) ? c : d);
  const lab = (s) => (typeof s === "string" ? s.slice(0, TF.LABEL) : "");
  const raw = Array.isArray(spec.matrix) ? spec.matrix : [];
  const cell = (v, d) => (isNum(v) ? Math.max(-50, Math.min(50, v)) : d);
  const matrix = [
    [cell(raw[0] && raw[0][0], 1), cell(raw[0] && raw[0][1], 0)],
    [cell(raw[1] && raw[1][0], 0), cell(raw[1] && raw[1][1], 1)],
  ];
  const s = spec.show && typeof spec.show === "object" ? spec.show : {};
  const show = {
    grid: s.grid !== false,
    basis: s.basis !== false,
    eigen: !!s.eigen,
    unitCircle: !!s.unitCircle,
  };
  const vectors = (Array.isArray(spec.vectors) ? spec.vectors : [])
    .slice(0, TF.VECS)
    .filter((v) => v && isNum(v.x) && isNum(v.y) && (v.x !== 0 || v.y !== 0))
    .map((v) => ({
      x: v.x,
      y: v.y,
      label: lab(v.label),
      color: col(v.color, "warning"),
    }));
  const range =
    isNum(spec.range) && spec.range > 0
      ? Math.max(2, Math.min(12, Math.round(spec.range)))
      : 5;
  const animate = spec.animate !== false;
  return {
    ok: errors.length === 0,
    errors,
    spec:
      errors.length === 0
        ? {
            v: 1,
            kind: "transform2d",
            title,
            matrix,
            show,
            vectors,
            range,
            animate,
          }
        : null,
  };
}

// numberline — a 1D axis with marked points (filled / hollow) and shaded intervals
// (open / closed endpoints). For inequalities, interval notation, sign charts.
function validateNumberline(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const min = isNum(spec.min) ? spec.min : -5;
  const max = isNum(spec.max) && spec.max > min ? spec.max : min + 10;
  spec.min = min;
  spec.max = max;
  const clamp = (x) => Math.max(min, Math.min(max, x));
  const lab = (s) => (typeof s === "string" ? s.slice(0, NL.LABEL) : "");
  const col = (c, d) => (COLOR_SET.has(c) ? c : d);
  spec.points = (Array.isArray(spec.points) ? spec.points : [])
    .slice(0, NL.POINTS)
    .filter((p) => p && isNum(p.x))
    .map((p) => ({
      x: clamp(p.x),
      label: lab(p.label),
      color: col(p.color, "accent"),
      open: !!p.open,
    }));
  spec.intervals = (Array.isArray(spec.intervals) ? spec.intervals : [])
    .slice(0, NL.INTERVALS)
    .filter((iv) => iv && isNum(iv.from) && isNum(iv.to))
    .map((iv) => ({
      from: clamp(Math.min(iv.from, iv.to)),
      to: clamp(Math.max(iv.from, iv.to)),
      color: col(iv.color, "success"),
      openFrom: !!iv.openFrom,
      openTo: !!iv.openTo,
      label: lab(iv.label),
    }))
    .filter((iv) => iv.to > iv.from);
  if (!spec.points.length && !spec.intervals.length)
    errors.push("numberline needs points or intervals");
  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// timeline — ordered events along a horizontal axis (sequence, history, scheduling).
function validateTimeline(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  spec.events = (Array.isArray(spec.events) ? spec.events : [])
    .slice(0, TL.EVENTS)
    .filter((e) => e && typeof e.label === "string" && e.label.trim())
    .map((e, i) => ({
      label: e.label.slice(0, TL.LABEL),
      at: typeof e.at === "string" ? e.at.slice(0, TL.SUB) : "",
      color: COLOR_SET.has(e.color)
        ? e.color
        : VIZ_COLORS[i % VIZ_COLORS.length],
    }));
  if (!spec.events.length) errors.push("timeline needs events");
  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// venn — 2 or 3 labeled overlapping sets, with optional region labels keyed by which
// sets they lie in ("A", "B", "AB", "ABC", …). For set operations / logic.
function validateVenn(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const palette = ["accent", "evTeal", "warning"];
  const sets = (Array.isArray(spec.sets) ? spec.sets : [])
    .slice(0, VN.SETS)
    .filter((s) => s && typeof s.label === "string" && s.label.trim())
    .map((s, i) => ({
      label: s.label.slice(0, VN.LABEL),
      color: COLOR_SET.has(s.color) ? s.color : palette[i],
    }));
  if (sets.length < 2) {
    errors.push("venn needs 2–3 sets");
    return { ok: false, errors, spec: null };
  }
  spec.sets = sets;
  const letters = sets.map((_, i) => "ABC"[i]);
  // normalize a cell key to sorted-unique uppercase set letters. A stray letter that
  // names a set which doesn't exist (e.g. "C" on a 2-set venn) invalidates the region.
  const norm = (c) => {
    const up = String(c || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    if (!up) return "";
    const chars = [...new Set(up.split(""))];
    if (chars.some((ch) => !letters.includes(ch))) return "";
    return chars.sort().join("");
  };
  const seen = new Set();
  spec.regions = (Array.isArray(spec.regions) ? spec.regions : [])
    .slice(0, VN.REGIONS)
    .map((r) =>
      r && typeof r.label === "string"
        ? { cells: norm(r.cells), label: r.label.slice(0, VN.LABEL) }
        : null,
    )
    .filter((r) => r && r.cells && !seen.has(r.cells) && seen.add(r.cells));
  return { ok: true, errors, spec };
}

// logic-circuit — a digital-logic schematic the student can toggle. The model supplies
// boolean `inputs` (sources), `gates` (each a type + refs to other nodes by id), and
// optional `outputs` (else the renderer derives the sink gates). Everything is ids +
// a gate-type enum → NO expression surface. Fail-soft, house style: an unresolved gate
// ref is pruned, a gate left under-fed for its type drops, and the whole spec rejects
// only if no gate survives. The renderer computes the layout; the model never places
// anything. Ids share ONE namespace across inputs + gates (a ref names either).
function validateLogicCircuit(spec, errors) {
  const title =
    typeof spec.title === "string" ? spec.title.slice(0, LC.TITLE) : "";
  const lab = (s, d) =>
    typeof s === "string" && s.trim() ? s.slice(0, LC.LABEL) : d;
  const ids = new Set();

  // inputs — boolean sources (≤4 so the derived truth table stays ≤16 rows)
  const inputs = [];
  for (const n of Array.isArray(spec.inputs) ? spec.inputs : []) {
    if (inputs.length >= LC.INPUTS) break;
    if (!n || typeof n.id !== "string" || !ID_RE.test(n.id) || ids.has(n.id))
      continue;
    ids.add(n.id);
    inputs.push({
      id: n.id,
      label: lab(n.label, n.id),
      value: n.value ? 1 : 0,
    });
  }
  if (!inputs.length) {
    errors.push("logic-circuit needs at least one input");
    return { ok: false, errors, spec: null };
  }

  // gates — collect ids first (so a gate may reference a later gate: any DAG order works)
  const rawGates = [];
  for (const g of Array.isArray(spec.gates) ? spec.gates : []) {
    if (rawGates.length >= LC.GATES) break;
    if (
      !g ||
      typeof g.id !== "string" ||
      !ID_RE.test(g.id) ||
      ids.has(g.id) ||
      !GATE_TYPES.has(g.type)
    )
      continue;
    ids.add(g.id);
    rawGates.push({
      id: g.id,
      type: g.type,
      inputs: g.inputs,
      label: lab(g.label, ""),
    });
  }
  // resolve refs against the full id set; NOT/BUFFER take 1, the rest take ≥2. A gate
  // that can't meet its arity is dropped, which can dangle a consumer → prune to a
  // fixed point so no survivor points at a removed gate.
  const enoughFor = (type, refs) =>
    UNARY_GATES.has(type) ? refs.length >= 1 : refs.length >= 2;
  let gates = rawGates.map((g) => ({
    ...g,
    inputs: (Array.isArray(g.inputs) ? g.inputs : [])
      .filter((r) => typeof r === "string" && ids.has(r) && r !== g.id)
      .slice(0, UNARY_GATES.has(g.type) ? 1 : LC.FANIN),
  }));
  for (let pass = 0; pass < LC.GATES; pass += 1) {
    const live = new Set([
      ...inputs.map((i) => i.id),
      ...gates.filter((g) => enoughFor(g.type, g.inputs)).map((g) => g.id),
    ]);
    const next = gates
      .map((g) => ({ ...g, inputs: g.inputs.filter((r) => live.has(r)) }))
      .filter((g) => enoughFor(g.type, g.inputs));
    if (
      next.length === gates.length &&
      next.every((g, i) => g.inputs.length === gates[i].inputs.length)
    ) {
      gates = next;
      break;
    }
    gates = next;
  }
  if (!gates.length) {
    errors.push("logic-circuit needs at least one valid gate");
    return { ok: false, errors, spec: null };
  }

  const nodeIds = new Set([
    ...inputs.map((i) => i.id),
    ...gates.map((g) => g.id),
  ]);

  // outputs — reference any node; if none valid, derive the sinks (gates nobody consumes)
  let outputs = [];
  for (const o of Array.isArray(spec.outputs) ? spec.outputs : []) {
    if (outputs.length >= LC.OUTPUTS) break;
    if (
      !o ||
      typeof o.from !== "string" ||
      !nodeIds.has(o.from) ||
      outputs.some((x) => x.from === o.from)
    )
      continue;
    outputs.push({ from: o.from, label: lab(o.label, o.from) });
  }
  if (!outputs.length) {
    const consumed = new Set();
    gates.forEach((g) => g.inputs.forEach((r) => consumed.add(r)));
    const sinks = gates.filter((g) => !consumed.has(g.id));
    outputs = (sinks.length ? sinks : gates.slice(-1))
      .slice(0, LC.OUTPUTS)
      .map((g) => ({ from: g.id, label: g.label || g.id }));
  }

  return {
    ok: true,
    errors,
    spec: {
      v: 1,
      kind: "logic-circuit",
      title,
      inputs,
      gates,
      outputs,
      truthTable: spec.truthTable !== false,
    },
  };
}

// circuit — an analog schematic on a grid. Each component is a typed symbol; 2-terminal
// parts (resistor, capacitor, source…) span an axis-aligned segment at→to and the renderer
// draws the symbol + leads along it; `ground` is a single-terminal marker with a direction.
// Fail-soft, house style: a part with a bad type / off-grid / non-axis-aligned segment drops;
// the spec rejects only if nothing valid survives. No expression surface — enum + coords.
function validateCircuit(spec, errors) {
  const title =
    typeof spec.title === "string" ? spec.title.slice(0, CIRC.TITLE) : "";
  const lab = (s) => (typeof s === "string" ? s.slice(0, CIRC.LABEL) : "");
  const pt = (p) =>
    Array.isArray(p) &&
    isNum(p[0]) &&
    isNum(p[1]) &&
    p[0] >= CIRC.MIN &&
    p[0] <= CIRC.MAX &&
    p[1] >= CIRC.MIN &&
    p[1] <= CIRC.MAX
      ? [p[0], p[1]]
      : null;
  const axisAligned = (a, b) => (a[0] === b[0]) !== (a[1] === b[1]); // exactly one coord differs → H or V, nonzero

  const components = [];
  for (const c of Array.isArray(spec.components) ? spec.components : []) {
    if (components.length >= CIRC.PARTS || !c || !CIRCUIT_TYPES.has(c.type))
      continue;
    const at = pt(c.at);
    if (!at) continue;
    if (c.type === "ground") {
      const to = pt(c.to);
      let dir = "down"; // default: hangs below the node
      if (to && axisAligned(at, to))
        dir =
          at[0] === to[0]
            ? to[1] > at[1]
              ? "down"
              : "up"
            : to[0] > at[0]
              ? "right"
              : "left";
      components.push({ type: "ground", at, dir, label: lab(c.label) });
      continue;
    }
    const to = pt(c.to);
    if (!to || !axisAligned(at, to)) continue;
    const comp = { type: c.type, at, to, label: lab(c.label) };
    if (POLAR.has(c.type)) comp.flip = !!c.flip; // swap polarity/direction
    if (c.type === "source" || c.type === "current_source") comp.ac = !!c.ac;
    if (c.type === "switch") comp.closed = !!c.closed;
    components.push(comp);
  }
  if (!components.length) {
    errors.push("circuit needs at least one valid component");
    return { ok: false, errors, spec: null };
  }
  return {
    ok: true,
    errors,
    spec: { v: 1, kind: "circuit", title, components },
  };
}

// Step-by-step memory model (Java stack/heap teaching). No expressions → no eval
// surface; just bounded strings/numbers, token-name colors, and id-referential
// filters (a dangling id simply vanishes, exactly like a diagram edge). `code`
// is INERT display text and is NEVER routed through tokenize/parseExpr/evalExpr.
// Malformed frames or zero steps reject the whole spec (→ graceful code-block
// fallback, like validateDiagram); bad slots/objects/refs drop silently.
function validateMemSim(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  spec.code = (Array.isArray(spec.code) ? spec.code : [])
    .slice(0, MS.CODE)
    .map((l) => (typeof l === "string" ? l.slice(0, MS.LINE) : ""));
  const codeN = spec.code.length;

  // frames — backbone; rebuilt to EXACTLY { id, label } (no model-controlled keys)
  const frames = [],
    frameIds = new Set();
  for (const f of Array.isArray(spec.frames) ? spec.frames : []) {
    if (frames.length >= MS.FRAMES) break;
    if (
      !f ||
      typeof f.id !== "string" ||
      !ID_RE.test(f.id) ||
      frameIds.has(f.id) ||
      typeof f.label !== "string" ||
      !f.label.trim()
    ) {
      errors.push("bad frame");
      continue;
    }
    frameIds.add(f.id);
    frames.push({ id: f.id, label: f.label.slice(0, MS.LABEL) });
  }
  spec.frames = frames;

  // slots — must belong to a kept frame; bad/dangling drop silently
  const slots = [],
    slotIds = new Set(),
    slotFrame = new Map();
  for (const s of Array.isArray(spec.slots) ? spec.slots : []) {
    if (slots.length >= MS.SLOTS) break;
    if (
      !s ||
      typeof s.id !== "string" ||
      !ID_RE.test(s.id) ||
      slotIds.has(s.id) ||
      typeof s.label !== "string" ||
      !s.label.trim() ||
      !frameIds.has(s.frame)
    )
      continue;
    const type = s.type === "reference" ? "reference" : "primitive";
    slotIds.add(s.id);
    slotFrame.set(s.id, s.frame);
    slots.push({
      id: s.id,
      frame: s.frame,
      label: s.label.slice(0, MS.LABEL),
      type,
      color: msColor(s.color, type === "reference" ? "evPurple" : "accent"),
    });
  }
  spec.slots = slots;

  // objects (heap)
  const objects = [],
    objIds = new Set();
  for (const o of Array.isArray(spec.objects) ? spec.objects : []) {
    if (objects.length >= MS.OBJECTS) break;
    if (
      !o ||
      typeof o.id !== "string" ||
      !ID_RE.test(o.id) ||
      objIds.has(o.id) ||
      typeof o.label !== "string" ||
      !o.label.trim()
    )
      continue;
    objIds.add(o.id);
    objects.push({
      id: o.id,
      label: o.label.slice(0, MS.LABEL),
      color: msColor(o.color, "evGreen"),
    });
  }
  spec.objects = objects;

  // refs — from a kept slot to a kept object; dangling dropped (like edges)
  const refs = [],
    refIds = new Set(),
    refEnds = new Map();
  for (const r of Array.isArray(spec.refs) ? spec.refs : []) {
    if (refs.length >= MS.REFS) break;
    if (
      !r ||
      typeof r.id !== "string" ||
      !ID_RE.test(r.id) ||
      refIds.has(r.id) ||
      !slotIds.has(r.from) ||
      !objIds.has(r.to)
    )
      continue;
    refIds.add(r.id);
    refEnds.set(r.id, [r.from, r.to]);
    refs.push({
      id: r.id,
      from: r.from,
      to: r.to,
      label: typeof r.label === "string" ? r.label.slice(0, MS.REFLBL) : "",
    });
  }
  spec.refs = refs;

  const known = new Set([...frameIds, ...slotIds, ...objIds, ...refIds]);

  // steps — required (≥1). Each step's `show`/`focus` are id filters; fail-closed
  // coherence: a slot can't show without its frame; a ref can't show without both ends.
  const rawSteps = (Array.isArray(spec.steps) ? spec.steps : []).slice(
    0,
    MS.STEPS,
  );
  if (!rawSteps.length) errors.push("memory-sim needs at least one step");
  spec.steps = rawSteps.map((s) => {
    const line = isNum(s && s.line)
      ? Math.max(0, Math.min(codeN ? codeN - 1 : 0, Math.trunc(s.line)))
      : 0;
    let show = (Array.isArray(s && s.show) ? s.show : [])
      .slice(0, MS.SHOW)
      .filter((id) => known.has(id));
    let set = new Set(show);
    show = show.filter(
      (id) => !slotFrame.has(id) || set.has(slotFrame.get(id)),
    );
    set = new Set(show);
    show = show.filter((id) => {
      const e = refEnds.get(id);
      return !e || (set.has(e[0]) && set.has(e[1]));
    });
    set = new Set(show);
    const focus = (Array.isArray(s && s.focus) ? s.focus : [])
      .slice(0, MS.SHOW)
      .filter((id) => set.has(id));
    return {
      line,
      caption:
        typeof (s && s.caption) === "string" ? s.caption.slice(0, MS.CAP) : "",
      show,
      focus,
    };
  });

  // Optional ACTION BUTTONS (interactive simulator). Each button just jumps to a
  // pre-authored step — a CLOSED reducer that never runs model code. Live counters
  // (Stack Frames / Heap Objects / Active References) are auto-derived by the renderer
  // from each step's visible ids, so the model never supplies counts.
  spec.buttons = (Array.isArray(spec.buttons) ? spec.buttons : [])
    .slice(0, 6)
    .filter(
      (b) =>
        b &&
        typeof b.label === "string" &&
        b.label.trim() &&
        Number.isInteger(b.step) &&
        b.step >= 0 &&
        b.step < spec.steps.length,
    )
    .map((b) => ({ label: b.label.slice(0, MS.LABEL), step: b.step }));

  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// bracket-sim: a LIVE client-side stack / bracket-matching simulator. Pure config
// — no expressions, no ids, no model-authored steps. The algorithm lives in the
// renderer (a fixed, trusted stack walk) and runs on whatever string the student
// types; the spec only supplies a starting input + example presets, each sanitized
// to a safe display charset (brackets, alphanumerics, math operators, spaces).
const BSIM = { INPUT: 60, EXAMPLES: 6, TITLE: 120 };
const bsimClean = (s) =>
  String(s == null ? "" : s)
    .replace(/[^()[\]{}a-zA-Z0-9+\-*/^.,= ]/g, "")
    .slice(0, BSIM.INPUT)
    .trim();
const bsimHasBracket = (s) => /[()[\]{}]/.test(s);

function validateBracketSim(spec, errors) {
  const input = bsimClean(spec.input);
  if (!input || !bsimHasBracket(input))
    errors.push("bracket-sim needs an input string containing brackets");
  const examples = [];
  for (const e of Array.isArray(spec.examples) ? spec.examples : []) {
    if (examples.length >= BSIM.EXAMPLES) break;
    const ex = bsimClean(e);
    if (ex && bsimHasBracket(ex) && !examples.includes(ex)) examples.push(ex);
  }
  if (errors.length) return { ok: false, errors, spec: null };
  return {
    ok: true,
    errors: [],
    spec: {
      v: 1,
      kind: "bracket-sim",
      title: String(spec.title == null ? "" : spec.title).slice(0, BSIM.TITLE),
      input,
      examples,
    },
  };
}

// slope-field (direction field) — the proper tool for first-order ODEs y' = f(x,y).
// The model supplies ONE expression in x AND y (routed through the SAME no-eval
// parseExpr, with two allowed vars); the renderer samples it on a grid and draws
// the slope segments. No per-point arrays for the model to get wrong.
const SF = { TITLE: 120, DENSITY_MIN: 7, DENSITY_MAX: 17, DENSITY_DEF: 13 };

function validateSlopeField(spec, errors) {
  const range = (r, d0, d1) =>
    Array.isArray(r) && isNum(r[0]) && isNum(r[1]) && r[1] > r[0]
      ? [r[0], r[1]]
      : [d0, d1];
  const exprStr = String(spec.expr == null ? "" : spec.expr).trim();
  let ast = null;
  if (!exprStr) errors.push("slope-field needs a y' = f(x,y) expression");
  else {
    try {
      ast = parseExpr(exprStr, ["x", "y"]);
    } catch {
      errors.push(
        "slope-field expr must use only x, y, numbers and the allowed functions",
      );
    }
  }
  if (!ast) return { ok: false, errors, spec: null };
  let density = isNum(spec.density) ? Math.trunc(spec.density) : SF.DENSITY_DEF;
  density = Math.max(SF.DENSITY_MIN, Math.min(SF.DENSITY_MAX, density));
  return {
    ok: true,
    errors: [],
    spec: {
      v: 1,
      kind: "slope-field",
      title: String(spec.title == null ? "" : spec.title).slice(0, SF.TITLE),
      expr: exprStr,
      _ast: ast,
      xRange: range(spec.xRange, -3, 3),
      yRange: range(spec.yRange, -3, 3),
      density,
    },
  };
}

// surface3d — a 3D scene for multivariable calculus: one to three surfaces z=f(x,y)
// (each expr routed through the SAME no-eval parser, allowed vars x AND y), plus ONE
// optional INTEGRATION REGION — the solid under a surface over a base domain D, which is
// exactly what a double integral ∬_D f dA measures. D is a TYPED domain (rectangle,
// ellipse/disk, or the area BETWEEN two curves y=g(x)…y=h(x)); the model never supplies
// points/grids — the renderer samples f and builds the cap/walls/base and computes the
// integral numerically. Fail-soft: a bad surface expr drops; a bad region base drops just
// the region; the spec rejects only if NO surface survives.
function validateSurface3D(spec, errors) {
  spec.title = typeof spec.title === "string" ? spec.title.slice(0, 80) : "";
  const range = (r, d0, d1) =>
    Array.isArray(r) && isNum(r[0]) && isNum(r[1]) && r[1] > r[0]
      ? [r[0], r[1]]
      : [d0, d1];
  spec.xRange = range(spec.xRange, -5, 5);
  spec.yRange = range(spec.yRange, -5, 5);
  spec.zRange =
    Array.isArray(spec.zRange) &&
    isNum(spec.zRange[0]) &&
    isNum(spec.zRange[1]) &&
    spec.zRange[1] > spec.zRange[0]
      ? [spec.zRange[0], spec.zRange[1]]
      : null;
  const col = (c, d) => (COLOR_SET.has(c) ? c : d);

  const opac = (o) => (isNum(o) ? Math.max(0.05, Math.min(1, o)) : null); // null → renderer default
  const surfaces = [];
  for (const s of Array.isArray(spec.surfaces) ? spec.surfaces : []) {
    if (surfaces.length >= SURF.SURFACES || !s) continue;
    const color = col(s.color, VIZ_COLORS[surfaces.length % VIZ_COLORS.length]);
    const label =
      typeof s.label === "string" ? s.label.slice(0, SURF.LABEL) : "";
    if (
      typeof s.x === "string" &&
      typeof s.y === "string" &&
      typeof s.z === "string"
    ) {
      // PARAMETRIC surface: x,y,z as functions of u,v (sphere, torus, cylinder, cone, helicoid…).
      try {
        const _xAst = parseExpr(s.x, ["u", "v"]),
          _yAst = parseExpr(s.y, ["u", "v"]),
          _zAst = parseExpr(s.z, ["u", "v"]);
        surfaces.push({
          kind: "param",
          x: s.x,
          y: s.y,
          z: s.z,
          _xAst,
          _yAst,
          _zAst,
          uRange: range(s.uRange, 0, 2 * Math.PI),
          vRange: range(s.vRange, 0, Math.PI),
          color,
          opacity: opac(s.opacity),
          label,
        });
      } catch {
        /* drop a bad parametric surface, fail-soft */
      }
    } else if (typeof s.expr === "string") {
      // EXPLICIT surface z = f(x,y).
      try {
        surfaces.push({
          kind: "explicit",
          expr: s.expr,
          _ast: parseExpr(s.expr, ["x", "y"]),
          color,
          opacity: opac(s.opacity),
          label,
        });
      } catch {
        /* drop a bad surface, fail-soft */
      }
    }
  }
  if (!surfaces.length) {
    errors.push(
      "surface3d needs at least one valid surface (z=f(x,y) or parametric x,y,z of u,v)",
    );
    return { ok: false, errors, spec: null };
  }
  spec.surfaces = surfaces;
  spec.aspect =
    spec.aspect === "data" || spec.aspect === "cube" ? spec.aspect : null; // else renderer picks
  spec.region = validateRegion3D(
    spec.region,
    surfaces.find((s) => s.kind === "explicit") || null,
    col,
  ); // ONE optional integration region
  return {
    ok: errors.length === 0,
    errors,
    spec: errors.length === 0 ? spec : null,
  };
}

// The integration region: its integrand surface defaults to the first surface when
// omitted; its base is a typed domain. An optional `lower` surface turns it into a
// volume BETWEEN two surfaces (bounded below by lower(x,y) instead of z=0). A malformed
// base drops the whole region (the surfaces still render); a malformed lower just falls
// back to a z=0 floor — both matching the fail-soft house style.
function validateRegion3D(raw, firstSurface, col) {
  if (!raw || typeof raw !== "object") return null;
  let _surfaceAst = firstSurface ? firstSurface._ast : null,
    surface = firstSurface ? firstSurface.expr : "";
  if (typeof raw.surface === "string") {
    try {
      _surfaceAst = parseExpr(raw.surface, ["x", "y"]);
      surface = raw.surface;
    } catch {
      /* keep first surface */
    }
  }
  let _lowerAst = null,
    lower = "";
  if (typeof raw.lower === "string") {
    try {
      _lowerAst = parseExpr(raw.lower, ["x", "y"]);
      lower = raw.lower;
    } catch {
      /* no lower → floor at z=0 */
    }
  }
  const base = validateBase3D(coerceBase3D(raw));
  if (!base) return null;
  return {
    surface,
    _surfaceAst,
    lower,
    _lowerAst,
    base,
    color: col(raw.color, "success"),
    label: typeof raw.label === "string" ? raw.label.slice(0, SURF.LABEL) : "",
    floor: raw.floor !== false,
    wall: raw.wall !== false,
  };
}

// The integration domain D is the ONE part of a surface3d that students most need to see —
// yet it's also where the model most often drifts off-schema, and the whole region was
// being SILENTLY dropped (a bare surface, no domain). So fold the common drift into the
// canonical base BEFORE validation, in the same fail-soft, alias-folding spirit as
// validateGeometry: (1) `base` given as a STRING enum ("ellipse"/"disk"/"rect"…) with the
// shape's fields hoisted onto the region itself; (2) an ellipse/disk whose semi-axes are
// named rx/ry or a single radius/r instead of a/b; (3) type spelled disk/circle/rectangle.
// A canonical {base:{type,…}} passes through unchanged (idempotent).
function coerceBase3D(raw) {
  let b = raw.base;
  if (typeof b === "string") {
    // string enum → lift the geometric fields the model flattened onto the region
    b = {
      type: b,
      cx: raw.cx,
      cy: raw.cy,
      a: raw.a,
      b: raw.b,
      r: raw.r,
      radius: raw.radius,
      rx: raw.rx,
      ry: raw.ry,
      x: raw.x,
      y: raw.y,
      lower: raw.lower,
      upper: raw.upper,
      left: raw.left,
      right: raw.right,
    };
  } else if (b && typeof b === "object") {
    b = { ...b };
  } else {
    return b; // nothing to coerce → validateBase3D rejects it
  }
  if (typeof b.type === "string") {
    const t = b.type.toLowerCase();
    b.type =
      t === "disk" || t === "circle"
        ? "ellipse"
        : t === "rectangle"
          ? "rect"
          : t;
  }
  if (b.type === "ellipse") {
    // rx/ry, or a single radius/r, are the semi-axes a/b
    const r = isNum(b.radius) ? b.radius : b.r;
    if (!isNum(b.a)) b.a = isNum(b.rx) ? b.rx : r;
    if (!isNum(b.b)) b.b = isNum(b.ry) ? b.ry : r;
  }
  return b;
}

// Typed base domain D: rect {x:[a,b],y:[c,d]} | ellipse {cx,cy,a,b} | between {x:[a,b],
// lower:<expr x>, upper:<expr x>}. The between exprs go through the same no-eval parser.
// Returns null (→ region dropped) if malformed. `coerceBase3D` runs first (schema-drift
// tolerance); this stays the STRICT canonical gate.
function validateBase3D(b) {
  if (!b || !BASE_TYPES.has(b.type)) return null;
  if (b.type === "rect") {
    const { x, y } = b;
    if (
      Array.isArray(x) &&
      Array.isArray(y) &&
      isNum(x[0]) &&
      isNum(x[1]) &&
      isNum(y[0]) &&
      isNum(y[1]) &&
      x[1] > x[0] &&
      y[1] > y[0]
    ) {
      return { type: "rect", x: [x[0], x[1]], y: [y[0], y[1]] };
    }
    return null;
  }
  if (b.type === "ellipse") {
    if (
      isNum(b.cx) &&
      isNum(b.cy) &&
      isNum(b.a) &&
      isNum(b.b) &&
      b.a > 0 &&
      b.b > 0
    )
      return { type: "ellipse", cx: b.cx, cy: b.cy, a: b.a, b: b.b };
    return null;
  }
  if (b.type === "between-y") {
    const y = b.y; // type-II region: x from left(y) to right(y) over y∈[c,d]
    if (
      !Array.isArray(y) ||
      !isNum(y[0]) ||
      !isNum(y[1]) ||
      !(y[1] > y[0]) ||
      typeof b.left !== "string" ||
      typeof b.right !== "string"
    )
      return null;
    try {
      const _leftAst = parseExpr(b.left, ["y"]),
        _rightAst = parseExpr(b.right, ["y"]);
      return {
        type: "between-y",
        y: [y[0], y[1]],
        left: b.left,
        right: b.right,
        _leftAst,
        _rightAst,
      };
    } catch {
      return null;
    }
  }
  const x = b.x; // between (type-I region): y from lower(x) to upper(x) over x∈[a,b]
  if (
    !Array.isArray(x) ||
    !isNum(x[0]) ||
    !isNum(x[1]) ||
    !(x[1] > x[0]) ||
    typeof b.lower !== "string" ||
    typeof b.upper !== "string"
  )
    return null;
  try {
    const _lowerAst = parseExpr(b.lower, ["x"]),
      _upperAst = parseExpr(b.upper, ["x"]);
    return {
      type: "between",
      x: [x[0], x[1]],
      lower: b.lower,
      upper: b.upper,
      _lowerAst,
      _upperAst,
    };
  } catch {
    return null;
  }
}

// ---- surface3d geometry helpers (pure; shared by the renderer and unit tests) ----

// Is (x,y) inside the base domain D?
export function inRegion(base, x, y) {
  if (!base) return false;
  if (base.type === "rect")
    return x >= base.x[0] && x <= base.x[1] && y >= base.y[0] && y <= base.y[1];
  if (base.type === "ellipse") {
    const u = (x - base.cx) / base.a,
      v = (y - base.cy) / base.b;
    return u * u + v * v <= 1;
  }
  if (base.type === "between") {
    if (x < base.x[0] || x > base.x[1]) return false;
    const lo = evalExpr(base._lowerAst, { x }),
      hi = evalExpr(base._upperAst, { x });
    return (
      Number.isFinite(lo) &&
      Number.isFinite(hi) &&
      y >= Math.min(lo, hi) &&
      y <= Math.max(lo, hi)
    );
  }
  if (base.type === "between-y") {
    if (y < base.y[0] || y > base.y[1]) return false;
    const l = evalExpr(base._leftAst, { y }),
      r = evalExpr(base._rightAst, { y });
    return (
      Number.isFinite(l) &&
      Number.isFinite(r) &&
      x >= Math.min(l, r) &&
      x <= Math.max(l, r)
    );
  }
  return false;
}

// Axis-aligned bounding box [xMin,xMax,yMin,yMax] of D (between: scan the two curves).
export function regionBBox(base, n = 80) {
  if (base.type === "rect") return [base.x[0], base.x[1], base.y[0], base.y[1]];
  if (base.type === "ellipse")
    return [
      base.cx - base.a,
      base.cx + base.a,
      base.cy - base.b,
      base.cy + base.b,
    ];
  if (base.type === "between-y") {
    let xMin = Infinity,
      xMax = -Infinity;
    for (let i = 0; i <= n; i += 1) {
      const y = base.y[0] + (base.y[1] - base.y[0]) * (i / n);
      const l = evalExpr(base._leftAst, { y }),
        r = evalExpr(base._rightAst, { y });
      if (Number.isFinite(l)) {
        xMin = Math.min(xMin, l);
        xMax = Math.max(xMax, l);
      }
      if (Number.isFinite(r)) {
        xMin = Math.min(xMin, r);
        xMax = Math.max(xMax, r);
      }
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
      xMin = -1;
      xMax = 1;
    }
    return [xMin, xMax, base.y[0], base.y[1]];
  }
  let yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i <= n; i += 1) {
    const x = base.x[0] + (base.x[1] - base.x[0]) * (i / n);
    const lo = evalExpr(base._lowerAst, { x }),
      hi = evalExpr(base._upperAst, { x });
    if (Number.isFinite(lo)) {
      yMin = Math.min(yMin, lo);
      yMax = Math.max(yMax, lo);
    }
    if (Number.isFinite(hi)) {
      yMin = Math.min(yMin, hi);
      yMax = Math.max(yMax, hi);
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = -1;
    yMax = 1;
  }
  return [base.x[0], base.x[1], yMin, yMax];
}

// Closed boundary loop ∂D as [x,y] points (for the base outline + the lateral wall).
export function regionBoundary(base, n = 160) {
  let pts = [];
  if (base.type === "ellipse") {
    for (let j = 0; j <= n; j += 1) {
      const t = (2 * Math.PI * j) / n;
      pts.push([
        base.cx + base.a * Math.cos(t),
        base.cy + base.b * Math.sin(t),
      ]);
    }
  } else if (base.type === "rect") {
    const [x0, x1] = base.x,
      [y0, y1] = base.y;
    pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ];
  } else if (base.type === "between-y") {
    // type-II: up the right curve, back along the left
    const [y0, y1] = base.y;
    for (let i = 0; i <= n; i += 1) {
      const y = y0 + (y1 - y0) * (i / n);
      pts.push([evalExpr(base._rightAst, { y }), y]);
    }
    for (let i = n; i >= 0; i -= 1) {
      const y = y0 + (y1 - y0) * (i / n);
      pts.push([evalExpr(base._leftAst, { y }), y]);
    }
    if (pts.length) pts.push(pts[0]);
  } else {
    // between: along the upper curve, back along the lower
    const [x0, x1] = base.x;
    for (let i = 0; i <= n; i += 1) {
      const x = x0 + (x1 - x0) * (i / n);
      pts.push([x, evalExpr(base._upperAst, { x })]);
    }
    for (let i = n; i >= 0; i -= 1) {
      const x = x0 + (x1 - x0) * (i / n);
      pts.push([x, evalExpr(base._lowerAst, { x })]);
    }
    if (pts.length) pts.push(pts[0]);
  }
  return pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

// Numerical ∬_D f dA by the midpoint rule over D's bounding box (cells whose midpoint
// lies in D). Returns null if it can't be estimated. Pure → unit-tested.
export function estimateDoubleIntegral(surfAst, base, n = 120) {
  const [xMin, xMax, yMin, yMax] = regionBBox(base);
  const dx = (xMax - xMin) / n,
    dy = (yMax - yMin) / n;
  if (!(dx > 0) || !(dy > 0)) return null;
  let sum = 0,
    count = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xMin + (i + 0.5) * dx;
    for (let j = 0; j < n; j += 1) {
      const y = yMin + (j + 0.5) * dy;
      if (!inRegion(base, x, y)) continue;
      const z = evalExpr(surfAst, { x, y });
      if (Number.isFinite(z)) {
        sum += z;
        count += 1;
      }
    }
  }
  return count ? sum * dx * dy : null;
}

// Sample one curve across the x range for a given parameter scope. Non-finite
// values become null → the renderer draws a gap rather than crashing.
export function sampleCurve(ast, xVar, xMin, xMax, paramScope = {}, n = 140) {
  const pts = [],
    steps = Math.max(2, Math.min(400, n | 0));
  const value = (x) => {
    const y = evalExpr(ast, { ...paramScope, [xVar]: x });
    return Number.isFinite(y) ? y : null;
  };
  const amplitudes = Array.from({ length: steps + 1 }, (_, i) =>
    value(xMin + ((xMax - xMin) * i) / steps),
  )
    .filter((y) => y !== null)
    .map(Math.abs)
    .sort((a, b) => a - b);
  const scaleFloor = Math.max(
    Number.MIN_VALUE,
    0.02 * (amplitudes[Math.floor(amplitudes.length / 2)] || 0),
  );
  // Test midpoints and refine nonlinear intervals. Unresolved jumps get a real gap.
  // This is bounded numerical sampling, not a continuity proof.
  const split = (a, b, ya, yb, depth) => {
    const m = (a + b) / 2,
      ym = value(m);
    if (ya === null || yb === null || ym === null) {
      if (ym === null) pts.push({ x: m, y: null });
      pts.push({ x: b, y: yb });
      return;
    }
    const deviation = Math.abs(ym - (ya + yb) / 2),
      scale = Math.max(scaleFloor, Math.abs(ya), Math.abs(yb));
    if (deviation > 0.015 * scale) {
      if (depth > 0) {
        split(a, m, ya, ym, depth - 1);
        split(m, b, ym, yb, depth - 1);
      } else {
        pts.push({ x: m, y: null });
        pts.push({ x: b, y: yb });
      }
    } else pts.push({ x: b, y: yb });
  };
  let x = xMin,
    y = value(x);
  pts.push({ x, y });
  for (let i = 1; i <= steps; i++) {
    const next = xMin + ((xMax - xMin) * i) / steps,
      yn = value(next);
    split(x, next, y, yn, 8);
    x = next;
    y = yn;
  }
  return pts;
}

// ---- probability distributions (pure; shared by the renderer and unit tests) ----

// log Γ(x) via the Lanczos approximation (g=7, ~1e-10). Pure. Powers the t / chi-squared
// density normalizers, so the `distribution` kind needs only numeric params — never an
// expression. The reflection formula handles x < 0.5.
const LANCZOS_G = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const z = x - 1;
  let a = LANCZOS_G[0];
  const t = z + 7.5;
  for (let i = 1; i < LANCZOS_G.length; i += 1) a += LANCZOS_G[i] / (z + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
  );
}

// A sensible default x-window per distribution (support-aware, ~mean ± a few sd). Used when
// the spec doesn't pin xRange. Pure.
export function distRange(dist, p) {
  if (dist === "normal") return [p.mu - 4 * p.sigma, p.mu + 4 * p.sigma];
  if (dist === "t") return [-5, 5];
  if (dist === "chisq") {
    const sd = Math.sqrt(2 * p.df);
    return [0, Math.max(p.df + 4 * sd, 8)];
  }
  if (dist === "exponential") return [0, 6 / p.lambda];
  if (dist === "uniform") {
    const w = p.b - p.a;
    return [p.a - 0.15 * w, p.b + 0.15 * w];
  }
  return [-4, 4];
}

// The probability DENSITY f(x) for a supported distribution & its params; 0 outside the
// support, NaN for a non-finite x. Pure → node:test.
export function distPdf(dist, p, x) {
  if (!Number.isFinite(x)) return NaN;
  if (dist === "normal") {
    const z = (x - p.mu) / p.sigma;
    return Math.exp(-0.5 * z * z) / (p.sigma * Math.sqrt(2 * Math.PI));
  }
  if (dist === "t") {
    const v = p.df;
    const norm =
      Math.exp(lgamma((v + 1) / 2) - lgamma(v / 2)) / Math.sqrt(v * Math.PI);
    return norm * Math.pow(1 + (x * x) / v, -(v + 1) / 2);
  }
  if (dist === "chisq") {
    const k = p.df;
    if (x <= 0) return 0;
    return Math.exp(
      (k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.log(2) - lgamma(k / 2),
    );
  }
  if (dist === "exponential")
    return x < 0 ? 0 : p.lambda * Math.exp(-p.lambda * x);
  if (dist === "uniform") return x >= p.a && x <= p.b ? 1 / (p.b - p.a) : 0;
  return NaN;
}

// ---- graph layout (pure, deterministic; shared by the renderer and unit tests) ----

// Lay out a general graph's nodes in the unit square [0,1]^2. "circular" spaces them evenly on a
// circle; "force" runs a fixed, SEEDED Fruchterman–Reingold relaxation (circular init → all-pairs
// repulsion + attraction along edges, with cooling) then fits the result to the frame. Fully
// deterministic (no RNG, fixed iteration count) so the same graph always renders identically and
// it is unit-testable. The model supplies NO coordinates — this owns placement, like the tree layout.
export function graphLayout(nodes, edges, kind = "force") {
  const n = nodes.length;
  const pos = {};
  const R0 = 0.4;
  nodes.forEach((nd, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    pos[nd.id] = { x: 0.5 + R0 * Math.cos(a), y: 0.5 + R0 * Math.sin(a) };
  });
  if (n < 3 || kind === "circular") return pos;

  const ids = nodes.map((nd) => nd.id);
  const links = (edges || []).filter(
    (e) => pos[e.from] && pos[e.to] && e.from !== e.to,
  );
  const k = Math.sqrt(1 / n) * 0.9; // ideal edge length in unit space
  let temp = 0.12;
  for (let it = 0; it < 320; it += 1) {
    const disp = {};
    ids.forEach((id) => {
      disp[id] = { x: 0, y: 0 };
    });
    for (let i = 0; i < n; i += 1) {
      // repulsion (all pairs)
      for (let j = i + 1; j < n; j += 1) {
        const A = pos[ids[i]],
          B = pos[ids[j]];
        const ddx = A.x - B.x,
          ddy = A.y - B.y;
        const d = Math.hypot(ddx, ddy) || 1e-4;
        const f = (k * k) / d,
          ux = (ddx / d) * f,
          uy = (ddy / d) * f;
        disp[ids[i]].x += ux;
        disp[ids[i]].y += uy;
        disp[ids[j]].x -= ux;
        disp[ids[j]].y -= uy;
      }
    }
    for (const e of links) {
      // attraction (along edges)
      const A = pos[e.from],
        B = pos[e.to];
      const ddx = A.x - B.x,
        ddy = A.y - B.y;
      const d = Math.hypot(ddx, ddy) || 1e-4;
      const f = (d * d) / k,
        ux = (ddx / d) * f,
        uy = (ddy / d) * f;
      disp[e.from].x -= ux;
      disp[e.from].y -= uy;
      disp[e.to].x += ux;
      disp[e.to].y += uy;
    }
    ids.forEach((id) => {
      // step, capped by temperature
      const dp = disp[id],
        d = Math.hypot(dp.x, dp.y) || 1e-4;
      pos[id].x += (dp.x / d) * Math.min(d, temp);
      pos[id].y += (dp.y / d) * Math.min(d, temp);
    });
    temp *= 0.98; // cool
  }

  // Fit the relaxed layout into [pad, pad+span]^2 so it fills the frame regardless of absolute scale.
  const xs = ids.map((id) => pos[id].x),
    ys = ids.map((id) => pos[id].y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const span = 0.86,
    pad = 0.07;
  const sx = maxX > minX ? span / (maxX - minX) : 0,
    sy = maxY > minY ? span / (maxY - minY) : 0;
  ids.forEach((id) => {
    pos[id].x = pad + (sx ? (pos[id].x - minX) * sx : span / 2);
    pos[id].y = pad + (sy ? (pos[id].y - minY) * sy : span / 2);
  });
  return pos;
}

// ---- 2×2 eigen-decomposition (pure; shared by the renderer and unit tests) ----

// Real eigenvalues + unit eigenvectors of [[a,b],[c,d]] — the invariant directions a linear-algebra
// course draws. Returns { real:true, values:[λ1,λ2], vectors:[[x,y],[x,y]] } when the discriminant is
// ≥ 0, else { real:false } (a rotation has no real eigenvectors). Pure → node:test.
export function eigen2x2(m) {
  const a = m[0][0],
    b = m[0][1],
    c = m[1][0],
    d = m[1][1];
  const tr = a + d,
    det = a * d - b * c,
    disc = tr * tr - 4 * det;
  if (disc < 0) return { real: false, values: [], vectors: [] };
  const s = Math.sqrt(disc),
    l1 = (tr + s) / 2,
    l2 = (tr - s) / 2;
  const vecFor = (l) => {
    let vx, vy;
    if (Math.abs(b) > 1e-9 || Math.abs(a - l) > 1e-9) {
      vx = b;
      vy = l - a;
    } // ⟂ row 1: (a-λ)b + b(λ-a) = 0
    else if (Math.abs(c) > 1e-9 || Math.abs(d - l) > 1e-9) {
      vx = l - d;
      vy = c;
    } // ⟂ row 2
    else {
      vx = 1;
      vy = 0;
    } // M = λI → any direction
    const n = Math.hypot(vx, vy) || 1;
    return [vx / n, vy / n];
  };
  return { real: true, values: [l1, l2], vectors: [vecFor(l1), vecFor(l2)] };
}

// ---- logic-circuit evaluation (pure; shared by the renderer and unit tests) ----

// The boolean output of a gate type over its resolved input bits. n-ary AND/OR/…; XOR is
// odd-parity (the standard generalization), so a 3-input XOR is 1 for an odd number of 1s.
export function gateOutput(type, bits) {
  const any = bits.some(Boolean),
    all = bits.length > 0 && bits.every(Boolean);
  const odd = bits.reduce((a, b) => a ^ (b ? 1 : 0), 0) === 1;
  switch (type) {
    case "and":
      return all;
    case "nand":
      return !all;
    case "or":
      return any;
    case "nor":
      return !any;
    case "xor":
      return odd;
    case "xnor":
      return !odd;
    case "not":
      return !bits[0];
    case "buffer":
      return !!bits[0];
    default:
      return false;
  }
}

// Resolve every node (input + gate) to 0/1 for a given input-values map. Memoized DFS,
// cycle-safe: a node reached while already on the current path resolves to 0, so a
// malformed looping spec can never hang. Returns a plain { id: 0|1 } map.
export function evalLogic(spec, values = {}) {
  const gateById = new Map((spec.gates || []).map((g) => [g.id, g]));
  const inputIds = new Set((spec.inputs || []).map((i) => i.id));
  const memo = new Map(),
    visiting = new Set();
  const val = (id) => {
    if (inputIds.has(id)) return !!values[id];
    const g = gateById.get(id);
    if (!g) return false;
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return false; // cycle → 0
    visiting.add(id);
    const out = gateOutput(
      g.type,
      g.inputs.map((r) => val(r)),
    );
    visiting.delete(id);
    memo.set(id, out);
    return out;
  };
  const res = {};
  (spec.inputs || []).forEach((i) => {
    res[i.id] = val(i.id) ? 1 : 0;
  });
  (spec.gates || []).forEach((g) => {
    res[g.id] = val(g.id) ? 1 : 0;
  });
  return res;
}

// ---- mechanics geometry (pure, world coords; shared by the renderer and unit tests) ----

// The three corners of an inclined-plane wedge in WORLD coordinates. {x,y} is the
// acute-angle corner sitting on the ground; the base runs `run` toward `face`; the
// right-angle corner is at the far end, and the wedge rises `run·tanθ` to the top.
// A = acute corner (angle θ), B = right-angle corner, C = top of the slope.
export function inclineVertices(x, y, run, angleDeg, face = "right") {
  const sign = face === "left" ? -1 : 1;
  const rise = run * Math.tan((angleDeg * Math.PI) / 180);
  return { A: [x, y], B: [x + sign * run, y], C: [x + sign * run, y + rise] };
}

// The four WORLD corners of a square block (side s) sitting FLUSH on the ramp face
// A→C, centered at fraction `at` along it — the geometry a model reliably gets wrong.
// The block rests on the OUTWARD side of the hypotenuse (away from the wedge interior).
export function inclineBlock(x, y, run, angleDeg, face, at, s) {
  const { A, B, C } = inclineVertices(x, y, run, angleDeg, face);
  const ux = C[0] - A[0],
    uy = C[1] - A[1],
    L = Math.hypot(ux, uy) || 1;
  const dx = ux / L,
    dy = uy / L; // up-the-ramp unit vector
  const px = A[0] + dx * L * at,
    py = A[1] + dy * L * at; // base midpoint of the block
  let nx = -dy,
    ny = dx; // a normal to the ramp…
  // …flipped to point AWAY from B (the wedge interior), so the block sits on top.
  if (
    (px + nx - B[0]) ** 2 + (py + ny - B[1]) ** 2 <
    (px - nx - B[0]) ** 2 + (py - ny - B[1]) ** 2
  ) {
    nx = -nx;
    ny = -ny;
  }
  const p1 = [px - (dx * s) / 2, py - (dy * s) / 2],
    p2 = [px + (dx * s) / 2, py + (dy * s) / 2];
  return [
    p1,
    p2,
    [p2[0] + nx * s, p2[1] + ny * s],
    [p1[0] + nx * s, p1[1] + ny * s],
  ];
}

// ---- circuit geometry (pure; shared by the renderer and unit tests) ----

// Grid points where THREE or more component terminals meet — i.e. real electrical
// junctions that should get a solder dot (a plain 2-way corner or a pass-through does
// not). Pure over the validated component list.
export function circuitJunctions(components) {
  const count = new Map();
  const bump = (p) =>
    count.set(`${p[0]},${p[1]}`, (count.get(`${p[0]},${p[1]}`) || 0) + 1);
  for (const c of components || []) {
    bump(c.at);
    if (c.to) bump(c.to);
  }
  const out = [];
  count.forEach((n, k) => {
    if (n >= 3) {
      const [x, y] = k.split(",").map(Number);
      out.push([x, y]);
    }
  });
  return out;
}
