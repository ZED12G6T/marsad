// Shared exhibit chrome: header, control panel, live readouts, reading drawer, loader.

export const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
};

export function createShell(cfg) {
  const { title, scale, info, hint, controls = [], readouts = [], onChange = () => {} } = cfg;
  const values = {};
  const items = new Map();
  const listeners = [];
  document.body.classList.add('exhibit');

  // Loader
  const loaderText = el('p', {}, cfg.loading || 'نجهّز المشهد…');
  const loader = el('div', { class: 'loader', role: 'status' },
    el('div', {}, el('div', { class: 'loader-ring' }), loaderText));

  // Header
  const infoBtn = el('button', { class: 'chip', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ex-info' }, 'عن هذه التجربة');
  const fsBtn = el('button', { class: 'chip', type: 'button' }, 'ملء الشاشة');
  const head = el('header', { class: 'ex-head' },
    el('a', { class: 'ex-back', href: '../../' }, 'المرصد'),
    el('h1', { class: 'ex-title' }, title),
    scale ? el('div', { class: 'ex-scale', html: scale }) : null,
    el('div', { class: 'ex-actions' }, infoBtn, document.fullscreenEnabled ? fsBtn : null));

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? 'خروج من ملء الشاشة' : 'ملء الشاشة';
  });

  // Panel
  const body = el('div', { class: 'panel-body', id: 'ex-panel-body' });
  const toggle = el('button', { class: 'panel-toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'ex-panel-body' }, 'التحكم');
  const panel = el('aside', { class: 'panel', 'aria-label': 'لوحة التحكم' }, toggle, body);
  const setCollapsed = (c) => { panel.classList.toggle('collapsed', c); toggle.setAttribute('aria-expanded', String(!c)); };
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
  if (matchMedia('(max-width: 760px)').matches) setCollapsed(true);

  const changed = (key) => {
    refresh();
    onChange(key, values[key], values);
    listeners.forEach((fn) => fn(key, values[key], values));
  };

  function build(def) {
    const item = { def, wrap: null, set: () => {}, render: null };
    const key = def.key;
    switch (def.type) {
      case 'group':
        item.wrap = el('div', { class: 'ctl-group' }, def.label);
        break;
      case 'note':
        item.wrap = el('p', { class: 'ctl-note', html: def.html });
        break;
      case 'range': {
        values[key] = def.value;
        const fmt = def.format || ((v) => String(v));
        const out = el('span', { class: 'ctl-val' });
        const input = el('input', { type: 'range', min: def.min, max: def.max, step: def.step ?? 'any', 'aria-label': def.label });
        input.value = def.value;
        const paint = () => {
          const v = +input.value;
          out.textContent = fmt(v);
          input.style.setProperty('--fill', ((v - def.min) / (def.max - def.min)) * 100 + '%');
        };
        input.addEventListener('input', () => { values[key] = +input.value; paint(); changed(key); });
        paint();
        item.wrap = el('div', { class: 'ctl' }, el('div', { class: 'ctl-row' }, el('span', {}, def.label), out), input);
        item.set = (v) => { input.value = v; values[key] = +input.value; paint(); };
        break;
      }
      case 'toggle': {
        values[key] = !!def.value;
        const input = el('input', { type: 'checkbox', role: 'switch' });
        input.checked = !!def.value;
        input.addEventListener('change', () => { values[key] = input.checked; changed(key); });
        item.wrap = el('label', { class: 'ctl ctl-toggle' }, el('span', {}, def.label), input, el('span', { class: 'switch', 'aria-hidden': 'true' }));
        item.set = (v) => { input.checked = !!v; values[key] = !!v; };
        break;
      }
      case 'segmented': {
        values[key] = def.value;
        const row = el('div', { class: 'seg', role: 'group', 'aria-label': def.label || '' });
        item.render = () => {
          const opts = typeof def.options === 'function' ? def.options(values) : def.options;
          row.replaceChildren(...opts.map((o) => {
            const b = el('button', { type: 'button', 'aria-pressed': String(o.value === values[key]), disabled: !!o.disabled, title: o.title }, o.label);
            b.addEventListener('click', () => { if (values[key] === o.value) return; values[key] = o.value; changed(key); });
            return b;
          }));
        };
        item.render();
        item.wrap = el('div', { class: 'ctl' }, def.label ? el('div', { class: 'ctl-row' }, el('span', {}, def.label)) : null, row);
        item.set = (v) => { values[key] = v; };
        break;
      }
      case 'buttons': {
        item.wrap = el('div', { class: 'ctl btn-row' }, def.items.map((it) => {
          const b = el('button', { class: 'btn' + (it.primary ? ' primary' : ''), type: 'button' }, it.label);
          b.addEventListener('click', () => it.action(api));
          return b;
        }));
        break;
      }
      default:
        throw new Error('unknown control ' + def.type);
    }
    return item;
  }

  controls.forEach((def, i) => {
    const item = build(def);
    items.set(def.key || '__' + i, item);
    body.append(item.wrap);
  });

  function refresh() {
    for (const item of items.values()) {
      if (item.render) item.render();
      if (item.def.when) item.wrap.hidden = !item.def.when(values);
    }
  }
  refresh();

  // Readouts
  const roVals = {};
  const roWrap = el('div', { class: 'readouts' }, readouts.map((r) => {
    roVals[r.key] = el('span', { class: 'ro-val' }, '–');
    return el('div', { class: 'ro' }, el('span', { class: 'ro-label' }, r.label), roVals[r.key]);
  }));

  // Reading drawer
  const closeBtn = el('button', { class: 'chip info-close', type: 'button' }, 'إغلاق');
  const drawer = el('section', { class: 'info', id: 'ex-info', 'aria-label': 'عن هذه التجربة', tabindex: '-1' }, closeBtn, el('div', { html: info || '' }));
  const setInfo = (open) => {
    drawer.classList.toggle('open', open);
    infoBtn.setAttribute('aria-expanded', String(open));
    if (open) drawer.focus(); else infoBtn.focus({ preventScroll: true });
  };
  infoBtn.addEventListener('click', () => setInfo(!drawer.classList.contains('open')));
  closeBtn.addEventListener('click', () => setInfo(false));

  // Hint
  const hintEl = hint ? el('div', { class: 'hint' }, hint) : null;
  const dismissHint = () => hintEl && hintEl.classList.add('gone');
  setTimeout(dismissHint, 9000);

  document.body.append(head, panel, roWrap, drawer, ...(hintEl ? [hintEl] : []), loader);
  document.getElementById('stage')?.addEventListener('pointerdown', dismissHint, { once: true });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape' && drawer.classList.contains('open')) setInfo(false);
    if ((e.key === 'h' || e.key === 'H' || e.key === 'ا') && !e.ctrlKey && !e.metaKey) {
      document.body.classList.toggle('ui-hidden');
    }
  });

  const api = {
    values,
    set(key, v, { silent = false } = {}) {
      const item = items.get(key);
      if (!item) return;
      item.set(v);
      values[key] = item.def.type === 'range' ? +v : v;
      refresh();
      if (!silent) changed(key);
    },
    readout(key, text) {
      const n = roVals[key];
      if (n && n.textContent !== text) n.textContent = text;
    },
    readoutEl(key) { return roVals[key]; },
    on(fn) { listeners.push(fn); },
    refresh,
    loading(text) { loaderText.textContent = text; },
    ready() { loader.classList.add('done'); },
    fail(html) {
      loader.classList.add('error');
      loaderText.innerHTML = html;
    },
  };
  return api;
}

// Wraps a left-to-right fragment (numbers with units, formulas) so it keeps its order inside Arabic text.
export const ltr = (s) => '⁦' + s + '⁩';

export const WEBGL_FAIL = 'هذه التجربة تحتاج متصفحاً يدعم <bdi>WebGL2</bdi>. جرّب آخر إصدار من كروم أو إيدج أو فايرفوكس على كمبيوتر. <br><a href="../../">ارجع للمرصد</a>';
