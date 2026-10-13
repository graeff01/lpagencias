// Teste da roleta: roda contra o Postgres em memória e prova que a
// distribuição é justa. Uso:  npm run test:roleta
delete process.env.DATABASE_URL;

const db = require('../lib/db');
const roleta = require('../lib/roleta');

let falhas = 0;
function ok(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) falhas++;
}

(async () => {
  await db.migrate();
  const emp = await db.create({ slug: 'teste-roleta', nome: 'Teste', whatsapp: '(51) 98888-0000' });

  console.log('\n1) Rodízio com 10 corretores e 100 leads');
  for (let i = 1; i <= 10; i++) {
    await db.createCorretor(emp.id, { nome: 'C' + i, telefone: `5199990${String(i).padStart(4, '0')}` });
  }
  for (let i = 0; i < 100; i++) await db.proximoCorretor(emp.id);
  let cs = await db.listCorretores(emp.id);
  ok(cs.every(c => c.atribuicoes === 10), 'cada corretor recebeu exatamente 10 (' + cs.map(c => c.atribuicoes).join(',') + ')');

  console.log('\n2) Peso 2 recebe o dobro');
  const emp2 = await db.create({ slug: 'teste-peso', nome: 'Peso' });
  await db.createCorretor(emp2.id, { nome: 'Normal', telefone: '51999900001', peso: 1 });
  await db.createCorretor(emp2.id, { nome: 'Dobro', telefone: '51999900002', peso: 2 });
  for (let i = 0; i < 30; i++) await db.proximoCorretor(emp2.id);
  cs = await db.listCorretores(emp2.id);
  const normal = cs.find(c => c.nome === 'Normal').atribuicoes;
  const dobro = cs.find(c => c.nome === 'Dobro').atribuicoes;
  ok(dobro === normal * 2, `peso 2 recebeu ${dobro} contra ${normal} do peso 1`);

  console.log('\n3) Pausar tira da fila; reativar não gera enxurrada de catch-up');
  const emp3 = await db.create({ slug: 'teste-pausa', nome: 'Pausa' });
  const a = await db.createCorretor(emp3.id, { nome: 'A', telefone: '51999900011' });
  const b = await db.createCorretor(emp3.id, { nome: 'B', telefone: '51999900012' });
  await db.updateCorretor(b.id, { ...b, ativo: false });
  for (let i = 0; i < 20; i++) await db.proximoCorretor(emp3.id);
  let bDepois = await db.getCorretor(b.id);
  ok(bDepois.atribuicoes === 0, 'pausado não recebeu nada durante a pausa');
  await db.updateCorretor(b.id, { ...bDepois, ativo: true });
  bDepois = await db.getCorretor(b.id);
  const aDepois = await db.getCorretor(a.id);
  ok(bDepois.atribuicoes === aDepois.atribuicoes,
     `ao reativar, entrou no nível do ativo (${bDepois.atribuicoes} vs ${aDepois.atribuicoes}) em vez de cobrar os 20 perdidos`);

  console.log('\n4) Concorrência: 50 cliques simultâneos não duplicam ninguém');
  const emp4 = await db.create({ slug: 'teste-corrida', nome: 'Corrida' });
  for (let i = 1; i <= 5; i++) await db.createCorretor(emp4.id, { nome: 'X' + i, telefone: `5199991000${i}` });
  await Promise.all(Array.from({ length: 50 }, () => db.proximoCorretor(emp4.id)));
  cs = await db.listCorretores(emp4.id);
  ok(cs.every(c => c.atribuicoes === 10), 'todos com 10 após 50 cliques em paralelo (' + cs.map(c => c.atribuicoes).join(',') + ')');

  console.log('\n5) Resgate após 24h (lead que volta sem ter tido retorno)');
  const emp5 = await db.create({ slug: 'teste-resgate', nome: 'Resgate' });
  const r1 = await db.createCorretor(emp5.id, { nome: 'R1', telefone: '51999920001' });
  await db.createCorretor(emp5.id, { nome: 'R2', telefone: '51999920002' });
  await db.createCorretor(emp5.id, { nome: 'R3', telefone: '51999920003' });

  const req = (h) => ({ headers: h, socket: { remoteAddress: '200.1.1.1' }, query: {} });
  const res = { cookies: {}, cookie(n, v) { this.cookies[n] = v; } };
  const ua = { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605' };

  const p1 = await roleta.distribuir(req(ua), res, emp5, 'hero');
  ok(p1.novoLead === true, 'primeiro clique gera lead novo para ' + p1.corretor.nome);

  // mesma pessoa clicando de novo agora: continua com o mesmo, sem novo lead
  const cookieAtual = Object.entries(res.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const p2 = await roleta.distribuir(req({ ...ua, cookie: cookieAtual }), res, emp5, 'flutuante');
  ok(p2.corretor.id === p1.corretor.id && !p2.novoLead && !p2.resgate,
     'clicar em outro botão na hora mantém o mesmo corretor e não conta 2 leads');

  // 25h depois: o cookie carrega o carimbo antigo
  const antigo = `ap_crt_${emp5.id}=${p1.corretor.id}.${Math.floor(Date.now() / 1000) - 25 * 3600}`;
  const p3 = await roleta.distribuir(req({ ...ua, cookie: antigo }), res, emp5, 'hero');
  ok(p3.resgate === true, 'volta após 25h dispara resgate');
  ok(p3.corretor.id !== p1.corretor.id, `resgate foi para outro corretor (${p3.corretor.nome}), não para quem já não retornou`);

  const perdidos = await db.naoRetornados(emp5.id);
  ok(perdidos[p1.corretor.id] === 1, 'relatório marca 1 "não retornou" para o primeiro corretor');

  console.log('\n6) Validação de WhatsApp');
  ok(roleta.validarWhats('(51) 99999-0001') === '5551999990001', 'aceita número válido com máscara');
  ok(roleta.validarWhats('51 9999') === null, 'recusa número curto');
  ok(roleta.validarWhats('(01) 99999-0001') === null, 'recusa DDD inexistente');
  ok(roleta.validarWhats('(51) 99999-9999') === null, 'recusa dígitos repetidos');
  ok(roleta.validarWhats('(51) 89999-0001') === null, 'recusa celular de 9 dígitos que não começa com 9');

  console.log('\n7) Robôs não consomem vez da fila');
  ok(roleta.isBot('facebookexternalhit/1.1'), 'detecta preview do Facebook/WhatsApp');
  ok(roleta.isBot('Googlebot/2.1'), 'detecta Googlebot');
  ok(!roleta.isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1'), 'não confunde iPhone real com robô');

  console.log('\n8) Painel do gestor: soma o corretor em todos os empreendimentos, só da equipe dele');
  const equipes = require('../lib/equipes');
  const ea = await db.create({ slug: 'teste-eq-a', nome: 'Eq A' });
  const eb = await db.create({ slug: 'teste-eq-b', nome: 'Eq B' });
  // Ana está nas duas roletas (mesmo WhatsApp, máscaras diferentes); Bia só na A.
  const anaA = await db.createCorretor(ea.id, { nome: 'Ana', telefone: '(51) 99777-0001' });
  await db.createCorretor(ea.id, { nome: 'Bia', telefone: '51997770002' });
  await db.createCorretor(eb.id, { nome: 'Ana Souza', telefone: '5551997770001' });
  const g1 = await db.createGestor({ nome: 'G1', usuario: 'g1', senha_hash: equipes.hashSenha('senha-forte-1') });
  const g2 = await db.createGestor({ nome: 'G2', usuario: 'g2', senha_hash: equipes.hashSenha('senha-forte-2') });
  await db.salvarEquipes({ '51997770001': { gestor_id: g1.id, nome: 'Ana' }, '51997770002': { gestor_id: g2.id, nome: 'Bia' } });

  const visita = (ip) => ({ headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605' }, socket: { remoteAddress: ip }, query: {} });
  const resp = () => ({ cookie() {} });
  for (let i = 0; i < 6; i++) await roleta.distribuir(visita('10.0.0.' + i), resp(), ea, 'hero');
  for (let i = 0; i < 3; i++) await roleta.distribuir(visita('10.0.1.' + i), resp(), eb, 'hero');

  const pg1 = await equipes.painel(g1, 'tudo');
  ok(pg1.linhas.length === 1 && pg1.linhas[0].nome === 'Ana', 'G1 vê só a Ana');
  ok(pg1.total.leads === 6, `Ana somou 3 leads na A + 3 na B = ${pg1.total.leads}`);
  ok(pg1.linhas[0].porEmp.length === 2, 'quebra por empreendimento mostra as duas roletas');
  const pg2 = await equipes.painel(g2, '30');
  ok(pg2.total.leads === 3 && pg2.linhas[0].nome === "Bia", `G2 vê só a Bia, com ${pg2.total.leads} leads`);

  await db.removeCorretor(anaA.id);
  const p1b = await equipes.painel(g1, 'tudo');
  ok(p1b.total.leads === 6, 'excluir o corretor de uma roleta não apaga o histórico da equipe');

  const ontemNoMesPassado = equipes.periodo('mes-anterior');
  ok(ontemNoMesPassado.ate <= equipes.periodo('mes').desde, 'mês passado termina onde este mês começa');
  ok(equipes.confereSenha('senha-forte-1', g1.senha_hash) && !equipes.confereSenha('errada', g1.senha_hash), 'senha confere só a certa');

  console.log('\n9) Recepção: envios contam para o corretor e aparecem no painel do gestor');
  const mari = await db.salvarAgencia(null, { nome: 'Ana', telefone: '(51) 99777-0001' });
  await db.registrarEncaminhamento({ usuario_id: 99, corretor_fone: mari.telefone, corretor_nome: 'Ana', canal: 'Instagram' });
  await db.registrarEncaminhamento({ usuario_id: 99, corretor_fone: mari.telefone, corretor_nome: 'Ana', canal: null });
  const pg3 = await equipes.painel(g1, 'hoje');
  ok(pg3.total.recepcao === 2 && pg3.linhas[0].recepcao === 2, `Ana aparece com ${pg3.total.recepcao} envios da recepção na equipe do G1`);
  const pg4 = await equipes.painel(g2, 'hoje');
  ok(pg4.total.recepcao === 0, 'G2 não vê envios de corretor de outra equipe');
  const rec = await db.createGestor({ nome: 'Larissa', usuario: 'larissa', senha_hash: equipes.hashSenha('x'.repeat(8)), papel: 'recepcao' });
  ok(rec.papel === 'recepcao', 'acesso de recepção é gravado com o papel certo');

  console.log('\n10) Recepção: lê a mensagem do Leads Delivery e guarda o lead');
  const P = require('../public/js/lead-parser');
  const zap = 'Olá!\n\nNovo cadastro recebido do *ZAP* para o imóvel 817210\n\n*Informações do cadastro*\nNome: T.Ghedini\n'
    + 'E-mail: thailherghedini@gmail.com\nTelefone: 5551989082077\nNegócio: Vendas\nMensagem: Olá, quero comprar a casa. Aguardo.'
    + 'A seguir, dados para contato com FULANO:E-mail: x@y.com\n\nCorretor responsável: Z - AP - Jardim Do Lago\n\n'
    + 'Cadastro gerador: Canoas Jardim do Lago equipe C\n\n📲 *Mensagem automática do Leads Delivery*.';
  const lz = P.ler(zap);
  ok(lz.nome === 'T.Ghedini' && lz.telefone === '5551989082077' && lz.email === 'thailherghedini@gmail.com',
     'separa nome, telefone e e-mail');
  ok(lz.imovel === '817210' && lz.origem === 'ZAP Imóveis' && lz.negocio === 'Venda', 'separa imóvel, origem (ZAP) e negócio');
  ok(lz.mensagem === 'Olá, quero comprar a casa. Aguardo.', 'mensagem sem o rodapé repetido do portal');
  ok(P.canalDaOrigem(lz.origem) === 'Portais', 'ZAP vira canal Portais');
  const livre = P.ler('oi, sou a Maria, vi no instagram, meu cel (51) 99876-5432');
  ok(livre.telefone === '5551998765432' && livre.origem === 'Instagram', 'texto livre: acha telefone e Instagram');
  ok(P.ler('E-mail: -\nMensagem: -').email === '', 'campo com "-" fica vazio');
  const msgC = P.mensagemCorretor({ ...lz, canal: 'Portais' });
  ok(msgC.includes('*Nome:* T.Ghedini') && msgC.includes('wa.me/5551989082077'), 'mensagem do corretor traz nome e link do cliente');

  const env = await db.registrarEncaminhamento({ usuario_id: 99, corretor_fone: '51997770001', corretor_nome: 'Ana',
    lead_nome: lz.nome, lead_telefone: lz.telefone, imovel: lz.imovel, origem: lz.origem, mensagem: lz.mensagem });
  ok(env.lead_nome === 'T.Ghedini' && env.imovel === '817210', 'envio guarda os dados do lead');
  const ult = await db.ultimoEnvioDoLead('(51) 98908-2077');
  ok(ult && ult.corretor_nome === 'Ana', 'consulta acha para quem o cliente já foi enviado');
  const pg5 = await equipes.painel(g1, 'hoje');
  ok(pg5.daRecepcao.some(r => r.lead_nome === 'T.Ghedini'), 'gestor da equipe vê o lead com nome do cliente');
  const pg6 = await equipes.painel(g2, 'hoje');
  ok(!pg6.daRecepcao.length, 'gestor de outra equipe não vê');

  console.log(falhas ? `\n${falhas} teste(s) falharam.\n` : '\nTodos os testes passaram.\n');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('\nErro no teste:', e); process.exit(1); });
