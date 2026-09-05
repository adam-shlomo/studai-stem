# Accuracy and visual checks

## Evidence before artwork

Write the mathematical model before positioning labels. Keep what the problem states
separate from an assumed convention and a derived result. For sourced figures, preserve
identifiers and topology exactly. An invented edge can change an algorithm; an invented
junction can change an entire circuit.

Use an independent calculation for expected results. Useful checks include symbolic
identities, a different numerical method, conserved quantities, limiting cases, exact
small instances, or exhaustive enumeration. A second prompt agreeing with the first is
weaker evidence than a calculation.

## Calculation review

- Units: define every axis and parameter. Convert units before calculating. Dimensional
  quantities cannot appear directly inside exp, log, or sin without normalization.
- Domains: inspect zeros, poles, branch cuts, endpoints, excluded points, and piecewise
  conditions. Do not connect across discontinuities. A sampled plot does not prove
  continuity, monotonicity, boundedness or an asymptotic claim.
- Numerics: record algorithm, absolute/relative tolerance, step size and resolution where
  applicable. Compare refined runs. Check conditioning, truncation, and rounding. The
  built-in report uses absolute tolerances and heuristic error estimates.
- Invariants: check mass/charge/energy where conserved, probability normalization, matrix
  dimensions, graph connectivity and degree, Boolean truth tables, and constitutive laws.
- Controls: evaluate at initial, interior and endpoint parameter values. Check degenerate
  cases such as zero damping, a singular matrix, disconnected graph or zero forcing.
  The HTML explicitly keeps its check report scoped to initial values.

## Inspect the rendered figure

Open the actual HTML or SVG, not just its source. For complex figures inspect at a useful
large size and at typical reading width. Confirm:

1. Every requested object and label appears. Symbol, sign, exponent, unit and label
   attachment are unambiguous. Long formulas belong in a caption or typeset figure.
2. Equal-scale geometry remains equal-scale. Perspective, projected 3D and independent
   axis scaling are disclosed. Arrow lengths share a stated scale if they encode force.
3. Axes and curves are not cut off. Lines do not falsely bridge a pole or a missing
   observation. Shaded regions follow the actual bounds and identify holes/exclusions.
4. Arrowheads, polarity signs, open/closed endpoints and junction dots are visible.
   Edge crossings do not imply connectivity unless specified.
5. Labels do not cover nodes, arrows, ticks or each other. Color has a second cue such as
   a label, line pattern or symbol. Meaning survives grayscale and small screens.
6. Interactive controls are labeled, keyboard usable and stationary until the user starts
   motion. Outputs remain readable when printed. Hebrew prose does not reverse equations
   or numeric coordinates.

If the runtime cannot express a requested detail, use scientific code or a custom SVG
rather than dropping it. Custom code must retain the same model/verification/inspection
workflow. No output is universally certified; describe the checks that actually ran.

## Known boundaries

The native parser handles real scalar arithmetic, not a computer algebra system.
The 3D renderer is a sampled orthographic SVG mesh with approximate surface ordering;
transparent/intersecting surfaces can have visibility artifacts. For complex 3D geometry,
use a more appropriate renderer and verify the projection. A graph layout is schematic,
and a tree with one child does not preserve an empty left/right child slot. Native circuit
symbols use shared endpoints and do not solve electrical behavior. General circuit
simulation, large data, complex analysis branch handling, PDE solvers and publication
math typography belong in the scientific workflow.
