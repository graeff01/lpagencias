// Painel → SDR: lista de contatos (importar a planilha do CRM), corretores
// do plantão, roteiro da ligação e os números das ligações.
const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const sdr = require('../lib/sdr');
const equipes = require('../lib/equipes');
const planilha = require('../lib/planilha');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

async function lotes() {
  const { rows } = await db.query(
    `SELECT lote, COUNT(*)::int AS total, SUM(CASE WHEN status='novo' THEN 1 ELSE 0 END)::int AS novos,
            MIN(created_at) AS criado
       FROM sdr_contatos GROUP BY lote ORDER BY MIN(created_at) DESC`
  );
  return rows;
}

router.get('/', async (req, res, next) => {
  try {
    const per = equipes.periodo(req.query.periodo);
    const [lista, ligs, plantao, agencia, usuarios, script, ls, metas, mensagens, envSdr] = await Promise.all([
      sdr.resumoLista(), sdr.ligacoesPeriodo(per.desde, per.ate), sdr.listPlantao(), db.listAgencia({ ativosOnly: true }),
      db.listGestores(), sdr.getScript(), lotes(), sdr.getMetas(), sdr.getMensagens(), sdr.enviosSdr(per.desde, per.ate),
    ]);
    const quem = Object.fromEntries(usuarios.map(u => [u.id, u.nome]));
    const envIds = ligs.map(l => l.encaminhamento_id).filter(Boolean);
    const envios = {};
    for (const id of envIds) { const e = await db.getEncaminhamento(id); if (e) envios[id] = e; }
    const nosPlantao = new Set(plantao.map(p => p.telefone));
    res.render('admin/sdr', {
      title: 'SDR · Painel', per, periodos: equipes.PERIODOS, lista, ligs, resumo: sdr.resumoLigacoes(ligs), plantao,
      metas, mensagens, ret: sdr.resumoRetornos(envSdr), RETORNOS: equipes.RETORNOS, minSeg: sdr.minSeg,
      agencia: agencia.filter(a => !nosPlantao.has(a.telefone)), quem, envios, script, lotes: ls,
      STATUS: sdr.STATUS, RESULTADOS: sdr.RESULTADOS, sdrs: usuarios.filter(u => u.papel === 'sdr'),
      q: req.query, duracao: equipes.duracao,
    });
  } catch (e) { next(e); }
});

// Importar a planilha (CSV ou .xlsx) ou uma lista colada.
router.post('/importar', upload.single('arquivo'), async (req, res) => {
  try {
    let linhas = [];
    let nome = '';
    if (req.file && req.file.size) {
      nome = req.file.originalname || 'planilha';
      linhas = planilha.lerArquivo(req.file.buffer, nome);
    } else if (String(req.body.colado || '').trim()) {
      nome = 'colado';
      linhas = planilha.lerCsv(req.body.colado);
    } else {
      return res.redirect('/admin/sdr?erro=vazio#lista');
    }
    const lote = (String(req.body.lote || '').trim() || nome.replace(/\.[^.]+$/, '')).slice(0, 60) + ' · ' +
      new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const r = await sdr.importar(linhas, lote);
    res.redirect(`/admin/sdr?importados=${r.novos}&repetidos=${r.repetidos}&sem=${r.semTelefone}#lista`);
  } catch (e) {
    console.error('[sdr] importação:', e.message);
    res.redirect('/admin/sdr?erro=' + encodeURIComponent(e.message.slice(0, 160)) + '#lista');
  }
});

// Tira da lista os contatos de um lote que ainda não foram ligados.
router.post('/lote/apagar', async (req, res, next) => {
  try {
    const lote = String(req.body.lote || '');
    const { rowCount } = await db.query(`DELETE FROM sdr_contatos WHERE status='novo' AND COALESCE(lote,'')=$1`, [lote]);
    res.redirect('/admin/sdr?apagados=' + (rowCount || 0) + '#lista');
  } catch (e) { next(e); }
});

// ---- Plantão ----
router.post('/plantao', async (req, res, next) => {
  try {
    let d = req.body;
    if (d.agencia_id) {
      const a = await db.getAgencia(d.agencia_id);
      if (a) d = { nome: a.nome, telefone: a.telefone };
    }
    const ok = await sdr.salvarPlantao(d);
    res.redirect('/admin/sdr?' + (ok ? 'plantao=ok' : 'erro=plantao') + '#plantao');
  } catch (e) { next(e); }
});

router.post('/plantao/:id/toggle', async (req, res, next) => {
  try { await sdr.alternarPlantao(req.params.id); res.redirect('/admin/sdr#plantao'); } catch (e) { next(e); }
});

router.post('/plantao/:id/remover', async (req, res, next) => {
  try { await sdr.removerPlantao(req.params.id); res.redirect('/admin/sdr#plantao'); } catch (e) { next(e); }
});

// ---- Roteiro ----
router.post('/script', async (req, res, next) => {
  try {
    await sdr.salvarScript(req.body.restaurar ? '' : req.body.script);
    res.redirect('/admin/sdr?script=ok#roteiro');
  } catch (e) { next(e); }
});

// ---- Metas do dia e mensagens prontas ----
router.post('/metas', async (req, res, next) => {
  try { await sdr.salvarMetas(req.body); res.redirect('/admin/sdr?metas=ok#metas'); } catch (e) { next(e); }
});

router.post('/mensagens', async (req, res, next) => {
  try {
    await sdr.salvarMensagens(req.body.restaurar ? { tentativa: '', apresentacao: '' } : req.body);
    res.redirect('/admin/sdr?mensagens=ok#mensagens');
  } catch (e) { next(e); }
});

// ---- Planilhas para baixar ----
const cel = (v) => {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;   // o Excel não executa como fórmula
  return '"' + s.replace(/"/g, '""') + '"';
};
const dataBr = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

router.get('/ligacoes.csv', async (req, res, next) => {
  try {
    const per = equipes.periodo(req.query.periodo);
    const [ligs, usuarios] = await Promise.all([sdr.ligacoesPeriodo(per.desde, per.ate), db.listGestores()]);
    const quem = Object.fromEntries(usuarios.map(u => [u.id, u.nome]));
    const head = ['data_hora', 'sdr', 'cliente', 'telefone', 'resultado', 'classificacao', 'duracao', 'interesse', 'objetivo', 'faixa', 'pagamento', 'prazo', 'observacoes', 'autorizou_whatsapp', 'corretor', 'confirmado_em', 'retorno_do_corretor', 'retorno_obs'];
    const linhas = [];
    for (const l of ligs) {
      const f = l.ficha || {};
      const e = l.encaminhamento_id ? await db.getEncaminhamento(l.encaminhamento_id) : null;
      linhas.push([dataBr(l.created_at), quem[l.usuario_id] || '', l.contato_nome, l.contato_telefone,
        (sdr.RESULTADOS[l.resultado] || {}).rotulo || l.resultado, l.classificacao || '', l.duracao_s ? sdr.minSeg(l.duracao_s) : '',
        f.interesse, f.objetivo, f.faixa, f.pagamento, f.prazo, f.obs, f.autorizou ? 'sim' : '', e ? e.corretor_nome : '', e ? dataBr(e.confirmado_em) : '',
        e && e.retorno ? equipes.RETORNOS[e.retorno] : '', e ? e.retorno_obs : ''].map(cel).join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ligacoes-sdr-${per.chave}.csv"`);
    res.send('﻿' + [head.join(';')].concat(linhas).join('\r\n'));
  } catch (e) { next(e); }
});

router.get('/contatos.csv', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM sdr_contatos ORDER BY id ASC');
    const head = ['nome', 'telefone', 'telefone2', 'email', 'situacao', 'tentativas', 'ultima_ligacao', 'retornar_em', 'lote'];
    const linhas = rows.map(c => [c.nome, c.telefone, c.telefone2, c.email, sdr.STATUS[c.status] || c.status, c.tentativas,
      dataBr(c.ultima_ligacao), dataBr(c.retornar_em), c.lote].map(cel).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contatos-sdr.csv"');
    res.send('﻿' + [head.join(';')].concat(linhas).join('\r\n'));
  } catch (e) { next(e); }
});

module.exports = router;
