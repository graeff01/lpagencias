// Camada de banco de dados (PostgreSQL).
// Em produção usa DATABASE_URL (Railway). Sem ela, cai num Postgres em memória
// (pg-mem) só para rodar/testar localmente sem instalar nada.

let pool;
let usingMemory = false;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  // A rede interna do Railway (*.railway.internal) e o Postgres local não usam SSL.
  // Conexões externas (proxy.rlwy.net, etc.) usam.
  const url = process.env.DATABASE_URL;
  const noSSL = /\.railway\.internal|localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url);
  pool = new Pool({
    connectionString: url,
    ssl: noSSL ? false : { rejectUnauthorized: false },
  });
} else {
  try {
    const { newDb } = require('pg-mem');
    const mem = newDb();
    const pg = mem.adapters.createPg();
    pool = new pg.Pool();
    usingMemory = true;
    console.log('[db] DATABASE_URL ausente — usando Postgres em memória (pg-mem) para dev local.');
  } catch (e) {
    throw new Error('DATABASE_URL não definida e pg-mem indisponível. Defina DATABASE_URL para rodar.');
  }
}

const COLS = [
  'slug', 'nome', 'construtora', 'construtora_logo', 'cidade', 'bairro', 'endereco',
  'preco_inicial', 'preco_maximo', 'descricao', 'hero_image', 'video_url', 'tour_url',
  'dormitorios', 'banheiros', 'vagas', 'area', 'status', 'entrega', 'whatsapp', 'cta',
  'cor_principal', 'cor_secundaria', 'cor_accent', 'meta_description', 'gallery', 'infra', 'plantas',
  'diferenciais', 'timeline', 'faq', 'pois', 'construtora_sobre', 'construtora_stats', 'published',
  'ga_id', 'pixel_id', 'aviso_legal', 'acabamentos',
];
const JSON_COLS = new Set(['gallery', 'infra', 'plantas', 'diferenciais', 'timeline', 'faq', 'pois', 'construtora_stats', 'acabamentos']);

async function query(text, params) {
  return pool.query(text, params);
}

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS empreendimentos (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      construtora TEXT,
      construtora_logo TEXT,
      cidade TEXT,
      bairro TEXT,
      endereco TEXT,
      preco_inicial BIGINT,
      preco_maximo BIGINT,
      descricao TEXT,
      hero_image TEXT,
      video_url TEXT,
      tour_url TEXT,
      dormitorios TEXT,
      banheiros TEXT,
      vagas TEXT,
      area TEXT,
      status TEXT DEFAULT 'Lançamento',
      entrega TEXT,
      whatsapp TEXT,
      cta TEXT DEFAULT 'Quero conhecer',
      cor_principal TEXT DEFAULT '#0E9E4A',
      cor_secundaria TEXT DEFAULT '#2BB86A',
      cor_accent TEXT DEFAULT '#F47B20',
      meta_description TEXT,
      gallery JSONB DEFAULT '[]',
      infra JSONB DEFAULT '[]',
      plantas JSONB DEFAULT '[]',
      diferenciais JSONB DEFAULT '[]',
      timeline JSONB DEFAULT '[]',
      faq JSONB DEFAULT '[]',
      pois JSONB DEFAULT '[]',
      construtora_sobre TEXT,
      construtora_stats JSONB DEFAULT '[]',
      ga_id TEXT,
      pixel_id TEXT,
      aviso_legal TEXT,
      acabamentos JSONB DEFAULT '[]',
      published BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Migração incremental para bancos já existentes
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS cor_accent TEXT DEFAULT '#F47B20';`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS ga_id TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS pixel_id TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS aviso_legal TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS acabamentos JSONB DEFAULT '[]';`);

  await migrateRoleta();

  const { rows } = await query('SELECT COUNT(*)::int AS n FROM empreendimentos');
  if (rows[0].n === 0) {
    await seed();
    console.log('[db] Empreendimento de exemplo (Reserva Moinhos) criado.');
  }
}

function normalize(data) {
  const out = {};
  for (const c of COLS) {
    let v = data[c];
    if (JSON_COLS.has(c)) {
      if (v === undefined || v === null) v = [];
      v = JSON.stringify(Array.isArray(v) ? v : []);
    } else if (c === 'preco_inicial' || c === 'preco_maximo') {
      v = (v === '' || v === undefined || v === null) ? null : Number(String(v).replace(/\D/g, '')) || null;
    } else if (c === 'published') {
      v = v === true || v === 'true' || v === 'on' || v === '1';
    } else if (v === undefined) {
      v = null;
    }
    out[c] = v;
  }
  return out;
}

async function create(data) {
  const d = normalize(data);
  const cols = COLS.slice();
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const values = cols.map(c => d[c]);
  const { rows } = await query(
    `INSERT INTO empreendimentos (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
    values
  );
  return rows[0];
}

async function update(id, data) {
  const d = normalize(data);
  const cols = COLS.slice();
  const sets = cols.map((c, i) => `${c}=$${i + 1}`);
  const values = cols.map(c => d[c]);
  values.push(id);
  const { rows } = await query(
    `UPDATE empreendimentos SET ${sets.join(',')}, updated_at=now() WHERE id=$${values.length} RETURNING *`,
    values
  );
  return rows[0];
}

async function list({ publishedOnly = false } = {}) {
  const where = publishedOnly ? 'WHERE published = true' : '';
  const { rows } = await query(`SELECT * FROM empreendimentos ${where} ORDER BY created_at DESC`);
  return rows;
}

async function getBySlug(slug) {
  const { rows } = await query('SELECT * FROM empreendimentos WHERE slug=$1', [slug]);
  return rows[0];
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM empreendimentos WHERE id=$1', [id]);
  return rows[0];
}

async function remove(id) {
  await query('DELETE FROM empreendimentos WHERE id=$1', [id]);
}

async function slugExists(slug, exceptId) {
  const { rows } = await query(
    'SELECT id FROM empreendimentos WHERE slug=$1 AND ($2::int IS NULL OR id <> $2)',
    [slug, exceptId || null]
  );
  return rows.length > 0;
}

async function seed() {
  const u = 'https://images.unsplash.com/';
  await create({
    slug: 'reserva-moinhos',
    nome: 'Reserva Moinhos',
    construtora: 'Nortis Incorporadora',
    construtora_logo: '',
    cidade: 'Porto Alegre',
    bairro: 'Moinhos de Vento',
    endereco: 'Rua Padre Chagas, 415 — Moinhos de Vento',
    preco_inicial: 890000,
    preco_maximo: 2480000,
    descricao: 'Viver no coração do Moinhos de Vento, a poucos passos dos melhores restaurantes e do Parcão. Plantas inteligentes, acabamento premium e uma área de lazer completa no rooftop.',
    hero_image: u + 'photo-1545324418-cc1a3fa10c00?w=1600&q=70',
    video_url: '',
    tour_url: '',
    dormitorios: '2 a 4',
    banheiros: '3',
    vagas: '2',
    area: '78 a 164',
    status: 'Lançamento',
    entrega: 'Dezembro / 2027',
    whatsapp: '(51) 99000-0000',
    cta: 'Quero conhecer',
    cor_principal: '#0E9E4A',
    cor_secundaria: '#2BB86A',
    meta_description: 'Reserva Moinhos — apartamentos de 2 a 4 dormitórios no Moinhos de Vento, Porto Alegre. Lazer completo e localização privilegiada. Agende sua visita.',
    gallery: [
      { url: u + 'photo-1613490493576-7fde63acd811?w=1000&q=70', tag: 'Fachada & área externa' },
      { url: u + 'photo-1600607687939-ce8a6c25118c?w=900&q=70', tag: 'Living integrado' },
      { url: u + 'photo-1600047509807-ba8f99d2cdde?w=900&q=70', tag: 'Paisagismo' },
      { url: u + 'photo-1571003123894-1f0594d2b5d9?w=900&q=70', tag: 'Piscina & lazer' },
      { url: u + 'photo-1502005229762-cf1b2da7c5d6?w=900&q=70', tag: 'Interiores' },
    ],
    infra: [
      { titulo: 'Piscina aquecida', sub: 'Raia de 25m + infantil' },
      { titulo: 'Academia', sub: 'Equipada Technogym' },
      { titulo: 'Rooftop lounge', sub: 'Vista panorâmica da cidade' },
      { titulo: 'Coworking', sub: 'Salas privativas' },
      { titulo: 'Pet place', sub: 'Área e pet wash' },
      { titulo: 'Espaço gourmet', sub: 'Churrasqueira e forno' },
      { titulo: 'Sauna', sub: 'Seca e a vapor' },
      { titulo: 'Salão de festas', sub: 'Decorado + copa' },
      { titulo: 'Playground', sub: 'Brinquedoteca coberta' },
      { titulo: 'Concierge 24h', sub: 'Portaria com segurança' },
      { titulo: 'Lounge musical', sub: 'Sala de som' },
      { titulo: 'Carregador elétrico', sub: 'Infra para EV' },
    ],
    plantas: [
      { titulo: '2 dormitórios', area: '78 m²', quartos: '2', banheiros: '1', vagas: '1', final: 'Final 01 · 04' },
      { titulo: '3 dormitórios', area: '116 m²', quartos: '3', banheiros: '2', vagas: '2', final: 'Final 02 · 03' },
      { titulo: '4 dormitórios', area: '164 m²', quartos: '4', banheiros: '3', vagas: '3', final: 'Cobertura' },
    ],
    diferenciais: [
      { titulo: 'Localização insuperável', texto: 'No coração do Moinhos de Vento, a poucos passos do Parcão, dos melhores restaurantes e da Rua Padre Chagas — o endereço mais desejado de Porto Alegre.' },
      { titulo: 'Alto padrão construtivo', texto: 'Acabamento premium, automação residencial, esquadrias com vidro duplo e infraestrutura completa para carregador de carro elétrico.' },
      { titulo: 'Valorização garantida', texto: 'Região com a maior valorização de Porto Alegre nos últimos 5 anos, com liquidez imediata e alta procura para locação.' },
    ],
    timeline: [
      { etapa: 'Fundação', sub: 'Concluída · 2024', pct: '100%', done: true, act: false },
      { etapa: 'Estrutura', sub: 'Concluída · 2025', pct: '100%', done: true, act: false },
      { etapa: 'Alvenaria', sub: 'Em andamento', pct: '64%', done: true, act: true },
      { etapa: 'Acabamento', sub: 'Previsto 2027', pct: '—', done: false, act: false },
      { etapa: 'Entrega das chaves', sub: 'Dez / 2027', pct: '—', done: false, act: false },
    ],
    faq: [
      { q: 'Qual o valor de entrada e as condições de pagamento?', a: 'Trabalhamos com planos flexíveis, entrada facilitada e parcelamento direto com a construtora durante a obra. Fale com um consultor para simular a melhor condição para o seu perfil.' },
      { q: 'Posso visitar o apartamento decorado?', a: 'Sim! O decorado está disponível para visita agendada. Clique em "Quero conhecer" e um consultor marca o melhor horário para você.' },
      { q: 'Qual a previsão de entrega?', a: 'A entrega está prevista para dezembro de 2027, com a obra dentro do cronograma e acompanhamento transparente de cada etapa.' },
      { q: 'O empreendimento aceita financiamento bancário?', a: 'Sim, o empreendimento é elegível para financiamento nas principais instituições, com assessoria completa da nossa equipe do início ao fim.' },
    ],
    pois: [
      { label: '🌳 Parcão · 400m', pos: 'top:22%;left:16%' },
      { label: '🍽️ Padre Chagas · 200m', pos: 'top:64%;left:24%' },
      { label: '🏥 Hospital Moinhos · 900m', pos: 'top:30%;right:14%' },
      { label: '🛍️ Moinhos Shopping · 1,2km', pos: 'bottom:22%;right:20%' },
    ],
    construtora_sobre: 'Há mais de 30 anos construindo empreendimentos de alto padrão no Sul do Brasil, com mais de 80 obras entregues e reconhecimento nacional por qualidade, inovação e pontualidade nas entregas.',
    construtora_stats: [
      { num: '30+', label: 'anos de mercado' },
      { num: '80+', label: 'obras entregues' },
      { num: '100%', label: 'no prazo' },
      { num: '2.400+', label: 'famílias' },
    ],
    published: true,
  });
}


// =====================================================================
//  ROLETA DE CORRETORES  —  distribuição rodiziada de leads
// ---------------------------------------------------------------------
//  corretores          : quem recebe os leads de cada empreendimento
//  cliques_whatsapp    : log imutável de cada clique (auditoria + relatório)
// =====================================================================

async function migrateRoleta() {
  await query(`
    CREATE TABLE IF NOT EXISTS corretores (
      id SERIAL PRIMARY KEY,
      empreendimento_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      telefone TEXT NOT NULL,
      email TEXT,
      creci TEXT,
      ativo BOOLEAN DEFAULT true,
      peso INTEGER DEFAULT 1,
      atribuicoes INTEGER DEFAULT 0,
      leads_total INTEGER DEFAULT 0,
      ultima_atribuicao TIMESTAMPTZ,
      ordem INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS cliques_whatsapp (
      id SERIAL PRIMARY KEY,
      empreendimento_id INTEGER NOT NULL,
      corretor_id INTEGER,
      origem TEXT,
      novo_lead BOOLEAN DEFAULT true,
      bot BOOLEAN DEFAULT false,
      resgate BOOLEAN DEFAULT false,
      corretor_anterior INTEGER,
      motivo TEXT,
      visitante TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      referer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Migração incremental para bancos que já rodavam antes do resgate
  for (const sql of [
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS resgate BOOLEAN DEFAULT false`,
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS corretor_anterior INTEGER`,
  ]) { try { await query(sql); } catch (e) { /* pg-mem */ } }

  for (const sql of [
    `CREATE INDEX IF NOT EXISTS idx_corretores_emp ON corretores(empreendimento_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cliques_emp ON cliques_whatsapp(empreendimento_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cliques_ip ON cliques_whatsapp(empreendimento_id, ip_hash, created_at DESC)`,
  ]) { try { await query(sql); } catch (e) { /* pg-mem pode não suportar */ } }
}

// ---- CRUD de corretores ----
async function listCorretores(empId, { ativosOnly = false } = {}) {
  const where = ativosOnly ? 'AND ativo = true' : '';
  const { rows } = await query(
    `SELECT * FROM corretores WHERE empreendimento_id=$1 ${where} ORDER BY ordem ASC, id ASC`,
    [empId]
  );
  return rows;
}

async function getCorretor(id) {
  const { rows } = await query('SELECT * FROM corretores WHERE id=$1', [id]);
  return rows[0];
}

// Contador inicial = menor contador entre os ativos, para o novo corretor
// entrar "no fim da fila atual" em vez de receber uma enxurrada de catch-up.
async function baseContador(empId) {
  const { rows } = await query(
    'SELECT COALESCE(MIN(atribuicoes),0) AS m FROM corretores WHERE empreendimento_id=$1 AND ativo=true',
    [empId]
  );
  return Number(rows[0] ? rows[0].m : 0) || 0;
}

async function createCorretor(empId, d) {
  const base = await baseContador(empId);
  const { rows } = await query(
    `INSERT INTO corretores (empreendimento_id, nome, telefone, email, creci, ativo, peso, atribuicoes, ordem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [empId, d.nome, d.telefone, d.email || null, d.creci || null,
     d.ativo !== false, Math.max(1, Number(d.peso) || 1), base, Number(d.ordem) || 0]
  );
  return rows[0];
}

async function updateCorretor(id, d) {
  const atual = await getCorretor(id);
  if (!atual) return null;
  const ativo = d.ativo !== false;
  // Voltou de uma pausa? Reentra na fila no nível de quem está ativo hoje,
  // senão ele "cobraria" todos os leads que perdeu enquanto esteve fora.
  let atribuicoes = atual.atribuicoes;
  if (!atual.ativo && ativo) atribuicoes = await baseContador(atual.empreendimento_id);
  const { rows } = await query(
    `UPDATE corretores SET nome=$1, telefone=$2, email=$3, creci=$4, ativo=$5, peso=$6,
            ordem=$7, atribuicoes=$8 WHERE id=$9 RETURNING *`,
    [d.nome, d.telefone, d.email || null, d.creci || null, ativo,
     Math.max(1, Number(d.peso) || 1), Number(d.ordem) || 0, atribuicoes, id]
  );
  return rows[0];
}

async function removeCorretor(id) {
  // O histórico de cliques continua (corretor_id vira órfão de propósito,
  // para o relatório antigo não mudar depois de uma exclusão).
  await query('DELETE FROM corretores WHERE id=$1', [id]);
}

async function zerarContadores(empId) {
  await query('UPDATE corretores SET atribuicoes=0 WHERE empreendimento_id=$1', [empId]);
}

// ---- O sorteio em si ----
// Proteção em duas camadas contra dois cliques no mesmo instante:
//   1. fila em memória, que serializa os cliques dentro deste processo Node;
//   2. advisory lock no Postgres, que cobre múltiplas instâncias do app.
// Sem as duas, cliques simultâneos leem o mesmo contador e caem no mesmo corretor.
const filas = new Map();

function naFila(chave, tarefa) {
  const anterior = filas.get(chave) || Promise.resolve();
  const atual = anterior.then(tarefa, tarefa);
  const guarda = atual.then(() => {}, () => {});  // um erro não pode travar a fila
  filas.set(chave, guarda);
  guarda.then(() => { if (filas.get(chave) === guarda) filas.delete(chave); });
  return atual;
}

// excluirId: no resgate, o corretor que não deu retorno não pode pegar de novo.
function proximoCorretor(empId, excluirId) {
  return naFila('roleta:' + empId, () => escolherCorretor(empId, excluirId || null));
}

async function escolherCorretor(empId, excluirId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!usingMemory) {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [Number(empId)]);
    }
    const { rows } = await client.query(
      `SELECT * FROM corretores
        WHERE empreendimento_id=$1 AND ativo=true
          AND ($2::int IS NULL OR id <> $2)
        ORDER BY (atribuicoes::numeric / GREATEST(peso,1)) ASC,
                 COALESCE(ultima_atribuicao, '1970-01-01'::timestamptz) ASC,
                 id ASC
        LIMIT 1`,
      [empId, excluirId]
    );
    const c = rows[0];
    if (!c) { await client.query('ROLLBACK'); return null; }
    await client.query(
      `UPDATE corretores SET atribuicoes = atribuicoes + 1, leads_total = leads_total + 1,
              ultima_atribuicao = now() WHERE id=$1`,
      [c.id]
    );
    await client.query('COMMIT');
    return c;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- Log de cliques ----
async function registrarClique(d) {
  const { rows } = await query(
    `INSERT INTO cliques_whatsapp
       (empreendimento_id, corretor_id, origem, novo_lead, bot, motivo, visitante,
        ip_hash, user_agent, referer, utm_source, utm_medium, utm_campaign,
        resgate, corretor_anterior)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [d.empreendimento_id, d.corretor_id || null, d.origem || null, !!d.novo_lead, !!d.bot,
     d.motivo || null, d.visitante || null, d.ip_hash || null,
     (d.user_agent || '').slice(0, 400), (d.referer || '').slice(0, 400),
     d.utm_source || null, d.utm_medium || null, d.utm_campaign || null,
     !!d.resgate, d.corretor_anterior || null]
  );
  return rows[0];
}

// Última atribuição deste visitante (cookie ou IP): quem pegou e há quanto tempo.
async function ultimaAtribuicao(empId, visitante, ipHash) {
  const { rows } = await query(
    `SELECT corretor_id, created_at FROM cliques_whatsapp
      WHERE empreendimento_id=$1 AND corretor_id IS NOT NULL AND bot=false
        AND (visitante=$2 OR ip_hash=$3)
      ORDER BY created_at DESC LIMIT 1`,
    [empId, visitante || '', ipHash || '']
  );
  return rows[0] || null;
}

// ---- Relatórios ----
async function statsCorretores(empId, dias) {
  const desde = dias ? new Date(Date.now() - Number(dias) * 864e5) : new Date(0);
  const { rows } = await query(
    `SELECT c.id, c.nome, c.telefone, c.ativo, c.peso, c.atribuicoes, c.ultima_atribuicao,
            COALESCE(SUM(CASE WHEN cl.novo_lead THEN 1 ELSE 0 END),0)::int AS leads,
            COALESCE(SUM(CASE WHEN cl.resgate THEN 1 ELSE 0 END),0)::int AS resgatados,
            COALESCE(SUM(CASE WHEN cl.id IS NULL THEN 0 ELSE 1 END),0)::int AS cliques,
            MAX(cl.created_at) AS ultimo_clique
       FROM corretores c
       LEFT JOIN cliques_whatsapp cl
         ON cl.corretor_id = c.id AND cl.bot = false AND cl.created_at > $2
      WHERE c.empreendimento_id = $1
      GROUP BY c.id, c.nome, c.telefone, c.ativo, c.peso, c.atribuicoes, c.ultima_atribuicao
      ORDER BY leads DESC, c.nome ASC`,
    [empId, desde]
  );
  return rows;
}

// Leads que saíram da mão de cada corretor por falta de retorno em 24h.
async function naoRetornados(empId, dias) {
  const desde = dias ? new Date(Date.now() - Number(dias) * 864e5) : new Date(0);
  const { rows } = await query(
    `SELECT corretor_anterior AS id, COUNT(*)::int AS n
       FROM cliques_whatsapp
      WHERE empreendimento_id=$1 AND resgate=true AND corretor_anterior IS NOT NULL
        AND created_at > $2
      GROUP BY corretor_anterior`,
    [empId, desde]
  );
  const mapa = {};
  for (const r of rows) mapa[r.id] = r.n;
  return mapa;
}

async function cliquesRecentes(empId, limite = 200) {
  const { rows } = await query(
    `SELECT cl.*, c.nome AS corretor_nome
       FROM cliques_whatsapp cl
       LEFT JOIN corretores c ON c.id = cl.corretor_id
      WHERE cl.empreendimento_id = $1
      ORDER BY cl.created_at DESC
      LIMIT $2`,
    [empId, limite]
  );
  return rows;
}

async function resumoCliques(empId) {
  const sete = new Date(Date.now() - 7 * 864e5);
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN bot=false THEN 1 ELSE 0 END),0)::int AS cliques,
       COALESCE(SUM(CASE WHEN bot=false AND novo_lead THEN 1 ELSE 0 END),0)::int AS leads,
       COALESCE(SUM(CASE WHEN bot=true THEN 1 ELSE 0 END),0)::int AS bots,
       COALESCE(SUM(CASE WHEN resgate=true THEN 1 ELSE 0 END),0)::int AS resgates,
       COALESCE(SUM(CASE WHEN bot=false AND created_at > $2 THEN 1 ELSE 0 END),0)::int AS cliques_7d,
       COALESCE(SUM(CASE WHEN bot=false AND novo_lead AND created_at > $2 THEN 1 ELSE 0 END),0)::int AS leads_7d
     FROM cliques_whatsapp WHERE empreendimento_id=$1`,
    [empId, sete]
  );
  return rows[0] || { cliques: 0, leads: 0, bots: 0, resgates: 0, cliques_7d: 0, leads_7d: 0 };
}

module.exports = {
  pool, query, migrate, create, update, list, getBySlug, getById, remove, slugExists, usingMemory,
  // roleta de corretores
  listCorretores, getCorretor, createCorretor, updateCorretor, removeCorretor, zerarContadores,
  proximoCorretor, registrarClique, ultimaAtribuicao,
  statsCorretores, naoRetornados, cliquesRecentes, resumoCliques,
};
