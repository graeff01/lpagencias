// "Quanto tempo até o seu dia a dia?": a pessoa digita onde trabalha ou
// estuda e vê a rota no mapa da landing, com o tempo de carro, bicicleta e a pé.
//  - endereços: Photon (OpenStreetMap, sem chave, feito para autocompletar)
//  - rotas: servidores OSRM da FOSSGIS (routing.openstreetmap.de), sem chave
// Os lugares ficam guardados neste navegador: abrindo outro empreendimento,
// os tempos já aparecem calculados a partir dele.
(function () {
  var box = document.getElementById('traj'); if (!box || !window.MAPA) return;
  var BASE = [MAPA.lon, MAPA.lat], EMP = MAPA.nome;
  var $ = function (id) { return document.getElementById(id); };
  var q = $('trajQ'), sug = $('trajSug'), lista = $('trajLista'), geo = $('trajGeo'), msg = $('trajMsg');
  var CALMO = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CORES = ['#F47B20', '#2F6FED', '#9B51E0'], MAX = 3, CHAVE = 'ap_destinos';
  var TIPOS = { trabalho: ['💼', 'Trabalho'], estudo: ['🎓', 'Faculdade'], escola: ['🎒', 'Escola'], familia: ['❤️', 'Família'], outro: ['📍', 'Outro lugar'] };
  var tipo = 'trabalho', destinos = [], foco = -1, usou = false;

  // ---------- Formatação ----------
  function tempo(seg) {
    var m = Math.max(1, Math.round(seg / 60));
    if (m < 60) return { n: String(m), u: 'min', t: m + ' min' };
    var h = Math.floor(m / 60), r = m % 60;
    return { n: h + 'h' + (r ? (r < 10 ? '0' : '') + r : ''), u: '', t: h + 'h' + (r ? (r < 10 ? '0' : '') + r : '') };
  }
  function km(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rotulo(p) {
    var rua = [p.street, p.housenumber].filter(Boolean).join(', ');
    var nome = p.name || rua || p.district || p.city || 'Local';
    var linha = [p.name && rua && rua !== p.name ? rua : '', p.district && p.district !== nome ? p.district : '', p.city && p.city !== nome ? p.city : ''].filter(Boolean).join(' · ');
    return { nome: nome, end: linha };
  }

  // ---------- Rede (com tempo limite) ----------
  function busca(url, ctl) {
    var t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 12000);
    return fetch(url, { signal: ctl.signal }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  var cacheRota = {};
  function rota(perfil, dest, completa) {
    var k = perfil + dest.lon.toFixed(5) + dest.lat.toFixed(5) + (completa ? 'g' : '');
    if (cacheRota[k]) return cacheRota[k];
    var url = 'https://routing.openstreetmap.de/routed-' + perfil + '/route/v1/driving/' + BASE[0] + ',' + BASE[1] + ';' + dest.lon + ',' + dest.lat +
      '?overview=' + (completa ? 'full&geometries=geojson' : 'false');
    cacheRota[k] = busca(url, new AbortController()).then(function (j) {
      if (!j.routes || !j.routes[0]) throw new Error('sem rota');
      return j.routes[0];
    }).catch(function (e) { delete cacheRota[k]; throw e; });
    return cacheRota[k];
  }

  // ---------- Mapa (montado pela landing; pode não existir sem WebGL) ----------
  var api = null, pendentes = [];
  function comMapa(fn) { if (api) fn(api); else pendentes.push(fn); }
  window.__onMapa = window.__onMapa || [];
  window.__onMapa.push(function (a) { api = a; pendentes.splice(0).forEach(function (f) { f(a); }); });
  if (window.__mapaApi) { api = window.__mapaApi; }

  function idDe(d) { return 'traj-' + d.uid; }
  function desenhar(d) {
    comMapa(function (a) {
      var m = a.mapa, id = idDe(d);
      if (!a.ok) return a.pronto.then(function () { a.ok = true; if (destinos.indexOf(d) >= 0) desenhar(d); });
      var coords = d.geo || [BASE, [d.lon, d.lat]];
      var vazio = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords.slice(0, 2) } };
      if (!m.getSource(id)) {
        m.addSource(id, { type: 'geojson', data: vazio, lineMetrics: true });
        m.addLayer({ id: id + '-halo', type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': d.cor, 'line-width': 11, 'line-opacity': .18, 'line-blur': 2 } });
        m.addLayer({ id: id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': d.cor, 'line-width': 4.5, 'line-opacity': .95 } });
      }
      // marcador do destino
      if (!d.mk) {
        var el = document.createElement('button'); el.type = 'button'; el.className = 'mk-traj';
        el.style.setProperty('--c', d.cor); el.textContent = TIPOS[d.tipo][0]; el.setAttribute('aria-label', d.nome);
        el.addEventListener('click', function (ev) { ev.stopPropagation(); focar(d.uid); });
        d.mk = new a.ml.Marker({ element: el }).setLngLat([d.lon, d.lat]).addTo(m);
      }
      // a linha "nasce" do empreendimento até o destino
      var src = m.getSource(id), n = coords.length, t0 = performance.now(), dur = CALMO ? 0 : Math.min(1400, 500 + n * 2);
      (function passo(t) {
        var p = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - p, 2.2);
        src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords.slice(0, Math.max(2, Math.ceil(n * e))) } });
        if (p < 1) requestAnimationFrame(passo);
      })(t0);
      enquadrar();
    });
  }
  function apagar(d) {
    if (d.mk) { d.mk.remove(); d.mk = null; }
    comMapa(function (a) {
      var m = a.mapa, id = idDe(d);
      [id, id + '-halo'].forEach(function (l) { if (m.getLayer(l)) m.removeLayer(l); });
      if (m.getSource(id)) m.removeSource(id);
    });
  }
  function enquadrar(uid) {
    comMapa(function (a) {
      var b = new a.ml.LngLatBounds(BASE, BASE);
      destinos.forEach(function (d) {
        if (uid != null && d.uid !== uid) return;
        (d.geo || [[d.lon, d.lat]]).forEach(function (c) { b.extend(c); });
      });
      a.mapa.fitBounds(b, { padding: a.margem(), maxZoom: 15, duration: CALMO ? 0 : 900 });
    });
  }
  function focar(uid) {
    var sel = destinos.some(function (d) { return d.uid === uid && !d.focado; });
    destinos.forEach(function (d) { d.focado = sel && d.uid === uid; });
    comMapa(function (a) {
      destinos.forEach(function (d) {
        var id = idDe(d), apaga = sel && d.uid !== uid;
        if (a.mapa.getLayer(id)) { a.mapa.setPaintProperty(id, 'line-opacity', apaga ? .25 : .95); a.mapa.setPaintProperty(id + '-halo', 'line-opacity', apaga ? .05 : .18); }
        if (d.mk) d.mk.getElement().classList.toggle('apagado', apaga);
      });
    });
    [].forEach.call(lista.children, function (c) { c.classList.toggle('on', sel && +c.dataset.uid === uid); });
    enquadrar(sel ? uid : null);
    var mapa = document.getElementById('mapaLeaf');
    if (mapa && mapa.getBoundingClientRect().bottom < 80) mapa.scrollIntoView({ behavior: CALMO ? 'auto' : 'smooth', block: 'center' });
  }

  // ---------- Cartões ----------
  function cartao(d) {
    var c = document.createElement('article');
    c.className = 'traj-card carregando'; c.dataset.uid = d.uid; c.style.setProperty('--c', d.cor);
    c.innerHTML =
      '<button type="button" class="tc-foco" aria-label="Ver a rota até ' + esc(d.nome) + ' no mapa"></button>' +
      '<div class="tc-ic" aria-hidden="true">' + TIPOS[d.tipo][0] + '</div>' +
      '<div class="tc-tx"><span class="tc-tipo">' + esc(TIPOS[d.tipo][1]) + '</span><b>' + esc(d.nome) + '</b>' + (d.end ? '<small>' + esc(d.end) + '</small>' : '') + '</div>' +
      '<div class="tc-tempo" aria-live="polite"><b class="tc-n"><span class="tc-sk"></span></b><span class="tc-u">calculando a rota…</span></div>' +
      '<div class="tc-modos"></div>' +
      '<button type="button" class="tc-x" aria-label="Remover ' + esc(d.nome) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    c.querySelector('.tc-x').addEventListener('click', function () { remover(d.uid); });
    c.querySelector('.tc-foco').addEventListener('click', function () { focar(d.uid); });
    return c;
  }
  function preencher(d) {
    var c = lista.querySelector('[data-uid="' + d.uid + '"]'); if (!c) return;
    c.classList.remove('carregando');
    var tp = c.querySelector('.tc-tempo'), md = c.querySelector('.tc-modos');
    var transp = 'https://www.google.com/maps/dir/?api=1&origin=' + MAPA.lat + ',' + MAPA.lon + '&destination=' + d.lat + ',' + d.lon + '&travelmode=transit';
    if (!d.carro) {
      tp.innerHTML = '<b class="tc-n">' + km(d.reta) + '</b><span class="tc-u">em linha reta</span>';
      md.innerHTML = '<a href="' + transp.replace('transit', 'driving') + '" target="_blank" rel="noopener">Ver a rota no Google Maps</a>';
      return;
    }
    var t = tempo(d.carro.duration), pico = tempo(d.carro.duration * (d.carro.distance > 3000 ? 1.6 : 1.3));
    tp.innerHTML = '<b class="tc-n">' + t.n + (t.u ? '<small>' + t.u + '</small>' : '') + '</b>' +
      '<span class="tc-u">de carro · ' + km(d.carro.distance) + '</span>' +
      '<em class="tc-pico">no horário de pico, até ~' + pico.t + '</em>';
    var m = [];
    if (d.bike) m.push('<span title="De bicicleta">🚲 ' + tempo(d.bike.duration).t + '</span>');
    if (d.pe) m.push('<span title="A pé">🚶 ' + tempo(d.pe.duration).t + '</span>');
    m.push('<a href="' + transp + '" target="_blank" rel="noopener" title="Ver linhas de ônibus no Google Maps">🚌 Ônibus</a>');
    md.innerHTML = m.join('');
  }

  function reta(d) {   // distância em linha reta (reserva quando o roteador falha)
    var R = 6371000, r = Math.PI / 180, a = Math.sin((d.lat - MAPA.lat) * r / 2), b = Math.sin((d.lon - MAPA.lon) * r / 2);
    return 2 * R * Math.asin(Math.sqrt(a * a + Math.cos(MAPA.lat * r) * Math.cos(d.lat * r) * b * b));
  }

  var seq = 0;
  function adicionar(dados, silencioso) {
    var d = { uid: ++seq, tipo: dados.tipo in TIPOS ? dados.tipo : 'outro', nome: dados.nome, end: dados.end || '', lat: +dados.lat, lon: +dados.lon };
    if (!isFinite(d.lat) || !isFinite(d.lon)) return;
    // mesmo lugar de novo: só destaca
    var igual = destinos.filter(function (x) { return Math.abs(x.lat - d.lat) < 1e-4 && Math.abs(x.lon - d.lon) < 1e-4; })[0];
    if (igual) { focar(igual.uid); return; }
    if (destinos.length >= MAX) remover(destinos[0].uid, true);
    var usadas = destinos.map(function (x) { return x.cor; });
    d.cor = CORES.filter(function (c) { return usadas.indexOf(c) < 0; })[0] || CORES[0];
    d.reta = reta(d);
    destinos.push(d);
    var c = cartao(d); lista.appendChild(c);
    box.classList.add('tem');
    if (!CALMO) requestAnimationFrame(function () { c.classList.add('entra'); });
    salvar();
    if (!silencioso && !usou) { usou = true; if (window.__marca) window.__marca('trajeto', TIPOS[d.tipo][1]); if (window.gtag) gtag('event', 'calculou_trajeto', { empreendimento: EMP, tipo: d.tipo }); }
    var carro = rota('car', d, true);
    carro.then(function (r) {
      if (destinos.indexOf(d) < 0) return;
      d.carro = r; d.geo = r.geometry && r.geometry.coordinates;
      preencher(d); desenhar(d);
      var extras = [];
      if (r.distance <= 25000) extras.push(rota('bike', d).then(function (x) { d.bike = x; }).catch(function () {}));
      if (r.distance <= 6000) extras.push(rota('foot', d).then(function (x) { d.pe = x; }).catch(function () {}));
      Promise.all(extras).then(function () { if (destinos.indexOf(d) >= 0) preencher(d); });
    }).catch(function () { if (destinos.indexOf(d) >= 0) { preencher(d); desenhar(d); } });
  }
  function remover(uid, semAnim) {
    var d = destinos.filter(function (x) { return x.uid === uid; })[0]; if (!d) return;
    destinos.splice(destinos.indexOf(d), 1); apagar(d); salvar();
    var c = lista.querySelector('[data-uid="' + uid + '"]');
    if (c) { if (semAnim || CALMO) c.remove(); else { c.classList.add('sai'); setTimeout(function () { c.remove(); }, 260); } }
    box.classList.toggle('tem', destinos.length > 0);
    if (destinos.length) enquadrar(); else comMapa(function (a) { a.mapa.fitBounds(a.limites, { padding: a.margem(), maxZoom: 16, duration: CALMO ? 0 : 700 }); });
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(destinos.map(function (d) { return { tipo: d.tipo, nome: d.nome, end: d.end, lat: d.lat, lon: d.lon }; }))); } catch (e) {}
  }

  // ---------- Tipo do lugar ----------
  $('trajTipos').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    tipo = b.dataset.t;
    [].forEach.call(this.children, function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
    q.placeholder = { trabalho: 'Endereço ou nome da empresa', estudo: 'Nome da faculdade ou endereço', escola: 'Nome da escola ou endereço', familia: 'Endereço de quem você visita', outro: 'Qualquer endereço ou lugar' }[tipo];
    q.focus();
  });

  // ---------- Autocompletar ----------
  var ctlBusca = null, timer = null, itens = [], ativo = -1;
  function abrirSug(on) { sug.hidden = !on; q.setAttribute('aria-expanded', on ? 'true' : 'false'); }
  function pintaAtivo() {
    [].forEach.call(sug.children, function (li, i) { li.classList.toggle('on', i === ativo); li.setAttribute('aria-selected', i === ativo ? 'true' : 'false'); });
    if (ativo >= 0 && sug.children[ativo]) q.setAttribute('aria-activedescendant', sug.children[ativo].id); else q.removeAttribute('aria-activedescendant');
  }
  function mostrar(fs) {
    itens = fs; ativo = fs.length ? 0 : -1;
    if (!fs.length) { sug.innerHTML = '<li class="vazio" role="option" aria-disabled="true">Nenhum lugar encontrado. Tente com a cidade, ex.: "Av. Ipiranga, Porto Alegre".</li>'; abrirSug(true); return; }
    sug.innerHTML = fs.map(function (f, i) {
      var r = rotulo(f.properties);
      return '<li role="option" id="trajOp' + i + '" data-i="' + i + '"><b>' + esc(r.nome) + '</b>' + (r.end ? '<span>' + esc(r.end) + '</span>' : '') + '</li>';
    }).join('');
    abrirSug(true); pintaAtivo();
  }
  function escolher(i) {
    var f = itens[i]; if (!f) return;
    var r = rotulo(f.properties), c = f.geometry.coordinates;
    abrirSug(false); q.value = ''; itens = [];
    adicionar({ tipo: tipo, nome: r.nome, end: r.end, lat: c[1], lon: c[0] });
  }
  q.addEventListener('input', function () {
    clearTimeout(timer);
    var t = q.value.trim();
    if (t.length < 3) { abrirSug(false); return; }
    timer = setTimeout(function () {
      if (ctlBusca) try { ctlBusca.abort(); } catch (e) {}
      ctlBusca = new AbortController();
      sug.innerHTML = '<li class="vazio" role="option" aria-disabled="true"><span class="tc-sk"></span> Buscando…</li>'; abrirSug(true);
      // perto do empreendimento primeiro, e só no RS
      var url = 'https://photon.komoot.io/api/?limit=6&lat=' + MAPA.lat + '&lon=' + MAPA.lon + '&bbox=-57.7,-33.8,-49.6,-27.0&q=' + encodeURIComponent(t);
      busca(url, ctlBusca).then(function (j) { mostrar((j.features || []).filter(function (f) { return f.geometry && f.geometry.coordinates; })); })
        .catch(function (e) { if (e.name !== 'AbortError') { sug.innerHTML = '<li class="vazio" role="option" aria-disabled="true">Não deu para buscar agora. Tente de novo em instantes.</li>'; } });
    }, 260);
  });
  q.addEventListener('keydown', function (ev) {
    if (sug.hidden || !itens.length) { if (ev.key === 'Escape') abrirSug(false); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); ativo = (ativo + 1) % itens.length; pintaAtivo(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); ativo = (ativo - 1 + itens.length) % itens.length; pintaAtivo(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); escolher(ativo < 0 ? 0 : ativo); }
    else if (ev.key === 'Escape') { abrirSug(false); }
  });
  sug.addEventListener('mousedown', function (ev) { ev.preventDefault(); });   // não perde o foco antes do clique
  sug.addEventListener('click', function (ev) { var li = ev.target.closest('li[data-i]'); if (li) escolher(+li.dataset.i); });
  q.addEventListener('blur', function () { setTimeout(function () { abrirSug(false); }, 150); });
  q.addEventListener('focus', function () { if (itens.length) abrirSug(true); });

  // ---------- Minha localização ----------
  if (!('geolocation' in navigator)) geo.hidden = true;
  geo.addEventListener('click', function () {
    geo.classList.add('busy'); msg.hidden = true;
    navigator.geolocation.getCurrentPosition(function (p) {
      var lat = p.coords.latitude, lon = p.coords.longitude;
      busca('https://photon.komoot.io/reverse?lat=' + lat + '&lon=' + lon, new AbortController())
        .then(function (j) { var f = j.features && j.features[0]; return f ? rotulo(f.properties) : null; })
        .catch(function () { return null; })
        .then(function (r) {
          geo.classList.remove('busy');
          adicionar({ tipo: tipo, nome: r ? r.nome : 'Onde você está', end: r ? r.end : '', lat: lat, lon: lon });
        });
    }, function () {
      geo.classList.remove('busy');
      msg.textContent = 'Não conseguimos sua localização. Digite o endereço no campo acima.'; msg.hidden = false;
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });

  // ---------- Resumo para o corretor (vai no WhatsApp) ----------
  window.__resumos = window.__resumos || {};
  window.__resumos.trajeto = function () {
    if (!destinos.length) return '';
    return 'Rotina: ' + destinos.map(function (d) {
      return TIPOS[d.tipo][1] + ' em ' + d.nome + (d.carro ? ' (' + tempo(d.carro.duration).t + ' de carro)' : '');
    }).join('; ');
  };

  // ---------- Lugares de outra visita: recalcula a partir deste empreendimento ----------
  var salvos = [];
  try { salvos = JSON.parse(localStorage.getItem(CHAVE) || '[]') || []; } catch (e) {}
  if (salvos.length) {
    var feito = false;
    var iniciar = function () {
      if (feito) return; feito = true;
      salvos.slice(-MAX).forEach(function (s) { adicionar(s, true); });
      msg.innerHTML = 'Recalculamos seus lugares a partir do <b>' + esc(EMP) + '</b>.'; msg.hidden = false; msg.classList.add('info');
    };
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); iniciar(); } }, { rootMargin: '300px 0px' });
      io.observe(box);
    } else iniciar();
  }
})();
