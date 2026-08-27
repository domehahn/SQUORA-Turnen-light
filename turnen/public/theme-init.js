// Theme vor dem ersten Paint setzen, um ein kurzes Aufblitzen des falschen
// Farbschemas zu vermeiden (siehe src/lib/theme.ts). Als externe Datei statt
// Inline-<script> in index.html, damit die Content-Security-Policy
// (cloudflare/web-router.ts) ohne 'unsafe-inline' für script-src auskommt.
(function () {
  try {
    var stored = localStorage.getItem("turnen_theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch {}
})();
