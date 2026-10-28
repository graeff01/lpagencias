// Rotas públicas sem login:
//   /ok/:token       — o corretor confirma que recebeu o lead (link na mensagem).
//   /meus/:token     — leads do corretor e o andamento de cada um (link pessoal).
//   /corretor        — o corretor se cadastra (nome, CRECI, WhatsApp) e recebe os links com a tag dele.
//   /entrada/email   — webhook de e-mail de lead (quando a caixa é recebida por
//                      um serviço externo em vez de lida pelo sistema).
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../lib/db');
const caixa = require('../lib/caixa-leads');
const { isBot, validarWhats } = require('../lib/roleta');
const { imgVar } = require('../lib/helpers');
const { RETORNOS } = require('../lib/equipes');

function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

// A pré-visualização do WhatsApp abre o link sozinha: abrir a página não
// confirma nada. Só o botão (POST) confirma.
router.get('/ok/:token', async (req, res, next) => {
  try {
    const e = await db.envioPorToken(req.params.token);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    if (!e) return res.status(404).render('ok', { title: 'Link inválido', e: null, feito: false });
    // Abertura por pessoa (não pela prévia automática do WhatsApp), uma vez só.
    if (!e.confirmado_em && !isBot(req.headers['user-agent'])) {
      const ja = (await db.eventosDoLead({ encaminhamento_id: e.id })).some(x => x.tipo === 'link_aberto');
      if (!ja) await db.registrarEvento({ tipo: 'link_aberto', encaminhamento_id: e.id, lead_nome: e.lead_nome, lead_telefone: e.lead_telefone, corretor_nome: e.corretor_nome, corretor_fone: e.corretor_fone });
    }
    res.render('ok', { title: e.confirmado_em ? 'Como está o atendimento?' : 'Confirmar recebimento', e, feito: !!e.confirmado_em, primeiroNome, RETORNOS, salvo: req.query.salvo === '1' });
  } catch (err) { next(err); }
});

router.post('/ok/:token', async (req, res, next) => {
  try {
    const e = await db.envioPorToken(req.params.token);
    if (!e) return res.status(404).render('ok', { title: 'Link inválido', e: null, feito: false });
    const c = await db.confirmarEnvio(e.id);
    if (!e.confirmado_em) {
      await db.registrarEvento({ tipo: 'confirmado', encaminhamento_id: e.id, lead_nome: e.lead_nome, lead_telefone: e.lead_telefone, corretor_nome: e.corretor_nome, corretor_fone: e.corretor_fone });
    }
    res.set('Cache-Control', 'no-store');
    res.render('ok', { title: 'Recebimento confirmado', e: c, feito: true, primeiroNome, RETORNOS, salvo: false });
  } catch (err) { next(err); }
});

// Retorno do atendimento: o corretor marca como está o lead (pode mudar
// depois, pelo mesmo link). Marcar também conta como "recebi".
router.post('/ok/:token/retorno', async (req, res, next) => {
  try {
    const e = await db.envioPorToken(req.params.token);
    if (!e) return res.status(404).render('ok', { title: 'Link inválido', e: null, feito: false });
    const r = String(req.body.retorno || '');
    if (!RETORNOS[r]) return res.redirect('/ok/' + encodeURIComponent(req.params.token));
    const ev = { encaminhamento_id: e.id, lead_nome: e.lead_nome, lead_telefone: e.lead_telefone, corretor_nome: e.corretor_nome, corretor_fone: e.corretor_fone };
    if (!e.confirmado_em) {
      await db.confirmarEnvio(e.id);
      await db.registrarEvento({ tipo: 'confirmado', ...ev });
    }
    const obs = String(req.body.obs || '').trim();
    await db.registrarRetorno(e.id, r, obs);
    await db.registrarEvento({ tipo: 'retorno_corretor', ...ev, detalhe: RETORNOS[r] + (obs ? ' · ' + obs : '') });
    res.redirect(303, '/ok/' + encodeURIComponent(req.params.token) + '?salvo=1');
  } catch (err) { next(err); }
});

// ---- "Meus leads": link pessoal do corretor ----
// Lista os leads dos últimos 30 dias, os que vieram direto da landing (o
// corretor marca o andamento aqui) e os enviados pela recepção (pelo link /ok).
router.get('/meus/:token', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    const c = await db.corretorPorLink(req.params.token);
    if (!c) return res.status(404).render('meus', { title: 'Link inválido', c: null });
    const { lp, rec } = await db.leadsDoCorretor(c.telefone, 30);
    const leads = lp.map((x) => ({ ...x, tipo: 'lp' })).concat(rec.map((x) => ({ ...x, tipo: 'rec' })))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.render('meus', { title: 'Meus leads', c, leads, token: req.params.token, RETORNOS, primeiroNome, salvo: Number(req.query.salvo) || null });
  } catch (err) { next(err); }
});

router.post('/meus/:token/lead/:id', async (req, res, next) => {
  try {
    const c = await db.corretorPorLink(req.params.token);
    if (!c) return res.status(404).render('meus', { title: 'Link inválido', c: null });
    const r = String(req.body.retorno || '');
    const volta = '/meus/' + encodeURIComponent(req.params.token);
    if (!RETORNOS[r]) return res.redirect(303, volta);
    const obs = String(req.body.obs || '').trim();
    const cl = await db.retornoDoClique(req.params.id, c.telefone, r, obs);
    if (cl) {
      await db.registrarEvento({
        tipo: 'retorno_corretor', clique_id: cl.id, empreendimento_id: cl.empreendimento_id,
        lead_nome: cl.lead_nome, lead_telefone: cl.lead_telefone, corretor_nome: c.nome, corretor_fone: c.telefone,
        detalhe: 'lead da landing · ' + RETORNOS[r] + (obs ? ' · ' + obs : ''),
      });
    }
    res.redirect(303, volta + '?salvo=' + Number(req.params.id) + '#l' + Number(req.params.id));
  } catch (err) { next(err); }
});

// ---- Cadastro do corretor: link com a tag dele ----
function baseDe(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function linksDoCorretor(req, t) {
  const base = baseDe(req);
  const emps = (await db.list({ publishedOnly: true })).map((e) => {
    const gal = Array.isArray(e.gallery) ? e.gallery : [];
    const capa = e.card_imagem || e.hero_image || (gal[0] && gal[0].url) || '';
    return { nome: e.nome, bairro: [e.bairro, e.cidade].filter(Boolean).join(', '), capa: imgVar(capa).sm || imgVar(capa).src || '',
      url: base + '/' + e.slug + '?cor=' + t.tag };
  });
  return { portal: base + '/?cor=' + t.tag, emps, meus: base + '/meus/' + await db.linkDoCorretor(t.telefone) };
}

// Poucos cadastros por IP por hora: o formulário é público.
const tentativas = new Map();
function muitasTentativas(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const agora = Date.now(), lista = (tentativas.get(ip) || []).filter((t) => agora - t < 3600e3);
  lista.push(agora); tentativas.set(ip, lista);
  return lista.length > 15;
}

router.get('/corretor', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  res.render('corretor', { title: 'Seu link de corretor · Auxiliadora Predial', d: {}, erro: null, r: null });
});

router.post('/corretor', async (req, res, next) => {
  try {
    res.set('X-Robots-Tag', 'noindex');
    const d = { nome: String(req.body.nome || '').replace(/\s+/g, ' ').trim().slice(0, 120), creci: String(req.body.creci || '').trim().slice(0, 30), whats: String(req.body.whats || '').trim() };
    const tela = (erro, r) => res.render('corretor', { title: 'Seu link de corretor · Auxiliadora Predial', d, erro, r });
    if (muitasTentativas(req)) return tela('Muitas tentativas seguidas. Tente de novo daqui a pouco.');
    const tel = validarWhats(d.whats);
    if (d.nome.split(' ').length < 2) return tela('Informe seu nome completo (nome e sobrenome).');
    if (d.creci.replace(/\D/g, '').length < 3) return tela('Informe o número do seu CRECI.');
    if (!tel) return tela('Informe um WhatsApp válido, com DDD.');
    const r = await db.cadastrarTag({ nome: d.nome, creci: d.creci, telefone: tel });
    if (r.erro === 'outro-whats') return tela('Este CRECI já está cadastrado com outro WhatsApp. Se você trocou de número, fale com o seu gerente para atualizar.');
    if (r.erro === 'inativo') return tela('Este cadastro está desativado. Fale com o seu gerente.');
    if (r.erro) return tela('Confira o nome e o CRECI.');
    if (r.nova) {
      db.registrarEvento({ tipo: 'tag_corretor', corretor_nome: r.tag.nome, corretor_fone: r.tag.telefone, detalhe: 'tag ' + r.tag.tag + ' · CRECI ' + r.tag.creci }).catch(() => {});
    }
    tela(null, { tag: r.tag.tag, nome: r.tag.nome, nova: !!r.nova, ...(await linksDoCorretor(req, r.tag)) });
  } catch (err) { next(err); }
});

// Comparação em tempo constante: o token não vaza por tempo de resposta.
function tokenOk(req) {
  const esperado = process.env.LEADS_WEBHOOK_TOKEN || '';
  const veio = String(req.get('x-leads-token') || req.query.token || '');
  if (!esperado || veio.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(veio), Buffer.from(esperado));
}

router.post('/entrada/email', async (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ ok: false });
  try {
    const e = await caixa.receberWebhook(req.body || {});
    res.json({ ok: true, importado: !!e });
  } catch (err) {
    console.error('[entrada] falha no webhook:', err.message);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
