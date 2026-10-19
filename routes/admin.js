const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { slugify, asArray } = require('../lib/helpers');
const { uploadBuffer, configured: cloudinaryOn } = require('../lib/cloudinary');
const roleta = require('../lib/roleta');
const portal = require('../lib/portal');
const checklist = require('../lib/checklist');
const dominios = require('../lib/dominios');
const pois = require('../lib/pois');

// Endereços que não podem virar slug de empreendimento: o portal usa
// /wa/portal para a roleta dele, e os demais são rotas do próprio site.
const SLUGS_RESERVADOS = new Set(['portal', 'encontre', 'admin', 'gestor', 'recepcao', 'wa', 'robots-txt', 'sitemap-xml', 'css', 'js', 'img']);
const PORTAL_ID = 0;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
// Senha de quem só cadastra empreendimentos: não vê corretores nem leads
// (dados pessoais), não exclui nada e não mexe na configuração do portal.
const CADASTRO_PASSWORD = process.env.CADASTRO_PASSWORD || '';

const { ipDe, bloqueado, registrarFalha, limpar: limparTentativas } = require('../lib/tentativas');
const equipes = require('../lib/equipes');

// ---- Middleware de autenticação ----
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

// ---- Login ----
router.get('/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Entrar · Painel', error: null });
});

router.post('/login', (req, res) => {
  const ip = ipDe(req);
  const minutos = bloqueado(ip);
  if (minutos) {
    return res.status(429).render('admin/login', {
      title: 'Entrar · Painel',
      error: `Muitas tentativas. Tente novamente em ${minutos} minuto(s).`,
    });
  }
  const senha = req.body.password;
  const papel = senha === ADMIN_PASSWORD ? 'admin'
    : (CADASTRO_PASSWORD && senha === CADASTRO_PASSWORD ? 'cadastro' : null);
  if (papel) {
    limparTentativas(ip);
    return req.session.regenerate((err) => {   // evita fixação de sessão
      if (err) return res.status(500).render('admin/login', { title: 'Entrar · Painel', error: 'Erro ao entrar. Tente de novo.' });
      req.session.admin = true;   // logado no painel (vê rascunhos)
      req.session.papel = papel;
      res.redirect('/admin');
    });
  }
  registrarFalha(ip);
  res.status(401).render('admin/login', { title: 'Entrar · Painel', error: 'Senha incorreta. Tente novamente.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// A partir daqui, tudo exige login
router.use(requireAuth);
router.use((req, res, next) => {
  // Sessões abertas antes dos perfis existirem eram todas de administrador.
  res.locals.papel = req.session.papel || 'admin';
  res.locals.ehAdmin = res.locals.papel === 'admin';
  next();
});

function soAdmin(req, res, next) {
  if (res.locals.ehAdmin) return next();
  return res.status(403).render('404', { title: 'Acesso restrito ao administrador' });
}

// ---- Lista de empreendimentos ----
router.get('/', async (req, res, next) => {
  try {
    const emps = await db.list({});
    emps.forEach((e) => { e._ck = checklist.verificar(e); });
    const cfg = await portal.carregar();
    res.render('admin/list', { title: 'Empreendimentos · Painel', emps, q: req.query, portalExemplo: cfg._exemplo });
  } catch (e) { next(e); }
});

// ---- Novo / Editar ----
router.get('/novo', (req, res) => {
  res.render('admin/form', { title: 'Novo empreendimento', emp: null, cloudinaryOn, error: null, ck: null, q: req.query });
});

async function checklistCompleto(emp) {
  const ativos = (await db.listCorretores(emp.id, { ativosOnly: true })).length;
  return checklist.verificar(emp, { corretoresAtivos: ativos });
}

router.get('/editar/:id', async (req, res, next) => {
  try {
    const emp = await db.getById(req.params.id);
    if (!emp) return next();
    const ck = await checklistCompleto(emp);
    let error = null;
    if (req.query.rascunho) {
      error = '<b>Salvo como rascunho.</b> Para publicar, complete: '
        + ck.faltaObrig.map(i => i.txt).join(', ') + '.';
    }
    res.render('admin/form', { title: `Editar · ${emp.nome}`, emp, cloudinaryOn, error, ck, q: req.query });
  } catch (e) { next(e); }
});

// Converte o corpo do formulário no objeto de dados
function parseBody(body) {
  const jsonFields = ['gallery', 'infra', 'plantas', 'diferenciais', 'timeline', 'faq', 'pois', 'construtora_stats', 'acabamentos'];
  const data = { ...body };
  for (const f of jsonFields) {
    try { data[f] = body[f] ? JSON.parse(body[f]) : []; }
    catch { data[f] = []; }
  }
  data.published = body.published === 'on' || body.published === 'true' || body.published === true;
  return data;
}

// ---- Salvar (cria ou atualiza) ----
router.post('/salvar', async (req, res, next) => {
  try {
    const data = parseBody(req.body);
    const id = req.body.id ? Number(req.body.id) : null;

    // slug: usa o informado ou gera do nome; garante unicidade
    let slug = slugify(data.slug || data.nome);
    if (!slug) slug = 'empreendimento-' + Date.now();
    if (SLUGS_RESERVADOS.has(slug)) slug = `${slug}-empreendimento`;
    let n = 1, base = slug;
    while (await db.slugExists(slug, id)) { slug = `${base}-${++n}`; }
    data.slug = slug;

    // Primeira publicação só com o mínimo preenchido: sem isso entra no ar
    // uma landing sem foto ou sem o registro de incorporação exigido por lei.
    // Quem já está no ar continua no ar (o painel mostra o que falta).
    const anterior = id ? await db.getById(id) : null;
    const ck = checklist.verificar(data);
    let virouRascunho = false;
    // "Publicar mesmo com pendências": decisão explícita de quem cadastra;
    // o painel continua mostrando o que falta.
    const forcar = req.body.publicar_pendente === 'on';
    if (data.published && !ck.pronto && !forcar && !(anterior && anterior.published)) {
      data.published = false;
      virouRascunho = true;
    }

    let emp;
    if (id) emp = await db.update(id, data);
    else emp = await db.create(data);

    dominios.limparCache();
    pontosAutomaticos(emp);
    const passo = Number(req.body._passo) || 1;
    res.redirect(`/admin/editar/${emp.id}?salvo=1&passo=${passo}${virouRascunho ? '&rascunho=1' : ''}`);
  } catch (e) { next(e); }
});

// Pontos próximos automáticos: se o empreendimento tem endereço e a lista
// está vazia, ela é montada em segundo plano (a busca leva ~15-40 s e não
// pode segurar o salvar). Sem ponto confirmado no mapa, usa o endereço
// localizado automaticamente. Quem preencheu a lista à mão não é tocado.
function pontosAutomaticos(emp) {
  if (!emp) return;
  if (asArray(emp.pois).length) return coordsDosPontos(emp);
  if (!emp.endereco && !emp.bairro) return;
  (async () => {
    let lat = emp.lat, lon = emp.lon, novoPonto = false;
    if (lat == null || lon == null) {
      const [g] = await pois.geocodificar(emp);
      if (!g) return;
      lat = g.lat; lon = g.lon; novoPonto = true;
    }
    const lista = await pois.proximos(lat, lon);
    if (!lista.length) return;
    const atual = await db.getById(emp.id);
    if (!atual || asArray(atual.pois).length) return;   // alguém preencheu nesse meio-tempo
    await db.setPois(emp.id, lista, novoPonto ? lat : null, novoPonto ? lon : null);
  })().catch(e => console.error('[pois] automático falhou:', e.message));
}

// O mapa da landing mostra cada ponto da lista no lugar dele. Pontos sem
// coordenadas (antigos ou digitados à mão) são localizados em segundo plano;
// os que não forem achados continuam só na legenda.
function coordsDosPontos(emp) {
  return (async () => {
    let lat = emp.lat, lon = emp.lon, novoPonto = false;
    if (lat == null || lon == null || lat === '' || lon === '') {
      const [g] = await pois.geocodificar(emp);
      if (!g) return;
      lat = g.lat; lon = g.lon; novoPonto = true;
    }
    const nova = await pois.completarCoords(asArray(emp.pois), lat, lon);
    if (!nova && !novoPonto) return;
    const atual = await db.getById(emp.id);
    if (!atual || JSON.stringify(asArray(atual.pois)) !== JSON.stringify(asArray(emp.pois))) return;   // mudou nesse meio-tempo
    await db.setPois(emp.id, nova || asArray(emp.pois), novoPonto ? lat : null, novoPonto ? lon : null);
  })().catch(e => console.error('[pois] coordenadas falharam:', e.message));
}

// Na subida do servidor: completa os pontos de quem já estava cadastrado.
router.completarPontosExistentes = async function () {
  try {
    const todos = await db.list();
    for (const e of todos) await coordsDosPontos(e);
  } catch (e) { console.error('[pois] varredura inicial falhou:', e.message); }
};

// Usados pelo mapa do formulário (localizar o endereço e buscar o entorno).
router.get('/geo', async (req, res) => {
  try { res.json({ ok: true, candidatos: await pois.geocodificar(req.query) }); }
  catch (e) { res.status(502).json({ ok: false, erro: 'Não consegui localizar agora. Tente de novo em instantes.' }); }
});
router.get('/pois-proximos', async (req, res) => {
  try { res.json({ ok: true, pois: await pois.proximos(req.query.lat, req.query.lon) }); }
  catch (e) { res.status(502).json({ ok: false, erro: 'Busca indisponível agora. Tente de novo em instantes.' }); }
});

// ---- Excluir ----
router.post('/excluir/:id', soAdmin, async (req, res, next) => {
  try { await db.remove(req.params.id); dominios.limparCache(); res.redirect('/admin?del=1'); }
  catch (e) { next(e); }
});

// =====================================================================
//  ROLETA DE CORRETORES
// =====================================================================

// Corretores e leads são dados pessoais: só o administrador vê.
router.use(['/corretores', '/leads', '/portal', '/equipes', '/recepcao'], soAdmin);

// O portal não é uma linha da tabela de empreendimentos: tem id 0 e o
// WhatsApp reserva vem da configuração do portal.
async function carregarEmp(id) {
  if (Number(id) === PORTAL_ID) {
    const cfg = await portal.carregar();
    return { id: PORTAL_ID, slug: '', nome: 'Portal (página principal)', whatsapp: cfg.whatsapp, published: true };
  }
  return db.getById(id);
}

// ---- Cadastro dos corretores de um empreendimento ----
router.get('/corretores/:id', async (req, res, next) => {
  try {
    const emp = await carregarEmp(req.params.id);
    if (!emp) return next();
    const corretores = await db.listCorretores(emp.id);
    res.render('admin/corretores', {
      title: `Corretores · ${emp.nome}`, emp, corretores, q: req.query,
    });
  } catch (e) { next(e); }
});

router.post('/corretores/:id/salvar', async (req, res, next) => {
  try {
    const empId = Number(req.params.id);
    const b = req.body;
    const dados = {
      nome: String(b.nome || '').trim(),
      telefone: String(b.telefone || '').trim(),
      email: String(b.email || '').trim() || null,
      creci: String(b.creci || '').trim() || null,
      peso: Number(b.peso) || 1,
      ordem: Number(b.ordem) || 0,
      ativo: b.ativo === 'on' || b.ativo === 'true' || b.ativo === true,
    };
    if (!dados.nome || !dados.telefone) return res.redirect(`/admin/corretores/${empId}?erro=campos`);

    // Número inválido = leads caindo no vazio. Barra antes de entrar na fila.
    const numero = roleta.validarWhats(dados.telefone);
    if (!numero) return res.redirect(`/admin/corretores/${empId}?erro=telefone`);

    // Dois corretores com o mesmo número quebram a medição de quem recebeu o quê.
    const idAtual = b.corretor_id ? Number(b.corretor_id) : null;
    const jaExiste = (await db.listCorretores(empId))
      .some(c => c.id !== idAtual && roleta.digitos(c.telefone) === numero);
    if (jaExiste) return res.redirect(`/admin/corretores/${empId}?erro=duplicado`);

    if (idAtual) await db.updateCorretor(idAtual, dados);
    else await db.createCorretor(empId, dados);

    res.redirect(`/admin/corretores/${empId}?ok=1`);
  } catch (e) { next(e); }
});

router.post('/corretores/:id/excluir/:corretorId', async (req, res, next) => {
  try {
    await db.removeCorretor(Number(req.params.corretorId));
    res.redirect(`/admin/corretores/${req.params.id}?del=1`);
  } catch (e) { next(e); }
});

// Pausar / reativar sem perder o histórico
router.post('/corretores/:id/toggle/:corretorId', async (req, res, next) => {
  try {
    const c = await db.getCorretor(Number(req.params.corretorId));
    if (c) await db.updateCorretor(c.id, { ...c, ativo: !c.ativo });
    res.redirect(`/admin/corretores/${req.params.id}?ok=1`);
  } catch (e) { next(e); }
});

// Zera os contadores da fila (recomeça o rodízio do zero, o histórico fica)
router.post('/corretores/:id/zerar', async (req, res, next) => {
  try {
    await db.zerarContadores(Number(req.params.id));
    res.redirect(`/admin/corretores/${req.params.id}?zerado=1`);
  } catch (e) { next(e); }
});

// ---- Relatório de leads ----
router.get('/leads/:id', async (req, res, next) => {
  try {
    const emp = await carregarEmp(req.params.id);
    if (!emp) return next();
    const dias = req.query.dias ? Number(req.query.dias) : null;
    const [stats, perdidos, cliques, resumo] = await Promise.all([
      db.statsCorretores(emp.id, dias),
      db.naoRetornados(emp.id, dias),
      db.cliquesRecentes(emp.id, 200),
      db.resumoCliques(emp.id),
    ]);
    stats.forEach((s) => { s.nao_retornados = perdidos[s.id] || 0; });
    res.render('admin/leads', {
      title: `Leads · ${emp.nome}`, emp, stats, cliques, resumo, dias,
    });
  } catch (e) { next(e); }
});

// ---- Exportação CSV (auditoria completa) ----
router.get('/leads/:id/csv', async (req, res, next) => {
  try {
    const emp = await carregarEmp(req.params.id);
    if (!emp) return next();
    const linhas = await db.cliquesRecentes(emp.id, 10000);
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['data_hora', 'corretor', 'novo_lead', 'resgate', 'corretor_anterior', 'origem', 'motivo', 'bot', 'visitante', 'utm_source', 'utm_medium', 'utm_campaign', 'referer'];
    const csv = [head.join(';')].concat(linhas.map(l => [
      l.created_at ? new Date(l.created_at).toISOString() : '',
      l.corretor_nome || '(sem corretor)',
      l.novo_lead ? 'sim' : 'nao',
      l.resgate ? 'sim' : 'nao',
      l.corretor_anterior || '',
      l.origem || '', l.motivo || '', l.bot ? 'sim' : 'nao',
      l.visitante || '', l.utm_source || '', l.utm_medium || '', l.utm_campaign || '', l.referer || '',
    ].map(esc).join(';'))).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${emp.slug || 'portal'}.csv"`);
    res.send('﻿' + csv); // BOM para o Excel abrir com acento certo
  } catch (e) { next(e); }
});

// =====================================================================
//  EQUIPES  —  gestores e quais corretores são de cada um
// =====================================================================
router.get('/equipes', async (req, res, next) => {
  try {
    const [usuarios, unicos, membros, nomesEmp, agencia] = await Promise.all([
      db.listGestores(), db.corretoresUnicos(), db.listEquipes(), equipes.nomesDosEmps(), db.listAgencia(),
    ]);
    const gestores = usuarios.filter(u => (u.papel || 'gestor') === 'gestor');
    const dono = Object.fromEntries(membros.map(m => [m.telefone, m.gestor_id]));
    // Corretores da agência (lista da recepção) que não estão em roleta nenhuma.
    for (const a of agencia) {
      if (!unicos.some(u => u.telefone === a.telefone)) unicos.push({ telefone: a.telefone, nomes: [a.nome], emps: [], ativo: a.ativo, soAgencia: true });
    }
    // Quem está numa equipe mas saiu de todas as roletas continua na lista,
    // para o gestor não perder o histórico dele sem querer.
    const fones = new Set(unicos.map(u => u.telefone));
    for (const m of membros) {
      if (!fones.has(m.telefone)) unicos.push({ telefone: m.telefone, nomes: [m.nome || m.telefone], emps: [], ativo: false });
    }
    unicos.forEach((u) => {
      u.gestor_id = dono[u.telefone] || null;
      u.empNomes = u.emps.map(id => nomesEmp[id] || '?');
    });
    unicos.sort((a, b) => a.nomes[0].localeCompare(b.nomes[0], 'pt-BR'));
    usuarios.forEach((g) => { g.membros = membros.filter(m => m.gestor_id === g.id).length; });
    res.render('admin/equipes', { title: 'Equipes · Painel', usuarios, gestores, corretores: unicos, q: req.query });
  } catch (e) { next(e); }
});

router.post('/equipes/gestor', async (req, res, next) => {
  try {
    const b = req.body;
    const id = b.id ? Number(b.id) : null;
    const nome = String(b.nome || '').trim();
    const usuario = equipes.usuarioValido(b.usuario);
    const senha = String(b.senha || '');
    if (!nome || !usuario) return res.redirect('/admin/equipes?erro=campos');
    if ((!id || senha) && senha.length < 8) return res.redirect('/admin/equipes?erro=senha');
    const outro = await db.getGestorPorUsuario(usuario);
    if (outro && outro.id !== id) return res.redirect('/admin/equipes?erro=usuario');
    const senha_hash = senha ? equipes.hashSenha(senha) : null;
    const papel = b.papel === 'recepcao' ? 'recepcao' : 'gestor';
    if (id) await db.updateGestor(id, { nome, usuario, senha_hash, papel });
    else await db.createGestor({ nome, usuario, senha_hash, papel });
    res.redirect('/admin/equipes?ok=gestor');
  } catch (e) { next(e); }
});

router.post('/equipes/gestor/:id/toggle', async (req, res, next) => {
  try {
    const g = await db.getGestor(req.params.id);
    if (g) await db.updateGestor(g.id, { ativo: !g.ativo });
    res.redirect('/admin/equipes?ok=gestor');
  } catch (e) { next(e); }
});

router.post('/equipes/gestor/:id/excluir', async (req, res, next) => {
  try {
    await db.removeGestor(req.params.id);
    res.redirect('/admin/equipes?del=1');
  } catch (e) { next(e); }
});

// Um select por corretor (name="eq_<telefone>"), salvos de uma vez.
router.post('/equipes/membros', async (req, res, next) => {
  try {
    const validos = new Set((await db.listGestores()).filter(g => (g.papel || 'gestor') === 'gestor').map(g => g.id));
    const mapa = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (!k.startsWith('eq_')) continue;
      const tel = k.slice(3);
      const gid = Number(v) || null;
      mapa[tel] = { gestor_id: gid && validos.has(gid) ? gid : null, nome: String(req.body['nm_' + tel] || '').trim() };
    }
    await db.salvarEquipes(mapa);
    res.redirect('/admin/equipes?ok=equipes');
  } catch (e) { next(e); }
});

// O administrador vê exatamente o que o gestor vê.
router.get('/equipes/:id', async (req, res, next) => {
  try {
    const g = await db.getGestor(req.params.id);
    if (!g || g.papel === 'recepcao') return next();
    const dados = await equipes.painel(g, req.query.periodo);
    res.render('gestor/painel', { title: `Equipe ${g.nome} · Painel`, ...dados, comoAdmin: true });
  } catch (e) { next(e); }
});

// =====================================================================
//  RECEPÇÃO  —  corretores da agência e relatório de encaminhamentos
// =====================================================================
router.get('/recepcao', async (req, res, next) => {
  try {
    const per = equipes.periodo(req.query.periodo);
    const [corretores, envios, usuarios, leads] = await Promise.all([
      db.listAgencia(), db.encaminhamentosPorFone(per.desde, per.ate), db.listGestores(),
      db.leadsRecepcao(per.desde, per.ate, null, 300),
    ]);
    const porFone = {};
    const porCanal = {};
    for (const r of envios) {
      porFone[r.fone] = porFone[r.fone] || { n: 0, ultimo: null };
      porFone[r.fone].n += r.n;
      const d = r.ultimo ? new Date(r.ultimo) : null;
      if (d && (!porFone[r.fone].ultimo || d > porFone[r.fone].ultimo)) porFone[r.fone].ultimo = d;
      const c = r.canal || 'Não informado';
      porCanal[c] = (porCanal[c] || 0) + r.n;
    }
    const linhas = corretores.map(c => ({ ...c, envios: (porFone[c.telefone] || {}).n || 0, ultimo: (porFone[c.telefone] || {}).ultimo || null }))
      .sort((a, b) => b.envios - a.envios || a.nome.localeCompare(b.nome, 'pt-BR'));
    // Envios para quem saiu da lista continuam no total.
    const total = envios.reduce((a, r) => a + r.n, 0);
    const canais = Object.entries(porCanal).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n);
    const recepcionistas = usuarios.filter(u => u.papel === 'recepcao');
    const quem = Object.fromEntries(usuarios.map(u => [u.id, u.nome]));
    leads.forEach((l) => { l.por = quem[l.usuario_id] || '—'; });
    res.render('admin/recepcao', {
      title: 'Recepção · Painel', linhas, canais, total, per, periodos: equipes.PERIODOS,
      recepcionistas, leads, q: req.query,
    });
  } catch (e) { next(e); }
});

// Auditoria: todos os leads encaminhados no período, com os dados do cliente.
router.get('/recepcao/csv', async (req, res, next) => {
  try {
    const per = equipes.periodo(req.query.periodo);
    const [linhas, usuarios] = await Promise.all([db.leadsRecepcao(per.desde, per.ate, null, 50000), db.listGestores()]);
    const quem = Object.fromEntries(usuarios.map(u => [u.id, u.nome]));
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['data_hora', 'enviado_por', 'corretor', 'corretor_whatsapp', 'cliente', 'cliente_telefone', 'cliente_email', 'negocio', 'imovel', 'origem', 'canal', 'mensagem'];
    const csv = [head.join(';')].concat(linhas.map(l => [
      new Date(l.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      quem[l.usuario_id] || '', l.corretor_nome, l.corretor_fone, l.lead_nome, l.lead_telefone, l.lead_email,
      l.negocio, l.imovel, l.origem, l.canal, l.mensagem,
    ].map(esc).join(';'))).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-recepcao-${per.chave}.csv"`);
    res.send('\ufeff' + csv);
  } catch (e) { next(e); }
});

router.post('/recepcao/corretor', async (req, res, next) => {
  try {
    const b = req.body;
    const id = b.id ? Number(b.id) : null;
    const nome = String(b.nome || '').trim();
    if (!nome) return res.redirect('/admin/recepcao?erro=campos');
    const numero = roleta.validarWhats(b.telefone);
    if (!numero) return res.redirect('/admin/recepcao?erro=telefone');
    const outro = await db.getAgenciaPorFone(numero);
    if (outro && outro.id !== id) return res.redirect('/admin/recepcao?erro=duplicado');
    await db.salvarAgencia(id, { nome, telefone: numero, ativo: b.ativo === 'on', destaque: b.destaque === 'on' });
    res.redirect('/admin/recepcao?ok=1');
  } catch (e) { next(e); }
});

router.post('/recepcao/corretor/:id/toggle', async (req, res, next) => {
  try {
    const c = await db.getAgencia(req.params.id);
    if (c) await db.salvarAgencia(c.id, { ...c, ativo: !c.ativo });
    res.redirect('/admin/recepcao?ok=1');
  } catch (e) { next(e); }
});

router.post('/recepcao/corretor/:id/excluir', async (req, res, next) => {
  try {
    await db.removeAgencia(req.params.id);
    res.redirect('/admin/recepcao?del=1');
  } catch (e) { next(e); }
});

// Traz para a lista da recepção quem já está em alguma roleta (pelo WhatsApp).
router.post('/recepcao/importar', async (req, res, next) => {
  try {
    let n = 0;
    for (const u of await db.corretoresUnicos()) {
      if (!roleta.validarWhats(u.telefone) || await db.getAgenciaPorFone(u.telefone)) continue;
      await db.salvarAgencia(null, { nome: u.nomes[0], telefone: u.telefone, ativo: true });
      n++;
    }
    res.redirect('/admin/recepcao?importados=' + n);
  } catch (e) { next(e); }
});

// =====================================================================
//  PORTAL (página principal)
// =====================================================================
router.get('/portal', async (req, res, next) => {
  try {
    const cfg = await portal.carregar();
    const ativos = (await db.listCorretores(PORTAL_ID, { ativosOnly: true })).length;
    res.render('admin/portal', { title: 'Portal · Painel', cfg, cloudinaryOn, q: req.query, ativos });
  } catch (e) { next(e); }
});

router.post('/portal', async (req, res, next) => {
  try {
    const dados = portal.limpar(req.body);
    if (dados.whatsapp && !roleta.validarWhats(dados.whatsapp)) {
      const cfg = { ...(await portal.carregar()), ...dados };
      return res.status(400).render('admin/portal', {
        title: 'Portal · Painel', cfg, cloudinaryOn, q: { erro: 'whats' }, ativos: 0,
      });
    }
    await db.savePortal(dados);
    res.redirect('/admin/portal?ok=1');
  } catch (e) { next(e); }
});

// ---- Upload de imagem (Cloudinary) — usado via fetch pelo formulário ----
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    if (!cloudinaryOn) return res.status(400).json({ error: 'Cloudinary não configurado. Configure as variáveis CLOUDINARY_* ou cole a URL da imagem manualmente.' });
    const url = await uploadBuffer(req.file.buffer, 'auxiliadora/empreendimentos');
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Falha no upload: ' + e.message });
  }
});

module.exports = router;
