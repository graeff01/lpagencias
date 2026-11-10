// Simulador "Cabe no seu bolso?" da landing.
// As regras (juros, faixas do MCMV, tetos) vêm do servidor (lib/financiamento.js)
// no <script id="simCfg">. Tudo é recalculado a cada movimento, sem ir ao servidor.
(function () {
  var cfgEl = document.getElementById('simCfg'); if (!cfgEl) return;
  var C; try { C = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  var R = C.regras, $ = function (id) { return document.getElementById(id); };
  var CALMO = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  var num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  function curto(v) {
    if (v >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
    if (v >= 1e4) return 'R$ ' + num.format(Math.round(v / 1000)) + ' mil';
    return brl.format(v);
  }

  // ---------- Matemática do financiamento ----------
  function mensal(aa) { return Math.pow(1 + aa, 1 / 12) - 1; }
  function parcela(pv, i, n, tabela) {           // 1ª parcela (SAC) ou parcela fixa (PRICE)
    if (pv <= 0) return 0;
    return tabela === 'SAC' ? pv / n + pv * i : pv * i / (1 - Math.pow(1 + i, -n));
  }
  function pvMax(pm, i, n, tabela) {              // quanto dá para financiar com essa parcela
    if (pm <= 0) return 0;
    return tabela === 'SAC' ? pm / (1 / n + i) : pm * (1 - Math.pow(1 + i, -n)) / i;
  }
  function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

  // Faixa do Minha Casa Minha Vida pela renda (null acima da última faixa).
  function faixaMcmv(renda) {
    var ant = 0;
    for (var k = 0; k < R.mcmv.length; k++) {
      var f = R.mcmv[k];
      if (renda <= f.rendaMax) {
        var t = (renda - ant) / (f.rendaMax - ant);
        return { faixa: f.faixa, juros: lerp(f.juros[0], f.juros[1], t), subsidio: Math.round(lerp(f.subsidio[0], f.subsidio[1], t) / 500) * 500,
                 teto: f.teto, cota: f.cota, tabela: 'PRICE', nome: 'Minha Casa Minha Vida · Faixa ' + f.faixa };
      }
      ant = f.rendaMax;
    }
    return null;
  }
  function sbpe() { return { faixa: 0, juros: R.sbpe.juros, subsidio: 0, teto: Infinity, cota: R.sbpe.cota, tabela: R.sbpe.tabela, nome: R.sbpe.nome }; }

  // Maior imóvel que a pessoa consegue comprar num programa.
  function poderNo(p, s) {
    var n = s.prazo * 12, i = mensal(p.juros);
    var pm = s.renda * R.comprometimento / (1 + R.margemSeguros);
    var rec = s.entrada + s.fgts + p.subsidio;
    var pelaRenda = pvMax(pm, i, n, p.tabela) + rec;
    var pelaEntrada = rec / (1 - p.cota);
    var x = Math.min(pelaRenda, pelaEntrada, p.teto);
    return { valor: Math.max(0, x), limite: pelaRenda <= pelaEntrada ? 'renda' : 'entrada', prog: p };
  }

  function calcular(s) {
    var mc = faixaMcmv(s.renda), sb = sbpe();
    var pMc = mc ? poderNo(mc, s) : null, pSb = poderNo(sb, s);
    var poder = pMc && pMc.valor >= pSb.valor ? pMc : pSb;
    var out = { poder: poder, parcelaMax: s.renda * R.comprometimento };
    if (!s.preco) return out;

    // Unidade escolhida: MCMV quando a renda e o valor do imóvel cabem na faixa.
    var prog = mc && s.preco <= mc.teto ? mc : sb;
    var n = s.prazo * 12, i = mensal(prog.juros);
    var rec = s.entrada + s.fgts + prog.subsidio;
    var precisa = Math.max(0, s.preco - rec);
    var teto = prog.cota * s.preco;
    var fin = Math.min(precisa, teto);
    var faltaEntrada = Math.max(0, precisa - teto);
    var parc = parcela(fin, i, n, prog.tabela) * (1 + R.margemSeguros);
    var pct = s.renda ? parc / s.renda : 1;
    // Quanto a mais de entrada faz a parcela caber nos 30%.
    var finCabe = pvMax(out.parcelaMax / (1 + R.margemSeguros), i, n, prog.tabela);
    out.unid = {
      prog: prog, preco: s.preco, parcela: parc, pct: pct, fin: fin, faltaEntrada: faltaEntrada,
      subsidio: Math.min(prog.subsidio, s.preco), entrada: Math.min(s.entrada, s.preco), fgts: Math.min(s.fgts, Math.max(0, s.preco - s.entrada)),
      cabe: pct <= R.comprometimento + 1e-9 && faltaEntrada === 0,
      maisEntrada: Math.max(0, fin - finCabe) + faltaEntrada,
      rendaNecessaria: parc / R.comprometimento,
    };
    return out;
  }

  // ---------- Controles ----------
  var els = {
    renda: $('simRenda'), rendaTx: $('simRendaTx'), ent: $('simEnt'), entTx: $('simEntTx'),
    temF: $('simTemFgts'), fBox: $('simFgtsBox'), f: $('simFgts'), fTx: $('simFgtsTx'),
    preco: $('simPreco'), precoTx: $('simPrecoTx'), prazo: $('simPrazo'),
  };
  var prazo = R.prazoPadrao;
  function digitos(v) { return parseInt(String(v).replace(/\D/g, ''), 10) || 0; }
  function pintaRange(r) { if (!r) return; var p = (r.value - r.min) / (r.max - r.min) * 100; r.style.setProperty('--p', p + '%'); }
  function liga(range, tx) {
    range.addEventListener('input', function () { tx.value = num.format(+range.value); pintaRange(range); atualizar(true); });
    tx.addEventListener('input', function () {
      var v = digitos(tx.value);
      var pos = tx.value.length - tx.selectionStart;
      tx.value = v ? num.format(v) : '';
      try { tx.setSelectionRange(tx.value.length - pos, tx.value.length - pos); } catch (e) {}
      if (v > +range.max) range.max = Math.ceil(v * 1.2 / 1000) * 1000;   // valor digitado maior que a régua
      range.value = v; pintaRange(range); atualizar(true);
    });
    tx.addEventListener('focus', function () { setTimeout(function () { tx.select(); }, 0); });
    pintaRange(range);
  }
  liga(els.renda, els.rendaTx); liga(els.ent, els.entTx); liga(els.f, els.fTx);
  if (els.preco) {
    els.preco.addEventListener('input', function () { pintaRange(els.preco); atualizar(true); });
    pintaRange(els.preco);
  }
  document.querySelectorAll('#simRendaAj button').forEach(function (b) {
    b.addEventListener('click', function () { els.renda.value = b.dataset.v; els.rendaTx.value = num.format(+b.dataset.v); pintaRange(els.renda); atualizar(true); });
  });
  els.temF.addEventListener('change', function () { els.fBox.hidden = !els.temF.checked; atualizar(true); });
  els.prazo.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    prazo = +b.dataset.a;
    els.prazo.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
    atualizar(true);
  });

  function estado() {
    return {
      renda: digitos(els.rendaTx.value), entrada: digitos(els.entTx.value),
      fgts: els.temF.checked ? digitos(els.fTx.value) : 0, prazo: prazo,
      preco: els.preco ? +els.preco.value : (C.precoMin || 0),
    };
  }

  // ---------- Números que rolam até o valor novo ----------
  var anim = {};
  function rola(el, alvo, fmt) {
    var k = el.id, de = anim[k] ? anim[k].v : alvo;
    if (anim[k] && anim[k].raf) cancelAnimationFrame(anim[k].raf);
    if (CALMO || de === alvo) { anim[k] = { v: alvo }; el.textContent = fmt(alvo); return; }
    var t0 = performance.now(), dur = 520;
    anim[k] = { v: de };
    (function passo(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var v = de + (alvo - de) * e; anim[k].v = v; el.textContent = fmt(v);
      if (p < 1) anim[k].raf = requestAnimationFrame(passo); else anim[k].v = alvo;
    })(t0);
  }

  // ---------- Desenho do resultado ----------
  var res = $('simRes'), CIRC = 2 * Math.PI * 50, ARCO = .75;   // medidor de 270°
  var gV = $('simGaugeV'), gL = $('simGaugeLim');
  gV.style.strokeDasharray = '0 ' + CIRC;
  // marca dos 30% no arco
  gL.style.strokeDasharray = '1.6 ' + CIRC; gL.style.strokeDashoffset = -(CIRC * ARCO * Math.min(1, R.comprometimento / .6)) + .8;

  function medidor(pct) {
    var f = Math.min(1, pct / .6);   // o arco cheio representa 60% da renda
    gV.style.strokeDasharray = (CIRC * ARCO * f) + ' ' + CIRC;
    res.classList.toggle('acima', pct > R.comprometimento + 1e-9);
    $('simGauge').setAttribute('aria-label', 'A parcela usa ' + Math.round(pct * 100) + '% da renda; o limite dos bancos é ' + Math.round(R.comprometimento * 100) + '%.');
  }

  function composicao(u) {
    var partes = [
      ['ent', 'Entrada', u.entrada], ['fgts', 'FGTS', u.fgts], ['sub', 'Subsídio MCMV', u.subsidio],
      ['fin', 'Financiado', u.fin], ['falta', 'Falta de entrada', u.faltaEntrada],
    ].filter(function (p) { return p[2] > 0; });
    var total = partes.reduce(function (a, p) { return a + p[2]; }, 0) || 1;
    var barra = $('simBarra'), leg = $('simLeg');
    // reaproveita os segmentos para a largura animar em vez de piscar
    var atuais = {}; [].forEach.call(barra.children, function (s) { atuais[s.dataset.k] = s; });
    var vistos = {};
    partes.forEach(function (p) {
      var s = atuais[p[0]];
      if (!s) { s = document.createElement('i'); s.dataset.k = p[0]; s.className = 'sc-' + p[0]; s.style.flexBasis = '0%'; barra.appendChild(s); }
      barra.appendChild(s); vistos[p[0]] = 1;
      requestAnimationFrame(function () { s.style.flexBasis = (p[2] / total * 100) + '%'; });
    });
    Object.keys(atuais).forEach(function (k) { if (!vistos[k]) atuais[k].remove(); });
    leg.innerHTML = partes.map(function (p) { return '<li class="sc-' + p[0] + '"><i></i><span>' + p[1] + '</span><b>' + curto(p[2]) + '</b></li>'; }).join('');
    $('simComp').hidden = false;
  }

  function trilho(poder, u) {
    var faixa = $('simFaixa'), voce = $('simVoce');
    var pMin = C.precoMin, pMax = C.precoMax || C.precoMin;
    var escala = Math.max(poder, pMax || 0) * 1.18 || 1;
    if (pMin) {
      faixa.hidden = false;
      var a = pMin / escala * 100, b = Math.max(pMax / escala * 100, a + 1.5);
      faixa.style.left = a + '%'; faixa.style.width = (b - a) + '%';
      faixa.classList.toggle('ok', poder >= pMin);
    }
    voce.style.left = Math.min(98, poder / escala * 100) + '%';
    voce.classList.toggle('dentro', !!pMin && poder >= pMin);
  }

  function veredito(o, s) {
    var u = o.unid, v = $('simVer');
    if (s.renda < 1000) { v.innerHTML = 'Informe a renda bruta da família para começar.'; v.className = 'sim-veredito'; return; }
    if (u) {
      if (u.cabe) {
        v.innerHTML = '<b>Cabe no seu bolso.</b> A parcela fica em ' + Math.round(u.pct * 100) + '% da renda, dentro do limite de ' + Math.round(R.comprometimento * 100) + '% que os bancos aceitam.';
        v.className = 'sim-veredito ok';
      } else {
        var dicas = [];
        if (u.maisEntrada > 0) dicas.push('com <b>' + curto(Math.ceil(u.maisEntrada / 1000) * 1000) + '</b> a mais de entrada' + (s.fgts ? '' : ' (o FGTS conta)'));
        if (u.faltaEntrada === 0) dicas.push('ou somando uma renda familiar de <b>' + curto(Math.ceil(u.rendaNecessaria / 100) * 100) + '</b>');
        if (prazo < R.prazos[R.prazos.length - 1]) dicas.push('ou num prazo maior');
        v.innerHTML = '<b>Está perto.</b> ' + (dicas.length ? 'Fecha ' + dicas.join(', ') + '. ' : '') + 'O consultor encontra a melhor combinação com você.';
        v.className = 'sim-veredito perto';
      }
      return;
    }
    var p = o.poder;
    v.innerHTML = p.valor < 50000
      ? '<b>Comece pela entrada.</b> Os bancos financiam até 80% do imóvel: o FGTS e o subsídio do Minha Casa Minha Vida ajudam a formar os outros 20%.'
      : '<b>Bom ponto de partida.</b> ' + (p.limite === 'entrada' ? 'Hoje é a entrada que define o teto; ' + (s.fgts ? 'cada real a mais de entrada' : 'o FGTS ou mais entrada') + ' aumenta seu poder de compra.' : 'Com essa renda, a parcela chega a ' + curto(o.parcelaMax) + ' por mês.') + ' O consultor mostra as unidades que cabem nesse valor.';
    v.className = 'sim-veredito ok';
  }

  var ultimo = null, mexeu = false;
  function atualizar(doUsuario) {
    var s = estado(), o = calcular(s); ultimo = { s: s, o: o };
    if (els.precoTx && els.preco) els.precoTx.textContent = num.format(s.preco);
    $('simProg').textContent = o.unid ? o.unid.prog.nome : o.poder.prog.nome;
    $('simProg').classList.toggle('mcmv', !!(o.unid ? o.unid.prog.faixa : o.poder.prog.faixa));
    rola($('simPoder'), o.poder.valor, curto);
    if (o.unid) {
      var u = o.unid;
      $('simRot').textContent = (u.prog.tabela === 'SAC' ? '1ª parcela estimada' : 'Parcela estimada');
      rola($('simValor'), u.parcela, function (v) { return brl.format(v); });
      $('simSub').innerHTML = 'por mês · unidade de ' + curto(u.preco) + ' · ' + prazo + ' anos';
      rola($('simPct'), u.pct * 100, function (v) { return Math.round(v) + '%'; });
      medidor(u.pct);
      composicao(u);
      $('simPillA').textContent = 'Parcela';
      $('simPillB').textContent = brl.format(Math.round(u.parcela)) + ' · ' + Math.round(u.pct * 100) + '%';
    } else {
      $('simRot').textContent = 'Você pode comprar um imóvel de até';
      rola($('simValor'), o.poder.valor, curto);
      $('simSub').innerHTML = 'com parcela de até ' + brl.format(Math.round(o.parcelaMax)) + ' por mês';
      $('simPct').textContent = Math.round(R.comprometimento * 100) + '%';
      medidor(R.comprometimento);
      res.classList.remove('acima');
      $('simPillA').textContent = 'Poder de compra';
      $('simPillB').textContent = curto(o.poder.valor);
    }
    trilho(o.poder.valor, o.unid);
    veredito(o, s);
    if (doUsuario) {
      if (!mexeu) { mexeu = true; if (window.__marca) window.__marca('simulador'); if (window.gtag) gtag('event', 'usou_simulador', { empreendimento: C.emp }); }
      guardar();
    }
  }

  // ---------- Resumo para o corretor (vai no WhatsApp) ----------
  function resumo() {
    if (!mexeu || !ultimo) return '';
    var s = ultimo.s, o = ultimo.o, p = ['Simulou: renda ' + brl.format(s.renda), 'entrada ' + brl.format(s.entrada)];
    if (s.fgts) p.push('FGTS ' + brl.format(s.fgts));
    p.push(s.prazo + ' anos');
    if (o.unid) p.push((o.unid.prog.faixa ? 'MCMV faixa ' + o.unid.prog.faixa : 'SBPE') + ', unidade de ' + curto(o.unid.preco) + ', parcela ~' + brl.format(Math.round(o.unid.parcela)) + ' (' + Math.round(o.unid.pct * 100) + '% da renda)');
    p.push('poder de compra ~' + curto(o.poder.valor));
    return p.join(', ');
  }
  window.__resumos = window.__resumos || {};
  window.__resumos.simulador = resumo;

  // Lembra a simulação desta visita (só neste navegador).
  function guardar() { try { sessionStorage.setItem('ap_sim', JSON.stringify({ r: digitos(els.rendaTx.value), e: digitos(els.entTx.value), f: els.temF.checked ? digitos(els.fTx.value) : null, a: prazo })); } catch (e) {} }
  try {
    var g = JSON.parse(sessionStorage.getItem('ap_sim') || 'null');
    if (g) {
      if (g.r) { els.renda.value = g.r; els.rendaTx.value = num.format(g.r); pintaRange(els.renda); }
      if (g.e != null) { els.ent.value = g.e; els.entTx.value = num.format(g.e); pintaRange(els.ent); }
      if (g.f != null) { els.temF.checked = true; els.fBox.hidden = false; els.f.value = g.f; els.fTx.value = num.format(g.f); pintaRange(els.f); }
      if (g.a) { prazo = g.a; els.prazo.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', +x.dataset.a === g.a ? 'true' : 'false'); }); }
      mexeu = true;
    }
  } catch (e) {}

  // Pílula fixa no celular: mostra o resultado enquanto o painel está fora da tela.
  var pill = $('simPill');
  if ('IntersectionObserver' in window) {
    var vis = { ctl: false, res: false };
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (x) { vis[x.target === res ? 'res' : 'ctl'] = x.isIntersecting; });
      pill.classList.toggle('on', vis.ctl && !vis.res);
    }, { threshold: [0, .25] });
    io.observe(res); io.observe($('simCtl'));
  }
  pill.addEventListener('click', function () { res.scrollIntoView({ behavior: CALMO ? 'auto' : 'smooth', block: 'center' }); });

  atualizar(false);
})();
