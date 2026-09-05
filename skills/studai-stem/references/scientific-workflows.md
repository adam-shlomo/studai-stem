# Scientific workflows

Use scientific code when the native diagram format cannot preserve the model or when
publication typography, a numerical solver, dense data or larger dimensions matter.
The bundled `scripts/scientific.py` contains six complete executable recipes with
independent numerical or symbolic checks and SVG/PDF/PNG output.

## Run or adapt a recipe

First inspect the relevant recipe's model. To run a shipped example with an existing
Python environment containing NumPy, SciPy, SymPy and Matplotlib:

```sh
python "<skill>/scripts/scientific.py" bode --out bode-v1
```

If those dependencies are missing and package installation is allowed, `uv` can create
an isolated, lockfile-pinned script environment. The first run may download packages;
subsequent cached runs need no network.

```sh
uv run --locked --script "<skill>/scripts/scientific.py" bode --out bode-v1
```

Available recipes: `symbolic`, `bode`, `dipole`, `ode`, `fft`, `dc-circuit`.
Each writes `figure.svg`, `figure.pdf`, `figure.png`, `verification.json`, and
`reproduce.py`. The lockfile is copied when available. It refuses an existing directory.
The saved source contains the actual model; edit a project copy for a new problem.
For a user-specified formula, construct reviewed SymPy expressions from explicit symbols
and operations in code. Do not feed raw user text to `eval`, `sympify` or `parse_expr`.

| Recipe     | What it produces                                         | Independent checks                                               |
| ---------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| symbolic   | Typeset parabola and tangent                             | Symbolic derivative, exact rational area, contact residual       |
| bode       | RC magnitude and phase with a logarithmic frequency axis | Closed-form response and cutoff identities                       |
| dipole     | Field lines, equipotentials and masked point charges     | Analytical midpoint field and potential                          |
| ode        | Harmonic oscillator trajectory and phase portrait        | Analytical solution, initial state, energy, tolerance refinement |
| fft        | A sampled signal and its one-sided amplitude spectrum    | Known tone amplitudes, mean square, inverse transform            |
| dc-circuit | DC divider schematic and MNA solution                    | Analytical divider/current, system residual, power balance       |

## Extend the model

**Math:** Use SymPy for exact differentiation, integration, factorization and small exact
matrices; use numerical libraries for evaluated arrays. Keep assumptions on symbols
explicit (real, positive, integer). A symbolic simplification conditional on an assumption
must retain that condition. Verify numerical eigenvectors with residuals, and inspect
conditioning before interpreting tiny singular values.

**Algorithms:** Execute the algorithm on the actual input, then render its returned trace.
Use a second small-instance method when useful: exhaustive path search for a small graph,
a reference recurrence for DP, or a truth-table enumerator. Choose Graphviz or explicit
SVG for self-loops, parallel edges, state machines and exact left/right child slots.
Do not use native graph output if it changes topology.

**Physics:** Derive the ODE, field, potential or ray equations from the chosen model.
Use `solve_ivp` for trajectories with recorded tolerances and solver status; compare a
refined solve and a conservation law when available. Mask idealized singularities rather
than replacing them with finite physics. Label normalized field arrows; normalized arrows
do not encode magnitude. A 2D slice of a 3D point-charge field is not a 2D electrostatics law.

**Electrical engineering:** The `solve_dc` function supports explicit ideal resistor,
voltage-source and current-source netlists using modified nodal analysis. Components are
`(type, name, p, n, value)`, with `R` in ohms, `V` in volts and `I` in amperes. Node `0`
is the reference. Voltage sources impose V(p)−V(n); source current is positive p→n.
Singular/floating circuits reject. Read the netlist alongside the schematic: a passing
solver residual alone does not verify that a hand-drawn wire matches the netlist.
For AC, nonlinear devices, op-amps or switching behavior, use a suitable solver/model
and verify limiting cases, node equations, passivity and operating assumptions.

**Signals and control:** Name the Fourier/Laplace convention, sampling rate, frequency
units and amplitude normalization. In a real one-sided FFT, double interior bins but
not DC or the Nyquist bin for even N. Treat spectral leakage, aliasing, window amplitude
correction and phase unwrapping explicitly. Frequency in SciPy's continuous-time Bode
function is angular frequency; convert when displaying Hz.

**Figures:** Prefer SVG/PDF for sharing. Keep editable text where feasible; Matplotlib
math glyphs may still be paths. Use equal aspect for geometric quantities, readable
physical units and constrained layout. Save a high-resolution PNG for inline preview.
Open the actual exports and fix clipping, overlapping labels and misleading scales.

## References

These official references support the implementation choices; consult the relevant
page when extending a recipe:

- [Matplotlib output backends](https://matplotlib.org/stable/users/explain/figure/backends.html)
- [SciPy solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html)
- [SymPy calculus](https://docs.sympy.org/latest/tutorials/intro-tutorial/calculus.html)
- [SciPy signal API](https://docs.scipy.org/doc/scipy/reference/signal.html)

The six recipes are starting points, not universal solvers. A new equation, boundary
condition, convention or topology requires new checks.
