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
      '<div><span class="lbl">Etiqueta</span><input data-k="final" placeholder="Final 02 · 03"></div></div></div>',
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
    pois: '<div class="item"><button type="button" class="rm" data-rm>×</button><div class="grid" style="grid-template-columns:2fr 1fr">' +
      '<div><span class="lbl">Texto (com emoji)</span><input data-k="label" placeholder="🌳 Parque · 400m"></div>' +
      '<div><span class="lbl">Posição (CSS)</span><input data-k="pos" placeholder="top:22%;left:16%"></div></div></div>',
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
        var thumb = document.getElementById('thumb-' + (field === 'hero_image' ? 'hero' : 'logo'));
        if (thumb) thumb.style.backgroundImage = "url('" + url + "')";
      }, stateEl);
      inp.value = '';
    });
  });

  // Sincroniza thumb quando cola URL manualmente
  ['hero_image', 'construtora_logo'].forEach(function (field) {
    var inp = document.querySelector('input[name="' + field + '"]');
    if (!inp) return;
    inp.addEventListener('input', function () {
      var thumb = document.getElementById('thumb-' + (field === 'hero_image' ? 'hero' : 'logo'));
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
      var c = sw.getAttribute('data-c'), c2 = sw.getAttribute('data-c2');
      document.querySelector('input[name="cor_principal"]').value = c;
      document.querySelector('input[name="cor_secundaria"]').value = c2;
    });
  });

  // ---------- Serialização no submit ----------
  var form = document.getElementById('empForm');
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
        if (hasContent) out.push(obj);
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
