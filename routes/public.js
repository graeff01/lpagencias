const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asArray, fmtPreco, shade } = require('../lib/helpers');
const roleta = require('../lib/roleta');

// Prepara o objeto do empreendimento para a view (parse dos jsonb + cores derivadas)
function prep(e) {
  const green = e.cor_principal || '#0E9E4A';
  const green2 = e.cor_secundaria || shade(green, 30);
  const accent = e.cor_accent || '#F47B20';
  return {
    ...e,
    gallery: asArray(e.gallery),
    infra: asArray(e.infra),
    plantas: asArray(e.plantas),
    diferenciais: asArray(e.diferenciais),
    timeline: asArray(e.timeline),
    faq: asArray(e.faq),
    pois: asArray(e.pois),
    construtora_stats: asArray(e.construtora_stats),
    _green: green,
    _greenDeep: shade(green, -40),
    _greenBright: green2,
    _greenInk: shade(green, -78),
    _accent: accent,
    _accentDeep: shade(accent, -34),
    _precoFmt: fmtPreco(e.preco_inicial),
  };
}

// Home — vitrine dos empreendimentos publicados
router.get('/', async (req, res, next) => {
  try {
    const rows = (await db.list({ publishedOnly: true })).map(prep);
    res.render('home', { title: 'Auxiliadora Predial · Empreendimentos', emps: rows });
  } catch (e) { next(e); }
});

// Robôs não devem seguir (nem indexar) o link da roleta.
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /wa/\nAllow: /\n');
});

// ---------------------------------------------------------------------
//  /wa/:slug  — o "botão do WhatsApp" de todas as landings passa por aqui.
//  Sorteia o corretor da vez, grava o clique e redireciona pro wa.me.
//  Query: ?src=hero|fab|footer|form  &msg=  &utm_*
// ---------------------------------------------------------------------
router.get('/wa/:slug', async (req, res) => {
  let emp = null;
  try {
    emp = await db.getBySlug(req.params.slug);
    if (!emp) return res.redirect(302, '/');

    const origem = String(req.query.src || 'link').slice(0, 30);
    const { telefone } = await roleta.distribuir(req, res, emp, origem);
    if (!telefone) return res.redirect(302, '/' + emp.slug + '#contato');

    return enviarParaWhats(res, telefone, mensagem(req, emp));
  } catch (err) {
    // Regra de ouro: um lead NUNCA pode virar tela de erro. Se a roleta falhar
    // (banco fora do ar, etc.), ele vai para o número reserva sem atribuição —
    // melhor um lead sem dono do que um lead perdido.
    console.error('[roleta] falha ao distribuir:', err.message);
    const reserva = emp ? roleta.digitos(emp.whatsapp) : '';
    if (reserva) return enviarParaWhats(res, reserva, mensagem(req, emp));
    return res.redirect(302, emp ? '/' + emp.slug + '#contato' : '/');
  }
});

function mensagem(req, emp) {
  return String(req.query.msg || '').slice(0, 700)
    || `Olá! Tenho interesse no empreendimento ${emp ? emp.nome : 'anunciado'}. Pode me passar mais informações?`;
}

function enviarParaWhats(res, telefone, msg) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Referrer-Policy', 'no-referrer');
  return res.redirect(302, `https://wa.me/${telefone}?text=${encodeURIComponent(msg)}`);
}

// Landing page pública do empreendimento
router.get('/:slug', async (req, res, next) => {
  try {
    const row = await db.getBySlug(req.params.slug);
    if (!row) return next();
    // só admin logado vê rascunhos (não publicados)
    if (!row.published && !(req.session && req.session.admin)) return next();
    const e = prep(row);
    res.render('landing', {
      canonical: `${req.protocol}://${req.get('host')}/${e.slug}`,
      title: `${e.nome} · Auxiliadora Predial`,
      e,
      // Todo botão de WhatsApp aponta para a roleta (/wa/:slug), nunca para o
      // número direto — é ela que distribui o lead entre os corretores.
      wa: '/wa/' + e.slug,
      isPreview: !row.published,
    });
  } catch (e) { next(e); }
});

module.exports = router;
