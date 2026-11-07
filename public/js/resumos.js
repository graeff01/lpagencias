// O que a pessoa fez nas ferramentas da landing (simulador, trajetos) vai
// junto para o corretor no parâmetro "vi" dos links do WhatsApp.
// Carregado por último: o listener da planta interativa (planta.js) já
// gravou o "vi" dele, e aqui só se acrescenta, sem apagar. Roda na captura
// da window, antes do formulário padrão (lead-gate), que guarda o link.
(function () {
  function extras() {
    var r = window.__resumos || {}, p = [];
    Object.keys(r).forEach(function (k) { try { var t = r[k](); if (t) p.push(t); } catch (e) {} });
    return p.join(' · ');
  }
  window.__resumoLead = function (atual) {
    var x = extras(); if (!x) return atual || '';
    if (atual && atual.indexOf(x) >= 0) return atual;
    return (atual ? atual + ' · ' : '') + x;
  };
  window.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="/wa/"]'); if (!a) return;
    var u = new URL(a.getAttribute('href'), location.origin);
    var vi = window.__resumoLead(u.searchParams.get('vi') || '');
    if (!vi) return;
    u.searchParams.set('vi', vi);
    a.setAttribute('href', u.origin === location.origin ? u.pathname + u.search + u.hash : u.href);
  }, true);
})();
