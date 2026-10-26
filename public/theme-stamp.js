/* Pre-paint theme stamp: reads the same key src/core/theme.ts owns.
   Must run before first paint or light-mode users get a black flash.
   A file rather than an inline <script>, so the Content-Security-Policy
   in index.html can be a plain script-src 'self' with no hash to keep in step. */
try {
  if (localStorage.getItem('atlas_theme') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
} catch (e) { /* private mode: dark default */ }
