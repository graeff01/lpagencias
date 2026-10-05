const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asArray, fmtPreco, shade, tituloBusca, slugify, dormsLista, linhaTipologia } = require('../lib/helpers');
const roleta = require('../lib/roleta');
const portal = require('../lib/portal');
const dominios = require('../lib/dominios');

// Endereço base das URLs absolutas (canonical, sitemap). Definido pelo
// middleware de domínios abaixo: o domínio principal, ou o domínio próprio
// do empreendimento quando a visita chega por ele.
function baseUrl(req) {
  return req.siteBase || `${req.protocol}://${req.get('host')}`;
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

// Dados que o card da vitrine precisa (e que o filtro lê via data-*).
function prepCard(e) {
  const x = prep(e);
  const capa = x.card_imagem || x.hero_image || (x.gallery[0] && x.gallery[0].url) || '';
  return {
    ...x,
    _capa: capa,
    _tipologia: linhaTipologia(x),
    _resumo: x.card_resumo || '',
    _selo: x.card_selo || x.status || '',
    _dorms: dormsLista(x.dormitorios),
    _cidadeSlug: slugify(x.cidade),
    _bairroSlug: slugify(x.bairro),
  };
}

// Pseudo-empreendimento do portal: a roleta e o log de cliques funcionam por
// "empreendimento_id"; o portal usa o id 0, com corretores e relatório próprios.
const PORTAL_ID = 0;
const PORTAL_SLUG = 'portal';
function empPortal(cfg) {
  return { id: PORTAL_ID, slug: PORTAL_SLUG, nome: 'Portal de lançamentos', whatsapp: cfg.whatsapp || '', published: true };
}

// Regiões (cidades e bairros) com pelo menos um empreendimento publicado.
// Cada uma vira uma página própria (/canoas, /moinhos-de-vento): destino
// natural para campanha regional, com título casando com a busca.
// Bairro com o mesmo nome em duas cidades ("Centro") ganha a cidade no
// endereço (/centro-canoas), senão as duas vitrines se misturariam.
function regioesDe(emps) {
  const cidadesDoBairro = new Map();
  for (const e of emps) {
    const b = slugify(e.bairro);
    if (!b) continue;
    if (!cidadesDoBairro.has(b)) cidadesDoBairro.set(b, new Set());
    cidadesDoBairro.get(b).add(slugify(e.cidade));
  }
  const mapa = new Map();
  const add = (slug, tipo, nome, e) => {
    if (!slug) return;
    if (!mapa.has(slug)) mapa.set(slug, { slug, tipo, nome: String(nome).trim(), ids: new Set() });
    mapa.get(slug).ids.add(e.id);
  };
  for (const e of emps) {
    add(slugify(e.cidade), 'cidade', e.cidade, e);
    const b = slugify(e.bairro);
    if (!b) continue;
    const ambiguo = cidadesDoBairro.get(b).size > 1;
    add(ambiguo ? slugify(`${e.bairro} ${e.cidade}`) : b, 'bairro', ambiguo ? `${e.bairro} (${e.cidade})` : e.bairro, e);
  }
  return [...mapa.values()].map(r => ({ ...r, total: r.ids.size }));
}

// Cada domínio responde com o seu site:
//  - domínio próprio de um empreendimento: a raiz é a landing dele;
//    /<slug> volta para a raiz (uma URL só) e o resto (outras páginas do
//    portal) vai para o domínio principal;
//  - domínio principal: o portal;
//  - qualquer outro endereço: redirecionado em definitivo para o principal,
//    senão o mesmo conteúdo responde em dois endereços e o Google divide a
//    força entre os dois.
router.use(async (req, res, next) => {
  try {
    const host = String(req.get('host') || '').toLowerCase().replace(/:\d+$/, '');
    const local = host === 'localhost' || host === '127.0.0.1';
    const principal = await dominios.principal();
    req.portalBase = principal && !local ? `https://${principal}` : '';
    const emp = await dominios.empDoHost(host);

    if (emp) {
      req.empDoDominio = emp;
      req.siteBase = `https://${host}`;
      const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      if (req.path === '/') return next();
      if (req.path === `/${emp.slug}` || req.path === `/${emp.slug}/`) return res.redirect(301, '/' + qs);
      if (/^\/(wa\/|robots\.txt$|sitemap\.xml$)/.test(req.path)) return next();
      if (req.portalBase) return res.redirect(301, req.portalBase + req.originalUrl);
      return next();
    }

    req.siteBase = principal && !local ? `https://${principal}` : '';
    if (!principal || local || host === principal) return next();
    return res.redirect(301, `https://${principal}${req.originalUrl}`);
  } catch (e) {
    // Sem banco não dá para saber o domínio: segue e deixa a rota responder.
    console.error('[dominios]', e.message);
    return next();
  }
});

// Raiz do site: o portal institucional com a vitrine de empreendimentos.
router.get('/', async (req, res, next) => {
  try {
    if (req.empDoDominio) {
      const row = await db.getById(req.empDoDominio.id);
      if (row && row.published) return await renderLanding(req, res, row);
    }
    const emps = (await db.list({ publishedOnly: true })).map(prepCard);
    return renderPortal(req, res, emps, null);
  } catch (e) { next(e); }
});

async function renderPortal(req, res, emps, regiao) {
  const cfg = await portal.carregar();
  const base = baseUrl(req);
  const todos = regiao ? (await db.list({ publishedOnly: true })).map(prepCard) : emps;
  const titulo = regiao
    ? `Lançamentos ${regiao.tipo === 'bairro' ? 'no' : 'em'} ${regiao.nome} | Auxiliadora Predial`
    : (cfg.seo_titulo || portal.PADRAO.seo_titulo);
  return res.render('portal', {
    title: titulo,
    canonical: regiao ? `${base}/${regiao.slug}` : `${base}/`,
    base,
    cfg,
    emps,
    regiao,
    regioes: regioesDe(todos).filter(r => r.tipo === 'cidade'),
    numeros: portal.resolverNumeros(cfg.numeros, todos),
    wa: '/wa/' + PORTAL_SLUG,
  });
}

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
    const xml = (urls) => res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
    );
    // Domínio próprio de um empreendimento: o site dele é só a raiz.
    if (req.empDoDominio) {
      return xml([`<url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`]);
    }
    const todos = await db.list({ publishedOnly: true });
    // Quem tem domínio próprio é indexado lá (é o canonical dele), não aqui.
    const rows = todos.filter(r => !r.dominio);
    const dia = (r) => (r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : null);
    const urls = [`<url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`];
    const slugsEmp = new Set(todos.map(r => r.slug));
    // Bairro com um empreendimento só seria uma página rasa, quase cópia da
    // landing: funciona para anúncio, mas fica fora do sitemap.
    regioesDe(todos).filter(r => !slugsEmp.has(r.slug) && (r.tipo === 'cidade' || r.total > 1)).forEach((r) => {
      urls.push(`<url><loc>${base}/${r.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
    });
    rows.forEach((r) => {
      const dt = dia(r);
      urls.push(`<url><loc>${base}/${r.slug}</loc>${dt ? `<lastmod>${dt}</lastmod>` : ''}`
        + `<changefreq>weekly</changefreq><priority>1.0</priority></url>`);
    });
    xml(urls);
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
    const doPortal = req.params.slug === PORTAL_SLUG;
    emp = doPortal ? empPortal(await portal.carregar()) : await db.getBySlug(req.params.slug);
    if (!emp) return res.redirect(302, '/');
    const voltar = doPortal ? '/#contato' : '/' + emp.slug + '#contato';

    const origem = String(req.query.src || 'link').slice(0, 30);
    // Empreendimento recém-cadastrado, ainda sem corretor nem número reserva:
    // o lead vai para a roleta do portal (a mensagem continua citando o
    // empreendimento), em vez de cair no vazio.
    let alvo = emp;
    if (!doPortal && !roleta.digitos(emp.whatsapp)
        && !(await db.listCorretores(emp.id, { ativosOnly: true })).length) {
      alvo = empPortal(await portal.carregar());
    }
    const { telefone } = await roleta.distribuir(req, res, alvo, origem);
    if (!telefone) return res.redirect(302, voltar);

    return enviarParaWhats(res, telefone, mensagem(req, emp));
  } catch (err) {
    // Regra de ouro: um lead NUNCA pode virar tela de erro. Se a roleta falhar
    // (banco fora do ar, etc.), ele vai para o número reserva sem atribuição —
    // melhor um lead sem dono do que um lead perdido.
    console.error('[roleta] falha ao distribuir:', err.message);
    const reserva = emp ? roleta.digitos(emp.whatsapp) : '';
    if (reserva) return enviarParaWhats(res, reserva, mensagem(req, emp));
    if (emp && emp.id === PORTAL_ID) return res.redirect(302, '/#contato');
    return res.redirect(302, emp ? '/' + emp.slug + '#contato' : '/');
  }
});

function mensagem(req, emp) {
  const msg = String(req.query.msg || '').slice(0, 700);
  if (msg) return msg;
  if (emp && emp.id === PORTAL_ID) return 'Olá! Vim pelo site de lançamentos da Auxiliadora Predial e quero ajuda para encontrar um imóvel.';
  return `Olá! Tenho interesse no empreendimento ${emp ? emp.nome : 'anunciado'}. Pode me passar mais informações?`;
}

function enviarParaWhats(res, telefone, msg) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Referrer-Policy', 'no-referrer');
  return res.redirect(302, `https://wa.me/${telefone}?text=${encodeURIComponent(msg)}`);
}

// Outros empreendimentos para o fim da landing: quem não se interessou por
// este vê as alternativas em vez de sair do site. Mesma cidade primeiro.
async function outrosDe(row, limite = 3) {
  const todos = (await db.list({ publishedOnly: true })).filter(r => r.id !== row.id);
  const cidade = slugify(row.cidade);
  todos.sort((a, b) => (slugify(b.cidade) === cidade) - (slugify(a.cidade) === cidade));
  return todos.slice(0, limite).map(prepCard);
}

async function renderLanding(req, res, row) {
  const e = prep(row);
  const base = baseUrl(req);
  // Com domínio próprio, a URL oficial da landing é a raiz dele, mesmo
  // quando ela é aberta pelo card do portal (/van-gogh).
  const canonical = row.dominio ? `https://${row.dominio}/` : `${base}/${e.slug}`;
  // Links para o portal: relativos no domínio principal, absolutos quando a
  // landing está no domínio próprio (lá "/" é a própria landing).
  const portalBase = req.empDoDominio ? (req.portalBase || '') : '';
  return res.render('landing', {
    canonical,
    portalBase,
    title: tituloBusca(e),
    e,
    // Todo botão de WhatsApp passa pela roleta, nunca pelo número direto.
    wa: '/wa/' + e.slug,
    isPreview: !row.published,
    outros: await outrosDe(row),
  });
}

// Landing page pública do empreendimento — ou, se o endereço não for de
// nenhum empreendimento, a página da região (/canoas, /moinhos-de-vento).
router.get('/:slug', async (req, res, next) => {
  try {
    const row = await db.getBySlug(req.params.slug);
    if (row) {
      // só quem está logado no painel vê rascunhos (não publicados)
      if (!row.published && !(req.session && req.session.admin)) return next();
      return await renderLanding(req, res, row);
    }
    const emps = (await db.list({ publishedOnly: true })).map(prepCard);
    const regiao = regioesDe(emps).find(r => r.slug === req.params.slug);
    if (!regiao) return next();
    const daRegiao = emps.filter(e => regiao.ids.has(e.id));
    return await renderPortal(req, res, daRegiao, regiao);
  } catch (e) { next(e); }
});

router.PORTAL_ID = PORTAL_ID;
router.PORTAL_SLUG = PORTAL_SLUG;
module.exports = router;
