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

  // Linhas que encerram a mensagem e o bloco atual (sem acento, minúsculas).
  var FIM_DE_BLOCO = ['corretor responsavel', 'dados do lead', 'informacoes do cadastro', 'dados do cliente'];
  // Rótulos que não são do lead e também encerram a mensagem.
  var PARA = ['data do interesse', 'data', 'agencia', 'contato', 'cadastro gerador', 'equipe', 'origem do lead'];

  var PORTAIS = [
    [/\bzap\b/i, 'ZAP Imóveis'], [/viva\s*real/i, 'VivaReal'], [/\bolx\b/i, 'OLX'],
    [/imovel\s*web/i, 'Imovelweb'], [/chaves\s*na\s*m[aã]o/i, 'Chaves na Mão'],
    [/instagram/i, 'Instagram'], [/facebook|\bmeta\b/i, 'Facebook'], [/google/i, 'Google'],
  ];

  function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Tira a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) sem
  // estragar o "_" de dentro de e-mails como joao_silva@...
  function semFormatacao(v) {
    return String(v || '').replace(/[*~]/g, '')
      .replace(/(^|[\s(])_(?=\S)/g, '$1').replace(/(\S)_(?=$|[\s).,!?:])/g, '$1');
  }

  // "-", "Não informado" e afins são campo vazio, não um valor.
  function limpo(v) {
    var s = semFormatacao(v).trim();
    return /^(-|—|n[aã]o informad[oa]|n\/?a|null|undefined)$/i.test(s) ? '' : s;
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

    // E-mails chegam com <br> no meio do texto: vira quebra de linha.
    t = t.replace(/(\s*<br\s*\/?>\s*)+/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '').replace(/&nbsp;/g, ' ');

    // atual: campo que está sendo lido (a mensagem pode ter várias linhas).
    // pendente: rótulo sem valor na mesma linha ("Telefone:" e o número embaixo).
    // secao: dentro do bloco "Corretor Responsável", "Nome:" é do corretor.
    var atual = null, pendente = null, secao = null;
    t.split('\n').forEach(function (linha) {
      var l = semFormatacao(linha).trim();
      if (!l) { if (atual === 'mensagem') atual = null; return; }
      if (/mensagem autom[aá]tica/i.test(l)) { atual = null; return; }
      var semAc = semAcento(l).toLowerCase().replace(/:$/, '');
      if (FIM_DE_BLOCO.indexOf(semAc) >= 0) {
        atual = null; pendente = null;
        secao = semAc === 'corretor responsavel' ? 'corretor' : null;
        return;
      }
      var m = l.match(/^([A-Za-zÀ-ÿ .-]{2,25}):\s*(.*)$/);
      var rotulo = m ? semAcento(m[1]).toLowerCase().trim() : '';
      var campo = m && campoDoRotulo(m[1]);
      if (secao === 'corretor' && campo === 'nome') campo = 'corretor';
      if (campo) {
        atual = campo;
        var v = limpo(m[2]);
        if (!out[campo]) out[campo] = v;
        pendente = !m[2].trim() && campo !== 'mensagem' ? campo : null;
        return;
      }
      if (m && PARA.indexOf(rotulo) >= 0) { atual = null; pendente = null; return; }
      if (pendente) {
        if (!out[pendente]) out[pendente] = limpo(l);
        pendente = null;
        return;
      }
      // Mensagem com mais de uma linha continua até uma linha em branco ou
      // um rótulo de fim ("Data do interesse:", "Corretor Responsável").
      if (atual === 'mensagem') out.mensagem += (out.mensagem ? '\n' : '') + l;
    });

    // "Novo cadastro recebido do ZAP para o imóvel 817210"
    var rec = t.match(/recebido\s+d[oa]s?\s+(.+?)\s+para\s+o\s+im[oó]vel\s+([\w.-]+)/i);
    if (rec) {
      if (!out.imovel) out.imovel = rec[2];
      out.origem = semFormatacao(rec[1]).trim();
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
    // Link para o corretor avisar que recebeu (a recepção e o gestor veem).
    if (d.linkOk) l.push('', '✅ *Confirme que recebeu:* ' + d.linkOk);
    return l.join('\n');
  }

  var api = { ler: ler, normalizarFone: normalizarFone, formatarFone: formatarFone, canalDaOrigem: canalDaOrigem, mensagemCorretor: mensagemCorretor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.LeadParser = api;
})(this);
