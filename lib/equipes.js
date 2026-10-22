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

// Como anda o atendimento, contado pelo corretor no link do "Recebi".
const RETORNOS = {
  sem_contato: 'Ainda não consegui falar',
  conversando: 'Conversando com o cliente',
  visita: 'Visita agendada',
  proposta: 'Proposta / negociação',
  fechou: 'Fechou negócio',
  sem_perfil: 'Sem perfil / desistiu',
};

// Por onde o lead chegou na recepção (opcional no envio).
const CANAIS = ['Site / LP', 'Instagram', 'Facebook', 'Google', 'Portais', 'Placa', 'Indicação', 'Outro'];

// ---- Métricas ----
// Só conta envios que tinham o link "Recebi" (os antigos não tinham).
function confirmacoes(envios) {
  const comLink = envios.filter(e => e.token);
  const ok = comLink.filter(e => e.confirmado_em);
  const minutos = ok.map(e => (new Date(e.confirmado_em) - new Date(e.created_at)) / 60000).filter(m => m >= 0);
  return {
    comLink: comLink.length,
    confirmados: ok.length,
    pendentes: comLink.length - ok.length,
    tempoMedio: minutos.length ? minutos.reduce((a, m) => a + m, 0) / minutos.length : null,
  };
}

function duracao(min) {
  if (min == null) return '—';
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return Math.round(min) + ' min';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h < 24 ? h + ' h' + (m ? ' ' + m + ' min' : '') : Math.floor(h / 24) + ' dia(s)';
}

async function nomesDosEmps() {
  const emps = await db.list({});
  const nomes = { 0: 'Portal (página principal)' };
  for (const e of emps) nomes[e.id] = e.nome;
  return nomes;
}

async function painel(gestor, chavePeriodo) {
  const per = periodo(chavePeriodo);
  const [equipe, unicos, porFone, perdidos, nomesEmp, envios, agencia] = await Promise.all([
    db.listEquipe(gestor.id),
    db.corretoresUnicos(),
    db.cliquesPorFone(per.desde, per.ate),
    db.naoRetornadosPorFone(per.desde, per.ate),
    nomesDosEmps(),
    db.encaminhamentosPorFone(per.desde, per.ate),
    db.listAgencia({ ativosOnly: true }),
  ]);
  const naRecepcao = new Set(agencia.map(a => a.telefone));
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
      naRecepcao: naRecepcao.has(m.telefone),
      // Ativo = recebe leads por algum caminho: roleta das páginas ou recepção.
      ativo: !!(cad && cad.ativo) || naRecepcao.has(m.telefone),
    };
  }).sort((a, b) => b.leads - a.leads || a.nome.localeCompare(b.nome, 'pt-BR'));

  const fones = equipe.map(m => m.telefone);
  const nomePorFone = Object.fromEntries(linhas.map(l => [l.telefone, l.nome]));
  const recentes = (await db.leadsDaEquipe(fones, per.desde, per.ate, 300)).map(r => ({
    ...r,
    corretor: nomePorFone[r.corretor_fone] || r.corretor_fone,
    emp: nomesEmp[r.empreendimento_id] || 'Empreendimento excluído',
  }));

  // Leads que a recepção encaminhou para a equipe, com os dados do cliente.
  const daRecepcao = (await db.leadsRecepcao(per.desde, per.ate, fones, 300)).map(r => ({
    ...r, corretor: nomePorFone[r.corretor_fone] || r.corretor_nome,
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

  // Confirmação do corretor (link "Recebi"): quanto tempo levou e quem não confirmou.
  const conf = confirmacoes(daRecepcao);
  for (const l of linhas) {
    const c = confirmacoes(daRecepcao.filter(r => r.corretor_fone === l.telefone));
    l.confirmados = c.confirmados; l.semConfirmar = c.pendentes; l.tempoMedio = c.tempoMedio;
  }
  total.confirmados = conf.confirmados;
  total.semConfirmar = conf.pendentes;
  total.tempoMedio = conf.tempoMedio;

  // SDR: ligações do período (de toda a operação) e o que aconteceu com os
  // leads que ele mandou para os corretores desta equipe.
  const sdr = require('./sdr');
  const ligs = sdr.resumoLigacoes(await sdr.ligacoesPeriodo(per.desde, per.ate));
  const doSdr = daRecepcao.filter(r => r.fonte === 'sdr' && !r.substituido_por);
  const sdrPainel = (ligs.ligacoes || doSdr.length)
    ? { ...ligs, tempoMedio: sdr.minSeg(ligs.tempoMedioS), equipe: sdr.resumoRetornos(doSdr) }
    : null;

  return { gestor, per, periodos: PERIODOS, linhas, porEmp, recentes, daRecepcao, total, duracao, sdr: sdrPainel, RETORNOS };
}

module.exports = { RETORNOS, duracao, confirmacoes, CANAIS, hashSenha, confereSenha, usuarioValido, periodo, painel, PERIODOS, nomesDosEmps };

// ---- Auditoria da recepção no período ----
// Horário comercial: segunda a sábado, 8h às 19h (Brasília).
function foraDoHorario(d) {
  const local = new Date(new Date(d).getTime() - FUSO_MS);
  const dia = local.getUTCDay(), h = local.getUTCHours();
  return dia === 0 || h < 8 || h >= 19;
}

// Fechamento: chegaram × encaminhados × descartados × pendentes, tempo de
// espera na fila (chegada → encaminhamento) e motivos de descarte.
function fechamento(entradas, envios, usuarios, formulariosLp) {
  const enc = entradas.filter(e => e.status === 'encaminhado');
  const desc = entradas.filter(e => e.status === 'descartado');
  const pend = entradas.filter(e => e.status === 'pendente');
  const espera = enc.map(e => (new Date(e.tratado_em) - new Date(e.recebido_em || e.created_at)) / 60000).filter(m => m >= 0);
  const media = espera.length ? espera.reduce((a, m) => a + m, 0) / espera.length : null;
  const nomes = Object.fromEntries((usuarios || []).map(u => [u.id, u.nome]));
  const porPessoa = {};
  for (const e of enc) {
    const k = nomes[e.tratado_por] || '—';
    const m = (new Date(e.tratado_em) - new Date(e.recebido_em || e.created_at)) / 60000;
    porPessoa[k] = porPessoa[k] || { n: 0, soma: 0 };
    porPessoa[k].n++; porPessoa[k].soma += Math.max(0, m);
  }
  const motivos = {};
  for (const d of desc) { const m = (d.motivo || 'sem motivo').toLowerCase(); motivos[m] = (motivos[m] || 0) + 1; }
  // Colados à mão: sem fila de e-mail, que não são reencaminhamento de outro
  // envio e que não vieram das ligações do SDR.
  const reenc = new Set(envios.map(e => e.substituido_por).filter(Boolean));
  const manuais = envios.filter(e => !e.entrada_id && !reenc.has(e.id) && e.fonte !== 'sdr').length;
  return {
    chegaram: entradas.length,
    encaminhados: enc.length,
    descartados: desc.length,
    pendentes: pend.length,
    esperaMedia: media,
    acima30: espera.filter(m => m > 30).length,
    foraHorario: entradas.filter(e => foraDoHorario(e.recebido_em || e.created_at)).length,
    porPessoa: Object.entries(porPessoa).map(([nome, v]) => ({ nome, n: v.n, media: v.soma / v.n })),
    motivos: Object.entries(motivos).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
    listaDescartes: desc.slice(-20).reverse(),
    manuais,
    formulariosLp: formulariosLp || 0,
    fecha: entradas.length === enc.length + desc.length + pend.length,
  };
}

module.exports.fechamento = fechamento;
module.exports.foraDoHorario = foraDoHorario;
