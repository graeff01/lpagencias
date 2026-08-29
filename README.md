# Auxiliadora Landings

Plataforma da Auxiliadora Predial: **cadastre um empreendimento** no painel e a **landing page é gerada automaticamente** numa URL própria (ex: `seusite.com/reserva-moinhos`).

- **Stack:** Node + Express + EJS (sem React) · PostgreSQL · Cloudinary (fotos)
- **Painel** protegido por senha em `/admin`
- **Leads** caem direto no WhatsApp central da imobiliária
- Landing pages **responsivas** (desktop, tablet e celular)

---

## Como rodar localmente

```bash
npm install
cp .env.example .env      # e preencha as variáveis (veja abaixo)
npm start
```

- Site: <http://localhost:3000>
- Painel: <http://localhost:3000/admin>

> Sem `DATABASE_URL`, o app usa um banco **em memória** só para testes (os dados somem ao reiniciar). Um empreendimento de exemplo (**Reserva Moinhos**) é criado automaticamente.

---

## Subir no Railway (passo a passo)

1. **Suba o código no GitHub** (crie um repositório e faça push desta pasta).
2. Em <https://railway.app> → **New Project** → **Deploy from GitHub repo** → escolha o repositório.
3. Adicione o banco: **New** → **Database** → **Add PostgreSQL**. O Railway cria a variável `DATABASE_URL` e injeta no app automaticamente.
4. No serviço do app, abra **Variables** e adicione:

   | Variável | Valor |
   |---|---|
   | `ADMIN_PASSWORD` | a senha do painel `/admin` |
   | `SESSION_SECRET` | uma string longa e aleatória |
   | `CLOUDINARY_CLOUD_NAME` | do painel do Cloudinary |
   | `CLOUDINARY_API_KEY` | do painel do Cloudinary |
   | `CLOUDINARY_API_SECRET` | do painel do Cloudinary |

   > `PORT` e `DATABASE_URL` o Railway define sozinho — **não precisa** criar.
5. **Deploy.** O Railway detecta o Node, roda `npm install` e `npm start`.
6. Em **Settings → Networking → Generate Domain** para ter a URL pública. Pronto: o painel fica em `sua-url/admin`.

### Domínio próprio
Em **Settings → Networking → Custom Domain**, aponte o seu domínio (ex: `lancamentos.auxiliadora.com.br`) conforme as instruções do Railway.

---

## Cloudinary (fotos)

1. Crie uma conta grátis em <https://cloudinary.com>.
2. No **Dashboard**, copie `Cloud name`, `API Key` e `API Secret`.
3. Cole nas variáveis `CLOUDINARY_*` (local no `.env`, produção no Railway).

Sem o Cloudinary configurado, o upload fica desativado, mas você ainda pode **colar URLs** de imagens no formulário.

---

## Como usar

1. Acesse `/admin` e entre com a `ADMIN_PASSWORD`.
2. **Novo empreendimento** → preencha os dados, envie as fotos, defina as cores.
3. Marque **Publicar** e salve. A landing fica no ar em `/<slug>`.
4. Para editar, volte ao painel e clique em **Editar**. Rascunhos (não publicados) só aparecem para quem está logado.

Os contatos do formulário abrem o **WhatsApp** do número cadastrado, com a mensagem já preenchida.

---

## Estrutura

```
server.js            # app Express (sessão, rotas, boot)
lib/db.js            # PostgreSQL: schema, migração, CRUD, seed
lib/cloudinary.js    # upload de imagens
lib/helpers.js       # formatação, slug, link do WhatsApp, cores
routes/public.js     # home + landing pública /:slug
routes/admin.js      # login + CRUD + upload (protegido)
views/landing.ejs    # a landing page gerada (dinâmica)
views/home.ejs       # vitrine dos empreendimentos
views/admin/*.ejs    # login, lista e formulário
public/css, public/js
```

## Roleta de corretores (distribuição de leads)

Cada empreendimento pode ter sua própria lista de corretores. Todo botão de
WhatsApp da landing aponta para `/wa/:slug` — nunca para o `wa.me` direto.
É essa rota que escolhe o corretor da vez, grava o clique e só então redireciona.

**Painel:** `/admin/corretores/:id` (cadastro e fila) e `/admin/leads/:id`
(quantos leads cada um recebeu, com exportação em CSV).

### Como a vez é decidida
Entra sempre quem tem a **menor carga** (`leads recebidos ÷ peso`), com desempate
pelo lead mais antigo. Não é sorteio aleatório: é rodízio determinístico, então
com 10 corretores e 100 leads cada um recebe exatamente 10.

- **Peso**: `2` faz o corretor receber o dobro dos demais (útil para plantonista).
- **Pausar**: tira da fila sem apagar o histórico. Ao reativar, ele reentra no
  nível de quem está ativo hoje — não recebe de uma vez tudo o que perdeu.
- **Concorrência**: a escolha roda em transação com `pg_advisory_xact_lock` por
  empreendimento, então dois cliques no mesmo instante nunca caem no mesmo corretor.

### O que evita contagem injusta
- **Mesmo visitante = mesmo corretor por 24h.** Quem clica no botão do topo, no
  flutuante e no formulário conta como **1 lead**. O reconhecimento é por cookie
  e, se ele for limpo, pelo hash do IP no log.
- **Resgate automático.** Passadas 24h, o visitante que volta à landing e clica
  de novo é sinal de que ninguém retornou: ele vai para **outro** corretor, e o
  primeiro fica com um "não retornou" no relatório. É um sinal de
  responsividade que chega sozinho, sem pedir nada aos corretores — mas é
  indício, não prova: olhe a tendência, não o caso isolado.
- **Robôs** (Googlebot, preview do WhatsApp, curl…) não consomem vez da fila e
  ficam marcados como `bot` no relatório.
- **Números fora do HTML**: ninguém descobre o telefone dos corretores pelo
  código-fonte da página, e um corretor não consegue recarregar a página para
  “puxar” leads.
- **Log imutável**: `cliques_whatsapp` guarda data/hora, corretor, botão de
  origem, motivo da decisão e UTMs de cada clique — é a prova de que o rodízio
  foi justo.

### Tabelas
- `corretores` — nome, telefone, peso, ativo, contador da fila.
- `cliques_whatsapp` — log de auditoria de cada clique.

### Proteções contra erro
- **Lead nunca vira tela de erro.** Se a roleta falhar (banco fora do ar), o
  clique vai para o número reserva do empreendimento sem atribuição. Melhor um
  lead sem dono do que um lead perdido.
- **Número inválido é barrado no cadastro** (DDD, quantidade de dígitos, celular
  que não começa com 9, dígitos repetidos). Um telefone errado faria os leads
  daquele corretor sumirem sem ninguém perceber.
- **Número duplicado é barrado**: dois corretores no mesmo WhatsApp quebram a
  medição de quem recebeu o quê.
- **Corrida em duas camadas**: fila em memória dentro do processo + advisory
  lock no Postgres para o caso de mais de uma instância do app.
- **Login do painel**: 5 senhas erradas bloqueiam o IP por 15 minutos, e a
  sessão é regenerada no login (o painel guarda dados pessoais dos corretores).
- **Alerta de falha silenciosa** na tela de leads: avisa se não há corretor
  ativo ou se nenhum clique chega há mais de 48h.

### Testes
```bash
npm run test:roleta
```
Prova a distribuição igualitária (100 leads ÷ 10 corretores = 10 para cada), o
peso, o comportamento de pausa/reativação, 50 cliques simultâneos sem duplicar,
a validação de telefone e a detecção de robôs.
