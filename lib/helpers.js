// Funções auxiliares usadas nas views (registradas em res.locals)

const fs = require('fs');
const path = require('path');

// Se existir um .webp irmão de uma imagem local, devolve o caminho dele.
// Serve para entregar webp (bem mais leve) com o jpg/png como reserva.
const cacheWebp = new Map();
function webpDe(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/img/')) return null;
  if (cacheWebp.has(url)) return cacheWebp.get(url);
  const limpo = url.split('?')[0];
  const alvo = limpo.replace(/\.(jpe?g|png)$/i, '.webp');
  let out = null;
  if (alvo !== limpo) {
    try { fs.accessSync(path.join(__dirname, '..', 'public', alvo)); out = alvo; } catch (e) { out = null; }
  }
  cacheWebp.set(url, out);
  return out;
}

// background-image que usa webp quando o navegador aceita, sem quebrar em quem não aceita
function bgImagem(url) {
  const w = webpDe(url);
  return w ? `image-set(url("${w}") type("image/webp"), url("${url}") type("image/jpeg"))` : `url("${url}")`;
}

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

// Título que aparece no Google. O nome do empreendimento sozinho não é
// pesquisado por ninguém: quem procura digita "apartamento 3 suítes no
// bairro X". O título precisa conter isso, em até ~60 caracteres.
function tituloBusca(e) {
  if (e.seo_titulo) return e.seo_titulo;
  const local = [e.bairro, e.cidade].filter(Boolean).join(', ');
  const tipo = e.dormitorios ? `Apartamentos ${e.dormitorios}` : 'Apartamentos';
  let t = [e.nome, local ? `${tipo} no ${local}` : tipo].filter(Boolean).join(' — ');
  if (t.length > 62 && e.bairro) t = `${e.nome} — ${tipo} no ${e.bairro}`;
  if (t.length > 62) t = `${e.nome} — ${tipo}`;
  return t;
}

// Linha de apoio abaixo do H1: visível para quem lê, e é o texto que
// descreve o produto para quem busca.
function subtituloBusca(e) {
  const partes = [];
  if (e.dormitorios) partes.push(`Apartamentos de ${e.dormitorios}`);
  if (e.area) partes.push(`${e.area} m²`);
  // Só o bairro: a cidade já aparece na linha do endereço logo abaixo.
  let s = partes.join(', ');
  if (e.bairro) s += `${s ? ', à venda no ' : 'À venda no '}${e.bairro}`;
  else if (e.cidade) s += `${s ? ', à venda em ' : 'À venda em '}${e.cidade}`;
  return s || '';
}

// Alt de imagem que serve à busca por imagens sem virar spam
function altFoto(tag, e) {
  const base = String(tag || '').trim();
  const local = [e.bairro, e.cidade].filter(Boolean).join(', ');
  if (!base) return [e.nome, local].filter(Boolean).join(' — ');
  return `${base} — ${e.nome}${local ? ', ' + local : ''}`;
}

// Dormitórios vêm como texto livre ("2 a 4", "2 e 3", "3 suítes").
// Vira a lista de números que o filtro da vitrine entende: "2 a 4" -> [2,3,4].
function dormsLista(txt) {
  const s = String(txt || '').toLowerCase();
  const nums = (s.match(/\d+/g) || []).map(Number).filter(n => n > 0 && n < 10);
  if (!nums.length) return [];
  if (nums.length === 2 && /\d\s*(a|até|-|–)\s*\d/.test(s)) {
    const out = [];
    for (let i = Math.min(...nums); i <= Math.max(...nums); i++) out.push(i);
    return out;
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

// Linha de tipologia do card: "2 a 4 dorm. · 78 a 164 m² · 2 vagas"
function linhaTipologia(e) {
  const p = [];
  if (e.dormitorios) p.push(`${e.dormitorios} dorm.`);
  if (e.area) p.push(`${e.area} m²`);
  if (e.vagas) p.push(`${e.vagas} ${String(e.vagas).trim() === '1' ? 'vaga' : 'vagas'}`);
  return p.join(' · ');
}

// Escapa texto para montar HTML à mão dentro de uma view
function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { esc, dormsLista, linhaTipologia, slugify, fmtPreco, onlyDigits, waLink, shade, asArray, webpDe, bgImagem, tituloBusca, subtituloBusca, altFoto };
