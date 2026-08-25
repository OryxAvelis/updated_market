/** Apply the saved admin color theme before styles render. */
(() => {
  'use strict';

  let theme = 'light';
  try {
    if (localStorage.getItem('am_theme') === 'dark') theme = 'dark';
  } catch {
    // Storage can be unavailable in privacy-restricted contexts; light is safe.
  }

  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
})();
