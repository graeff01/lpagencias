// Qual site responde em cada domínio.
//
//  - Domínio próprio de um empreendimento (campo "Domínio próprio" no
//    cadastro, ex.: www.vangoghpetropolis.com.br): a raiz mostra a landing
//    dele, como um site independente.
//  - Domínio principal: o portal com a vitrine. É o PORTAL_DOMINIO, se
//    definido; senão, o primeiro destes que não seja domínio de
//    empreendimento: SITE_DOMINIO, RAILWAY_PUBLIC_DOMAIN e o endereço padrão
//    do Railway (<serviço>-<ambiente>.up.railway.app). O RAILWAY_PUBLIC_DOMAIN
//    sozinho não basta: com domínio personalizado, o Railway preenche ele com
//    o personalizado (aqui, o do Van Gogh).
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

function padraoRailway() {
  const svc = process.env.RAILWAY_SERVICE_NAME;
  const amb = process.env.RAILWAY_ENVIRONMENT_NAME;
  return svc && amb ? `${svc}-${amb}.up.railway.app`.toLowerCase() : '';
}

async function principal() {
  const fixo = db.normalizarDominio(process.env.PORTAL_DOMINIO);
  if (fixo) return fixo;
  const deEmp = new Set((await comDominio()).map(r => semWww(r.dominio)));
  const candidatos = [process.env.SITE_DOMINIO, process.env.RAILWAY_PUBLIC_DOMAIN, padraoRailway()]
    .map(db.normalizarDominio).filter(Boolean);
  return candidatos.find(d => !deEmp.has(semWww(d))) || '';
}

module.exports = { empDoHost, principal, limparCache, semWww };
