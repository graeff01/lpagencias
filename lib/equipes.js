// Painel dos gestores: senha, período e as métricas da equipe.
//
// Um gestor vê só os corretores da equipe dele, somando todos os
// empreendimentos (e o portal) em que cada um está na roleta.

const crypto = require('crypto');
const db = require('./db');

// ---- Senha ----
// scrypt com sal próprio: o banco nunca guarda a senha do gestor.
function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(senha), sal, 32).toString('hex');
  return `${sal}:${h}`;
}

function confereSenha(senha, guardado) {
  const [sal, h] = String(guardado || '').split(':');
  if (!sal || !h) return false;
  const calc = crypto.scryptSync(String(senha), sal, 32);
  const esperado = Buffer.from(h, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

// "Fabrício Bilhalva" -> "fabricio.bilhalva"
function usuarioValido(u) {
  const v = String(u || '').trim().toLowerCase();
  return /^[a-z0-9._-]{3,40}$/.test(v) ? v : null;
}

// ---- Período ----
// Os limites de dia e mês seguem o horário de Brasília (UTC-3, sem horário
// de verão desde 2019), não o relógio do servidor.
const FUSO_MS = 3 * 3600 * 1000;
const PERIODOS = [
  ['hoje', 'Hoje'],
  ['7', '7 dias'],
  ['30', '30 dias'],
  ['mes', 'Este mês'],
  ['mes-anterior', 'Mês passado'],
  ['tudo', 'Tudo'],
];

function inicioDoDia(ms) {
  const local = new Date(ms - FUSO_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + FUSO_MS;
}

function inicioDoMes(ms, deslocamento = 0) {
  const local = new Date(ms - FUSO_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + deslocamento, 1) + FUSO_MS;
}

function periodo(chave, agora = Date.now()) {
  const fim = agora + 60 * 1000;
  switch (chave) {
    case 'hoje': return { chave, desde: new Date(inicioDoDia(agora)), ate: new Date(fim) };
    case '7': return { chave, desde: new Date(inicioDoDia(agora) - 6 * 864e5), ate: new Date(fim) };
    case 'mes': return { chave, desde: new Date(inicioDoMes(agora)), ate: new Date(fim) };
    case 'mes-anterior': return { chave, desde: new Date(inicioDoMes(agora, -1)), ate: new Date(inicioDoMes(agora)) };
    case 'tudo': return { chave, desde: new Date(0), ate: new Date(fim) };
    default: return { chave: '30', desde: new Date(inicioDoDia(agora) - 29 * 864e5), ate: new Date(fim) };
  }
}

// Por onde o lead chegou na recepção (opcional no envio).
const CANAIS = ['Site / LP', 'Instagram', 'Facebook', 'Google', 'Portais', 'Placa', 'Indicação', 'Outro'];

// ---- Métricas ----
async function nomesDosEmps() {
  const emps = await db.list({});
  const nomes = { 0: 'Portal (página principal)' };
  for (const e of emps) nomes[e.id] = e.nome;
  return nomes;
}

async function painel(gestor, chavePeriodo) {
  const per = periodo(chavePeriodo);
  const [equipe, unicos, porFone, perdidos, nomesEmp, envios] = await Promise.all([
    db.listEquipe(gestor.id),
    db.corretoresUnicos(),
    db.cliquesPorFone(per.desde, per.ate),
    db.naoRetornadosPorFone(per.desde, per.ate),
    nomesDosEmps(),
    db.encaminhamentosPorFone(per.desde, per.ate),
  ]);
  const recepcao = {};
  for (const r of envios) recepcao[r.fone] = (recepcao[r.fone] || 0) + r.n;
  const cadastro = new Map(unicos.map(u => [u.telefone, u]));

  const linhas = equipe.map((m) => {
    const cad = cadastro.get(m.telefone);
    const meus = porFone.filter(r => r.fone === m.telefone);
    const porEmp = meus
      .map(r => ({ id: r.empreendimento_id, nome: nomesEmp[r.empreendimento_id] || 'Empreendimento excluído', leads: r.leads }))
      .filter(r => r.leads > 0)
      .sort((a, b) => b.leads - a.leads);
    const ultimo = meus.reduce((m2, r) => {
      const d = r.ultimo ? new Date(r.ultimo) : null;
      return d && (!m2 || d > m2) ? d : m2;
    }, null);
    return {
      telefone: m.telefone,
      nome: m.nome || (cad && cad.nomes[0]) || m.telefone,
      leads: meus.reduce((a, r) => a + r.leads, 0),
      resgatados: meus.reduce((a, r) => a + r.resgatados, 0),
      cliques: meus.reduce((a, r) => a + r.cliques, 0),
      nao_retornados: perdidos[m.telefone] || 0,
      recepcao: recepcao[m.telefone] || 0,
      ultimo,
      porEmp,
      naRoleta: cad ? cad.emps.length : 0,
      ativo: !!(cad && cad.ativo),
    };
  }).sort((a, b) => b.leads - a.leads || a.nome.localeCompare(b.nome, 'pt-BR'));

  const fones = equipe.map(m => m.telefone);
  const nomePorFone = Object.fromEntries(linhas.map(l => [l.telefone, l.nome]));
  const recentes = (await db.leadsDaEquipe(fones, per.desde, per.ate, 300)).map(r => ({
    ...r,
    corretor: nomePorFone[r.corretor_fone] || r.corretor_fone,
    emp: nomesEmp[r.empreendimento_id] || 'Empreendimento excluído',
  }));

  // Leads por empreendimento, somando a equipe toda.
  const porEmpMapa = {};
  for (const l of linhas) for (const e of l.porEmp) porEmpMapa[e.nome] = (porEmpMapa[e.nome] || 0) + e.leads;
  const porEmp = Object.entries(porEmpMapa).map(([nome, leads]) => ({ nome, leads })).sort((a, b) => b.leads - a.leads);

  const total = {
    leads: linhas.reduce((a, l) => a + l.leads, 0),
    resgatados: linhas.reduce((a, l) => a + l.resgatados, 0),
    nao_retornados: linhas.reduce((a, l) => a + l.nao_retornados, 0),
    recepcao: linhas.reduce((a, l) => a + l.recepcao, 0),
    corretores: linhas.length,
  };

  return { gestor, per, periodos: PERIODOS, linhas, porEmp, recentes, total };
}

module.exports = { CANAIS, hashSenha, confereSenha, usuarioValido, periodo, painel, PERIODOS, nomesDosEmps };
