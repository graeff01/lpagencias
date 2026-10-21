// Caixa de leads: lê os e-mails de lead e coloca na fila "A encaminhar" da
// recepção. Três formas de receber, todas no mesmo leitor da recepção:
//
//   gmail   — conta Google conectada pelo painel, acesso SÓ LEITURA
//             (precisa de GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).
//   imap    — usuário e senha de app (LEADS_IMAP_USER / LEADS_IMAP_PASS).
//   webhook — outro serviço (Cloudflare, Postmark…) faz POST em
//             /entrada/email com o token LEADS_WEBHOOK_TOKEN.
//
// Nada é apagado, movido ou marcado como lido na caixa: o sistema só lê.
// Cada e-mail é importado uma vez (message_id único).

const { simpleParser } = require('mailparser');
const db = require('./db');
const parser = require('../public/js/lead-parser');

const ROTULO = process.env.LEADS_ROTULO || 'Leads';           // marcador/pasta lida
const INTERVALO_S = Math.max(30, Number(process.env.LEADS_INTERVALO_S) || 90);
const JANELA_DIAS = 3;                                         // só olha e-mails recentes

const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ESCOPO_GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';

const IMAP = {
  host: process.env.LEADS_IMAP_HOST || 'imap.gmail.com',
  user: process.env.LEADS_IMAP_USER || '',
  pass: process.env.LEADS_IMAP_PASS || '',
};

// ---- Texto do e-mail ----
function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Mensagem encaminhada pelo Gmail traz um cabeçalho "Forwarded message" e
// assinaturas: o leitor ignora o que não é rótulo conhecido, então basta o texto.
function textoDe(m) {
  return (m.text && m.text.trim()) ? m.text : htmlParaTexto(m.html);
}

// Importa um e-mail (já decodificado). Devolve a entrada criada ou null.
async function importar({ fonte, chave, remetente, assunto, data, texto }) {
  if (!chave || await db.entradaExiste(chave)) return null;
  const desde = await desdeQuando();
  if (data && new Date(data) < desde) return null;
  const dados = parser.ler(texto);
  return db.criarEntrada({
    fonte, message_id: chave, remetente, assunto, recebido_em: data || new Date(),
    bruto: texto, dados,
  });
}

// Na primeira conexão, traz só o último dia: não despeja na fila o histórico antigo.
async function desdeQuando() {
  let v = await db.getConfig('caixa_desde');
  if (!v) {
    v = new Date(Date.now() - 864e5).toISOString();
    await db.setConfig('caixa_desde', v);
  }
  return new Date(v);
}

async function importarBruto(fonte, chave, raw) {
  const m = await simpleParser(raw);
  return importar({
    fonte, chave,
    remetente: m.from ? m.from.text : '',
    assunto: m.subject || '',
    data: m.date || new Date(),
    texto: textoDe(m),
  });
}

// ---- Gmail (só leitura) ----
function gmailDisponivel() { return !!(GOOGLE_ID && GOOGLE_SECRET); }

function urlAutorizacao(redirectUri, state) {
  const q = new URLSearchParams({
    client_id: GOOGLE_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: ESCOPO_GMAIL, access_type: 'offline', prompt: 'consent', state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

async function tokenGoogle(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, ...params }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google recusou: ' + (j.error_description || j.error || r.status));
  return j;
}

async function gmailGet(token, caminho) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + caminho, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Gmail: ' + ((j.error && j.error.message) || r.status));
  return j;
}

// Volta da tela de consentimento do Google: guarda o acesso (só leitura).
async function conectarGmail(code, redirectUri) {
  const t = await tokenGoogle({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('O Google não devolveu o acesso permanente. Desconecte o app na conta Google e tente de novo.');
  const perfil = await gmailGet(t.access_token, 'profile');
  await db.setConfig('gmail_refresh_token', t.refresh_token);
  await db.setConfig('gmail_email', perfil.emailAddress || '');
  await desdeQuando();
  return perfil.emailAddress;
}

async function desconectarGmail() {
  const rt = await db.getConfig('gmail_refresh_token');
  if (rt) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST' }).catch(() => {});
  await db.setConfig('gmail_refresh_token', null);
  await db.setConfig('gmail_email', null);
}

async function verificarGmail() {
  const rt = await db.getConfig('gmail_refresh_token');
  if (!rt || !gmailDisponivel()) return null;
  const { access_token } = await tokenGoogle({ refresh_token: rt, grant_type: 'refresh_token' });
  const rotulos = (await gmailGet(access_token, 'labels')).labels || [];
  const rot = rotulos.find(l => l.name.toLowerCase() === ROTULO.toLowerCase());
  if (!rot) throw new Error(`Marcador "${ROTULO}" não existe nessa conta do Gmail.`);
  const lista = await gmailGet(access_token, `messages?labelIds=${rot.id}&q=${encodeURIComponent('newer_than:' + JANELA_DIAS + 'd')}&maxResults=50`);
  let n = 0;
  for (const { id } of (lista.messages || []).reverse()) {
    const chave = 'gmail:' + id;
    if (await db.entradaExiste(chave)) continue;
    const msg = await gmailGet(access_token, `messages/${id}?format=raw`);
    if (await importarBruto('gmail', chave, Buffer.from(msg.raw, 'base64url'))) n++;
  }
  return n;
}

// ---- IMAP (senha de app) ----
function imapConfigurado() { return !!(IMAP.user && IMAP.pass); }

async function verificarImap() {
  if (!imapConfigurado()) return null;
  const { ImapFlow } = require('imapflow');
  const cli = new ImapFlow({ host: IMAP.host, port: 993, secure: true, auth: { user: IMAP.user, pass: IMAP.pass }, logger: false });
  await cli.connect();
  let n = 0;
  try {
    // readOnly: abre a pasta sem marcar nada como lido.
    const lock = await cli.getMailboxLock(ROTULO, { readOnly: true });
    try {
      const desde = new Date(Date.now() - JANELA_DIAS * 864e5);
      const uids = await cli.search({ since: desde }, { uid: true }) || [];
      for (const uid of uids) {
        const cab = await cli.fetchOne(uid, { envelope: true }, { uid: true });
        const chave = 'imap:' + ((cab && cab.envelope && cab.envelope.messageId) || uid);
        if (await db.entradaExiste(chave)) continue;
        const m = await cli.fetchOne(uid, { source: true }, { uid: true });
        if (m && m.source && await importarBruto('imap', chave, m.source)) n++;
      }
    } finally { lock.release(); }
  } finally {
    await cli.logout().catch(() => {});
  }
  return n;
}

// ---- Webhook (outro serviço entrega o e-mail) ----
function webhookConfigurado() { return !!process.env.LEADS_WEBHOOK_TOKEN; }

async function receberWebhook(b) {
  const chave = 'webhook:' + (b.message_id || b.messageId || b.MessageID ||
    require('crypto').createHash('sha256').update(String(b.subject || '') + (b.text || b.html || '')).digest('hex').slice(0, 32));
  if (b.raw) return importarBruto('webhook', chave, Buffer.from(String(b.raw), b.raw_base64 ? 'base64' : 'utf8'));
  return importar({
    fonte: 'webhook', chave,
    remetente: String(b.from || b.From || ''), assunto: String(b.subject || b.Subject || ''),
    data: b.date ? new Date(b.date) : new Date(),
    texto: b.text || b.TextBody || htmlParaTexto(b.html || b.HtmlBody || ''),
  });
}

// ---- Verificação periódica ----
let rodando = false;

async function verificar() {
  if (rodando) return { pulado: true };
  rodando = true;
  const resultado = { importados: 0, fontes: [] };
  try {
    for (const [nome, fn] of [['gmail', verificarGmail], ['imap', verificarImap]]) {
      try {
        const n = await fn();
        if (n === null) continue;
        resultado.fontes.push(nome);
        resultado.importados += n;
      } catch (e) {
        resultado.erro = `${nome}: ${e.message}`;
        console.error('[caixa-leads]', resultado.erro);
      }
    }
    if (resultado.fontes.length || resultado.erro) {
      await db.setConfig('caixa_ultima_verificacao', new Date().toISOString());
      await db.setConfig('caixa_ultimo_erro', resultado.erro || null);
    }
    if (resultado.importados) console.log(`[caixa-leads] ${resultado.importados} lead(s) novo(s) na fila`);
  } finally {
    rodando = false;
  }
  return resultado;
}

async function status() {
  return {
    rotulo: ROTULO,
    intervalo: INTERVALO_S,
    gmailDisponivel: gmailDisponivel(),
    gmailEmail: await db.getConfig('gmail_email'),
    imap: imapConfigurado() ? IMAP.user : null,
    webhook: webhookConfigurado(),
    ultima: await db.getConfig('caixa_ultima_verificacao'),
    erro: await db.getConfig('caixa_ultimo_erro'),
  };
}

function iniciar() {
  const tick = () => verificar().catch(e => console.error('[caixa-leads]', e.message));
  setTimeout(tick, 15 * 1000);
  setInterval(tick, INTERVALO_S * 1000).unref();
}

module.exports = {
  verificar, iniciar, status, receberWebhook, importar,
  gmailDisponivel, urlAutorizacao, conectarGmail, desconectarGmail,
  htmlParaTexto,
};
