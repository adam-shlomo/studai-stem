import { parseExpr, evalExpr, evalLogic, distPdf } from "./viz-spec.js";
const assert = (x, m) => {
  if (!x) throw new Error(m);
};
const finite = (x) => {
  assert(Number.isFinite(x), "Non-finite value in calculation");
  return x;
};
export function integrate(fn, a, b, tolerance = 1e-8) {
  assert(
    Number.isFinite(a) && Number.isFinite(b) && b > a,
    "Integration bounds must be finite and increase",
  );
  let calls = 0;
  const f = (x) => {
    assert(++calls <= 100000, "Integration evaluation limit reached");
    return finite(fn(x));
  };
  const fa = f(a),
    fb = f(b),
    m = (a + b) / 2,
    fm = f(m),
    whole = ((b - a) * (fa + 4 * fm + fb)) / 6;
  function recurse(a, b, fa, fm, fb, whole, eps, depth) {
    const m = (a + b) / 2,
      l = (a + m) / 2,
      r = (m + b) / 2,
      fl = f(l),
      fr = f(r);
    const left = ((m - a) * (fa + 4 * fl + fm)) / 6,
      right = ((b - m) * (fm + 4 * fr + fb)) / 6,
      delta = left + right - whole;
    if (Math.abs(delta) <= 15 * eps)
      return { value: left + right + delta / 15, error: Math.abs(delta) / 15 };
    assert(
      depth > 0,
      "Integration did not converge; split at singularities or use another method",
    );
    const x = recurse(a, m, fa, fl, fm, left, eps / 2, depth - 1),
      y = recurse(m, b, fm, fr, fb, right, eps / 2, depth - 1);
    return { value: x.value + y.value, error: x.error + y.error };
  }
  return {
    ...recurse(a, b, fa, fm, fb, whole, tolerance, 18),
    evaluations: calls,
    method: "adaptive Simpson quadrature (estimated error)",
  };
}
export function differentiate(fn, x) {
  const h = Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(x));
  const d1 = (finite(fn(x + h)) - finite(fn(x - h))) / (2 * h),
    d2 = (finite(fn(x + h / 2)) - finite(fn(x - h / 2))) / h;
  return {
    value: (4 * d2 - d1) / 3,
    error: Math.abs(d2 - d1),
    method: "central difference with Richardson extrapolation",
  };
}
export function shortestPath(spec, from, to) {
  assert(spec.kind === "graph", "shortest-path requires graph");
  assert(
    spec.nodes.some((n) => n.id === from) &&
      spec.nodes.some((n) => n.id === to),
    "Unknown path endpoint",
  );
  for (const e of spec.edges)
    assert(
      Number.isFinite(e.weight) && e.weight >= 0,
      "Dijkstra needs explicit nonnegative edge weights",
    );
  const distance = new Map(spec.nodes.map((n) => [n.id, Infinity])),
    prev = new Map(),
    pending = new Set(distance.keys());
  distance.set(from, 0);
  while (pending.size) {
    const u = [...pending].sort(
      (a, b) => distance.get(a) - distance.get(b) || a.localeCompare(b),
    )[0];
    pending.delete(u);
    if (!Number.isFinite(distance.get(u))) break;
    for (const e of spec.edges) {
      const v =
        e.from === u ? e.to : !spec.directed && e.to === u ? e.from : null;
      if (v === null || !pending.has(v)) continue;
      const d = distance.get(u) + e.weight;
      if (d < distance.get(v)) {
        distance.set(v, d);
        prev.set(v, u);
      }
    }
  }
  const d = distance.get(to);
  if (!Number.isFinite(d))
    return { distance: null, path: [], reachable: false };
  const path = [to];
  while (path[0] !== from) {
    assert(prev.has(path[0]), "Broken predecessor chain");
    path.unshift(prev.get(path[0]));
  }
  return { distance: d, path, reachable: true };
}
export function logicTable(spec) {
  assert(spec.kind === "logic-circuit", "logic-table requires logic-circuit");
  return Array.from({ length: 2 ** spec.inputs.length }, (_, row) => {
    const bits = Object.fromEntries(
      spec.inputs.map((n, i) => [
        n.id,
        (row >> (spec.inputs.length - i - 1)) & 1,
      ]),
    );
    const values = evalLogic(spec, bits);
    return spec.outputs.map((o) => values[o.from]);
  });
}
export function doubleIntegral(spec, n = 40) {
  assert(
    Number.isInteger(n) && n >= 2 && n % 2 === 0 && n <= 512,
    "Even integration resolution 2..512 required",
  );
  assert(
    spec.kind === "surface3d" && spec.region,
    "double-integral requires an explicit surface region",
  );
  const r = spec.region,
    b = r.base;
  const f = (x, y) =>
    finite(
      evalExpr(r._surfaceAst, { x, y }) -
        (r._lowerAst ? evalExpr(r._lowerAst, { x, y }) : 0),
    );
  let sum = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      let x, y, jac;
      if (b.type === "rect") {
        x = b.x[0] + (i * (b.x[1] - b.x[0])) / n;
        y = b.y[0] + (j * (b.y[1] - b.y[0])) / n;
        jac = (b.x[1] - b.x[0]) * (b.y[1] - b.y[0]);
      } else if (b.type === "ellipse") {
        const rho = i / n,
          theta = (2 * Math.PI * j) / n;
        x = b.cx + b.a * rho * Math.cos(theta);
        y = b.cy + b.b * rho * Math.sin(theta);
        jac = 2 * Math.PI * b.a * b.b * rho;
      } else if (b.type === "between") {
        x = b.x[0] + (i * (b.x[1] - b.x[0])) / n;
        const lo = finite(evalExpr(b._lowerAst, { x })),
          hi = finite(evalExpr(b._upperAst, { x }));
        assert(hi >= lo, "Domain upper bound lies below lower bound");
        y = lo + (j * (hi - lo)) / n;
        jac = (b.x[1] - b.x[0]) * (hi - lo);
      } else {
        y = b.y[0] + (i * (b.y[1] - b.y[0])) / n;
        const lo = finite(evalExpr(b._leftAst, { y })),
          hi = finite(evalExpr(b._rightAst, { y }));
        assert(hi >= lo, "Domain right bound lies left of left bound");
        x = lo + (j * (hi - lo)) / n;
        jac = (b.y[1] - b.y[0]) * (hi - lo);
      }
      const wi = i === 0 || i === n ? 1 : i % 2 ? 4 : 2,
        wj = j === 0 || j === n ? 1 : j % 2 ? 4 : 2;
      sum += (f(x, y) * jac * wi * wj) / (9 * n * n);
    }
  return sum;
}
function curveFunction(spec, index) {
  assert(spec.curves?.[index], "Curve index not found");
  const params = Object.fromEntries(
    (spec.params || []).map((p) => [p.var, p.default]),
  );
  return (x) =>
    evalExpr(spec.curves[index]._ast, { ...params, [spec.x.var]: x });
}
function evaluateCheck(c, s) {
  if (c.kind === "value") {
    assert(
      [c.curve, c.item, c.surface].filter((v) => v !== undefined).length ===
        (s.kind === "slope-field" ? 0 : 1),
      "Specify exactly one scalar expression reference",
    );
    let ast,
      vars,
      defaults = {};
    if (c.curve !== undefined) {
      assert(s.curves?.[c.curve], "Curve not found");
      ast = s.curves[c.curve]._ast;
      vars = [s.x.var, ...(s.params || []).map((p) => p.var)];
      defaults = Object.fromEntries(
        (s.params || []).map((p) => [p.var, p.default]),
      );
      assert(s.x.var in c.at, "Missing independent variable");
    } else if (c.item !== undefined) {
      ast = s.items?.[c.item]?._ast;
      vars = ["x"];
      assert("x" in c.at, "Missing x");
    } else if (c.surface !== undefined) {
      ast = s.surfaces?.[c.surface]?._ast;
      vars = ["x", "y"];
      assert("x" in c.at && "y" in c.at, "Missing x or y");
    } else if (s.kind === "slope-field") {
      ast = s._ast;
      vars = ["x", "y"];
      assert("x" in c.at && "y" in c.at, "Missing x or y");
    } else
      throw new Error(
        "Value check requires a curve, function item, explicit surface, or slope field",
      );
    assert(ast, "Reference has no scalar expression");
    assert(
      Object.keys(c.at).every((k) => vars.includes(k)),
      "Unexpected evaluation variable",
    );
    return {
      actual: finite(evalExpr(ast, { ...defaults, ...c.at })),
      expected: c.expected,
      method: "restricted expression evaluation",
    };
  }
  if (c.kind === "integral") {
    assert(
      c.from >= s.x.min && c.to <= s.x.max,
      "Integral lies outside plotted domain",
    );
    const a = integrate(
      curveFunction(s, c.curve),
      c.from,
      c.to,
      Math.min((c.tolerance || 1e-6) / 10, 1e-8),
    );
    return { ...a, actual: a.value, expected: c.expected };
  }
  if (c.kind === "derivative") {
    const a = differentiate(curveFunction(s, c.curve), c.at);
    return { ...a, actual: a.value, expected: c.expected };
  }
  if (c.kind === "determinant") {
    assert(s.kind === "transform2d", "determinant requires transform2d");
    const [[a, b], [d, e]] = s.matrix;
    return {
      actual: a * e - b * d,
      expected: c.expected,
      method: "2 by 2 determinant",
    };
  }
  if (c.kind === "matrix-vector") {
    assert(s.kind === "transform2d", "matrix-vector requires transform2d");
    return {
      actual: s.matrix.map((r) => r[0] * c.vector[0] + r[1] * c.vector[1]),
      expected: c.expected,
      method: "matrix times column vector",
    };
  }
  if (c.kind === "logic-table")
    return {
      actual: logicTable(s),
      expected: c.expected,
      method: "exhaustive truth table, inputs in listed order, MSB first",
    };
  if (c.kind === "shortest-path") {
    const a = shortestPath(s, c.from, c.to);
    assert(a.reachable, "Target unreachable");
    if (c.expectedPath)
      assert(
        JSON.stringify(a.path) === JSON.stringify(c.expectedPath),
        "Expected path differs from deterministic Dijkstra result",
      );
    if (s.highlight?.edges?.length) {
      const key = (a, b) =>
        s.directed ? `${a}/${b}` : [a, b].sort().join("/");
      const marked = s.highlight.edges.map(([a, b]) => key(a, b)).sort();
      const path = a.path
        .slice(1)
        .map((b, i) => key(a.path[i], b))
        .sort();
      assert(
        JSON.stringify(marked) === JSON.stringify(path),
        "Highlighted edges do not match computed shortest path",
      );
    }
    return {
      actual: a.distance,
      expected: c.expectedDistance,
      path: a.path,
      method: "Dijkstra, lexical node-ID tie break",
    };
  }
  if (c.kind === "force-balance") {
    assert(s.kind === "geometry2d", "force-balance requires geometry2d");
    assert(new Set(c.items).size === c.items.length, "Repeated force index");
    const vs = c.items.map((i) => s.items[i]);
    assert(
      vs.every((v) => v?.type === "vector"),
      "Forces must refer to vector primitives",
    );
    return {
      actual: vs.reduce(
        (a, v) => [a[0] + v.x2 - v.x1, a[1] + v.y2 - v.y1],
        [0, 0],
      ),
      expected: c.expected,
      method: "sum of drawn vector components; common force scale required",
    };
  }
  if (c.kind === "distance") {
    const [a, b] = c.items.map((i) => s.items?.[i]);
    assert(
      a?.type === "point" && b?.type === "point",
      "distance requires two points",
    );
    return {
      actual: Math.hypot(a.x - b.x, a.y - b.y),
      expected: c.expected,
      method: "Euclidean distance in world coordinates",
    };
  }
  if (c.kind === "double-integral") {
    let n = 20,
      a = doubleIntegral(s, n),
      b,
      error;
    do {
      n *= 2;
      b = doubleIntegral(s, n);
      error = Math.abs(a - b) / 15;
      if (error <= (c.tolerance ?? 1e-6) / 10) break;
      a = b;
    } while (n < 320);
    return {
      actual: b,
      expected: c.expected,
      error,
      method: `tensor Simpson quadrature in domain coordinates; ${n / 2} and ${n} subdivisions`,
    };
  }
  if (c.kind === "probability") {
    assert(s.kind === "distribution", "probability requires distribution");
    const a = integrate(
      (x) => distPdf(s.dist, s.params, x),
      c.from,
      c.to,
      1e-9,
    );
    return { ...a, actual: a.value, expected: c.expected };
  }
  throw new Error(`Unsupported check: ${c.kind}`);
}
function maxDifference(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    assert(
      Array.isArray(a) && Array.isArray(b) && a.length === b.length,
      "Result shape mismatch",
    );
    return Math.max(0, ...a.map((x, i) => maxDifference(x, b[i])));
  }
  return Math.abs(finite(a) - finite(b));
}
export function verify(doc) {
  const checks = doc.checks.map((c) => {
    try {
      const s = doc.diagrams.find((d) => d.id === c.diagram).spec;
      const result = evaluateCheck(c, s),
        tolerance = c.tolerance ?? 1e-6,
        difference = maxDifference(result.actual, result.expected);
      return {
        id: c.id,
        diagram: c.diagram,
        label: c.label,
        ...result,
        tolerance,
        difference,
        status:
          difference <= tolerance && (result.error ?? 0) <= tolerance
            ? "passed"
            : "failed",
      };
    } catch (e) {
      return {
        id: c.id,
        diagram: c.diagram,
        label: c.label,
        status: "failed",
        error: e.message,
      };
    }
  });
  const uncheckedDiagrams = doc.diagrams
    .filter((d) => !checks.some((c) => c.diagram === d.id))
    .map((d) => d.id);
  return {
    version: 1,
    status: checks.some((c) => c.status === "failed")
      ? "failed"
      : checks.length
        ? "checks-passed"
        : "unchecked",
    passed: checks.filter((c) => c.status === "passed").length,
    total: checks.length,
    uncheckedDiagrams,
    checks,
    limitations: [
      "Passing checks validate only the listed assertions at the stated inputs and tolerances.",
      "Finite sampling is not a proof, and the drawing, source interpretation, units, and full parameter range still require review.",
      "Schematic circuitry and supplied algorithm traces are not circuit simulation or program execution.",
    ],
  };
}
