// Conteúdo institucional do portal (página principal).
// Tudo aqui é editável em /admin/portal. Os valores padrão abaixo só existem
// para o site não nascer vazio: são exemplos e precisam ser revisados antes
// de anunciar (o painel avisa enquanto a configuração nunca foi salva).

const db = require('./db');
const { asArray } = require('./helpers');

const PADRAO = {
  // Topo
  hero_kicker: 'Lançamentos Auxiliadora Predial',
  hero_titulo: 'Os melhores lançamentos, com quem entende do seu próximo endereço',
  hero_sub: 'Empreendimentos selecionados e atendimento consultivo do primeiro contato à entrega das chaves.',
  hero_imagem: '/img/portal/escritorio.jpg',
  hero_cta: 'Ver empreendimentos',

  // Números (aceita {{empreendimentos}} e {{cidades}}, contados automaticamente)
  numeros: [
    { num: '90+', label: 'anos de mercado' },
    { num: '{{empreendimentos}}', label: 'lançamentos à venda' },
    { num: '{{cidades}}', label: 'cidades atendidas' },
    { num: '100%', label: 'atendimento consultivo' },
  ],

  // Persona: o "rosto" que fala com o visitante
  persona_nome: 'Equipe de Lançamentos',
  persona_cargo: 'Consultoria Auxiliadora Predial',
  persona_foto: '/img/portal/equipe.jpg',
  persona_titulo: 'A gente faz a curadoria. Você escolhe com segurança.',
  persona_texto: 'Visitamos cada obra, conhecemos cada planta e analisamos cada contrato antes de apresentar um empreendimento. Assim, você compara as melhores opções com quem está do seu lado da mesa, e não do lado da venda.',
  persona_bullets: [
    { texto: 'Comparação honesta entre empreendimentos' },
    { texto: 'Simulação de financiamento e condições direto com a construtora' },
    { texto: 'Análise documental e segurança jurídica' },
    { texto: 'Acompanhamento até a entrega das chaves' },
  ],

  // Serviços / como ajudamos
  servicos_titulo: 'Como podemos ajudar',
  servicos: [
    { titulo: 'Curadoria de lançamentos', texto: 'Só apresentamos empreendimentos que passaram pela nossa análise de localização, construtora e projeto.' },
    { titulo: 'Simulação de condições', texto: 'Entrada, parcelas durante a obra e financiamento simulados para o seu perfil, sem compromisso.' },
    { titulo: 'Visita ao decorado', texto: 'Agendamos a visita ao decorado ou ao terreno no melhor horário para você.' },
    { titulo: 'Segurança jurídica', texto: 'Contrato, registro de incorporação e documentação revisados antes da assinatura.' },
    { titulo: 'Comparação lado a lado', texto: 'Plantas, localização e condições de vários empreendimentos comparadas com honestidade, para você decidir com clareza.' },
    { titulo: 'Atendimento pelo WhatsApp', texto: 'Tire dúvidas, receba materiais e combine visitas com o consultor sem sair de casa.' },
    { titulo: 'Acompanhamento até as chaves', texto: 'Seguimos com você depois da compra, durante a obra e até a entrega do apartamento.' },
  ],

  // Depoimentos: avaliações reais de 5 estrelas do perfil da Auxiliadora
  // Predial - Canoas Jardim do Lago no Google, texto original (mesma unidade
  // da nota e do link). Nunca publicar depoimento inventado.
  google_nota: '4,3',
  google_link: 'https://share.google/k7Bo5rLlbKu1Q2Bsr',
  google_unidade: 'Canoas Jardim do Lago',
  depoimentos: [
    {nome: "Maria Carolina J.", detalhe: "Google · Canoas Jardim do Lago", estrelas: "5", texto: "Excelente atendimento da Imobiliária e em especial a corretora Roberta Hoffmann que me ajudou a encontrar um apartamento para alugar em Canoas e foi muito atenciosa do início ao fim. Sempre prestativa, tirou todas as minhas dúvidas e tornou todo o processo bem tranquilo. Recomendo!"},
    {nome: "Gabriela P.", detalhe: "Google · Canoas Jardim do Lago", estrelas: "5", texto: "Tive uma experiência excelente com a Imobiliária Auxiliadora Predial - Canoas Jardim do Lago! A consultora Elisangela foi extremamente atenciosa, profissional e muito querida durante todo o processo. Sempre disponível para esclarecer dúvidas, demonstrou conhecimento, transparência e muita dedicação. Me senti segura e bem orientada em cada etapa. Recomendo fortemente o trabalho dela para quem busca um atendimento humano e eficiente!"},
    {nome: "Daniel B.", detalhe: "Google · Canoas Jardim do Lago", estrelas: "5", texto: "Procurei auxiliadora predial para locação de um apartamento para moradia, fui atendido pela colaboradora Tamires onde desde a visitação do imóvel até a assinatura do contrato foi super atenciosa e prestativa a todas as minhas dúvidas, além de ser muito ágil para entrega das chaves tbm. E tem me ajudado bastante no pós locação tbm. Indico muito o atendimento"},
    {nome: "Jether T.", detalhe: "Google · Canoas Jardim do Lago", estrelas: "5", texto: "Tive uma excelente experiência com a imobiliária! A Roberta Hoffman me atendeu com muita simpatia, educação, presteza e gentileza. Tirou todas as dúvidas, auxiliou em tudo o que foi preciso"},
    {nome: "Joao", detalhe: "Google · Canoas Jardim do Lago", estrelas: "5", texto: "A Roberta é uma consultora dedicada e eficaz. Tratou de uma triangulação difícil a respeito de um vazamento de água em apartamentos vizinhos durante o período de locação com bastante desenvoltura. Agradeço e indico."},
    {nome: "Joice C.", detalhe: "Google · Canoas Jardim do Lago", estrelas: "5", texto: "Adorei! A Maria Eduarda foi super querida e educada! Me ajudou a achar a sala comercial que eu tanto sonhava para o meu consultório! 💕"},
  ],

  // Contato
  contato_titulo: 'Vamos conversar?',
  contato_texto: 'Conte o que você procura e um consultor responde pelo WhatsApp com as opções que fazem sentido para você.',
  whatsapp: '',
  instagram: '',
  email: '',
  endereco: '',
  creci: '',

  // SEO
  seo_titulo: 'Lançamentos de Apartamentos | Auxiliadora Predial',
  meta_description: 'Conheça os lançamentos de apartamentos selecionados pela Auxiliadora Predial. Compare plantas, localização e condições e fale com um consultor.',

  // Medição
  ga_id: '',
  pixel_id: '',
  ads_conversao: '',

  // Cores
  cor_principal: '#0E9E4A',
  cor_accent: '#F47B20',
};

const LISTAS = ['numeros', 'persona_bullets', 'servicos', 'depoimentos'];

async function carregar() {
  const salvo = await db.getPortal();
  const cfg = { ...PADRAO, ...(salvo || {}) };
  for (const k of LISTAS) cfg[k] = asArray(cfg[k]);
  // Foto em branco volta para a foto padrão da equipe (o quadro sem foto,
  // só com iniciais, ficava vazio demais).
  if (!cfg.persona_foto) cfg.persona_foto = PADRAO.persona_foto;
  if (!cfg.hero_imagem) cfg.hero_imagem = PADRAO.hero_imagem;
  cfg._exemplo = !salvo;   // nunca salvo = conteúdo de exemplo no ar
  return cfg;
}

// Só aceita as chaves conhecidas: o formulário não consegue gravar lixo no jsonb.
function limpar(body) {
  const out = {};
  for (const k of Object.keys(PADRAO)) {
    if (LISTAS.includes(k)) {
      let v = body[k];
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } }
      out[k] = Array.isArray(v) ? v : [];
    } else {
      out[k] = String(body[k] == null ? '' : body[k]).trim();
    }
  }
  return out;
}

// Troca {{empreendimentos}} e {{cidades}} pelos números reais da vitrine.
function resolverNumeros(numeros, emps) {
  const cidades = new Set(emps.map(e => (e.cidade || '').trim().toLowerCase()).filter(Boolean)).size;
  return numeros
    .map(n => ({
      ...n,
      num: String(n.num || '')
        .replace(/\{\{\s*empreendimentos\s*\}\}/gi, String(emps.length))
        .replace(/\{\{\s*cidades\s*\}\}/gi, String(cidades)),
    }))
    // número zerado (ex.: nenhuma cidade ainda) não vai para o site
    .filter(n => n.num && n.num !== '0' && n.label);
}

module.exports = { PADRAO, LISTAS, carregar, limpar, resolverNumeros };
