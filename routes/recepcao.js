// Recepção: lista dos corretores da agência para encaminhar leads pelo
// WhatsApp em um clique. O site só registra o envio (quem, para quem,
// canal e hora); o conteúdo do lead vai direto do WhatsApp dela para o
// do corretor e não fica guardado aqui.
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const equipes = require('../lib/equipes');
const { exigeEquipe } = require('./gestor');

router.get('/login', (req, res) => res.redirect('/gestor/login'));
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/gestor/login'));
});

router.use(exigeEquipe('recepcao'));

router.get('/', async (req, res, next) => {
  try {
    const [corretores, recentes] = await Promise.all([
      db.listAgencia({ ativosOnly: true }),
      db.encaminhamentosRecentes(req.gestor.id, 30),
    ]);
    const hoje = equipes.periodo('hoje');
    const deHoje = recentes.filter(r => new Date(r.created_at) >= hoje.desde).length;
    res.set('Cache-Control', 'no-store');
    res.render('recepcao/painel', {
      title: 'Recepção · Encaminhar leads', usuario: req.gestor, corretores, recentes, deHoje,
      canais: equipes.CANAIS,
    });
  } catch (e) { next(e); }
});

// Chamado pelo clique no nome (antes de abrir o WhatsApp). Um erro aqui não
// pode impedir o envio: a tela abre o WhatsApp de qualquer jeito.
router.post('/enviar', async (req, res) => {
  try {
    const c = await db.getAgencia(req.body.corretor_id);
    if (!c) return res.status(404).json({ ok: false });
    const canal = equipes.CANAIS.includes(req.body.canal) ? req.body.canal : null;
    await db.registrarEncaminhamento({ usuario_id: req.gestor.id, corretor_fone: c.telefone, corretor_nome: c.nome, canal });
    res.json({ ok: true });
  } catch (e) {
    console.error('[recepcao] falha ao registrar envio:', e.message);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
