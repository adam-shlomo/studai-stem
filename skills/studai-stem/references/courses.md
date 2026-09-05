# Course routing and mathematical conventions

Use the row matching the actual problem. These are working routes across university
STEM, not a claim that every syllabus or advanced subfield has a prebuilt renderer.
Search the example list with a course or keyword, then adapt its model.

| Course family                                     | Useful route                                                                          | Checks that matter                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Calculus I–II, real analysis                      | Function plots, geometry, number lines; symbolic scientific code                      | Domain, one-sided limits, poles, derivative definition, signed vs geometric area, convergence assumptions        |
| Multivariable/vector calculus                     | 3D surfaces, typed base domains, polar geometry; vector-field recipe                  | Jacobian, orientation, domain boundaries, lower/upper surfaces, flux vs circulation, signed integral             |
| Linear algebra, numerical linear algebra          | 2×2 transform; NumPy/SymPy for general matrices                                       | Row/column convention, dimensions, eigen residual Av−λv, rank/nullity, singular values, conditioning             |
| Discrete mathematics, combinatorics               | Venn, number line, table, graph                                                       | Membership/cardinality distinction, endpoint inclusion, counting by enumeration on small cases                   |
| Probability, statistics, stochastic processes     | Distribution, bars/scatter; SciPy for specialized distributions                       | PMF vs PDF vs CDF, support, normalization, tail truncation, variance vs standard deviation, sample vs population |
| Differential equations, dynamical systems         | Slope field; ODE recipe for trajectories and phase portraits                          | Initial values, residuals, stability, equilibria, stiffness, convergence and conservation                        |
| PDEs, Fourier analysis                            | Parameterized modes, surfaces; scientific code for numerical PDEs                     | Boundary/initial conditions, transform convention, normalization, mesh convergence and CFL limits                |
| Complex analysis                                  | Equal-scale complex-plane geometry; split real/imaginary functions in scientific code | Branch cuts, argument convention, poles, contour direction, modulus vs real part                                 |
| Optimization, operations research                 | Quadratic surface, geometry, graph; scientific code                                   | Feasibility, gradients/KKT assumptions, convexity, primal/dual signs, optimum vs candidate                       |
| Abstract algebra, topology, differential geometry | Tables, graphs, parametric geometry; custom diagrams                                  | Actual operation/relation, quotient identifications, orientation, chart domain; a picture is not a proof         |
| Algorithms and graph theory                       | Computed graph paths, hierarchy, table, diagram                                       | Directedness, weights, connectivity, tie-breaking, invariant per step, actual input/output trace                 |
| Data structures, automata, programming            | Bracket simulator, memory model, tree; custom graph for loops                         | Pointer/reference identity, nulls, left/right child slots, stack transitions; authored vs executed trace         |
| Complexity and numerical algorithms               | Function comparison; measured-data chart                                              | Big-O vs exact counts, hidden constants, discrete n, log base, data provenance                                   |
| Mechanics, statics, dynamics                      | Geometry primitives, free-body vectors; ODE trajectory                                | Choose one body, coordinate frame, force origin/direction, torque reference, ΣF=ma, Στ=Iα                        |
| Oscillations, waves, acoustics                    | Parameterized plot, phase portrait, Fourier recipe                                    | Phase/velocity direction, angular vs cyclic frequency, damping regime, superposition and boundary conditions     |
| Electricity and magnetism                         | Vector-field recipe, scalar potential plots, geometry                                 | Charge sign, right-hand rule, singularity masks, equipotential perpendicularity, Gauss/Ampère assumptions        |
| Optics                                            | Geometry plus analytical ray model; scientific code                                   | Lens/mirror sign convention, focal points, refraction angles to the normal, virtual vs real image                |
| Thermodynamics, statistical mechanics             | PV curves, distributions, data charts                                                 | Work/heat sign convention, path dependence, Kelvin vs Celsius, state variables, process assumptions              |
| Quantum mechanics                                 | Wavefunctions, densities, complex components; scientific code                         | Boundary conditions, normalization,                                                                              | ψ   | ², phase vs observable, units and selected basis |
| Relativity                                        | Custom spacetime diagrams or scientific code                                          | Metric signature, ct units, frame, Lorentz invariants; no Euclidean angle interpretation                         |
| DC/AC circuits, electronics                       | Native circuit schematic; explicit MNA/SPICE for analysis                             | Ground/reference, node topology, KCL/KVL, polarity, source direction, ideal vs nonlinear/device assumptions      |
| Signals, DSP, communications                      | Bode and FFT recipes, Fourier plots, tables                                           | Hz vs rad/s, sample rate, FFT normalization, window, aliasing, phase unwrap, bilateral vs one-sided spectra      |
| Digital logic and computer organization           | Native Boolean DAG/truth table; timing via custom code                                | Gate arity, full truth table, state vs combinational logic, active-low signals, clock and propagation delay      |
| Control systems                                   | Block diagram, analytical step response, scientific Bode                              | Feedback sign, poles/zeros, cancellation assumptions, stability criterion, initial state and loop definition     |
| Electromagnetic waves, transmission lines, power  | Phasors and scientific code; custom schematic                                         | Peak vs RMS, exp(±jωt), impedance/admittance, reflection reference plane, passive sign convention                |

## Course-specific traps

**Calculus:** A plot of |f| and an integral of f answer different questions. Label the
integrand and the shaded domain. Near a singularity, split the domain and analyze
one-sided behavior analytically. The native integrator handles proper finite intervals.

**Algorithms:** Compute a path, traversal, DP table or trace before highlighting it. The
native shortest-path verifier supports Dijkstra with explicit nonnegative weights. Use
Bellman–Ford for negative edges; detect negative cycles. Trees cannot display binary
empty-child slots faithfully; use a custom layout when left/right identity matters.

**Physics:** Select the system, frame and assumptions. A free-body diagram contains forces
on the chosen body, not forces exerted by that body on other objects. For motion, mark
initial position, direction and time origin. Do not infer velocities from a schematic.

**Electrical engineering:** Transcribe nodes before placing symbols. A wire crossing is
not automatically a junction. A ground marker is a reference, not a physical earth
connection unless specified. Native symbols preserve topology only through endpoints;
split a wire at each intended branch. Derive circuit values separately with KCL/KVL or
an explicit solver; matching a transfer-function checkpoint does not validate wiring.

**Exam reproduction:** Preserve given labels and conventions even when a different
notation would be more familiar. If the source is ambiguous, describe the ambiguity and
ask for the specific missing information before fixing a mathematically consequential
choice. Do not substitute a similar textbook problem.
