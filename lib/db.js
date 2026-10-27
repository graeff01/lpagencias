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
  'ga_id', 'pixel_id', 'ads_conversao', 'seo_titulo', 'aviso_legal', 'acabamentos',
  'card_selo', 'card_imagem', 'card_resumo', 'vitrine_ordem', 'dominio', 'lat', 'lon', 'tipo_imovel',
  'hero_video', 'planta_interativa',
];
const JSON_COLS = new Set(['gallery', 'infra', 'plantas', 'diferenciais', 'timeline', 'faq', 'pois', 'construtora_stats', 'acabamentos']);

// "https://www.Exemplo.com.br/" -> "www.exemplo.com.br". O www é mantido:
// é o endereço que de fato responde (vira o canonical da landing).
function normalizarDominio(v) {
  return String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

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
      ads_conversao TEXT,
      seo_titulo TEXT,
      home BOOLEAN DEFAULT false,
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
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS ads_conversao TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS seo_titulo TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS home BOOLEAN DEFAULT false;`);
  // Filme de fundo na abertura e planta com cômodos clicáveis (opcionais).
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS hero_video TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS planta_interativa JSONB;`);
  // Vitrine do portal: o card de cada empreendimento na página principal.
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS card_selo TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS card_imagem TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS card_resumo TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS vitrine_ordem INTEGER DEFAULT 0;`);
  // Domínio próprio do empreendimento (ex.: vangoghpetropolis.com.br): quem
  // chega por ele é redirecionado para a landing dentro do site principal.
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS dominio TEXT;`);
  // Ponto do empreendimento no mapa (confirmado no painel): base das distâncias.
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS lat TEXT;`);
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS lon TEXT;`);
  // "Apartamentos" (padrão) ou "Casas": entra no título do Google e nos textos.
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS tipo_imovel TEXT;`);
  await herdarDominioDaHome();

  // Conteúdo institucional do portal: uma linha só, com tudo num jsonb,
  // para a pessoa do marketing mudar texto sem depender de código.
  await query(`
    CREATE TABLE IF NOT EXISTS portal_config (
      id INTEGER PRIMARY KEY,
      dados JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await migrateRoleta();

  const { rows } = await query('SELECT COUNT(*)::int AS n FROM empreendimentos');
  if (rows[0].n === 0) {
    await seed();
    console.log('[db] Empreendimento de exemplo (Reserva Moinhos) criado.');
  }
}

// Antes do portal, o empreendimento marcado como "página inicial" ocupava a
// raiz do SITE_DOMINIO. Esse domínio é dele: a migração registra isso uma
// vez, para a landing continuar na raiz do próprio domínio sem passo manual.
async function herdarDominioDaHome() {
  const site = normalizarDominio(process.env.SITE_DOMINIO);
  if (!site || /\.railway\.app$/.test(site)) return;
  // Domínio digitado sem o www no painel: guarda a forma que responde de fato.
  await query('UPDATE empreendimentos SET dominio=$1 WHERE dominio=$2', [site, site.replace(/^www\./, '')]);
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM empreendimentos WHERE dominio IS NOT NULL AND dominio <> ''");
  if (rows[0].n > 0) return;
  const home = await query('SELECT id FROM empreendimentos WHERE home = true AND published = true ORDER BY id ASC LIMIT 1');
  if (home.rows[0]) {
    await query('UPDATE empreendimentos SET dominio=$1 WHERE id=$2', [site, home.rows[0].id]);
    console.log(`[db] ${site} passa a mostrar o empreendimento ${home.rows[0].id} na raiz.`);
  }
}

function normalize(data) {
  const out = {};
  for (const c of COLS) {
    let v = data[c];
    if (JSON_COLS.has(c)) {
      if (v === undefined || v === null) v = [];
      v = JSON.stringify(Array.isArray(v) ? v : []);
    } else if (c === 'planta_interativa') {
      v = v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : null;
    } else if (c === 'preco_inicial' || c === 'preco_maximo') {
      v = (v === '' || v === undefined || v === null) ? null : Number(String(v).replace(/\D/g, '')) || null;
    } else if (c === 'lat' || c === 'lon') {
      v = (v === '' || v == null || !isFinite(Number(v))) ? null : String(Number(v));
    } else if (c === 'dominio') {
      v = normalizarDominio(v) || null;
    } else if (c === 'vitrine_ordem') {
      v = Number(v) || 0;
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

// Ordem da vitrine: menor "vitrine_ordem" primeiro; empate, o mais recente.
async function list({ publishedOnly = false } = {}) {
  const where = publishedOnly ? 'WHERE published = true' : '';
  const { rows } = await query(
    `SELECT * FROM empreendimentos ${where} ORDER BY COALESCE(vitrine_ordem,0) ASC, created_at DESC`
  );
  return rows;
}

// ---- Configuração do portal (linha única, id = 1) ----
async function getPortal() {
  const { rows } = await query('SELECT dados, updated_at FROM portal_config WHERE id=1');
  if (!rows[0]) return null;
  let d = rows[0].dados;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
  return { ...(d || {}), _salvo_em: rows[0].updated_at };
}

async function savePortal(dados) {
  const json = JSON.stringify(dados || {});
  const { rows } = await query('UPDATE portal_config SET dados=$1, updated_at=now() WHERE id=1 RETURNING id', [json]);
  if (!rows.length) await query('INSERT INTO portal_config (id, dados) VALUES (1, $1)', [json]);
}

async function getBySlug(slug) {
  const { rows } = await query('SELECT * FROM empreendimentos WHERE slug=$1', [slug]);
  return rows[0];
}

// Grava só os pontos próximos (e o ponto no mapa, se veio da busca automática).
async function setPois(id, pois, lat, lon) {
  if (lat != null && lon != null) {
    await query('UPDATE empreendimentos SET pois=$1, lat=$2, lon=$3 WHERE id=$4', [JSON.stringify(pois), String(lat), String(lon), id]);
  } else {
    await query('UPDATE empreendimentos SET pois=$1 WHERE id=$2', [JSON.stringify(pois), id]);
  }
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
      corretor_fone TEXT,
      anterior_fone TEXT,
      lead_nome TEXT,
      lead_telefone TEXT,
      interesse TEXT,
      protocolo TEXT,
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
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS corretor_fone TEXT`,
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS anterior_fone TEXT`,
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS lead_nome TEXT`,
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS lead_telefone TEXT`,
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS interesse TEXT`,
    `ALTER TABLE cliques_whatsapp ADD COLUMN IF NOT EXISTS protocolo TEXT`,
  ]) { try { await query(sql); } catch (e) { /* pg-mem */ } }

  for (const sql of [
    `CREATE INDEX IF NOT EXISTS idx_corretores_emp ON corretores(empreendimento_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cliques_emp ON cliques_whatsapp(empreendimento_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cliques_ip ON cliques_whatsapp(empreendimento_id, ip_hash, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cliques_data ON cliques_whatsapp(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cliques_lead_tel ON cliques_whatsapp(empreendimento_id, lead_telefone, created_at DESC)`,
  ]) { try { await query(sql); } catch (e) { /* pg-mem pode não suportar */ } }

  await migrateEquipes();
}

// Só dígitos com DDI 55: a mesma regra de roleta.digitos (que importa este
// arquivo, por isso a cópia). É a identidade do corretor entre empreendimentos.
function fone(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d && !d.startsWith('55')) d = '55' + d;
  return d;
}

// =====================================================================
//  EQUIPES  —  gestores e os corretores de cada um
// ---------------------------------------------------------------------
//  O mesmo corretor é cadastrado uma vez em cada empreendimento; o que o
//  identifica entre eles é o WhatsApp. A equipe, então, é uma lista de
//  telefones por gestor, e o clique guarda o telefone de quem o recebeu:
//  excluir o corretor de um empreendimento não apaga o histórico da equipe.
// =====================================================================
async function migrateEquipes() {
  await query(`
    CREATE TABLE IF NOT EXISTS gestores (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      papel TEXT DEFAULT 'gestor',
      trocar_senha BOOLEAN DEFAULT false,
      ativo BOOLEAN DEFAULT true,
      ultimo_acesso TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS equipe_corretores (
      telefone TEXT PRIMARY KEY,
      gestor_id INTEGER NOT NULL,
      nome TEXT
    );
  `);
  try { await query(`ALTER TABLE gestores ADD COLUMN IF NOT EXISTS papel TEXT DEFAULT 'gestor'`); } catch (e) { /* pg-mem */ }
  try { await query('ALTER TABLE gestores ADD COLUMN IF NOT EXISTS trocar_senha BOOLEAN DEFAULT false'); } catch (e) { /* pg-mem */ }

  // Recepção: todos os corretores da agência (não só os das roletas) e o
  // registro de cada lead encaminhado. O conteúdo do lead não é guardado.
  await query(`
    CREATE TABLE IF NOT EXISTS agencia_corretores (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      telefone TEXT UNIQUE NOT NULL,
      ativo BOOLEAN DEFAULT true,
      destaque BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS encaminhamentos (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER,
      corretor_fone TEXT NOT NULL,
      corretor_nome TEXT,
      canal TEXT,
      empreendimento_id INTEGER,
      entrada_id INTEGER,
      token TEXT,
      confirmado_em TIMESTAMPTZ,
      substituido_por INTEGER,
      cobrancas INTEGER DEFAULT 0,
      ultima_cobranca TIMESTAMPTZ,
      lead_nome TEXT,
      lead_telefone TEXT,
      lead_email TEXT,
      negocio TEXT,
      imovel TEXT,
      origem TEXT,
      mensagem TEXT,
      fonte TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Dados do lead (auditoria): bancos criados antes deles ganham as colunas.
  for (const col of ['lead_nome', 'lead_telefone', 'lead_email', 'negocio', 'imovel', 'origem', 'mensagem']) {
    try { await query(`ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS ${col} TEXT`); } catch (e) { /* pg-mem */ }
  }
  try { await query('ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS empreendimento_id INTEGER'); } catch (e) { /* pg-mem */ }
  for (const sql of [
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS entrada_id INTEGER',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS token TEXT',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS confirmado_em TIMESTAMPTZ',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS substituido_por INTEGER',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS cobrancas INTEGER DEFAULT 0',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS ultima_cobranca TIMESTAMPTZ',
    // 'sdr' = enviado pelo SDR depois da ligação; vazio = recepção.
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS fonte TEXT',
    // Retorno do corretor sobre o atendimento (visita, proposta, fechou…).
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS retorno TEXT',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS retorno_em TIMESTAMPTZ',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS retorno_obs TEXT',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS retorno_pedidos INTEGER DEFAULT 0',
    'ALTER TABLE encaminhamentos ADD COLUMN IF NOT EXISTS retorno_pedido_em TIMESTAMPTZ',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_encaminhamentos_token ON encaminhamentos(token)',
  ]) { try { await query(sql); } catch (e) { /* pg-mem */ } }

  // Leads que chegaram sozinhos (e-mail lido pelo sistema) e esperam a
  // recepção encaminhar. message_id evita importar o mesmo e-mail duas vezes.
  await query(`
    CREATE TABLE IF NOT EXISTS leads_entrada (
      id SERIAL PRIMARY KEY,
      fonte TEXT,
      message_id TEXT UNIQUE,
      remetente TEXT,
      assunto TEXT,
      recebido_em TIMESTAMPTZ,
      bruto TEXT,
      dados JSONB,
      status TEXT DEFAULT 'pendente',
      encaminhamento_id INTEGER,
      tratado_em TIMESTAMPTZ,
      tratado_por INTEGER,
      motivo TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  try { await query('CREATE INDEX IF NOT EXISTS idx_leads_entrada_status ON leads_entrada(status, created_at DESC)'); } catch (e) { /* pg-mem */ }

  // Linha do tempo de cada lead: um registro por acontecimento (e-mail chegou,
  // recepção abriu, encaminhou, corretor abriu o link, confirmou…). Só aceita
  // inclusão: no Postgres um gatilho barra UPDATE e DELETE, com uma exceção —
  // a anonimização da LGPD, que só pode apagar nome e telefone.
  await query(`
    CREATE TABLE IF NOT EXISTS lead_eventos (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      lead_nome TEXT,
      lead_telefone TEXT,
      entrada_id INTEGER,
      encaminhamento_id INTEGER,
      clique_id INTEGER,
      empreendimento_id INTEGER,
      corretor_nome TEXT,
      corretor_fone TEXT,
      usuario_id INTEGER,
      detalhe TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_eventos_tel ON lead_eventos(lead_telefone, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_eventos_env ON lead_eventos(encaminhamento_id)',
    'CREATE INDEX IF NOT EXISTS idx_eventos_ent ON lead_eventos(entrada_id)',
    `CREATE OR REPLACE FUNCTION lead_eventos_imutavel() RETURNS trigger AS $f$
     BEGIN
       IF TG_OP = 'UPDATE'
          AND NEW.lead_nome IS NULL AND NEW.lead_telefone IS NULL
          AND (NEW.id, NEW.tipo, NEW.entrada_id, NEW.encaminhamento_id, NEW.clique_id, NEW.empreendimento_id,
               NEW.corretor_nome, NEW.corretor_fone, NEW.usuario_id, NEW.detalhe, NEW.created_at)
              IS NOT DISTINCT FROM
              (OLD.id, OLD.tipo, OLD.entrada_id, OLD.encaminhamento_id, OLD.clique_id, OLD.empreendimento_id,
               OLD.corretor_nome, OLD.corretor_fone, OLD.usuario_id, OLD.detalhe, OLD.created_at)
       THEN RETURN NEW; END IF;
       RAISE EXCEPTION 'lead_eventos é um registro de auditoria: não pode ser alterado nem apagado';
     END $f$ LANGUAGE plpgsql`,
    'DROP TRIGGER IF EXISTS trg_lead_eventos_imutavel ON lead_eventos',
    'CREATE TRIGGER trg_lead_eventos_imutavel BEFORE UPDATE OR DELETE ON lead_eventos FOR EACH ROW EXECUTE FUNCTION lead_eventos_imutavel()',
  ]) { try { await query(sql); } catch (e) { if (!usingMemory) console.error('[db] auditoria:', e.message); } }

  // Configurações guardadas pelo painel (ex.: conexão com a caixa de e-mail).
  await query(`
    CREATE TABLE IF NOT EXISTS config_kv (
      chave TEXT PRIMARY KEY,
      valor TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Campanhas da recepção: empreendimentos cuja roleta aparece na tela dela.
  // A fila é a mesma da landing, então lead do site e lead encaminhado pela
  // recepção entram no mesmo rodízio.
  await query(`
    CREATE TABLE IF NOT EXISTS recepcao_campanhas (
      empreendimento_id INTEGER PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  try { await query('CREATE INDEX IF NOT EXISTS idx_encaminhamentos_lead ON encaminhamentos(lead_telefone)'); } catch (e) { /* pg-mem */ }
  try { await query('CREATE INDEX IF NOT EXISTS idx_encaminhamentos_data ON encaminhamentos(created_at DESC)'); } catch (e) { /* pg-mem */ }

  // As duas "Ana" da primeira carga não eram corretoras. Sai só quem tem esse
  // nome exato: alguém recadastrado à mão pelo painel não é tocado.
  await query(`DELETE FROM agencia_corretores WHERE nome IN ('Ana (final 9794)', 'Ana (final 4424)')`);

  try { await query('ALTER TABLE agencia_corretores ADD COLUMN IF NOT EXISTS destaque BOOLEAN DEFAULT false'); } catch (e) { /* pg-mem */ }

  // Primeira carga da lista da recepção (só com a tabela vazia).
  const { rows: jaTem } = await query('SELECT COUNT(*)::int AS n FROM agencia_corretores');
  if (!Number(jaTem[0].n)) {
    for (const [nome, tel] of require('./agencia-inicial')) {
      await query('INSERT INTO agencia_corretores (nome, telefone, ativo) VALUES ($1,$2,true)', [nome, fone(tel)]);
    }
  }

  await query('CREATE TABLE IF NOT EXISTS cargas_feitas (chave TEXT PRIMARY KEY, feita_em TIMESTAMPTZ DEFAULT now())');
  await cargasUnicas();

  // Cliques anteriores a esta coluna: completa com o telefone atual do corretor.
  const { rows } = await query('SELECT id, telefone FROM corretores');
  for (const c of rows) {
    const f = fone(c.telefone);
    await query('UPDATE cliques_whatsapp SET corretor_fone=$1 WHERE corretor_id=$2 AND corretor_fone IS NULL', [f, c.id]);
    await query('UPDATE cliques_whatsapp SET anterior_fone=$1 WHERE corretor_anterior=$2 AND anterior_fone IS NULL', [f, c.id]);
  }
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
  await query(
    'UPDATE corretores SET atribuicoes=0, ultima_atribuicao=NULL WHERE empreendimento_id=$1',
    [empId]
  );
}

// Grava a ordem sorteada e reinicia a fila para que ela valha de verdade:
// zera contadores e limpa a última atribuição, senão o desempate cairia no
// id (quem foi cadastrado antes) e o sorteio seria apenas simbólico.
async function aplicarSorteio(empId, idsNaOrdem) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < idsNaOrdem.length; i++) {
      await client.query(
        'UPDATE corretores SET ordem=$1, atribuicoes=0, ultima_atribuicao=NULL WHERE id=$2 AND empreendimento_id=$3',
        [i + 1, Number(idsNaOrdem[i]), empId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
  return listCorretores(empId);
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
                 ordem ASC,
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

// A fila na ordem em que a roleta vai escolher (sem consumir a vez).
async function filaCorretores(empId) {
  const { rows } = await query(
    `SELECT * FROM corretores
      WHERE empreendimento_id=$1 AND ativo=true
      ORDER BY (atribuicoes::numeric / GREATEST(peso,1)) ASC,
               COALESCE(ultima_atribuicao, '1970-01-01'::timestamptz) ASC,
               ordem ASC,
               id ASC`,
    [empId]
  );
  return rows;
}

// A recepção abre o WhatsApp do "próximo da vez" no clique (não dá para
// esperar o servidor sem o navegador bloquear a janela) e depois confirma
// aqui. A vez é gravada para esse corretor, com a mesma trava da roleta.
function atribuirCorretor(empId, corretorId) {
  return naFila('roleta:' + empId, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!usingMemory) await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [Number(empId)]);
      const { rows } = await client.query(
        `UPDATE corretores SET atribuicoes = atribuicoes + 1, leads_total = leads_total + 1,
                ultima_atribuicao = now()
          WHERE id=$1 AND empreendimento_id=$2 AND ativo=true RETURNING *`,
        [Number(corretorId), Number(empId)]
      );
      await client.query('COMMIT');
      return rows[0] || null;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  });
}

// ---- Log de cliques ----
async function registrarClique(d) {
  const { rows } = await query(
    `INSERT INTO cliques_whatsapp
       (empreendimento_id, corretor_id, origem, novo_lead, bot, motivo, visitante,
        ip_hash, user_agent, referer, utm_source, utm_medium, utm_campaign,
        resgate, corretor_anterior, corretor_fone, anterior_fone, lead_nome, lead_telefone, interesse, protocolo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
    [d.empreendimento_id, d.corretor_id || null, d.origem || null, !!d.novo_lead, !!d.bot,
     d.motivo || null, d.visitante || null, d.ip_hash || null,
     (d.user_agent || '').slice(0, 400), (d.referer || '').slice(0, 400),
     d.utm_source || null, d.utm_medium || null, d.utm_campaign || null,
     !!d.resgate, d.corretor_anterior || null,
     d.corretor_fone ? fone(d.corretor_fone) : null, d.anterior_fone ? fone(d.anterior_fone) : null,
     d.lead_nome ? String(d.lead_nome).slice(0, 120) : null, d.lead_telefone ? fone(d.lead_telefone) : null,
     d.interesse ? String(d.interesse).slice(0, 120) : null, d.protocolo || null]
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

// Último corretor que atendeu este telefone neste empreendimento (formulário da landing).
async function ultimaAtribuicaoTel(empId, telefone) {
  if (!telefone) return null;
  const { rows } = await query(
    `SELECT corretor_id, created_at FROM cliques_whatsapp
      WHERE empreendimento_id=$1 AND corretor_id IS NOT NULL AND bot=false AND lead_telefone=$2
      ORDER BY created_at DESC LIMIT 1`,
    [empId, fone(telefone)]
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

// Cargas que rodam uma vez só (tabela cargas_feitas): o que for removido
// ou desmarcado depois pelo painel não volta sozinho.
async function cargasUnicas() {
  // fn devolve false quando ainda não dá para rodar (tenta na próxima subida).
  async function umaVez(chave, fn) {
    const { rows } = await query('SELECT 1 FROM cargas_feitas WHERE chave=$1', [chave]);
    if (rows.length) return;
    if ((await fn()) === false) return;
    await query('INSERT INTO cargas_feitas (chave) VALUES ($1)', [chave]);
  }

  // Gerentes em destaque na recepção (leads de campanhas que vão direto a eles).
  await umaVez('gerentes-2026-10', async () => {
    for (const [nome, tel] of [['Alberto Ceballos', '51982163051'], ['Fabrício Bilhalva', '51980607447']]) {
      const { rows } = await query('SELECT id FROM agencia_corretores WHERE telefone=$1', [fone(tel)]);
      if (rows.length) await query('UPDATE agencia_corretores SET destaque=true, ativo=true WHERE id=$1', [rows[0].id]);
      else await query('INSERT INTO agencia_corretores (nome, telefone, ativo, destaque) VALUES ($1,$2,true,true)', [nome, fone(tel)]);
    }
  });

  // Acessos do Alberto e do Fabrício, com senha temporária (só o hash fica
  // aqui) que eles trocam no primeiro acesso, e as equipes de cada um.
  await umaVez('gestores-alberto-fabricio-2026-10', async () => {
    const contas = [
      { nome: 'Alberto Ceballos', usuario: 'alberto', hash: '0d91ff58323eb6a3aeebca1045d9284f:e796a7470c25a35da92f9f42a803f58efe9291b6e3e375bf27614332d693f93f', equipe: [
        ['Marilane', '51989089598'], ['Magali', '51995224014'], ['Roberta', '51982541587'],
        ['Nilda', '51985838439'], ['Fernando (Jardim do Lago)', '51994915337']] },
      { nome: 'Fabrício Bilhalva', usuario: 'fabricio', hash: 'ea3cbbe22034ee23c8be18a504f262c5:df18672b3508e3489392425a4f99a4a0e90a33d8248767c1278468696519896f', equipe: [
        ['Ketlin', '51985717877'], ['Fernando Riolfi', '51981792048'], ['Gisele Anschau', '51998598726'],
        ['Cristiane', '51995409682']] },
    ];
    for (const c of contas) {
      let g = await getGestorPorUsuario(c.usuario);
      if (!g) g = await createGestor({ nome: c.nome, usuario: c.usuario, senha_hash: c.hash, papel: 'gestor', trocar_senha: true });
      for (const [nome, tel] of c.equipe) {
        const { rows } = await query('SELECT 1 FROM equipe_corretores WHERE telefone=$1', [fone(tel)]);
        if (!rows.length) await query('INSERT INTO equipe_corretores (telefone, gestor_id, nome) VALUES ($1,$2,$3)', [fone(tel), g.id, nome]);
      }
    }
  });

  // Nova senha temporária para o Alberto e o Fabrício (a primeira não entrou
  // porque as contas já existiam). Só vale para quem ainda nunca entrou.
  await umaVez('senhas-alberto-fabricio-2026-10-22', async () => {
    for (const [usuario, hash] of [
      ['alberto', '901e5c9ea9e2eef90aa4bd53308a5c01:336f7db2b189455d842dd42cd9e000e1bb1999536b3f31e6304a0347b7296048'],
      ['fabricio', 'a7037a3f770d5c9e5be1b19719c4bae5:85659b1c1d19e404d7a473b30cb26a3713789d590cfb1f9dad5e43d7e5206036'],
    ]) {
      await query('UPDATE gestores SET senha_hash=$1, trocar_senha=true, ativo=true WHERE usuario=$2 AND ultimo_acesso IS NULL', [hash, usuario]);
    }
  });

  // Campanha do Nimbus: roleta com as equipes do Alberto e do Fabrício, que
  // também aparece na tela da recepção. Espera o empreendimento existir.
  await umaVez('campanha-nimbus-2026-10', async () => {
    const { rows: emp } = await query(
      `SELECT id FROM empreendimentos WHERE LOWER(slug) LIKE '%nimbus%' OR LOWER(nome) LIKE '%nimbus%' ORDER BY id LIMIT 1`
    );
    if (!emp.length) return false;
    const empId = emp[0].id;
    const ja = new Set((await listCorretores(empId)).map(c => fone(c.telefone)));
    for (const [nome, tel] of require('./campanha-nimbus')) {
      if (!ja.has(fone(tel))) await createCorretor(empId, { nome, telefone: fone(tel) });
    }
    await query('DELETE FROM recepcao_campanhas WHERE empreendimento_id=$1', [empId]);
    await query('INSERT INTO recepcao_campanhas (empreendimento_id) VALUES ($1)', [empId]);
  });

  // Portal: topo mais limpo e emocional (filme de família, só título e dois botões).
  await umaVez('portal-hero-familia-2026-10', async () => {
    const p = await getPortal();
    if (!p) return;   // nunca salvo: os padrões novos já valem
    delete p._salvo_em;
    await savePortal({ ...p, hero_titulo: 'Seu próximo lar começa aqui.', hero_sub: '', hero_cta: 'Ver lançamentos', hero_video: '' });
  });

  // Nimbus: filme completo (com som) tocando na própria página.
  await umaVez('nimbus-filme-completo-2026-10', async () => {
    const { rows: emp } = await query(
      `SELECT id FROM empreendimentos WHERE LOWER(slug) LIKE '%nimbus%' OR LOWER(nome) LIKE '%nimbus%' ORDER BY id LIMIT 1`
    );
    if (!emp.length) return false;
    await query(`UPDATE empreendimentos SET video_url=$1 WHERE id=$2 AND (video_url IS NULL OR video_url = '')`,
      ['/midia/nimbus/filme-completo.mp4', emp[0].id]);
  });

  // Nimbus: as 4 plantas com cômodos clicáveis (substitui a configuração anterior, que só tinha a de 2 dormitórios).
  await umaVez('nimbus-plantas-todas-v2-2026-10', async () => {
    const { rows: emp } = await query(
      `SELECT id FROM empreendimentos WHERE LOWER(slug) LIKE '%nimbus%' OR LOWER(nome) LIKE '%nimbus%' ORDER BY id LIMIT 1`
    );
    if (!emp.length) return false;
    await query('UPDATE empreendimentos SET planta_interativa=$1::jsonb WHERE id=$2',
      [JSON.stringify(require('./planta-nimbus').planta_interativa), emp[0].id]);
  });

  // Nimbus: filme na abertura e planta interativa no lugar do carrossel de plantas.
  await umaVez('nimbus-planta-filme-2026-10', async () => {
    const { rows: emp } = await query(
      `SELECT id, hero_video, planta_interativa FROM empreendimentos WHERE LOWER(slug) LIKE '%nimbus%' OR LOWER(nome) LIKE '%nimbus%' ORDER BY id LIMIT 1`
    );
    if (!emp.length) return false;
    const n = require('./planta-nimbus');
    await query(
      `UPDATE empreendimentos SET hero_video = CASE WHEN hero_video IS NULL OR hero_video = '' THEN $1 ELSE hero_video END,
         planta_interativa = COALESCE(planta_interativa, $2::jsonb) WHERE id=$3`,
      [n.hero_video, JSON.stringify(n.planta_interativa), emp[0].id]
    );
  });
}

// ---- Gestores ----
async function listGestores() {
  const { rows } = await query('SELECT * FROM gestores ORDER BY nome ASC, id ASC');
  return rows;
}

async function getGestor(id) {
  const { rows } = await query('SELECT * FROM gestores WHERE id=$1', [Number(id) || 0]);
  return rows[0];
}

async function getGestorPorUsuario(usuario) {
  const { rows } = await query('SELECT * FROM gestores WHERE usuario=$1', [String(usuario || '').trim().toLowerCase()]);
  return rows[0];
}

// Perfis de acesso da equipe: gestor (painel da equipe), recepção e SDR.
const PAPEIS = ['gestor', 'recepcao', 'sdr'];

async function createGestor(d) {
  const { rows } = await query(
    'INSERT INTO gestores (nome, usuario, senha_hash, papel, ativo, trocar_senha) VALUES ($1,$2,$3,$4,true,$5) RETURNING *',
    [d.nome, d.usuario, d.senha_hash, PAPEIS.includes(d.papel) ? d.papel : 'gestor', !!d.trocar_senha]
  );
  return rows[0];
}

// senha_hash só muda quando vem preenchido (editar sem trocar a senha).
async function updateGestor(id, d) {
  const atual = await getGestor(id);
  if (!atual) return null;
  const { rows } = await query(
    'UPDATE gestores SET nome=$1, usuario=$2, senha_hash=$3, ativo=$4, papel=$5, trocar_senha=$6 WHERE id=$7 RETURNING *',
    [d.nome ?? atual.nome, d.usuario ?? atual.usuario, d.senha_hash || atual.senha_hash,
     d.ativo === undefined ? atual.ativo : !!d.ativo,
     d.papel ? (PAPEIS.includes(d.papel) ? d.papel : 'gestor') : (atual.papel || 'gestor'),
     d.trocar_senha === undefined ? !!atual.trocar_senha : !!d.trocar_senha, atual.id]
  );
  return rows[0];
}

async function removeGestor(id) {
  await query('DELETE FROM equipe_corretores WHERE gestor_id=$1', [Number(id)]);
  await query('DELETE FROM gestores WHERE id=$1', [Number(id)]);
}

async function marcarAcessoGestor(id) {
  await query('UPDATE gestores SET ultimo_acesso=now() WHERE id=$1', [Number(id)]);
}

// ---- Equipes ----
async function listEquipe(gestorId) {
  const { rows } = await query(
    'SELECT * FROM equipe_corretores WHERE gestor_id=$1 ORDER BY nome ASC', [Number(gestorId)]
  );
  return rows;
}

async function listEquipes() {
  const { rows } = await query('SELECT * FROM equipe_corretores');
  return rows;
}

// Grava a equipe de cada telefone de uma vez: { fone: { gestor_id, nome } }.
// gestor_id vazio tira o corretor de qualquer equipe.
async function salvarEquipes(mapa) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [tel, v] of Object.entries(mapa)) {
      const f = fone(tel);
      if (!f) continue;
      await client.query('DELETE FROM equipe_corretores WHERE telefone=$1', [f]);
      if (v.gestor_id) {
        await client.query(
          'INSERT INTO equipe_corretores (telefone, gestor_id, nome) VALUES ($1,$2,$3)',
          [f, Number(v.gestor_id), v.nome || null]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}

// Todos os corretores cadastrados, agrupados por WhatsApp: a mesma pessoa
// aparece uma vez, com os empreendimentos em que está na roleta.
async function corretoresUnicos() {
  const { rows } = await query(
    'SELECT id, empreendimento_id, nome, telefone, ativo FROM corretores ORDER BY nome ASC, id ASC'
  );
  const mapa = new Map();
  for (const c of rows) {
    const f = fone(c.telefone);
    if (!mapa.has(f)) mapa.set(f, { telefone: f, nomes: [], emps: [], ativo: false });
    const u = mapa.get(f);
    if (!u.nomes.includes(c.nome)) u.nomes.push(c.nome);
    if (!u.emps.includes(c.empreendimento_id)) u.emps.push(c.empreendimento_id);
    if (c.ativo) u.ativo = true;
  }
  return [...mapa.values()];
}

// Cliques por telefone e empreendimento no período [desde, ate).
async function cliquesPorFone(desde, ate) {
  const { rows } = await query(
    `SELECT corretor_fone AS fone, empreendimento_id,
            COALESCE(SUM(CASE WHEN novo_lead THEN 1 ELSE 0 END),0)::int AS leads,
            COALESCE(SUM(CASE WHEN resgate THEN 1 ELSE 0 END),0)::int AS resgatados,
            COUNT(*)::int AS cliques,
            MAX(created_at) AS ultimo
       FROM cliques_whatsapp
      WHERE bot=false AND corretor_fone IS NOT NULL AND created_at >= $1 AND created_at < $2
      GROUP BY corretor_fone, empreendimento_id`,
    [desde, ate]
  );
  return rows;
}

async function naoRetornadosPorFone(desde, ate) {
  const { rows } = await query(
    `SELECT anterior_fone AS fone, COUNT(*)::int AS n
       FROM cliques_whatsapp
      WHERE resgate=true AND anterior_fone IS NOT NULL AND created_at >= $1 AND created_at < $2
      GROUP BY anterior_fone`,
    [desde, ate]
  );
  const mapa = {};
  for (const r of rows) mapa[r.fone] = r.n;
  return mapa;
}

// Leads (não repetições) que caíram para os telefones da lista, no período.
async function leadsDaEquipe(fones, desde, ate, limite = 300) {
  if (!fones.length) return [];
  const ph = fones.map((_, i) => '$' + (i + 3)).join(',');
  const { rows } = await query(
    `SELECT created_at, corretor_fone, empreendimento_id, origem, resgate,
            utm_source, utm_medium, utm_campaign, lead_nome, lead_telefone, interesse, protocolo
       FROM cliques_whatsapp
      WHERE bot=false AND (novo_lead=true OR resgate=true)
        AND created_at >= $1 AND created_at < $2
        AND corretor_fone IN (${ph})
      ORDER BY created_at DESC
      LIMIT ${Number(limite) || 300}`,
    [desde, ate, ...fones]
  );
  return rows;
}

// ---- Recepção: corretores da agência e encaminhamentos ----
async function listAgencia({ ativosOnly = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM agencia_corretores ${ativosOnly ? 'WHERE ativo=true' : ''} ORDER BY destaque DESC, nome ASC, id ASC`
  );
  return rows;
}

async function getAgencia(id) {
  const { rows } = await query('SELECT * FROM agencia_corretores WHERE id=$1', [Number(id) || 0]);
  return rows[0];
}

async function getAgenciaPorFone(tel) {
  const { rows } = await query('SELECT * FROM agencia_corretores WHERE telefone=$1', [fone(tel)]);
  return rows[0];
}

async function salvarAgencia(id, d) {
  if (id) {
    const { rows } = await query(
      'UPDATE agencia_corretores SET nome=$1, telefone=$2, ativo=$3, destaque=$4 WHERE id=$5 RETURNING *',
      [d.nome, fone(d.telefone), d.ativo !== false, !!d.destaque, Number(id)]
    );
    return rows[0];
  }
  const { rows } = await query(
    'INSERT INTO agencia_corretores (nome, telefone, ativo, destaque) VALUES ($1,$2,$3,$4) RETURNING *',
    [d.nome, fone(d.telefone), d.ativo !== false, !!d.destaque]
  );
  return rows[0];
}

async function removeAgencia(id) {
  await query('DELETE FROM agencia_corretores WHERE id=$1', [Number(id)]);
}

const corta = (v, n) => (v ? String(v).trim().slice(0, n) || null : null);

async function registrarEncaminhamento(d) {
  const { rows } = await query(
    `INSERT INTO encaminhamentos (usuario_id, corretor_fone, corretor_nome, canal,
        lead_nome, lead_telefone, lead_email, negocio, imovel, origem, mensagem, empreendimento_id,
        entrada_id, token, fonte)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [d.usuario_id || null, fone(d.corretor_fone), d.corretor_nome || null, d.canal || null,
     corta(d.lead_nome, 120), d.lead_telefone ? fone(d.lead_telefone) : null, corta(d.lead_email, 160),
     corta(d.negocio, 40), corta(d.imovel, 60), corta(d.origem, 60), corta(d.mensagem, 1500),
     d.empreendimento_id == null ? null : Number(d.empreendimento_id),
     d.entrada_id ? Number(d.entrada_id) : null,
     /^[A-Za-z0-9_-]{16,64}$/.test(String(d.token || '')) ? String(d.token) : null,
     d.fonte === 'sdr' ? 'sdr' : null]
  );
  return rows[0];
}

// Último envio para este cliente: a recepção vê se ele já foi de alguém.
async function ultimoEnvioDoLead(tel) {
  const f = fone(tel);
  if (!f) return null;
  const { rows } = await query(
    'SELECT corretor_nome, corretor_fone, created_at FROM encaminhamentos WHERE lead_telefone=$1 ORDER BY created_at DESC LIMIT 1',
    [f]
  );
  return rows[0] || null;
}

// Leads encaminhados no período; fones = só para estes corretores (equipe).
async function leadsRecepcao(desde, ate, fones = null, limite = 300) {
  if (fones && !fones.length) return [];
  const ph = fones ? fones.map((_, i) => '$' + (i + 3)).join(',') : '';
  const { rows } = await query(
    `SELECT * FROM encaminhamentos
      WHERE created_at >= $1 AND created_at < $2 ${fones ? `AND corretor_fone IN (${ph})` : ''}
      ORDER BY created_at DESC LIMIT ${Number(limite) || 300}`,
    [desde, ate, ...(fones || [])]
  );
  return rows;
}

async function encaminhamentosRecentes(usuarioId, limite = 30) {
  const { rows } = await query(
    `SELECT * FROM encaminhamentos ${usuarioId ? 'WHERE usuario_id=$1' : ''}
      ORDER BY created_at DESC LIMIT ${Number(limite) || 30}`,
    usuarioId ? [Number(usuarioId)] : []
  );
  return rows;
}

// Envios por telefone e canal no período [desde, ate).
async function encaminhamentosPorFone(desde, ate) {
  const { rows } = await query(
    `SELECT corretor_fone AS fone, canal, COUNT(*)::int AS n, MAX(created_at) AS ultimo
       FROM encaminhamentos
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY corretor_fone, canal`,
    [desde, ate]
  );
  return rows;
}

// ---- Campanhas da recepção ----
async function listCampanhasRecepcao() {
  const { rows } = await query(
    `SELECT e.id, e.nome, e.slug FROM recepcao_campanhas rc
       JOIN empreendimentos e ON e.id = rc.empreendimento_id
      ORDER BY e.nome ASC`
  );
  return rows;
}

async function addCampanhaRecepcao(empId) {
  await query('DELETE FROM recepcao_campanhas WHERE empreendimento_id=$1', [Number(empId)]);
  await query('INSERT INTO recepcao_campanhas (empreendimento_id) VALUES ($1)', [Number(empId)]);
}

async function removeCampanhaRecepcao(empId) {
  await query('DELETE FROM recepcao_campanhas WHERE empreendimento_id=$1', [Number(empId)]);
}

async function enviosDaCampanha(empId, limite = 50) {
  const { rows } = await query(
    `SELECT * FROM encaminhamentos WHERE empreendimento_id=$1 ORDER BY created_at DESC LIMIT ${Number(limite) || 50}`,
    [Number(empId)]
  );
  return rows;
}

// ---- Confirmação do corretor (link "Recebi" na mensagem) ----
async function envioPorToken(token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token || ''))) return null;
  const { rows } = await query('SELECT * FROM encaminhamentos WHERE token=$1', [String(token)]);
  return rows[0] || null;
}

async function confirmarEnvio(id) {
  const { rows } = await query(
    'UPDATE encaminhamentos SET confirmado_em = COALESCE(confirmado_em, now()) WHERE id=$1 RETURNING *',
    [Number(id)]
  );
  return rows[0] || null;
}

// Envios da recepção que o corretor ainda não confirmou (com link "Recebi"),
// há mais de `minutos` e dentro das últimas `horas`. Os já reencaminhados saem,
// e os do SDR também (ele cobra os dele na própria tela).
async function enviosSemConfirmacao(minutos = 30, horas = 48) {
  const { rows } = await query(
    `SELECT * FROM encaminhamentos
      WHERE token IS NOT NULL AND confirmado_em IS NULL AND substituido_por IS NULL
        AND (fonte IS NULL OR fonte <> 'sdr')
        AND created_at < $1 AND created_at > $2
      ORDER BY created_at ASC LIMIT 100`,
    [new Date(Date.now() - minutos * 60000), new Date(Date.now() - horas * 3600000)]
  );
  return rows;
}

async function getEncaminhamento(id) {
  const { rows } = await query('SELECT * FROM encaminhamentos WHERE id=$1', [Number(id) || 0]);
  return rows[0] || null;
}

async function registrarCobranca(id) {
  const { rows } = await query(
    `UPDATE encaminhamentos SET cobrancas = COALESCE(cobrancas,0) + 1, ultima_cobranca = now()
      WHERE id=$1 RETURNING *`, [Number(id)]
  );
  return rows[0] || null;
}

// Retorno do corretor (pelo mesmo link do "Recebi"): pode ser atualizado
// conforme o atendimento anda (visita → proposta → fechou).
async function registrarRetorno(id, retorno, obs) {
  const { rows } = await query(
    `UPDATE encaminhamentos SET retorno=$1, retorno_obs=$2, retorno_em=now() WHERE id=$3 RETURNING *`,
    [retorno, corta(obs, 500), Number(id)]
  );
  return rows[0] || null;
}

async function registrarPedidoRetorno(id) {
  const { rows } = await query(
    `UPDATE encaminhamentos SET retorno_pedidos = COALESCE(retorno_pedidos,0) + 1, retorno_pedido_em = now()
      WHERE id=$1 RETURNING *`, [Number(id)]
  );
  return rows[0] || null;
}

// O envio antigo fica no histórico (sem confirmação), apontando para o novo.
async function substituirEnvio(antigoId, novoId) {
  await query('UPDATE encaminhamentos SET substituido_por=$1 WHERE id=$2 AND substituido_por IS NULL', [Number(novoId), Number(antigoId)]);
}

// ---- Leads que entram sozinhos (fila "A encaminhar") ----
async function criarEntrada(d) {
  try {
    const { rows } = await query(
      `INSERT INTO leads_entrada (fonte, message_id, remetente, assunto, recebido_em, bruto, dados)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.fonte || null, d.message_id || null, corta(d.remetente, 200), corta(d.assunto, 300),
       d.recebido_em ? new Date(d.recebido_em) : new Date(), corta(d.bruto, 20000), JSON.stringify(d.dados || {})]
    );
    return rows[0];
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return null;   // já importado
    throw e;
  }
}

async function entradaExiste(messageId) {
  const { rows } = await query('SELECT 1 FROM leads_entrada WHERE message_id=$1', [String(messageId)]);
  return rows.length > 0;
}

function lerDados(r) {
  if (!r) return r;
  if (typeof r.dados === 'string') { try { r.dados = JSON.parse(r.dados); } catch (e) { r.dados = {}; } }
  r.dados = r.dados || {};
  return r;
}

async function listEntradas(status = 'pendente', limite = 100) {
  const { rows } = await query(
    `SELECT * FROM leads_entrada WHERE status=$1 ORDER BY COALESCE(recebido_em, created_at) ASC LIMIT ${Number(limite) || 100}`,
    [status]
  );
  return rows.map(lerDados);
}

async function getEntrada(id) {
  const { rows } = await query('SELECT * FROM leads_entrada WHERE id=$1', [Number(id) || 0]);
  return lerDados(rows[0]);
}

async function tratarEntrada(id, d) {
  const { rows } = await query(
    `UPDATE leads_entrada SET status=$1, encaminhamento_id=$2, tratado_em=now(), tratado_por=$3, motivo=$4
      WHERE id=$5 AND status='pendente' RETURNING *`,
    [d.status, d.encaminhamento_id || null, d.tratado_por || null, corta(d.motivo, 200), Number(id)]
  );
  return lerDados(rows[0]);
}

// Leads que chegaram por e-mail no período (pela hora de chegada).
async function entradasPeriodo(desde, ate) {
  const { rows } = await query(
    `SELECT * FROM leads_entrada WHERE COALESCE(recebido_em, created_at) >= $1 AND COALESCE(recebido_em, created_at) < $2
      ORDER BY COALESCE(recebido_em, created_at) ASC`,
    [desde, ate]
  );
  return rows.map(lerDados);
}

// Formulários das landings preenchidos no período (leads do site com nome e telefone).
async function formulariosLpPeriodo(desde, ate) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM cliques_whatsapp
      WHERE bot=false AND lead_telefone IS NOT NULL AND novo_lead=true AND created_at >= $1 AND created_at < $2`,
    [desde, ate]
  );
  return rows[0] ? rows[0].n : 0;
}

async function ultimaEntrada() {
  const { rows } = await query('SELECT MAX(created_at) AS ultima FROM leads_entrada');
  return rows[0] ? rows[0].ultima : null;
}

async function contarEntradasPendentes() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM leads_entrada WHERE status='pendente'`);
  return rows[0] ? rows[0].n : 0;
}

// ---- Linha do tempo (auditoria) ----
// Nunca derruba quem chamou: auditoria que falha vai para o log, o lead segue.
async function registrarEvento(d) {
  try {
    const { rows } = await query(
      `INSERT INTO lead_eventos (tipo, lead_nome, lead_telefone, entrada_id, encaminhamento_id, clique_id,
         empreendimento_id, corretor_nome, corretor_fone, usuario_id, detalhe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [d.tipo, corta(d.lead_nome, 120), d.lead_telefone ? fone(d.lead_telefone) : null,
       d.entrada_id || null, d.encaminhamento_id || null, d.clique_id || null,
       d.empreendimento_id == null ? null : Number(d.empreendimento_id),
       corta(d.corretor_nome, 120), d.corretor_fone ? fone(d.corretor_fone) : null,
       d.usuario_id || null, corta(d.detalhe, 500)]
    );
    return rows[0];
  } catch (e) {
    console.error('[auditoria] evento não gravado:', d.tipo, e.message);
    return null;
  }
}

// Eventos de um lead: pelo telefone, pela entrada da fila ou pelo envio.
async function eventosDoLead({ telefone, entrada_id, encaminhamento_id }) {
  const conds = [], vals = [];
  if (telefone) { vals.push(fone(telefone)); conds.push(`lead_telefone=$${vals.length}`); }
  if (entrada_id) { vals.push(Number(entrada_id)); conds.push(`entrada_id=$${vals.length}`); }
  if (encaminhamento_id) { vals.push(Number(encaminhamento_id)); conds.push(`encaminhamento_id=$${vals.length}`); }
  if (!conds.length) return [];
  const { rows } = await query(
    `SELECT * FROM lead_eventos WHERE ${conds.join(' OR ')} ORDER BY created_at ASC, id ASC LIMIT 500`, vals
  );
  return rows;
}

// Busca para a tela de auditoria: telefone (com ou sem máscara) ou nome.
async function buscarLeadsAuditoria(termo, limite = 50) {
  const t = String(termo || '').trim();
  const dig = t.replace(/\D/g, '');
  let rows;
  // Só números (com ou sem máscara): busca por telefone, a partir de 4 dígitos.
  if (dig.length >= 4 && /^[\d\s()+.-]+$/.test(t)) {
    ({ rows } = await query(
      `SELECT lead_telefone, MAX(lead_nome) AS lead_nome, COUNT(*)::int AS eventos, MIN(created_at) AS primeiro, MAX(created_at) AS ultimo
         FROM lead_eventos WHERE lead_telefone LIKE $1 GROUP BY lead_telefone ORDER BY ultimo DESC LIMIT ${Number(limite) || 50}`,
      ['%' + (dig.length > 9 ? dig.slice(-9) : dig) + '%']
    ));
  } else if (t) {
    ({ rows } = await query(
      `SELECT lead_telefone, MAX(lead_nome) AS lead_nome, COUNT(*)::int AS eventos, MIN(created_at) AS primeiro, MAX(created_at) AS ultimo
         FROM lead_eventos WHERE LOWER(lead_nome) LIKE $1 AND lead_telefone IS NOT NULL
        GROUP BY lead_telefone ORDER BY ultimo DESC LIMIT ${Number(limite) || 50}`,
      ['%' + t.toLowerCase() + '%']
    ));
  } else {
    ({ rows } = await query(
      `SELECT lead_telefone, MAX(lead_nome) AS lead_nome, COUNT(*)::int AS eventos, MIN(created_at) AS primeiro, MAX(created_at) AS ultimo
         FROM lead_eventos WHERE lead_telefone IS NOT NULL
        GROUP BY lead_telefone ORDER BY ultimo DESC LIMIT ${Number(limite) || 50}`
    ));
  }
  return rows;
}

// ---- LGPD: dados pessoais de leads antigos são apagados ----
// Fica a contagem (relatórios, quem recebeu, quando); somem nome, telefone,
// e-mail e mensagem do cliente. Padrão: 12 meses (LGPD_MESES).
async function anonimizarAntigos(meses) {
  const m = Number(meses) || 12;
  const corte = new Date(Date.now() - m * 30.44 * 864e5);
  const r = {};
  r.envios = (await query(
    `UPDATE encaminhamentos SET lead_nome=NULL, lead_telefone=NULL, lead_email=NULL, mensagem=NULL
      WHERE created_at < $1 AND (lead_nome IS NOT NULL OR lead_telefone IS NOT NULL OR lead_email IS NOT NULL OR mensagem IS NOT NULL)`, [corte])).rowCount || 0;
  r.fila = (await query(
    `UPDATE leads_entrada SET bruto=NULL, dados='{}', assunto=NULL
      WHERE created_at < $1 AND (bruto IS NOT NULL OR assunto IS NOT NULL)`, [corte])).rowCount || 0;
  r.cliques = (await query(
    `UPDATE cliques_whatsapp SET lead_nome=NULL, lead_telefone=NULL
      WHERE created_at < $1 AND (lead_nome IS NOT NULL OR lead_telefone IS NOT NULL)`, [corte])).rowCount || 0;
  r.eventos = (await query(
    `UPDATE lead_eventos SET lead_nome=NULL, lead_telefone=NULL
      WHERE created_at < $1 AND (lead_nome IS NOT NULL OR lead_telefone IS NOT NULL)`, [corte])).rowCount || 0;
  // SDR: contatos sem ligação há mais que o prazo perdem os dados pessoais.
  // Quem pediu para não ligar mantém o telefone (senão voltaria numa nova importação).
  try {
    r.sdr = (await query(
      `UPDATE sdr_contatos SET nome=NULL, busca=NULL, email=NULL, info='{}', telefone2=NULL,
              telefone = CASE WHEN status='nao_ligar' THEN telefone ELSE NULL END
        WHERE ultima_ligacao < $1 AND (nome IS NOT NULL OR telefone2 IS NOT NULL OR (telefone IS NOT NULL AND status <> 'nao_ligar'))`, [corte])).rowCount || 0;
    await query(`UPDATE sdr_ligacoes SET ficha = NULL WHERE created_at < $1 AND ficha IS NOT NULL`, [corte]);
  } catch (e) { /* tabelas do SDR ainda não criadas */ }
  return r;
}

// ---- Configurações (chave/valor) ----
async function getConfig(chave) {
  const { rows } = await query('SELECT valor FROM config_kv WHERE chave=$1', [chave]);
  return rows[0] ? rows[0].valor : null;
}

async function setConfig(chave, valor) {
  await query('DELETE FROM config_kv WHERE chave=$1', [chave]);
  if (valor != null) await query('INSERT INTO config_kv (chave, valor) VALUES ($1,$2)', [chave, String(valor)]);
}

module.exports = {
  pool, query, migrate, create, update, list, getBySlug, getById, setPois, normalizarDominio, remove, slugExists, usingMemory,
  getPortal, savePortal, herdarDominioDaHome,
  // roleta de corretores
  listCorretores, getCorretor, createCorretor, updateCorretor, removeCorretor, zerarContadores,
  proximoCorretor, registrarClique, ultimaAtribuicao, ultimaAtribuicaoTel, aplicarSorteio,
  statsCorretores, naoRetornados, cliquesRecentes, resumoCliques,
  // equipes e gestores
  listGestores, getGestor, getGestorPorUsuario, createGestor, updateGestor, removeGestor, marcarAcessoGestor,
  listEquipe, listEquipes, salvarEquipes, corretoresUnicos,
  cliquesPorFone, naoRetornadosPorFone, leadsDaEquipe,
  // recepção
  listAgencia, getAgencia, getAgenciaPorFone, salvarAgencia, removeAgencia,
  registrarEncaminhamento, encaminhamentosRecentes, encaminhamentosPorFone, ultimoEnvioDoLead, leadsRecepcao,
  filaCorretores, atribuirCorretor,
  listCampanhasRecepcao, addCampanhaRecepcao, removeCampanhaRecepcao, enviosDaCampanha, cargasUnicas,
  envioPorToken, confirmarEnvio, enviosSemConfirmacao, getEncaminhamento, registrarCobranca, substituirEnvio,
  registrarRetorno, registrarPedidoRetorno,
  criarEntrada, entradaExiste, listEntradas, getEntrada, tratarEntrada, contarEntradasPendentes,
  entradasPeriodo, formulariosLpPeriodo, ultimaEntrada,
  getConfig, setConfig,
  registrarEvento, eventosDoLead, buscarLeadsAuditoria, anonimizarAntigos,
};
