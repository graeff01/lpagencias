// Planta interativa: cômodos clicáveis com zoom, ficha de cada ambiente e tour guiado.
(function () {
  var raiz = document.querySelector('[data-pi]');
  var dadosEl = document.querySelector('[data-pi-dados]');
  if (!raiz || !dadosEl) return;
  var D; try { D = JSON.parse(dadosEl.textContent); } catch (e) { return; }
  var NS = 'http://www.w3.org/2000/svg';
  var q = function (s) { return raiz.querySelector(s); };
  var quadro = q('[data-quadro]'), mundo = q('[data-mundo]'), img = q('[data-img]'), mapa = q('[data-mapa]');
  var ficha = q('[data-ficha]'), rotulo = q('[data-rotulo]'), btTour = q('[data-tour]'), btVoltar = q('[data-voltar]');
  var dica = q('[data-dica]'), dicaTxt = q('[data-dica-txt]'), lista = q('[data-lista]');
  var tipo = D.tipos[0], atual = null, timer = null;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
  var esc1 = function () { return Number(tipo.escala) || D.escala; };
  var area = function (r) { return esc1() ? ((r[2] - r[0]) / esc1()) * ((r[3] - r[1]) / esc1()) : 0; };
  var chips = function (l) { return (l && l.length) ? '<div class="pi-chips">' + l.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : ''; };
  var fotov = q('[data-fotov]'), fotovImg = q('[data-fotov-img]'), fotovLeg = q('[data-fotov-leg]');
  // A foto do decorado abre por cima da planta, pelo botão na barra da planta (o card mantém sempre o mesmo tamanho).
  var btFoto = q('[data-vfoto]'), fotoAtual = null;
  function foto(u, leg) { fotoAtual = u ? { u: u, leg: leg } : null; btFoto.hidden = !u; return ''; }
  btFoto.addEventListener('click', function () { if (fotoAtual) { parar(); marcar('foto', true); abrirFoto(fotoAtual.u, fotoAtual.leg); } });
  function abrirFoto(u, leg) { fotovImg.src = u; fotovLeg.textContent = leg || ''; fotovLeg.hidden = !leg; fotov.classList.add('on'); fotov.setAttribute('aria-hidden', 'false'); }
  function fecharFoto() { fotov.classList.remove('on'); fotov.setAttribute('aria-hidden', 'true'); }
  q('[data-fotov-fechar]').addEventListener('click', fecharFoto);
  // ---- O que o cliente explorou (vai junto para o corretor quando ele chama no WhatsApp) ----
  var WA = raiz.getAttribute('data-wa') || '', EMP = raiz.getAttribute('data-emp') || '';
  var CHAVE = 'ap_pi:' + location.pathname, emTour = false;
  var R = (function () { try { return JSON.parse(sessionStorage.getItem(CHAVE)) || {}; } catch (e) { return {}; } })();
  R.tipos = R.tipos || {}; R.comodos = R.comodos || [];
  function salvar() { try { sessionStorage.setItem(CHAVE, JSON.stringify(R)); } catch (e) {} }
  function marcar(k, v) { R[k] = v; salvar(); }
  function viuTipo(t) { R.tipos[t] = (R.tipos[t] || 0) + 1; salvar(); }
  function viuComodo(t, c) {
    var n = c + ' (' + t + ')';
    R.comodos = R.comodos.filter(function (x) { return x !== n; }); R.comodos.push(n); R.comodos = R.comodos.slice(-8); salvar();
  }
  function resumo() {
    var p = [], ts = Object.keys(R.tipos).sort(function (a, b) { return R.tipos[b] - R.tipos[a]; });
    if (ts.length) p.push('Plantas: ' + ts.map(function (t) { return t + (R.tipos[t] > 1 ? ' (' + R.tipos[t] + 'x)' : ''); }).join(', '));
    if (R.comodos.length) p.push('Cômodos: ' + R.comodos.join(', '));
    if (R.tour) p.push('fez o tour guiado');
    if (R.foto) p.push('viu a foto do decorado');
    if (R.comparou) p.push('comparou as plantas');
    if (R.quer) p.push('clicou em "Quero esta planta" (' + R.quer + ')');
    return p.join(' · ').slice(0, 400);
  }
  // Roda antes do formulário de contato (captura na window): o link do WhatsApp leva o resumo.
  window.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="/wa/"]'); if (!a) return;
    if (a.hasAttribute('data-quero')) { R.quer = a.getAttribute('data-quero'); salvar(); }
    var r = resumo(); if (!r) return;
    var u = new URL(a.getAttribute('href'), location.origin); u.searchParams.set('vi', r);
    a.setAttribute('href', u.origin === location.origin ? u.pathname + u.search : u.href);
  }, true);
  var icoWa = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z"/></svg>';
  function linkQuero(t) {
    if (!WA) return '';
    var u = new URL(WA, location.origin);
    u.searchParams.set('src', 'planta');
    u.searchParams.set('msg', 'Olá! Tenho interesse na planta ' + t.titulo + (EMP ? ' do ' + EMP : '') + '. Pode me passar valores e condições?');
    var utm = window.__utm || {}; Object.keys(utm).forEach(function (k) { if (!u.searchParams.has(k)) u.searchParams.set(k, utm[k]); });
    return u.pathname + u.search;
  }
  function botaoQuero(t, cls) {
    var h = linkQuero(t); if (!h) return '';
    return '<a class="pi-quero' + (cls ? ' ' + cls : '') + '" href="' + esc(h) + '" target="_blank" rel="noopener nofollow" data-quero="' + esc(t.titulo) + '">' + icoWa + 'Quero esta planta</a>';
  }
  // Conversão (os links criados depois do carregamento não passam pelo rastreio da página).
  raiz.addEventListener('click', function (e) {
    var a = e.target.closest('[data-quero]'); if (!a) return;
    if (window.gtag) { gtag('event', 'contato_whatsapp', { empreendimento: EMP, botao: 'planta' }); if (window.ADS_CONV) gtag('event', 'conversion', { send_to: window.ADS_CONV }); }
    if (window.fbq) fbq('track', 'Contact', { content_name: EMP, source: 'planta' });
  });

  function animar() {
    ficha.classList.remove('pi-entra'); void ficha.offsetWidth; ficha.classList.add('pi-entra');
  }

  function centralizar() {
    var H = quadro.offsetHeight, h = mundo.offsetHeight;
    mundo.style.transform = 'translate(0px,' + Math.max(0, (H - h) / 2) + 'px) scale(1)';
  }
  function zoomPara(r) {
    var W = mundo.offsetWidth, H = quadro.offsetHeight, k = W / tipo.w;
    var x1 = r[0] * k, y1 = r[1] * k, x2 = r[2] * k, y2 = r[3] * k;
    var s = Math.min(2.6, (W * 0.78) / (x2 - x1), (H * 0.78) / (y2 - y1));
    mundo.style.transform = 'translate(' + (W / 2 - (x1 + x2) / 2 * s) + 'px,' + (H / 2 - (y1 + y2) / 2 * s) + 'px) scale(' + s + ')';
  }

  function fichaGeral() {
    var tot = tipo.comodos.reduce(function (s, c) { return s + (/garden/i.test(c.nome) ? 0 : area(c.r)); }, 0);
    ficha.innerHTML = '<span class="n">' + esc((tipo.titulo.match(/\d/) || [''])[0]) + '</span><span class="k">Planta</span><h3>' + esc(tipo.titulo) + '</h3>' +
      (tot ? '<div class="ar"><b>≈ ' + Math.round(tot) + '</b><span>m² de área interna</span></div>' : '') +
      (tipo.resumo ? '<p>' + esc(tipo.resumo) + '</p>' : '') + chips(tipo.chips) + foto(tipo.foto, tipo.fotoLeg) +
      '<div class="pi-nav">' + (tipo.comodos.length ? '<button type="button" data-ini>▶ Tour guiado</button>' : '') + botaoQuero(tipo) + '</div>';
    var b = ficha.querySelector('[data-ini]'); if (b) b.addEventListener('click', iniciarTour);
    animar();
  }

  function abrir(i) {
    var c = tipo.comodos[i]; atual = i; rotulo.classList.remove('on'); fecharFoto();
    if (!emTour) viuComodo(tipo.titulo, c.nome);
    mundo.classList.add('zoom');
    mapa.querySelectorAll('.pi-cm').forEach(function (el, j) { el.classList.toggle('ativo', j === i); });
    lista.querySelectorAll('button').forEach(function (el, j) { el.classList.toggle('ativo', j === i); });
    zoomPara(c.r); btVoltar.hidden = false; dica.style.opacity = 0;
    var a = area(c.r), med = esc1() ? fmt((c.r[2] - c.r[0]) / esc1()) + ' × ' + fmt((c.r[3] - c.r[1]) / esc1()) + ' m' : '';
    ficha.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="k">Ambiente ' + (i + 1) + ' de ' + tipo.comodos.length + '</span><h3>' + esc(c.nome) + '</h3>' +
      (a ? '<div class="ar"><b>≈ ' + fmt(a) + '</b><span>m² · ' + med + '</span></div>' : '') +
      (c.txt ? '<p>' + esc(c.txt) + '</p>' : '') + chips(c.chips) + foto(c.foto, c.fotoLeg) +
      '<div class="pi-nav pi-nav2">' + botaoQuero(tipo, 'cheio') + '<button type="button" data-p="-1">← Anterior</button><button type="button" data-p="1">Próximo →</button></div>';
    ficha.querySelectorAll('[data-p]').forEach(function (b) { b.addEventListener('click', function () { parar(); passo(+b.getAttribute('data-p')); }); });
    animar();
  }
  function passo(n) { var t = tipo.comodos.length; abrir(((atual == null ? -1 : atual) + n + t) % t); }
  function voltar() {
    atual = null; parar(); fecharFoto(); mundo.classList.remove('zoom');
    mapa.querySelectorAll('.pi-cm').forEach(function (el) { el.classList.remove('ativo'); });
    lista.querySelectorAll('button').forEach(function (el) { el.classList.remove('ativo'); });
    centralizar(); btVoltar.hidden = true; dica.style.opacity = 1; fichaGeral();
  }
  function iniciarTour() {
    parar(); btTour.textContent = '❚❚ Pausar tour'; marcar('tour', true); emTour = true;
    var i = 0; abrir(0);
    timer = setInterval(function () { i++; if (i >= tipo.comodos.length) { voltar(); return; } abrir(i); }, 4200);
  }
  function parar() { if (timer) clearInterval(timer); timer = null; emTour = false; btTour.textContent = '▶ Tour guiado'; }

  function montar() {
    mapa.setAttribute('viewBox', '0 0 ' + tipo.w + ' ' + tipo.h);
    mapa.innerHTML = ''; lista.innerHTML = '';
    tipo.comodos.forEach(function (c, i) {
      var r = c.r, el = document.createElementNS(NS, 'rect');
      [['x', r[0]], ['y', r[1]], ['width', r[2] - r[0]], ['height', r[3] - r[1]], ['rx', 6]].forEach(function (a) { el.setAttribute(a[0], a[1]); });
      el.setAttribute('class', 'pi-cm'); el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', c.nome);
      el.addEventListener('click', function () { parar(); abrir(i); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); parar(); abrir(i); } });
      el.addEventListener('mousemove', function (e) {
        if (atual != null) return;
        var b = quadro.getBoundingClientRect(), a = area(r);
        rotulo.textContent = c.nome + (a ? ' · ' + fmt(a) + ' m²' : '');
        rotulo.style.left = (e.clientX - b.left) + 'px'; rotulo.style.top = (e.clientY - b.top) + 'px'; rotulo.classList.add('on');
      });
      el.addEventListener('mouseleave', function () { rotulo.classList.remove('on'); });
      mapa.appendChild(el);
      var g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'pi-pino');
      var cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, raio = Math.max(14, tipo.w / 75);
      g.innerHTML = '<circle cx="' + cx + '" cy="' + cy + '" r="' + raio + '"/><text x="' + cx + '" y="' + (cy + raio * 0.36) + '" text-anchor="middle" style="font-size:' + raio + 'px">' + (i + 1) + '</text>';
      mapa.appendChild(g);
      var b = document.createElement('button'); b.type = 'button'; b.textContent = c.nome;
      b.addEventListener('click', function () { parar(); abrir(i); quadro.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      lista.appendChild(b);
    });
    fecharFoto();
    var tem = tipo.comodos.length > 0;
    btTour.hidden = !tem; lista.hidden = !tem;
    dicaTxt.textContent = tem ? 'Toque em um cômodo' : 'Planta ' + tipo.titulo;
    quadro.style.aspectRatio = tipo.w + ' / ' + Math.max(tipo.h, Math.round(tipo.w * 0.6));
    atual = null; mundo.classList.remove('zoom'); btVoltar.hidden = true; dica.style.opacity = 1;
    fichaGeral();
  }

  raiz.querySelectorAll('[data-tipo]').forEach(function (b) {
    b.addEventListener('click', function () {
      parar();
      raiz.querySelectorAll('[data-tipo]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      tipo = D.tipos[+b.getAttribute('data-tipo')]; viuTipo(tipo.titulo);
      img.style.opacity = 0;
      setTimeout(function () {
        img.onload = function () { img.style.opacity = 1; centralizar(); };
        img.width = tipo.w; img.height = tipo.h; img.alt = 'Planta humanizada — ' + tipo.titulo; img.src = tipo.imagem;
        montar(); centralizar();
      }, 200);
    });
  });
  // ---- Comparar plantas lado a lado ----
  var btComp = raiz.querySelector('[data-comparar]');
  if (btComp) {
    var cmp = document.createElement('div'); cmp.className = 'pi-cmp'; cmp.hidden = true;
    cmp.setAttribute('role', 'dialog'); cmp.setAttribute('aria-modal', 'true'); cmp.setAttribute('aria-label', 'Comparar plantas');
    document.body.appendChild(cmp);
    var medir = function (t) {
      var e = Number(t.escala) || D.escala, a = function (r) { return e ? ((r[2] - r[0]) / e) * ((r[3] - r[1]) / e) : 0; };
      var cs = t.comodos || [], m = function (re) { return cs.filter(function (c) { return re.test(c.nome); }); };
      var gd = m(/garden/i);
      return {
        area: Math.round(cs.reduce(function (s, c) { return s + (/garden/i.test(c.nome) ? 0 : a(c.r)); }, 0)),
        dorms: m(/^(dormit|su[ií]te$)/i).length || (t.titulo.match(/(\d)\s*dorm/i) || [])[1] || '—',
        banhos: m(/banheiro/i).length || '—',
        garden: gd.length ? '≈ ' + Math.round(gd.reduce(function (s, c) { return s + a(c.r); }, 0)) + ' m²' : '—',
        sacada: m(/sacada/i).length ? 'Com churrasqueira' : '—',
      };
    };
    var abrirComp = function () {
      parar(); marcar('comparou', true);
      var linhas = [['Área interna', function (x) { return x.area ? '≈ ' + x.area + ' m²' : '—'; }], ['Dormitórios', function (x) { return x.dorms; }],
        ['Banheiros', function (x) { return x.banhos; }], ['Sacada', function (x) { return x.sacada; }], ['Garden privativo', function (x) { return x.garden; }]];
      var ms = D.tipos.map(medir);
      cmp.innerHTML = '<div class="pi-cmp-box"><button type="button" class="pi-cmp-x" aria-label="Fechar">×</button>' +
        '<span class="k">Comparar plantas</span><h3>Qual combina com você?</h3><div class="pi-cmp-grade" style="--n:' + D.tipos.length + '">' +
        D.tipos.map(function (t, i) {
          return '<div class="col"><div class="th"><img src="' + esc(t.imagem) + '" alt="" loading="lazy"></div><b class="tt">' + esc(t.titulo) + '</b>' +
            linhas.map(function (l) { return '<div class="ln"><span>' + l[0] + '</span><b>' + esc(l[1](ms[i])) + '</b></div>'; }).join('') +
            '<button type="button" class="ex" data-ver="' + i + '">Explorar a planta</button>' + botaoQuero(t, 'cheio') + '</div>';
        }).join('') + '</div><p class="nota">Medidas aproximadas, calculadas a partir das plantas humanizadas.</p></div>';
      cmp.hidden = false; document.documentElement.style.overflow = 'hidden';
      cmp.querySelector('.pi-cmp-x').focus();
    };
    var fecharComp = function () { cmp.hidden = true; document.documentElement.style.overflow = ''; };
    btComp.addEventListener('click', abrirComp);
    cmp.addEventListener('click', function (e) {
      if (e.target === cmp || e.target.closest('.pi-cmp-x')) return fecharComp();
      var v = e.target.closest('[data-ver]');
      if (v) { fecharComp(); var b = raiz.querySelector('[data-tipo="' + v.getAttribute('data-ver') + '"]'); if (b) b.click(); quadro.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      var qq = e.target.closest('[data-quero]');
      if (qq) {
        if (window.gtag) gtag('event', 'contato_whatsapp', { empreendimento: EMP, botao: 'comparar-plantas' });
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !cmp.hidden) fecharComp(); });
  }

  btTour.addEventListener('click', function () { timer ? parar() : iniciarTour(); });
  btVoltar.addEventListener('click', voltar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && fotov.classList.contains('on')) { fecharFoto(); return; }
    if (atual == null) return;
    if (e.key === 'Escape') voltar();
    else if (e.key === 'ArrowRight') { parar(); passo(1); }
    else if (e.key === 'ArrowLeft') { parar(); passo(-1); }
  });
  window.addEventListener('resize', function () { atual != null ? zoomPara(tipo.comodos[atual].r) : centralizar(); });
  montar();
  img.complete ? centralizar() : img.addEventListener('load', centralizar, { once: true });
})();
