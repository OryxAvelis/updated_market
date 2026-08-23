(function applySavedThemeBeforePaint() {
  'use strict';
  let theme = 'light';
  try {
    theme = localStorage.getItem('am_theme') === 'dark' ? 'dark' : 'light';
  } catch {
    // Storage can be unavailable in privacy modes; the light theme is safe.
  }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
})();
