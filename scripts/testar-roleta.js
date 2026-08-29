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

  console.log(falhas ? `\n${falhas} teste(s) falharam.\n` : '\nTodos os testes passaram.\n');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('\nErro no teste:', e); process.exit(1); });
