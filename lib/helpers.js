// Funções auxiliares usadas nas views (registradas em res.locals)

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Formata número inteiro (em reais) como "R$ 890.000"
function fmtPreco(n) {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return 'R$ ' + num.toLocaleString('pt-BR');
}

// Só os dígitos de um telefone, com DDI 55 na frente
function onlyDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d && !d.startsWith('55')) d = '55' + d;
  return d;
}

// Monta um link wa.me com mensagem pré-preenchida
function waLink(phone, text) {
  const d = onlyDigits(phone);
  const t = encodeURIComponent(text || '');
  return `https://wa.me/${d}${t ? '?text=' + t : ''}`;
}

// Clareia/escurece uma cor hex por um valor (-255..255)
function shade(hex, amt) {
  if (!hex) return hex;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0xff) + amt;
  let b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Garante que um valor jsonb virou array (o pg pode devolver string ou objeto)
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; }
    catch { return []; }
  }
  return [];
}

module.exports = { slugify, fmtPreco, onlyDigits, waLink, shade, asArray };
