/* omml.js — LaTeX -> MathML(Temml) -> OMML(Office Math) for DOCX export.
   Word 原生可编辑公式；不依赖字体、不依赖 XSL、不依赖 Math 组件签名。 */
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋀', '⋁', '⨁', '⨂', '⨀']);
const ACCENTS = new Set(['ˆ', 'ˇ', '¯', '‾', '→', '←', '↔', '~', '˙', '¨', '⃗', '̂', '̅']);
// Word OMML expects combining characters for accents (MML2OMML convention).
const ACCENT_MAP = {
  'ˆ': '\u0302', 'ˇ': '\u030C', '¯': '\u00AF', '‾': '\u00AF',
  '~': '\u0303', '˙': '\u0307', '¨': '\u0308', '→': '\u20D7',
  '⃗': '\u20D7', '̂': '\u0302', '̅': '\u0305', '←': '\u20D6'
};
const INTEGRALS = new Set(['∫', '∬', '∭', '∮']);
const LIMIT_WORDS = new Set(['lim', 'max', 'min', 'sup', 'inf', 'arg', 'det', 'gcd']);

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u2060-\u2064\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function run(text, normal) {
  const value = cleanText(text);
  if (!value) return '';
  const props = normal ? '<m:rPr><m:nor/></m:rPr>' : '';
  return '<m:r>' + props + '<m:t xml:space="preserve">' + esc(value) + '</m:t></m:r>';
}

function kids(el) {
  const out = [];
  if (!el || !el.childNodes) return out;
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n && n.nodeType === 1) out.push(n);
  }
  return out;
}

function one(el) {
  return el ? convNode(el) : '';
}

function textOf(el) {
  return el ? cleanText(el.textContent) : '';
}

function isFence(el, form) {
  return !!el && el.localName === 'mo' && el.getAttribute('fence') === 'true' &&
    (!form || el.getAttribute('form') === form);
}

function delim(begin, end, inner) {
  return '<m:d><m:dPr>' +
    '<m:begChr m:val="' + esc(cleanText(begin) || '(') + '"/>' +
    '<m:endChr m:val="' + esc(cleanText(end) || ')') + '"/>' +
    '<m:grow m:val="1"/>' +
    '</m:dPr><m:e>' + inner + '</m:e></m:d>';
}

function nary(chr, sub, sup, body) {
  const location = INTEGRALS.has(chr) ? 'subSup' : 'undOvr';
  return '<m:nary><m:naryPr>' +
    '<m:chr m:val="' + esc(chr) + '"/>' +
    '<m:limLoc m:val="' + location + '"/>' +
    '</m:naryPr><m:sub>' + sub + '</m:sub><m:sup>' + sup + '</m:sup>' +
    '<m:e>' + body + '</m:e></m:nary>';
}

function accent(chr, base) {
  const mapped = ACCENT_MAP[chr] || chr;
  return '<m:acc><m:accPr><m:chr m:val="' + esc(mapped) + '"/></m:accPr>' +
    '<m:e>' + base + '</m:e></m:acc>';
}

function convNodes(list) {
  const items = [];
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n && n.nodeType === 1) items.push(n);
    }
  }
  // Temml emits fence <mo> as siblings around a matrix / \left...\right body.
  if (items.length >= 2 && isFence(items[0], 'prefix') && isFence(items[items.length - 1], 'postfix')) {
    return delim(textOf(items[0]), textOf(items[items.length - 1]), convNodes(items.slice(1, -1)));
  }
  return items.map(convNode).join('');
}

function convNode(el) {
  if (!el || el.nodeType !== 1) return '';
  const name = el.localName || el.nodeName;
  const c = kids(el);
  switch (name) {
    case 'mi':
    case 'mn':
    case 'mo':
    case 'ms': {
      const value = textOf(el);
      if (!value) return '';
      // Multi-letter identifiers are function names (sin, lim, ...): upright text.
      const normal = name === 'ms' || (name === 'mi' && /^[A-Za-z]{2,}$/.test(value));
      return run(value, normal);
    }
    case 'mtext':
      return run(el.textContent, true);
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'mphantom':
    case 'merror':
    case 'semantics':
    case 'annotation-xml':
    case 'math':
      return convNodes(c);
    case 'mspace':
    case 'annotation':
      return '';
    case 'mfrac':
      return '<m:f><m:num>' + one(c[0]) + '</m:num><m:den>' + one(c[1]) + '</m:den></m:f>';
    case 'msqrt':
      return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>' +
        '<m:e>' + convNodes(c) + '</m:e></m:rad>';
    case 'mroot':
      return '<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr>' +
        '<m:deg>' + one(c[1]) + '</m:deg><m:e>' + one(c[0]) + '</m:e></m:rad>';
    case 'msup':
      return '<m:sSup><m:e>' + one(c[0]) + '</m:e><m:sup>' + one(c[1]) + '</m:sup></m:sSup>';
    case 'msub': {
      const base = textOf(c[0]);
      if (LIMIT_WORDS.has(base)) {
        return '<m:limLow><m:e>' + run(base, true) + '</m:e><m:lim>' + one(c[1]) + '</m:lim></m:limLow>';
      }
      return '<m:sSub><m:e>' + one(c[0]) + '</m:e><m:sub>' + one(c[1]) + '</m:sub></m:sSub>';
    }
    case 'msubsup': {
      const chr = textOf(c[0]);
      if (NARY.has(chr)) return nary(chr, one(c[1]), one(c[2]), '');
      return '<m:sSubSup><m:e>' + one(c[0]) + '</m:e><m:sub>' + one(c[1]) +
        '</m:sub><m:sup>' + one(c[2]) + '</m:sup></m:sSubSup>';
    }
    case 'munder': {
      const chr = textOf(c[0]);
      if (NARY.has(chr)) return nary(chr, one(c[1]), '', '');
      return '<m:limLow><m:e>' + one(c[0]) + '</m:e><m:lim>' + one(c[1]) + '</m:lim></m:limLow>';
    }
    case 'mover': {
      const chr = textOf(c[0]);
      const over = textOf(c[1]);
      if (NARY.has(chr)) return nary(chr, '', one(c[1]), '');
      if (ACCENTS.has(over)) return accent(over, one(c[0]));
      return '<m:limUpp><m:e>' + one(c[0]) + '</m:e><m:lim>' + one(c[1]) + '</m:lim></m:limUpp>';
    }
    case 'munderover': {
      const chr = textOf(c[0]);
      if (NARY.has(chr)) return nary(chr, one(c[1]), one(c[2]), '');
      return '<m:limUpp><m:e><m:limLow><m:e>' + one(c[0]) + '</m:e><m:lim>' +
        one(c[1]) + '</m:lim></m:limLow></m:e><m:lim>' + one(c[2]) + '</m:lim></m:limUpp>';
    }
    case 'menclose': {
      const notation = el.getAttribute('notation') || '';
      const inner = convNodes(c);
      if (notation.indexOf('top') >= 0) return accent('¯', inner);
      return inner;
    }
    case 'mtable': {
      const rows = c.filter(n => (n.localName || n.nodeName) === 'mtr');
      const body = rows.map(tr => {
        const cells = kids(tr).filter(td => (td.localName || td.nodeName) === 'mtd');
        return '<m:mr>' + cells.map(td => '<m:e>' + convNodes(kids(td)) + '</m:e>').join('') + '</m:mr>';
      }).join('');
      return '<m:m><m:mPr><m:baseJc m:val="center"/></m:mPr>' + body + '</m:m>';
    }
    case 'maction':
      return one(c[0]);
    default:
      if (c.length) return convNodes(c);
      return run(el.textContent, true);
  }
}

/* Convert a LaTeX expression to a standalone <m:oMath> XML string.
   Returns null when Temml fails or MathML cannot be parsed (caller degrades to source text). */
export function texToOmml(tex) {
  const fn = globalThis.temml && globalThis.temml.renderToString;
  if (typeof fn !== 'function') return null;
  let mathml;
  try {
    mathml = fn.call(globalThis.temml, String(tex == null ? '' : tex), { displayMode: false });
  } catch (e) { return null; }
  if (!mathml || mathml.indexOf('<math') !== 0) return null; // Temml error <span>
  let doc;
  try { doc = new DOMParser().parseFromString(mathml, 'application/xml'); } catch (e) { return null; }
  if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return null;
  if ((doc.documentElement.localName || doc.documentElement.nodeName) !== 'math') return null;
  let inner;
  try { inner = convNodes(kids(doc.documentElement)); } catch (e) { return null; }
  if (!inner) return null;
  return '<m:oMath xmlns:m="' + M_NS + '">' + inner + '</m:oMath>';
}

function looksLikeMath(tex, display) {
  if (!tex || /^\s|\s$/.test(tex)) return false;
  if (display) return true;
  if (/^\d[\d,.]*$/.test(tex)) return false;              // $5$ / $1,000$ are money
  if (/[\\^_{}=+\-*/()<>\[\]|%]/.test(tex)) return true; // typical LaTeX / math
  return /^[A-Za-z\u0370-\u03FF]{1,8}$/.test(tex);       // $x$ / $sigma$
}

/* Split a Marked plain-text token into text and math segments. */
export function splitMathSegments(text) {
  const source = String(text == null ? '' : text);
  const out = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0, m;
  while ((m = re.exec(source)) !== null) {
    const display = m[1] !== undefined;
    const tex = String(display ? m[1] : m[2]).trim();
    if (!looksLikeMath(tex, display)) continue;
    if (m.index > last) out.push({ type: 'text', value: source.slice(last, m.index) });
    out.push({ type: 'math', tex, display, raw: m[0] });
    last = re.lastIndex;
  }
  if (last < source.length) out.push({ type: 'text', value: source.slice(last) });
  return out.length ? out : [{ type: 'text', value: source }];
}

/* Detect a paragraph consisting solely of a $$...$$ display formula. */
export function standaloneMath(text) {
  const m = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(String(text == null ? '' : text));
  return m && m[1].trim() ? m[1].trim() : null;
}
