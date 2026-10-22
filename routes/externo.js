// Rotas públicas sem login:
//   /ok/:token       — o corretor confirma que recebeu o lead (link na mensagem).
//   /entrada/email   — webhook de e-mail de lead (quando a caixa é recebida por
//                      um serviço externo em vez de lida pelo sistema).
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../lib/db');
const caixa = require('../lib/caixa-leads');
const { isBot } = require('../lib/roleta');
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
