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
  runProgress: document.getElementById("runProgress"),
  runProgressLabel: document.getElementById("runProgressLabel"),
  runProgressMeta: document.getElementById("runProgressMeta"),
  runProgressBar: document.getElementById("runProgressBar"),
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
let progressTimer = null;
let progressStartedAt = 0;

const RUN_PROGRESS_PHASES = {
  generate: [
    { pct: 8, label: "Preparing brief" },
    { pct: 24, label: "Grounding request" },
    { pct: 54, label: "Drafting one-pager" },
    { pct: 80, label: "Reviewing buyer and proof fit" },
    { pct: 94, label: "Rendering preview" },
  ],
  improve: [
    { pct: 8, label: "Preparing revision" },
    { pct: 28, label: "Reviewing current draft" },
    { pct: 58, label: "Rewriting and tightening" },
    { pct: 82, label: "Checking grounded changes" },
    { pct: 94, label: "Rendering preview" },
  ],
};

const PRODUCT_ALIASES = [
  { canonical: "AI Compass", patterns: ["ai compass", "compass"] },
  { canonical: "AI Gateway", patterns: ["ai gateway", "gateway"] },
  { canonical: "AI Notebook", patterns: ["ai notebook", "ai notebooks", "notebook", "notebooks", "vnb"] },
  { canonical: "Agentic AI Labs", patterns: ["agentic ai labs", "agentic ai lab", "agentic labs", "agentic lab"] },
  { canonical: "GPU & CPU Compute", patterns: ["gpu & cpu compute", "gpu compute", "gpu", "gpus", "cpu compute"] },
  { canonical: "Cloud Labs", patterns: ["cloud labs", "cloud lab", "labs"] },
  { canonical: "Cyber Ranges", patterns: ["cyber ranges", "cyber range"] },
  { canonical: "Databases", patterns: ["database", "databases"] },
  { canonical: "Developer Workspaces", patterns: ["developer workspaces", "developer workspace", "workspace", "workspaces"] },
  { canonical: "On-the-Fly Labs", patterns: ["on-the-fly labs", "on the fly labs", "otf labs", "otf lab"] },
  { canonical: "Platform Enablement Labs", patterns: ["platform enablement labs", "platform enablement lab", "enablement labs", "enablement lab"] },
  { canonical: "Simulations", patterns: ["simulation", "simulations"] },
  { canonical: "Virtual Desktop", patterns: ["virtual desktop", "virtual desktops"] },
];

const RUN_GUARDRAILS = "Use only approved Vocareum product names, proof points, and references from the source catalog. Do not invent named proof headings, customer examples, frameworks, or capability labels.";
const PACKET_FIELDS = ["Audience", "Headline", "Subhead", "Stat Bar", "Problem", "How It Works", "Who Uses This", "Proof", "Quote", "CTA"];
const FIELD_ALIASES = {
  "Core story": "Problem",
  "Audience fit": "Who Uses This",
  "Named public proof": "Proof",
};
const AUDIENCE_STOPWORDS = new Set([
  "a", "an", "and", "audience", "audiences", "business", "buyers", "buyer",
  "company", "companies", "context", "department", "departments", "director",
  "directors", "enterprise", "for", "group", "groups", "industry", "leader",
  "leaders", "line", "of", "or", "product", "role", "roles", "target", "team",
  "teams", "the", "title", "titles",
]);
const PROOF_PLACEHOLDER_PATTERNS = [
  /\bsource docs?\b/i,
  /\bproduct catalog\b/i,
  /\bapproved catalog\b/i,
  /\bworkflow\/category\b/i,
  /\bworkflow category\b/i,
  /\bcurrent workflow\b/i,
  /\blive source\b/i,
  /\bgrounding\b/i,
  /\blast reviewed\b/i,
  /\bversion\b/i,
];

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

function setLoading(on, statusText = on ? "Generating…" : "Ready") {
  els.generateBtn.disabled = on;
  els.improveBtn.disabled = on;
  els.refreshSourceBtn.disabled = on;
  setStatus(statusText, on ? "working" : "success");
}

function renderRunProgress(percent, label, metaText) {
  els.runProgress.classList.remove("hidden");
  els.runProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  els.runProgressLabel.textContent = label;
  els.runProgressMeta.textContent = metaText;
}

function stopRunProgress() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function startRunProgress(mode) {
  stopRunProgress();
  const phases = RUN_PROGRESS_PHASES[mode] || RUN_PROGRESS_PHASES.generate;
  let percent = phases[0].pct;
  progressStartedAt = Date.now();

  const tick = () => {
    const elapsedSec = Math.max(0, Math.round((Date.now() - progressStartedAt) / 1000));
    percent = Math.min(94, percent + (percent < 28 ? 4 : percent < 72 ? 3 : 1.5));
    let active = phases[0];
    for (const phase of phases) {
      if (percent >= phase.pct) active = phase;
    }
    renderRunProgress(percent, active.label, `${elapsedSec}s elapsed`);
  };

  tick();
  progressTimer = setInterval(tick, 800);
}

function finishRunProgress(label) {
  stopRunProgress();
  const elapsedSec = Math.max(0.5, (Date.now() - progressStartedAt) / 1000);
  renderRunProgress(100, label, `${elapsedSec.toFixed(1)}s total`);
  setTimeout(() => {
    els.runProgress.classList.add("hidden");
  }, 1200);
}

function failRunProgress() {
  stopRunProgress();
  els.runProgress.classList.add("hidden");
}

// -- Load metadata ----------------------------------------------------------

function formatSourceTimestamp(value, options = {}) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString([], options);
}

function renderSourceMeta(meta, checkedAt = new Date()) {
  sourceMeta = meta;
  const source = meta?.source || {};
  const mode = meta?.grounding_mode || "unknown";
  const checkedSourceAt = formatSourceTimestamp(source.checked_at, { hour: "numeric", minute: "2-digit" });
  const checkedLabel = checkedSourceAt || checkedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const reviewText = source.last_reviewed ? `Last reviewed ${source.last_reviewed}.` : "Last reviewed date unavailable.";
  const versionText = source.version && source.version !== "Unknown" ? ` Version ${source.version}.` : "";
  const modifiedText = source.modified_time && source.modified_time !== "Unknown"
    ? ` Updated ${formatSourceTimestamp(source.modified_time, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
    : "";
  const modeText = mode === "live" ? "Live source confirmed." : "Using fallback source snapshot.";
  els.sourceNote.textContent = `${modeText} ${reviewText}${versionText}${modifiedText} Checked ${checkedLabel}.`;

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
    let res;
    if (force) {
      res = await fetch(`${API}/api/source/refresh`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        res = await fetch(`${API}/api/meta?force=true&ts=${Date.now()}`, { cache: "no-store" });
      }
    } else {
      res = await fetch(`${API}/api/meta`, { cache: "no-store" });
    }
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
  const docUrl = payload?.source_doc_url || sourceMeta?.source?.doc_url;
  const mode = payload?.grounding_mode || sourceMeta?.grounding_mode || "unknown";
  const warnings = payload?.grounding_warnings || [];
  const sourceTitle = payload?.source_title || sourceMeta?.source?.title || "Source";
  const lastReviewed = payload?.source_last_reviewed || sourceMeta?.source?.last_reviewed || "unknown";
  const sourceVersion = payload?.source_version || sourceMeta?.source?.version;
  const modifiedTime = payload?.source_modified_time || sourceMeta?.source?.modified_time;
  const checkedAt = payload?.source_checked_at || sourceMeta?.source?.checked_at;
  const badgeClass = mode === "live" ? "live" : "fallback";
  const renderNote = payload?.render_origin === "canonical-packet"
    ? " Rendered from the canonical one-pager packet."
    : payload?.render_origin === "local-reference"
      ? " Rendered with the local reference template."
      : "";
  const versionNote = sourceVersion && sourceVersion !== "Unknown" ? ` Version ${sourceVersion}.` : "";
  const modifiedNote = modifiedTime && modifiedTime !== "Unknown"
    ? ` Updated ${formatSourceTimestamp(modifiedTime, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
    : "";
  const checkedNote = checkedAt ? ` Checked ${formatSourceTimestamp(checkedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : "";
  const linkedTitle = docUrl
    ? `<a href="${docUrl}" target="_blank" rel="noopener noreferrer">${sourceTitle}</a>`
    : sourceTitle;

  els.groundingSummary.innerHTML = `
    <div class="grounding-summary-top">
      <p class="grounding-summary-title">Grounded for this run</p>
      <span class="grounding-summary-badge ${badgeClass}">${mode}</span>
    </div>
    <p class="grounding-summary-copy">Source: ${linkedTitle}. Last reviewed ${lastReviewed}.${versionNote}${modifiedNote}${checkedNote}${renderNote} ${payload?.request_id ? `Request ID: ${payload.request_id}.` : ""}</p>
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

function isNoneLike(value) {
  return /^(?:none|none\.|n\/a|not available|not applicable|no quote|no proof)$/i.test(cleanText(value));
}

function meaningfulTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && !AUDIENCE_STOPWORDS.has(token));
}

function splitAudienceEntry(value) {
  const [title, ...detailParts] = String(value || "").split("::");
  return {
    title: cleanText(title),
    detail: cleanText(detailParts.join("::")),
  };
}

function formatAudienceInline(value) {
  const audience = splitAudienceEntry(value);
  if (!audience.detail) return audience.title;
  return `${audience.title}: ${audience.detail}`;
}

function sanitizeAudienceEntries(entries, explicitAudience = "") {
  const cleaned = entries
    .map((entry) => cleanText(entry))
    .filter((entry) => entry && !isNoneLike(entry));

  if (!explicitAudience) return cleaned.slice(0, 4);

  const normalizedAudience = normalizeText(explicitAudience);
  const audienceTokens = meaningfulTokens(explicitAudience);
  const overlapping = cleaned.filter((entry) => {
    const normalizedEntry = normalizeText(entry);
    if (normalizedAudience && normalizedEntry.includes(normalizedAudience)) return true;
    const entryTokens = meaningfulTokens(entry);
    return entryTokens.some((token) => audienceTokens.includes(token));
  });

  if (overlapping.length) return overlapping.slice(0, 4);
  return [cleanText(explicitAudience), ...cleaned].filter(Boolean).slice(0, 4);
}

function isPlaceholderProofEntry(proof) {
  const reference = cleanText(proof?.reference);
  const signal = cleanText(proof?.signal);
  const combined = `${reference} ${signal}`.trim();
  if (!combined || isNoneLike(reference) || isNoneLike(combined)) return true;
  return PROOF_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(combined));
}

function sanitizeProofEntries(entries) {
  return entries
    .map((entry) => ({
      reference: cleanText(entry?.reference),
      signal: cleanText(entry?.signal),
    }))
    .filter((entry) => entry.reference && entry.signal)
    .filter((entry) => !isPlaceholderProofEntry(entry))
    .slice(0, 4);
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

  if (!fields.Headline || !fields.Subhead || !fields.Problem || !fields["How It Works"]) {
    return null;
  }

  const audienceLine = cleanText(fields.Audience).replace(/^For\s+/i, "").replace(/\.$/, "");
  const audiences = fields["Who Uses This"]
    ? splitPipeEntries(fields["Who Uses This"]).slice(0, 4)
    : audienceLine
      ? [audienceLine]
      : ["Teams evaluating Vocareum AI products"];
  const proofs = fields.Proof ? parseProofEntries(fields.Proof).slice(0, 4) : [];
  const stats = parseStatEntries(fields["Stat Bar"]).slice(0, 4);

  return {
    audienceEyebrow: cleanText(fields.Audience),
    headline: cleanText(fields.Headline),
    subhead: cleanText(fields.Subhead),
    stats,
    problem: cleanText(fields.Problem),
    steps: splitPipeEntries(fields["How It Works"]).slice(0, 4),
    audiences,
    proofs,
    proofCards: [],
    logoStrip: [],
    credibilityBar: [
      "5M+ total platform learners",
      "7,000+ institutions and organizations",
      "SOC 2 Type II, FERPA, GDPR",
      "AWS, Azure, GCP, Databricks",
    ],
    footerQuote: null,
    audienceHeading: "Best fit",
    problemHeading: "Why this matters",
    stepsHeading: "How Vocareum helps",
    proofHeading: "Why believe this",
    ctaLabel: "Next business step",
    cta: cleanText(fields.CTA) || "Review which Vocareum AI product fits your workflow.",
  };
}

function normalizeQuoteObject(value) {
  if (!value || typeof value !== "object") return null;
  const text = cleanText(value.text);
  if (!text) return null;
  return {
    text,
    attribution: cleanText(value.attribution),
    title: cleanText(value.title),
  };
}

function normalizeBackendPacket(packet) {
  if (!packet || typeof packet !== "object") return null;
  if (!packet.headline || !packet.subhead || !packet.problem || !packet.cta) return null;
  const hasFooterQuote = Object.prototype.hasOwnProperty.call(packet, "footer_quote");

  return {
    audienceEyebrow: cleanText(packet.audience_eyebrow || packet.audience),
    headline: cleanText(packet.headline),
    subhead: cleanText(packet.subhead),
    stats: Array.isArray(packet.stats)
      ? packet.stats.map((item) => ({
          value: cleanText(item?.value),
          label: cleanText(item?.label),
        })).filter((item) => item.value).slice(0, 4)
      : [],
    problem: cleanText(packet.problem),
    steps: Array.isArray(packet.steps) ? packet.steps.map((item) => cleanText(item)).filter(Boolean).slice(0, 4) : [],
    audiences: Array.isArray(packet.audiences) ? packet.audiences.map((item) => cleanText(item)).filter(Boolean).slice(0, 4) : [],
    proofs: Array.isArray(packet.proofs)
      ? packet.proofs.map((item) => ({
          reference: cleanText(item?.reference),
          signal: cleanText(item?.signal),
        })).filter((item) => item.reference).slice(0, 4)
      : [],
    proofCards: Array.isArray(packet.proof_cards)
      ? packet.proof_cards.map((item) => ({
          organization: cleanText(item?.organization),
          relation: cleanText(item?.relation),
          use_case: cleanText(item?.use_case),
          what_it_proves: cleanText(item?.what_it_proves),
          logo: item?.logo?.url ? { name: cleanText(item.logo.name), url: cleanText(item.logo.url) } : null,
        })).filter((item) => item.organization && item.use_case && item.what_it_proves).slice(0, 3)
      : [],
    logoStrip: Array.isArray(packet.logo_strip)
      ? packet.logo_strip.map((item) => ({
          name: cleanText(item?.name),
          url: cleanText(item?.url),
        })).filter((item) => item.name && item.url).slice(0, 4)
      : DEFAULT_LOGO_STRIP,
    credibilityBar: Array.isArray(packet.credibility_bar)
      ? packet.credibility_bar.map((item) => cleanText(item)).filter(Boolean).slice(0, 4)
      : [
          "5M+ total platform learners",
          "7,000+ institutions and organizations",
          "SOC 2 Type II, FERPA, GDPR",
          "AWS, Azure, GCP, Databricks",
        ],
    footerQuote: hasFooterQuote ? normalizeQuoteObject(packet.footer_quote) : DEFAULT_FOOTER_QUOTE,
    audienceHeading: cleanText(packet.audience_heading) || "Best fit",
    problemHeading: cleanText(packet.problem_heading) || "Why this matters",
    stepsHeading: cleanText(packet.steps_heading) || "How Vocareum helps",
    proofHeading: cleanText(packet.proof_heading) || "Why believe this",
    ctaLabel: cleanText(packet.cta_label) || "Next business step",
    cta: cleanText(packet.cta),
  };
}

function buildStructuredPacketConstraints(side) {
  const statCount = side === "two-sided" ? "4" : "3 or 4";
  const proofCount = side === "two-sided" ? "2" : "1 or 2";
  return [
    RUN_GUARDRAILS,
    `Keep the content concise enough for a ${side === "two-sided" ? "two-sided" : "one-sided"} leave-behind.`,
    "Output plain text only.",
    "No markdown bold, no bullets, and no numbered lists.",
    "Use exactly these labels, one per line, in this order: Audience:, Headline:, Subhead:, Stat Bar:, Problem:, How It Works:, Who Uses This:, Proof:, CTA:.",
    "For Audience use one short line beginning with For ...",
    "Headline must be 12 words or fewer.",
    "Subhead must be one sentence and fit in 24 words or fewer.",
    "Problem must be 2 short sentences or fewer.",
    `For Stat Bar use ${statCount} entries separated by | in the format value - label.`,
    "For How It Works use 3 short actions separated by |.",
    "For Who Uses This use 1 to 3 specific buyer or operator entries separated by |. Prefer the format persona::specific use case. Do not use generic labels like learners, researchers, technical teams, or business teams.",
    `For Proof use ${proofCount} approved named public proof entries separated by | in the format reference - specific takeaway sentence.`,
    "If there is no approved named public proof, write Proof: None.",
    "Never use source docs, catalog dates, workflow/category labels, grounding metadata, or NAIRR references as proof.",
    "CTA must be one short next step, not a paragraph.",
  ].join(" ");
}

const DEFAULT_LOGO_STRIP = [
  { name: "University of Michigan", url: "https://www.vocareum.com/wp-content/uploads/2026/03/University-of-Michigan.png" },
  { name: "UC San Diego", url: "https://www.vocareum.com/wp-content/uploads/2026/03/University_of_California_San_Diego_logo.svg" },
  { name: "AWS", url: "https://www.vocareum.com/wp-content/uploads/2026/03/Amazon_Web_Services_Logo.svg" },
  { name: "Databricks", url: "https://www.vocareum.com/wp-content/uploads/2026/03/databricks-logo.webp" },
];

const DEFAULT_FOOTER_QUOTE = {
  text: "We've standardized on Vocareum's education technology platform for our asynchronous, instructor-led and bootcamp courses.",
  attribution: "Rochana Golani",
  title: "GVP, Learning & Enablement, Databricks",
};

function buildReferenceStyles() {
  return `
    :root {
      --navy: #2e3a41;
      --slate: #445664;
      --mist: #c1d3dd;
      --paper: #ffffff;
      --sand: #efefef;
      --line: rgba(68, 86, 100, 0.18);
      --coral: #ff7f50;
      --coral-soft: rgba(255, 127, 80, 0.12);
      --white: #ffffff;
      --ink: #000000;
      --muted: #445664;
      --radius: 22px;
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
      padding: 0.48in 0.56in 0.42in;
      position: relative;
      overflow: hidden;
      background:
        radial-gradient(circle at top right, rgba(255, 127, 80, 0.12), transparent 20rem),
        linear-gradient(180deg, #ffffff 0%, rgba(239, 239, 239, 0.62) 100%);
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .page.secondary {
      background:
        radial-gradient(circle at top left, rgba(193, 211, 221, 0.26), transparent 18rem),
        linear-gradient(180deg, #ffffff 0%, rgba(239, 239, 239, 0.82) 100%);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    .brand-lockup {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      height: 18px;
      width: auto;
      display: block;
    }
    .brand-copy {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-weight: 800;
      color: var(--slate);
    }
    .label {
      display: inline-flex;
      align-items: center;
      padding: 7px 14px;
      border-radius: 999px;
      background: var(--navy);
      color: var(--white);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .eyebrow {
      display: inline-flex;
      margin-bottom: 10px;
      padding: 7px 12px;
      border-radius: 999px;
      background: var(--coral-soft);
      color: var(--coral);
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 800;
    }
    h1, h2 {
      margin: 0;
      font-family: "Iowan Old Style", Georgia, serif;
      letter-spacing: -0.04em;
      color: var(--navy);
    }
    h1 {
      font-size: 40px;
      line-height: 0.96;
      margin-bottom: 10px;
    }
    h2 {
      font-size: 33px;
      line-height: 0.98;
      margin-bottom: 10px;
    }
    .subhead {
      max-width: 6.85in;
      font-size: 16px;
      line-height: 1.5;
      color: var(--muted);
      margin-bottom: 16px;
    }
    .top-band {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .hero-card,
    .meta-card,
    .panel,
    .quote-rail,
    .cta-card {
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.9);
    }
    .hero-card {
      padding: 20px 22px;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(255, 127, 80, 0.10));
    }
    .meta-card {
      padding: 18px;
      background:
        linear-gradient(180deg, rgba(46, 58, 65, 0.98), rgba(68, 86, 100, 0.96));
      color: var(--white);
      border-color: rgba(46, 58, 65, 0.08);
    }
    .meta-card .section-kicker,
    .meta-card p,
    .meta-card li,
    .meta-card strong,
    .meta-card span { color: var(--white); }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    .stat {
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid var(--line);
      padding: 14px 13px 12px;
      min-height: 86px;
    }
    .stat strong {
      display: block;
      font-size: 25px;
      line-height: 1;
      color: var(--navy);
      margin-bottom: 6px;
    }
    .stat span {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-weight: 700;
      line-height: 1.35;
    }
    .logo-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 10px;
    }
    .logo-chip {
      height: 62px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
    }
    .logo-chip img {
      max-width: 100%;
      max-height: 28px;
      object-fit: contain;
      filter: brightness(0) invert(1);
    }
    .logo-chip.light img {
      filter: none;
    }
    .credibility-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .credibility-item {
      padding: 10px 12px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.12);
      font-size: 13px;
      line-height: 1.4;
    }
    .content-grid {
      display: grid;
      grid-template-columns: 1.06fr 0.94fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .panel {
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
      color: var(--ink);
    }
    .panel p { margin: 0 0 10px; }
    .step-list {
      display: grid;
      gap: 10px;
    }
    .step {
      display: grid;
      grid-template-columns: 26px 1fr;
      gap: 10px;
      align-items: start;
      border-radius: 16px;
      background: var(--sand);
      border: 1px solid var(--line);
      padding: 14px;
    }
    .step-num {
      width: 26px;
      height: 26px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--coral);
      color: var(--white);
      font-size: 12px;
      font-weight: 800;
    }
    .step-copy {
      font-size: 14px;
      line-height: 1.44;
      color: var(--navy);
    }
    .best-fit-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
    }
    .best-fit-item {
      border-radius: 16px;
      padding: 12px 14px;
      background: var(--sand);
      border: 1px solid var(--line);
      font-size: 14px;
      line-height: 1.42;
      color: var(--ink);
    }
    .proof-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .proof-card {
      border-radius: 18px;
      padding: 16px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(193, 211, 221, 0.22));
    }
    .proof-card-top {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .proof-logo {
      width: 118px;
      height: 32px;
      object-fit: contain;
      object-position: left center;
    }
    .proof-org {
      margin: 0;
      font-size: 15px;
      line-height: 1.2;
      color: var(--navy);
      font-weight: 800;
    }
    .proof-label {
      display: block;
      margin-bottom: 4px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--coral);
      font-weight: 800;
    }
    .proof-card p {
      margin: 0 0 10px;
      font-size: 13px;
      line-height: 1.45;
      color: var(--ink);
    }
    .proof-empty {
      border-radius: 18px;
      border: 1px dashed var(--line);
      background: var(--sand);
      padding: 16px;
    }
    .proof-empty strong {
      display: block;
      margin-bottom: 8px;
      font-size: 15px;
      color: var(--navy);
    }
    .proof-empty p {
      margin: 0;
      font-size: 13px;
      line-height: 1.45;
      color: var(--muted);
    }
    .quote-rail {
      margin-top: 14px;
      padding: 16px 18px;
      background:
        linear-gradient(90deg, rgba(255, 127, 80, 0.12), rgba(255, 127, 80, 0.03));
      border-left: 4px solid var(--coral);
    }
    .quote-rail p {
      margin: 0 0 8px;
      font-size: 17px;
      line-height: 1.38;
      font-family: "Iowan Old Style", Georgia, serif;
      color: var(--navy);
    }
    .quote-meta {
      font-size: 12px;
      line-height: 1.45;
      color: var(--muted);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .cta-card {
      margin-top: 14px;
      padding: 18px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(239, 239, 239, 0.95));
    }
    .cta-card strong {
      display: block;
      margin-bottom: 5px;
      font-size: 18px;
      line-height: 1;
      font-family: "Iowan Old Style", Georgia, serif;
      color: var(--navy);
    }
    .cta-card p {
      margin: 0;
      font-size: 14px;
      line-height: 1.45;
      color: var(--ink);
    }
    .cta-url {
      flex-shrink: 0;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--navy);
      color: var(--white);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .secondary-grid {
      display: grid;
      grid-template-columns: 0.95fr 1.05fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .secondary-hero {
      margin-bottom: 14px;
      padding: 18px 20px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.86);
    }
    .secondary-hero h2 {
      margin-bottom: 8px;
    }
    .reference-sheet {
      padding: 0;
      background: var(--white);
    }
    .reference-hero {
      background: var(--navy);
      color: var(--white);
      padding: 20px 40px 16px 40px;
    }
    .reference-brand-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 8px;
    }
    .reference-brand {
      font-size: 10pt;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--mist);
    }
    .reference-badge {
      background: var(--coral);
      color: var(--white);
      font-size: 7pt;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .reference-eyebrow {
      display: inline-block;
      margin-bottom: 6px;
      color: var(--mist);
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .reference-hero h1 {
      margin: 0 0 4px;
      font-family: "Iowan Old Style", Georgia, serif;
      font-size: 22pt;
      line-height: 1.05;
      letter-spacing: -0.03em;
      color: var(--white);
    }
    .reference-hero-subhead {
      max-width: 92%;
      font-size: 9.5pt;
      line-height: 1.38;
      color: var(--mist);
    }
    .reference-stat-bar {
      background: var(--steel);
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 8px 40px;
      color: var(--white);
      text-align: center;
    }
    .reference-stat-item strong {
      display: block;
      margin-bottom: 2px;
      font-size: 15pt;
      line-height: 1;
      color: var(--coral);
    }
    .reference-stat-item span {
      display: block;
      font-size: 6.5pt;
      line-height: 1.25;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mist);
    }
    .reference-logo-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 40px 4px;
    }
    .reference-logo-label {
      flex-shrink: 0;
      font-size: 7pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--steel);
    }
    .reference-logo-strip {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .reference-logo-strip img {
      max-height: 16px;
      width: auto;
      object-fit: contain;
      display: block;
    }
    .reference-body {
      padding: 10px 40px 0 40px;
    }
    .reference-two-col {
      display: grid;
      grid-template-columns: 1.03fr 0.97fr;
      gap: 22px;
    }
    .reference-section-head {
      margin: 12px 0 6px;
      padding-bottom: 3px;
      border-bottom: 2px solid var(--mist);
      font-size: 9pt;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--navy);
    }
    .reference-section-head:first-child {
      margin-top: 0;
    }
    .reference-copy {
      margin: 0 0 4px;
      font-size: 8pt;
      line-height: 1.34;
      color: var(--ink);
    }
    .reference-step {
      display: flex;
      align-items: flex-start;
      margin-bottom: 5px;
    }
    .reference-step-num {
      width: 18px;
      height: 18px;
      margin-right: 8px;
      margin-top: 1px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: var(--coral);
      color: var(--white);
      font-size: 7.5pt;
      font-weight: 800;
    }
    .reference-step-copy {
      flex: 1;
      font-size: 8pt;
      line-height: 1.3;
      color: var(--ink);
    }
    .reference-step-copy strong {
      color: var(--navy);
    }
    .reference-quote {
      margin-top: 14px;
      padding: 10px 12px;
      border-left: 3px solid var(--coral);
      background: var(--light-gray, #efefef);
      font-size: 8pt;
      line-height: 1.34;
      color: var(--navy);
    }
    .reference-quote em {
      font-style: italic;
    }
    .reference-quote-meta {
      display: inline-block;
      margin-top: 3px;
      font-size: 7.5pt;
      font-weight: 700;
      color: var(--coral);
    }
    .reference-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5pt;
      margin-top: 2px;
    }
    .reference-table th {
      background: var(--steel);
      color: var(--white);
      text-align: left;
      padding: 4px 6px;
      font-size: 7pt;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .reference-table td {
      padding: 5px 6px;
      border-bottom: 1px solid rgba(68, 86, 100, 0.18);
      vertical-align: top;
      color: var(--ink);
    }
    .reference-table tr:nth-child(even) td {
      background: var(--light-gray, #efefef);
    }
    .reference-proof-band {
      margin-top: 12px;
      padding: 10px 40px;
      display: flex;
      align-items: center;
      gap: 18px;
      background: var(--navy);
      color: var(--white);
    }
    .reference-proof-stat {
      flex-shrink: 0;
      font-size: 20pt;
      line-height: 1;
      font-weight: 800;
      color: var(--coral);
    }
    .reference-proof-copy {
      flex: 1;
      font-size: 7.5pt;
      line-height: 1.35;
      color: var(--mist);
    }
    .reference-proof-copy strong {
      color: var(--white);
    }
    .reference-proof-divider {
      width: 1px;
      height: 32px;
      background: var(--steel);
      flex-shrink: 0;
    }
    .reference-proof-side {
      flex-shrink: 0;
      max-width: 220px;
      font-size: 7.2pt;
      line-height: 1.3;
      color: var(--white);
      text-align: right;
    }
    .reference-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 8px 40px 10px;
      font-size: 7.5pt;
      color: var(--steel);
    }
    .reference-footer a {
      color: var(--coral);
      text-decoration: none;
      font-weight: 700;
    }
    .reference-footer span:last-child {
      max-width: 58%;
      text-align: right;
      line-height: 1.3;
    }
    .footer {
      position: absolute;
      left: 0.56in;
      right: 0.56in;
      bottom: 0.26in;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
    }
    .footer a {
      color: inherit;
      text-decoration: none;
    }
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

function renderReferenceStatBar(stats) {
  return stats.map((item) => `
    <div class="reference-stat-item">
      <strong>${escapeHtml(item.value)}</strong>
      <span>${escapeHtml(item.label || "Approved public stat")}</span>
    </div>
  `).join("");
}

function renderReferenceSteps(steps) {
  return steps.map((step, index) => {
    const parts = cleanText(step).split(".");
    const lead = cleanText(parts.shift());
    const remainder = cleanText(parts.join("."));
    const copy = lead && remainder
      ? `<strong>${escapeHtml(lead)}.</strong> ${escapeHtml(remainder)}`
      : escapeHtml(cleanText(step));
    return `
      <div class="reference-step">
        <div class="reference-step-num">${index + 1}</div>
        <div class="reference-step-copy">${copy}</div>
      </div>
    `;
  }).join("");
}

function renderLogoStrip(logos, tone = "dark") {
  if (!logos || !logos.length) return "";
  const logoTone = tone === "light" ? " light" : "";
  return `
    <div class="logo-strip">
      ${logos.map((logo) => `
        <div class="logo-chip${logoTone}">
          <img src="${escapeHtml(logo.url)}" alt="${escapeHtml(logo.name)}">
        </div>
      `).join("")}
    </div>
  `;
}

function renderReferenceLogoRow(logos) {
  if (!logos || !logos.length) return "";
  return `
    <div class="reference-logo-row">
      <div class="reference-logo-label">Trusted by</div>
      <div class="reference-logo-strip">
        ${logos.map((logo) => logo?.url
          ? `<img src="${escapeHtml(logo.url)}" alt="${escapeHtml(logo.name)}">`
          : `<span>${escapeHtml(logo.name)}</span>`).join("")}
      </div>
    </div>
  `;
}

function buildAudienceUseCase(packet, audience, index) {
  if (audience.detail) return audience.detail;
  const fromSubhead = cleanText(packet.subhead).replace(/\.$/, "");
  if (fromSubhead) return fromSubhead;
  const fromStep = cleanText(packet.steps?.[index] || packet.steps?.[0] || "").replace(/\.$/, "");
  if (fromStep) return fromStep;
  return "Grounded product fit for the requested workflow";
}

function buildAudienceRows(packet) {
  const rows = (packet.audiences || []).slice(0, 3).map((entry, index) => {
    const audience = splitAudienceEntry(entry);
    return {
      persona: audience.title || cleanText(entry),
      useCase: buildAudienceUseCase(packet, audience, index),
    };
  }).filter((row) => row.persona && row.useCase);

  const unique = [];
  const seen = new Set();
  const primary = rows[0]?.persona?.toLowerCase() || "";
  for (const row of rows) {
    const key = row.persona.toLowerCase();
    if (primary && key !== primary && key.startsWith(`${primary} -`)) continue;
    if (primary && key !== primary && key.startsWith(`${primary}:`)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function renderAudienceTable(packet) {
  const rows = buildAudienceRows(packet);
  if (!rows.length) return "";
  return `
    <div class="reference-section-head">Who uses this</div>
    <table class="reference-table">
      <tr><th>Persona</th><th>Use case</th></tr>
      ${rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.persona)}</td>
          <td>${escapeHtml(row.useCase)}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function buildProofSummary(packet) {
  if (Array.isArray(packet.proofCards) && packet.proofCards.length) {
    const card = packet.proofCards[0];
    const useCase = cleanText(card.use_case);
    const takeaway = cleanText(card.what_it_proves);
    const detail = [useCase, takeaway].filter(Boolean).join(". ");
    return {
      lead: card.organization,
      body: detail ? `${detail}.` : "Named public proof in the approved catalog.",
    };
  }

  return {
    lead: "Vocareum at scale",
    body: "5M+ total platform learners, 7,000+ institutions and organizations, and governed delivery across AWS, Azure, GCP, and Databricks.",
  };
}

function pickReferenceProofStat(stats) {
  const entries = Array.isArray(stats) ? stats : [];
  const numeric = entries.find((item) => /\d/.test(cleanText(item?.value)));
  if (numeric?.value) return cleanText(numeric.value);
  const fallback = entries.find((item) => cleanText(item?.value));
  return fallback?.value ? cleanText(fallback.value) : "2M+";
}

function buildProofSideText(packet) {
  const items = Array.isArray(packet.credibilityBar) ? packet.credibilityBar.filter(Boolean) : [];
  if (items.length) return items.slice(0, 3).join(" · ");
  return "SOC 2 Type II · FERPA · GDPR";
}

function renderInlineQuote(quote) {
  if (!quote || !quote.text) return "";
  const meta = [quote.attribution, quote.title].filter(Boolean).join(", ");
  return `
    <div class="reference-quote">
      <em>"${escapeHtml(quote.text)}"</em><br>
      ${meta ? `<span class="reference-quote-meta">&mdash; ${escapeHtml(meta)}</span>` : ""}
    </div>
  `;
}

function renderCredibilityBar(items) {
  if (!items || !items.length) return "";
  return `
    <ul class="credibility-list">
      ${items.map((item) => `<li class="credibility-item">${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderBestFit(audiences, heading = "Best fit") {
  if (!audiences.length) return "";
  return `
    <div class="section-kicker">${escapeHtml(heading)}</div>
    <ul class="best-fit-list">
      ${audiences.map((entry) => `<li class="best-fit-item">${escapeHtml(formatAudienceInline(entry))}</li>`).join("")}
    </ul>
  `;
}

function renderProofCards(packet) {
  if (Array.isArray(packet.proofCards) && packet.proofCards.length) {
    return `
      <div class="proof-grid">
        ${packet.proofCards.map((card) => `
          <div class="proof-card">
            <div class="proof-card-top">
              ${card.logo?.url ? `<img class="proof-logo" src="${escapeHtml(card.logo.url)}" alt="${escapeHtml(card.logo.name || card.organization)}">` : ""}
              <p class="proof-org">${escapeHtml(card.organization)}</p>
            </div>
            ${card.relation ? `<span class="proof-label">${escapeHtml(card.relation)}</span>` : ""}
            <span class="proof-label">Use case</span>
            <p>${escapeHtml(card.use_case || "")}</p>
            <span class="proof-label">What it proves</span>
            <p>${escapeHtml(card.what_it_proves || "")}</p>
          </div>
        `).join("")}
      </div>
    `;
  }

  return `
    <div class="proof-empty">
      <strong>No named public proof selected</strong>
      <p>This draft leans on platform scale, compliance, and partner credibility instead of forcing a weak case-study reference.</p>
    </div>
  `;
}

function renderFooterQuote(quote) {
  if (!quote || !quote.text) return "";
  const meta = [quote.attribution, quote.title].filter(Boolean).join(" | ");
  return `
    <div class="quote-rail">
      <p>"${escapeHtml(quote.text)}"</p>
      <div class="quote-meta">${escapeHtml(meta)}</div>
    </div>
  `;
}

function renderCtaCard(packet) {
  return `
    <div class="cta-card">
      <div>
        <strong>${escapeHtml(packet.ctaLabel || "Next business step")}</strong>
        <p>${escapeHtml(packet.cta)}</p>
      </div>
      <div class="cta-url">vocareum.com</div>
    </div>
  `;
}

function buildReferenceHeader(meta, labelText) {
  const products = Array.isArray(meta?.products)
    ? meta.products
    : Array.isArray(meta?.matchedProducts)
      ? meta.matchedProducts
      : [];
  const productLabel = products.length ? products.join(" + ") : "Vocareum One-Pager";
  return `
    <div class="header">
      <div class="brand-lockup">
        <img class="brand-logo" src="https://www.vocareum.com/wp-content/uploads/2024/06/Logo-wrap.svg" alt="Vocareum">
        <div class="brand-copy">${escapeHtml(productLabel)}</div>
      </div>
      <div class="label">${escapeHtml(labelText)}</div>
    </div>
  `;
}

function referenceProductLabel(meta) {
  const products = Array.isArray(meta?.products)
    ? meta.products
    : Array.isArray(meta?.matchedProducts)
      ? meta.matchedProducts
      : [];
  if (!products.length) return "Vocareum";
  if (products.length === 1) return products[0];
  const joined = products.join(" + ");
  return joined.length <= 28 ? joined : products[0];
}

function renderReferenceOnePager(packet, meta) {
  const proof = buildProofSummary(packet);
  const proofSide = buildProofSideText(packet);
  const badge = referenceProductLabel(meta);
  const proofStat = pickReferenceProofStat(packet.stats);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(packet.headline)}</title>
  <style>${buildReferenceStyles()}</style>
</head>
<body>
  <section class="page reference-sheet">
    <div class="reference-hero">
      <div class="reference-brand-row">
        <span class="reference-brand">Vocareum</span>
        <span class="reference-badge">${escapeHtml(badge)}</span>
      </div>
      ${packet.audienceEyebrow ? `<div class="reference-eyebrow">${escapeHtml(packet.audienceEyebrow)}</div>` : ""}
      <h1>${escapeHtml(packet.headline)}</h1>
      <div class="reference-hero-subhead">${escapeHtml(packet.subhead)}</div>
    </div>

    <div class="reference-stat-bar">
      ${renderReferenceStatBar(packet.stats)}
    </div>

    ${renderReferenceLogoRow(packet.logoStrip)}

    <div class="reference-body">
      <div class="reference-two-col">
        <div>
          <div class="reference-section-head">The problem</div>
          <p class="reference-copy">${escapeHtml(packet.problem)}</p>

          <div class="reference-section-head">How it works</div>
          ${renderReferenceSteps(packet.steps)}
          ${renderInlineQuote(packet.footerQuote)}
        </div>
        <div>
          ${renderAudienceTable(packet)}
        </div>
      </div>
    </div>

    <div class="reference-proof-band">
      <div class="reference-proof-stat">${escapeHtml(proofStat)}</div>
      <div class="reference-proof-copy"><strong>${escapeHtml(proof.lead)}.</strong> ${escapeHtml(proof.body)}</div>
      <div class="reference-proof-divider"></div>
      <div class="reference-proof-side">${escapeHtml(proofSide)}</div>
    </div>

    <div class="reference-footer">
      <a href="https://vocareum.com" target="_blank" rel="noopener noreferrer">vocareum.com</a>
      <span>${escapeHtml(packet.cta)}</span>
    </div>
  </section>
</body>
</html>`;
}

function renderReferenceTwoPager(packet, meta) {
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

    <div class="hero-card" style="margin-bottom:14px;">
      ${packet.audienceEyebrow ? `<div class="eyebrow">${escapeHtml(packet.audienceEyebrow)}</div>` : ""}
      <h1>${escapeHtml(packet.headline)}</h1>
      <p class="subhead">${escapeHtml(packet.subhead)}</p>
      <div class="stats">${renderStats(packet.stats)}</div>
    </div>

    <div class="content-grid">
      <div class="panel">
        <div class="section-kicker">${escapeHtml(packet.problemHeading || "Why this matters")}</div>
        <p>${escapeHtml(packet.problem)}</p>
      </div>
      <div class="panel">
        <div class="section-kicker">Selected customers and partners</div>
        ${renderLogoStrip(packet.logoStrip, "light")}
      </div>
    </div>

    <div class="content-grid">
      <div class="panel">
        <div class="section-kicker">${escapeHtml(packet.stepsHeading || "How Vocareum helps")}</div>
        <div class="step-list">${renderSteps(packet.steps)}</div>
      </div>
      <div class="panel">
        ${renderBestFit(packet.audiences, packet.audienceHeading)}
      </div>
    </div>

    <div class="footer">
      <a href="https://vocareum.com" target="_blank" rel="noopener noreferrer">vocareum.com</a>
      <span>01</span>
    </div>
  </section>

  <section class="page secondary">
    ${buildReferenceHeader(meta, "Side 2")}

    <div class="secondary-hero">
      <h2>${escapeHtml(packet.headline)}</h2>
      <p class="subhead">${escapeHtml(packet.subhead)}</p>
    </div>

    <div class="secondary-grid">
      <div class="panel">
        <div class="section-kicker">Platform credibility</div>
        ${renderCredibilityBar(packet.credibilityBar)}
      </div>
      <div class="panel">
        <div class="section-kicker">${escapeHtml(packet.proofHeading || "Why believe this")}</div>
        ${renderProofCards(packet)}
      </div>
    </div>

    ${renderFooterQuote(packet.footerQuote)}
    ${renderCtaCard(packet)}

    <div class="footer">
      <a href="https://vocareum.com" target="_blank" rel="noopener noreferrer">vocareum.com</a>
      <span>02</span>
    </div>
  </section>
</body>
</html>`;
}

function applyReferenceRender(payload, requestMeta) {
  const canonicalPacket = normalizeBackendPacket(payload.content_packet);
  const fallbackPacket = canonicalPacket ? null : parseContentPacket(payload.output);
  const packet = canonicalPacket || fallbackPacket;
  if (!packet) return payload;
  const preparedPacket = canonicalPacket ? canonicalPacket : {
    ...fallbackPacket,
    audiences: sanitizeAudienceEntries(fallbackPacket.audiences, requestMeta?.audience || ""),
    proofs: sanitizeProofEntries(fallbackPacket.proofs),
    proofCards: [],
    logoStrip: [],
    credibilityBar: [
      "5M+ total platform learners",
      "7,000+ institutions and organizations",
      "SOC 2 Type II, FERPA, GDPR",
      "AWS, Azure, GCP, Databricks",
    ],
    audienceEyebrow: requestMeta?.audience ? `For ${requestMeta.audience}` : "",
    audienceHeading: "Best fit",
    problemHeading: "Why this matters",
    stepsHeading: "How Vocareum helps",
    proofHeading: "Why believe this",
    ctaLabel: "Next business step",
    footerQuote: null,
  };

  const html = requestMeta.side === "two-sided"
    ? renderReferenceTwoPager(preparedPacket, requestMeta)
    : renderReferenceOnePager(preparedPacket, requestMeta);

  return {
    ...payload,
    rendered_html: html,
    rendered_kind: "one-pager",
    rendered_title: preparedPacket.headline || payload.rendered_title || "vocareum_one_pager",
    render_origin: payload.content_packet ? "canonical-packet" : "local-reference",
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

function inferAudienceFromBrief(brief, matchedProducts = []) {
  const condensed = String(brief || "").replace(/\s+/g, " ").trim();
  if (!condensed) return "";

  const patterns = [
    /\baimed at\s+(.+?)(?=\b(?:for|aimed at|targeted at|targeting)\b|[,.;]|$)/ig,
    /\btargeted at\s+(.+?)(?=\b(?:for|aimed at|targeted at|targeting)\b|[,.;]|$)/ig,
    /\btargeting\s+(.+?)(?=\b(?:for|aimed at|targeted at|targeting)\b|[,.;]|$)/ig,
    /\bfor\s+(.+?)(?=\b(?:for|aimed at|targeted at|targeting)\b|[,.;]|$)/ig,
  ];
  const genericTokens = new Set([
    "a", "an", "and", "asset", "brief", "build", "collateral", "concise", "content",
    "create", "deck", "need", "one", "page", "pager", "packet", "sales", "sentence",
    "sentences", "sheet", "sheeter", "short", "side", "sided", "simulation",
    "simulations", "the", "this", "two", "write",
  ]);
  const candidates = [];

  patterns.forEach((pattern) => {
    for (const match of condensed.matchAll(pattern)) {
      const candidate = String(match[1] || "")
        .replace(/^(?:a|an|the)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[,:;.-]+$/g, "")
        .trim();
      if (candidate) {
        candidates.push({ index: match.index || 0, candidate });
      }
    }
  });

  const normalizedProducts = matchedProducts.map((product) => normalizeText(product));
  candidates.sort((a, b) => b.index - a.index);
  for (const item of candidates) {
    const normalized = normalizeText(item.candidate);
    if (!normalized || normalized.length < 3) continue;
    if (normalizedProducts.includes(normalized)) continue;
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length && tokens.every((token) => genericTokens.has(token))) continue;
    return item.candidate;
  }

  return "";
}

function buildRequestFromForm() {
  const brief = els.brief.value.trim();
  if (!brief) {
    return { error: "Fill the required brief." };
  }

  const matchedProducts = inferProductsFromBrief(brief);
  const audience = inferAudienceFromBrief(brief, matchedProducts);

  return {
    asset_type: "one-pager",
    product: matchedProducts.length ? matchedProducts.join(", ") : "",
    audience,
    objective: `Create a concise one-pager content packet based on this brief: ${brief}`,
    extra_constraints: buildStructuredPacketConstraints(selectedSide),
    _meta: {
      brief,
      audience,
      matchedProducts,
      products: matchedProducts,
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

  setLoading(true, "Generating…");
  startRunProgress("generate");
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

    finishRunProgress("Ready");
    setStatus(`Done in ${(payload.duration_ms / 1000).toFixed(1)}s`, "success");
  } catch (err) {
    lastResult = null;
    failRunProgress();
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

  setLoading(true, "Improving…");
  startRunProgress("improve");

  try {
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

    finishRunProgress("Revision ready");
    setStatus(`Improved in ${(payload.duration_ms / 1000).toFixed(1)}s`, "success");
  } catch (err) {
    lastResult = null;
    failRunProgress();
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

loadMeta().catch(() => {});
