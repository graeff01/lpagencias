// SDR: quem liga para a lista de clientes (exportada do CRM), qualifica na
// ligação e manda o interessado para o corretor do plantão. O envio usa o
// mesmo registro da recepção (link "Recebi", cobrança, painel e auditoria).
const db = require('./db');
const { normalizarFone } = require('../public/js/lead-parser');
const planilha = require('./planilha');

const query = (t, p) => db.query(t, p);

// Nome sem acento e em minúsculas, para a busca do SDR.
const ACENTOS = ['áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'];
const semAcento = (t) => String(t).toLowerCase().split('').map(ch => { const k = ACENTOS[0].indexOf(ch); return k >= 0 ? ACENTOS[1][k] : ch; }).join('');

// Resultado de cada ligação e o que acontece com o contato depois.
const RESULTADOS = {
  nao_atendeu: { rotulo: 'Não atendeu', status: 'nao_atendeu' },
  retornar: { rotulo: 'Ligar depois', status: 'retornar' },
  sem_interesse: { rotulo: 'Sem interesse', status: 'sem_interesse' },
  nao_ligar: { rotulo: 'Pediu para não ligar', status: 'nao_ligar' },
  invalido: { rotulo: 'Número errado', status: 'invalido' },
  qualificado: { rotulo: 'Qualificado (enviado ao corretor)', status: 'enviado' },
};
const STATUS = {
  novo: 'A ligar', nao_atendeu: 'Não atendeu', retornar: 'Ligar depois', sem_interesse: 'Sem interesse',
  nao_ligar: 'Não ligar', invalido: 'Número errado', enviado: 'Enviado ao corretor',
};
// Depois de tantas tentativas sem atender, o contato sai da fila.
const MAX_TENTATIVAS = 3;
// Intervalo mínimo entre duas tentativas no mesmo contato.
const HORAS_ENTRE_TENTATIVAS = 3;

// Opções da ficha (as mesmas do roteiro do Fabrício).
const FICHA = {
  interesse: ['Sim', 'Talvez, dependendo da oportunidade', 'Não'],
  objetivo: ['Renda com aluguel', 'Valorização patrimonial', 'Revenda futura'],
  faixa: ['Até R$ 250 mil', 'R$ 250 mil a R$ 400 mil', 'Acima de R$ 400 mil', 'A definir'],
  pagamento: ['Recursos próprios', 'Financiamento', 'Combinação dos dois', 'A definir'],
  prazo: ['Imediato', 'Próximos 3 meses', 'De 3 a 6 meses', 'Sem previsão'],
};

// Quente: quer investir em até 90 dias e já tem faixa de valor.
// Morno: tem interesse, mas depende da oportunidade ou é para mais adiante.
// Frio: não tem interesse.
function classificar(f) {
  if (!f || !f.interesse) return null;
  if (f.interesse === 'Não') return 'frio';
  const breve = f.prazo === 'Imediato' || f.prazo === 'Próximos 3 meses';
  const faixa = f.faixa && f.faixa !== 'A definir';
  return breve && faixa ? 'quente' : 'morno';
}

function fichaLimpa(b) {
  const f = {};
  for (const k of Object.keys(FICHA)) if (FICHA[k].includes(b[k])) f[k] = b[k];
  f.obs = String(b.obs || '').trim().slice(0, 1000);
  f.autorizou = b.autorizou === true || b.autorizou === 'true' || b.autorizou === '1' || b.autorizou === 'on';
  return f;
}

// ---- Banco ----
async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS sdr_contatos (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      telefone TEXT UNIQUE,
      telefone2 TEXT,
      email TEXT,
      info JSONB,
      lote TEXT,
      status TEXT DEFAULT 'novo',
      tentativas INTEGER DEFAULT 0,
      retornar_em TIMESTAMPTZ,
      ultima_ligacao TIMESTAMPTZ,
      reservado_por INTEGER,
      reservado_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS sdr_ligacoes (
      id SERIAL PRIMARY KEY,
      contato_id INTEGER,
      usuario_id INTEGER,
      resultado TEXT NOT NULL,
      classificacao TEXT,
      ficha JSONB,
      encaminhamento_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS sdr_plantao (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      telefone TEXT UNIQUE NOT NULL,
      ativo BOOLEAN DEFAULT true,
      atribuicoes INTEGER DEFAULT 0,
      ultima_atribuicao TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_sdr_contatos_status ON sdr_contatos(status, id)',
    'CREATE INDEX IF NOT EXISTS idx_sdr_ligacoes_data ON sdr_ligacoes(created_at DESC)',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS fonte TEXT',
    'ALTER TABLE sdr_contatos ADD COLUMN IF NOT EXISTS busca TEXT',
  ]) { try { await query(sql); } catch (e) { /* pg-mem */ } }

  // Acesso do Diego (SDR da agência Jardim do Lago), com senha temporária que
  // ele troca no primeiro acesso. Só o hash fica aqui; uma vez só.
  const { rows: feita } = await query(`SELECT 1 FROM cargas_feitas WHERE chave='conta-diego-sdr-2026-10'`);
  if (!feita.length) {
    if (!(await db.getGestorPorUsuario('diego'))) {
      await db.createGestor({ nome: 'Diego', usuario: 'diego', papel: 'sdr', trocar_senha: true,
        senha_hash: '6b2843666977cc5a22c5228aae90f34b:a04a17950d0f2d6a715a9830898980af61ed34baeb6733b17552415200b2319a' });
    }
    await query(`INSERT INTO cargas_feitas (chave) VALUES ('conta-diego-sdr-2026-10')`);
  }

  // Plantão inicial: os corretores das equipes do Fabrício e do Alberto (só com a tabela vazia).
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM sdr_plantao');
  if (!Number(rows[0].n)) {
    for (const [nome, tel] of require('./campanha-nimbus')) {
      await query('INSERT INTO sdr_plantao (nome, telefone) VALUES ($1,$2)', [nome, normalizarFone(tel)]);
    }
  }
}

// ---- Importar a lista ----
// Cabeçalho reconhecido pelo nome da coluna; sem cabeçalho, pelo conteúdo.
function contatosDaPlanilha(linhas) {
  if (!linhas.length) return { contatos: [], semTelefone: 0 };
  let cab = linhas[0], col = planilha.mapearColunas(cab), dados = linhas.slice(1);
  if (!col.tel.length) {
    const n = Math.max(...linhas.map(l => l.length));
    const pareceFone = (i) => linhas.filter(l => normalizarFone(l[i])).length;
    const tel = [...Array(n).keys()].filter(i => pareceFone(i) >= linhas.length * 0.5);
    const nome = [...Array(n).keys()].find(i => !tel.includes(i) && linhas.filter(l => /[a-zà-ÿ]{3}/i.test(l[i] || '')).length >= linhas.length * 0.5);
    col = { nome: nome == null ? -1 : nome, tel, email: -1 };
    cab = [...Array(n).keys()].map(i => 'Coluna ' + (i + 1));
    dados = linhas;
  }
  const contatos = [];
  let semTelefone = 0;
  for (const l of dados) {
    const fones = [];
    for (const i of col.tel) {
      for (const parte of String(l[i] || '').split(/[\/,;|]| e /)) {
        const f = normalizarFone(parte);
        if (f && !fones.includes(f)) fones.push(f);
      }
    }
    // Celular primeiro: é o que tem WhatsApp.
    fones.sort((a, b) => (b.length === 13 ? 1 : 0) - (a.length === 13 ? 1 : 0));
    if (!fones.length) { semTelefone++; continue; }
    const info = {};
    cab.forEach((h, i) => {
      if (i === col.nome || i === col.email || col.tel.includes(i)) return;
      const v = String(l[i] || '').trim();
      if (v && h) info[String(h).trim().slice(0, 40)] = v.slice(0, 200);
    });
    contatos.push({
      nome: col.nome >= 0 ? String(l[col.nome] || '').trim().slice(0, 120) : '',
      telefone: fones[0], telefone2: fones[1] || null,
      email: col.email >= 0 ? String(l[col.email] || '').trim().slice(0, 160) : '',
      info,
    });
  }
  return { contatos, semTelefone };
}

async function importar(linhas, lote) {
  const { contatos, semTelefone } = contatosDaPlanilha(linhas);
  let novos = 0, repetidos = 0;
  for (const c of contatos) {
    const ja = await query('SELECT 1 FROM sdr_contatos WHERE telefone=$1 OR telefone2=$1 LIMIT 1', [c.telefone]);
    if (ja.rows.length) { repetidos++; continue; }
    const { rows } = await query(
      `INSERT INTO sdr_contatos (nome, telefone, telefone2, email, info, lote, busca)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (telefone) DO NOTHING RETURNING id`,
      [c.nome || null, c.telefone, c.telefone2, c.email || null, JSON.stringify(c.info), lote, semAcento(c.nome || '')]
    );
    if (rows.length) novos++; else repetidos++;
  }
  return { novos, repetidos, semTelefone, lidos: contatos.length + semTelefone };
}

function lerInfo(c) {
  if (c && typeof c.info === 'string') { try { c.info = JSON.parse(c.info); } catch (e) { c.info = {}; } }
  return c;
}

// ---- Próximo da lista ----
// Ordem: retornos agendados que já venceram, contatos novos (na ordem da
// planilha) e, por fim, quem não atendeu, respeitando o intervalo.
// O contato fica reservado por 20 min para quem o pegou.
async function proximoContato(usuarioId, pularId) {
  const agora = new Date();
  const livre = `(reservado_por IS NULL OR reservado_por=$1 OR reservado_em < $2)`;
  const pula = pularId ? ` AND id <> ${Number(pularId)}` : '';
  const params = [Number(usuarioId), new Date(agora - 20 * 60000)];
  const tentativas = [
    [`status='retornar' AND retornar_em <= $3 AND ${livre}${pula} ORDER BY retornar_em ASC`, [agora]],
    [`status='novo' AND ${livre}${pula} ORDER BY id ASC`, []],
    [`status='nao_atendeu' AND tentativas < ${MAX_TENTATIVAS} AND ultima_ligacao < $3 AND ${livre}${pula} ORDER BY ultima_ligacao ASC`,
      [new Date(agora - HORAS_ENTRE_TENTATIVAS * 3600000)]],
  ];
  for (const [cond, extra] of tentativas) {
    const { rows } = await query(`SELECT * FROM sdr_contatos WHERE ${cond} LIMIT 1`, [...params, ...extra]);
    if (rows.length) {
      await reservar(rows[0].id, usuarioId);
      return lerInfo(rows[0]);
    }
  }
  return null;
}

async function reservar(id, usuarioId) {
  await query('UPDATE sdr_contatos SET reservado_por=$1, reservado_em=now() WHERE id=$2', [Number(usuarioId), Number(id)]);
}

async function getContato(id) {
  const { rows } = await query('SELECT * FROM sdr_contatos WHERE id=$1', [Number(id) || 0]);
  return lerInfo(rows[0] || null);
}

async function buscarContatos(termo, limite = 20) {
  const t = String(termo || '').trim();
  if (!t) return [];
  const dig = t.replace(/\D/g, '');
  const vals = ['%' + semAcento(t) + '%'];
  let cond = `busca LIKE $1`;
  if (dig.length >= 4) { vals.push('%' + dig + '%'); cond += ' OR telefone LIKE $2 OR telefone2 LIKE $2'; }
  const { rows } = await query(`SELECT * FROM sdr_contatos WHERE ${cond} ORDER BY id ASC LIMIT ${Number(limite) || 20}`, vals);
  return rows.map(lerInfo);
}

// Ligação para alguém fora da lista (indicação, cliente que retornou).
async function criarContato(d) {
  const tel = normalizarFone(d.telefone);
  if (!tel) return null;
  const { rows } = await query('SELECT * FROM sdr_contatos WHERE telefone=$1', [tel]);
  if (rows.length) return lerInfo(rows[0]);
  const { rows: r } = await query(
    `INSERT INTO sdr_contatos (nome, telefone, email, info, lote, busca) VALUES ($1,$2,$3,'{}','manual',$4) RETURNING *`,
    [String(d.nome || '').trim().slice(0, 120) || null, tel, String(d.email || '').trim().slice(0, 160) || null, semAcento(String(d.nome || '').trim())]
  );
  return lerInfo(r[0]);
}

// ---- Registrar a ligação ----
async function registrarLigacao({ contato, usuarioId, resultado, ficha, retornarEm, encaminhamentoId }) {
  const r = RESULTADOS[resultado];
  if (!r) throw new Error('resultado inválido');
  const classe = classificar(ficha);
  const { rows } = await query(
    `INSERT INTO sdr_ligacoes (contato_id, usuario_id, resultado, classificacao, ficha, encaminhamento_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [contato.id, Number(usuarioId), resultado, classe, ficha ? JSON.stringify(ficha) : null, encaminhamentoId || null]
  );
  await query(
    `UPDATE sdr_contatos SET status=$1, tentativas = tentativas + $2, ultima_ligacao=now(),
            retornar_em=$3, reservado_por=NULL, reservado_em=NULL WHERE id=$4`,
    [r.status, resultado === 'nao_atendeu' ? 1 : 0, resultado === 'retornar' ? retornarEm : null, contato.id]
  );
  await db.registrarEvento({
    tipo: 'sdr_ligacao', lead_nome: contato.nome, lead_telefone: contato.telefone, usuario_id: usuarioId,
    encaminhamento_id: encaminhamentoId || null,
    detalhe: [r.rotulo, classe ? 'lead ' + classe : null,
      resultado === 'retornar' && retornarEm ? 'retornar em ' + new Date(retornarEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null,
    ].filter(Boolean).join(' · '),
  });
  return rows[0];
}

async function ligacoesDoContato(id) {
  const { rows } = await query('SELECT * FROM sdr_ligacoes WHERE contato_id=$1 ORDER BY created_at DESC LIMIT 20', [Number(id)]);
  return rows;
}

// ---- Plantão: rodízio dos corretores que recebem os leads do SDR ----
async function filaPlantao() {
  const { rows } = await query(
    `SELECT * FROM sdr_plantao WHERE ativo=true
      ORDER BY atribuicoes ASC, COALESCE(ultima_atribuicao, '1970-01-01'::timestamptz) ASC, id ASC`
  );
  return rows;
}

async function listPlantao() {
  const { rows } = await query('SELECT * FROM sdr_plantao ORDER BY ativo DESC, nome ASC');
  return rows;
}

// O SDR toca no "próximo da vez" (o WhatsApp abre na hora) e a vez é gravada aqui.
async function atribuirPlantao(id) {
  const { rows } = await query(
    `UPDATE sdr_plantao SET atribuicoes = atribuicoes + 1, ultima_atribuicao = now()
      WHERE id=$1 AND ativo=true RETURNING *`, [Number(id) || 0]
  );
  return rows[0] || null;
}

// Quem entra ou volta ao plantão começa no nível de quem já está nele
// (senão receberia todos os leads seguidos até "alcançar" os outros).
async function nivelPlantao() {
  const { rows } = await query('SELECT COALESCE(MIN(atribuicoes),0)::int AS n FROM sdr_plantao WHERE ativo=true');
  return rows[0].n;
}

async function salvarPlantao(d) {
  const tel = normalizarFone(d.telefone);
  const nome = String(d.nome || '').trim().slice(0, 120);
  if (!tel || !nome) return null;
  const nivel = await nivelPlantao();
  const { rows } = await query(
    `INSERT INTO sdr_plantao (nome, telefone, atribuicoes) VALUES ($1,$2,$3)
     ON CONFLICT (telefone) DO UPDATE SET nome=EXCLUDED.nome RETURNING *`,
    [nome, tel, nivel]
  );
  return rows[0];
}

async function alternarPlantao(id) {
  const nivel = await nivelPlantao();
  await query(
    `UPDATE sdr_plantao SET ativo = NOT ativo,
            atribuicoes = CASE WHEN ativo THEN atribuicoes ELSE GREATEST(atribuicoes, $2) END
      WHERE id=$1`, [Number(id), nivel]
  );
}

async function removerPlantao(id) {
  await query('DELETE FROM sdr_plantao WHERE id=$1', [Number(id)]);
}

// ---- Números ----
async function resumoLista() {
  const { rows } = await query('SELECT status, COUNT(*)::int AS n FROM sdr_contatos GROUP BY status');
  const r = Object.fromEntries(rows.map(x => [x.status, x.n]));
  const { rows: fila } = await query(
    `SELECT COUNT(*)::int AS n FROM sdr_contatos
      WHERE status='novo' OR (status='retornar') OR (status='nao_atendeu' AND tentativas < ${MAX_TENTATIVAS})`
  );
  return { porStatus: r, total: rows.reduce((a, x) => a + x.n, 0), naFila: fila[0].n };
}

async function ligacoesPeriodo(desde, ate, usuarioId) {
  const { rows } = await query(
    `SELECT l.*, c.nome AS contato_nome, c.telefone AS contato_telefone
       FROM sdr_ligacoes l LEFT JOIN sdr_contatos c ON c.id = l.contato_id
      WHERE l.created_at >= $1 AND l.created_at < $2 ${usuarioId ? 'AND l.usuario_id=$3' : ''}
      ORDER BY l.created_at DESC LIMIT 2000`,
    usuarioId ? [desde, ate, Number(usuarioId)] : [desde, ate]
  );
  return rows.map(r => { if (typeof r.ficha === 'string') { try { r.ficha = JSON.parse(r.ficha); } catch (e) { r.ficha = null; } } return r; });
}

function resumoLigacoes(ligs) {
  const r = { ligacoes: ligs.length, atendidas: 0, qualificados: 0, quente: 0, morno: 0, porResultado: {} };
  for (const l of ligs) {
    r.porResultado[l.resultado] = (r.porResultado[l.resultado] || 0) + 1;
    if (!['nao_atendeu', 'invalido'].includes(l.resultado)) r.atendidas++;
    if (l.resultado === 'qualificado') { r.qualificados++; if (l.classificacao === 'quente') r.quente++; else r.morno++; }
  }
  return r;
}

// Envios do SDR que o corretor ainda não confirmou.
async function pendenciasSdr(usuarioId, minutos = 30) {
  const { rows } = await query(
    `SELECT * FROM encaminhamentos
      WHERE fonte='sdr' AND usuario_id=$1 AND token IS NOT NULL AND confirmado_em IS NULL AND substituido_por IS NULL
        AND created_at < $2 AND created_at > $3
      ORDER BY created_at ASC LIMIT 50`,
    [Number(usuarioId), new Date(Date.now() - minutos * 60000), new Date(Date.now() - 48 * 3600000)]
  );
  return rows;
}

// ---- Roteiro da ligação (editável no painel) ----
const SCRIPT_PADRAO = `## 1. Abertura
"Olá, bom dia! Tudo bem? Aqui é [NOME], da Auxiliadora Predial, agência Jardim do Lago, em Canoas.
Estou entrando em contato com alguns dos nossos clientes e proprietários para entender quem está considerando novas oportunidades no mercado imobiliário. Posso te fazer uma perguntinha rápida?"

## 2. Pergunta principal
"Hoje você teria interesse em adquirir mais um imóvel, pensando em investimento, seja para receber aluguel, valorização patrimonial ou até revenda futura?"
**Se SIM:** "Que ótimo! E você pensa mais em comprar um imóvel para ter renda com aluguel ou busca uma oportunidade de compra com potencial de valorização?"
**Se TALVEZ:** "Claro, faz todo sentido! Se surgisse uma oportunidade com boas condições de pagamento e preço atrativo, você teria interesse em conhecer?"
**Se NÃO:** "Perfeito, sem problemas! A ideia era justamente entender seu momento. Agradeço pela atenção e seguimos à disposição!"

## 3. Qualificação
"Para eu entender melhor o que faria sentido para você, posso te fazer três perguntas rápidas?"
**Objetivo:** "Seu foco seria gerar renda mensal com aluguel, valorizar seu patrimônio ou comprar para uma futura revenda?"
**Faixa:** "Você já tem uma faixa de valor em mente? Algo até R$ 250 mil, entre R$ 250 mil e R$ 400 mil ou acima disso?"
**Pagamento:** "Você pensaria em fazer esse investimento com recursos próprios, financiamento bancário ou uma combinação dos dois?"
**Momento:** "Se encontrássemos uma boa oportunidade, você consideraria investir agora ou está pensando em algo para os próximos meses?"

## 4. Encaminhamento
"Perfeito! Com essas informações já consigo direcionar melhor o seu perfil. Temos corretores que acompanham oportunidades de investimento na região de Canoas. Posso pedir para um dos nossos especialistas entrar em contato com você pelo WhatsApp?"

## 5. Encerramento
"Excelente! Vou encaminhar suas informações para nossa equipe. Muito obrigado pela atenção, [NOME DO CLIENTE]. Tenha um ótimo dia!"

## Objeções
- **"Não tenho dinheiro agora."** "Entendo! E se houvesse uma oportunidade com entrada facilitada ou financiamento, faria sentido conhecer?"
- **"Já tenho imóvel."** "Justamente por isso entramos em contato! Queremos entender se você considera ampliar seu patrimônio imobiliário."
- **"Os imóveis estão muito caros."** "Realmente, os valores variam bastante. Você avaliaria uma oportunidade com preço abaixo de imóveis semelhantes na região?"
- **"Só estou olhando."** "Perfeito! Podemos apresentar algumas opções para você acompanhar o mercado, sem compromisso."
- **"Não tenho interesse."** "Sem problemas! Agradeço sua atenção e desejo um ótimo dia."
- **Pediu para não ligar mais:** respeite e marque "Pediu para não ligar". O contato sai da lista.`;

async function getScript() {
  return (await db.getConfig('sdr_script')) || SCRIPT_PADRAO;
}

async function salvarScript(texto) {
  const t = String(texto || '').trim().slice(0, 20000);
  await db.setConfig('sdr_script', t || SCRIPT_PADRAO);
}

module.exports = {
  semAcento, RESULTADOS, STATUS, FICHA, MAX_TENTATIVAS, classificar, fichaLimpa,
  migrate, contatosDaPlanilha, importar, proximoContato, reservar, getContato, buscarContatos, criarContato,
  registrarLigacao, ligacoesDoContato,
  filaPlantao, listPlantao, atribuirPlantao, salvarPlantao, alternarPlantao, removerPlantao,
  resumoLista, ligacoesPeriodo, resumoLigacoes, pendenciasSdr,
  getScript, salvarScript, SCRIPT_PADRAO,
};
