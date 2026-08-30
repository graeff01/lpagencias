const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asArray, fmtPreco, shade, tituloBusca } = require('../lib/helpers');
const roleta = require('../lib/roleta');

// Domínio definitivo do site. Definido em SITE_DOMINIO, ele vira a única
// URL indexável: o endereço interno do Railway passa a redirecionar para cá,
// e o canonical aponta sempre para ele. Sem isso o mesmo conteúdo responde
// em dois endereços e o Google divide a força entre os dois.
const DOMINIO = (process.env.SITE_DOMINIO || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

function baseUrl(req) {
  return DOMINIO ? `https://${DOMINIO}` : `${req.protocol}://${req.get('host')}`;
}

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
    acabamentos: asArray(e.acabamentos),
    _green: green,
    _greenDeep: shade(green, -40),
    _greenBright: green2,
    _greenInk: shade(green, -78),
    _accent: accent,
    _accentDeep: shade(accent, -34),
    _precoFmt: fmtPreco(e.preco_inicial),
  };
}

// Todo acesso por outro endereço (o domínio interno do Railway, por
// exemplo) é redirecionado em definitivo para o domínio oficial.
router.use((req, res, next) => {
  if (!DOMINIO) return next();
  const host = String(req.get('host') || '').toLowerCase();
  if (host === DOMINIO.toLowerCase()) return next();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return next();
  return res.redirect(301, `https://${DOMINIO}${req.originalUrl}`);
});

// Raiz do site. Com um empreendimento marcado como "página inicial", ele
// ocupa a raiz: toda a autoridade do domínio se concentra numa URL só, em
// vez de dividir entre uma vitrine magra e a landing de verdade.
router.get('/', async (req, res, next) => {
  try {
    const home = await db.getHome();
    if (home) return renderLanding(req, res, home, { naRaiz: true });
    const rows = (await db.list({ publishedOnly: true })).map(prep);
    res.render('home', { title: 'Auxiliadora Predial · Empreendimentos', emps: rows });
  } catch (e) { next(e); }
});

// Robôs não devem seguir (nem indexar) o link da roleta.
router.get('/robots.txt', (req, res) => {
  const base = baseUrl(req);
  res.type('text/plain').send(
    `User-agent: *\nDisallow: /wa/\nDisallow: /admin/\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`
  );
});

// Sitemap com as landings publicadas — o Google encontra tudo sem depender de link.
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const rows = await db.list({ publishedOnly: true });
    const home = rows.find((r) => r.home);
    const dia = (r) => (r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : null);
    // O empreendimento da raiz entra só como "/". Listar também /slug faria o
    // Google indexar duas URLs para a mesma página.
    const urls = home
      ? [`<url><loc>${base}/</loc><lastmod>${dia(home) || ''}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`]
      : [`<url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`];
    rows.filter((r) => !r.home).forEach((r) => {
      const dt = dia(r);
      urls.push(`<url><loc>${base}/${r.slug}</loc>${dt ? `<lastmod>${dt}</lastmod>` : ''}`
        + `<changefreq>weekly</changefreq><priority>1.0</priority></url>`);
    });
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
    );
  } catch (e) { next(e); }
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

function renderLanding(req, res, row, { naRaiz = false } = {}) {
  const e = prep(row);
  const base = baseUrl(req);
  return res.render('landing', {
    // Canonical sempre na URL preferida: sem isso a mesma página em duas
    // URLs vira conteúdo duplicado e o Google divide a força entre as duas.
    canonical: naRaiz ? base + '/' : `${base}/${e.slug}`,
    title: tituloBusca(e),
    e,
    // Todo botão de WhatsApp passa pela roleta, nunca pelo número direto.
    wa: '/wa/' + e.slug,
    isPreview: !row.published,
    naRaiz,
  });
}

// Landing page pública do empreendimento
router.get('/:slug', async (req, res, next) => {
  try {
    const row = await db.getBySlug(req.params.slug);
    if (!row) return next();
    // só admin logado vê rascunhos (não publicados)
    if (!row.published && !(req.session && req.session.admin)) return next();
    // Se este é o empreendimento da raiz, /slug redireciona para lá em
    // definitivo (301), consolidando os sinais numa URL única.
    if (row.home && row.published) return res.redirect(301, '/');
    return renderLanding(req, res, row);
  } catch (e) { next(e); }
});

module.exports = router;
