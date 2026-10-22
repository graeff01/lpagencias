// SDR: liga para a lista de clientes, segue o roteiro, preenche a ficha e
// manda quem tem interesse para o corretor do plantão (WhatsApp com a ficha
// e o link "Recebi"). Toda ligação fica registrada, atendida ou não.
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const sdr = require('../lib/sdr');
const equipes = require('../lib/equipes');
const parser = require('../public/js/lead-parser');
const { exigeEquipe } = require('./gestor');

const MIN_COBRAR = Math.max(5, Number(process.env.RECEPCAO_COBRAR_MIN) || 30);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/gestor/login'));
});

router.use(exigeEquipe('sdr'));

function contatoJson(c) {
  if (!c) return null;
  return {
    id: c.id, nome: c.nome || '', telefone: c.telefone, telefone2: c.telefone2, email: c.email || '',
    info: c.info || {}, status: c.status, statusRotulo: sdr.STATUS[c.status] || c.status,
    tentativas: c.tentativas || 0, retornarEm: c.retornar_em, ultimaLigacao: c.ultima_ligacao,
  };
}

function plantaoJson(fila) {
  return fila.map(c => ({ id: c.id, nome: c.nome, telefone: c.telefone, atribuicoes: c.atribuicoes, ultima: c.ultima_atribuicao }));
}

async function pendencias(usuarioId) {
  const lista = await sdr.pendenciasSdr(usuarioId, MIN_COBRAR);
  const ids = {};
  for (const e of lista) {
    const { rows } = await db.query('SELECT id FROM sdr_contatos WHERE telefone=$1', [e.lead_telefone]);
    ids[e.id] = rows[0] ? rows[0].id : null;
  }
  return lista.map(e => ({
    id: e.id, contatoId: ids[e.id], quando: e.created_at, corretor: e.corretor_nome, corretorFone: e.corretor_fone, token: e.token,
    cobrancas: e.cobrancas || 0, ultimaCobranca: e.ultima_cobranca, lead: { nome: e.lead_nome, telefone: e.lead_telefone },
  }));
}

async function numerosDeHoje(usuarioId) {
  const hoje = equipes.periodo('hoje');
  const r = sdr.resumoLigacoes(await sdr.ligacoesPeriodo(hoje.desde, hoje.ate, usuarioId));
  r.tempoMedio = sdr.minSeg(r.tempoMedioS);
  return r;
}

const HORAS_RETORNO = Math.max(1, Number(process.env.SDR_RETORNO_HORAS) || 24);

async function retornos(usuarioId) {
  return (await sdr.retornosAPedir(usuarioId, HORAS_RETORNO)).map(e => ({
    id: e.id, quando: e.created_at, confirmado: e.confirmado_em, corretor: e.corretor_nome, corretorFone: e.corretor_fone,
    token: e.token, pedidos: e.retorno_pedidos || 0, ultimoPedido: e.retorno_pedido_em, lead: { nome: e.lead_nome, telefone: e.lead_telefone },
  }));
}

async function agenda() {
  return (await sdr.agendaHoje()).map(c => ({ id: c.id, nome: c.nome, telefone: c.telefone, quando: c.retornar_em }));
}

router.get('/', async (req, res, next) => {
  try {
    const [plantao, lista, hoje, pend, script, recentes, ret, ag, metas, mensagens] = await Promise.all([
      sdr.filaPlantao(), sdr.resumoLista(), numerosDeHoje(req.gestor.id), pendencias(req.gestor.id), sdr.getScript(),
      sdr.ligacoesPeriodo(new Date(Date.now() - 7 * 864e5), new Date(Date.now() + 60000), req.gestor.id),
      retornos(req.gestor.id), agenda(), sdr.getMetas(), sdr.getMensagens(),
    ]);
    res.set('Cache-Control', 'no-store');
    res.render('sdr/painel', {
      title: 'SDR · Ligações', usuario: req.gestor, plantao: plantaoJson(plantao), lista, hoje, pend, script,
      ficha: sdr.FICHA, resultados: sdr.RESULTADOS, minCobrar: MIN_COBRAR,
      recentes: recentes.slice(0, 30), retornos: ret, agenda: ag, metas, mensagens, horasRetorno: HORAS_RETORNO,
    });
  } catch (e) { next(e); }
});

// Próximo da lista (reserva o contato para este SDR por 20 min).
router.get('/proximo', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const c = await sdr.proximoContato(req.gestor.id, req.query.pular);
    res.json({ ok: true, contato: contatoJson(c), lista: await sdr.resumoLista() });
  } catch (e) { console.error('[sdr] próximo:', e.message); res.status(500).json({ ok: false }); }
});

router.get('/buscar', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, contatos: (await sdr.buscarContatos(req.query.q, 15)).map(contatoJson) });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// Abrir um contato específico (da busca) ou cadastrar alguém fora da lista.
router.get('/contato/:id', async (req, res) => {
  try {
    const c = await sdr.getContato(req.params.id);
    if (!c) return res.status(404).json({ ok: false });
    await sdr.reservar(c.id, req.gestor.id);
    const ligs = await sdr.ligacoesDoContato(c.id);
    const comFicha = ligs.find(l => l.ficha);
    let ultimaFicha = comFicha ? comFicha.ficha : null;
    if (typeof ultimaFicha === 'string') { try { ultimaFicha = JSON.parse(ultimaFicha); } catch (e) { ultimaFicha = null; } }
    res.json({
      ok: true, contato: contatoJson(c), ultimaFicha,
      historico: ligs.map(l => ({ quando: l.created_at, resultado: (sdr.RESULTADOS[l.resultado] || {}).rotulo || l.resultado, classe: l.classificacao })),
    });
  } catch (e) { res.status(500).json({ ok: false }); }
});

router.post('/contato', async (req, res) => {
  try {
    const c = await sdr.criarContato(req.body);
    if (!c) return res.status(400).json({ ok: false, erro: 'Informe um telefone válido, com DDD.' });
    await sdr.reservar(c.id, req.gestor.id);
    res.json({ ok: true, contato: contatoJson(c) });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// Ligação sem envio: não atendeu, ligar depois, sem interesse, não ligar, número errado.
router.post('/contato/:id/resultado', async (req, res) => {
  try {
    const c = await sdr.getContato(req.params.id);
    const r = String(req.body.resultado || '');
    if (!c || !sdr.RESULTADOS[r] || r === 'qualificado') return res.status(400).json({ ok: false });
    let retornarEm = null;
    if (r === 'retornar') {
      retornarEm = new Date(req.body.retornar_em);
      if (isNaN(retornarEm)) return res.status(400).json({ ok: false, erro: 'Escolha quando ligar de novo.' });
    }
    const temFicha = req.body.ficha && Object.keys(req.body.ficha).length;
    await sdr.registrarLigacao({ contato: c, usuarioId: req.gestor.id, resultado: r, ficha: temFicha ? sdr.fichaLimpa(req.body.ficha) : null, retornarEm, duracaoS: req.body.duracao_s });
    res.json({ ok: true, hoje: await numerosDeHoje(req.gestor.id) });
  } catch (e) { console.error('[sdr] resultado:', e.message); res.status(500).json({ ok: false }); }
});

// Qualificado: o SDR tocou no corretor do plantão (o WhatsApp já abriu com a
// ficha). Aqui grava a vez, o envio (com o link "Recebi") e a ligação.
router.post('/contato/:id/enviar', async (req, res) => {
  try {
    const c = await sdr.getContato(req.params.id);
    if (!c) return res.status(404).json({ ok: false });
    const ficha = sdr.fichaLimpa(req.body.ficha || {});
    const corretor = await sdr.atribuirPlantao(req.body.corretor_id);
    if (!corretor) return res.status(409).json({ ok: false, erro: 'Corretor fora do plantão.' });
    const classe = sdr.classificar(ficha);
    const nome = String(req.body.nome || c.nome || '').trim();
    const env = await db.registrarEncaminhamento({
      usuario_id: req.gestor.id, corretor_fone: corretor.telefone, corretor_nome: corretor.nome, fonte: 'sdr',
      lead_nome: nome, lead_telefone: c.telefone, lead_email: c.email,
      negocio: 'Investimento', origem: 'Ligação SDR' + (classe ? ' · ' + classe : ''),
      mensagem: [ficha.objetivo, ficha.faixa, ficha.pagamento, ficha.prazo, ficha.obs].filter(Boolean).join(' · '),
      token: req.body.token,
    });
    // Reencaminhando um envio que o corretor não confirmou: o antigo aponta para este.
    const de = Number(req.body.reencaminhar_de) || null;
    if (de) {
      const antigo = await db.getEncaminhamento(de);
      if (antigo && antigo.usuario_id === req.gestor.id) await db.substituirEnvio(de, env.id);
    }
    if (nome && nome !== c.nome) await db.query('UPDATE sdr_contatos SET nome=$1, busca=$2 WHERE id=$3', [nome.slice(0, 120), sdr.semAcento(nome), c.id]);
    // Reencaminhar não é ligação nova (não conta de novo como qualificado).
    if (!de) await sdr.registrarLigacao({ contato: { ...c, nome: nome || c.nome }, usuarioId: req.gestor.id, resultado: 'qualificado', ficha, encaminhamentoId: env.id, duracaoS: req.body.duracao_s });
    await db.registrarEvento({
      tipo: de ? 'reencaminhado' : 'encaminhado', lead_nome: nome, lead_telefone: c.telefone, encaminhamento_id: env.id,
      corretor_nome: corretor.nome, corretor_fone: corretor.telefone, usuario_id: req.gestor.id,
      detalhe: [de ? 'no lugar do envio #' + de + ' (sem confirmação)' : null, 'ligação do SDR', 'plantão', classe ? 'lead ' + classe : null].filter(Boolean).join(' · '),
    });
    res.json({ ok: true, plantao: plantaoJson(await sdr.filaPlantao()), hoje: await numerosDeHoje(req.gestor.id) });
  } catch (e) {
    console.error('[sdr] envio:', e.message);
    res.status(500).json({ ok: false });
  }
});

router.get('/plantao', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, plantao: plantaoJson(await sdr.filaPlantao()) });
  } catch (e) { res.status(500).json({ ok: false }); }
});

router.get('/pendencias', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, pendencias: await pendencias(req.gestor.id) });
  } catch (e) { res.status(500).json({ ok: false }); }
});

router.post('/envio/:id/cobrar', async (req, res) => {
  try {
    const atual = await db.getEncaminhamento(req.params.id);
    if (!atual || atual.usuario_id !== req.gestor.id) return res.status(404).json({ ok: false });
    const e = await db.registrarCobranca(atual.id);
    await db.registrarEvento({
      tipo: 'cobranca', encaminhamento_id: e.id, lead_nome: e.lead_nome, lead_telefone: e.lead_telefone,
      corretor_nome: e.corretor_nome, corretor_fone: e.corretor_fone, usuario_id: req.gestor.id,
      detalhe: e.cobrancas + 'ª cobrança (SDR)',
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// Agenda (retornos de hoje), pedidos de retorno e números: a tela atualiza sozinha.
router.get('/painel', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const [ag, ret, hoje] = await Promise.all([agenda(), retornos(req.gestor.id), numerosDeHoje(req.gestor.id)]);
    res.json({ ok: true, agenda: ag, retornos: ret, hoje });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// O SDR abriu o WhatsApp do corretor pedindo o retorno do atendimento.
router.post('/envio/:id/pedir-retorno', async (req, res) => {
  try {
    const atual = await db.getEncaminhamento(req.params.id);
    if (!atual || atual.usuario_id !== req.gestor.id) return res.status(404).json({ ok: false });
    const e = await db.registrarPedidoRetorno(atual.id);
    await db.registrarEvento({
      tipo: 'pedido_retorno', encaminhamento_id: e.id, lead_nome: e.lead_nome, lead_telefone: e.lead_telefone,
      corretor_nome: e.corretor_nome, corretor_fone: e.corretor_fone, usuario_id: req.gestor.id,
      detalhe: e.retorno_pedidos + 'º pedido',
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// Mensagem pronta mandada ao cliente (tentativa de contato ou apresentação do corretor).
router.post('/contato/:id/whats', async (req, res) => {
  try {
    const c = await sdr.getContato(req.params.id);
    const tipo = req.body.tipo === 'apresentacao' ? 'apresentacao' : 'tentativa';
    if (!c) return res.status(404).json({ ok: false });
    await db.registrarEvento({
      tipo: 'sdr_whats', lead_nome: c.nome, lead_telefone: c.telefone, usuario_id: req.gestor.id,
      detalhe: tipo === 'apresentacao' ? 'avisou que o corretor vai chamar' : 'mensagem de tentativa de contato',
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// Este cliente já foi mandado para algum corretor? Só um aviso.
router.get('/lead', async (req, res) => {
  try {
    const u = await db.ultimoEnvioDoLead(parser.normalizarFone(req.query.tel));
    res.json({ ok: true, ultimo: u ? { corretor: u.corretor_nome, quando: u.created_at } : null });
  } catch (e) { res.json({ ok: false }); }
});

module.exports = router;
