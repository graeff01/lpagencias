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
  var area = function (r) { return D.escala ? ((r[2] - r[0]) / D.escala) * ((r[3] - r[1]) / D.escala) : 0; };
  var chips = function (l) { return (l && l.length) ? '<div class="pi-chips">' + l.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : ''; };
  var fotov = q('[data-fotov]'), fotovImg = q('[data-fotov-img]'), fotovLeg = q('[data-fotov-leg]');
  // A foto do decorado abre por cima da planta, pelo botão na barra da planta (o card mantém sempre o mesmo tamanho).
  var btFoto = q('[data-vfoto]'), fotoAtual = null;
  function foto(u, leg) { fotoAtual = u ? { u: u, leg: leg } : null; btFoto.hidden = !u; return ''; }
  btFoto.addEventListener('click', function () { if (fotoAtual) { parar(); abrirFoto(fotoAtual.u, fotoAtual.leg); } });
  function abrirFoto(u, leg) { fotovImg.src = u; fotovLeg.textContent = leg || ''; fotovLeg.hidden = !leg; fotov.classList.add('on'); fotov.setAttribute('aria-hidden', 'false'); }
  function fecharFoto() { fotov.classList.remove('on'); fotov.setAttribute('aria-hidden', 'true'); }
  q('[data-fotov-fechar]').addEventListener('click', fecharFoto);
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
    var tot = tipo.comodos.reduce(function (s, c) { return s + area(c.r); }, 0);
    ficha.innerHTML = '<span class="n">' + esc((tipo.titulo.match(/\d/) || [''])[0]) + '</span><span class="k">Planta</span><h3>' + esc(tipo.titulo) + '</h3>' +
      (tot ? '<div class="ar"><b>≈ ' + Math.round(tot) + '</b><span>m² de área interna</span></div>' : '') +
      (tipo.resumo ? '<p>' + esc(tipo.resumo) + '</p>' : '') + chips(tipo.chips) + foto(tipo.foto, tipo.fotoLeg) +
      (tipo.comodos.length ? '<div class="pi-nav"><button type="button" data-ini>▶ Fazer o tour guiado</button></div>' : '');
    var b = ficha.querySelector('[data-ini]'); if (b) b.addEventListener('click', iniciarTour);
    animar();
  }

  function abrir(i) {
    var c = tipo.comodos[i]; atual = i; rotulo.classList.remove('on'); fecharFoto();
    mundo.classList.add('zoom');
    mapa.querySelectorAll('.pi-cm').forEach(function (el, j) { el.classList.toggle('ativo', j === i); });
    lista.querySelectorAll('button').forEach(function (el, j) { el.classList.toggle('ativo', j === i); });
    zoomPara(c.r); btVoltar.hidden = false; dica.style.opacity = 0;
    var a = area(c.r), med = D.escala ? fmt((c.r[2] - c.r[0]) / D.escala) + ' × ' + fmt((c.r[3] - c.r[1]) / D.escala) + ' m' : '';
    ficha.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="k">Ambiente ' + (i + 1) + ' de ' + tipo.comodos.length + '</span><h3>' + esc(c.nome) + '</h3>' +
      (a ? '<div class="ar"><b>≈ ' + fmt(a) + '</b><span>m² · ' + med + '</span></div>' : '') +
      (c.txt ? '<p>' + esc(c.txt) + '</p>' : '') + chips(c.chips) + foto(c.foto, c.fotoLeg) +
      '<div class="pi-nav"><button type="button" data-p="-1">← Anterior</button><button type="button" data-p="1">Próximo →</button></div>';
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
    parar(); btTour.textContent = '❚❚ Pausar tour';
    var i = 0; abrir(0);
    timer = setInterval(function () { i++; if (i >= tipo.comodos.length) { voltar(); return; } abrir(i); }, 4200);
  }
  function parar() { if (timer) clearInterval(timer); timer = null; btTour.textContent = '▶ Tour guiado'; }

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
      tipo = D.tipos[+b.getAttribute('data-tipo')];
      img.style.opacity = 0;
      setTimeout(function () {
        img.onload = function () { img.style.opacity = 1; centralizar(); };
        img.width = tipo.w; img.height = tipo.h; img.alt = 'Planta humanizada — ' + tipo.titulo; img.src = tipo.imagem;
        montar(); centralizar();
      }, 200);
    });
  });
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
