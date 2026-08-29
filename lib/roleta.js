// Roleta de leads: decide para qual corretor vai cada clique no WhatsApp.
//
// Regras (nesta ordem):
//   1. Robô/pré-visualizador  → não consome vez na fila (vai pro número geral).
//   2. Visitante já atendido  → volta SEMPRE pro mesmo corretor (cookie + IP).
//   3. Visitante novo         → próximo da fila (menor carga = atribuições ÷ peso).
//
// O número do corretor nunca aparece no HTML da landing: ele só existe no
// banco e no cabeçalho Location do redirect.

const crypto = require('crypto');
const db = require('./db');

// Quanto tempo o mesmo visitante continua com o corretor que já recebeu ele.
// Dentro dessa janela, clicar em vários botões é UM lead só. Passando dela,
// o visitante que volta é sinal de que ninguém retornou: ele é resgatado por
// outro corretor, e o primeiro fica marcado como "não retornado".
const JANELA_RESGATE_H = 24;
const JANELA_DIAS = 30;   // validade do cookie

const COOKIE_CORRETOR = 'ap_crt';  // ap_crt_<empId> = id do corretor
const COOKIE_VISITANTE = 'ap_vid'; // id anônimo do visitante

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|linkedin|embedly|quora|pinterest|preview|monitor|uptime|pingdom|lighthouse|headless|curl|wget|python-requests|axios|go-http|java\//i;

function isBot(ua) {
  const s = String(ua || '').trim();
  return !s || BOT_RE.test(s);
}

function ipDoRequest(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || '';
}

// Guardamos só o hash do IP (LGPD): serve para deduplicar, não identifica ninguém.
function hashIp(ip) {
  return crypto.createHash('sha256')
    .update(String(ip) + '|' + (process.env.SESSION_SECRET || 'roleta'))
    .digest('hex').slice(0, 32);
}

function lerCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    try { out[k] = decodeURIComponent(parte.slice(i + 1).trim()); }
    catch { out[k] = parte.slice(i + 1).trim(); }
  }
  return out;
}

function setCookie(res, nome, valor, dias) {
  res.cookie(nome, valor, {
    maxAge: dias * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

// Só dígitos + DDI, igual ao helper das views.
function digitos(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d && !d.startsWith('55')) d = '55' + d;
  return d;
}

/**
 * Decide o destino de um clique e registra tudo.
 * Retorna { telefone, corretor, novoLead, bot, motivo }.
 */
async function distribuir(req, res, emp, origem) {
  const ua = req.headers['user-agent'] || '';
  const ck = lerCookies(req);
  const ipHash = hashIp(ipDoRequest(req));
  const bot = isBot(ua);

  let visitante = ck[COOKIE_VISITANTE];
  if (!visitante) {
    visitante = crypto.randomBytes(9).toString('hex');
    if (!bot) setCookie(res, COOKIE_VISITANTE, visitante, 365);
  }

  const chaveCorretor = `${COOKIE_CORRETOR}_${emp.id}`;
  const ativos = await db.listCorretores(emp.id, { ativosOnly: true });

  let corretor = null;
  let novoLead = false;
  let resgate = false;
  let anterior = null;
  let motivo = '';

  if (!ativos.length) {
    // Nenhum corretor cadastrado: cai no WhatsApp reserva do empreendimento.
    motivo = 'sem-corretores';
  } else if (bot) {
    // Robô não pode gastar uma vez da fila nem virar lead de ninguém.
    corretor = ativos[0];
    motivo = 'bot';
  } else {
    const [idStr, tsStr] = String(ck[chaveCorretor] || '').split('.');
    let donoAtual = Number(idStr) || null;
    let desdeMs = tsStr ? Date.now() - Number(tsStr) * 1000 : null;

    // Sem cookie (navegador limpo, outro aparelho): tenta reconhecer pelo log.
    if (!donoAtual) {
      const ult = await db.ultimaAtribuicao(emp.id, visitante, ipHash);
      if (ult) {
        donoAtual = ult.corretor_id;
        desdeMs = Date.now() - new Date(ult.created_at).getTime();
      }
    }

    const aindaAtivo = donoAtual && ativos.find(c => c.id === donoAtual);
    const dentroDaJanela = desdeMs === null || desdeMs < JANELA_RESGATE_H * 3600 * 1000;

    if (aindaAtivo && dentroDaJanela) {
      // Mesma pessoa, mesma janela: continua com quem já a atendeu.
      corretor = aindaAtivo;
      motivo = 'mesmo-visitante';
    } else if (donoAtual && !dentroDaJanela && ativos.length > 1) {
      // Voltou depois de mais de 24h: provavelmente não teve retorno.
      corretor = await db.proximoCorretor(emp.id, donoAtual);
      resgate = !!corretor;
      anterior = donoAtual;
      motivo = 'resgate';
    } else if (aindaAtivo) {
      // Só existe um corretor ativo: não há para quem resgatar.
      corretor = aindaAtivo;
      motivo = 'mesmo-visitante';
    } else {
      corretor = await db.proximoCorretor(emp.id);
      novoLead = !!corretor;
      motivo = 'roleta';
    }

    if (corretor) {
      setCookie(res, chaveCorretor, `${corretor.id}.${Math.floor(Date.now() / 1000)}`, JANELA_DIAS);
    }
  }

  try {
    await db.registrarClique({
      empreendimento_id: emp.id,
      corretor_id: corretor ? corretor.id : null,
      origem,
      novo_lead: novoLead,
      bot,
      motivo,
      resgate,
      corretor_anterior: anterior,
      visitante,
      ip_hash: ipHash,
      user_agent: ua,
      referer: req.headers.referer || '',
      utm_source: req.query.utm_source || null,
      utm_medium: req.query.utm_medium || null,
      utm_campaign: req.query.utm_campaign || null,
    });
  } catch (e) {
    // Log de auditoria nunca pode derrubar o redirect do lead.
    console.error('[roleta] falha ao registrar clique:', e.message);
  }

  const telefone = digitos(corretor ? corretor.telefone : emp.whatsapp);
  return { telefone, corretor, novoLead, resgate, bot, motivo };
}

// Valida um WhatsApp brasileiro e devolve os dígitos normalizados (ou null).
// Um número digitado errado é a falha mais cara da roleta: os leads dele
// simplesmente somem, e ninguém percebe até alguém reclamar.
function validarWhats(tel) {
  const d = digitos(tel);
  if (d.length < 12 || d.length > 13) return null;   // 55 + DDD + 8 ou 9 dígitos
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  const numero = d.slice(4);
  if (/^(\d)\1+$/.test(numero)) return null;         // 99999-9999 e afins
  if (numero.length === 9 && numero[0] !== '9') return null;
  return d;
}

module.exports = {
  distribuir, digitos, validarWhats, isBot, hashIp, lerCookies,
  JANELA_DIAS, JANELA_RESGATE_H,
};
