// Rotas públicas sem login:
//   /ok/:token       — o corretor confirma que recebeu o lead (link na mensagem).
//   /entrada/email   — webhook de e-mail de lead (quando a caixa é recebida por
//                      um serviço externo em vez de lida pelo sistema).
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../lib/db');
const caixa = require('../lib/caixa-leads');

function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

// A pré-visualização do WhatsApp abre o link sozinha: abrir a página não
// confirma nada. Só o botão (POST) confirma.
router.get('/ok/:token', async (req, res, next) => {
  try {
    const e = await db.envioPorToken(req.params.token);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    if (!e) return res.status(404).render('ok', { title: 'Link inválido', e: null, feito: false });
    res.render('ok', { title: 'Confirmar recebimento', e, feito: !!e.confirmado_em, primeiroNome });
  } catch (err) { next(err); }
});

router.post('/ok/:token', async (req, res, next) => {
  try {
    const e = await db.envioPorToken(req.params.token);
    if (!e) return res.status(404).render('ok', { title: 'Link inválido', e: null, feito: false });
    const c = await db.confirmarEnvio(e.id);
    res.set('Cache-Control', 'no-store');
    res.render('ok', { title: 'Recebimento confirmado', e: c, feito: true, primeiroNome });
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
