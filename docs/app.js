window.APP_CONFIG = window.APP_CONFIG || {
  apiBaseUrl: "https://vocareum-prompt-api-379861060062.us-central1.run.app"
};

const API = window.APP_CONFIG.apiBaseUrl;

const els = {
  form: document.getElementById("builderForm"),
  sidePicker: document.getElementById("sidePicker"),
  brief: document.getElementById("briefInput"),
  generateBtn: document.getElementById("generateBtn"),
  statusBadge: document.getElementById("statusBadge"),
  sourceNote: document.getElementById("sourceNote"),
  sourceLink: document.getElementById("sourceLink"),
  refreshSourceBtn: document.getElementById("refreshSourceBtn"),
  resultSection: document.getElementById("resultSection"),
  groundingSummary: document.getElementById("groundingSummary"),
  previewFrame: document.getElementById("previewFrame"),
  rawOutput: document.getElementById("rawOutput"),
  qualityReport: document.getElementById("qualityReport"),
  copyRawBtn: document.getElementById("copyRawBtn"),
  copyHtmlBtn: document.getElementById("copyHtmlBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  improveBtn: document.getElementById("improveBtn"),
};

let selectedSide = "one-sided";
let lastResult = null;
let knownProducts = [];
let sourceMeta = null;

const PRODUCT_ALIASES = [
  { canonical: "AI Gateway", patterns: ["ai gateway"] },
  { canonical: "AI Notebook", patterns: ["ai notebook", "ai notebooks", "notebook", "notebooks"] },
  { canonical: "GPU & CPU Compute", patterns: ["gpu & cpu compute", "gpu compute", "gpu", "gpus", "cpu compute"] },
  { canonical: "Cloud Labs", patterns: ["cloud labs", "cloud lab", "labs"] },
];

const RUN_GUARDRAILS = "Use only approved Vocareum product names, proof points, and references from the source catalog. Do not invent named proof headings, customer examples, frameworks, or capability labels.";
const PACKET_FIELDS = ["Headline", "Subhead", "Stat Bar", "Problem", "How It Works", "Who Uses This", "Proof", "Quote", "CTA"];
const FIELD_ALIASES = {
  "Core story": "Problem",
  "Audience fit": "Who Uses This",
  "Named public proof": "Proof",
};

// -- One-pager side picker --------------------------------------------------

els.sidePicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".format-option");
  if (!btn) return;
  els.sidePicker.querySelectorAll(".format-option").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedSide = btn.dataset.side;
});

// -- Tabs -------------------------------------------------------------------

document.querySelectorAll(".result-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".result-tabs .tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab + "Panel").classList.add("active");
  });
});

// -- Status helpers ---------------------------------------------------------

function setStatus(text, tone) {
  els.statusBadge.textContent = text;
  els.statusBadge.dataset.tone = tone || "";
}

function setLoading(on) {
  els.generateBtn.disabled = on;
  els.improveBtn.disabled = on;
  els.refreshSourceBtn.disabled = on;
  setStatus(on ? "Generating\u2026" : "Ready", on ? "working" : "success");
}

// -- Load metadata ----------------------------------------------------------

function renderSourceMeta(meta, checkedAt = new Date()) {
  sourceMeta = meta;
  const source = meta?.source || {};
  const mode = meta?.grounding_mode || "unknown";
  const checkedLabel = checkedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const reviewText = source.last_reviewed ? `Last reviewed ${source.last_reviewed}.` : "Last reviewed date unavailable.";
  const modeText = mode === "live" ? "Live source confirmed." : "Using fallback source snapshot.";
  els.sourceNote.textContent = `${modeText} ${reviewText} Checked ${checkedLabel}.`;

  if (source.doc_url) {
    els.sourceLink.href = source.doc_url;
    els.sourceLink.hidden = false;
    els.sourceLink.removeAttribute("aria-disabled");
  } else {
    els.sourceLink.hidden = true;
    els.sourceLink.setAttribute("aria-disabled", "true");
    els.sourceLink.removeAttribute("href");
  }

  knownProducts = meta.products || [];
  setStatus(mode === "live" ? "Ready" : "Using fallback source", mode === "live" ? "success" : "error");
}

async function loadMeta(options = {}) {
  const { force = false, silent = false } = options;
  try {
    if (!silent) {
      setStatus(force ? "Refreshing source\u2026" : "Checking source\u2026", "working");
    }
    const url = force ? `${API}/api/meta?ts=${Date.now()}` : `${API}/api/meta`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load metadata.");
    const meta = await res.json();
    renderSourceMeta(meta, new Date());
    return meta;
  } catch (err) {
    sourceMeta = null;
    knownProducts = [];
    els.sourceNote.textContent = `Source status unavailable: ${err.message}`;
    els.sourceLink.hidden = true;
    els.sourceLink.setAttribute("aria-disabled", "true");
    els.sourceLink.removeAttribute("href");
    setStatus("Offline", "error");
    throw err;
  }
}

async function refreshMetaForRun() {
  try {
    await loadMeta({ force: true, silent: true });
  } catch (_) {
    // Grounding metadata is status-only here; generation should still rely on the backend.
  }
}

// -- Error formatting -------------------------------------------------------

function formatError(detail) {
  if (typeof detail === "string") return detail;
  if (!detail || typeof detail !== "object") return "Request failed.";
  const lines = [];
  if (detail.message) lines.push(detail.message);
  if (Array.isArray(detail.missing) && detail.missing.length) {
    lines.push("Need more detail: " + detail.missing.join("; "));
  }
  if (detail.example) lines.push("Example: " + detail.example);
  if (Array.isArray(detail.violations) && detail.violations.length) {
    lines.push(...detail.violations);
  }
  return lines.join("\n") || "Request failed.";
}

// -- Render quality report --------------------------------------------------

function renderQuality(report) {
  if (!report || !report.scores) {
    els.qualityReport.innerHTML = "<p>No quality data available.</p>";
    return;
  }

  const statusClass = (report.status || "").replace(/\s+/g, "-");
  const chips = report.scores.map((s) =>
    `<span class="q-chip">${s.label}: ${s.score}/5</span>`
  ).join("");

  const listHtml = (items, fallback) => {
    if (!items || !items.length) return `<p style="margin:0;font-size:.88rem;color:var(--steel)">${fallback}</p>`;
    return `<ul class="q-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  };

  els.qualityReport.innerHTML = `
    <div class="q-header">
      <span class="q-score">${report.overall_score}</span>
      <span class="q-status ${statusClass}">${report.status}</span>
    </div>
    <div class="q-scores">${chips}</div>
    ${report.blockers && report.blockers.length ? `
      <div class="q-section">
        <div class="q-section-head">Blockers</div>
        ${listHtml(report.blockers, "None")}
      </div>` : ""}
    <div class="q-section">
      <div class="q-section-head">Strengths</div>
      ${listHtml(report.strengths, "None detected")}
    </div>
    <div class="q-section">
      <div class="q-section-head">Improvements</div>
      ${listHtml(report.improvements, "None needed")}
    </div>
  `;
}

// -- Render preview ---------------------------------------------------------

function renderPreview(htmlContent) {
  if (!htmlContent) {
    els.previewFrame.innerHTML = `<p style="padding:20px;color:var(--steel)">No rendered preview available for this format. Check the Raw text tab.</p>`;
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.sandbox = "allow-same-origin";
  els.previewFrame.innerHTML = "";
  els.previewFrame.appendChild(iframe);

  iframe.addEventListener("load", () => {
    try {
      const body = iframe.contentDocument.body;
      iframe.style.height = Math.max(500, body.scrollHeight + 40) + "px";
    } catch (_) {
      iframe.style.height = "700px";
    }
  });

  iframe.srcdoc = htmlContent;
}

function renderGroundingSummary(payload) {
  const docUrl = sourceMeta?.source?.doc_url;
  const mode = payload?.grounding_mode || sourceMeta?.grounding_mode || "unknown";
  const warnings = payload?.grounding_warnings || [];
  const sourceTitle = payload?.source_title || sourceMeta?.source?.title || "Source";
  const lastReviewed = payload?.source_last_reviewed || sourceMeta?.source?.last_reviewed || "unknown";
  const badgeClass = mode === "live" ? "live" : "fallback";
  const linkedTitle = docUrl
    ? `<a href="${docUrl}" target="_blank" rel="noopener noreferrer">${sourceTitle}</a>`
    : sourceTitle;

  els.groundingSummary.innerHTML = `
    <div class="grounding-summary-top">
      <p class="grounding-summary-title">Grounded for this run</p>
      <span class="grounding-summary-badge ${badgeClass}">${mode}</span>
    </div>
    <p class="grounding-summary-copy">Source: ${linkedTitle}. Last reviewed ${lastReviewed}. ${payload?.request_id ? `Request ID: ${payload.request_id}.` : ""}</p>
    ${warnings.length ? `<ul class="grounding-warning-list">${warnings.map((warning) => `<li>${warning}</li>`).join("")}</ul>` : ""}
  `;
  els.groundingSummary.classList.remove("hidden");
}

// -- Request shaping --------------------------------------------------------

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPipeEntries(value) {
  return String(value || "")
    .split("|")
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function parseStatEntries(value) {
  return splitPipeEntries(value).map((entry) => {
    const dashIdx = entry.search(/\s[-:]\s/);
    if (dashIdx === -1) {
      return { value: entry, label: "" };
    }
    return {
      value: cleanText(entry.slice(0, dashIdx)),
      label: cleanText(entry.slice(dashIdx + 3)),
    };
  });
}

function parseProofEntries(value) {
  return splitPipeEntries(value).map((entry) => {
    const dashIdx = entry.search(/\s[-:]\s/);
    if (dashIdx === -1) {
      return { reference: entry, signal: "" };
    }
    return {
      reference: cleanText(entry.slice(0, dashIdx)),
      signal: cleanText(entry.slice(dashIdx + 3)),
    };
  });
}

function parseContentPacket(text) {
  if (!text) return null;
  const fields = {};
  let current = null;

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const match = trimmed.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (match) {
      const rawLabel = cleanText(match[1]);
      const label = FIELD_ALIASES[rawLabel] || rawLabel;
      if (PACKET_FIELDS.includes(label)) {
        current = label;
        fields[label] = cleanText(match[2]);
        return;
      }
    }

    if (current) {
      fields[current] = cleanText([fields[current], trimmed].filter(Boolean).join(" "));
    }
  });

  if (!fields.Headline || !fields.Subhead) {
    return null;
  }

  return {
    headline: cleanText(fields.Headline),
    subhead: cleanText(fields.Subhead),
    stats: parseStatEntries(fields["Stat Bar"]).slice(0, 4),
    problem: cleanText(fields.Problem),
    steps: splitPipeEntries(fields["How It Works"]).slice(0, 4),
    audiences: splitPipeEntries(fields["Who Uses This"]).slice(0, 4),
    proofs: parseProofEntries(fields.Proof).slice(0, 4),
    quote: cleanText(fields.Quote),
    cta: cleanText(fields.CTA),
  };
}

function buildStructuredPacketConstraints(side) {
  const statCount = side === "two-sided" ? "4" : "3 or 4";
  const proofCount = side === "two-sided" ? "3" : "2 or 3";
  return [
    RUN_GUARDRAILS,
    `Keep the content concise enough for a ${side === "two-sided" ? "two-sided" : "one-sided"} leave-behind.`,
    "Output plain text only.",
    "No markdown bold, no bullets, and no numbered lists.",
    "Use exactly these labels, one per line, in this order: Headline:, Subhead:, Stat Bar:, Problem:, How It Works:, Who Uses This:, Proof:, Quote:, CTA:.",
    `For Stat Bar use ${statCount} entries separated by | in the format value - label.`,
    "For How It Works use 3 short actions separated by |.",
    "For Who Uses This use 3 audiences separated by |.",
    `For Proof use ${proofCount} entries separated by | in the format reference - signal.`,
    "If there is no supported quote, write Quote: None.",
  ].join(" ");
}

function buildReferenceStyles() {
  return `
    :root {
      --dark: #2e3a41;
      --steel: #445664;
      --powder: #c1d3dd;
      --light: #efefef;
      --coral: #ff7f50;
      --white: #ffffff;
      --ink: #111111;
      --paper: #f7f5f1;
      --radius: 18px;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: "Avenir Next", "Helvetica Neue", Arial, sans-serif;
    }
    .page {
      width: 8.5in;
      min-height: 11in;
      margin: 0 auto;
      padding: 0.5in 0.58in;
      position: relative;
      overflow: hidden;
      background: var(--white);
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .page.dark {
      background:
        radial-gradient(circle at top right, rgba(255, 127, 80, 0.18), transparent 24rem),
        linear-gradient(180deg, #36444d 0%, #273239 100%);
      color: var(--white);
    }
    .page.dark p,
    .page.dark li,
    .page.dark td { color: var(--powder); }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 20px;
    }
    .brand {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--steel);
    }
    .page.dark .brand { color: var(--powder); }
    .label {
      display: inline-block;
      padding: 7px 14px;
      border-radius: 999px;
      background: var(--dark);
      color: var(--white);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .page.dark .label {
      background: var(--coral);
      color: var(--dark);
    }
    h1, h2 {
      margin: 0;
      font-family: "Iowan Old Style", Georgia, serif;
      letter-spacing: -0.04em;
    }
    h1 {
      font-size: 42px;
      line-height: 0.96;
      color: var(--dark);
      margin-bottom: 12px;
    }
    h2 {
      font-size: 31px;
      line-height: 1;
      margin-bottom: 10px;
      color: inherit;
    }
    .page.dark h1,
    .page.dark h2 { color: var(--white); }
    .subhead {
      max-width: 6.8in;
      font-size: 17px;
      line-height: 1.45;
      color: var(--steel);
      margin-bottom: 20px;
    }
    .page.dark .subhead { color: var(--powder); }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat {
      border-radius: var(--radius);
      background: var(--light);
      border: 1px solid #dbe1e4;
      padding: 15px 14px 14px;
      min-height: 92px;
    }
    .stat strong {
      display: block;
      font-size: 27px;
      line-height: 1;
      color: var(--dark);
      margin-bottom: 6px;
    }
    .stat span {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--steel);
      font-weight: 700;
      line-height: 1.35;
    }
    .grid {
      display: grid;
      grid-template-columns: 1.08fr 0.92fr;
      gap: 18px;
      margin-bottom: 18px;
    }
    .panel {
      border-radius: var(--radius);
      border: 1px solid #d9dfe3;
      background: var(--white);
      padding: 18px;
    }
    .section-kicker {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--coral);
      font-weight: 800;
      margin-bottom: 8px;
    }
    .panel p,
    .panel li {
      font-size: 14px;
      line-height: 1.48;
      color: #253037;
    }
    .panel p { margin: 0 0 10px; }
    .page.dark .panel {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .page.dark .panel p,
    .page.dark .panel li { color: var(--powder); }
    .step-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .step {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      border-radius: 14px;
      background: #f7f8f9;
      border: 1px solid #d8dee2;
      padding: 14px;
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--coral);
      color: var(--white);
      font-size: 12px;
      font-weight: 800;
    }
    .step-copy {
      font-size: 13px;
      line-height: 1.45;
      color: var(--dark);
    }
    .audience-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    .audience-card {
      border-radius: 18px;
      padding: 18px 16px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .audience-card h3 {
      margin: 0 0 9px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--coral);
    }
    .audience-card p {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      line-height: 1.42;
    }
    th {
      text-align: left;
      padding: 10px 10px 8px;
      background: var(--steel);
      color: var(--white);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    td {
      padding: 10px;
      vertical-align: top;
      border-bottom: 1px solid #dce2e5;
      color: #253037;
      background: rgba(255, 255, 255, 0.88);
    }
    tr:nth-child(even) td { background: #f7f8f9; }
    .page.dark th {
      background: rgba(193, 211, 221, 0.16);
      color: var(--white);
    }
    .page.dark td {
      border-bottom-color: rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
    }
    .page.dark tr:nth-child(even) td { background: rgba(255, 255, 255, 0.03); }
    .quote {
      border-left: 4px solid var(--coral);
      padding: 14px 16px;
      border-radius: 0 16px 16px 0;
      background: rgba(193, 211, 221, 0.22);
      margin-top: 18px;
      margin-bottom: 18px;
    }
    .page.dark .quote { background: rgba(255, 255, 255, 0.08); }
    .quote p {
      margin: 0 0 8px;
      font-size: 17px;
      line-height: 1.4;
      font-family: "Iowan Old Style", Georgia, serif;
      color: inherit;
    }
    .quote span {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--steel);
      font-weight: 700;
    }
    .page.dark .quote span { color: var(--powder); }
    .cta {
      margin-top: auto;
      border-radius: 20px;
      padding: 20px 22px;
      background: linear-gradient(135deg, rgba(255, 127, 80, 0.95), rgba(255, 165, 120, 0.95));
      color: var(--dark);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
    }
    .cta strong {
      display: block;
      font-size: 22px;
      line-height: 1;
      margin-bottom: 6px;
      font-family: "Iowan Old Style", Georgia, serif;
    }
    .cta p {
      margin: 0;
      font-size: 14px;
      line-height: 1.45;
      color: #2e3a41;
    }
    .cta .url {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .footer {
      position: absolute;
      left: 0.58in;
      right: 0.58in;
      bottom: 0.36in;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--steel);
    }
    .page.dark .footer { color: var(--powder); }
    @page {
      size: letter;
      margin: 0;
    }
  `;
}

function renderStats(stats) {
  return stats.map((item) => `
    <div class="stat">
      <strong>${escapeHtml(item.value)}</strong>
      <span>${escapeHtml(item.label || "Approved public stat")}</span>
    </div>
  `).join("");
}

function renderSteps(steps) {
  return steps.map((step, index) => `
    <div class="step">
      <div class="step-num">${index + 1}</div>
      <div class="step-copy">${escapeHtml(step)}</div>
    </div>
  `).join("");
}

function renderAudienceCards(audiences) {
  return audiences.map((audience) => `
    <div class="audience-card">
      <h3>${escapeHtml(audience)}</h3>
      <p>Use this message when this group owns policy, access, rollout, or governed delivery inside the institution.</p>
    </div>
  `).join("");
}

function renderProofRows(proofs) {
  return proofs.map((proof) => `
    <tr>
      <td>${escapeHtml(proof.reference)}</td>
      <td>${escapeHtml(proof.signal)}</td>
    </tr>
  `).join("");
}

function renderQuoteBlock(quote) {
  if (!quote || quote.toLowerCase() === "none") return "";
  return `
    <div class="quote">
      <p>${escapeHtml(quote)}</p>
      <span>Approved public quote</span>
    </div>
  `;
}

function buildReferenceHeader(meta, labelText) {
  const productLabel = meta.products.length ? meta.products.join(" + ") : "Vocareum One-Pager";
  return `
    <div class="header">
      <div class="brand">Vocareum | ${escapeHtml(productLabel)}</div>
      <div class="label">${escapeHtml(labelText)}</div>
    </div>
  `;
}

function renderReferenceOnePager(packet, meta) {
  const quoteBlock = renderQuoteBlock(packet.quote);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(packet.headline)}</title>
  <style>${buildReferenceStyles()}</style>
</head>
<body>
  <section class="page">
    ${buildReferenceHeader(meta, "One-Sided")}
    <div class="section-kicker">Reference one-pager render</div>
    <h1>${escapeHtml(packet.headline)}</h1>
    <p class="subhead">${escapeHtml(packet.subhead)}</p>

    <div class="stats">${renderStats(packet.stats)}</div>

    <div class="grid">
      <div class="panel">
        <div class="section-kicker">What the room needs</div>
        <p>${escapeHtml(packet.problem)}</p>
        <div class="step-list">${renderSteps(packet.steps)}</div>
      </div>

      <div class="panel">
        <div class="section-kicker">Who this fits</div>
        <p>${escapeHtml(packet.audiences.join(" | "))}</p>
        <div class="section-kicker" style="margin-top:16px;">Named public proof</div>
        <table>
          <tr>
            <th>Reference</th>
            <th>Signal</th>
          </tr>
          ${renderProofRows(packet.proofs)}
        </table>
      </div>
    </div>

    ${quoteBlock}

    <div class="cta">
      <div>
        <strong>One governed story.</strong>
        <p>${escapeHtml(packet.cta)}</p>
      </div>
      <div class="url">vocareum.com</div>
    </div>

    <div class="footer">
      <span>vocareum.com</span>
      <span>01</span>
    </div>
  </section>
</body>
</html>`;
}

function renderReferenceTwoPager(packet, meta) {
  const quoteBlock = renderQuoteBlock(packet.quote);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(packet.headline)}</title>
  <style>${buildReferenceStyles()}</style>
</head>
<body>
  <section class="page">
    ${buildReferenceHeader(meta, "Side 1")}
    <div class="section-kicker">Front side</div>
    <h1>${escapeHtml(packet.headline)}</h1>
    <p class="subhead">${escapeHtml(packet.subhead)}</p>

    <div class="stats">${renderStats(packet.stats)}</div>

    <div class="grid">
      <div class="panel">
        <div class="section-kicker">Core story</div>
        <p>${escapeHtml(packet.problem)}</p>
      </div>
      <div class="panel">
        <div class="section-kicker">Operational fit</div>
        <p>${escapeHtml(packet.audiences.join(" | "))}</p>
      </div>
    </div>

    <div class="panel">
      <div class="section-kicker">How it works</div>
      <div class="step-list">${renderSteps(packet.steps)}</div>
    </div>

    <div class="footer">
      <span>vocareum.com</span>
      <span>01</span>
    </div>
  </section>

  <section class="page dark">
    ${buildReferenceHeader(meta, "Side 2")}
    <div class="section-kicker">Back side</div>
    <h2>Why this resonates in the room.</h2>
    <p class="subhead">${escapeHtml(packet.subhead)}</p>

    <div class="audience-grid">${renderAudienceCards(packet.audiences)}</div>

    <div class="section-kicker">Named public proof</div>
    <table>
      <tr>
        <th>Reference</th>
        <th>What it proves</th>
      </tr>
      ${renderProofRows(packet.proofs)}
    </table>

    ${quoteBlock}

    <div class="cta">
      <div>
        <strong>Use this to move the next conversation.</strong>
        <p>${escapeHtml(packet.cta)}</p>
      </div>
      <div class="url">vocareum.com</div>
    </div>

    <div class="footer">
      <span>vocareum.com</span>
      <span>02</span>
    </div>
  </section>
</body>
</html>`;
}

function applyReferenceRender(payload, requestMeta) {
  const packet = parseContentPacket(payload.output);
  if (!packet) return payload;

  const html = requestMeta.side === "two-sided"
    ? renderReferenceTwoPager(packet, requestMeta)
    : renderReferenceOnePager(packet, requestMeta);

  return {
    ...payload,
    rendered_html: html,
    rendered_kind: "one-pager",
    rendered_title: packet.headline || payload.rendered_title || "vocareum_one_pager",
  };
}

function normalizeText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferProductsFromBrief(brief) {
  const normalizedBrief = normalizeText(brief);
  if (!normalizedBrief) return [];

  const matches = new Set(
    knownProducts.filter((name) => normalizedBrief.includes(normalizeText(name)))
  );

  PRODUCT_ALIASES.forEach((alias) => {
    const hasCanonical = !knownProducts.length || knownProducts.includes(alias.canonical);
    if (!hasCanonical) return;
    if (alias.patterns.some((pattern) => normalizedBrief.includes(normalizeText(pattern)))) {
      matches.add(alias.canonical);
    }
  });

  return Array.from(matches);
}

function buildAudienceSummary(brief) {
  return brief.replace(/\s+/g, " ").trim().slice(0, 200);
}

function buildRequestFromForm() {
  const brief = els.brief.value.trim();
  if (!brief) {
    return { error: "Fill the required brief." };
  }

  const matchedProducts = inferProductsFromBrief(brief);
  if (knownProducts.length && !matchedProducts.length) {
    return { error: "Name at least one Vocareum product directly in the brief." };
  }

  return {
    asset_type: "one-pager",
    product: matchedProducts.length ? matchedProducts.join(", ") : brief,
    audience: buildAudienceSummary(brief),
    objective: `Create a concise one-pager content packet based on this brief: ${brief}`,
    extra_constraints: buildStructuredPacketConstraints(selectedSide),
    _meta: {
      brief,
      matchedProducts,
      side: selectedSide,
    },
  };
}

// -- Generate ---------------------------------------------------------------

async function generate(event) {
  event.preventDefault();

  const request = buildRequestFromForm();
  if (request.error) {
    setStatus(request.error, "error");
    return;
  }
  const { _meta: requestMeta, ...apiRequest } = request;

  setLoading(true);
  els.resultSection.classList.remove("hidden");
  els.rawOutput.textContent = "Generating\u2026";
  els.groundingSummary.classList.add("hidden");
  renderPreview(null);

  // Activate preview tab
  document.querySelectorAll(".result-tabs .tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('[data-tab="preview"]').classList.add("active");
  document.getElementById("previewPanel").classList.add("active");

  try {
    await refreshMetaForRun();
    const res = await fetch(`${API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apiRequest),
    });
    const rawPayload = await res.json();
    if (!res.ok) throw new Error(formatError(rawPayload.detail));
    const payload = applyReferenceRender(rawPayload, requestMeta);

    lastResult = payload;
    els.rawOutput.textContent = payload.output;
    renderGroundingSummary(payload);

    if (payload.rendered_html) {
      renderPreview(payload.rendered_html);
    } else {
      renderPreview(null);
    }

    renderQuality(payload.quality_report);

    setStatus(`Done in ${(payload.duration_ms / 1000).toFixed(1)}s`, "success");
  } catch (err) {
    lastResult = null;
    els.rawOutput.textContent = `Error:\n${err.message}`;
    els.previewFrame.innerHTML = `<div style="padding:24px;color:var(--coral-deep);font-size:0.95rem;line-height:1.6">
      <strong>Generation failed</strong><br>${err.message.replace(/\n/g, "<br>")}
    </div>`;
    els.groundingSummary.classList.add("hidden");
    els.qualityReport.innerHTML = "";
    setStatus("Error", "error");
    // Switch to raw text tab so the error is visible
    document.querySelectorAll(".result-tabs .tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelector('[data-tab="raw"]').classList.add("active");
    document.getElementById("rawPanel").classList.add("active");
  } finally {
    setLoading(false);
  }
}

// -- Improve ----------------------------------------------------------------

async function improve() {
  if (!lastResult) return;

  const rating = 3;
  const notes = "Make it sharper, more specific, and tighter while keeping the exact labeled packet structure and named public proof format.";
  const request = buildRequestFromForm();
  if (request.error) {
    setStatus(request.error, "error");
    return;
  }
  const { _meta: requestMeta, ...apiRequest } = request;

  setLoading(true);

  try {
    await refreshMetaForRun();
    const res = await fetch(`${API}/api/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: apiRequest,
        current_output: lastResult.output,
        rating: rating,
        notes: notes,
      }),
    });
    const rawPayload = await res.json();
    if (!res.ok) throw new Error(formatError(rawPayload.detail));
    const payload = applyReferenceRender(rawPayload, requestMeta);

    lastResult = payload;
    els.rawOutput.textContent = payload.output;
    renderGroundingSummary(payload);

    if (payload.rendered_html) {
      renderPreview(payload.rendered_html);
    } else {
      renderPreview(null);
    }

    renderQuality(payload.quality_report);

    setStatus(`Improved in ${(payload.duration_ms / 1000).toFixed(1)}s`, "success");
  } catch (err) {
    lastResult = null;
    els.rawOutput.textContent = `Error:\n${err.message}`;
    els.previewFrame.innerHTML = `<div style="padding:24px;color:var(--coral-deep);font-size:0.95rem;line-height:1.6">
      <strong>Improve failed</strong><br>${err.message.replace(/\n/g, "<br>")}
    </div>`;
    els.groundingSummary.classList.add("hidden");
    els.qualityReport.innerHTML = "";
    setStatus("Improve failed", "error");
    document.querySelectorAll(".result-tabs .tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelector('[data-tab="raw"]').classList.add("active");
    document.getElementById("rawPanel").classList.add("active");
  } finally {
    setLoading(false);
  }
}

// -- Copy & download --------------------------------------------------------

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = orig; }, 1200);
  } catch (_) {
    btn.textContent = "Copy failed";
    setTimeout(() => { btn.textContent = "Copy text"; }, 1200);
  }
}

function downloadHtml() {
  if (!lastResult || !lastResult.rendered_html) return;
  const blob = new Blob([lastResult.rendered_html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const title = (lastResult.rendered_title || "collateral").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  a.download = `${title}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -- Wire events ------------------------------------------------------------

els.form.addEventListener("submit", generate);
els.improveBtn.addEventListener("click", improve);
els.copyRawBtn.addEventListener("click", () => {
  if (lastResult) copyText(lastResult.output, els.copyRawBtn);
});
els.copyHtmlBtn.addEventListener("click", () => {
  if (lastResult && lastResult.rendered_html) copyText(lastResult.rendered_html, els.copyHtmlBtn);
});
els.downloadBtn.addEventListener("click", downloadHtml);
els.refreshSourceBtn.addEventListener("click", async () => {
  try {
    await loadMeta({ force: true });
  } catch (_) {
    // Status is already handled in loadMeta.
  }
});

loadMeta({ force: true }).catch(() => {});
