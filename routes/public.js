const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asArray, fmtPreco, waLink, shade } = require('../lib/helpers');

// Prepara o objeto do empreendimento para a view (parse dos jsonb + cores derivadas)
function prep(e) {
  const green = e.cor_principal || '#0E9E4A';
  const green2 = e.cor_secundaria || shade(green, 30);
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

// Landing page pública do empreendimento
router.get('/:slug', async (req, res, next) => {
  try {
    const row = await db.getBySlug(req.params.slug);
    if (!row) return next();
    // só admin logado vê rascunhos (não publicados)
    if (!row.published && !(req.session && req.session.admin)) return next();
    const e = prep(row);
    const waMsg = `Olá! Tenho interesse no empreendimento ${e.nome}. Pode me passar mais informações?`;
    res.render('landing', {
      title: `${e.nome} · Auxiliadora Predial`,
      e,
      wa: waLink(e.whatsapp, waMsg),
      waRaw: e.whatsapp,
      isPreview: !row.published,
    });
  } catch (e) { next(e); }
});

module.exports = router;
