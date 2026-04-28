window.APP_CONFIG = window.APP_CONFIG || {
  apiBaseUrl: "https://vocareum-prompt-api-379861060062.us-central1.run.app"
};

const API = window.APP_CONFIG.apiBaseUrl;

const els = {
  form: document.getElementById("builderForm"),
  formatPicker: document.getElementById("formatPicker"),
  product: document.getElementById("productSelect"),
  audience: document.getElementById("audienceInput"),
  brief: document.getElementById("briefInput"),
  constraints: document.getElementById("constraintsInput"),
  generateBtn: document.getElementById("generateBtn"),
  statusBadge: document.getElementById("statusBadge"),
  sourceNote: document.getElementById("sourceNote"),
  resultSection: document.getElementById("resultSection"),
  previewFrame: document.getElementById("previewFrame"),
  rawOutput: document.getElementById("rawOutput"),
  qualityReport: document.getElementById("qualityReport"),
  copyRawBtn: document.getElementById("copyRawBtn"),
  copyHtmlBtn: document.getElementById("copyHtmlBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  improveBtn: document.getElementById("improveBtn"),
};

let selectedFormat = "one-pager";
let lastResult = null;

// -- Format picker ----------------------------------------------------------

els.formatPicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".format-option");
  if (!btn) return;
  els.formatPicker.querySelectorAll(".format-option").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedFormat = btn.dataset.format;
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
  setStatus(on ? "Generating\u2026" : "Ready", on ? "working" : "success");
}

// -- Load metadata ----------------------------------------------------------

async function loadMeta() {
  try {
    const res = await fetch(`${API}/api/meta`);
    if (!res.ok) throw new Error("Failed to load metadata.");
    const meta = await res.json();

    els.sourceNote.textContent = meta.grounding_mode === "live"
      ? `Grounded in the live catalog. Last reviewed ${meta.source.last_reviewed}.`
      : "Using fallback source snapshot (live source unavailable).";

    const products = meta.products || [];
    products.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      els.product.appendChild(opt);
    });
  } catch (err) {
    els.sourceNote.textContent = `Source status unavailable: ${err.message}`;
    setStatus("Offline", "error");
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

// -- Generate ---------------------------------------------------------------

async function generate(event) {
  event.preventDefault();

  const product = els.product.value;
  const audience = els.audience.value.trim();
  const brief = els.brief.value.trim();
  const constraints = els.constraints.value.trim();

  if (!product || !audience || !brief) {
    setStatus("Fill all required fields", "error");
    return;
  }

  setLoading(true);
  els.resultSection.classList.remove("hidden");
  els.rawOutput.textContent = "Generating\u2026";
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
      body: JSON.stringify({
        asset_type: selectedFormat,
        product: product,
        audience: audience,
        objective: brief,
        extra_constraints: constraints,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(formatError(payload.detail));

    lastResult = payload;
    els.rawOutput.textContent = payload.output;

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

  setLoading(true);

  try {
    const res = await fetch(`${API}/api/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          asset_type: selectedFormat,
          product: els.product.value,
          audience: els.audience.value.trim(),
          objective: els.brief.value.trim(),
          extra_constraints: els.constraints.value.trim(),
        },
        current_output: lastResult.output,
        rating: rating,
        notes: notes,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(formatError(payload.detail));

    lastResult = payload;
    els.rawOutput.textContent = payload.output;

    if (payload.rendered_html) {
      renderPreview(payload.rendered_html);
    } else {
      renderPreview(null);
    }

    renderQuality(payload.quality_report);

    setStatus(`Improved in ${(payload.duration_ms / 1000).toFixed(1)}s`, "success");
  } catch (err) {
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

loadMeta();
