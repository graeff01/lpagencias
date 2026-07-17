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
