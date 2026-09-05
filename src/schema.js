import { z } from "zod";
import { VIZ_COLORS, validateSpec, parseExpr } from "./viz-spec.js";
const obj = z.strictObject;
const num = z.number().finite().min(-1e12).max(1e12);
const pos = num.positive();
const bool = z.boolean();
const text = (n = 24) => z.string().max(n);
const label = text().optional();
const id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/)
  .refine(
    (s) =>
      ![
        "constructor",
        "prototype",
        "__proto__",
        "toString",
        "hasOwnProperty",
      ].includes(s),
    "Reserved identifier",
  );
const color = z.enum(VIZ_COLORS).optional();
const expr = z.string().min(1).max(2048);
const arr = (s, max, min = 0) => z.array(s).min(min).max(max);
const pt = z.tuple([num, num]);
const range = z
  .tuple([num, num])
  .refine(
    ([a, b]) => b > a && b - a > Math.max(Math.abs(a), Math.abs(b), 1) * 1e-12,
    "Range must increase with a representable span",
  );
const common = { v: z.literal(1), title: text(80).optional() };
const typed = (kind, shape) =>
  obj({ ...common, kind: z.literal(kind), ...shape });
const named = { label, color };
const ends = { x1: num, y1: num, x2: num, y2: num };
const primitives = {
  point: { x: num, y: num },
  label: { x: num, y: num, text: text(24) },
  vector: { ...ends, dashed: bool.optional() },
  segment: { ...ends, dashed: bool.optional() },
  line: { ...ends, dashed: bool.optional() },
  circle: { cx: num, cy: num, r: pos, fill: bool.optional() },
  ellipse: { cx: num, cy: num, rx: pos, ry: pos, fill: bool.optional() },
  polygon: { points: arr(pt, 12, 3), fill: bool.optional() },
  sector: {
    cx: num.optional(),
    cy: num.optional(),
    r1: num.nonnegative(),
    r2: pos,
    theta1: num.optional(),
    theta2: num.optional(),
    fill: bool.optional(),
  },
  function: { expr },
  parametric: {
    x: expr,
    y: expr,
    t: range,
    trace: bool.optional(),
    dashed: bool.optional(),
  },
  incline: {
    x: num,
    y: num,
    run: pos,
    angle: num.gt(0).lt(89),
    face: z.enum(["left", "right"]).optional(),
    angleLabel: label,
    block: obj({ at: num.min(0).max(1), size: pos, ...named }).optional(),
  },
  ground: { y: num, x1: num.optional(), x2: num.optional() },
  wall: {
    x: num,
    y: num,
    h: num.refine((x) => x !== 0),
    face: z.enum(["left", "right"]).optional(),
  },
  spring: { ...ends, coils: z.number().int().min(3).max(20).optional() },
  support: { x: num, y: num, kind: z.enum(["pin", "roller", "fixed"]) },
  dimension: { ...ends, offset: num },
  angle: { x: num, y: num, start: num, end: num, r: pos.optional() },
};
const item = z.discriminatedUnion(
  "type",
  Object.entries(primitives).map(([type, fields]) =>
    obj({ type: z.literal(type), ...fields, ...named }),
  ),
);
const base = z.discriminatedUnion("type", [
  obj({ type: z.literal("rect"), x: range, y: range }),
  obj({ type: z.literal("ellipse"), cx: num, cy: num, a: pos, b: pos }),
  obj({ type: z.literal("between"), x: range, lower: expr, upper: expr }),
  obj({ type: z.literal("between-y"), y: range, left: expr, right: expr }),
]);
const plotFields = {
  x: obj({ var: id, min: num, max: num, label: text(40).optional() }),
  y: obj({ min: num, max: num, label: text(40).optional() }).optional(),
  params: arr(
    obj({
      var: id,
      min: num,
      max: num,
      default: num,
      step: pos,
      label: text(40).optional(),
      unit: text(16).optional(),
    }),
    4,
  ).optional(),
  curves: arr(obj({ expr, label: text(40).optional(), color }), 3, 1),
  regions: arr(
    obj({
      type: z.enum(["under", "between"]),
      curve: z.union([z.number().int().nonnegative(), text(40)]),
      curve2: z.union([z.number().int().nonnegative(), text(40)]).optional(),
      from: num,
      to: num,
      color,
      label: text(40).optional(),
    }),
    4,
  ).optional(),
  animate: obj({
    param: id,
    period: num.min(0.5).max(30),
    loop: z.enum(["cycle", "bounce"]),
  }).optional(),
};
const edge = obj({ from: id, to: id, weight: num.optional(), label, color });
const node = obj({ id, label: text(24), color });
const gates = ["and", "or", "not", "nand", "nor", "xor", "xnor", "buffer"];
const circuitTypes = [
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
];
const gridPt = z.tuple([
  z.number().int().min(-2).max(24),
  z.number().int().min(-2).max(24),
]);
const component = z.discriminatedUnion("type", [
  obj({
    type: z.literal("ground"),
    at: gridPt,
    to: gridPt.optional(),
    label: text(20).optional(),
  }),
  ...circuitTypes.map((type) =>
    obj({
      type: z.literal(type),
      at: gridPt,
      to: gridPt,
      label: text(20).optional(),
      ...(["battery", "source", "current_source", "diode", "led"].includes(type)
        ? { flip: bool.optional() }
        : {}),
      ...(["source", "current_source"].includes(type)
        ? { ac: bool.optional() }
        : {}),
      ...(type === "switch" ? { closed: bool.optional() } : {}),
    }),
  ),
]);
export const specSchemas = {
  "parametric-plot": typed("parametric-plot", plotFields),
  "function-compare": typed("function-compare", plotFields),
  geometry2d: typed("geometry2d", {
    xRange: range,
    yRange: range,
    xLabel: text(12).optional(),
    yLabel: text(12).optional(),
    grid: z.union([bool, z.literal("polar")]).optional(),
    axes: bool.optional(),
    items: arr(item, 24, 1),
  }),
  surface3d: typed("surface3d", {
    xRange: range,
    yRange: range,
    zRange: range.optional(),
    aspect: z.enum(["data", "cube"]).optional(),
    surfaces: arr(
      z.union([
        obj({
          expr,
          label: text(40).optional(),
          color,
          opacity: num.min(0.05).max(1).optional(),
        }),
        obj({
          x: expr,
          y: expr,
          z: expr,
          uRange: range,
          vRange: range,
          label: text(40).optional(),
          color,
          opacity: num.min(0.05).max(1).optional(),
        }),
      ]),
      3,
      1,
    ),
    region: obj({
      base,
      surface: expr.optional(),
      lower: expr.optional(),
      color,
      label: text(40).optional(),
      floor: bool.optional(),
      wall: bool.optional(),
    }).optional(),
  }),
  "slope-field": typed("slope-field", {
    expr,
    xRange: range,
    yRange: range,
    density: z.number().int().min(7).max(17).optional(),
  }),
  transform2d: typed("transform2d", {
    matrix: z.tuple([
      z.tuple([num.min(-50).max(50), num.min(-50).max(50)]),
      z.tuple([num.min(-50).max(50), num.min(-50).max(50)]),
    ]),
    show: obj({
      grid: bool.optional(),
      basis: bool.optional(),
      eigen: bool.optional(),
      unitCircle: bool.optional(),
    }).optional(),
    vectors: arr(obj({ x: num, y: num, ...named }), 4).optional(),
    range: z.number().int().min(2).max(12).optional(),
    animate: bool.optional(),
  }),
  graph: typed("graph", {
    directed: bool.optional(),
    layout: z.enum(["force", "circular"]).optional(),
    nodes: arr(node, 16, 1),
    edges: arr(edge, 30),
    highlight: obj({
      nodes: arr(id, 16).optional(),
      edges: arr(z.tuple([id, id]), 30).optional(),
    }).optional(),
  }),
  tree: typed("tree", {
    nodes: arr(
      obj({ id, label: text(24), parent: id.optional(), color }),
      24,
      1,
    ),
  }),
  diagram: typed("diagram", {
    nodes: arr(
      obj({
        id,
        label: text(60).min(1),
        x: num.min(0).max(1),
        y: num.min(0).max(1),
        color,
      }),
      14,
      1,
    ),
    edges: arr(
      obj({ from: id, to: id, label: text(40).optional() }),
      24,
    ).optional(),
  }),
  "logic-circuit": typed("logic-circuit", {
    inputs: arr(
      obj({
        id,
        label,
        value: z.union([z.literal(0), z.literal(1)]).optional(),
      }),
      4,
      1,
    ),
    gates: arr(
      obj({ id, type: z.enum(gates), inputs: arr(id, 4, 1), label }),
      14,
      1,
    ),
    outputs: arr(obj({ from: id, label }), 3, 1).optional(),
    truthTable: bool.optional(),
  }),
  circuit: typed("circuit", { components: arr(component, 24, 1) }),
  chart: typed("chart", {
    chartType: z.enum(["bar", "line", "scatter", "pie"]),
    labels: arr(text(28), 12, 1).optional(),
    x: obj({ label: text(30) }).optional(),
    y: obj({ label: text(30) }).optional(),
    series: arr(
      z.union([
        obj({ name: text(28).optional(), color, data: arr(num, 12, 1) }),
        obj({
          name: text(28).optional(),
          color,
          points: arr(obj({ x: num, y: num }), 60, 1),
        }),
      ]),
      4,
      1,
    ),
  }),
  distribution: typed("distribution", {
    dist: z.enum(["normal", "t", "chisq", "exponential", "uniform"]),
    params: z.union([
      obj({ mu: num, sigma: pos }),
      obj({ df: pos }),
      obj({ lambda: pos }),
      obj({ a: num, b: num }),
    ]),
    xRange: range.optional(),
    shade: obj({
      from: num.nullable(),
      to: num.nullable(),
      label: text(40).optional(),
      color,
    }).optional(),
    marks: arr(
      obj({ x: num, label: text(40).optional(), color }),
      6,
    ).optional(),
  }),
  table: typed("table", {
    rows: arr(arr(text(40), 8, 1), 12, 1),
    headerRow: bool.optional(),
    headerCol: bool.optional(),
    highlight: arr(
      obj({
        r: z.number().int().nonnegative(),
        c: z.number().int().nonnegative(),
        color,
      }),
      24,
    ).optional(),
  }),
  numberline: typed("numberline", {
    min: num,
    max: num,
    points: arr(
      obj({ x: num, ...named, open: bool.optional() }),
      12,
    ).optional(),
    intervals: arr(
      obj({
        from: num,
        to: num,
        ...named,
        openFrom: bool.optional(),
        openTo: bool.optional(),
      }),
      6,
    ).optional(),
  }),
  timeline: typed("timeline", {
    events: arr(
      obj({ label: text(30).min(1), at: text(20).optional(), color }),
      10,
      1,
    ),
  }),
  venn: typed("venn", {
    sets: arr(obj({ label: text(24).min(1), color }), 3, 2),
    regions: arr(
      obj({
        cells: z.enum(["A", "B", "AB", "C", "AC", "BC", "ABC"]),
        label: text(24),
      }),
      7,
    ).optional(),
  }),
  "bracket-sim": typed("bracket-sim", {
    input: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[()[\]{}a-zA-Z0-9+\-*/^.,= ]+$/),
    examples: arr(
      z
        .string()
        .max(60)
        .regex(/^[()[\]{}a-zA-Z0-9+\-*/^.,= ]+$/),
      6,
    ).optional(),
  }),
  "memory-sim": typed("memory-sim", {
    code: arr(text(80), 10, 1),
    frames: arr(obj({ id, label: text(40).min(1) }), 6, 1),
    slots: arr(
      obj({
        id,
        frame: id,
        label: text(40).min(1),
        type: z.enum(["reference", "primitive"]),
        color,
      }),
      16,
    ),
    objects: arr(obj({ id, label: text(40).min(1), color }), 6),
    refs: arr(obj({ id, from: id, to: id, label }), 8),
    steps: arr(
      obj({
        line: z.number().int().nonnegative(),
        caption: text(120),
        show: arr(id, 24),
        focus: arr(id, 24).optional(),
      }),
      12,
      1,
    ),
    buttons: arr(
      obj({ label: text(40).min(1), step: z.number().int().nonnegative() }),
      6,
    ).optional(),
  }),
};
const checkBase = {
  id,
  diagram: id,
  label: text(160),
  tolerance: z.number().finite().min(0).max(1).optional(),
};
const curveRef = {
  curve: z.number().int().nonnegative().optional(),
  item: z.number().int().nonnegative().optional(),
  surface: z.number().int().nonnegative().optional(),
};
export const checkSchema = z.discriminatedUnion("kind", [
  obj({
    ...checkBase,
    kind: z.literal("value"),
    ...curveRef,
    at: z.record(id, num),
    expected: num,
  }),
  obj({
    ...checkBase,
    kind: z.literal("integral"),
    curve: z.number().int().nonnegative(),
    from: num,
    to: num,
    expected: num,
  }),
  obj({
    ...checkBase,
    kind: z.literal("derivative"),
    curve: z.number().int().nonnegative(),
    at: num,
    expected: num,
  }),
  obj({
    ...checkBase,
    kind: z.literal("matrix-vector"),
    vector: pt,
    expected: pt,
  }),
  obj({ ...checkBase, kind: z.literal("determinant"), expected: num }),
  obj({
    ...checkBase,
    kind: z.literal("logic-table"),
    expected: arr(arr(z.union([z.literal(0), z.literal(1)]), 3, 1), 16, 1),
  }),
  obj({
    ...checkBase,
    kind: z.literal("shortest-path"),
    from: id,
    to: id,
    expectedDistance: num,
    expectedPath: arr(id, 16, 1).optional(),
  }),
  obj({
    ...checkBase,
    kind: z.literal("force-balance"),
    items: arr(z.number().int().nonnegative(), 24, 1),
    expected: pt,
  }),
  obj({
    ...checkBase,
    kind: z.literal("distance"),
    items: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    expected: pos,
  }),
  obj({ ...checkBase, kind: z.literal("double-integral"), expected: num }),
  obj({
    ...checkBase,
    kind: z.literal("probability"),
    from: num,
    to: num,
    expected: z.number().min(0).max(1),
  }),
]);
export const documentSchema = obj({
  version: z.literal(1),
  title: text(120).min(1),
  description: text(2000).min(1),
  course: text(100).min(1),
  language: z.enum(["en", "he"]).optional(),
  assumptions: arr(text(500), 20),
  sources: arr(
    obj({
      title: text(200),
      url: z
        .string()
        .url()
        .regex(/^https?:\/\//),
    }),
    20,
  ).optional(),
  diagrams: arr(
    obj({ id, caption: text(1200).min(1), spec: z.unknown() }),
    16,
    1,
  ),
  checks: arr(checkSchema, 100),
});

function ensure(ok, msg) {
  if (!ok) throw new Error(msg);
}
function unique(xs, label) {
  ensure(new Set(xs).size === xs.length, `${label}: duplicate ID or entry`);
}
function acyclic(nodes, links) {
  const active = new Set(),
    done = new Set();
  const visit = (id) => {
    ensure(!active.has(id), `Cycle at ${id}`);
    if (done.has(id)) return;
    active.add(id);
    for (const next of links(id)) visit(next);
    active.delete(id);
    done.add(id);
  };
  nodes.forEach(visit);
}
function expression(src, vars) {
  parseExpr(src, vars);
}
function semantic(s) {
  if (s.curves) {
    ensure(s.x.max > s.x.min, "x.max must exceed x.min");
    if (s.y) ensure(s.y.max > s.y.min, "y.max must exceed y.min");
    const vars = [s.x.var, ...(s.params || []).map((p) => p.var)];
    unique(vars, "variables");
    ensure(
      !vars.some((x) => ["e", "pi"].includes(x)),
      "e and pi are constants, not variables",
    );
    for (const p of s.params || [])
      ensure(
        p.max > p.min &&
          p.default >= p.min &&
          p.default <= p.max &&
          p.step <= p.max - p.min,
        `Invalid parameter ${p.var}`,
      );
    for (const c of s.curves) expression(c.expr, vars);
    if (s.animate)
      ensure(
        (s.params || []).some((p) => p.var === s.animate.param),
        "Animation parameter not declared",
      );
    const resolve = (r) =>
      typeof r === "number" ? r : s.curves.findIndex((c) => c.label === r);
    for (const r of s.regions || []) {
      ensure(
        resolve(r.curve) >= 0 && resolve(r.curve) < s.curves.length,
        "Unknown shaded curve",
      );
      ensure(
        r.from >= s.x.min && r.to <= s.x.max && r.to > r.from,
        "Region must lie inside x range",
      );
      if (r.type === "between")
        ensure(
          resolve(r.curve2) >= 0 &&
            resolve(r.curve2) < s.curves.length &&
            resolve(r.curve2) !== resolve(r.curve),
          "Invalid second shaded curve",
        );
    }
  }
  if (s.nodes) {
    const ids = s.nodes.map((n) => n.id);
    unique(ids, "nodes");
    for (const e of s.edges || []) {
      ensure(
        ids.includes(e.from) && ids.includes(e.to),
        "Edge references missing node",
      );
      ensure(e.from !== e.to, "Self loops require a custom renderer");
    }
    if (s.kind === "graph") {
      const key = (a, b) =>
        s.directed ? `${a}/${b}` : [a, b].sort().join("/");
      unique(
        s.edges.map((e) => key(e.from, e.to)),
        "edges",
      );
      for (const n of s.highlight?.nodes || [])
        ensure(ids.includes(n), "Unknown highlighted node");
      for (const [a, b] of s.highlight?.edges || [])
        ensure(
          s.edges.some((e) => key(e.from, e.to) === key(a, b)),
          "Unknown highlighted edge",
        );
    }
    if (s.kind === "tree") {
      for (const n of s.nodes)
        if (n.parent) ensure(ids.includes(n.parent), "Missing tree parent");
      acyclic(ids, (id) =>
        s.nodes.filter((n) => n.parent === id).map((n) => n.id),
      );
    }
  }
  if (s.kind === "logic-circuit") {
    const ids = [...s.inputs, ...s.gates].map((n) => n.id);
    unique(ids, "logic nodes");
    for (const g of s.gates) {
      ensure(
        g.inputs.every((x) => ids.includes(x)),
        "Gate references missing input",
      );
      ensure(
        ["not", "buffer"].includes(g.type)
          ? g.inputs.length === 1
          : g.inputs.length >= 2,
        "Invalid gate arity",
      );
    }
    acyclic(ids, (id) => s.gates.find((g) => g.id === id)?.inputs || []);
    for (const o of s.outputs || [])
      ensure(ids.includes(o.from), "Unknown logic output");
    if (s.outputs)
      unique(
        s.outputs.map((o) => o.from),
        "outputs",
      );
    else {
      const used = new Set(s.gates.flatMap((g) => g.inputs));
      ensure(
        s.gates.filter((g) => !used.has(g.id)).length <= 3,
        "Specify at most 3 outputs",
      );
    }
  }
  if (s.kind === "geometry2d")
    for (const it of s.items) {
      if (it.type === "function") expression(it.expr, ["x"]);
      if (it.type === "parametric") {
        expression(it.x, ["t"]);
        expression(it.y, ["t"]);
      }
      if (it.type === "sector")
        ensure(
          it.r2 > it.r1 &&
            (!("theta2" in it) ||
              (it.theta2 - (it.theta1 ?? 0) > 1e-6 &&
                it.theta2 - (it.theta1 ?? 0) <= 2 * Math.PI)),
          "Sector bounds must increase",
        );
      if (
        ["line", "segment", "spring", "dimension", "vector"].includes(it.type)
      )
        ensure(it.x1 !== it.x2 || it.y1 !== it.y2, "Zero-length primitive");
      if (it.type === "angle") ensure(it.end !== it.start, "Zero angle");
    }
  if (s.kind === "surface3d") {
    for (const p of s.surfaces) {
      if (p.expr) expression(p.expr, ["x", "y"]);
      else for (const k of ["x", "y", "z"]) expression(p[k], ["u", "v"]);
    }
    if (s.region) {
      if (s.region.surface) expression(s.region.surface, ["x", "y"]);
      else
        ensure(
          s.surfaces.some((p) => p.expr),
          "An integration region needs an explicit integrand surface",
        );
      if (s.region.lower) expression(s.region.lower, ["x", "y"]);
      const b = s.region.base;
      if (b.type === "between") {
        expression(b.lower, ["x"]);
        expression(b.upper, ["x"]);
      }
      if (b.type === "between-y") {
        expression(b.left, ["y"]);
        expression(b.right, ["y"]);
      }
    }
  }
  if (s.kind === "slope-field") expression(s.expr, ["x", "y"]);
  if (s.kind === "transform2d")
    for (const v of s.vectors || [])
      ensure(
        v.x !== 0 || v.y !== 0,
        "Zero vector cannot have a visible direction",
      );
  if (s.kind === "circuit")
    for (const c of s.components) {
      if (c.to)
        ensure(
          (c.at[0] === c.to[0]) !== (c.at[1] === c.to[1]),
          "Components must span nonzero axis-aligned grid segments",
        );
    }
  if (s.kind === "distribution") {
    const keys = {
      normal: ["mu", "sigma"],
      t: ["df"],
      chisq: ["df"],
      exponential: ["lambda"],
      uniform: ["a", "b"],
    }[s.dist];
    ensure(
      keys.every((k) => k in s.params),
      "Parameters do not match distribution",
    );
    if (s.dist === "uniform")
      ensure(s.params.b > s.params.a, "Uniform b must exceed a");
    if (s.shade)
      ensure(
        (s.shade.from !== null || s.shade.to !== null) &&
          (s.shade.from === null ||
            s.shade.to === null ||
            s.shade.to > s.shade.from),
        "Invalid probability interval",
      );
  }
  if (s.kind === "chart") {
    if (s.chartType === "scatter")
      ensure(
        s.series.every((x) => x.points),
        "Scatter needs points",
      );
    else {
      ensure(
        s.labels?.length &&
          s.series.every((x) => x.data?.length === s.labels.length),
        "Data length must match labels",
      );
      if (s.chartType === "pie")
        ensure(
          s.series.length === 1 &&
            s.series[0].data.every((x) => x >= 0) &&
            s.series[0].data.some((x) => x > 0),
          "Pie needs one nonnegative series with positive total",
        );
    }
  }
  if (s.kind === "table") {
    ensure(
      s.rows.every((r) => r.length === s.rows[0].length),
      "Table rows must have equal length",
    );
    for (const h of s.highlight || [])
      ensure(
        h.r < s.rows.length && h.c < s.rows[0].length,
        "Table highlight out of range",
      );
  }
  if (s.kind === "numberline") {
    ensure(s.max > s.min, "Number line must increase");
    for (const p of s.points || [])
      ensure(p.x >= s.min && p.x <= s.max, "Point outside number line");
    for (const r of s.intervals || [])
      ensure(
        r.to > r.from && r.from >= s.min && r.to <= s.max,
        "Interval outside number line",
      );
  }
  if (s.kind === "venn") {
    unique(
      (s.regions || []).map((r) => r.cells),
      "Venn regions",
    );
    ensure(
      s.sets.length === 3 ||
        !(s.regions || []).some((r) => r.cells.includes("C")),
      "Region C needs 3 sets",
    );
  }
  if (s.kind === "memory-sim") {
    const all = [...s.frames, ...s.slots, ...s.objects, ...s.refs];
    unique(
      all.map((x) => x.id),
      "memory IDs",
    );
    for (const slot of s.slots)
      ensure(
        s.frames.some((f) => f.id === slot.frame),
        "Unknown frame",
      );
    for (const r of s.refs)
      ensure(
        s.slots.some((x) => x.id === r.from && x.type === "reference") &&
          s.objects.some((x) => x.id === r.to),
        "Invalid memory reference",
      );
    for (const st of s.steps) {
      ensure(st.line < s.code.length, "Code line out of range");
      unique(st.show, "step show");
      ensure(
        st.show.every((id) => all.some((x) => x.id === id)),
        "Unknown visible ID",
      );
      for (const slot of s.slots.filter((x) => st.show.includes(x.id)))
        ensure(st.show.includes(slot.frame), "Visible slot requires frame");
      for (const ref of s.refs.filter((x) => st.show.includes(x.id)))
        ensure(
          st.show.includes(ref.from) && st.show.includes(ref.to),
          "Visible reference requires endpoints",
        );
      ensure(
        (st.focus || []).every((id) => st.show.includes(id)),
        "Focus must be visible",
      );
    }
    for (const b of s.buttons || [])
      ensure(b.step < s.steps.length, "Button step out of range");
  }
}
export function strictSpec(input) {
  const schema = specSchemas[input?.kind];
  ensure(schema, `Unsupported diagram kind: ${input?.kind}`);
  const raw = schema.parse(input);
  semantic(raw);
  const result = validateSpec(raw);
  ensure(result.ok && !result.errors.length, result.errors.join("; "));
  return result.spec;
}
export function validateDocument(input) {
  const doc = documentSchema.parse(input);
  unique(
    doc.diagrams.map((d) => d.id),
    "diagram IDs",
  );
  unique(
    doc.checks.map((c) => c.id),
    "check IDs",
  );
  doc.diagrams = doc.diagrams.map((d) => ({ ...d, spec: strictSpec(d.spec) }));
  for (const c of doc.checks)
    ensure(
      doc.diagrams.some((d) => d.id === c.diagram),
      `Check ${c.id} references missing diagram`,
    );
  return doc;
}
export function schemaJSON() {
  return z.toJSONSchema(documentSchema, { unrepresentable: "any" });
}
