// Regras do simulador "Cabe no seu bolso?" da landing.
//
// Tudo o que muda com o mercado (juros, faixas do Minha Casa Minha Vida,
// tetos, subsídio) fica AQUI, num lugar só. A página recebe estes números
// prontos e faz a conta no navegador, na hora em que a pessoa mexe.
//
// O resultado é uma ESTIMATIVA para orientar a conversa com o consultor:
// a aprovação de verdade depende da análise de crédito do banco (idade,
// score, dívidas, FGTS disponível etc.). A página diz isso ao visitante.
//
// Conferir estes valores sempre que o governo ou os bancos mudarem as regras.

const REGRAS = {
  atualizado: '2026-11',

  // Parte da renda bruta familiar que os bancos aceitam na parcela.
  comprometimento: 0.30,

  // Seguros obrigatórios (MIP e DFI) e taxa de administração somam, na
  // prática, algo entre 4% e 8% da 1ª parcela. Usamos uma margem no meio.
  margemSeguros: 0.06,

  // Prazos oferecidos no simulador, em anos (o maior aceito é 35).
  prazos: [20, 30, 35],
  prazoPadrao: 30,

  // Financiamento bancário comum (SBPE): juros ao ano já com a TR média,
  // tabela SAC (a 1ª parcela é a maior), até 80% do valor do imóvel.
  sbpe: { nome: 'Financiamento bancário', juros: 0.1199, cota: 0.80, tabela: 'SAC' },

  // Minha Casa Minha Vida (FGTS). Faixas pela renda bruta familiar mensal.
  // juros: [na menor renda da faixa, na maior] (interpolado no meio).
  // teto: valor máximo do imóvel na faixa. subsidio: [na menor renda, na
  // maior] — o subsídio cai conforme a renda sobe e some a partir da faixa 3.
  // tabela PRICE: parcela fixa (é o que a Caixa usa no MCMV).
  mcmv: [
    { faixa: 1, rendaMax: 2850,  juros: [0.0425, 0.0425], teto: 264000, subsidio: [55000, 30000], cota: 0.80 },
    { faixa: 2, rendaMax: 4700,  juros: [0.0475, 0.0700], teto: 264000, subsidio: [30000, 0],     cota: 0.80 },
    { faixa: 3, rendaMax: 8600,  juros: [0.0766, 0.0816], teto: 350000, subsidio: [0, 0],         cota: 0.80 },
    { faixa: 4, rendaMax: 12000, juros: [0.1000, 0.1050], teto: 500000, subsidio: [0, 0],         cota: 0.80 },
  ],
};

module.exports = { REGRAS };
