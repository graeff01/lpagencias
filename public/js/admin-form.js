(function () {
  // ---------- Templates das seções repetíveis ----------
  var T = {
    infra: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid" style="grid-template-columns:1fr 1fr">' +
      '<div><span class="lbl">Item</span><input data-k="titulo"></div>' +
      '<div><span class="lbl">Detalhe</span><input data-k="sub"></div></div></div>',
    plantas: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid" style="grid-template-columns:2fr 1fr">' +
      '<div><span class="lbl">Título</span><input data-k="titulo" placeholder="3 dormitórios"></div>' +
      '<div><span class="lbl">Área</span><input data-k="area" placeholder="116 m²"></div>' +
      '<div><span class="lbl">Quartos</span><input data-k="quartos"></div>' +
      '<div><span class="lbl">Banheiros</span><input data-k="banheiros"></div>' +
      '<div><span class="lbl">Vagas</span><input data-k="vagas"></div>' +
      '<div><span class="lbl">Etiqueta</span><input data-k="final" placeholder="Final 02 · 03"></div>' +
      '<div style="grid-column:1/-1"><span class="lbl">Imagem da planta</span>' +
      '<div class="imgfield"><div class="thumb pthumb" style="width:74px;height:56px"></div><div class="up">' +
      '<label class="uplabel">Enviar planta<input type="file" accept="image/*" data-upload-item></label>' +
      '<input data-k="imagem" placeholder="ou cole a URL da planta" style="margin-top:8px"></div></div></div>' +
      '</div></div>',
    acabamentos: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid" style="grid-template-columns:2fr 1fr">' +
      '<div><span class="lbl">Item</span><input data-k="item" placeholder="Fechadura digital"></div>' +
      '<div><span class="lbl">Detalhe</span><input data-k="det" placeholder="em todas as unidades"></div></div></div>',
    diferenciais: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid">' +
      '<div><span class="lbl">Título</span><input data-k="titulo"></div>' +
      '<div><span class="lbl">Texto</span><textarea data-k="texto" rows="2"></textarea></div></div></div>',
    timeline: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid" style="grid-template-columns:2fr 2fr 1fr">' +
      '<div><span class="lbl">Etapa</span><input data-k="etapa"></div>' +
      '<div><span class="lbl">Detalhe</span><input data-k="sub"></div>' +
      '<div><span class="lbl">%</span><input data-k="pct"></div>' +
      '<div style="display:flex;gap:14px;align-items:center;grid-column:1/-1">' +
      '<label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="done"> Concluída</label>' +
      '<label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-k="act"> Em andamento</label></div></div></div>',
    faq: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid">' +
      '<div><span class="lbl">Pergunta</span><input data-k="q"></div>' +
      '<div><span class="lbl">Resposta</span><textarea data-k="a" rows="2"></textarea></div></div></div>',
    pois: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid">' +
      '<div><span class="lbl">Ponto (aparece no mapa e na legenda)</span><input data-k="label" placeholder="🛒 Supermercado X · 400 m"></div></div>' +
      '<input type="hidden" data-k="categoria"><input type="hidden" data-k="metros"><input type="hidden" data-k="lat"><input type="hidden" data-k="lon"></div>',
    construtora_stats: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid" style="grid-template-columns:1fr 2fr">' +
      '<div><span class="lbl">Número</span><input data-k="num" placeholder="80+"></div>' +
      '<div><span class="lbl">Legenda</span><input data-k="label" placeholder="obras entregues"></div></div></div>',
  };

  // Adicionar item
  document.querySelectorAll('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-add');
      var rep = document.querySelector('.rep[data-rep="' + name + '"]');
      var tmp = document.createElement('div');
      tmp.innerHTML = T[name];
      rep.appendChild(tmp.firstChild);
    });
  });

  // Remover item (delegação)
  document.addEventListener('click', function (ev) {
    var rm = ev.target.closest('[data-rm]');
    if (rm) { ev.preventDefault(); rm.closest('.item').remove(); }
    var rmg = ev.target.closest('[data-rmg]');
    if (rmg) { ev.preventDefault(); rmg.closest('.gcell').remove(); }
  });

  function thumbDe(field) {
    return { hero_image: 'hero', construtora_logo: 'logo', card_imagem: 'card' }[field] || field;
  }

  // ---------- Upload de imagens ----------
  function upload(file, onDone, stateEl) {
    var fd = new FormData();
    fd.append('file', file);
    if (stateEl) stateEl.textContent = 'Enviando…';
    fetch('/admin/upload', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) { if (stateEl) stateEl.textContent = j.error; alert(j.error); return; }
        if (stateEl) stateEl.textContent = 'Enviada ✓';
        onDone(j.url);
      })
      .catch(function () { if (stateEl) stateEl.textContent = 'Falha no envio.'; });
  }

  // Uploads de imagem única (hero, logo)
  document.querySelectorAll('[data-upload]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      if (!inp.files || !inp.files[0]) return;
      var field = inp.getAttribute('data-upload');
      var stateEl = document.querySelector('[data-state="' + field + '"]');
      upload(inp.files[0], function (url) {
        var target = document.querySelector('input[name="' + field + '"]');
        if (target) target.value = url;
        var thumb = document.getElementById('thumb-' + thumbDe(field));
        if (thumb) thumb.style.backgroundImage = "url('" + url + "')";
        if (target) target.dispatchEvent(new Event('input', { bubbles: true }));
      }, stateEl);
      inp.value = '';
    });
  });

  // Upload dentro de item repetível (imagem da planta) — delegado, para
  // funcionar também nos itens criados depois pelo botão "+ Adicionar".
  document.addEventListener('change', function (ev) {
    var inp = ev.target;
    if (!inp.matches || !inp.matches('[data-upload-item]')) return;
    if (!inp.files || !inp.files[0]) return;
    var campo = inp.closest('.imgfield');
    var alvo = campo && campo.querySelector('input[data-k]');
    var thumb = campo && campo.querySelector('.pthumb');
    upload(inp.files[0], function (url) {
      if (alvo) { alvo.value = url; alvo.dispatchEvent(new Event('input', { bubbles: true })); }
      if (thumb) thumb.style.backgroundImage = "url('" + url + "')";
    });
    inp.value = '';
  });

  // Ponto renomeado vira outro lugar: as coordenadas antigas saem e ele é
  // localizado de novo pelo nome ao salvar.
  document.addEventListener('change', function (ev) {
    var inp = ev.target;
    if (!inp.matches || !inp.matches('.rep[data-rep="pois"] input[data-k="label"]')) return;
    function nome(t) { return String(t || '').replace(/^[^A-Za-zÀ-ÿ0-9]+/, '').replace(/\s*·.*$/, '').trim().toLowerCase(); }
    if (nome(inp.value) === nome(inp.getAttribute('data-orig') || inp.defaultValue)) return;
    var item = inp.closest('.item');
    ['lat', 'lon', 'categoria', 'metros'].forEach(function (k) { var f = item.querySelector('[data-k="' + k + '"]'); if (f) f.value = ''; });
  });

  // Thumb do item repetível acompanha a URL colada à mão
  document.addEventListener('input', function (ev) {
    var inp = ev.target;
    if (!inp.matches || !inp.matches('input[data-k="imagem"]')) return;
    var thumb = inp.closest('.imgfield') && inp.closest('.imgfield').querySelector('.pthumb');
    if (thumb) thumb.style.backgroundImage = inp.value ? "url('" + inp.value + "')" : '';
  });

  // Sincroniza thumb quando cola URL manualmente
  ['hero_image', 'construtora_logo', 'card_imagem'].forEach(function (field) {
    var inp = document.querySelector('input[name="' + field + '"]');
    if (!inp) return;
    inp.addEventListener('input', function () {
      var thumb = document.getElementById('thumb-' + thumbDe(field));
      if (thumb) thumb.style.backgroundImage = inp.value ? "url('" + inp.value + "')" : '';
    });
  });

  // ---------- Galeria ----------
  var grid = document.getElementById('gallery-grid');
  var addCell = document.getElementById('gallery-add');
  var fileInput = document.getElementById('gallery-file');

  function addGCell(url, tag) {
    var cell = document.createElement('div');
    cell.className = 'gcell';
    cell.setAttribute('data-url', url);
    cell.style.backgroundImage = "url('" + url + "')";
    cell.innerHTML = '<button type="button" class="rm" data-rmg>×</button><input class="tag" placeholder="Legenda (ex: Fachada)" value="' + (tag || '').replace(/"/g, '&quot;') + '">';
    grid.insertBefore(cell, addCell);
  }
  if (addCell) addCell.addEventListener('click', function () { fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', function () {
    if (!fileInput.files || !fileInput.files[0]) return;
    upload(fileInput.files[0], function (url) { addGCell(url, ''); });
    fileInput.value = '';
  });
  var gurl = document.getElementById('gallery-url');
  if (gurl) gurl.addEventListener('click', function (ev) {
    ev.preventDefault();
    var url = prompt('Cole a URL da imagem:');
    if (url) addGCell(url.trim(), '');
  });

  // ---------- Paleta de sugestão ----------
  document.querySelectorAll('#sw-list .sw').forEach(function (sw) {
    sw.addEventListener('click', function () {
      var c = sw.getAttribute('data-c'), c2 = sw.getAttribute('data-c2'), c3 = sw.getAttribute('data-c3');
      document.querySelector('input[name="cor_principal"]').value = c;
      document.querySelector('input[name="cor_secundaria"]').value = c2;
      if (c3) document.querySelector('input[name="cor_accent"]').value = c3;
    });
  });

  var form = document.getElementById('empForm');

  // ---------- Cadastro em etapas ----------
  // Todos os campos continuam no mesmo formulário (só ficam escondidos), então
  // salvar funciona de qualquer etapa e nada se perde ao trocar de passo.
  var passos = document.querySelectorAll('.form-pane .fieldset[data-step]');
  var stepper = document.getElementById('stepper');
  var wizNav = document.getElementById('wizNav');
  var passoInp = document.getElementById('passoAtual');
  var TOTAL = 8;
  var atual = Number(passoInp && passoInp.value) || 1;
  function irPara(n) {
    atual = n;
    passos.forEach(function (f) { f.hidden = n !== 0 && Number(f.getAttribute('data-step')) !== n; });
    stepper.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', Number(b.getAttribute('data-go')) === n); });
    wizNav.hidden = n === 0;
    wizNav.querySelector('[data-mv="-1"]').style.visibility = n <= 1 ? 'hidden' : '';
    wizNav.querySelector('[data-mv="1"]').style.visibility = n >= TOTAL ? 'hidden' : '';
    document.getElementById('wizPos').textContent = n ? 'Etapa ' + n + ' de ' + TOTAL : '';
    if (passoInp) passoInp.value = n || 1;
  }
  if (stepper) {
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-go]');
      if (!b) return;
      ev.preventDefault();
      irPara(Number(b.getAttribute('data-go')));
      stepper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    wizNav.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-mv]');
      if (!b) return;
      irPara(Math.min(TOTAL, Math.max(1, atual + Number(b.getAttribute('data-mv')))));
      stepper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Campo obrigatório escondido em outra etapa: abre a etapa dele em vez
    // de o navegador travar o envio sem mostrar onde está o problema.
    form.addEventListener('invalid', function (ev) {
      var fs = ev.target.closest('.fieldset[data-step]');
      if (fs && fs.hidden) irPara(Number(fs.getAttribute('data-step')));
    }, true);
    irPara(atual);
  }

  // ---------- Prévia do card da vitrine ----------
  var prev = document.getElementById('prevCard');
  function campo(n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function desenharCard() {
    if (!prev) return;
    var capa = campo('card_imagem') || campo('hero_image');
    if (!capa) { var g = grid && grid.querySelector('.gcell[data-url]'); if (g) capa = g.getAttribute('data-url'); }
    var local = [campo('bairro'), campo('cidade')].filter(Boolean).join(' · ');
    var tipo = [];
    if (campo('dormitorios')) tipo.push(/^[\d\s,aeou–-]+$/i.test(campo('dormitorios')) ? campo('dormitorios') + ' dorm.' : campo('dormitorios'));
    if (campo('area')) tipo.push(campo('area') + ' m²');
    if (campo('vagas')) tipo.push(campo('vagas') + (campo('vagas') === '1' ? ' vaga' : ' vagas'));
    var preco = Number(campo('preco_inicial').replace(/\D/g, ''));
    var st = form.querySelector('[name="status"]');
    var selo = campo('card_selo') || (st ? st.value : '');
    prev.innerHTML = '<div class="vt-card"><div class="vt-cover">' + (capa ? '<img src="' + esc(capa) + '" alt="">' : '') +
      (selo ? '<span class="vt-selo">' + esc(selo) + '</span>' : '') + '</div><div class="vt-bd">' +
      (campo('construtora') ? '<div class="vt-cst">' + esc(campo('construtora')) + '</div>' : '') +
      '<h3>' + esc(campo('nome') || 'Nome do empreendimento') + '</h3>' +
      (local ? '<div class="vt-loc">' + esc(local) + '</div>' : '') +
      (tipo.length ? '<div class="vt-tipo">' + esc(tipo.join(' · ')) + '</div>' : '') +
      (campo('card_resumo') ? '<p class="vt-res">' + esc(campo('card_resumo')) + '</p>' : '') +
      '<div class="vt-foot"><div class="vt-pr"><small>' + (preco ? 'a partir de' : 'valores') + '</small>' + (preco ? 'R$ ' + preco.toLocaleString('pt-BR') : 'Sob consulta') + '</div><span class="vt-go">Conhecer</span></div></div></div>';
  }
  form.addEventListener('input', desenharCard);
  form.addEventListener('change', desenharCard);
  desenharCard();

  // ---------- Mapa: ponto do empreendimento e pontos próximos ----------
  // Localiza o endereço, põe um alfinete arrastável e busca o entorno a
  // partir dele. O alfinete confirmado vai para lat/lon e é a base das
  // distâncias; quando o endereço não tem o número na base, o aviso pede
  // para conferir.
  (function () {
    var div = document.getElementById('geoMapa'); if (!div || !window.L) return;
    var st = document.getElementById('geoStatus');
    var inLat = form.querySelector('[name=lat]'), inLon = form.querySelector('[name=lon]');
    var rep = document.querySelector('.rep[data-rep="pois"]');
    var mapa = null, pino = null;
    function status(t, tipo) { st.textContent = t || ''; st.className = 'geo-st' + (tipo ? ' ' + tipo : ''); }
    function garantirMapa(lat, lon) {
      if (!mapa) {
        mapa = L.map(div, { scrollWheelZoom: false }).setView([lat, lon], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
        pino = L.marker([lat, lon], { draggable: true }).addTo(mapa);
        pino.on('dragend', function () { var p = pino.getLatLng(); salvarPonto(p.lat, p.lng); buscar(); });
      } else { mapa.setView([lat, lon], 16); pino.setLatLng([lat, lon]); }
      setTimeout(function () { mapa.invalidateSize(); }, 50);
    }
    function salvarPonto(lat, lon) { inLat.value = (+lat).toFixed(6); inLon.value = (+lon).toFixed(6); }
    function campo(n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; }
    function localizar() {
      if (!campo('endereco') && !campo('bairro')) { status('Preencha o endereço na etapa 1.', 'erro'); return Promise.resolve(false); }
      status('Localizando endereço…');
      var q = new URLSearchParams({ endereco: campo('endereco'), bairro: campo('bairro'), cidade: campo('cidade') });
      return fetch('/admin/geo?' + q).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok || !j.candidatos.length) { status(j.erro || 'Endereço não encontrado. Confira a etapa 1.', 'erro'); return false; }
        var c = j.candidatos[0]; salvarPonto(c.lat, c.lon); garantirMapa(c.lat, c.lon);
        status(c.exato ? 'Endereço localizado. Confira o alfinete.' : 'O número não está na base: o alfinete está no meio da rua. Arraste até o prédio.', c.exato ? 'ok' : 'aviso');
        return true;
      }).catch(function () { status('Não consegui localizar agora.', 'erro'); return false; });
    }
    function buscar() {
      if (!inLat.value) { status('Localize o endereço primeiro.', 'erro'); return; }
      status('Buscando pontos próximos… (leva até 40 segundos)');
      var q = new URLSearchParams({ lat: inLat.value, lon: inLon.value });
      fetch('/admin/pois-proximos?' + q).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) { status(j.erro, 'erro'); return; }
        if (!j.pois.length) { status('Nada encontrado num raio razoável. Adicione à mão se quiser.', 'aviso'); return; }
        rep.innerHTML = '';
        j.pois.forEach(function (p) {
          var tmp = document.createElement('div'); tmp.innerHTML = T.pois; var item = tmp.firstChild;
          ['label', 'categoria', 'metros', 'lat', 'lon'].forEach(function (k) { item.querySelector('[data-k="' + k + '"]').value = p[k] == null ? '' : p[k]; });
          item.querySelector('[data-k="label"]').setAttribute('data-orig', p.label);
          rep.appendChild(item);
        });
        status(j.pois.length + ' pontos encontrados. Revise os nomes e salve.', 'ok');
      }).catch(function () { status('Busca indisponível agora.', 'erro'); });
    }
    document.getElementById('geoLocalizar').addEventListener('click', function () { localizar().then(function (ok) { if (ok) buscar(); }); });
    document.getElementById('geoBuscar').addEventListener('click', buscar);
    // Ao abrir a etapa do mapa: mostra o ponto salvo, ou localiza sozinho
    // (e busca o entorno se a lista estiver vazia).
    var feito = false;
    function aoMostrar() {
      if (feito || div.offsetParent === null) return; feito = true;
      if (inLat.value && inLon.value) { garantirMapa(+inLat.value, +inLon.value); status('Ponto salvo. Arraste o alfinete para ajustar.'); }
      else localizar().then(function (ok) { if (ok && !rep.querySelector('.item')) buscar(); });
    }
    new MutationObserver(aoMostrar).observe(div.closest('.fieldset'), { attributes: true, attributeFilter: ['hidden'] });
    aoMostrar();
    // Endereço mudou: o ponto antigo não vale mais.
    ['endereco', 'bairro', 'cidade'].forEach(function (n) {
      var el = form.querySelector('[name="' + n + '"]');
      if (el) el.addEventListener('change', function () { inLat.value = ''; inLon.value = ''; feito = false; });
    });
  })();

  // ---------- Serialização no submit ----------
  form.addEventListener('submit', function () {
    // repetíveis
    Object.keys(T).forEach(function (name) {
      var rep = document.querySelector('.rep[data-rep="' + name + '"]');
      var out = [];
      rep.querySelectorAll('.item').forEach(function (item) {
        var obj = {};
        var hasContent = false;
        item.querySelectorAll('[data-k]').forEach(function (f) {
          var k = f.getAttribute('data-k');
          if (f.type === 'checkbox') { obj[k] = f.checked; }
          else { obj[k] = f.value.trim(); if (obj[k]) hasContent = true; }
        });
        // ponto sem nome não vale, mesmo que guarde coordenadas
        if (hasContent && !(name === 'pois' && !obj.label)) out.push(obj);
      });
      document.getElementById('hidden-' + name).value = JSON.stringify(out);
    });
    // galeria
    var gal = [];
    grid.querySelectorAll('.gcell[data-url]').forEach(function (cell) {
      var tag = cell.querySelector('.tag');
      gal.push({ url: cell.getAttribute('data-url'), tag: tag ? tag.value.trim() : '' });
    });
    document.getElementById('hidden-gallery').value = JSON.stringify(gal);
  });
})();
