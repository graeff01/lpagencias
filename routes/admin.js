const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { slugify, asArray } = require('../lib/helpers');
const { uploadBuffer, configured: cloudinaryOn } = require('../lib/cloudinary');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

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
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
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
  const jsonFields = ['gallery', 'infra', 'plantas', 'diferenciais', 'timeline', 'faq', 'pois', 'construtora_stats'];
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
    let n = 1, base = slug;
    while (await db.slugExists(slug, id)) { slug = `${base}-${++n}`; }
    data.slug = slug;

    let emp;
    if (id) emp = await db.update(id, data);
    else emp = await db.create(data);

    res.redirect(`/admin?ok=1&slug=${emp.slug}`);
  } catch (e) { next(e); }
});

// ---- Excluir ----
router.post('/excluir/:id', async (req, res, next) => {
  try { await db.remove(req.params.id); res.redirect('/admin?del=1'); }
  catch (e) { next(e); }
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
