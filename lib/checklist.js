// "Pronto para publicar": o que falta num empreendimento antes de ir ao ar.
// Obrigatório trava a primeira publicação; recomendado só avisa.
const { asArray } = require('./helpers');

function vazio(v) { return v === undefined || v === null || String(v).trim() === ''; }

function verificar(e, { corretoresAtivos = null } = {}) {
  const gal = asArray(e.gallery);
  const itens = [
    // passo = etapa do formulário onde o campo está (o painel leva direto até lá)
    { ok: !vazio(e.nome), txt: 'Nome do empreendimento', obrig: true, passo: 1 },
    { ok: !vazio(e.cidade) && !vazio(e.bairro), txt: 'Cidade e bairro', obrig: true, passo: 1 },
    { ok: !vazio(e.hero_image), txt: 'Foto de capa', obrig: true, passo: 2 },
    { ok: !vazio(e.dormitorios), txt: 'Dormitórios', obrig: true, passo: 3 },
    { ok: !vazio(e.descricao), txt: 'Texto "Sobre o empreendimento"', obrig: true, passo: 4 },
    { ok: !vazio(e.aviso_legal), txt: 'Registro de incorporação (aviso legal)', obrig: true, passo: 4 },
    { ok: gal.length >= 4, txt: 'Galeria com pelo menos 4 fotos', obrig: false, passo: 2 },
    { ok: !vazio(e.area), txt: 'Área privativa (sem ela aparece "Consulte")', obrig: false, passo: 3 },
    { ok: !vazio(e.preco_inicial), txt: 'Preço inicial (sem ele aparece "Sob consulta")', obrig: false, passo: 3 },
    { ok: asArray(e.plantas).length > 0, txt: 'Pelo menos uma planta', obrig: false, passo: 5 },
    { ok: asArray(e.infra).length >= 4, txt: 'Itens de lazer (4 ou mais)', obrig: false, passo: 5 },
    { ok: asArray(e.faq).length >= 3, txt: 'Perguntas frequentes (3 ou mais)', obrig: false, passo: 6 },
    { ok: !vazio(e.card_resumo), txt: 'Resumo do card na vitrine', obrig: false, passo: 7 },
    { ok: !vazio(e.ads_conversao) || !vazio(e.ga_id), txt: 'Medição (Google Ads ou GA4)', obrig: false, passo: 8 },
  ];
  if (corretoresAtivos !== null) {
    itens.push({ ok: corretoresAtivos > 0, txt: 'Corretores ativos na roleta', obrig: false, passo: null });
  }
  const faltaObrig = itens.filter(i => i.obrig && !i.ok);
  const total = itens.length;
  const feitos = itens.filter(i => i.ok).length;
  return { itens, faltaObrig, pronto: faltaObrig.length === 0, pct: Math.round((feitos / total) * 100) };
}

module.exports = { verificar };
