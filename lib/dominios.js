// Qual site responde em cada domínio.
//
//  - Domínio próprio de um empreendimento (campo "Domínio próprio" no
//    cadastro, ex.: www.vangoghpetropolis.com.br): a raiz mostra a landing
//    dele, como um site independente.
//  - Domínio principal: o portal com a vitrine. É o SITE_DOMINIO; se ele for
//    o domínio de um empreendimento, o principal passa a ser o endereço
//    público do Railway (RAILWAY_PUBLIC_DOMAIN, injetado pelo próprio Railway).
const db = require('./db');

let cache = null;
let validoAte = 0;

function semWww(h) {
  return String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

async function comDominio() {
  if (cache && Date.now() < validoAte) return cache;
  const { rows } = await db.query(
    "SELECT id, slug, dominio, published FROM empreendimentos WHERE dominio IS NOT NULL AND dominio <> ''"
  );
  cache = rows;
  validoAte = Date.now() + 30 * 1000;
  return rows;
}

// Chamado ao salvar um empreendimento: o domínio novo vale na hora.
function limparCache() { cache = null; }

async function empDoHost(host) {
  const h = semWww(host);
  if (!h) return null;
  return (await comDominio()).find(r => r.published && semWww(r.dominio) === h) || null;
}

async function principal() {
  const site = db.normalizarDominio(process.env.SITE_DOMINIO);
  const railway = db.normalizarDominio(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (site && !(await comDominio()).some(r => semWww(r.dominio) === semWww(site))) return site;
  return railway || '';
}

module.exports = { empDoHost, principal, limparCache, semWww };
