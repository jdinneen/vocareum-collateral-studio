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

function normalizeText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferProductsFromBrief(brief) {
  const normalizedBrief = normalizeText(brief);
  if (!normalizedBrief || !knownProducts.length) return [];
  return knownProducts.filter((name) => normalizedBrief.includes(normalizeText(name)));
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

  const layoutInstruction = selectedSide === "two-sided"
    ? "Layout: two-sided one-pager."
    : "Layout: one-sided one-pager.";

  return {
    asset_type: "one-pager",
    product: matchedProducts.length ? matchedProducts.join(", ") : brief,
    audience: buildAudienceSummary(brief),
    objective: brief,
    extra_constraints: layoutInstruction,
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
    await loadMeta({ force: true, silent: true });
    const res = await fetch(`${API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(formatError(payload.detail));

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
  const notes = "Make it sharper, more specific, and tighter.";
  const request = buildRequestFromForm();
  if (request.error) {
    setStatus(request.error, "error");
    return;
  }

  setLoading(true);

  try {
    await loadMeta({ force: true, silent: true });
    const res = await fetch(`${API}/api/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request,
        current_output: lastResult.output,
        rating: rating,
        notes: notes,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(formatError(payload.detail));

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
    els.groundingSummary.classList.add("hidden");
    setStatus("Improve failed", "error");
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
