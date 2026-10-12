// ============================================================================
// TAZAWWUD — shared HTML-escaping utility
// ----------------------------------------------------------------------------
// Every module that interpolates text (API content, search input, etc.) into
// innerHTML must escape it first. Centralized here so every file uses the
// same, single-source-of-truth implementation instead of each file quietly
// re-defining its own copy (or, worse, forgetting to).
// ============================================================================

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}
