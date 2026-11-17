# Backend do INVOX

Projeto ativo: `wsfdwyghqqaerivyrbil`. Banco, buckets privados e função `invox-api` implantados em **17/11/2026**. O administrador `jmxxp` está cadastrado no Supabase Auth e autorizado no servidor. Acesso, versões e instaladores publicados são gerenciados no painel.

As migrações SQL deste repositório reúnem backend, análises, sessões de acesso, uploads multipart, feedback do jogo, recados, Realtime e histórico de versões. As duas migrações do jogo foram aplicadas em 17/11/2026; multipart, Realtime e histórico também estão presentes no projeto alvo. `schema.sql` preserva o snapshot completo sem credenciais; em um banco existente, consulte o histórico e use apenas migrações pendentes. A função mesclada foi implantada como versão 8, SHA-256 `1fbe910ddf2aa48c3b3a9debdc40a5766eb19403fd9eb5bf554c45a380f0b57d`; o registro da versão 6 abaixo descreve a primeira validação.

## Instalação em um banco vazio

1. Confirme acesso administrativo ao projeto alvo e inspecione tabelas, funções e políticas existentes. O snapshot cria recursos novos com prefixo `invox_`; em caso de colisão, reconcilie a estrutura antes de aplicar.
2. Aplique a migração inicial como uma única transação usando a conexão administrativa do Supabase e registre seu histórico.
3. Crie a conta do administrador pelo Supabase Auth no servidor. Associe o `user_id` real, o e-mail interno e o nome de usuário escolhido a `public.invox_admins`. Nenhuma conta recebe acesso por ser a primeira a entrar.
4. Publique a Edge Function `invox-api` e mantenha a chave administrativa somente nos segredos do servidor. O navegador usa apenas a chave publicável.
5. Valide o acesso autenticado, envie um feedback de teste e publique os instaladores reais pelo painel. Confira os advisors de segurança e desempenho após aplicar o esquema.

Todas as tabelas possuem RLS e negam acesso direto a `anon` e `authenticated`. A Edge Function valida a sessão com o Auth, confere `user_id` e `enabled` na lista de administradores e executa as operações pelo servidor. Dados editáveis de `user_metadata` não concedem autorização.

## Instaladores e liberação

A migração `20261117210300_invox_download_access_codes.sql` separa a chave universal dos códigos de download. `download_universal_enabled` permite desativar a chave e manter o modo privado usando somente códigos. Alterações da chave invalidam sessões universais antigas; a geração de modo é independente, preservando transferências por código durante uma troca de chave.

`create-download-code` e `revoke-download-code` exigem administrador. A criação recebe UUID idempotente, identificação opcional, `maxUses` de 1 a 1000 (padrão 1) e validade opcional em horas. A chave HMAC `INVOX_ACCESS_CODE_SECRET` fica nos segredos da Edge Function e deve ser preservada; códigos completos não são armazenados no banco nem enviados pelo Realtime. `admin-state` retorna somente metadados de até cem códigos recentes.

Em modo privado, `download` aceita `{platform,code,requestId}`. O UUID deve permanecer igual ao repetir uma tentativa cujo resultado é desconhecido; iniciar um download novo exige outro UUID. O servidor valida e assina antes de confirmar o resgate em uma transação com bloqueios: uma autorização lógica gasta um uso, mesmo em instaladores multipart. Um resultado perdido pode ser recuperado pela mesma tentativa por até oito horas. Revogação, expiração e esgotamento bloqueiam novas tentativas. Códigos não emitem `accessSession`; somente a chave universal mantém a sessão de trinta dias. Em modo público, nenhum uso de código é descontado.

As tabelas de códigos e autorizações têm RLS e não permitem leitura ou resgate direto por visitantes autenticados ou anônimos. `tests/download-access-codes.sql` verifica contagem, retomada, troca de chave, isolamento de gerações, partes e permissões usando rollback, sem alterar instaladores ou contadores reais.

A geração em lote usa `create-download-codes` com `{id,count,label,maxUses,validForHours}`. A quantidade é de 1 a 100 tokens, gerados atomicamente, e os mesmos parâmetros e UUID recuperam o mesmo lote após uma falha de conexão. Uma criação confirmada exige outro UUID para gerar novos tokens. A resposta contém `codes`, `entries` e `downloadCodes`; o banco guarda somente metadados e hashes. O endpoint individual anterior continua compatível.

Novas emissões usam seis caracteres alfanuméricos sem prefixo, com resolução de colisões, derivação privada no servidor e versão de formato registrada. Os códigos legados continuam aceitos. `download-code-pool` exige administrador e separa disponíveis, usados, inativos e legados; somente códigos curtos são recuperados para exibição no painel. O servidor não publica os códigos em eventos Realtime nem nas respostas públicas.

`select-copy-download-codes` exige administrador e recebe `{count,excludeIds}`: de 1 a 100 itens, com até 500 UUIDs já copiados na sessão. A seleção consulta tokens curtos ativos com `used_count=0`, respeita expiração no relógio do servidor, ordena por criação e retorna até a quantidade solicitada. Tokens usados deixam essa fila mesmo quando possuem saldo para o destinatário original. Copiar não reserva, revoga nem consome uso. A resposta contém `codes`, `entries`, `evaluatedAt`, `availableCount` e `totalEligible`; uma fila vazia retorna listas vazias.

O campo único do visitante envia `{platform,accessCode,requestId}`. O servidor reconhece a chave universal ou o token e informa `accessMethod` na resposta. Somente a confirmação `universal` pode criar uma sessão persistente no cliente; a credencial explícita não usa uma autorização universal antiga para ignorar o código informado. Os corpos anteriores com `password` ou `code` permanecem aceitos.

O painel aceita instaladores de até **1,5 GiB (1.610.612.736 bytes)**. Arquivos grandes são divididos em **partes de 20 MiB**, cada uma armazenada como objeto privado separado. O limite global de 50 MiB por objeto permanece. Os formatos continuam EXE/MSI/ZIP, DMG/PKG/ZIP e APK.

O novo bucket privado `invox-installer-parts` tem limite de 20 MiB e MIME `application/octet-stream` e deve ser criado pela Storage API. O bucket legado `invox-installers` continua privado, com 50 MiB. A proposta antiga em `proposals/` não é necessária para o fluxo multipart.

A capacidade total continua contando. O orçamento conservador do servidor é **1.000.000.000 bytes** neste projeto. `INVOX_STORAGE_BUDGET_BYTES` só deve aumentar após confirmar uma capacidade real maior. O painel mostra espaço disponível e reservas transacionais, incluindo a capacidade integral da última parte. A versão nova precisa caber junto com a anterior durante a publicação. Um instalador de 1,5 GiB não cabe em 1 GB de armazenamento total. Consulte os [limites](https://supabase.com/docs/guides/storage/uploads/file-limits) e as [cotas](https://supabase.com/pricing).

O envio usa TUS em blocos de 6 MiB; o legado até 6 MiB usa PUT assinado. Após recarregar o painel, selecione novamente o mesmo arquivo, plataforma e versão para aproveitar as partes verificadas. Tokens não são persistidos e sair do painel interrompe o envio. O hash incremental lê blocos de 1 MiB. SDKs TUS 4.3.1 e hash-wasm 4.13.0 estão fixados localmente, com licenças e integridade verificadas.

Tokens assinados usam o endpoint TUS `/storage/v1/upload/resumable/sign`. A rota sem `/sign` é a de JWT/RLS e não autoriza esses uploads. O cliente valida também o host e a rota de cada `Location` antes de enviar novos blocos.

A API confere tamanho e SHA-256 dos bytes de cada parte. O banco fixa identidade e versão dos objetos e só publica manifestos completos. A troca é atômica e mantém plataformas omitidas. A limpeza respeita referências, downloads ativos e validade de autorizações.

No site, um ticket opaco de oito horas autoriza as partes; URLs assinadas de 60 segundos são emitidas quando necessárias. A página reúne o arquivo em fluxo, verifica cada parte e só libera a última após conferir o SHA-256 completo. Não há Blob do instalador inteiro. O navegador precisa suportar streams transferíveis com Service Worker ou File System Access. Mantenha a aba aberta; há cancelamento da transferência.

Os dois buckets continuam privados. Alterar acesso ou senha invalida tickets multipart; uma URL de parte já emitida pode durar até seu vencimento. O hash da senha nunca é retornado.

## Funções do banco

A migração `20261117200708_invox_installer_version_history.sql` permite `files[].version` independente da versão geral em `save-release`, com fallback para a geral nos clientes antigos. `update-installer-version` altera somente a versão exibida da plataforma e retorna o estado administrativo atualizado, sem reenviar o arquivo. Plataforma, proprietário, tamanho, caminho e hash continuam validados; a versão original do upload não muda.

`invox_installer_history` permite somente acréscimos, com RLS e leitura/inserção restritas ao servidor. `invox_installers.current_history_id` aponta o registro atual exato, inclusive quando um número de versão anterior é reutilizado. Cada edição ou publicação grava horário do servidor; repetições da mesma edição são idempotentes. A limpeza de objetos não remove o histórico. O estado administrativo inclui os últimos 100 registros; o site público não recebe esse histórico. O backfill preserva o timestamp conhecido dos instaladores atuais e os marca como importados.

A validação em rollback usou o instalador Windows real para conferir versão independente, alteração sem bytes, repetição idempotente, retorno a um número anterior, ponteiro atual e autorização. O arquivo e a versão pública permaneceram intactos.

- `invox_take_rate_limit(p_key_hash text, p_category text, p_window_seconds integer, p_limit integer) → boolean`: incremento atômico de tentativas. Hash SHA-256 hexadecimal de 64 caracteres, categoria `[a-z][a-z0-9_-]{0,63}`, janela de 1 a 86400 segundos e limite de 1 a 10000. Limpa até mil contadores com mais de um dia por chamada.
- `invox_publish_release(p_version text, p_release_notes text, p_files jsonb, p_admin_id uuid) → void`: publicação atômica. O manifesto usa `[{"platform":"windows","path":"...","fileName":"INVOX.exe","size":123}]`. Aceita de zero a três plataformas sem repetição e exige correspondência com um upload autorizado.

As funções usam `SECURITY INVOKER`, `search_path` vazio e permissão de execução exclusiva de `service_role`. Nenhuma função privilegiada é exposta aos visitantes.

## Verificação realizada

Além dos testes isolados, a implantação real passou em login, autorização administrativa, CORS de `http://127.0.0.1:5500`, envio e classificação de feedback, upload, publicação de versão, download público e download privado por senha. O arquivo e o feedback temporários foram removidos.

As tabelas do INVOX usam RLS, sem permissões diretas para visitantes, com RPCs restritas ao servidor e bucket privado. Os advisors não apontaram erros. Permanece um aviso de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); a disponibilidade dessa opção depende da configuração e do plano do projeto. Nenhuma opção global de conta ou plano foi alterada nesta revisão.

Na versão 6, as duas migrações do jogo foram aplicadas em transação e `tests/game-feedback.sql` passou com rollback. O teste HTTPS real de `GameCommunityService` e `FeedbackClient` passou em sete verificações e confirmou no banco os dois registros temporários com tipos `feedback`/`suggestion`, origem `game` e contato nulo. A limpeza removeu somente esses dois UUIDs. Não publicou recado para jogadores. Evidências locais: `D:/INVOX/Temporarios/community_https_20261117` e `D:/INVOX/Temporarios/invox-backend-20261117/game-feedback-end-to-end.json`.

As proteções adicionais passaram nos 24 testes locais mesclados e em 14 verificações isoladas, sem chamadas de produção nesses testes: corpo JSON limitado a 32 KiB e 5 s, chamadas de backend com prazo de 15 s, até 64 requests ativos por instância, controles de frequência e validação de versão/manifesto/origem/bucket antes de assinar um instalador. Consultas públicas têm cache interno de 2 s, invalidado nas edições administrativas; login e links temporários não entram nesse cache. `verify_jwt=false` foi preservado porque ações públicas atendem visitantes e jogo; ações administrativas continuam validando Auth e a lista de administradores internamente. Frontend/CDN publicado pelo Actions do commit `b2b0326`; recursos e `game-state` conferidos por HTTPS. O teste visual de login administrativo não foi repetido.

A implantação multipart foi validada com **64 MiB reais**, em quatro objetos (20 + 20 + 20 + 4 MiB), via TUS assinado. Foram confirmadas a retomada da mesma sessão, a recuperação de confirmação perdida e a reconstrução por URLs assinadas, com SHA-256 idêntico ao original. O preview administrativo não publicou esse arquivo nas plataformas. Objetos, metadados, reservas e sessão temporária de teste foram removidos; o projeto voltou a zero bytes usados e reservados. A gravação do teste usou o helper real com sink de arquivo no Node; não houve teste interativo em navegador físico nesta sessão.

Todas as tabelas usam RLS, sem permissões diretas para visitantes, com RPCs restritas ao servidor e bucket privado. Os advisors não apontaram erros. Permanece um aviso de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); a disponibilidade dessa opção depende da configuração e do plano do projeto.

## Realtime

A migração `20261117194612_invox_realtime_updates.sql` está aplicada. Triggers enviam apenas invalidações `{scope}` com `realtime.send`: `invox:site` público para acesso/versões/instaladores, e `invox:admin` privado para feedbacks, análises e configurações. Não há assinatura de linhas via Postgres Changes. O SDK descarta metadados extras de transporte e consulta novamente a API.

O helper `invox_private.realtime_admin()` verifica a identidade atual e a allowlist, com e-mail confirmado. O schema não é exposto à Data API. Policies de leitura e guards restritivos em `realtime.messages` protegem o tópico administrativo sem conceder leitura das tabelas de negócio. Clientes não podem publicar nesse tópico. A autorização do canal é cacheada pelo Realtime; a API revalida o administrador a cada busca, e os eventos não contêm dados privados.

Na implantação, WebSockets reais receberam eventos de criação/alteração de feedback, configurações, instaladores e análises. O cliente anônimo foi recusado no canal privado; um canal público com o mesmo nome não recebeu seus eventos. O feedback temporário foi removido e os valores de configuração/contadores foram preservados. `tests/realtime-authorization.sql` valida permissões em rollback. Os testes de interface cobrem reconexão, agrupamento de eventos, rascunhos e downloads ativos.

## Análises

`track-view` registra um carregamento visível do site publicado com um UUID temporário, reutilizado em tentativas de reenvio. Acessos locais ficam fora da contagem. São armazenados contadores horários agregados, sem cookies de análise, URLs completas ou identificação de visitantes. UUIDs de deduplicação com mais de um dia são limpos gradualmente.

O relatório `analytics` exige administrador. Hoje usa intervalos horários; 7 e 30 dias usam dias; 12 meses usa meses. Limites e rótulos seguem `America/Sao_Paulo`. O histórico começa em `analytics_started_at`; períodos anteriores à implantação não são recuperados. Downloads iniciados são URLs autorizadas pelo servidor, separados por plataforma; a conclusão da transferência não é medida.

O gráfico permite inspecionar os valores com uma linha vertical que acompanha o ponteiro. Tab entra no gráfico e as setas, Home e End percorrem os intervalos.

**Iniciar nova contagem** exige administrador e confirmação no painel. O servidor cria uma geração de contagem e registra seu instante inicial; não apaga os agregados anteriores. `invox_analytics_runs` guarda o histórico dos inícios e encerramentos, e os contadores usam a chave `(generation,bucket)`. A deduplicação dos acessos permanece global para não recontar um evento anterior reenviado. Eventos e reinícios coordenam o bloqueio da configuração antes de capturar o horário, permitindo um corte exato mesmo dentro da mesma hora. Totais e gráficos passam a consultar somente a geração atual.

O teste `tests/analytics-reset.sql` confirma contagem zerada, quatro períodos, histórico, deduplicação e permissões usando uma transação com rollback. Sua execução não reinicia a contagem real. A implantação preservou a geração inicial e o instante original da contagem.

## Mensagens do site e do jogo

Implementação ativa pela migração `20261117193242_invox_game_feedback.sql` e pela função versão 6. A migração acrescenta `kind` e `source`, torna o contato histórico opcional e preserva as políticas privadas existentes. Os contatos antigos continuam disponíveis somente aos administradores; novos envios não guardam contato, mesmo quando um cliente antigo ainda manda esse campo.

`POST https://wsfdwyghqqaerivyrbil.supabase.co/functions/v1/invox-api`, com `Content-Type: application/json` e a chave publicável já usada pelo site, aceita:

```json
{"action":"feedback","name":"Jogador","message":"Conteúdo da mensagem com pelo menos 10 caracteres.","kind":"feedback","source":"game"}
```

`kind` aceita `feedback` (ajuda, problema ou comentário) e `suggestion` (ideia para o jogo); `source` aceita `game` e `site`. Clientes antigos sem esses campos recebem os padrões `feedback` e `site`. O nome deve ter 2–80 caracteres e a mensagem 10–2000, após aparar espaços. Não é necessária sessão do jogador. A resposta HTTP 201 contém somente `{"id":"UUID"}`; o cliente só confirma o envio ao receber esse recibo. Erros seguem `{"error":{"code":"...","message":"..."}}`; o limite continua em cinco envios por hora, com HTTP 429 e `Retry-After`. O campo opcional `website` é uma armadilha antispam e deve ficar vazio.

O painel mostra tipo e origem, permite filtrar ajuda/feedback e sugestões e mantém o contador de novas mensagens. Enquanto uma sessão administrativa estiver aberta, atualiza a cada 20 segundos. A carga inicial não anuncia registros antigos, e o mesmo ID não gera avisos repetidos na sessão. Notificações do navegador dependem de ativação explícita no botão do painel e da permissão do navegador; não há envio de e-mail, WhatsApp ou outro canal externo. Navegadores sem notificações continuam mostrando os contadores. As anotações são internas e marcar como tratado não envia resposta ao jogador.

## Recados e atualizações dentro do jogo

`20261117194103_invox_game_announcements.sql` criou a tabela privada `invox_announcements`, com RLS e acesso exclusivo de `service_role`. A função verifica a sessão e a lista de administradores antes de qualquer publicação ou alteração. O painel preparado permite publicar um novo recado para todos e desativar ou reativar recados anteriores. Título: 1–100 caracteres; mensagem: 1–2000 caracteres, contados como pontos de código Unicode. Cada publicação cria um ID novo. Reativar um ID não obriga quem já o fechou a ler novamente.

- `save-announcement` recebe `{title,message}` e exige sessão administrativa. Retorna HTTP 201 com `{id,title,message,active,publishedAt,updatedAt}`. Limite de dez publicações por minuto.
- `set-announcement-active` recebe `{id,active}` e exige sessão administrativa. Retorna HTTP 200 com o registro atualizado.
- `game-state` é público e retorna HTTP 200 com `{version,visibility,releaseNotes,installers,announcements}`. `installers` inclui Windows, macOS e Android com `{platform,available}` e, quando disponível, `{fileName,size,version,updatedAt}`. `announcements` contém os vinte recados ativos mais recentes com `{id,title,message,publishedAt}`. A resposta não inclui caminhos privados do Storage, URLs assinadas, contatos, anotações ou dados administrativos.

O jogo deve comparar a versão do instalador da própria plataforma. Para baixar ao clicar em atualizar, use a ação existente `download` com `{platform,password?,accessToken?}`. O sucesso HTTP 200 contém `{url,fileName,expiresIn:60,accessSession?}`; `accessSession`, quando presente, contém `{token,expiresAt}`. O código `password_required` usa HTTP 401; `invalid_password`, HTTP 403; instalador ausente usa `unavailable`, HTTP 404. A URL assinada vale 60 segundos para iniciar a transferência. O endpoint preserva as regras de acesso privado e os limites reais do armazenamento.

Os recados são consultados pelo jogo aberto e conectado; não há serviço em segundo plano ou notificação para um jogo fechado. OK e X fecham o recado no cliente, que guarda os IDs já descartados localmente. Banco e função estão ativos no projeto confirmado `wsfdwyghqqaerivyrbil`; a interface web desta revisão ainda aguarda publicação. Nenhum novo instalador do jogo foi criado por esse processo.

## Sessões persistentes

O painel usa o armazenamento persistente do navegador com renovação de sessão pelo Supabase Auth. Uma sessão antiga do armazenamento da aba é migrada ao abrir o painel. **Sair** limpa a sessão.

O acesso privado dos visitantes usa um token aleatório por até 30 dias. O navegador guarda somente token e vencimento; o banco guarda seu hash e uma impressão da configuração protegida. Trocar a senha ou a visibilidade invalida o acesso anterior. **Encerrar acesso privado** remove o token do navegador e revoga esse token no servidor quando há conexão. Nenhuma senha é salva pelo site.
