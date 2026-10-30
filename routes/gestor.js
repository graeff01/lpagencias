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
const destino = (g) => ({ recepcao: '/recepcao', sdr: '/sdr' }[g.papel] || '/gestor');

router.get('/login', (req, res) => {
  if (req.session && req.session.gestorId) return res.redirect(destino({ papel: req.session.papelEquipe }));
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
      res.redirect(g.trocar_senha ? '/gestor/senha' : destino(g));
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/gestor/login'));
});

// ---- Trocar a senha (obrigatório no primeiro acesso com senha temporária) ----
async function logado(req) {
  const id = req.session && req.session.gestorId;
  const g = id ? await db.getGestor(id) : null;
  return g && g.ativo ? g : null;
}

function telaSenha(res, g, status, error) {
  return res.status(status).render('gestor/senha', { title: 'Nova senha · Equipe', g, error });
}

router.get('/senha', async (req, res, next) => {
  try {
    const g = await logado(req);
    if (!g) return res.redirect('/gestor/login');
    telaSenha(res, g, 200, null);
  } catch (e) { next(e); }
});

router.post('/senha', async (req, res, next) => {
  try {
    const g = await logado(req);
    if (!g) return res.redirect('/gestor/login');
    const atual = String(req.body.atual || '');
    const nova = String(req.body.nova || '');
    if (!equipes.confereSenha(atual, g.senha_hash)) return telaSenha(res, g, 400, 'A senha atual não confere.');
    if (nova.length < 8) return telaSenha(res, g, 400, 'A nova senha precisa de pelo menos 8 caracteres.');
    if (nova !== String(req.body.confirma || '')) return telaSenha(res, g, 400, 'A confirmação não é igual à nova senha.');
    if (nova === atual) return telaSenha(res, g, 400, 'A nova senha precisa ser diferente da atual.');
    await db.updateGestor(g.id, { senha_hash: equipes.hashSenha(nova), trocar_senha: false });
    res.redirect(destino(g) + '?senha=ok');
  } catch (e) { next(e); }
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
      if (g.trocar_senha) return res.redirect('/gestor/senha');
      if ((g.papel || 'gestor') !== papel) return res.redirect(destino(g));
      req.gestor = g;
      res.locals.podeAdmin = !!g.acesso_admin;
      next();
    } catch (e) { next(e); }
  };
}

// Acesso total ao painel admin pelo próprio login (liberado por pessoa em Equipes).
router.get('/admin', async (req, res, next) => {
  try {
    const id = req.session && req.session.gestorId;
    const g = id ? await db.getGestor(id) : null;
    if (!g || !g.ativo) return res.redirect('/gestor/login');
    if (!g.acesso_admin) return res.redirect(destino(g));
    req.session.admin = true;
    req.session.papel = 'admin';
    req.session.adminPor = g.id;
    db.registrarAdminLog({ quem_id: g.id, quem_nome: g.nome, metodo: 'GET', caminho: '/gestor/admin', acao: 'Entrou no painel admin pelo próprio login', status: 200 });
    res.redirect('/admin');
  } catch (e) { next(e); }
});

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
