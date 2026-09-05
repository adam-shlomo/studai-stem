import React from "react";
import { hydrateRoot } from "react-dom/client";
import { validateDocument } from "./schema.js";
import Illustration from "./Illustration.jsx";
import { setLocale } from "./locale.js";
const raw = JSON.parse(document.getElementById("studai-data").textContent);
window.__STUDAI_INPUT__ = raw.doc;
setLocale(raw.doc.language);
hydrateRoot(
  document.getElementById("root"),
  <Illustration doc={validateDocument(raw.doc)} report={raw.report} />,
);
window.__STUDAI_READY__ = true;
