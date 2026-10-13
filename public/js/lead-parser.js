// Lê a mensagem de um lead colada pela recepção (Leads Delivery, portais,
// texto livre) e separa os campos. Roda no navegador (preenche o formulário
// na hora em que ela cola) e no Node (testes e validação no servidor).
(function (raiz) {
  // Rótulos aceitos em cada campo, já sem acento e em minúsculas.
  var ROTULOS = {
    nome: ['nome', 'cliente', 'nome do cliente', 'lead'],
    email: ['e-mail', 'email'],
    telefone: ['telefone', 'celular', 'whatsapp', 'fone', 'tel'],
    negocio: ['negocio', 'finalidade', 'interesse'],
    imovel: ['imovel', 'codigo', 'cod', 'codigo do imovel', 'referencia', 'ref'],
    mensagem: ['mensagem', 'observacao', 'obs', 'comentario'],
    corretor: ['corretor responsavel', 'corretor'],
    gerador: ['cadastro gerador', 'equipe'],
  };

  var PORTAIS = [
    [/\bzap\b/i, 'ZAP Imóveis'], [/viva\s*real/i, 'VivaReal'], [/\bolx\b/i, 'OLX'],
    [/imovel\s*web/i, 'Imovelweb'], [/chaves\s*na\s*m[aã]o/i, 'Chaves na Mão'],
    [/instagram/i, 'Instagram'], [/facebook|\bmeta\b/i, 'Facebook'], [/google/i, 'Google'],
  ];

  function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function limpo(v) {
    var s = String(v || '').replace(/[*_~]/g, '').trim();
    return s === '-' || s === '—' ? '' : s;
  }

  // Só dígitos com DDI 55, ou '' se não parecer um celular/fixo brasileiro.
  function normalizarFone(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return d.length === 12 || d.length === 13 ? d : '';
  }

  function formatarFone(d) {
    return String(d || '').replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
  }

  function campoDoRotulo(rotulo) {
    var r = semAcento(rotulo).toLowerCase().trim();
    for (var k in ROTULOS) if (ROTULOS[k].indexOf(r) >= 0) return k;
    return null;
  }

  function ler(texto) {
    var out = { nome: '', email: '', telefone: '', negocio: '', imovel: '', origem: '', mensagem: '' };
    var t = String(texto || '').replace(/\r/g, '');
    if (!t.trim()) return out;

    var atual = null;
    t.split('\n').forEach(function (linha) {
      var l = linha.replace(/[*_~]/g, '').trim();
      if (/mensagem autom[aá]tica/i.test(l)) { atual = null; return; }
      var m = l.match(/^([A-Za-zÀ-ÿ .-]{2,25}):\s*(.*)$/);
      var campo = m && campoDoRotulo(m[1]);
      if (campo) {
        atual = campo;
        if (!out[campo]) out[campo] = limpo(m[2]);
        return;
      }
      // Mensagem com mais de uma linha continua até o próximo rótulo.
      if (atual === 'mensagem' && l) out.mensagem += (out.mensagem ? '\n' : '') + l;
      else if (!l) atual = atual === 'mensagem' ? null : atual;
    });

    // "Novo cadastro recebido do ZAP para o imóvel 817210"
    var rec = t.match(/recebido\s+d[oa]s?\s+(.+?)\s+para\s+o\s+im[oó]vel\s+([\w.-]+)/i);
    if (rec) {
      if (!out.imovel) out.imovel = rec[2];
      out.origem = rec[1].replace(/[*_]/g, '').trim();
    }
    if (!out.imovel) {
      var cod = t.match(/im[oó]vel\s*(?:c[oó]d(?:igo)?\.?)?\s*[:#]?\s*(\d{3,})/i);
      if (cod) out.imovel = cod[1];
    }
    // Nome do portal: o da frase de recebimento, senão o que aparecer no texto.
    var fonte = out.origem || t;
    for (var i = 0; i < PORTAIS.length; i++) {
      if (PORTAIS[i][0].test(fonte)) { out.origem = PORTAIS[i][1]; break; }
    }

    out.telefone = normalizarFone(out.telefone);
    if (!out.telefone) {
      var f = t.match(/(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-.\s]?\d{4}/);
      if (f) out.telefone = normalizarFone(f[0]);
    }
    if (!out.email) {
      var e = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (e) out.email = e[0];
    }
    if (out.negocio) {
      var n = semAcento(out.negocio).toLowerCase();
      out.negocio = /loca|alug/.test(n) ? 'Locação' : /vend|compr/.test(n) ? 'Venda' : out.negocio;
    }
    // Os portais repetem nome, e-mail e telefone no fim da mensagem: já estão nos campos.
    out.mensagem = out.mensagem.replace(/\s*A seguir,? dados para contato[\s\S]*$/i, '').trim().slice(0, 1500);
    return out;
  }

  // Canal (chips da tela) a partir da origem lida.
  function canalDaOrigem(origem) {
    var o = String(origem || '');
    if (/ZAP|VivaReal|OLX|Imovelweb|Chaves/i.test(o)) return 'Portais';
    if (/Instagram/i.test(o)) return 'Instagram';
    if (/Facebook/i.test(o)) return 'Facebook';
    if (/Google/i.test(o)) return 'Google';
    return '';
  }

  // Mensagem que o corretor recebe: sempre no mesmo formato, para ele bater
  // o olho e já saber quem é, o que quer e de onde veio.
  function mensagemCorretor(d) {
    var l = ['*Novo lead · Recepção Auxiliadora*', ''];
    l.push('*Nome:* ' + (d.nome || '-'));
    if (d.telefone) l.push('*Telefone:* ' + formatarFone(d.telefone) + '  wa.me/' + d.telefone);
    if (d.email) l.push('*E-mail:* ' + d.email);
    var neg = [d.negocio, d.imovel ? 'imóvel ' + d.imovel : ''].filter(Boolean).join(' · ');
    if (neg) l.push('*Interesse:* ' + neg);
    var orig = [d.origem, d.canal && d.canal !== d.origem && d.canal !== 'Portais' ? d.canal : ''].filter(Boolean).join(' · ') || d.canal;
    if (orig) l.push('*Origem:* ' + orig);
    if (d.mensagem) l.push('', '*Mensagem do cliente:*', d.mensagem);
    return l.join('\n');
  }

  var api = { ler: ler, normalizarFone: normalizarFone, formatarFone: formatarFone, canalDaOrigem: canalDaOrigem, mensagemCorretor: mensagemCorretor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.LeadParser = api;
})(this);
