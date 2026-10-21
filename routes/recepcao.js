// Recepção: a recepcionista cola a mensagem do lead, confere os campos que
// o sistema separou e toca no corretor. O WhatsApp abre com o lead
// organizado, e o envio fica registrado com os dados do lead (auditoria e
// painel dos gestores).
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const equipes = require('../lib/equipes');
const parser = require('../public/js/lead-parser');
const { exigeEquipe } = require('./gestor');

router.get('/login', (req, res) => res.redirect('/gestor/login'));
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/gestor/login'));
});

router.use(exigeEquipe('recepcao'));

router.get('/', async (req, res, next) => {
  try {
    const [corretores, recentes, campanhas, fila] = await Promise.all([
      db.listAgencia({ ativosOnly: true }),
      db.encaminhamentosRecentes(req.gestor.id, 30),
      estadoCampanhas(),
      filaPendentes(),
    ]);
    const hoje = equipes.periodo('hoje');
    const deHoje = recentes.filter(r => new Date(r.created_at) >= hoje.desde).length;
    res.set('Cache-Control', 'no-store');
    res.render('recepcao/painel', {
      title: 'Recepção · Encaminhar leads', usuario: req.gestor, corretores, recentes, deHoje,
      canais: equipes.CANAIS, campanhas, fila,
    });
  } catch (e) { next(e); }
});

// ---- Fila "A encaminhar": leads que chegaram sozinhos por e-mail ----
async function filaPendentes() {
  const lista = await db.listEntradas('pendente', 100);
  return Promise.all(lista.map(async (e) => {
    const d = e.dados || {};
    const ult = d.telefone ? await db.ultimoEnvioDoLead(d.telefone) : null;
    return {
      id: e.id, recebido: e.recebido_em || e.created_at, assunto: e.assunto, remetente: e.remetente,
      dados: d, bruto: e.bruto,
      jaEnviado: ult ? { corretor: ult.corretor_nome, quando: ult.created_at } : null,
    };
  }));
}

// Enviado: sai da fila, ligado ao envio (quem, para quem, quando).
async function baixarDaFila(entradaId, envio, usuarioId) {
  if (!entradaId) return;
  try {
    await db.tratarEntrada(entradaId, { status: 'encaminhado', encaminhamento_id: envio && envio.id, tratado_por: usuarioId });
  } catch (e) { console.error('[recepcao] falha ao baixar da fila:', e.message); }
}

router.get('/fila', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, fila: await filaPendentes() });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// Spam, teste, lead repetido: sai da fila com o motivo (fica no histórico).
router.post('/fila/:id/descartar', async (req, res) => {
  try {
    const motivo = String(req.body.motivo || '').trim().slice(0, 200) || 'sem motivo';
    const e = await db.tratarEntrada(req.params.id, { status: 'descartado', tratado_por: req.gestor.id, motivo });
    res.json({ ok: !!e });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// ---- Campanhas (roleta de um empreendimento dentro da recepção) ----
// fila: ordem da roleta (o primeiro é o próximo da vez); envios: o que a
// recepção já mandou nessa campanha, para ela marcar quem recebeu.
async function estadoCampanha(emp) {
  const [fila, envios] = await Promise.all([db.filaCorretores(emp.id), db.enviosDaCampanha(emp.id, 40)]);
  return {
    id: emp.id, nome: emp.nome,
    fila: fila.map(c => ({ id: c.id, nome: c.nome, telefone: parser.normalizarFone(c.telefone), atribuicoes: c.atribuicoes, ultima: c.ultima_atribuicao })),
    envios: envios.map(e => ({ quando: e.created_at, corretor: e.corretor_nome, cliente: e.lead_nome })),
  };
}

async function estadoCampanhas() {
  return Promise.all((await db.listCampanhasRecepcao()).map(estadoCampanha));
}

async function campanhaDe(id) {
  return (await db.listCampanhasRecepcao()).find(c => c.id === Number(id)) || null;
}

router.get('/campanha/:id', async (req, res) => {
  try {
    const emp = await campanhaDe(req.params.id);
    if (!emp) return res.status(404).json({ ok: false });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, campanha: await estadoCampanha(emp) });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

router.post('/campanha/:id/enviar', async (req, res) => {
  try {
    const emp = await campanhaDe(req.params.id);
    if (!emp) return res.status(404).json({ ok: false });
    const b = req.body;
    // Grava a vez para o corretor que ela recebeu na tela (e já abriu no WhatsApp).
    const c = await db.atribuirCorretor(emp.id, b.corretor_id);
    if (!c) return res.status(409).json({ ok: false, erro: 'Corretor fora da roleta.' });
    const canal = equipes.CANAIS.includes(b.canal) ? b.canal : null;
    const env = await db.registrarEncaminhamento({
      usuario_id: req.gestor.id, corretor_fone: c.telefone, corretor_nome: c.nome, canal,
      lead_nome: b.nome, lead_telefone: parser.normalizarFone(b.telefone), lead_email: b.email,
      negocio: b.negocio, imovel: b.imovel, origem: b.origem || emp.nome, mensagem: b.mensagem,
      empreendimento_id: emp.id, entrada_id: b.entrada_id, token: b.token,
    });
    await baixarDaFila(b.entrada_id, env, req.gestor.id);
    res.json({ ok: true, campanha: await estadoCampanha(emp) });
  } catch (e) {
    console.error('[recepcao] falha no envio da campanha:', e.message);
    res.status(500).json({ ok: false });
  }
});

// Chamado pelo clique no nome (antes de abrir o WhatsApp). Um erro aqui não
// pode impedir o envio: a tela abre o WhatsApp de qualquer jeito.
router.post('/enviar', async (req, res) => {
  try {
    const c = await db.getAgencia(req.body.corretor_id);
    if (!c) return res.status(404).json({ ok: false });
    const b = req.body;
    const canal = equipes.CANAIS.includes(b.canal) ? b.canal : null;
    const env = await db.registrarEncaminhamento({
      usuario_id: req.gestor.id, corretor_fone: c.telefone, corretor_nome: c.nome, canal,
      lead_nome: b.nome, lead_telefone: parser.normalizarFone(b.telefone), lead_email: b.email,
      negocio: b.negocio, imovel: b.imovel, origem: b.origem, mensagem: b.mensagem,
      entrada_id: b.entrada_id, token: b.token,
    });
    await baixarDaFila(b.entrada_id, env, req.gestor.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[recepcao] falha ao registrar envio:', e.message);
    res.status(500).json({ ok: false });
  }
});

// Este cliente já foi encaminhado? Só um aviso na tela: a decisão é dela.
router.get('/lead', async (req, res) => {
  try {
    const u = await db.ultimoEnvioDoLead(parser.normalizarFone(req.query.tel));
    res.json({ ok: true, ultimo: u ? { corretor: u.corretor_nome, quando: u.created_at } : null });
  } catch (e) {
    res.json({ ok: false });
  }
});

module.exports = router;
