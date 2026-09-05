import React, { useMemo, useState } from "react";
import { evalExpr, regionBoundary } from "./viz-spec.js";
import { PAL } from "./theme.js";

// Orthographic, vector-only rendering. Geometry comes from equations, never drawn guesses.
export function surfaceMesh(spec, n = 24) {
  const faces = [];
  const point = (s, u, v) =>
    s.kind === "param"
      ? [
          evalExpr(s._xAst, { u, v }),
          evalExpr(s._yAst, { u, v }),
          evalExpr(s._zAst, { u, v }),
        ]
      : [u, v, evalExpr(s._ast, { x: u, y: v })];
  function grid(fn, color, opacity = 0.7) {
    const g = Array.from({ length: n + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => fn(i / n, j / n)),
    );
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const p = [g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]];
        if (p.flat().every(Number.isFinite))
          faces.push({ points: p, color, opacity });
      }
  }
  for (const s of spec.surfaces) {
    const a = s.kind === "param" ? s.uRange : spec.xRange,
      b = s.kind === "param" ? s.vRange : spec.yRange;
    grid(
      (u, v) => point(s, a[0] + u * (a[1] - a[0]), b[0] + v * (b[1] - b[0])),
      PAL[s.color] || PAL.accent,
      s.opacity ?? 0.62,
    );
  }
  const r = spec.region;
  if (r) {
    const b = r.base;
    const xy = (u, v) => {
      if (b.type === "rect")
        return [b.x[0] + u * (b.x[1] - b.x[0]), b.y[0] + v * (b.y[1] - b.y[0])];
      if (b.type === "ellipse")
        return [
          b.cx + b.a * u * Math.cos(2 * Math.PI * v),
          b.cy + b.b * u * Math.sin(2 * Math.PI * v),
        ];
      if (b.type === "between") {
        const x = b.x[0] + u * (b.x[1] - b.x[0]),
          lo = evalExpr(b._lowerAst, { x }),
          hi = evalExpr(b._upperAst, { x });
        return [x, lo + v * (hi - lo)];
      }
      const y = b.y[0] + u * (b.y[1] - b.y[0]),
        lo = evalExpr(b._leftAst, { y }),
        hi = evalExpr(b._rightAst, { y });
      return [lo + v * (hi - lo), y];
    };
    const z = (x, y, lower) =>
      lower
        ? r._lowerAst
          ? evalExpr(r._lowerAst, { x, y })
          : 0
        : evalExpr(r._surfaceAst, { x, y });
    grid(
      (u, v) => {
        const [x, y] = xy(u, v);
        return [x, y, z(x, y, false)];
      },
      PAL[r.color] || PAL.success,
      0.9,
    );
    if (r.floor)
      grid(
        (u, v) => {
          const [x, y] = xy(u, v);
          return [x, y, z(x, y, true)];
        },
        PAL[r.color] || PAL.success,
        0.24,
      );
    if (r.wall) {
      const boundary = regionBoundary(b, 64);
      for (let i = 1; i < boundary.length; i++) {
        const [x, y] = boundary[i - 1],
          [a, c] = boundary[i];
        const points = [
          [x, y, z(x, y, true)],
          [a, c, z(a, c, true)],
          [a, c, z(a, c, false)],
          [x, y, z(x, y, false)],
        ];
        if (points.flat().every(Number.isFinite))
          faces.push({
            points,
            color: PAL[r.color] || PAL.success,
            opacity: 0.35,
          });
      }
    }
  }
  return faces;
}
export default function Surface3DView({ spec }) {
  const [az, setAz] = useState(-45),
    [el, setEl] = useState(28);
  const mesh = useMemo(() => surfaceMesh(spec), [spec]);
  const layout = useMemo(() => {
    const points = mesh.flatMap((f) => f.points);
    if (!points.length) throw new Error("Surface has no finite mesh points");
    const bounds = [
      spec.xRange,
      spec.yRange,
      spec.zRange || [
        Math.min(...points.map((p) => p[2])),
        Math.max(...points.map((p) => p[2])),
      ],
    ];
    if (bounds[2][0] === bounds[2][1])
      bounds[2] = [bounds[2][0] - 1, bounds[2][1] + 1];
    const center = bounds.map(([a, b]) => (a + b) / 2),
      spans = bounds.map(([a, b]) => b - a),
      largest = Math.max(...spans);
    const factors = spans.map((v) =>
      spec.aspect === "cube" ? largest / v : 1,
    );
    const rad = (az * Math.PI) / 180,
      elev = (el * Math.PI) / 180;
    const project = (p) => {
      const [x, y, z] = p.map((v, i) => (v - center[i]) * factors[i]);
      const a = Math.cos(rad) * x - Math.sin(rad) * y,
        b = Math.sin(rad) * x + Math.cos(rad) * y;
      return [
        a,
        Math.cos(elev) * z - Math.sin(elev) * b,
        Math.cos(elev) * b + Math.sin(elev) * z,
      ];
    };
    const corners = [];
    for (const x of bounds[0])
      for (const y of bounds[1])
        for (const z of bounds[2]) corners.push([x, y, z]);
    const p = [...points, ...corners].map(project),
      minX = Math.min(...p.map((x) => x[0])),
      maxX = Math.max(...p.map((x) => x[0])),
      minY = Math.min(...p.map((x) => x[1])),
      maxY = Math.max(...p.map((x) => x[1]));
    const scale = Math.min(425 / (maxX - minX || 1), 265 / (maxY - minY || 1)),
      midX = (minX + maxX) / 2,
      midY = (minY + maxY) / 2;
    const map = (p) => {
      const [x, y, z] = project(p);
      return [280 + (x - midX) * scale, 185 - (y - midY) * scale, z];
    };
    return {
      map,
      bounds,
      faces: mesh
        .map((f) => ({ ...f, p: f.points.map(map) }))
        .sort(
          (a, b) =>
            a.p.reduce((s, p) => s + p[2], 0) / a.p.length -
            b.p.reduce((s, p) => s + p[2], 0) / b.p.length,
        ),
    };
  }, [mesh, az, el, spec]);
  return (
    <div className="surface-card">
      <div style={{ fontWeight: 700 }}>{spec.title}</div>
      <svg
        viewBox="0 0 560 390"
        width="100%"
        role="img"
        aria-label={spec.title || "Three dimensional surface"}
      >
        <rect width="560" height="390" fill="white" />
        {layout.faces.map((f, i) => (
          <polygon
            key={i}
            points={f.p
              .map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)
              .join(" ")}
            fill={f.color}
            fillOpacity={f.opacity}
            stroke={f.color}
            strokeWidth=".3"
          />
        ))}
        {["x", "y", "z"].map((axis, i) => {
          const origin = layout.bounds.map((r) => r[0]),
            end = [...origin];
          end[i] = layout.bounds[i][1];
          const a = layout.map(origin),
            b = layout.map(end);
          return (
            <g key={axis}>
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={PAL.text}
                strokeWidth="1.2"
              />
              <text x={b[0] + 5} y={b[1] - 5} fill={PAL.text} fontSize="12">
                {axis}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="surface-controls">
        <label>
          Rotation{" "}
          <input
            type="range"
            min="-180"
            max="180"
            value={az}
            onChange={(e) => setAz(Number(e.target.value))}
          />
        </label>
        <label>
          Elevation{" "}
          <input
            type="range"
            min="5"
            max="85"
            value={el}
            onChange={(e) => setEl(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="small">
        {layout.bounds
          .map(
            (r, i) =>
              `${["x", "y", "z"][i]} ∈ [${Number(r[0].toPrecision(4))}, ${Number(r[1].toPrecision(4))}]`,
          )
          .join(" · ")}
      </p>
      <p className="small">
        {spec.aspect === "cube"
          ? "Axes scaled independently to a cube."
          : "Equal scale for x, y and z."}{" "}
        Orthographic projection; mesh approximation.
      </p>
      <div className="formula-list">
        {spec.surfaces.map((s, i) => (
          <code
            key={i}
          >{`${s.label ? `${s.label}: ` : ""}${s.kind === "explicit" ? `z = ${s.expr}` : `(${s.x}, ${s.y}, ${s.z})`}`}</code>
        ))}
      </div>
      {spec.region && (
        <p className="small">
          Region: {spec.region.label || "D"}.{" "}
          {spec.region.lower
            ? `Lower surface: ${spec.region.lower}.`
            : "Lower surface: z = 0."}
        </p>
      )}
    </div>
  );
}
