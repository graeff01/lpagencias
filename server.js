require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./lib/db');
const helpers = require('./lib/helpers');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
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

// ---- Helpers disponíveis em todas as views ----
app.use((req, res, next) => {
  res.locals.h = helpers;
  res.locals.isAdmin = !!(req.session && req.session.admin);
  next();
});

// ---- Rotas ----
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'Página não encontrada' });
});

const PORT = process.env.PORT || 3000;

db.migrate()
  .then(() => {
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
