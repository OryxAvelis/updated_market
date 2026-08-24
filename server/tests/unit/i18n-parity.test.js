import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const customerPages = [
  'index.html', 'all-categories.html', 'categories.html', 'product.html', 'cart.html', 'checkout.html',
  'wishlist.html', 'orders.html', 'login.html', 'settings.html', 'help.html', 'reset-password.html'
];
const customerScripts = [
  'core.js', 'home.js', 'all-categories.js', 'categories.js', 'product.js', 'cart.js', 'checkout.js',
  'wishlist.js', 'orders.js', 'login.js', 'settings.js', 'reset-password.js'
];

async function dictionaries() {
  const source = await readFile(path.join(projectRoot, 'js/i18n.js'), 'utf8');
  const context = {
    CustomEvent: class {},
    document: {
      addEventListener() {}, getElementById() { return null; }, querySelector() { return null; },
      querySelectorAll() { return []; }, documentElement: {}, body: null
    },
    localStorage: { getItem() { return 'en'; }, setItem() {} },
    window: { dispatchEvent() {} }
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.__I18N = I18N;`, context, { filename: 'js/i18n.js' });
  return context.__I18N;
}

describe('customer localization contract', () => {
  it('keeps English and French dictionaries in exact parity', async () => {
    const i18n = await dictionaries();
    expect(Object.keys(i18n.en).sort()).toEqual(Object.keys(i18n.fr).sort());
    expect(Object.keys(i18n.en).length).toBeGreaterThan(500);
  });

  it('defines every statically referenced customer translation key in both languages', async () => {
    const i18n = await dictionaries();
    const referenced = new Set();
    for (const page of customerPages) {
      const source = await readFile(path.join(projectRoot, page), 'utf8');
      for (const match of source.matchAll(/data-i18n(?:-html|-ph|-title|-aria)?=["']([^"']+)["']/g)) referenced.add(match[1]);
    }
    for (const script of customerScripts) {
      const source = await readFile(path.join(projectRoot, 'js', script), 'utf8');
      for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) referenced.add(match[1]);
    }
    const missing = [...referenced].filter(key => !(key in i18n.en) || !(key in i18n.fr)).sort();
    expect(missing).toEqual([]);
  });
});
