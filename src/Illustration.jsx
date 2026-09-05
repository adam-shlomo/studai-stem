import React, { useState } from "react";
import VizWidget from "./VizWidget.jsx";
function number(v) {
  return typeof v === "number" ? Number(v.toPrecision(8)) : JSON.stringify(v);
}
export default function Illustration({ doc, report }) {
  const [changed, setChanged] = useState(false);
  const download = () => {
    const b = new Blob(
      [JSON.stringify(window.__STUDAI_INPUT__, null, 2) + "\n"],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "illustration.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <main dir={doc.language === "he" ? "rtl" : "ltr"}>
      <header>
        <div className="eyebrow">STUDAI / {doc.course}</div>
        <h1>{doc.title}</h1>
        <p className="lead">{doc.description}</p>
        <div className="status" role="status">
          {report.total
            ? `${report.passed}/${report.total} mathematical checks passed`
            : "Schematic: no mathematical assertions supplied"}
          {changed &&
            " · controls changed; report below describes initial values"}
        </div>
      </header>
      <section className="assumptions" aria-label="Assumptions">
        <h2>Model and assumptions</h2>
        <ul>
          {doc.assumptions.map((a, i) => (
            <li key={i} dir="auto">
              {a}
            </li>
          ))}
        </ul>
      </section>
      <div
        className="figures"
        onChangeCapture={() => setChanged(true)}
        onKeyDownCapture={(e) => {
          if (["Enter", " "].includes(e.key)) setChanged(true);
        }}
        onClickCapture={(e) => {
          if (e.target.closest("button,[role=button],tr[tabindex]"))
            setChanged(true);
        }}
      >
        {doc.diagrams.map((d, i) => (
          <figure id={d.id} key={d.id}>
            <div className="figure-heading">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <h2>{d.spec.title || d.id}</h2>
            </div>
            <VizWidget spec={{ ...d.spec, title: undefined }} />
            <figcaption dir="auto">{d.caption}</figcaption>
          </figure>
        ))}
      </div>
      <section aria-label="Mathematical checks">
        <h2>What was checked</h2>
        <p className="small">
          Checks apply to the initial model. Changing controls does not rerun
          this report.
        </p>
        {report.checks.length > 0 ? (
          <div className="table-scroll">
            <table className="checks">
              <thead>
                <tr>
                  <th>Assertion</th>
                  <th>Computed</th>
                  <th>Expected</th>
                  <th>Absolute tolerance</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {report.checks.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={`#${c.diagram}`}>{c.label}</a>
                      <small>{c.method}</small>
                    </td>
                    <td>{number(c.actual)}</td>
                    <td>{number(c.expected)}</td>
                    <td>{c.tolerance}</td>
                    <td>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No numerical assertions supplied. Review the diagram against the
            source.
          </p>
        )}
        {report.uncheckedDiagrams.length > 0 && (
          <p className="small">
            Diagrams without mathematical checks:{" "}
            {report.uncheckedDiagrams.join(", ")}.
          </p>
        )}
        <p className="small">
          Passing assertions do not prove that every feature is correct. Check
          the source interpretation, units, labels, parameter extremes and
          visible geometry.
        </p>
      </section>
      {doc.sources?.length > 0 && (
        <section>
          <h2>Sources</h2>
          <ul>
            {doc.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer>
        <span>Editable equations. Local rendering. No network required.</span>
        <button type="button" onClick={download}>
          Download source JSON
        </button>
        <button type="button" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </footer>
    </main>
  );
}
