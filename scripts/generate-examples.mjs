import { mkdir, writeFile } from "node:fs/promises";
import { validateDocument } from "../src/schema.js";
import { verify } from "../src/numerics.js";
const root = "skills/studai-stem/assets/examples";
await mkdir(root, { recursive: true });
const examples = [];
const plot = (title, exprs, min = -3, max = 3, options = {}) => ({
  v: 1,
  kind: exprs.length > 1 ? "function-compare" : "parametric-plot",
  title,
  x: { var: "x", min, max, label: "x" },
  curves: exprs.map((expr, i) => ({
    expr,
    label: ["f", "g", "h"][i],
    color: ["accent", "evTeal", "warning"][i],
  })),
  ...options,
});
const geo = (
  title,
  items,
  xRange = [-4, 4],
  yRange = [-3, 3],
  options = {},
) => ({ v: 1, kind: "geometry2d", title, xRange, yRange, items, ...options });
const vector = (x1, y1, x2, y2, label, color = "accent") => ({
  type: "vector",
  x1,
  y1,
  x2,
  y2,
  label,
  color,
});
const add = (
  slug,
  course,
  title,
  description,
  assumptions,
  diagrams,
  checks = [],
) =>
  examples.push({
    slug,
    doc: {
      version: 1,
      title,
      description,
      course,
      assumptions,
      diagrams: diagrams.map((d, i) => ({
        id: `fig${i + 1}`,
        caption: d.caption,
        spec: d.spec,
      })),
      checks: checks.map((c, i) => ({
        id: `check${i + 1}`,
        diagram: "fig1",
        ...c,
      })),
    },
  });
const val = (label, at, expected, curve = 0) => ({
  kind: "value",
  label,
  curve,
  at: { x: at },
  expected,
  tolerance: 1e-8,
});
add(
  "calculus-tangent",
  "Calculus I",
  "A tangent is a local model",
  "Compare a parabola with its tangent at x = 1.",
  [
    "Real x; Euclidean axes.",
    "The tangent approximation is local; it is not the curve.",
  ],
  [
    {
      spec: plot("Parabola and tangent", ["x^2", "2*x-1"], -1, 3),
      caption:
        "Both curves meet at (1, 1). The derivative of x² is 2x, so the tangent has slope 2 at x = 1.",
    },
  ],
  [
    val("Parabola at tangency", 1, 1),
    val("Tangent at tangency", 1, 1, 1),
    {
      kind: "derivative",
      label: "Derivative at x = 1",
      curve: 0,
      at: 1,
      expected: 2,
    },
  ],
);
add(
  "calculus-integral",
  "Calculus II",
  "Area between two curves",
  "The region between y = x and y = x² on [0, 1].",
  ["Bounds are 0 ≤ x ≤ 1.", "The upper curve is x; the lower curve is x²."],
  [
    {
      spec: plot("The bounded area", ["x", "x^2"], 0, 1, {
        regions: [
          {
            type: "between",
            curve: 0,
            curve2: 1,
            from: 0,
            to: 1,
            label: "Area = 1/6",
          },
        ],
      }),
      caption:
        "Integrating the upper curve and subtracting the integral of the lower curve gives 1/2 − 1/3 = 1/6.",
    },
  ],
  [
    {
      kind: "integral",
      label: "Integral of x",
      curve: 0,
      from: 0,
      to: 1,
      expected: 0.5,
    },
    {
      kind: "integral",
      label: "Integral of x²",
      curve: 1,
      from: 0,
      to: 1,
      expected: 1 / 3,
    },
  ],
);
add(
  "calculus-taylor",
  "Calculus II",
  "How a Taylor approximation changes with distance",
  "Compare sin(x) with first- and third-order Taylor polynomials around zero.",
  ["Angles in radians.", "Polynomials are centered at x = 0."],
  [
    {
      spec: plot(
        "Sine and local polynomials",
        ["sin(x)", "x", "x-x^3/6"],
        -3.14,
        3.14,
      ),
      caption:
        "All three match at the origin. The cubic follows sin(x) over a wider neighborhood, but its error grows away from zero.",
    },
  ],
  [
    val("sin(0)", 0, 0),
    val("Cubic at zero", 0, 0, 2),
    {
      kind: "derivative",
      label: "Sine derivative at zero",
      curve: 0,
      at: 0,
      expected: 1,
    },
  ],
);
add(
  "calculus-asymptote",
  "Calculus I",
  "A vertical asymptote is a gap",
  "The reciprocal function has two branches separated by x = 0.13.",
  [
    "The function is undefined at x = 0.13.",
    "A finite plot window clips large values; it does not bound the function.",
  ],
  [
    {
      spec: plot("Reciprocal with an offset pole", ["1/(x-0.13)"], -2, 2, {
        y: { min: -10, max: 10, label: "f(x)" },
      }),
      caption:
        "The branches must not be connected through the vertical asymptote. Check both sides of the pole.",
    },
  ],
  [val("Right of pole", 1.13, 1), val("Left of pole", -0.87, -1)],
);
add(
  "linear-algebra-eigenvectors",
  "Linear algebra",
  "A symmetric linear transformation",
  "Apply A = [[2, 1], [1, 2]] to vectors and a unit circle.",
  [
    "Vectors are columns; the standard basis is e₁, e₂.",
    "The interpolation control shows (1 − t)I + tA, not a physical rotation.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "transform2d",
        title: "Stretch along eigendirections",
        matrix: [
          [2, 1],
          [1, 2],
        ],
        vectors: [{ x: 1, y: 1, label: "v" }],
        show: { grid: true, basis: true, eigen: true, unitCircle: true },
        range: 5,
      },
      caption:
        "The vector (1, 1) is stretched by 3. The perpendicular direction (1, −1) is unchanged. Areas scale by det(A) = 3.",
    },
  ],
  [
    {
      kind: "matrix-vector",
      label: "A(1, 1) = (3, 3)",
      vector: [1, 1],
      expected: [3, 3],
    },
    { kind: "determinant", label: "Area factor", expected: 3 },
  ],
);
add(
  "linear-algebra-projection",
  "Linear algebra",
  "A projection loses a dimension",
  "Project the plane onto the x axis.",
  [
    "A = diag(1, 0).",
    "A singular transformation is valid and must not be replaced by the identity.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "transform2d",
        title: "Projection onto x",
        matrix: [
          [1, 0],
          [0, 0],
        ],
        vectors: [{ x: 2, y: 1, label: "v" }],
        show: { grid: true, basis: true, unitCircle: true },
        range: 3,
      },
      caption:
        "Every point (x, y) becomes (x, 0). The unit circle collapses to a line segment, and the area factor is zero.",
    },
  ],
  [
    {
      kind: "matrix-vector",
      label: "Projection of (2, 1)",
      vector: [2, 1],
      expected: [2, 0],
    },
    { kind: "determinant", label: "Singular determinant", expected: 0 },
  ],
);
add(
  "complex-plane",
  "Complex analysis",
  "Complex multiplication rotates the plane",
  "Multiplication by i is a 90° counterclockwise rotation.",
  [
    "Re(z) is the horizontal axis; Im(z) is vertical.",
    "The transformation acts on the real coordinate pair (Re z, Im z).",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "transform2d",
        title: "z ↦ iz",
        matrix: [
          [0, -1],
          [1, 0],
        ],
        vectors: [{ x: 2, y: 1, label: "z" }],
        show: { basis: true, grid: true, unitCircle: true },
        range: 3,
      },
      caption:
        "The complex number 2 + i becomes −1 + 2i. Length and area are preserved.",
    },
  ],
  [
    {
      kind: "matrix-vector",
      label: "i(2 + i) = −1 + 2i",
      vector: [2, 1],
      expected: [-1, 2],
    },
    { kind: "determinant", label: "Area preserved", expected: 1 },
  ],
);
add(
  "multivariable-disk",
  "Multivariable calculus",
  "A solid above a disk",
  "The volume under z = 4 − x² − y² over the unit disk.",
  [
    "D: x² + y² ≤ 1.",
    "The lower surface is z = 0; the integrand is nonnegative on D.",
    "The polar-coordinate Jacobian r is included in the calculation.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "surface3d",
        title: "Volume over D",
        xRange: [-1.2, 1.2],
        yRange: [-1.2, 1.2],
        zRange: [0, 4],
        aspect: "data",
        surfaces: [{ expr: "4-x^2-y^2", color: "evTeal" }],
        region: {
          base: { type: "ellipse", cx: 0, cy: 0, a: 1, b: 1 },
          label: "Unit disk",
        },
      },
      caption:
        "The green cap, wall and base identify the integration domain. The exact volume is 7π/2.",
    },
  ],
  [
    {
      kind: "double-integral",
      label: "Volume = 7π/2",
      expected: (7 * Math.PI) / 2,
      tolerance: 0.001,
    },
  ],
);
add(
  "multivariable-between-surfaces",
  "Multivariable calculus",
  "Volume between surfaces",
  "Integrate the height difference over a rectangular base.",
  ["0 ≤ x ≤ 1 and 0 ≤ y ≤ 2.", "Upper surface 3 + x; lower surface x."],
  [
    {
      spec: {
        v: 1,
        kind: "surface3d",
        title: "A constant vertical separation",
        xRange: [0, 1.2],
        yRange: [0, 2.2],
        zRange: [0, 4.5],
        aspect: "data",
        surfaces: [
          { expr: "3+x", color: "accent" },
          { expr: "x", color: "evTeal" },
        ],
        region: {
          base: { type: "rect", x: [0, 1], y: [0, 2] },
          surface: "3+x",
          lower: "x",
          label: "D",
        },
      },
      caption:
        "The height is 3 everywhere on a base of area 2, so the volume is 6.",
    },
  ],
  [
    {
      kind: "double-integral",
      label: "Volume = 6",
      expected: 6,
      tolerance: 1e-6,
    },
  ],
);
add(
  "multivariable-type-ii",
  "Multivariable calculus",
  "Read a type-II integration domain",
  "The triangular region 0 ≤ x ≤ y, 0 ≤ y ≤ 2.",
  [
    "Integrate with respect to x first.",
    "The constant surface z = 1 turns the volume into the area of D.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "surface3d",
        title: "Type-II domain",
        xRange: [0, 2.2],
        yRange: [0, 2.2],
        zRange: [0, 1.2],
        surfaces: [{ expr: "1" }],
        region: {
          base: { type: "between-y", y: [0, 2], left: "0", right: "y" },
          label: "0 ≤ x ≤ y",
        },
      },
      caption:
        "Each horizontal slice has width y. Integrating y from 0 to 2 gives area 2.",
    },
  ],
  [
    {
      kind: "double-integral",
      label: "Triangle area = 2",
      expected: 2,
      tolerance: 1e-6,
    },
  ],
);
add(
  "polar-annulus",
  "Multivariable calculus",
  "An annular sector in polar coordinates",
  "Show 1 ≤ r ≤ 2 and 0 ≤ θ ≤ π/2.",
  [
    "θ is measured counterclockwise in radians.",
    "Equal axis scales preserve circles and angles.",
  ],
  [
    {
      spec: geo(
        "Quarter annulus",
        [
          {
            type: "sector",
            r1: 1,
            r2: 2,
            theta1: 0,
            theta2: Math.PI / 2,
            label: "D",
          },
        ],
        [-0.4, 2.4],
        [-0.4, 2.4],
        { grid: "polar", xLabel: "x", yLabel: "y" },
      ),
      caption:
        "Both curved boundaries are circular arcs, not polygon chords. The area is 3π/4; this figure is schematic and has no built-in area assertion.",
    },
  ],
);
add(
  "differential-equations",
  "Differential equations",
  "A slope field for logistic growth",
  "Draw the direction field y′ = y(1 − y).",
  [
    "Independent variable x is time in normalized units.",
    "Equilibria occur at y = 0 and y = 1.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "slope-field",
        title: "Logistic direction field",
        expr: "y*(1-y)",
        xRange: [0, 5],
        yRange: [-0.5, 1.5],
        density: 13,
      },
      caption:
        "Between the equilibria, slopes are positive. Above y = 1, slopes are negative. The field shows directions, not integrated trajectories.",
    },
  ],
  [
    {
      kind: "value",
      label: "Equilibrium at y = 0",
      at: { x: 1, y: 0 },
      expected: 0,
    },
    {
      kind: "value",
      label: "Equilibrium at y = 1",
      at: { x: 1, y: 1 },
      expected: 0,
    },
    {
      kind: "value",
      label: "Growth at y = 0.5",
      at: { x: 1, y: 0.5 },
      expected: 0.25,
    },
  ],
);
add(
  "probability-normal",
  "Probability and statistics",
  "Probability is area under a density",
  "A standard normal variable between −1 and 1.",
  ["X ~ N(0, 1).", "A density height is not a point probability."],
  [
    {
      spec: {
        v: 1,
        kind: "distribution",
        title: "Standard normal density",
        dist: "normal",
        params: { mu: 0, sigma: 1 },
        shade: { from: -1, to: 1, label: "P(−1 ≤ X ≤ 1)" },
        marks: [
          { x: -1, label: "−1" },
          { x: 1, label: "1" },
        ],
      },
      caption:
        "The shaded area is approximately 0.68268949. This probability check integrates the displayed density over the stated interval.",
    },
  ],
  [
    {
      kind: "probability",
      label: "Central probability",
      from: -1,
      to: 1,
      expected: 0.6826894921370859,
      tolerance: 1e-7,
    },
  ],
);
add(
  "statistics-exponential",
  "Probability and statistics",
  "An exponential waiting time",
  "A waiting-time density with rate λ = 2 per minute.",
  ["Time x is in minutes.", "Rate λ = 2 min⁻¹; the mean wait is 0.5 minutes."],
  [
    {
      spec: {
        v: 1,
        kind: "distribution",
        title: "Exponential density",
        dist: "exponential",
        params: { lambda: 2 },
        shade: { from: 0, to: 1, label: "Wait at most 1 minute" },
      },
      caption:
        "The probability of waiting at most one minute is 1 − exp(−2), approximately 0.86466472.",
    },
  ],
  [
    {
      kind: "probability",
      label: "P(X ≤ 1)",
      from: 0,
      to: 1,
      expected: 1 - Math.exp(-2),
      tolerance: 1e-7,
    },
  ],
);
add(
  "discrete-intervals",
  "Discrete mathematics",
  "Open and closed endpoints",
  "Represent −1 < x ≤ 3 on a number line.",
  [
    "A hollow endpoint excludes the value.",
    "A filled endpoint includes the value.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "numberline",
        title: "The interval (−1, 3]",
        min: -3,
        max: 5,
        intervals: [
          {
            from: -1,
            to: 3,
            openFrom: true,
            openTo: false,
            label: "−1 < x ≤ 3",
          },
        ],
      },
      caption:
        "Read the endpoint style together with the inequality. This is a structural illustration, without numerical assertions.",
    },
  ],
);
add(
  "discrete-sets",
  "Discrete mathematics",
  "Intersection and exclusive regions",
  "A two-set Venn diagram.",
  [
    "Circle areas are not proportional to set cardinalities.",
    "AB denotes membership in both sets.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "venn",
        title: "A and B",
        sets: [{ label: "A" }, { label: "B" }],
        regions: [
          { cells: "A", label: "A only" },
          { cells: "AB", label: "A ∩ B" },
          { cells: "B", label: "B only" },
        ],
      },
      caption:
        "Each label describes a disjoint region. Cardinalities require explicit data and are not inferred from circle sizes.",
    },
  ],
);
const network = {
  v: 1,
  kind: "graph",
  title: "Weighted graph",
  directed: false,
  nodes: ["A", "B", "C", "D"].map((id) => ({ id, label: id })),
  edges: [
    { from: "A", to: "B", weight: 5 },
    { from: "A", to: "C", weight: 1 },
    { from: "C", to: "B", weight: 2 },
    { from: "B", to: "D", weight: 1 },
    { from: "C", to: "D", weight: 8 },
  ],
  highlight: {
    nodes: ["A", "C", "B", "D"],
    edges: [
      ["A", "C"],
      ["C", "B"],
      ["B", "D"],
    ],
  },
};
add(
  "algorithms-dijkstra",
  "Algorithms",
  "Compute the path before highlighting it",
  "The shortest route from A to D in a weighted undirected graph.",
  [
    "All edge weights are nonnegative.",
    "Edge length in the drawing does not encode weight.",
    "Ties use lexical node-ID ordering.",
  ],
  [
    {
      spec: network,
      caption:
        "Dijkstra finds A → C → B → D with total cost 4. The verifier checks the displayed highlighted edges against the computed path.",
    },
  ],
  [
    {
      kind: "shortest-path",
      label: "Shortest A → D path",
      from: "A",
      to: "D",
      expectedDistance: 4,
      expectedPath: ["A", "C", "B", "D"],
    },
  ],
);
add(
  "algorithms-complexity",
  "Algorithms",
  "Compare growth rates",
  "Representative operation counts for n, n log₂ n, and n².",
  [
    "n is a continuous visual proxy for integer input size.",
    "Constants are 1 in this comparison; it is not a benchmark.",
  ],
  [
    {
      spec: plot(
        "Growth with input size",
        ["x", "x*ln(x)/ln(2)", "x^2"],
        1,
        16,
        { x: { var: "x", min: 1, max: 16, label: "Input size n" } },
      ),
      caption:
        "At n = 8, the curves have values 8, 24, and 64. Big-O classes alone do not predict wall-clock runtime.",
    },
  ],
  [
    val("Linear at n = 8", 8, 8),
    val("n log₂ n at n = 8", 8, 24, 1),
    val("Quadratic at n = 8", 8, 64, 2),
  ],
);
add(
  "algorithms-recursion-tree",
  "Algorithms",
  "A recursion tree for merge sort",
  "A structural split tree for an input of size eight.",
  [
    "The drawing shows subproblem sizes, not measured execution times.",
    "Children are listed in left-to-right order; this is not a search tree.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "tree",
        title: "Divide into two halves",
        nodes: [
          { id: "r", label: "n = 8" },
          { id: "a", parent: "r", label: "4" },
          { id: "b", parent: "r", label: "4" },
          { id: "c", parent: "a", label: "2" },
          { id: "d", parent: "a", label: "2" },
          { id: "e", parent: "b", label: "2" },
          { id: "f", parent: "b", label: "2" },
        ],
      },
      caption:
        "At each shown level, the subproblem sizes sum to eight. The omitted size-one level completes the recursion; this is a supplied trace rather than executed code.",
    },
  ],
);
add(
  "algorithms-dynamic-programming",
  "Algorithms",
  "A small dynamic-programming table",
  "Longest common subsequence lengths for AB and AC.",
  [
    "Rows are prefixes of AB; columns are prefixes of AC.",
    "The empty-prefix row and column have value zero.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "table",
        title: "LCS prefix lengths",
        rows: [
          ["", "∅", "A", "C"],
          ["∅", "0", "0", "0"],
          ["A", "0", "1", "1"],
          ["B", "0", "1", "1"],
        ],
        headerRow: true,
        headerCol: true,
        highlight: [{ r: 3, c: 3, color: "success" }],
      },
      caption:
        "The final LCS length is 1. Table cells are supplied values; use an executed recurrence when adapting this example to a new pair of strings.",
    },
  ],
);
add(
  "algorithms-stack",
  "Data structures",
  "A stack checks bracket nesting",
  "Step through a deterministic bracket-matching algorithm.",
  [
    "Only (), [] and {} affect the stack.",
    "Other supported characters are skipped.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "bracket-sim",
        title: "Balanced brackets",
        input: "{[(a+b)*c]}",
        examples: ["()", "(()", "[)", "{[()]}"],
      },
      caption:
        "Step forward to see pushes, pops and the first mismatch. The algorithm computes its trace from the input string.",
    },
  ],
);
add(
  "algorithms-memory",
  "Programming and data structures",
  "Two references can share one object",
  "A small stack-and-heap model of aliasing.",
  [
    "This is a language-neutral conceptual model.",
    "No actual memory addresses, object sizes, or runtime guarantees are implied.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "memory-sim",
        title: "Reference aliasing",
        code: ["a = new Box()", "b = a"],
        frames: [{ id: "main", label: "main" }],
        slots: [
          { id: "a", frame: "main", label: "a", type: "reference" },
          { id: "b", frame: "main", label: "b", type: "reference" },
        ],
        objects: [{ id: "box", label: "Box" }],
        refs: [
          { id: "ra", from: "a", to: "box" },
          { id: "rb", from: "b", to: "box" },
        ],
        steps: [
          {
            line: 0,
            caption: "a refers to one Box",
            show: ["main", "a", "box", "ra"],
            focus: ["a", "box"],
          },
          {
            line: 1,
            caption: "b shares the same Box",
            show: ["main", "a", "b", "box", "ra", "rb"],
            focus: ["b", "rb"],
          },
        ],
      },
      caption:
        "After b = a, both references point to the same object. The display uses an authored trace; it does not execute a programming language.",
    },
  ],
);
add(
  "algorithms-dependencies",
  "Algorithms",
  "Dependencies form a directed acyclic graph",
  "A build order for four tasks.",
  ["Arrows mean must finish before.", "This network has no directed cycles."],
  [
    {
      spec: {
        v: 1,
        kind: "graph",
        title: "Task dependencies",
        directed: true,
        nodes: ["Parse", "Typecheck", "Optimize", "Emit"].map((id) => ({
          id,
          label: id,
        })),
        edges: [
          { from: "Parse", to: "Typecheck" },
          { from: "Typecheck", to: "Optimize" },
          { from: "Optimize", to: "Emit" },
        ],
      },
      caption:
        "Parse → Typecheck → Optimize → Emit is a valid topological ordering. Edges encode precedence, not elapsed time.",
    },
  ],
);
add(
  "physics-force-balance",
  "Mechanics",
  "Forces on a resting block",
  "A free-body diagram with a common force scale.",
  [
    "The block is at rest on a horizontal surface.",
    "Mass = 1 kg, g = 9.81 m/s².",
    "One world unit represents 5 N for every force; the body is schematic.",
  ],
  [
    {
      spec: geo(
        "Balanced vertical forces",
        [
          {
            type: "polygon",
            points: [
              [-0.6, -0.4],
              [0.6, -0.4],
              [0.6, 0.4],
              [-0.6, 0.4],
            ],
            fill: true,
          },
          vector(0, 0, 0, 1.962, "N = 9.81 N", "evTeal"),
          vector(0, 0, 0, -1.962, "mg = 9.81 N", "warning"),
        ],
        [-2.5, 2.5],
        [-2.5, 2.5],
        { grid: false, axes: false },
      ),
      caption:
        "The normal force and weight have equal magnitude and opposite directions. Both belong to the chosen body; they are not a Newton’s-third-law pair.",
    },
  ],
  [
    {
      kind: "force-balance",
      label: "Net force is zero",
      items: [1, 2],
      expected: [0, 0],
    },
  ],
);
add(
  "physics-projectile",
  "Mechanics",
  "A projectile in uniform gravity",
  "The trajectory of a projectile launched at 10 m/s and 45°.",
  [
    "No air drag; flat ground; launch height zero.",
    "g = 9.81 m/s².",
    "Coordinates are meters; the curve parameter t is seconds.",
  ],
  [
    {
      spec: geo(
        "Projectile path",
        [
          {
            type: "parametric",
            x: "10*cos(pi/4)*t",
            y: "10*sin(pi/4)*t-9.81*t^2/2",
            t: [0, (20 * Math.sin(Math.PI / 4)) / 9.81],
            trace: true,
            label: "Trajectory",
          },
          { type: "point", x: 0, y: 0, label: "Launch" },
          { type: "point", x: 100 / 9.81, y: 0, label: "Landing" },
        ],
        [-1, 11],
        [-1, 4],
        { xLabel: "x (m)", yLabel: "y (m)" },
      ),
      caption:
        "The trajectory ends at the analytical flight time, approximately 1.4416 s. The horizontal range is approximately 10.1937 m.",
    },
  ],
  [
    {
      kind: "distance",
      label: "Launch-to-landing range",
      items: [1, 2],
      expected: 100 / 9.81,
      tolerance: 1e-8,
    },
  ],
);
add(
  "physics-incline",
  "Mechanics",
  "A block rests flush on an incline",
  "A geometric setup for inclined-plane problems.",
  [
    "The slope angle is 30 degrees.",
    "This setup omits forces; supply the free-body model before solving dynamics.",
  ],
  [
    {
      spec: geo(
        "Inclined plane",
        [
          { type: "ground", y: 0 },
          {
            type: "incline",
            x: 3,
            y: 0,
            run: 5,
            angle: 30,
            face: "left",
            angleLabel: "30°",
            block: { at: 0.5, size: 0.65, label: "m" },
          },
        ],
        [-3.5, 4],
        [-0.8, 4],
        { grid: false, axes: false },
      ),
      caption:
        "The renderer places the block on the inclined surface. The geometry alone does not determine friction, acceleration or normal force.",
    },
  ],
);
add(
  "physics-oscillation",
  "Oscillations",
  "A damped oscillation",
  "An underdamped displacement with an exponential envelope.",
  [
    "Displacement in meters; time in seconds.",
    "x(t) = exp(−0.2t) cos(2t), prescribed motion.",
    "The envelope is ±exp(−0.2t).",
  ],
  [
    {
      spec: plot(
        "Displacement and envelope",
        ["exp(-0.2*x)*cos(2*x)", "exp(-0.2*x)", "-exp(-0.2*x)"],
        0,
        15,
        {
          x: { var: "x", min: 0, max: 15, label: "Time (s)" },
          y: { min: -1.2, max: 1.2, label: "Displacement (m)" },
        },
      ),
      caption:
        "The amplitude decays while the oscillation continues. The initial displacement is 1 m and the initial velocity is −0.2 m/s.",
    },
  ],
  [
    val("Initial displacement", 0, 1),
    {
      kind: "derivative",
      label: "Initial velocity",
      curve: 0,
      at: 0,
      expected: -0.2,
      tolerance: 1e-6,
    },
  ],
);
add(
  "physics-traveling-wave",
  "Waves",
  "A wave traveling to the right",
  "Use the phase slider to move y = sin(x − φ).",
  [
    "x and φ are dimensionless phase coordinates in radians.",
    "Increasing φ corresponds to later time when angular frequency is positive.",
  ],
  [
    {
      spec: plot("Traveling sine wave", ["sin(x-phi)"], 0, 4 * Math.PI, {
        params: [
          {
            var: "phi",
            min: 0,
            max: 2 * Math.PI,
            default: 0,
            step: 0.02,
            label: "Phase",
            unit: "rad",
          },
        ],
        animate: { param: "phi", period: 5, loop: "cycle" },
      }),
      caption:
        "Points of constant phase move toward increasing x. Animation starts only after pressing Play.",
    },
  ],
  [val("Initial zero crossing", 0, 0)],
);
add(
  "physics-electric-potential",
  "Electromagnetism",
  "Potential along a line between equal charges",
  "Two equal positive point charges sit at x = −1 and x = 1.",
  [
    "kq = 1 in normalized units.",
    "This is a one-dimensional slice of a three-dimensional potential.",
    "The source points are excluded from the domain.",
  ],
  [
    {
      spec: plot("Potential slice", ["1/abs(x+1)+1/abs(x-1)"], -3, 3, {
        y: { min: 0, max: 8, label: "V / (kq)" },
      }),
      caption:
        "The midpoint potential is 2 in the chosen normalization. The plot has gaps at both charges, where the point-charge idealization diverges.",
    },
  ],
  [val("Midpoint potential", 0, 2)],
);
add(
  "physics-thermodynamics",
  "Thermodynamics",
  "An isotherm on a pressure-volume diagram",
  "For an ideal gas at fixed temperature, pressure is inversely proportional to volume.",
  [
    "nRT = 1 J.",
    "Volume x is in m³; pressure is in Pa.",
    "The path is quasistatic and isothermal.",
  ],
  [
    {
      spec: plot("Ideal-gas isotherm", ["1/x"], 1, 3, {
        x: { var: "x", min: 1, max: 3, label: "Volume (m³)" },
        y: { min: 0, max: 1.2, label: "Pressure (Pa)" },
        regions: [
          { type: "under", curve: 0, from: 1, to: 2, label: "Work by gas" },
        ],
      }),
      caption:
        "Expansion from 1 to 2 m³ does work W = ∫P dV = ln(2) J under the stated normalization.",
    },
  ],
  [
    {
      kind: "integral",
      label: "Isothermal expansion work",
      curve: 0,
      from: 1,
      to: 2,
      expected: Math.log(2),
      tolerance: 1e-7,
    },
  ],
);
add(
  "physics-quantum-well",
  "Quantum mechanics",
  "Wavefunction and probability density",
  "The ground state of a one-dimensional infinite square well of width 1.",
  [
    "0 ≤ x ≤ 1 in normalized length units.",
    "ψ₁(x) = √2 sin(πx); ψ is real for this chosen stationary-state convention.",
    "The probability density is |ψ|², not ψ.",
  ],
  [
    {
      spec: plot(
        "Ground state in an infinite well",
        ["sqrt(2)*sin(pi*x)", "2*sin(pi*x)^2"],
        0,
        1,
      ),
      caption:
        "The wavefunction vanishes at both walls. The density integrates to one.",
    },
  ],
  [
    val("Left-wall boundary", 0, 0),
    val("Right-wall boundary", 1, 0),
    {
      kind: "integral",
      label: "Probability normalization",
      curve: 1,
      from: 0,
      to: 1,
      expected: 1,
      tolerance: 1e-7,
    },
  ],
);
add(
  "physics-optics",
  "Optics",
  "A converging lens relates object and image distances",
  "Use the thin-lens equation for a positive focal length.",
  [
    "f = 0.1 m; object distance x is measured from the lens and is positive for a real object.",
    "Image distance = fx/(x − f). Positive values indicate a real image under this convention.",
  ],
  [
    {
      spec: plot(
        "Image distance versus object distance",
        ["0.1*x/(x-0.1)"],
        0.02,
        0.4,
        {
          y: { min: -0.5, max: 0.5, label: "Image distance (m)" },
          x: { var: "x", min: 0.02, max: 0.4, label: "Object distance (m)" },
        },
      ),
      caption:
        "At twice the focal length, the image is also at twice the focal length. The focal point is a pole, not a connecting segment.",
    },
  ],
  [val("Object at 2f gives image at 2f", 0.2, 0.2)],
);
add(
  "ee-rc-transient",
  "Circuits",
  "The step response of an RC circuit",
  "Charging a capacitor from an ideal 5 V step.",
  [
    "R = 1000 Ω; C = 1 μF; τ = RC = 1 ms.",
    "The initial capacitor voltage is zero; the ideal step occurs at t = 0.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "circuit",
        title: "Series RC charging circuit",
        components: [
          { type: "battery", at: [0, 4], to: [0, 0], label: "5 V" },
          { type: "resistor", at: [0, 0], to: [4, 0], label: "R = 1 kΩ" },
          { type: "capacitor", at: [4, 0], to: [4, 4], label: "C = 1 μF" },
          { type: "wire", at: [4, 4], to: [0, 4] },
          { type: "ground", at: [0, 4] },
        ],
      },
      caption:
        "The source, resistor and capacitor share a closed loop. Component labels are schematic values, not an automatically solved netlist.",
    },
    {
      spec: plot("Capacitor voltage", ["5*(1-exp(-x/0.001))"], 0, 0.005, {
        x: { var: "x", min: 0, max: 0.005, label: "Time (s)" },
        y: { min: 0, max: 5.5, label: "Voltage (V)" },
      }),
      caption:
        "At one time constant, the voltage is 5(1 − e⁻¹), approximately 3.1606 V.",
    },
  ],
  [
    { ...val("Initial voltage", 0, 0), diagram: "fig2" },
    {
      ...val("Voltage at one time constant", 0.001, 5 * (1 - Math.exp(-1))),
      diagram: "fig2",
    },
  ],
);
add(
  "ee-bode-lowpass",
  "Signals and systems",
  "Magnitude and phase of an RC low-pass filter",
  "A first-order low-pass transfer function H(jω) = 1/(1 + jωRC).",
  [
    "R = 1000 Ω and C = 1 μF, so ωc = 1000 rad/s.",
    "Horizontal coordinate x = log₁₀(ω / (1 rad/s)).",
    "Magnitude uses 20 log₁₀|H|; phase is in degrees.",
  ],
  [
    {
      spec: plot("Magnitude response", ["-10*log(1+(10^x*0.001)^2)"], 0, 6, {
        x: { var: "x", min: 0, max: 6, label: "log₁₀ ω (rad/s)" },
        y: { min: -65, max: 3, label: "Magnitude (dB)" },
      }),
      caption: "At x = 3, ω = 1000 rad/s and the gain is −3.0103 dB.",
    },
    {
      spec: plot("Phase response", ["-atan(10^x*0.001)*180/pi"], 0, 6, {
        x: { var: "x", min: 0, max: 6, label: "log₁₀ ω (rad/s)" },
        y: { min: -95, max: 5, label: "Phase (degrees)" },
      }),
      caption:
        "At the cutoff the phase is −45°. The phase approaches −90° at high frequency.",
    },
  ],
  [
    val("Magnitude at cutoff", 3, -10 * Math.log10(2)),
    { ...val("Phase at cutoff", 3, -45), diagram: "fig2" },
  ],
);
add(
  "ee-full-adder",
  "Digital logic",
  "A full adder from logic gates",
  "Three input bits produce sum and carry.",
  [
    "Inputs are listed A, B, Cin. Truth-table rows use that order from 000 to 111.",
    "This is combinational Boolean logic; propagation delay and analog voltage levels are outside the model.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "logic-circuit",
        title: "One-bit full adder",
        inputs: [{ id: "A" }, { id: "B" }, { id: "Cin" }],
        gates: [
          { id: "xor1", type: "xor", inputs: ["A", "B"] },
          { id: "sum", type: "xor", inputs: ["xor1", "Cin"] },
          { id: "ab", type: "and", inputs: ["A", "B"] },
          { id: "cx", type: "and", inputs: ["Cin", "xor1"] },
          { id: "carry", type: "or", inputs: ["ab", "cx"] },
        ],
        outputs: [
          { from: "sum", label: "Sum" },
          { from: "carry", label: "Cout" },
        ],
      },
      caption:
        "Toggle each input and compare the outputs with binary addition. Every truth-table row is checked.",
    },
  ],
  [
    {
      kind: "logic-table",
      label: "Full-adder truth table",
      expected: [
        [0, 0],
        [1, 0],
        [1, 0],
        [0, 1],
        [1, 0],
        [0, 1],
        [0, 1],
        [1, 1],
      ],
      tolerance: 0,
    },
  ],
);
add(
  "ee-phasors",
  "AC circuits",
  "Add sinusoidal quantities as phasors",
  "A geometric sum of two complex amplitudes.",
  [
    "Peak-amplitude phasors with the exp(jωt) convention.",
    "Both phasors have the same angular frequency.",
    "Coordinates are volts, with equal axis scales.",
  ],
  [
    {
      spec: geo(
        "V₁ + V₂",
        [
          vector(0, 0, 3, 0, "V₁ = 3"),
          vector(3, 0, 3, 4, "V₂ = j4", "evTeal"),
          vector(0, 0, 3, 4, "V = 3 + j4", "warning"),
          { type: "point", x: 0, y: 0, label: "0" },
          { type: "point", x: 3, y: 4, label: "3 + j4" },
        ],
        [-1, 5],
        [-1, 5],
      ),
      caption:
        "The resultant has magnitude 5 V and phase atan2(4, 3), approximately 53.13°. Peak and RMS phasors must not be mixed.",
    },
  ],
  [
    {
      kind: "distance",
      label: "Resultant magnitude",
      items: [3, 4],
      expected: 5,
    },
  ],
);
add(
  "ee-fourier-series",
  "Signals and systems",
  "A finite Fourier series approximates a square wave",
  "Compare the first one, two and three odd harmonics.",
  [
    "Period 2π; x is a phase angle in radians.",
    "The target is a unit-amplitude odd square wave.",
    "A finite partial sum has Gibbs overshoot near jumps.",
  ],
  [
    {
      spec: plot(
        "Odd-harmonic partial sums",
        [
          "4/pi*sin(x)",
          "4/pi*(sin(x)+sin(3*x)/3)",
          "4/pi*(sin(x)+sin(3*x)/3+sin(5*x)/5)",
        ],
        -Math.PI,
        Math.PI,
      ),
      caption:
        "The partial sums are continuous approximations. At each jump they approach the midpoint value, not either one-sided limit.",
    },
  ],
  [
    val("All partial sums vanish at the jump", 0, 0),
    val("Third partial sum at jump", 0, 0, 2),
  ],
);
add(
  "ee-control-response",
  "Control systems",
  "An underdamped second-order step response",
  "Unit-step response for damping ratio ζ = 0.5 and natural frequency ωn = 2 rad/s.",
  ["H(s) = 4/(s² + 2s + 4).", "Zero initial state, unity DC gain."],
  [
    {
      spec: plot(
        "Second-order step response",
        ["1-exp(-x)*(cos(sqrt(3)*x)+sin(sqrt(3)*x)/sqrt(3))"],
        0,
        8,
        {
          x: { var: "x", min: 0, max: 8, label: "Time (s)" },
          y: { min: 0, max: 1.3, label: "Output" },
        },
      ),
      caption:
        "The response begins at zero, overshoots the final value and settles toward one. The first peak occurs at π/√3 seconds.",
    },
  ],
  [
    val("Initial output", 0, 0),
    val(
      "First peak",
      Math.PI / Math.sqrt(3),
      1 + Math.exp(-Math.PI / Math.sqrt(3)),
    ),
  ],
);
add(
  "pde-heat-equation",
  "Partial differential equations",
  "A decaying heat-equation mode",
  "A single spatial sine mode on a rod with fixed zero-temperature ends.",
  [
    "Rod length L = 1 m; diffusivity α = 0.1 m²/s.",
    "u(x,t) = exp(−0.1π²t) sin(πx).",
    "The plotted quantity is temperature relative to the fixed boundary temperature.",
  ],
  [
    {
      spec: plot(
        "Temperature along the rod",
        ["exp(-0.1*pi^2*t)*sin(pi*x)"],
        0,
        1,
        {
          params: [
            {
              var: "t",
              min: 0,
              max: 5,
              default: 0,
              step: 0.05,
              label: "Time",
              unit: "s",
            },
          ],
          x: { var: "x", min: 0, max: 1, label: "Position (m)" },
          y: { min: 0, max: 1.1, label: "Relative temperature" },
        },
      ),
      caption:
        "Changing time decays the amplitude while preserving the sine-shaped spatial profile. Both endpoint values remain zero.",
    },
  ],
  [
    val("Left boundary", 0, 0),
    val("Right boundary", 1, 0),
    {
      kind: "value",
      label: "Midpoint at t = 1",
      curve: 0,
      at: { x: 0.5, t: 1 },
      expected: Math.exp(-0.1 * Math.PI ** 2),
      tolerance: 1e-8,
    },
  ],
);
add(
  "optimization-contours",
  "Optimization",
  "A convex quadratic surface",
  "Visualize f(x,y) = x² + 2y².",
  [
    "The Hessian is diag(2, 4), positive definite.",
    "The unique minimizer is at the origin.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "surface3d",
        title: "Convex quadratic",
        xRange: [-2, 2],
        yRange: [-2, 2],
        zRange: [0, 12],
        aspect: "data",
        surfaces: [{ expr: "x^2+2*y^2", color: "evTeal" }],
      },
      caption:
        "The surface rises more steeply along y than x. Equal physical scale is used for all three axes.",
    },
  ],
  [
    {
      kind: "value",
      label: "Minimum value",
      surface: 0,
      at: { x: 0, y: 0 },
      expected: 0,
    },
    {
      kind: "value",
      label: "f(1, 1)",
      surface: 0,
      at: { x: 1, y: 1 },
      expected: 3,
    },
  ],
);
add(
  "geometry-parametric-sphere",
  "Vector calculus and geometry",
  "A sphere from two angular parameters",
  "Use longitude u and polar angle v to parameterize the unit sphere.",
  [
    "x = cos(u)sin(v), y = sin(u)sin(v), z = cos(v).",
    "0 ≤ u ≤ 2π and 0 ≤ v ≤ π, in radians.",
    "The mesh is an approximation to a smooth surface.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "surface3d",
        title: "Unit sphere",
        xRange: [-1, 1],
        yRange: [-1, 1],
        zRange: [-1, 1],
        aspect: "data",
        surfaces: [
          {
            x: "cos(u)*sin(v)",
            y: "sin(u)*sin(v)",
            z: "cos(v)",
            uRange: [0, 2 * Math.PI],
            vRange: [0, Math.PI],
            color: "evTeal",
          },
        ],
      },
      caption:
        "Every exact parameterized point satisfies x² + y² + z² = 1. Rotate the view to inspect the poles and seam; no built-in parametric-surface identity check is claimed.",
    },
  ],
);
add(
  "numerical-methods-newton",
  "Numerical methods",
  "One Newton step is a tangent intercept",
  "Approximate √2 starting from x₀ = 1.5.",
  ["f(x) = x² − 2.", "The tangent at x₀ = 1.5 is 3x − 4.25."],
  [
    {
      spec: plot("Newton step for √2", ["x^2-2", "3*x-4.25"], 1, 2, {
        y: { min: -1, max: 2, label: "y" },
      }),
      caption:
        "The tangent crosses zero at x₁ = 17/12, approximately 1.416667. This is one iteration, not a convergence proof.",
    },
  ],
  [val("Initial residual", 1.5, 0.25), val("Tangent root", 17 / 12, 0, 1)],
);
add(
  "algorithms-timeline",
  "Operating systems",
  "A short process schedule",
  "A sequence of CPU scheduling events.",
  [
    "Positions are evenly spaced by event index.",
    "Spacing does not encode elapsed duration.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "timeline",
        title: "Scheduling events",
        events: [
          { label: "P1 starts", at: "t = 0" },
          { label: "P1 blocks", at: "t = 3" },
          { label: "P2 starts", at: "t = 3" },
          { label: "P1 resumes", at: "t = 8" },
        ],
      },
      caption:
        "Read the time labels for duration. Use a quantitative Gantt chart when interval lengths are part of the question.",
    },
  ],
);
add(
  "statistics-discrete-data",
  "Statistics",
  "Show supplied observations without interpolation",
  "A small frequency table as a bar chart.",
  [
    "These are illustrative counts, not collected study data.",
    "Categories are discrete outcomes.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "chart",
        chartType: "bar",
        title: "Observed frequencies",
        labels: ["0", "1", "2", "3"],
        series: [{ name: "Count", data: [4, 9, 5, 2] }],
        x: { label: "Outcome" },
        y: { label: "Count" },
      },
      caption:
        "Bar height is the count in each category. The chart does not imply a continuous probability density.",
    },
  ],
);
add(
  "systems-block-diagram",
  "Control systems",
  "A feed-forward signal chain",
  "A schematic from input to plant output.",
  [
    "Arrows indicate signal flow.",
    "Block labels do not execute transfer functions or prove closed-loop stability.",
  ],
  [
    {
      spec: {
        v: 1,
        kind: "diagram",
        title: "Signal path",
        nodes: [
          { id: "u", label: "Input u", x: 0.1, y: 0.5 },
          { id: "c", label: "Controller C(s)", x: 0.4, y: 0.5 },
          { id: "p", label: "Plant P(s)", x: 0.7, y: 0.5 },
          { id: "y", label: "Output y", x: 0.95, y: 0.5 },
        ],
        edges: [
          { from: "u", to: "c" },
          { from: "c", to: "p" },
          { from: "p", to: "y" },
        ],
      },
      caption:
        "For this feed-forward chain under compatible zero-state LTI assumptions, Y(s) = P(s)C(s)U(s). No feedback loop is shown.",
    },
  ],
);
let checks = 0;
for (const { slug, doc } of examples) {
  try {
    const parsed = validateDocument(doc),
      report = verify(parsed);
    if (report.status === "failed")
      throw new Error(
        JSON.stringify(report.checks.filter((c) => c.status === "failed")),
      );
    checks += report.total;
    await writeFile(
      `${root}/${slug}.json`,
      JSON.stringify(doc, null, 2) + "\n",
    );
  } catch (e) {
    console.error(slug, e.issues || e.message);
    process.exitCode = 1;
  }
}
console.log(
  `${examples.length} examples; ${checks} explicit mathematical assertions.`,
);
