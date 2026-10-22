// Leitura de planilhas exportadas de CRM (lista de contatos do SDR):
// CSV (vírgula, ponto e vírgula ou tab) e Excel .xlsx, sem dependências.
// Devolve linhas como arrays de texto; a primeira costuma ser o cabeçalho.
const zlib = require('zlib');

// ---- CSV ----
function lerCsv(texto) {
  const t = String(texto || '').replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] || '';
  const conta = (c) => primeira.split(c).length;
  const sep = [';', '\t', ','].sort((a, b) => conta(b) - conta(a))[0];
  const linhas = [];
  let linha = [], campo = '', aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter(l => l.some(v => String(v).trim()));
}

// ---- XLSX (zip com XML dentro) ----
function arquivosDoZip(buf) {
  // Diretório central: lido a partir do registro de fim (assinatura 0x06054b50).
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('arquivo .xlsx inválido');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const lNome = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + lNome).toString('utf8');
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    arquivos[nome] = () => {
      const dados = buf.slice(ini, ini + tamanho);
      return (metodo === 8 ? zlib.inflateRawSync(dados) : dados).toString('utf8');
    };
    p += 46 + lNome + lExtra + lComent;
  }
  return arquivos;
}

const entidades = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

function textoDe(xml) {
  return entidades((xml.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
}

function colunaIdx(ref) {
  const letras = String(ref).replace(/\d+/g, '');
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function lerXlsx(buf) {
  const z = arquivosDoZip(buf);
  const compartilhadas = z['xl/sharedStrings.xml']
    ? (z['xl/sharedStrings.xml']().match(/<si>[\s\S]*?<\/si>/g) || []).map(textoDe)
    : [];
  const nomePlanilha = Object.keys(z).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!nomePlanilha) throw new Error('planilha vazia');
  const xml = z[nomePlanilha]();
  const linhas = [];
  for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const linha = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = (c.match(/ r="([A-Z]+\d+)"/) || [])[1];
      const tipo = (c.match(/ t="(\w+)"/) || [])[1];
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (tipo === 's') val = compartilhadas[Number(v)] || '';
      else if (tipo === 'inlineStr') val = textoDe(c);
      else if (v != null) val = entidades(v);
      // Telefone salvo como número grande vira "5.1981E+10" no Excel: refaz os dígitos.
      if (!tipo && /e\+/i.test(val)) val = String(Math.round(Number(val)));
      linha[ref ? colunaIdx(ref) : linha.length] = val;
    }
    for (let i = 0; i < linha.length; i++) if (linha[i] == null) linha[i] = '';
    if (linha.some(v => String(v).trim())) linhas.push(linha);
  }
  return linhas;
}

function lerArquivo(buf, nome) {
  if (/\.xlsx$/i.test(nome || '') || (buf[0] === 0x50 && buf[1] === 0x4b)) return lerXlsx(buf);
  if (/\.xls$/i.test(nome || '')) throw new Error('Formato .xls antigo: salve como .xlsx ou .csv no Excel e envie de novo.');
  let txt = buf.toString('utf8');
  if (txt.includes('�')) txt = buf.toString('latin1');   // CSV salvo pelo Excel em Windows-1252
  return lerCsv(txt);
}

// ---- Colunas: descobre nome, telefone(s), e-mail pelo cabeçalho ----
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function mapearColunas(cab) {
  const h = cab.map(sem);
  const achar = (re, excluir) => h.findIndex((c, i) => re.test(c) && !(excluir || []).includes(i));
  const nome = achar(/^(nome|cliente|proprietario|contato|razao social|nome completo)/);
  const tel = [];
  h.forEach((c, i) => { if (/(fone|celular|whats|telefone|tel\b|contato 1|contato 2)/.test(c) && i !== nome) tel.push(i); });
  const email = achar(/e-?mail/);
  return { nome, tel, email };
}

module.exports = { lerCsv, lerXlsx, lerArquivo, mapearColunas };
