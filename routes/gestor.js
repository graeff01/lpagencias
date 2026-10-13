// Área dos gestores: cada um entra com usuário e senha próprios e vê só os
// leads da própria equipe. Não dá acesso ao painel de empreendimentos.
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const equipes = require('../lib/equipes');
const { ipDe, bloqueado, registrarFalha, limpar } = require('../lib/tentativas');

function telaLogin(res, status, error, usuario) {
  return res.status(status).render('gestor/login', { title: 'Entrar · Gestores', error, usuario: usuario || '' });
}

router.get('/login', (req, res) => {
  if (req.session && req.session.gestorId) return res.redirect('/gestor');
  telaLogin(res, 200, null);
});

router.post('/login', async (req, res, next) => {
  try {
    const ip = ipDe(req);
    const minutos = bloqueado(ip);
    if (minutos) return telaLogin(res, 429, `Muitas tentativas. Tente novamente em ${minutos} minuto(s).`, req.body.usuario);

    const g = await db.getGestorPorUsuario(req.body.usuario);
    if (!g || !g.ativo || !equipes.confereSenha(req.body.senha || '', g.senha_hash)) {
      registrarFalha(ip);
      return telaLogin(res, 401, 'Usuário ou senha incorretos.', req.body.usuario);
    }
    limpar(ip);
    req.session.regenerate((err) => {   // evita fixação de sessão
      if (err) return telaLogin(res, 500, 'Erro ao entrar. Tente de novo.', req.body.usuario);
      req.session.gestorId = g.id;
      db.marcarAcessoGestor(g.id).catch(() => {});
      res.redirect('/gestor');
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/gestor/login'));
});

// Gestor desativado ou excluído perde o acesso na hora, mesmo logado.
router.use(async (req, res, next) => {
  try {
    const id = req.session && req.session.gestorId;
    const g = id ? await db.getGestor(id) : null;
    if (!g || !g.ativo) {
      if (id) delete req.session.gestorId;
      return res.redirect('/gestor/login');
    }
    req.gestor = g;
    next();
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const dados = await equipes.painel(req.gestor, req.query.periodo);
    res.set('Cache-Control', 'no-store');
    res.render('gestor/painel', { title: `Equipe ${req.gestor.nome}`, ...dados, comoAdmin: false });
  } catch (e) { next(e); }
});

module.exports = router;
