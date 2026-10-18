// Applies the saved/preferred theme BEFORE first paint — avoids a flash of
// the wrong theme. Loaded as a plain, non-deferred, non-module <script src>
// in <head> (see index.html) so it runs synchronously before rendering
// continues, exactly like the inline script it replaces — this file only
// exists as its own file so it can be allowed by a strict CSP script-src
// without needing 'unsafe-inline'.
(function () {
  var saved = localStorage.getItem("tazawwud:theme");
  var theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();
