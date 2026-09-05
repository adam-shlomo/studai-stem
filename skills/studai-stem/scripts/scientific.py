# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.2,<3", "scipy>=1.15,<2", "sympy>=1.14,<2", "matplotlib>=3.10,<4"]
# ///
"""Executable scientific starting points. Copy and change the model, not just labels."""

from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import shutil
import sys
import numpy as np
import scipy
from scipy import integrate, signal
import sympy as sp
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 11,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.labelcolor": "#182338",
        "text.color": "#182338",
        "axes.edgecolor": "#69778c",
        "grid.alpha": 0.18,
        "svg.fonttype": "none",
        "savefig.dpi": 200,
    }
)
BLUE, TEAL, ORANGE = "#2456a6", "#087e8b", "#b95815"


def check(name, actual, expected, atol=1e-8, rtol=0.0):
    a, b = np.asarray(actual), np.asarray(expected)
    ok = (
        a.shape == b.shape
        and np.all(np.isfinite(a))
        and bool(np.allclose(a, b, atol=atol, rtol=rtol))
    )
    result = {
        "name": name,
        "status": "passed" if ok else "failed",
        "actual": a.tolist(),
        "expected": b.tolist(),
        "absolute_tolerance": atol,
        "relative_tolerance": rtol,
    }
    if not ok:
        raise ValueError(json.dumps(result))
    return result


def symbolic():
    x = sp.Symbol("x", real=True)
    # Construct symbolic expressions explicitly. Do not parse untrusted strings.
    f = x**2
    tangent = 2 * x - 1
    exact_area = sp.integrate(x - x**2, (x, 0, 1))
    fn = sp.lambdify(x, f, "numpy")
    xx = np.linspace(-1, 3, 501)
    fig, ax = plt.subplots(figsize=(8, 5), layout="constrained")
    ax.plot(xx, fn(xx), color=BLUE, label=r"$f(x)=x^2$")
    ax.plot(xx, 2 * xx - 1, color=TEAL, ls="--", label=r"$L(x)=2x-1$")
    ax.scatter([1], [1], c=ORANGE, zorder=5)
    ax.annotate(
        "Tangency (1, 1)", (1, 1), xytext=(1.4, 0.2), arrowprops={"arrowstyle": "->"}
    )
    ax.set(xlabel="x", ylabel="y", title="A tangent is a local approximation")
    ax.grid()
    ax.legend()
    checks = [
        check("Symbolic derivative at 1", float(sp.diff(f, x).subs(x, 1)), 2),
        check("Exact area on [0,1]", float(exact_area), 1 / 6),
        check("Tangent residual at 1", float((f - tangent).subs(x, 1)), 0),
    ]
    return (
        fig,
        checks,
        {
            "equations": ["f(x)=x^2", "L(x)=2x-1"],
            "assumptions": ["Real variables", "Tangent about x=1"],
            "exact_area": str(exact_area),
        },
    )


def bode():
    R, C = 1000.0, 1e-6
    wc = 1 / (R * C)
    w = np.logspace(0, 6, 1201)
    sys = signal.TransferFunction([1], [R * C, 1])
    _, mag, phase = signal.bode(sys, w=w)
    fig, axes = plt.subplots(2, 1, figsize=(8, 6), sharex=True, layout="constrained")
    axes[0].semilogx(w, mag, color=BLUE)
    axes[1].semilogx(w, phase, color=TEAL)
    for ax in axes:
        ax.axvline(wc, color=ORANGE, ls="--")
        ax.grid(which="both")
    axes[0].set(title="RC low-pass response", ylabel="Magnitude (dB)")
    axes[1].set(xlabel="Angular frequency ω (rad/s)", ylabel="Phase (degrees)")
    _, cm, cp = signal.bode(sys, w=[wc])
    analytical = -10 * np.log10(1 + (w * R * C) ** 2)
    checks = [
        check("Cutoff magnitude", cm[0], -10 * math.log10(2)),
        check("Cutoff phase", cp[0], -45),
        check(
            "Maximum magnitude discrepancy", np.max(np.abs(mag - analytical)), 0, 1e-10
        ),
    ]
    return (
        fig,
        checks,
        {
            "R_ohm": R,
            "C_farad": C,
            "cutoff_rad_per_s": wc,
            "transfer_function": "1/(RCs+1)",
            "assumptions": [
                "Ideal components",
                "Zero initial state",
                "Magnitude uses 20 log10 |H|",
            ],
        },
    )


def dipole():
    x = np.linspace(-3, 3, 161)
    y = np.linspace(-2, 2, 121)
    X, Y = np.meshgrid(x, y)
    Ex = np.zeros_like(X)
    Ey = np.zeros_like(Y)
    V = np.zeros_like(X)
    mask = np.zeros_like(X, dtype=bool)
    charges = [(-1.0, 0.0, 1.0), (1.0, 0.0, -1.0)]
    for cx, cy, q in charges:
        dx, dy = X - cx, Y - cy
        r2 = dx * dx + dy * dy
        mask |= r2 < 0.12**2
        safe = np.maximum(r2, 0.12**2)
        Ex += q * dx / safe**1.5
        Ey += q * dy / safe**1.5
        V += q / np.sqrt(safe)
    U, W = np.ma.array(Ex, mask=mask), np.ma.array(Ey, mask=mask)
    fig, ax = plt.subplots(figsize=(8, 5.4), layout="constrained")
    ax.streamplot(x, y, U, W, color=BLUE, density=1.2, linewidth=0.8, arrowsize=0.8)
    ax.contour(
        X,
        Y,
        np.ma.array(V, mask=mask),
        levels=[-2, -1, -0.5, 0.5, 1, 2],
        colors=TEAL,
        linewidths=0.7,
        linestyles="dashed",
    )
    for cx, cy, q in charges:
        ax.add_patch(Circle((cx, cy), 0.11, color=ORANGE if q > 0 else BLUE, zorder=5))
        ax.text(
            cx,
            cy,
            "+" if q > 0 else "−",
            color="white",
            ha="center",
            va="center",
            zorder=6,
        )
    ax.set(
        xlabel="x (normalized length)",
        ylabel="y (normalized length)",
        title="Electric dipole: field lines and equipotentials",
        xlim=(-3, 3),
        ylim=(-2, 2),
        aspect="equal",
    )

    # Independent analytical values: midpoint potential zero, field +2 along x.
    def at(px, py):
        field = np.zeros(2)
        pot = 0.0
        for cx, cy, q in charges:
            d = np.array([px - cx, py - cy])
            r = np.linalg.norm(d)
            field += q * d / r**3
            pot += q / r
        return field, pot

    field, pot = at(0, 0)
    checks = [
        check("Midpoint electric field", field, [2, 0]),
        check("Midpoint potential", pot, 0),
    ]
    return (
        fig,
        checks,
        {
            "charges": charges,
            "normalization": "k=1; unit charges; normalized length",
            "singularity_mask_radius": 0.12,
            "assumptions": [
                "3D point-charge field shown in the z=0 plane",
                "Streamline spacing does not measure field strength",
            ],
        },
    )


def ode():
    times = np.linspace(0, 12, 1201)
    omega = 2.0
    rhs = lambda t, y: [y[1], -(omega**2) * y[0]]
    a = integrate.solve_ivp(rhs, [0, 12], [1, 0], t_eval=times, rtol=1e-9, atol=1e-11)
    b = integrate.solve_ivp(rhs, [0, 12], [1, 0], t_eval=times, rtol=1e-11, atol=1e-13)
    if not a.success or not b.success:
        raise ValueError("ODE solver failed")
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.5), layout="constrained")
    axes[0].plot(times, a.y[0], color=BLUE, label="Numerical")
    axes[0].plot(
        times, np.cos(omega * times), color=ORANGE, ls="--", label="Analytical"
    )
    axes[0].set(
        xlabel="Time (s)", ylabel="Displacement (m)", title="Harmonic oscillator"
    )
    axes[0].legend()
    axes[0].grid()
    axes[1].plot(a.y[0], a.y[1], color=TEAL)
    axes[1].set(
        xlabel="Displacement (m)", ylabel="Velocity (m/s)", title="Phase trajectory"
    )
    axes[1].grid()
    axes[1].set_xticks([-1, -0.5, 0, 0.5, 1])
    axes[1].set_yticks([-2, -1, 0, 1, 2])
    axes[1].annotate(
        "",
        xy=(a.y[0, 25], a.y[1, 25]),
        xytext=(a.y[0, 20], a.y[1, 20]),
        arrowprops={"arrowstyle": "->", "color": TEAL, "lw": 2},
    )
    energy = 0.5 * a.y[1] ** 2 + 0.5 * omega**2 * a.y[0] ** 2
    checks = [
        check("Initial state", a.y[:, 0], [1, 0]),
        check(
            "Maximum analytical error",
            np.max(np.abs(a.y[0] - np.cos(omega * times))),
            0,
            1e-7,
        ),
        check("Energy drift (unit mass)", np.max(np.abs(energy - 2)), 0, 1e-7),
        check("Refinement difference", np.max(np.abs(a.y - b.y)), 0, 1e-7),
    ]
    return (
        fig,
        checks,
        {
            "equation": "x'' + 4x = 0",
            "initial_state": [1, 0],
            "solver": "RK45",
            "rtol": 1e-9,
            "atol": 1e-11,
            "assumptions": [
                "No damping or forcing",
                "Unit mass",
                "Phase axes have different units",
            ],
        },
    )


def fft():
    fs = 1024.0
    n = 1024
    t = np.arange(n) / fs
    y = 2 * np.sin(2 * np.pi * 64 * t) + 0.5 * np.cos(2 * np.pi * 128 * t)
    spectrum = np.fft.rfft(y)
    freq = np.fft.rfftfreq(n, 1 / fs)
    amplitude = np.abs(spectrum) / n
    amplitude[1:-1] *= 2
    fig, axes = plt.subplots(2, 1, figsize=(8, 6), layout="constrained")
    axes[0].plot(t[:128], y[:128], color=BLUE)
    axes[0].set(
        xlabel="Time (s)",
        ylabel="Signal amplitude",
        title="Two tones, coherently sampled",
    )
    axes[1].stem(freq, amplitude, linefmt=TEAL, markerfmt=" ", basefmt=" ")
    axes[1].set(
        xlabel="Frequency (Hz)", ylabel="One-sided peak amplitude", xlim=(0, 200)
    )
    axes[1].grid()
    checks = [
        check("64 Hz peak", amplitude[64], 2),
        check("128 Hz peak", amplitude[128], 0.5),
        check("Mean-square signal", np.mean(y * y), (2**2 + 0.5**2) / 2),
        check(
            "Inverse FFT error",
            np.max(np.abs(np.fft.irfft(spectrum, n=n) - y)),
            0,
            1e-12,
        ),
    ]
    return (
        fig,
        checks,
        {
            "sample_rate_Hz": fs,
            "N": n,
            "window": "rectangular; coherent integer cycles",
            "amplitude_normalization": "|rFFT|/N; double interior bins, not DC or Nyquist",
            "assumptions": [
                "One-sided spectrum for a real signal",
                "Peak amplitudes, not RMS",
                "Bin spacing 1 Hz",
            ],
        },
    )


def solve_dc(parts):
    """MNA for ideal R, V and I parts. V means V(p)-V(n); I flows p -> n."""
    if not parts or len(parts) > 100:
        raise ValueError("Expected 1..100 components")
    names = [p[1] for p in parts]
    if len(set(names)) != len(names):
        raise ValueError("Duplicate component name")
    nodes = sorted({node for _, _, a, b, _ in parts for node in (a, b)} - {"0"})
    if not any("0" in (a, b) for _, _, a, b, _ in parts):
        raise ValueError("Reference node 0 is required")
    index = {node: i for i, node in enumerate(nodes)}
    voltage = [p for p in parts if p[0] == "V"]
    size = len(nodes) + len(voltage)
    A = np.zeros((size, size))
    rhs = np.zeros(size)
    for typ, name, p, n, value in parts:
        if typ not in ("R", "V", "I") or p == n or not np.isfinite(value):
            raise ValueError("Invalid component")
        if typ == "R":
            if value <= 0:
                raise ValueError("Resistance must be positive")
            g = 1 / value
            for a, b, sgn in [(p, p, 1), (n, n, 1), (p, n, -1), (n, p, -1)]:
                if a != "0" and b != "0":
                    A[index[a], index[b]] += sgn * g
        elif typ == "I":
            if p != "0":
                rhs[index[p]] -= value
            if n != "0":
                rhs[index[n]] += value
        else:
            j = len(nodes) + [v[1] for v in voltage].index(name)
            rhs[j] = value
            for node, sgn in [(p, 1), (n, -1)]:
                if node != "0":
                    A[index[node], j] += sgn
                    A[j, index[node]] += sgn
    if np.linalg.matrix_rank(A) < size:
        raise ValueError("Singular circuit: floating nodes or dependent ideal sources")
    solution = np.linalg.solve(A, rhs)
    volts = {"0": 0.0, **{n: float(solution[i]) for n, i in index.items()}}
    currents = {}
    for typ, name, p, n, value in parts:
        currents[name] = (
            (volts[p] - volts[n]) / value
            if typ == "R"
            else value
            if typ == "I"
            else float(solution[len(nodes) + [v[1] for v in voltage].index(name)])
        )
    return volts, currents, float(np.max(np.abs(A @ solution - rhs)))


def dc_circuit():
    parts = [
        ("V", "Vs", "in", "0", 10.0),
        ("R", "R1", "in", "out", 1000.0),
        ("R", "R2", "out", "0", 2000.0),
    ]
    volts, currents, residual = solve_dc(parts)
    fig, ax = plt.subplots(figsize=(8, 4.8), layout="constrained")
    ax.plot([0, 0, 1.4], [0, 3, 3], c=BLUE)
    ax.plot([2.6, 4, 4], [3, 3, 2.1], c=BLUE)
    ax.plot([4, 4, 0], [0.9, 0, 0], c=BLUE)
    ax.add_patch(Rectangle((1.4, 2.8), 1.2, 0.4, ec=BLUE, fc="white", lw=1.6))
    ax.text(2, 3.4, "R1 = 1 kΩ", ha="center")
    ax.add_patch(Rectangle((3.8, 0.9), 0.4, 1.2, ec=BLUE, fc="white", lw=1.6))
    ax.text(4.4, 1.5, "R2 = 2 kΩ", va="center")
    ax.add_patch(Circle((0, 1.5), 0.45, ec=BLUE, fc="white", lw=1.6, zorder=4))
    ax.text(0, 1.65, "+", ha="center", zorder=5)
    ax.text(0, 1.3, "−", ha="center", zorder=5)
    ax.text(-0.6, 1.5, "10 V", ha="right")
    ax.scatter([4], [3], c=ORANGE)
    ax.annotate(f"Vout = {volts['out']:.6g} V", (4, 3), xytext=(4.4, 3.3), color=ORANGE)
    ax.plot([-0.25, 0.25], [0, 0], c=BLUE)
    ax.plot([-0.17, 0.17], [-0.12, -0.12], c=BLUE)
    ax.plot([-0.08, 0.08], [-0.24, -0.24], c=BLUE)
    ax.set(
        xlim=(-1.5, 6),
        ylim=(-0.6, 4),
        aspect="equal",
        title="A DC divider: schematic and MNA solution",
    )
    ax.axis("off")
    power = sum((volts[p] - volts[n]) * currents[name] for _, name, p, n, _ in parts)
    checks = [
        check("Divider output", volts["out"], 20 / 3),
        check("Loop current", currents["R1"], 10 / 3000),
        check("MNA residual", residual, 0, 1e-12),
        check("Power balance", power, 0, 1e-12),
    ]
    return (
        fig,
        checks,
        {
            "netlist": parts,
            "node_voltages_V": volts,
            "branch_currents_A": currents,
            "assumptions": [
                "Ideal DC components",
                "Node 0 is reference",
                "Positive branch current flows p to n",
                "Resistor boxes use the IEC style",
            ],
        },
    )


RECIPES = {
    "symbolic": symbolic,
    "bode": bode,
    "dipole": dipole,
    "ode": ode,
    "fft": fft,
    "dc-circuit": dc_circuit,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", choices=RECIPES)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if args.out.exists():
        parser.error("Output directory exists; choose a new directory")
    fig, checks, model = RECIPES[args.recipe]()
    report = {
        "status": "checks-passed",
        "passed": len(checks),
        "total": len(checks),
        "checks": checks,
        "model": model,
        "versions": {
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "sympy": sp.__version__,
            "matplotlib": matplotlib.__version__,
        },
        "limitations": [
            "Assertions apply to this model and stated tolerances; they do not prove every visual detail.",
            "The rendered output still requires visual inspection.",
        ],
    }
    args.out.mkdir(parents=False, exist_ok=False)
    for ext in ("svg", "pdf", "png"):
        fig.savefig(args.out / f"figure.{ext}", bbox_inches="tight", facecolor="white")
    plt.close(fig)
    (args.out / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    shutil.copyfile(__file__, args.out / "reproduce.py")
    lock = Path(__file__ + ".lock")
    if lock.exists():
        shutil.copyfile(lock, args.out / "reproduce.py.lock")
    print(
        json.dumps(
            {
                "status": "rendered",
                "recipe": args.recipe,
                "checks": f"{len(checks)}/{len(checks)}",
                "directory": str(args.out.resolve()),
            }
        )
    )


if __name__ == "__main__":
    main()
