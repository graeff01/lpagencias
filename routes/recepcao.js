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
const caixa = require('../lib/caixa-leads');

router.get('/login', (req, res) => res.redirect('/gestor/login'));
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/gestor/login'));
});

router.use(exigeEquipe('recepcao'));

router.get('/', async (req, res, next) => {
  try {
    const [corretores, recentes, campanhas, fila, pendencias] = await Promise.all([
      db.listAgencia({ ativosOnly: true }),
      db.encaminhamentosRecentes(req.gestor.id, 30),
      estadoCampanhas(),
      filaPendentes(),
      pendenciasConfirmacao(),
    ]);
    const hoje = equipes.periodo('hoje');
    const deHoje = recentes.filter(r => new Date(r.created_at) >= hoje.desde).length;
    res.set('Cache-Control', 'no-store');
    res.render('recepcao/painel', {
      title: 'Recepção · Encaminhar leads', usuario: req.gestor, corretores, recentes, deHoje,
      canais: equipes.CANAIS, campanhas, fila, pendencias, minCobrar: MIN_COBRAR,
      caixaAlerta: await caixa.alerta().catch(() => null),
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

// Auditoria do envio: um evento "encaminhado" (ou "reencaminhado") por envio.
async function eventoEnvio(env, req, campanha) {
  if (!env) return;
  const b = req.body;
  const detalhe = [
    b.reencaminhar_de ? null : (b.entrada_id ? 'da fila de e-mail' : 'colado pela recepção'),
    campanha ? 'campanha ' + campanha : null,
    env.canal, env.origem,
  ].filter(Boolean).join(' · ');
  await db.registrarEvento({
    tipo: b.reencaminhar_de ? 'reencaminhado' : 'encaminhado',
    lead_nome: env.lead_nome, lead_telefone: env.lead_telefone, entrada_id: env.entrada_id,
    encaminhamento_id: env.id, empreendimento_id: env.empreendimento_id,
    corretor_nome: env.corretor_nome, corretor_fone: env.corretor_fone, usuario_id: req.gestor.id,
    detalhe: b.reencaminhar_de ? ['no lugar do envio #' + Number(b.reencaminhar_de) + ' (sem confirmação)', detalhe].filter(Boolean).join(' · ') : detalhe,
  });
}

router.get('/fila', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, fila: await filaPendentes() });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// ---- Sem confirmação: cobrar o corretor ou reencaminhar ----
const MIN_COBRAR = Math.max(5, Number(process.env.RECEPCAO_COBRAR_MIN) || 30);

async function pendenciasConfirmacao() {
  return (await db.enviosSemConfirmacao(MIN_COBRAR, 48)).map(e => ({
    id: e.id, quando: e.created_at, corretor: e.corretor_nome, corretorFone: e.corretor_fone,
    token: e.token, cobrancas: e.cobrancas || 0, ultimaCobranca: e.ultima_cobranca,
    lead: { nome: e.lead_nome, telefone: e.lead_telefone, email: e.lead_email, negocio: e.negocio,
      imovel: e.imovel, origem: e.origem, mensagem: e.mensagem, canal: e.canal },
    campanha: e.empreendimento_id,
  }));
}

router.get('/pendencias', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, pendencias: await pendenciasConfirmacao(), minutos: MIN_COBRAR });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// A recepção abriu o WhatsApp do corretor com um lembrete (o link "Recebi" vai junto).
router.post('/envio/:id/cobrar', async (req, res) => {
  try {
    const e = await db.registrarCobranca(req.params.id);
    if (e) {
      await db.registrarEvento({
        tipo: 'cobranca', encaminhamento_id: e.id, lead_nome: e.lead_nome, lead_telefone: e.lead_telefone,
        corretor_nome: e.corretor_nome, corretor_fone: e.corretor_fone, usuario_id: req.gestor.id,
        detalhe: e.cobrancas + 'ª cobrança',
      });
    }
    res.json({ ok: !!e });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// A recepção abriu um lead da fila para encaminhar (mede a espera até ela pegar).
router.post('/fila/:id/abrir', async (req, res) => {
  try {
    const e = await db.getEntrada(req.params.id);
    if (e && e.status === 'pendente') {
      await db.registrarEvento({ tipo: 'fila_aberta', entrada_id: e.id, lead_nome: e.dados.nome, lead_telefone: e.dados.telefone, usuario_id: req.gestor.id });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

// Spam, teste, lead repetido: sai da fila com o motivo (fica no histórico).
router.post('/fila/:id/descartar', async (req, res) => {
  try {
    const motivo = String(req.body.motivo || '').trim().slice(0, 200) || 'sem motivo';
    const e = await db.tratarEntrada(req.params.id, { status: 'descartado', tratado_por: req.gestor.id, motivo });
    if (e) {
      await db.registrarEvento({
        tipo: 'descartado', entrada_id: e.id, lead_nome: e.dados.nome, lead_telefone: e.dados.telefone,
        usuario_id: req.gestor.id, detalhe: motivo,
      });
    }
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
    if (b.reencaminhar_de) await db.substituirEnvio(b.reencaminhar_de, env.id);
    await baixarDaFila(b.entrada_id, env, req.gestor.id);
    await eventoEnvio(env, req, emp.nome);
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
    if (b.reencaminhar_de) await db.substituirEnvio(b.reencaminhar_de, env.id);
    await baixarDaFila(b.entrada_id, env, req.gestor.id);
    await eventoEnvio(env, req, null);
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
