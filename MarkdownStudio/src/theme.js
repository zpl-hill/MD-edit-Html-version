/* theme.js — Light / Dark / 跟随系统。 */
import { getPref, setPref } from "./storage.js";

export function createThemeController(onChange) {
  let mode = getPref('theme', 'system');
  const query = (typeof matchMedia === 'function') ? matchMedia('(prefers-color-scheme: dark)') : null;

  function effective() {
    if (mode !== 'system') return mode;
    return query && query.matches ? 'dark' : 'light';
  }

  function apply() {
    const value = effective();
    document.documentElement.setAttribute('data-theme', value);
    if (onChange) onChange(value);
  }

  if (query && query.addEventListener) query.addEventListener('change', () => { if (mode === 'system') apply(); });
  apply();

  return {
    getMode: () => mode,
    effective,
    setMode(next) {
      mode = ['light', 'dark', 'system'].indexOf(next) >= 0 ? next : 'system';
      setPref('theme', mode);
      apply();
    },
    cycle() {
      const order = ['light', 'dark', 'system'];
      this.setMode(order[(order.indexOf(mode) + 1) % order.length]);
      return mode;
    }
  };
}
