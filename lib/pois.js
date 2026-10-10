// Pontos de interesse perto do empreendimento, com dados abertos do
// OpenStreetMap via Nominatim: endereço -> coordenadas e, depois, o mais
// perto de cada categoria. Não exige chave nem conta.
//
// A distância é em linha reta, a partir do ponto confirmado no painel. O
// Nominatim nem sempre conhece o número do prédio (devolve o meio da rua),
// por isso o painel mostra o alfinete para quem cadastra conferir e arrastar.

const UA = 'auxiliadora-landings/1.0 (+https://lpagencias-production.up.railway.app)';
const cache = new Map();   // as duas APIs pedem uso moderado
const DIA = 24 * 3600 * 1000;

async function buscarJson(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function emCache(chave, fn) {
  const c = cache.get(chave);
  if (c && c.ate > Date.now()) return c.valor;
  const valor = fn().catch((e) => { cache.delete(chave); throw e; });
  cache.set(chave, { valor, ate: Date.now() + DIA });
  return valor;
}

// Candidatos para o endereço: o primeiro é o mais provável.
function geocodificar({ endereco, bairro, cidade }) {
  const q = [endereco, bairro, cidade, 'RS', 'Brasil'].filter(Boolean).join(', ');
  if (!endereco && !bairro) return Promise.resolve([]);
  return emCache('geo:' + q.toLowerCase(), async () => {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=4&countrycodes=br&addressdetails=1&q=' + encodeURIComponent(q);
    const rows = await naFila(() => buscarJson(url));
    return rows.map(r => ({
      lat: Number(r.lat), lon: Number(r.lon),
      nome: r.display_name,
      // sem número de porta = o ponto é só "algum lugar da rua"
      exato: !!(r.address && r.address.house_number),
    }));
  });
}

// Categorias buscadas: [rótulo, emoji, frase de categoria do Nominatim,
// raio em metros, tipos OSM aceitos]. O Overpass seria o caminho natural,
// mas vive sobrecarregado (30-40 s por consulta); a busca por categoria do
// Nominatim responde em ~1 s.
const CATS = [
  ['Supermercado', '🛒', '[supermarket]', 1500, /^supermarket$/],
  ['Farmácia', '💊', '[pharmacy]', 1500, /^pharmacy$/],
  ['Escola', '🏫', '[school]', 1500, /^school$/],
  ['Saúde', '🏥', '[hospital]', 4000, /^(hospital|clinic)$/],
  ['Faculdade', '🎓', '[college]', 4000, /^(college|university)$/],
  ['Faculdade', '🎓', '[university]', 5000, /^(college|university)$/],
  ['Shopping', '🛍️', '[mall]', 5000, /^mall$/],
  ['Parque', '🌳', '[park]', 2000, /^park$/],
  ['Banco', '🏦', '[bank]', 2000, /^bank$/],
  ['Estação', '🚆', '[railway=station]', 4000, /^station$/],
];

// O Nominatim pede no máximo 1 consulta por segundo: todas passam por esta fila.
let fila = Promise.resolve();
function naFila(fn) {
  const p = fila.then(fn, fn);
  fila = p.then(() => new Promise(r => setTimeout(r, 1100)), () => new Promise(r => setTimeout(r, 1100)));
  return p;
}

function caixa(lat, lon, raio) {
  const dLat = raio / 111320, dLon = raio / (111320 * Math.cos(lat * Math.PI / 180));
  return [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map(n => n.toFixed(6)).join(',');
}

function distancia(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtDist(m) {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(Math.round(m / 100) / 10).toLocaleString('pt-BR')} km`;
}

// O mais perto de cada categoria, até `limite` itens, do mais perto ao mais longe.
function proximos(lat, lon, limite = 8) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon)) return Promise.resolve([]);
  const chave = `poi:${lat.toFixed(4)},${lon.toFixed(4)}`;
  return emCache(chave, async () => {
    const origem = { lat, lon };
    const porRotulo = new Map();
    for (const [rotulo, emoji, frase, raio, tipos] of CATS) {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=40&bounded=1'
        + '&q=' + encodeURIComponent(frase) + '&viewbox=' + caixa(lat, lon, raio);
      let rows = [];
      // Uma nova tentativa por categoria: o serviço oscila de vez em quando.
      try { rows = await naFila(() => buscarJson(url)); }
      catch (e) { try { rows = await naFila(() => buscarJson(url)); } catch (e2) { continue; } }
      for (const r of rows) {
        if (!r.name || !tipos.test(r.type)) continue;
        const d = distancia(origem, { lat: Number(r.lat), lon: Number(r.lon) });
        if (d > raio) continue;
        const atual = porRotulo.get(rotulo);
        if (!atual || d < atual.d) porRotulo.set(rotulo, { nome: r.name.replace(/\s+/g, ' ').trim(), d, rotulo, emoji, lat: Number(r.lat), lon: Number(r.lon) });
      }
    }
    const vistos = new Set();
    return [...porRotulo.values()]
      .filter(m => { const k = m.nome.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; })
      .sort((a, b) => a.d - b.d)
      .slice(0, limite)
      .map(m => {
        const nome = m.rotulo === 'Estação' && !/esta[cç][aã]o/i.test(m.nome) ? `Estação ${m.nome}` : m.nome;
        return { label: `${m.emoji} ${nome} · ${fmtDist(m.d)}`, categoria: m.rotulo, metros: Math.round(m.d), lat: m.lat.toFixed(6), lon: m.lon.toFixed(6) };
      });
  });
}

// Nome do ponto a partir da etiqueta: "🛒 Supermercado X · 400 m" -> "Supermercado X".
function nomeDaEtiqueta(label) {
  return String(label || '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s*·\s*[\d.,]+\s*(m|km)\s*$/i, '')
    .trim();
}
function chaveNome(s) {
  return nomeDaEtiqueta(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^esta[cç]ao\s+/, '');
}

// Coordenadas de um ponto digitado à mão: busca o nome dentro de 5 km do
// empreendimento e fica com o resultado mais perto.
function localizarPonto(nome, lat, lon) {
  if (!nome) return Promise.resolve(null);
  return emCache(`pt:${nome.toLowerCase()}@${(+lat).toFixed(3)},${(+lon).toFixed(3)}`, async () => {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&bounded=1'
      + '&q=' + encodeURIComponent(nome) + '&viewbox=' + caixa(+lat, +lon, 5000);
    const rows = await naFila(() => buscarJson(url));
    const origem = { lat: +lat, lon: +lon };
    let melhor = null;
    for (const r of rows) {
      const d = distancia(origem, { lat: Number(r.lat), lon: Number(r.lon) });
      if (!melhor || d < melhor.d) melhor = { lat: Number(r.lat), lon: Number(r.lon), d };
    }
    return melhor;
  });
}

// Completa lat/lon dos pontos que ainda não têm (cadastrados antes de o mapa
// mostrar os pontos, ou digitados à mão). Devolve a lista nova, ou null se
// nada mudou. Primeiro tenta casar com a busca automática (que já traz as
// coordenadas); o que sobrar é procurado pelo nome.
async function completarCoords(lista, lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const faltam = lista.filter(p => p && p.label && !(isFinite(parseFloat(p.lat)) && isFinite(parseFloat(p.lon))));
  if (!faltam.length) return null;
  let auto = [];
  try { auto = await proximos(lat, lon, 50); } catch (e) { /* segue para a busca por nome */ }
  const porNome = new Map(auto.map(a => [chaveNome(a.label), a]));
  let mudou = false;
  const nova = [];
  for (const p of lista) {
    if (!p || !p.label || faltam.indexOf(p) < 0) { nova.push(p); continue; }
    let achou = porNome.get(chaveNome(p.label));
    if (!achou) {
      try { const r = await localizarPonto(nomeDaEtiqueta(p.label), lat, lon); if (r) achou = { lat: r.lat.toFixed(6), lon: r.lon.toFixed(6) }; }
      catch (e) { /* fica sem alfinete, só na legenda */ }
    }
    if (achou) { nova.push({ ...p, lat: String(achou.lat), lon: String(achou.lon) }); mudou = true; }
    else nova.push(p);
  }
  return mudou ? nova : null;
}

module.exports = { geocodificar, proximos, fmtDist, distancia, completarCoords };
