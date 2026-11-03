// Gama 879 (Astorga, Rio Branco, Porto Alegre): cadastro feito com o material oficial do Drive da
// incorporadora (book R05, tabela de novembro/2026, imagens 3D, decorado e filmes). Carregado uma vez (lib/db.js).
// Planta interativa por unidade: cada retângulo é uma unidade da planta oficial, com metragem, frente e se
// está disponível. Sem valor por unidade na página (só o "a partir de"); a tabela muda todo mês.

const P = 1920 / 2280;   // as plantas oficiais têm 2280 px de largura; as do site, 1920
const r = (x1, y1, x2, y2) => [x1, y1, x2, y2].map((v) => Math.round(v * P));

// Situação pela tabela de novembro/2026 (204, 302 e 303 vendidos; 304 é o decorado e está à venda).
const UN = {
  201: ['Studio', 41.28, 'Frente Rua Liberdade', false, null, 'disponivel'],
  202: ['Studio', 47.54, 'Frente Rua Liberdade', true, null, 'disponivel'],
  203: ['Studio', 41.73, 'Frente Rua Vasco da Gama', false, null, 'disponivel'],
  204: ['Studio', 45.97, 'Frente Rua Vasco da Gama', true, null, 'vendido'],
  301: ['Studio', 41.28, 'Frente Rua Liberdade', false, null, 'disponivel'],
  302: ['Studio', 47.54, 'Frente Rua Liberdade', true, null, 'vendido'],
  303: ['Studio', 41.73, 'Frente Rua Vasco da Gama', false, null, 'vendido'],
  304: ['Studio', 45.97, 'Frente Rua Vasco da Gama', true, null, 'decorado'],
  401: ['Duplex 2 suítes', 77.71, 'Frente Rua Liberdade', true, 2, 'disponivel'],
  402: ['Duplex 1 suíte', 72.94, 'Frente Rua Liberdade', true, 1, 'disponivel'],
  403: ['Duplex 1 suíte', 66.59, 'Frente Rua Vasco da Gama', true, 1, 'disponivel'],
  404: ['Duplex 2 suítes', 83.25, 'Frente Rua Vasco da Gama', true, 2, 'disponivel'],
};
const SIT = { disponivel: 'Disponível', vendido: 'Vendido', decorado: 'Disponível · é o decorado' };

function unidade(n, ret, foto) {
  const [tipo, area, frente, sacada, vagas, sit] = UN[n];
  const m2 = area.toFixed(2).replace('.', ',');
  const partes = [`${m2} m² privativos`, 'de frente para a ' + frente.replace('Frente ', ''), sacada ? 'com sacada' : 'sem sacada'];
  if (vagas) partes.push(vagas === 1 ? '1 vaga de garagem' : '2 vagas de garagem');
  return {
    nome: `${tipo} ${n} · ${SIT[sit]}`, r: ret,
    txt: partes.join(', ') + '.' + (sit === 'vendido' ? ' Esta unidade já foi vendida.' : ''),
    chips: [m2 + ' m²', sacada ? 'Sacada' : 'Sem sacada', frente.replace('Frente ', '')].concat(vagas ? [vagas + (vagas === 1 ? ' vaga' : ' vagas')] : []),
    foto, fotoLeg: 'Imagem ilustrativa',
  };
}

const studios = (pav) => {
  const b = pav * 100;
  return [
    unidade(b + 2, r(265, 300, 880, 570), '/img/gama879/studio.webp'),
    unidade(b + 1, r(265, 570, 880, 830), '/img/gama879/studio.webp'),
    unidade(b + 4, r(1280, 300, 1990, 570), '/img/gama879/studio.webp'),
    unidade(b + 3, r(1280, 570, 1990, 830), '/img/gama879/studio.webp'),
  ];
};

const planta_interativa = {
  escala: 0,   // as unidades são marcadas pelo contorno; a metragem vem da tabela oficial
  nota: 'Metragens privativas da tabela oficial de novembro/2026. Disponibilidade sujeita a confirmação com o consultor.',
  tipos: [
    { titulo: 'Studios 2º pavimento', rotulo: 'Unidade', imagem: '/img/gama879/planta-studios-2.webp', w: 1920, h: 961,
      resumo: 'Quatro studios por andar, de 41 a 47 m², todos de frente. Os de final 2 e 4 têm sacada.',
      chips: ['41 a 47 m²', 'Persianas elétricas', 'Fechadura eletrônica'], foto: '/img/gama879/studio.webp', fotoLeg: 'Studio · imagem ilustrativa',
      comodos: studios(2) },
    { titulo: 'Studios 3º pavimento', rotulo: 'Unidade', imagem: '/img/gama879/planta-studios-3.webp', w: 1920, h: 961,
      resumo: 'Mesma planta do 2º pavimento. O 304 é o apartamento decorado, pronto para visitar.',
      chips: ['41 a 47 m²', 'Decorado no 304'], foto: '/img/gama879/decorado-1.webp', fotoLeg: 'Studio decorado (304)',
      comodos: studios(3) },
    { titulo: 'Duplex 1 suíte', rotulo: 'Unidade', imagem: '/img/gama879/planta-duplex1-4.webp', w: 1920, h: 961,
      resumo: 'Duplex no 4º e 5º pavimentos, de 66 a 73 m², com lavabo, churrasqueira com duto próprio, sacada e 1 vaga.',
      chips: ['66 a 73 m²', 'Churrasqueira', 'Lavabo', '1 vaga'], foto: '/img/gama879/duplex-1-suite.webp', fotoLeg: 'Duplex 1 suíte · imagem ilustrativa',
      comodos: [unidade(402, r(200, 256, 940, 540), '/img/gama879/duplex-1-suite.webp'), unidade(403, r(1250, 540, 2060, 830), '/img/gama879/duplex-1-suite.webp')] },
    { titulo: 'Duplex 2 suítes', rotulo: 'Unidade', imagem: '/img/gama879/planta-duplex2-4.webp', w: 1920, h: 961,
      resumo: 'Duplex no 4º e 5º pavimentos, de 77 a 83 m², com duas suítes, lavabo, churrasqueira, sacada e 2 vagas.',
      chips: ['77 a 83 m²', '2 suítes', 'Churrasqueira', '2 vagas'], foto: '/img/gama879/duplex-2-suites.webp', fotoLeg: 'Duplex 2 suítes · imagem ilustrativa',
      comodos: [unidade(401, r(200, 540, 940, 830), '/img/gama879/duplex-2-suites.webp'), unidade(404, r(1250, 256, 2060, 540), '/img/gama879/duplex-2-suites.webp')] },
  ],
};

module.exports = {
  slug: 'gama-879',
  nome: 'Gama 879',
  construtora: 'Astorga',
  cidade: 'Porto Alegre',
  bairro: 'Rio Branco',
  endereco: 'Rua Vasco da Gama, 879',
  lat: -30.0333442, lon: -51.2011502,
  tipo_imovel: 'Apartamentos',
  dormitorios: 'studio, 1 e 2 suítes',
  area: '41 a 83',
  vagas: 'Nos duplex',
  status: 'Pronto para morar',
  entrega: 'Pronto · Habite-se emitido',
  preco_inicial: 433440,
  preco_maximo: 1332000,
  whatsapp: '',              // sem corretores definidos: os contatos vão para a roleta do portal
  cta: 'Quero conhecer o',
  cor_principal: '#2F5D7C', cor_secundaria: '#5B8DB0', cor_accent: '#C97B4A',
  seo_titulo: 'Gama 879 — Studios e duplex prontos no Rio Branco, Porto Alegre',
  meta_description: 'Gama 879, da Astorga: 12 apartamentos prontos no Rio Branco, Porto Alegre. Studios de 41 a 47 m² e duplex de 1 e 2 suítes com rooftop. A partir de R$ 433 mil.',
  descricao: 'Apenas 12 apartamentos, todos de frente, numa rua tranquila do Rio Branco. Arquitetura autoral com fachada em tons de azul e floreiras, rooftop com vista 360º e tudo a uma caminhada: Zaffari, Panvel, cafés, escolas e o Parcão.',
  hero_image: '/img/gama879/fachada-rua.jpg',
  hero_video: '/midia/gama879/topo.mp4',
  video_url: '/midia/gama879/filme.mp4',
  card_imagem: '/img/gama879/fachada.jpg',
  card_selo: 'Pronto para morar',
  card_resumo: 'Studios e duplex prontos no Rio Branco, a partir de R$ 433 mil.',
  gallery: [
    { url: '/img/gama879/fachada-rua.jpg', tag: 'Fachada Rua Vasco da Gama' },
    { url: '/img/gama879/fachada-2.jpg', tag: 'Fachada Rua Liberdade' },
    { url: '/img/gama879/rooftop-2.jpg', tag: 'Rooftop com solarium' },
    { url: '/img/gama879/rooftop.jpg', tag: 'Rooftop com churrasqueira e fogo de chão' },
    { url: '/img/gama879/duplex-1-suite.jpg', tag: 'Duplex 1 suíte' },
    { url: '/img/gama879/duplex-2-suites.jpg', tag: 'Duplex 2 suítes' },
    { url: '/img/gama879/studio.jpg', tag: 'Studio' },
    { url: '/img/gama879/decorado-1.jpg', tag: 'Decorado (foto real)' },
    { url: '/img/gama879/decorado-3.jpg', tag: 'Decorado (foto real)' },
    { url: '/img/gama879/hall.jpg', tag: 'Hall de acesso' },
    { url: '/img/gama879/lavanderia.jpg', tag: 'Lavanderia coletiva' },
    { url: '/img/gama879/bicicletario.jpg', tag: 'Bicicletário' },
  ],
  infra: [
    { titulo: 'Rooftop', sub: 'Vista 360º, churrasqueira e fogo de chão' },
    { titulo: 'Solarium', sub: 'Espaço para exercícios ao ar livre' },
    { titulo: 'Lavanderia coletiva', sub: 'Entregue equipada' },
    { titulo: 'Bicicletas', sub: '4 bicicletas do condomínio' },
    { titulo: 'Portaria remota', sub: 'CFTV com aplicativo' },
    { titulo: 'Smart lockers', sub: 'Para encomendas' },
    { titulo: 'Horta coletiva', sub: 'Temperos e frutíferas' },
    { titulo: 'Painel de ferramentas', sub: 'Para uso dos moradores' },
  ],
  diferenciais: [
    { titulo: 'Só 12 apartamentos', texto: 'Quatro por andar, todos de frente para a Vasco da Gama ou a Liberdade. Menos vizinhos, mais tranquilidade.' },
    { titulo: 'Pronto para morar', texto: 'Habite-se emitido. Visita ao decorado e mudança sem esperar obra.' },
    { titulo: 'O Rio Branco a pé', texto: 'Zaffari, Panvel, padarias, cafés, escolas e o Parcão a uma caminhada. E acesso rápido às principais vias.' },
    { titulo: 'Arquitetura autoral', texto: 'Projeto da OCA Oficina Conceito Arquitetura, com fachada em tons de azul, floreiras nas sacadas e grandes aberturas.' },
  ],
  acabamentos: [
    { item: 'Persianas elétricas', det: 'Em todas as unidades' },
    { item: 'Fechadura eletrônica', det: 'Na porta de acesso' },
    { item: 'Espera para split', det: 'Living e suítes' },
    { item: 'Chuveiro de teto', det: 'Nos banheiros' },
    { item: 'Medição individual de água', det: 'Conta separada' },
    { item: 'Esquadrias de alumínio', det: 'Pintura eletrostática preta' },
  ],
  timeline: [],
  faq: [
    { q: 'O Gama 879 já está pronto?', a: 'Sim. O empreendimento está pronto e com Habite-se emitido. Dá para visitar o decorado e se mudar sem esperar obra.' },
    { q: 'Quais são os tipos de apartamento?', a: 'Studios de 41 a 47 m² (2º e 3º andares) e duplex de 1 suíte (66 a 73 m²) e de 2 suítes (77 a 83 m²) no 4º e 5º andares. Os duplex têm lavabo, churrasqueira e vaga de garagem.' },
    { q: 'Qual o valor e a forma de pagamento?', a: 'Os valores partem de R$ 433.440. A tabela atual prevê 30% de ato e 70% de financiamento. Fale com um consultor para ver as unidades disponíveis e simular a tua condição.' },
    { q: 'Os studios têm vaga de garagem?', a: 'As vagas ficam com as unidades duplex. O prédio tem bicicletário com 4 bicicletas do condomínio.' },
    { q: 'Posso visitar o decorado?', a: 'Sim. O studio 304 é o decorado. Chama no WhatsApp que um consultor marca o melhor horário.' },
  ],
  pois: [
    { label: '💊 Panvel · 100 m', lat: '-30.033740', lon: '-51.202273' },
    { label: '🛒 Zaffari Cabral · 150 m', lat: '-30.033919', lon: '-51.202311' },
    { label: '🏫 Colégio Leonardo da Vinci · 200 m', lat: '-30.034560', lon: '-51.202787' },
    { label: '🌳 Largo Ernesto Ordovas · 250 m', lat: '-30.032517', lon: '-51.203832' },
    { label: '🏥 Unidade Álvaro Alvim (HCPA) · 500 m', lat: '-30.037137', lon: '-51.198245' },
    { label: '🛍️ 5ª Avenida Center · 750 m', lat: '-30.028407', lon: '-51.206206' },
  ],
  construtora_sobre: 'A Astorga combina mais de 45 anos no mercado imobiliário com arquitetura autoral e projetos pensados em diálogo com o bairro. Cada empreendimento é planejado nos detalhes, da escolha do terreno à posição solar e aos materiais.',
  construtora_stats: [
    { num: '45+', label: 'anos de mercado' },
    { num: '12', label: 'apartamentos no Gama 879' },
  ],
  aviso_legal: 'Incorporação imobiliária registrada em 13/12/2023 sob o R-981.450 da matrícula nº 213.317, livro nº 2, do Ofício de Registro de Imóveis da 1ª Zona de Porto Alegre. Imagens ilustrativas. Valores e disponibilidade da tabela de novembro/2026, sujeitos a alteração pela incorporadora.',
  published: true,
  planta_interativa,
};
