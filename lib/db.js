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
];
const JSON_COLS = new Set(['gallery', 'infra', 'plantas', 'diferenciais', 'timeline', 'faq', 'pois', 'construtora_stats']);

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
      published BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Migração incremental para bancos já existentes
  await query(`ALTER TABLE empreendimentos ADD COLUMN IF NOT EXISTS cor_accent TEXT DEFAULT '#F47B20';`);

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

module.exports = {
  pool, query, migrate, create, update, list, getBySlug, getById, remove, slugExists, usingMemory,
};
