// Ícones dos itens de lazer, escolhidos pelo nome do item ("Beach Pool" ->
// piscina, "Fitness Center" -> haltere). Antes eram distribuídos em rodízio
// e o "Delivery" ganhava ícone de piscina. Item sem correspondência usa
// uma estrela genérica. Cada grupo tem uma cor própria.

const s = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const I = {
  piscina: s('<path d="M2 18c1.7 0 1.7 1.2 3.4 1.2S7.1 18 8.8 18s1.7 1.2 3.4 1.2S13.9 18 15.6 18s1.7 1.2 3.4 1.2S20.7 18 22 18"/><path d="M2 14c1.7 0 1.7 1.2 3.4 1.2S7.1 14 8.8 14s1.7 1.2 3.4 1.2S13.9 14 15.6 14s1.7 1.2 3.4 1.2S20.7 14 22 14"/><path d="M8 13V5a2 2 0 0 1 4 0M16 13V5a2 2 0 0 0-4 0M8 8h8"/>'),
  infantilPiscina: s('<circle cx="12" cy="7" r="3"/><path d="M2 17c1.7 0 1.7 1.2 3.4 1.2S7.1 17 8.8 17s1.7 1.2 3.4 1.2S13.9 17 15.6 17s1.7 1.2 3.4 1.2S20.7 17 22 17"/><path d="M8 14l4-4 4 4"/>'),
  academia: s('<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>'),
  quadra: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  bar: s('<path d="M7 3h10l-5 8-5-8ZM12 11v8M8 21h8"/><path d="M15 6h3"/>'),
  rooftop: s('<circle cx="12" cy="9" r="3.5"/><path d="M12 2v1.5M5 9H3.5M20.5 9H19M6.6 3.6l1 1M17.4 3.6l-1 1"/><path d="M3 21h18M5 21v-5h14v5"/>'),
  playground: s('<path d="M4 21V5l8-2 8 2v16M4 9h16"/><path d="M9 9v6M15 9v6M8 15h2M14 15h2"/>'),
  kids: s('<path d="M7 20v-5a5 5 0 0 1 10 0v5"/><circle cx="12" cy="6" r="3"/><path d="M4 20h16"/>'),
  festa: s('<path d="M12 3c-3 0-5 2.4-5 5.2C7 11.5 12 15 12 15s5-3.5 5-6.8C17 5.4 15 3 12 3Z"/><path d="M12 15c0 2-2 2.5-2 4.5S12 21 12 21"/>'),
  gourmet: s('<path d="M6 13h12M7 13a5 5 0 0 1 10 0"/><path d="M12 6V4M5 17h14l-1 4H6l-1-4Z"/>'),
  churrasqueira: s('<path d="M4 10h16a8 8 0 0 1-16 0Z"/><path d="M8 20l2-4M16 20l-2-4M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2"/>'),
  coworking: s('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20M9 16v4M15 16v4"/>'),
  mercado: s('<path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>'),
  delivery: s('<path d="M3 7l9-4 9 4v10l-9 4-9-4V7Z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
  loja: s('<path d="M3 9l1.5-5h15L21 9M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9Z"/><path d="M5 13v8h14v-8M10 21v-5h4v5"/>'),
  jardim: s('<path d="M12 21v-8M12 13C12 8 8 5 3 5c0 5 4 8 9 8ZM12 13c0-4 3-7 8-7 0 4-3 7-8 7Z"/>'),
  seguranca: s('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="M9 12l2 2 4-4"/>'),
  pet: s('<circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M12 12c-3 0-6 3.5-6 6 0 1.5 1.5 2.5 3 2 1-.3 2-.7 3-.7s2 .4 3 .7c1.5.5 3-.5 3-2 0-2.5-3-6-6-6Z"/>'),
  sauna: s('<path d="M8 4c-1 1.3 1 2.7 0 4M12 4c-1 1.3 1 2.7 0 4M16 4c-1 1.3 1 2.7 0 4"/><rect x="3" y="11" width="18" height="9" rx="2"/><path d="M3 15h18"/>'),
  spa: s('<path d="M12 21c-5 0-9-3-9-7 3 0 6 1 9 4 3-3 6-4 9-4 0 4-4 7-9 7Z"/><path d="M12 18c-2-3-2-7 0-11 2 4 2 8 0 11Z"/>'),
  cinema: s('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4"/>'),
  jogos: s('<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5"/><circle cx="16" cy="11" r="1"/><circle cx="18" cy="14" r="1"/>'),
  salao: s('<path d="M4 18v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5M2 14h2M20 14h2M4 18h16M6 11V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/>'),
  bicicleta: s('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l2 8h-6M14 5h3"/>'),
  energia: s('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  elevador: s('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 9l3-3 3 3M9 15l3 3 3-3"/>'),
  estrela: s('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z"/>'),
};

// [palavras-chave, ícone, cor]. A ordem importa: a primeira regra que bate vence.
const REGRAS = [
  [/kids?\s*pool|piscina\s*infantil/, 'infantilPiscina', 'azul'],
  [/piscina|pool|raia|deck molhado/, 'piscina', 'azul'],
  [/fitness|academia|gym|muscula|crossfit/, 'academia', 'laranja'],
  [/quadra|court|esporte|futebol|tenis|beach\s*tennis|poliesportiv/, 'quadra', 'verde'],
  [/sky\s*bar|\bbar\b|lounge|drinks?/, 'bar', 'roxo'],
  [/rooftop|terra[cç]o|mirante/, 'rooftop', 'amarelo'],
  [/playground|parquinho/, 'playground', 'rosa'],
  [/kids|brinquedoteca|infantil|crian/, 'kids', 'rosa'],
  [/party|festa|eventos|celebra/, 'festa', 'rosa'],
  [/churras|grill|parrilla/, 'churrasqueira', 'laranja'],
  [/gourmet|cozinha|chef/, 'gourmet', 'laranja'],
  [/cowork|escrit|home\s*office|estudo/, 'coworking', 'azul'],
  [/market|mercado|minimercado|conveni/, 'mercado', 'verde'],
  [/delivery|encomenda|entrega|lockers?|correspond/, 'delivery', 'amarelo'],
  [/mall|loja|comercia|servi[cç]os/, 'loja', 'roxo'],
  [/garden|jardim|pra[cç]a|verde|bosque|paisag/, 'jardim', 'verde'],
  [/guarita|portaria|seguran|concierge|controle de acesso/, 'seguranca', 'azul'],
  [/pet/, 'pet', 'amarelo'],
  [/sauna/, 'sauna', 'laranja'],
  [/spa|massag|relax|ofur/, 'spa', 'roxo'],
  [/cinema|home\s*theater/, 'cinema', 'roxo'],
  [/jogos|games|sinuca/, 'jogos', 'azul'],
  [/sal[aã]o/, 'salao', 'rosa'],
  [/biciclet|bike/, 'bicicleta', 'verde'],
  [/carregador|el[eé]tric|ev\b|solar|energia/, 'energia', 'amarelo'],
  [/elevador/, 'elevador', 'azul'],
];

function lazer(titulo) {
  const t = String(titulo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [re, ic, cor] of REGRAS) if (re.test(t)) return { svg: I[ic], cor };
  return { svg: I.estrela, cor: 'verde' };
}

module.exports = { lazer, I };
