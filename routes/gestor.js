// Área dos gestores: cada um entra com usuário e senha próprios e vê só os
// leads da própria equipe. Não dá acesso ao painel de empreendimentos.
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const equipes = require('../lib/equipes');
const { ipDe, bloqueado, registrarFalha, limpar } = require('../lib/tentativas');

function telaLogin(res, status, error, usuario) {
  return res.status(status).render('gestor/login', { title: 'Entrar · Equipe', error, usuario: usuario || '' });
}

// Gestores e recepção usam o mesmo login; cada perfil cai na sua tela.
const destino = (g) => (g.papel === 'recepcao' ? '/recepcao' : '/gestor');

router.get('/login', (req, res) => {
  if (req.session && req.session.gestorId) return res.redirect(req.session.papelEquipe === 'recepcao' ? '/recepcao' : '/gestor');
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
      req.session.papelEquipe = g.papel || 'gestor';
      db.marcarAcessoGestor(g.id).catch(() => {});
      res.redirect(destino(g));
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/gestor/login'));
});

// Usuário desativado ou excluído perde o acesso na hora, mesmo logado.
// papel: só esse perfil passa (a recepção não vê o painel de leads e vice-versa).
function exigeEquipe(papel) {
  return async (req, res, next) => {
    try {
      const id = req.session && req.session.gestorId;
      const g = id ? await db.getGestor(id) : null;
      if (!g || !g.ativo) {
        if (id) delete req.session.gestorId;
        return res.redirect('/gestor/login');
      }
      if ((g.papel || 'gestor') !== papel) return res.redirect(destino(g));
      req.gestor = g;
      next();
    } catch (e) { next(e); }
  };
}

router.use(exigeEquipe('gestor'));

router.get('/', async (req, res, next) => {
  try {
    const dados = await equipes.painel(req.gestor, req.query.periodo);
    res.set('Cache-Control', 'no-store');
    res.render('gestor/painel', { title: `Equipe ${req.gestor.nome}`, ...dados, comoAdmin: false });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.exigeEquipe = exigeEquipe;
