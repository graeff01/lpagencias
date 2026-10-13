// Proteção contra tentativa em massa no login (painel e gestores).
// O painel guarda telefone e e-mail dos corretores: senha sem limite de
// tentativas seria força bruta livre. 5 erros = 15 min de bloqueio por IP.
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const tentativas = new Map();

function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

// Minutos restantes de bloqueio (0 = liberado).
function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t) return 0;
  if (t.ate && t.ate > Date.now()) return Math.ceil((t.ate - Date.now()) / 60000);
  if (t.ate && t.ate <= Date.now()) tentativas.delete(ip);
  return 0;
}

function registrarFalha(ip) {
  const t = tentativas.get(ip) || { n: 0, ate: 0 };
  t.n += 1;
  if (t.n >= MAX_TENTATIVAS) { t.ate = Date.now() + BLOQUEIO_MS; t.n = 0; }
  tentativas.set(ip, t);
}

function limpar(ip) {
  tentativas.delete(ip);
}

// Limpeza periódica para o Map não crescer sem limite.
setInterval(() => {
  const agora = Date.now();
  for (const [ip, t] of tentativas) if (!t.ate || t.ate < agora) tentativas.delete(ip);
}, 30 * 60 * 1000).unref();

module.exports = { ipDe, bloqueado, registrarFalha, limpar };
