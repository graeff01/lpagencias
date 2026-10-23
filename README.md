# Auxiliadora Landings

Plataforma da Auxiliadora Predial: **cadastre um empreendimento** no painel e a **landing page é gerada automaticamente** numa URL própria (ex: `seusite.com/reserva-moinhos`). O **portal** na raiz do site (`seusite.com/`) apresenta a empresa e lista todos os empreendimentos publicados em cards, com filtros.

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
   | `ADMIN_PASSWORD` | a senha do painel `/admin` (acesso total) |
   | `CADASTRO_PASSWORD` | senha de quem só cadastra empreendimentos (opcional) |
   | `SESSION_SECRET` | uma string longa e aleatória |
   | `CLOUDINARY_CLOUD_NAME` | do painel do Cloudinary |
   | `CLOUDINARY_API_KEY` | do painel do Cloudinary |
   | `CLOUDINARY_API_SECRET` | do painel do Cloudinary |

   > `PORT` e `DATABASE_URL` o Railway define sozinho — **não precisa** criar.
5. **Deploy.** O Railway detecta o Node, roda `npm install` e `npm start`.
6. Em **Settings → Networking → Generate Domain** para ter a URL pública. Pronto: o painel fica em `sua-url/admin`.

### Domínio próprio
O domínio do site principal é o da variável `SITE_DOMINIO`: todo acesso por
outro endereço é redirecionado (301) para ele.

**Domínio de um empreendimento**: no cadastro (etapa *Publicação*), o campo
*Domínio próprio* liga um domínio ao empreendimento (ex.: `www.vangoghpetropolis.com.br`).
Com esse domínio apontado para este serviço no Railway, a raiz dele mostra a
landing como um site independente (canonical e sitemap próprios); `/<slug>`
nele volta para a raiz e as demais páginas vão para o domínio principal.
No portal a landing continua acessível pelo card, em `/<slug>`.

**Domínio principal** (o portal): `PORTAL_DOMINIO`, se definido. Senão, o
primeiro que não for domínio de empreendimento entre `SITE_DOMINIO`,
`RAILWAY_PUBLIC_DOMAIN` e o endereço padrão do Railway
(`<serviço>-<ambiente>.up.railway.app`, montado com variáveis que o Railway
injeta). Com domínio personalizado, o `RAILWAY_PUBLIC_DOMAIN` vem com ele, por
isso o endereço padrão entra como reserva. Na migração, o
empreendimento que era a "página inicial" herda o `SITE_DOMINIO` como domínio
próprio, então quem já ocupava a raiz continua nela.

Em **Settings → Networking → Custom Domain**, aponte o seu domínio (ex: `lancamentos.auxiliadora.com.br`) conforme as instruções do Railway.

---

## Cloudinary (fotos)

1. Crie uma conta grátis em <https://cloudinary.com>.
2. No **Dashboard**, copie `Cloud name`, `API Key` e `API Secret`.
3. Cole nas variáveis `CLOUDINARY_*` (local no `.env`, produção no Railway).

Sem o Cloudinary configurado, o upload fica desativado, mas você ainda pode **colar URLs** de imagens no formulário.

---

## Como usar

1. Acesse `/admin` e entre com a senha.
2. **Novo empreendimento** → preencha as 8 etapas (Identificação, Fotos, Valores, Textos, Plantas & lazer, Obra & FAQ, Vitrine & cores, Publicação). Dá para salvar de qualquer etapa.
3. Marque **Publicar** e salve. A landing fica no ar em `/<slug>` e o card entra sozinho na vitrine do portal.
4. Para editar, volte ao painel e clique em **Editar**. Rascunhos (não publicados) só aparecem para quem está logado.

### Pronto para publicar
A lateral do cadastro mostra o que falta. **Obrigatórios** (nome, cidade e bairro,
foto de capa, dormitórios, texto "Sobre" e registro de incorporação)
travam a *primeira* publicação: sem eles, o empreendimento é salvo como rascunho.
Quem já está no ar continua no ar; o painel só avisa. Os **recomendados**
(galeria, plantas, FAQ, resumo do card, medição, corretores) apenas avisam.

### Mapa e pontos próximos
Na etapa *Mapa, obra & FAQ*, o endereço é localizado sozinho num mapa com
alfinete arrastável (OpenStreetMap/Nominatim, sem chave). A partir do ponto,
o sistema busca o mais perto de cada categoria (supermercado, farmácia,
escola, saúde, faculdade, shopping, parque, banco, estação) e preenche as
etiquetas com nome e distância em linha reta. Quando a base não conhece o
número do prédio, o alfinete fica no meio da rua e o painel pede para
arrastar. Ao salvar um empreendimento com endereço e sem pontos, a lista é
montada em segundo plano.

### Perfis de acesso
- `ADMIN_PASSWORD`: tudo.
- `CADASTRO_PASSWORD`: cria e edita empreendimentos. **Não** vê corretores nem
  leads (dados pessoais), não exclui e não mexe no portal.

## Portal (página principal)

`/admin/portal` edita topo, números, persona, serviços, depoimentos, contato,
SEO e medição (GA4, Meta Pixel, conversão do Google Ads) da página principal.
Enquanto a configuração nunca foi salva, o painel avisa que o site está com
**textos de exemplo**.

- **Números**: `{{empreendimentos}}` e `{{cidades}}` são contados sozinhos.
- **Depoimentos**: a seção só aparece com pelo menos um. Use apenas depoimentos reais,
  com o texto original. O padrão traz avaliações 5 estrelas do Perfil da Empresa
  no Google (unidade Canoas Jardim do Lago) e o selo com a nota geral, cujas
  estrelas preenchem proporcionalmente à nota.
- **Card na vitrine**: selo, foto, resumo e ordem vêm da etapa *Vitrine & cores* de cada empreendimento.
- **Filtros** (cidade, dormitórios, fase, valor) aparecem a partir de 4 empreendimentos
  e ficam na URL: `/?cidade=canoas&dorm=3` pode ser destino de anúncio.
- **Páginas por região**: cada cidade e bairro com empreendimento publicado ganha
  uma página (`/canoas`, `/moinhos-de-vento`). Bairro com o mesmo nome em duas
  cidades recebe a cidade no endereço (`/centro-canoas`). Bairro com um
  empreendimento só fica fora do sitemap e com `noindex`.
- **WhatsApp do portal**: tem roleta própria (`/admin/corretores/0`, relatório em
  `/admin/leads/0`). No formulário do portal, quem escolhe um empreendimento vai
  para a roleta **daquele** empreendimento.
- **Campanhas**: UTMs e gclid da chegada acompanham o visitante nos cards, nos
  botões de WhatsApp e no "Conheça também" das landings, então o lead fica
  atribuído à campanha certa.

Os contatos do formulário abrem o **WhatsApp** do número cadastrado, com a mensagem já preenchida.

---

## Estrutura

```
server.js            # app Express (sessão, rotas, boot)
lib/db.js            # PostgreSQL: schema, migração, CRUD, seed
lib/cloudinary.js    # upload de imagens
lib/helpers.js       # formatação, slug, link do WhatsApp, cores
routes/public.js     # portal, páginas por região e landing pública /:slug
routes/admin.js      # login + CRUD + upload (protegido)
views/landing.ejs    # a landing page gerada (dinâmica)
views/portal.ejs     # página principal (portal + vitrine)
views/partials/card.ejs  # card do empreendimento (portal e "Conheça também")
lib/portal.js        # conteúdo do portal: padrões e validação
lib/checklist.js     # "pronto para publicar"
views/admin/*.ejs    # login, lista, formulário em etapas e portal
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

### Painel dos gestores (equipes)
Cada gestor entra em **`/gestor`** com usuário e senha próprios e vê só os
corretores da equipe dele: leads por corretor, participação, “não retornou”,
quebra por empreendimento e os últimos leads. Períodos: hoje, 7 dias, 30 dias,
este mês, mês passado e tudo (limites no horário de Brasília). Não dá acesso
ao painel de empreendimentos.

**Primeiro acesso:** senha criada pelo administrador é temporária. No primeiro
login o sistema pede uma senha nova e não mostra mais nada até ela ser trocada.
Depois, *Alterar senha* fica no topo do painel. Os acessos do Alberto
(`alberto`) e do Fabrício (`fabricio`) e as equipes deles são criados na
primeira subida (`cargasUnicas` em `lib/db.js`, só o hash da senha).

**Configurar:** `/admin/equipes` (aba *Equipes*) → cadastre o gestor (nome,
usuário, senha de 8+ caracteres) → na lista de corretores, escolha a equipe de
cada um → *Salvar equipes*. O botão **Ver painel** mostra exatamente o que o
gestor vê.

- O corretor é reconhecido pelo **WhatsApp**: quem está na roleta de vários
  empreendimentos aparece uma vez e os leads de todos somam para a equipe.
- Cada clique guarda o telefone de quem recebeu, então excluir o corretor de
  uma roleta não apaga o histórico da equipe. Cliques antigos são completados
  na subida do servidor.
- Bloquear ou excluir o gestor corta o acesso na hora, mesmo com ele logado.
- O nome e o telefone do cliente não passam pelo site: o painel conta pessoas
  que clicaram, e o contato fica no WhatsApp do corretor.

### Recepção (encaminhar leads de qualquer canal)
A recepção entra pelo mesmo login dos gestores (`/gestor`) e cai na tela
`/recepcao`, em três passos:

1. **Cola a mensagem** do lead (ou toca em *Colar do WhatsApp*). O sistema
   separa sozinho nome, telefone, e-mail, negócio, imóvel, origem e mensagem.
   Entende o formato do Leads Delivery/portais ("Novo cadastro recebido do ZAP
   para o imóvel 817210…"), o dos e-mails de portal (valor na linha de baixo,
   `<br>` na mensagem, bloco "Corretor Responsável") e, em texto livre, acha ao
   menos o telefone. Se a mensagem indica um corretor responsável que está na
   lista, ele aparece destacado.
2. **Confere** os campos. Nome e telefone são obrigatórios. Se o cliente já foi
   encaminhado antes, aparece um aviso com o corretor e a data (não bloqueia).
3. **Toca no corretor.** O WhatsApp abre com o lead organizado, com o link do
   cliente pronto para o corretor chamar. No computador abre o **WhatsApp Web**,
   sempre na mesma aba; no celular, o aplicativo. Dá para trocar no seletor
   *WhatsApp Web / Aplicativo* (a escolha fica salva no navegador).

- **Gerentes em destaque:** quem estiver marcado como *Gerente* no cadastro da
  recepção aparece num grupo próprio, no topo da lista (para campanhas cujos
  leads vão direto ao gerente). Alberto Ceballos e Fabrício Bilhalva entram
  assim na primeira subida; depois disso, a marcação é feita pelo painel.
- **Campanhas com roleta:** em `/admin/recepcao` → *Campanhas na recepção*, um
  empreendimento vira uma aba na tela dela. A aba mostra o **próximo da vez**,
  a fila e quem já recebeu; ela envia sempre para o próximo, e a vez é gravada
  na roleta do empreendimento. A fila é a mesma da landing page: lead do site e
  lead da recepção entram no mesmo rodízio, sem repetir corretor. O Nimbus
  entra assim, com as equipes do Alberto e do Fabrício (`lib/campanha-nimbus.js`),
  na primeira subida em que o empreendimento existir.
- **Configurar:** em `/admin/equipes`, crie um acesso do tipo *Recepção*. Em
  `/admin/recepcao` cadastre os corretores (nome e WhatsApp) ou use *Importar
  das roletas*. *Ocultar* tira o corretor da lista sem apagar os envios dele.
- **Métricas e auditoria:** `/admin/recepcao` mostra os envios por corretor e
  por canal e a lista de leads, com exportação em CSV. O painel do gestor mostra
  os leads encaminhados aos corretores da equipe, com os dados do cliente.
- **Dados pessoais (LGPD):** os leads da recepção ficam guardados com nome,
  telefone e e-mail do cliente. Só o administrador e o gestor da equipe do
  corretor veem esses dados.
- O leitor da mensagem fica em `public/js/lead-parser.js` (roda no navegador e
  no servidor). Um formato novo de mensagem se ensina por ali.

### SDR (ligações para a lista de clientes)
O SDR entra pelo mesmo login (`/gestor`) e cai em `/sdr`. A tela traz o
**cliente da vez** da lista, o **roteiro da ligação** ao lado e a **ficha de
qualificação**:

1. **Liga** (botão *Ligar* abre o discador; *WhatsApp* abre a conversa).
2. **Registra o resultado:** *Não atendeu* (volta para a fila depois de 3 h, até
   3 tentativas), *Ligar depois* (dia e hora; volta na frente quando vencer),
   *Sem interesse*, *Número errado* ou *Pediu para não ligar* (sai da lista e
   não volta numa nova importação).
3. **Interessado:** preenche a ficha (interesse, objetivo, faixa, pagamento,
   prazo, observações). O sistema classifica: **quente** (até 3 meses e faixa
   definida), **morno** (interesse sem prazo curto ou sem faixa) ou **frio**.
   Com a autorização do cliente marcada, toca no **próximo da vez do plantão**:
   o WhatsApp do corretor abre com a ficha e o link "Recebi".

- **Lista:** em `/admin/sdr` → *Importar contatos*, envie a planilha exportada
  do CRM (`.xlsx` ou `.csv`) ou cole a lista. As colunas de nome, telefone/
  celular e e-mail são achadas pelo cabeçalho (ou pelo conteúdo, sem
  cabeçalho); as outras colunas aparecem para o SDR na ligação. Telefone
  repetido não entra duas vezes. *Tirar não ligados* remove o que sobrou de
  uma importação.
- **Plantão:** rodízio próprio do SDR (começa com as equipes do Fabrício e do
  Alberto). O lead vai para quem recebeu menos; pausar e voltar não gera
  vários seguidos.
- **Sem confirmação:** envios do SDR sem "Recebi" depois de
  `RECEPCAO_COBRAR_MIN` aparecem na tela dele para *Lembrar* ou *Reencaminhar*
  (vai para o próximo do plantão, pulando quem não confirmou). Esses envios não
  aparecem na fila de cobrança da recepção.
- **Roteiro:** editável em `/admin/sdr` (`## Título`, `**negrito**`, `- item`;
  `[NOME]` e `[NOME DO CLIENTE]` são trocados na tela).
- **Números:** `/admin/sdr` mostra ligações, atendidas, qualificados e a taxa
  de qualificação por período, com exportação das ligações e da lista em CSV.
  Cada ligação entra na auditoria do lead. Os leads enviados aparecem também
  no painel do gestor do corretor (origem "Ligação SDR").
- **Ritmo do dia:** metas de ligações e qualificados (em `/admin/sdr` →
  *Metas do dia*) aparecem como barras no topo; o **cronômetro** mede cada
  ligação (começa ao tocar em *Ligar* ou no botão) e o tempo médio das
  atendidas entra nos números; aviso fora do horário de ligar (seg–sex 9h–20h,
  sáb 9h–14h); **Retornos de hoje** lista os "ligar depois" do dia.
- **Mensagens prontas ao cliente:** *Mensagem "tentei ligar"* (quando não
  atende) e, depois do envio, *Mandar mensagem ao cliente* avisando que o
  corretor vai chamar. Textos editáveis em `/admin/sdr` (`[NOME DO CLIENTE]`,
  `[NOME]`, `[CORRETOR]`).
- **Retorno do corretor:** o mesmo link do "Recebi" pergunta como está o
  atendimento (ainda não falou, conversando, visita agendada, proposta, fechou,
  sem perfil) e pode ser atualizado depois. Quem confirmou há mais de
  `SDR_RETORNO_HORAS` (padrão 24) sem contar aparece na tela do SDR para
  *Pedir retorno*. `/admin/sdr` e o painel do gestor mostram quantos leads
  viraram visita.
- **LGPD:** contatos sem ligação há mais de `LGPD_MESES` perdem nome, e-mail,
  colunas extras e telefone (quem pediu para não ligar mantém o telefone, para
  não ser chamado de novo).

### Fila "A encaminhar" (leads que chegam por e-mail)
Os e-mails de lead entram sozinhos numa fila no topo da tela da recepção, já
lidos pelo mesmo leitor da colagem. Ela clica em **Encaminhar** (os campos já
vêm preenchidos), escolhe o corretor ou a campanha e envia; o lead sai da fila
ligado ao envio. **Descartar** tira da fila com um motivo (spam, teste,
repetido). A fila mostra há quanto tempo cada lead espera (vermelho após 30 min),
avisa quando o cliente já foi enviado antes e se atualiza a cada 30 s.

O sistema **só lê** a caixa: não apaga, não move, não marca como lido. Cada
e-mail entra uma vez. Na primeira conexão, só o último dia é trazido.

**Três formas de ligar a caixa** (configuração em `.env.example`; status e
botão "Verificar agora" em Painel → Recepção → *Caixa de leads*):

1. **Gmail só leitura (recomendada).** No Google Cloud do Workspace da empresa:
   criar projeto → ativar *Gmail API* → tela de consentimento **Interna** →
   credencial *ID do cliente OAuth* (aplicativo da Web) com o redirect
   `https://SEU-DOMINIO/admin/recepcao/gmail/retorno`. Colocar
   `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no Railway e clicar em
   *Conectar Gmail* no painel, entrando com a conta da caixa. O acesso é só
   leitura e pode ser revogado na conta Google.
2. **IMAP com senha de app.** Conta com verificação em duas etapas → senha de
   app → `LEADS_IMAP_USER` / `LEADS_IMAP_PASS`. Mais simples, mas a senha abre
   a caixa inteira.
3. **Webhook.** Um serviço de recebimento (Cloudflare Email Routing, Postmark…)
   faz `POST /entrada/email` com `X-Leads-Token: <LEADS_WEBHOOK_TOKEN>` e JSON
   `{ message_id, from, subject, text | html | raw }`.

Nas formas 1 e 2, crie no Gmail o marcador **Leads** (ou o nome em
`LEADS_ROTULO`) e um filtro que aplique esse marcador aos e-mails de lead (pelo
remetente do portal ou pelo assunto). Serve tanto para a caixa da recepção
quanto para uma caixa só de leads.

### Link "Recebi" (confirmação do corretor)
Toda mensagem que a recepção manda ao corretor termina com um link
`/ok/<código>`. Abrir o link não confirma nada (a pré-visualização do WhatsApp
abre links sozinha); só o botão **Recebi o lead** confirma, e o primeiro
horário fica gravado. O gestor vê quem confirmou, o tempo médio até confirmar e
os que estão **sem confirmar** (vermelho após 1 h); o admin vê o mesmo na lista
de leads e no CSV (`confirmado_em`, `minutos_ate_confirmar`). O código é
aleatório (18 caracteres) e a página mostra só o primeiro nome do corretor e o
nome do cliente.

### Formulário padrão nas landings (antes do WhatsApp)
Todo botão de WhatsApp das landings e do portal abre um formulário curto
(**nome, WhatsApp e interesse**) antes da conversa. O corretor recebe a mensagem
sempre no mesmo formato (nome, WhatsApp, empreendimento, interesse e
**protocolo** `LP-XXXXXX`), e o lead fica gravado no clique e na auditoria
mesmo que a pessoa desista de mandar a mensagem. O mesmo **telefone** volta para
o mesmo corretor (mais firme que cookie ou IP). Quem já preencheu no navegador
não vê o formulário de novo (90 dias). Liga/desliga em Painel → Recepção →
*Formulário das landing pages*. Os relatórios de leads das páginas (gestor e
admin) e o CSV ganham nome, telefone, interesse e protocolo.

### Auditoria
- **Linha do tempo** (`/admin/auditoria`): busca por telefone (a partir de 4
  dígitos) ou nome e mostra, em ordem e com o tempo entre cada passo: e-mail
  chegou, recepção abriu, encaminhou (para quem), corretor abriu o link,
  confirmou, cobrança, reencaminhamento, formulário da landing. A tabela
  `lead_eventos` só aceita inclusão: no Postgres um gatilho recusa UPDATE e
  DELETE (exceto a anonimização da LGPD, que só apaga nome e telefone).
- **Sem confirmação** (tela da recepção): envios sem o "Recebi" há mais de
  `RECEPCAO_COBRAR_MIN` minutos (padrão 30). *Lembrar corretor* abre o WhatsApp
  dele com um lembrete e o mesmo link; *Reencaminhar* carrega o lead para outro
  corretor e o envio antigo fica marcado como "não confirmou · reencaminhado".
- **Fechamento** (Painel → Recepção, por período): chegaram por e-mail ×
  encaminhados × descartados × pendentes (a conta precisa fechar), colados à
  mão, formulários das landings, tempo de espera na fila (média, acima de 30 min,
  fora do horário, por recepcionista) e os descartes com motivo.
- **Alerta de caixa parada**: erro na leitura ou leitura parada aparece em
  vermelho para a recepção e o admin; muitas horas sem lead em horário
  comercial (`LEADS_ALERTA_HORAS`, padrão 4) aparece como aviso no admin.
- **LGPD**: uma vez por dia, nome, telefone, e-mail e mensagem de leads mais
  antigos que `LGPD_MESES` (padrão 12) são apagados; as contagens continuam.
- **Backups**: ative os backups automáticos do Postgres no Railway (plano Pro).

### Tabelas
- `corretores` — nome, telefone, peso, ativo, contador da fila.
- `cliques_whatsapp` — log de auditoria de cada clique (com o telefone de quem recebeu).
- `gestores` — usuário e senha (hash scrypt) de cada gestor.
- `equipe_corretores` — telefone do corretor → gestor.
- `agencia_corretores` — lista de corretores da recepção.
- `encaminhamentos` — cada lead encaminhado pela recepção, com os dados do cliente,
  o código do link "Recebi" e a hora da confirmação.
- `leads_entrada` — fila "A encaminhar" (e-mails importados, status e motivo de descarte).
- `config_kv` — configurações do painel (conexão do Gmail, formulário das landings).
- `lead_eventos` — linha do tempo de cada lead (só inclusão).

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

## Tour 3D a partir da planta (protótipo)
`/tour/nimbus-2d-a.html` monta o apartamento 2 dorm. com suíte do Nimbus em 3D,
no navegador, a partir das medidas da planta (`public/img/nimbus/planta-2d-a.jpg`,
125 px = 1 m). Paredes, portas e janelas estão em `PAREDES` e os ambientes em
`AMBIENTES`, em pixels da imagem; os móveis são peças simples posicionadas pela
planta. O cliente caminha (setas/WASD, arrastar para olhar, joystick no
celular), vê a maquete de cima, troca o horário (manhã, tarde, pôr do sol,
noite) e os acabamentos (piso, marcenaria, paredes). Usa three.js servido pelo
próprio site (`public/vendor/three`), sem serviço externo. É ilustrativo.

