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
  await require('../lib/sdr').migrate();
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

  const email = 'Dados do Lead\nNome: Wlademir Campos\nTelefone:\n(51) 98616-7293\nE-mail:\nwlad_5444@yahoo.com.br\n'
    + 'Interesse: Não informado\nMensagem: Fiz uma simulação. <br />Financiamento de R$ 132.000,00<br /><br>Banco: ITAÚ | Taxa: 12% <br />\n'
    + 'Data do interesse: Não informado\nCorretor Responsável\nNome: Fábio Goulart\nAgência: Canoas\nContato: fabio@auxiliadorapredial.com.br';
  const le = P.ler(email);
  ok(le.nome === 'Wlademir Campos' && le.telefone === '5551986167293', 'e-mail: valor na linha de baixo do rótulo (telefone)');
  ok(le.email === 'wlad_5444@yahoo.com.br', 'e-mail: mantém o "_" do endereço');
  ok(le.negocio === '', 'e-mail: "Não informado" fica vazio');
  ok(le.mensagem === 'Fiz uma simulação.\nFinanciamento de R$ 132.000,00\nBanco: ITAÚ | Taxa: 12%', 'e-mail: <br> vira quebra e a mensagem para no "Data do interesse"');
  ok(le.corretor === 'Fábio Goulart', 'e-mail: separa o corretor responsável do nome do cliente');

  const env = await db.registrarEncaminhamento({ usuario_id: 99, corretor_fone: '51997770001', corretor_nome: 'Ana',
    lead_nome: lz.nome, lead_telefone: lz.telefone, imovel: lz.imovel, origem: lz.origem, mensagem: lz.mensagem });
  ok(env.lead_nome === 'T.Ghedini' && env.imovel === '817210', 'envio guarda os dados do lead');
  const ult = await db.ultimoEnvioDoLead('(51) 98908-2077');
  ok(ult && ult.corretor_nome === 'Ana', 'consulta acha para quem o cliente já foi enviado');
  const pg5 = await equipes.painel(g1, 'hoje');
  ok(pg5.daRecepcao.some(r => r.lead_nome === 'T.Ghedini'), 'gestor da equipe vê o lead com nome do cliente');
  const pg6 = await equipes.painel(g2, 'hoje');
  ok(!pg6.daRecepcao.length, 'gestor de outra equipe não vê');

  console.log('\n11) Campanha Nimbus: roleta da landing + recepção, sem repetir corretor');
  ok(!(await db.listCampanhasRecepcao()).length, 'sem o empreendimento Nimbus, a carga espera');
  const nimbus = await db.create({ slug: 'nimbus', nome: 'Nimbus' });
  await db.cargasUnicas();   // a carga roda na subida seguinte
  const filaN = await db.filaCorretores(nimbus.id);
  ok(filaN.length === 9, `roleta do Nimbus com os 9 corretores (${filaN.length})`);
  ok((await db.listCampanhasRecepcao()).some(c => c.id === nimbus.id), 'Nimbus aparece como campanha na recepção');
  await db.cargasUnicas();
  ok((await db.filaCorretores(nimbus.id)).length === 9, 'subir de novo não duplica ninguém');
  // 9 leads alternando recepção (pega o próximo da vez) e site (roleta): cada um recebe 1
  const recebidos = [];
  for (let i = 0; i < 9; i++) {
    if (i % 2) recebidos.push((await db.proximoCorretor(nimbus.id)).id);
    else {
      const prox = (await db.filaCorretores(nimbus.id))[0];
      recebidos.push((await db.atribuirCorretor(nimbus.id, prox.id)).id);
    }
  }
  ok(new Set(recebidos).size === 9, 'em 9 leads (site e recepção misturados), ninguém recebeu dois');
  const prox10 = (await db.filaCorretores(nimbus.id))[0];
  ok(prox10.id === recebidos[0], 'o 10º lead volta para quem recebeu o 1º');

  console.log('\n12) Acessos do Alberto e do Fabrício com senha temporária');
  const alb = await db.getGestorPorUsuario('alberto');
  const fab = await db.getGestorPorUsuario('fabricio');
  ok(alb && fab && alb.trocar_senha && fab.trocar_senha, 'os dois existem e precisam trocar a senha no primeiro acesso');
  const eqA = (await db.listEquipe(alb.id)).map(m => m.telefone).sort();
  const eqF = (await db.listEquipe(fab.id)).map(m => m.telefone).sort();
  ok(eqA.length === 5 && eqF.length === 4, `equipes montadas (Alberto ${eqA.length}, Fabrício ${eqF.length})`);
  ok(eqA.includes('5551994915337') && eqF.includes('5551981792048'), 'cada Fernando na equipe certa');
  await db.updateGestor(alb.id, { senha_hash: equipes.hashSenha('nova-senha-1'), trocar_senha: false });
  const alb2 = await db.getGestor(alb.id);
  ok(!alb2.trocar_senha && equipes.confereSenha('nova-senha-1', alb2.senha_hash), 'depois de trocar, entra com a nova senha');

  console.log('\n13) Caixa de leads: e-mail entra na fila "A encaminhar"');
  process.env.LEADS_WEBHOOK_TOKEN = 'x';
  const caixa = require('../lib/caixa-leads');
  const html = '<p>Dados do Lead</p><p>Nome: Joana Prado<br>Telefone:<br>(51) 98111-2233<br>E-mail:<br>joana@ex.com</p>'
    + '<p>Mensagem: Quero visitar o apto.</p><p>Corretor Responsável<br>Nome: Fábio Goulart</p>';
  const e1 = await caixa.receberWebhook({ message_id: 'abc-1', from: 'portal@zap.com', subject: 'Novo lead', html });
  ok(e1 && e1.dados && (typeof e1.dados === 'string' ? JSON.parse(e1.dados) : e1.dados).telefone === '5551981112233', 'e-mail em HTML vira lead com telefone na fila');
  ok(!(await caixa.receberWebhook({ message_id: 'abc-1', from: 'portal@zap.com', subject: 'Novo lead', html })), 'o mesmo e-mail não entra duas vezes');
  let pend = await db.listEntradas('pendente');
  ok(pend.length === 1 && pend[0].dados.nome === 'Joana Prado' && pend[0].dados.corretor === 'Fábio Goulart', 'fila mostra nome e corretor responsável');
  await caixa.receberWebhook({ message_id: 'spam-1', subject: 'Promoção', text: 'compre agora' });
  const spam = (await db.listEntradas('pendente')).find(x => x.assunto === 'Promoção');
  await db.tratarEntrada(spam.id, { status: 'descartado', motivo: 'spam' });
  ok((await db.listEntradas('pendente')).length === 1, 'descartar tira da fila');
  ok(!(await db.tratarEntrada(spam.id, { status: 'encaminhado' })), 'lead já tratado não é tratado de novo');

  console.log('\n14) Link "Recebi" do corretor');
  const tk = 'Tk' + 'abcdefghij0123456789';
  const envT = await db.registrarEncaminhamento({ usuario_id: 99, corretor_fone: '51985717877', corretor_nome: 'Ketlin Lima',
    lead_nome: 'Joana Prado', lead_telefone: '51981112233', token: tk, entrada_id: pend[0].id });
  await db.tratarEntrada(pend[0].id, { status: 'encaminhado', encaminhamento_id: envT.id });
  ok(!(await db.listEntradas('pendente')).length, 'encaminhar tira o lead da fila');
  ok((await db.envioPorToken(tk)).id === envT.id, 'o token acha o envio');
  ok(!(await db.envioPorToken('curto')) && !(await db.envioPorToken('x'.repeat(20) + "' or 1=1")), 'token inválido não acha nada');
  const c1 = await db.confirmarEnvio(envT.id);
  await new Promise(r => setTimeout(r, 20));
  const c2 = await db.confirmarEnvio(envT.id);
  ok(c1.confirmado_em && String(c2.confirmado_em) === String(c1.confirmado_em), 'confirmar duas vezes guarda o primeiro horário');
  const cf = equipes.confirmacoes([{ token: 'a', created_at: new Date(Date.now() - 10 * 60000), confirmado_em: new Date() }, { token: 'b', created_at: new Date() }, { created_at: new Date() }]);
  ok(cf.comLink === 2 && cf.confirmados === 1 && cf.pendentes === 1 && Math.round(cf.tempoMedio) === 10, 'métrica: confirmados, sem confirmar e tempo médio');
  ok(P.mensagemCorretor({ nome: 'X', telefone: '5551981112233', linkOk: 'https://s/ok/abc' }).includes('Confirme que recebeu:* https://s/ok/abc'), 'mensagem do corretor leva o link');

  console.log('\n15) Auditoria: linha do tempo, cobrança, reencaminhamento e fechamento');
  const tel = '51987654321';
  await db.registrarEvento({ tipo: 'email_recebido', lead_nome: 'Lia', lead_telefone: tel, entrada_id: 1 });
  const e1b = await db.registrarEncaminhamento({ usuario_id: 1, corretor_fone: '51985717877', corretor_nome: 'Ketlin', lead_nome: 'Lia', lead_telefone: tel, token: 'Tk' + 'x'.repeat(18) });
  await db.registrarEvento({ tipo: 'encaminhado', lead_nome: 'Lia', lead_telefone: tel, encaminhamento_id: e1b.id, corretor_nome: 'Ketlin' });
  const tl = await db.eventosDoLead({ telefone: '(51) 98765-4321' });
  ok(tl.length === 2 && tl[0].tipo === 'email_recebido' && tl[1].tipo === 'encaminhado', 'linha do tempo pelo telefone, em ordem');
  ok((await db.buscarLeadsAuditoria('98765-4321')).length === 1 && (await db.buscarLeadsAuditoria('lia')).length === 1, 'busca por telefone e por nome');
  ok(!(await db.enviosSemConfirmacao(30)).some(x => x.id === e1b.id), 'envio recém-feito ainda não aparece para cobrar');
  ok((await db.enviosSemConfirmacao(0)).some(x => x.id === e1b.id), 'sem confirmação passa a aparecer para cobrar');
  const cob = await db.registrarCobranca(e1b.id);
  ok(cob.cobrancas === 1, 'cobrança contada');
  const e2b = await db.registrarEncaminhamento({ usuario_id: 1, corretor_fone: '51981792048', corretor_nome: 'Fernando Riolfi', lead_nome: 'Lia', lead_telefone: tel, token: 'Tk' + 'y'.repeat(18) });
  await db.substituirEnvio(e1b.id, e2b.id);
  ok(!(await db.enviosSemConfirmacao(0)).some(x => x.id === e1b.id), 'reencaminhado sai da lista de cobrança');
  ok((await db.getEncaminhamento(e1b.id)).substituido_por === e2b.id, 'o envio antigo aponta para o novo (histórico)');
  const fe = equipes.fechamento(
    [{ status: 'encaminhado', recebido_em: new Date(Date.now() - 50 * 60000), tratado_em: new Date(), tratado_por: 1 },
     { status: 'descartado', motivo: 'Spam', recebido_em: new Date(), tratado_em: new Date(), dados: {} },
     { status: 'pendente', recebido_em: new Date() }],
    [{ entrada_id: 5 }, { entrada_id: null }], [{ id: 1, nome: 'Larissa' }], 3);
  ok(fe.chegaram === 3 && fe.encaminhados === 1 && fe.descartados === 1 && fe.pendentes === 1 && fe.fecha, 'fechamento: a conta fecha');
  ok(fe.acima30 === 1 && Math.round(fe.esperaMedia) === 50 && fe.porPessoa[0].nome === 'Larissa', 'tempo de espera e quem encaminhou');
  ok(fe.motivos[0].motivo === 'spam' && fe.manuais === 1 && fe.formulariosLp === 3, 'motivos de descarte, colados à mão e formulários');

  console.log('\n16) LGPD: dados pessoais antigos são apagados');
  const r0 = await db.anonimizarAntigos(12);
  ok((await db.getEncaminhamento(e1b.id)).lead_nome === 'Lia', 'leads recentes ficam intactos');
  await db.anonimizarAntigos(-1);   // corte no futuro: tudo é "antigo"
  const anon = await db.getEncaminhamento(e1b.id);
  ok(anon.lead_nome === null && anon.lead_telefone === null && anon.corretor_nome === 'Ketlin', 'apaga dados do cliente e mantém quem recebeu');
  ok(!(await db.eventosDoLead({ telefone: tel })).length, 'linha do tempo também perde o telefone');

  console.log('\n17) SDR: lista, ligações, ficha e plantão');
  const sdr = require('../lib/sdr');
  const planilha = require('../lib/planilha');
  const csv = 'Nome;Celular;Telefone;Endereço\n"Ana Souza";(51) 99111-2222;51 3333-4444;Rua A, 10\nBruno;51 99111-3333 / 51 98888-0000;;\nSem Fone;;;\nAna Repetida;51991112222;;\n';
  const linhasCsv = planilha.lerCsv(csv);
  ok(linhasCsv.length === 5 && linhasCsv[1][0] === 'Ana Souza', 'CSV com ; e aspas lido');
  const simp = await sdr.importar(linhasCsv, 'teste');
  ok(simp.novos === 2 && simp.repetidos === 1 && simp.semTelefone === 1, `importação: 2 novos, 1 repetido, 1 sem telefone (${JSON.stringify(simp)})`);
  const semCab = await sdr.importar(planilha.lerCsv('Carla Dias,51 97777-1111\nDiego Lima,51 97777-2222'), 'sem cabeçalho');
  ok(semCab.novos === 2, 'lista colada sem cabeçalho: acha nome e telefone pelo conteúdo');
  const sc1 = await sdr.proximoContato(1);
  ok(sc1 && sc1.nome === 'Ana Souza' && sc1.telefone === '5551991112222' && sc1.telefone2 === '555133334444' && sc1.info['Endereço'] === 'Rua A, 10',
    'próximo da lista: primeiro da planilha, celular como principal e colunas extras');
  const sc2 = await sdr.proximoContato(2);
  ok(sc2 && sc2.id !== sc1.id, 'contato reservado não vai para outro SDR ao mesmo tempo');
  await sdr.registrarLigacao({ contato: sc1, usuarioId: 1, resultado: 'nao_atendeu' });
  ok((await sdr.getContato(sc1.id)).tentativas === 1, 'não atendeu: conta a tentativa');
  const sc3 = await sdr.proximoContato(1);
  ok(sc3 && sc3.id !== sc1.id, 'quem não atendeu não volta na hora');
  await sdr.registrarLigacao({ contato: sc3, usuarioId: 1, resultado: 'retornar', retornarEm: new Date(Date.now() - 60000) });
  const sc4 = await sdr.proximoContato(1);
  ok(sc4 && sc4.id === sc3.id, 'retorno agendado que venceu vem primeiro');
  ok(sdr.classificar({ interesse: 'Sim', prazo: 'Imediato', faixa: 'Até R$ 250 mil' }) === 'quente'
    && sdr.classificar({ interesse: 'Sim', prazo: 'Imediato', faixa: 'A definir' }) === 'morno'
    && sdr.classificar({ interesse: 'Talvez, dependendo da oportunidade', prazo: 'De 3 a 6 meses' }) === 'morno'
    && sdr.classificar({ interesse: 'Não' }) === 'frio', 'classificação quente / morno / frio');
  const sfl = sdr.fichaLimpa({ interesse: 'Sim', faixa: 'inventado', obs: ' ok ', autorizou: true });
  ok(sfl.interesse === 'Sim' && !sfl.faixa && sfl.obs === 'ok' && sfl.autorizou, 'ficha só aceita as opções da lista');
  const spl = await sdr.filaPlantao();
  ok(spl.length === 9, 'plantão começa com as equipes do Fabrício e do Alberto (' + spl.length + ')');
  await sdr.atribuirPlantao(spl[0].id);
  ok((await sdr.filaPlantao())[0].id === spl[1].id, 'depois de receber, vai para o fim da fila');
  const novoP = await sdr.salvarPlantao({ nome: 'Novo Corretor', telefone: '51 96666-0000' });
  ok(novoP.atribuicoes === 0 && (await sdr.filaPlantao()).some(p => p.id === novoP.id), 'novo no plantão entra no nível dos outros');
  const envSdr = await db.registrarEncaminhamento({ usuario_id: 7, corretor_fone: spl[0].telefone, corretor_nome: spl[0].nome, fonte: 'sdr', lead_nome: 'Ana Souza', lead_telefone: sc1.telefone, token: 'Sd' + 'z'.repeat(18) });
  ok(envSdr.fonte === 'sdr', 'envio do SDR marcado');
  ok(!(await db.enviosSemConfirmacao(0)).some(x => x.id === envSdr.id), 'envio do SDR não aparece na cobrança da recepção');
  ok((await sdr.pendenciasSdr(7, 0)).some(x => x.id === envSdr.id), 'aparece na cobrança do próprio SDR');
  await sdr.registrarLigacao({ contato: sc1, usuarioId: 7, resultado: 'qualificado', ficha: sfl, encaminhamentoId: envSdr.id });
  ok((await sdr.getContato(sc1.id)).status === 'enviado', 'qualificado: contato marcado como enviado');
  const slg = await sdr.ligacoesPeriodo(new Date(0), new Date(Date.now() + 60000));
  const srs = sdr.resumoLigacoes(slg);
  ok(srs.ligacoes === 3 && srs.qualificados === 1 && srs.quente + srs.morno === 1 && srs.atendidas === 2, 'números das ligações: ' + JSON.stringify(srs));
  ok((await db.eventosDoLead({ telefone: sc1.telefone })).some(e => e.tipo === 'sdr_ligacao'), 'ligação entra na auditoria');
  ok((await sdr.buscarContatos('bruno')).length === 1 && (await sdr.buscarContatos('97777')).length === 2, 'busca por nome e telefone');

  console.log(falhas ? `\n${falhas} teste(s) falharam.\n` : '\nTodos os testes passaram.\n');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('\nErro no teste:', e); process.exit(1); });
