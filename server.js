require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./lib/db');
const helpers = require('./lib/helpers');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const gestorRoutes = require('./routes/gestor');
const recepcaoRoutes = require('./routes/recepcao');
const sdrRoutes = require('./routes/sdr');
const externoRoutes = require('./routes/externo');
const caixaLeads = require('./lib/caixa-leads');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Estáticos com cache no navegador (CSS/JS/imagens quase nunca mudam).
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', etag: true }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// ---- Sessão (login do admin) ----
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12, httpOnly: true, sameSite: 'lax' },
};
if (process.env.DATABASE_URL) {
  const PgStore = require('connect-pg-simple')(session);
  sessionConfig.store = new PgStore({ pool: db.pool, createTableIfMissing: true });
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    sessionConfig.cookie.secure = true;
  }
}
app.use(session(sessionConfig));

// Versão dos arquivos de estilo/script: muda a cada deploy. Eles ficam 7
// dias no cache do navegador; com a versão no endereço, um deploy novo
// nunca convive com o CSS antigo guardado (página nova + estilo velho quebra).
const VERSAO = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 8) || Date.now().toString(36);

// ---- Helpers disponíveis em todas as views ----
app.use((req, res, next) => {
  res.locals.v = VERSAO;
  res.locals.h = helpers;
  res.locals.isAdmin = !!(req.session && req.session.admin);
  next();
});

// Formulário padrão antes do WhatsApp nas landings (liga/desliga no painel).
let gateCache = { v: true, ate: 0 };
app.use(async (req, res, next) => {
  if (Date.now() > gateCache.ate) {
    try { gateCache = { v: (await db.getConfig('lp_formulario')) !== '0', ate: Date.now() + 30000 }; }
    catch (e) { gateCache.ate = Date.now() + 30000; }
  }
  res.locals.leadGate = gateCache.v;
  next();
});

// ---- Rotas ----
app.use('/admin', adminRoutes);
app.use('/gestor', gestorRoutes);
app.use('/recepcao', recepcaoRoutes);
app.use('/sdr', sdrRoutes);
app.use('/', externoRoutes);
app.use('/', publicRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'Página não encontrada' });
});

const PORT = process.env.PORT || 3000;

db.migrate()
  .then(() => require('./lib/sdr').migrate())
  .then(() => {
    setTimeout(() => adminRoutes.completarPontosExistentes(), 5000);
    caixaLeads.iniciar();   // lê a caixa de leads (se configurada) e enche a fila da recepção
    // LGPD: uma vez por dia, apaga os dados pessoais de leads mais antigos que LGPD_MESES.
    const lgpd = () => db.anonimizarAntigos(process.env.LGPD_MESES)
      .then((r) => { const n = Object.values(r).reduce((a, x) => a + x, 0); if (n) console.log('[lgpd] dados pessoais apagados:', r); })
      .catch(e => console.error('[lgpd]', e.message));
    setTimeout(lgpd, 60 * 1000);
    setInterval(lgpd, 24 * 3600 * 1000).unref();
    app.listen(PORT, () => {
      console.log(`\n  Auxiliadora Landings rodando em http://localhost:${PORT}`);
      console.log(`  Painel:  http://localhost:${PORT}/admin`);
      if (!process.env.ADMIN_PASSWORD) console.log('  [aviso] ADMIN_PASSWORD não definido — usando "admin" (troque em produção).');
      if (!require('./lib/cloudinary').configured) console.log('  [aviso] Cloudinary não configurado — upload de fotos ficará indisponível (use URLs por enquanto).');
      console.log('');
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar o banco de dados:', err);
    process.exit(1);
  });
