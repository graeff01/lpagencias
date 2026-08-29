const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { slugify, asArray } = require('../lib/helpers');
const { uploadBuffer, configured: cloudinaryOn } = require('../lib/cloudinary');
const roleta = require('../lib/roleta');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ---- Proteção contra tentativa em massa no login ----
// O painel guarda telefone e e-mail dos corretores: senha única sem limite de
// tentativas seria força bruta livre. 5 erros = 15 min de bloqueio por IP.
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const tentativas = new Map();

function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t) return 0;
  if (t.ate && t.ate > Date.now()) return Math.ceil((t.ate - Date.now()) / 60000);
  if (t.ate && t.ate <= Date.now()) tentativas.delete(ip);
  return 0;
}

function registrarFalha(ip) {
  const t = tentativas.get(ip) || { n: 0, ate: 0 };
  t.n += 1;
  if (t.n >= MAX_TENTATIVAS) { t.ate = Date.now() + BLOQUEIO_MS; t.n = 0; }
  tentativas.set(ip, t);
}

// Limpeza periódica para o Map não crescer sem limite.
setInterval(() => {
  const agora = Date.now();
  for (const [ip, t] of tentativas) if (!t.ate || t.ate < agora) tentativas.delete(ip);
}, 30 * 60 * 1000).unref();

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
  if (req.body.password === ADMIN_PASSWORD) {
    tentativas.delete(ip);
    return req.session.regenerate((err) => {   // evita fixação de sessão
      if (err) return res.status(500).render('admin/login', { title: 'Entrar · Painel', error: 'Erro ao entrar. Tente de novo.' });
      req.session.admin = true;
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

// ---- Lista de empreendimentos ----
router.get('/', async (req, res, next) => {
  try {
    const emps = await db.list({});
    res.render('admin/list', { title: 'Empreendimentos · Painel', emps, q: req.query });
  } catch (e) { next(e); }
});

// ---- Novo / Editar ----
router.get('/novo', (req, res) => {
  res.render('admin/form', { title: 'Novo empreendimento', emp: null, cloudinaryOn, error: null });
});

router.get('/editar/:id', async (req, res, next) => {
  try {
    const emp = await db.getById(req.params.id);
    if (!emp) return next();
    res.render('admin/form', { title: `Editar · ${emp.nome}`, emp, cloudinaryOn, error: null });
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
  data.home = body.home === 'on' || body.home === 'true' || body.home === true;
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
    let n = 1, base = slug;
    while (await db.slugExists(slug, id)) { slug = `${base}-${++n}`; }
    data.slug = slug;

    let emp;
    if (id) emp = await db.update(id, data);
    else emp = await db.create(data);

    // Só um empreendimento pode ocupar a raiz do site.
    if (data.home) await db.definirHome(emp.id);

    res.redirect(`/admin?ok=1&slug=${emp.slug}`);
  } catch (e) { next(e); }
});

// ---- Excluir ----
router.post('/excluir/:id', async (req, res, next) => {
  try { await db.remove(req.params.id); res.redirect('/admin?del=1'); }
  catch (e) { next(e); }
});

// =====================================================================
//  ROLETA DE CORRETORES
// =====================================================================

// ---- Cadastro dos corretores de um empreendimento ----
router.get('/corretores/:id', async (req, res, next) => {
  try {
    const emp = await db.getById(req.params.id);
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
    const emp = await db.getById(req.params.id);
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
    const emp = await db.getById(req.params.id);
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
    res.setHeader('Content-Disposition', `attachment; filename="leads-${emp.slug}.csv"`);
    res.send('﻿' + csv); // BOM para o Excel abrir com acento certo
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
