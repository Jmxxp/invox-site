# Backend do INVOX

Projeto ativo: `wsfdwyghqqaerivyrbil`. Banco, bucket privado e função `invox-api` implantados em **17/11/2026**. O administrador `jmxxp` está cadastrado no Supabase Auth e autorizado no servidor. A configuração atual usa versão **1.1.0**, acesso público e aguarda os instaladores reais.

As migrações `20261117121558_invox_backend_init.sql`, `20261117124106_invox_analytics.sql`, `20261117125912_invox_download_sessions.sql`, `20261117175159_invox_analytics_generations.sql` e `20261117190431_invox_multipart_installers.sql` estão aplicadas. `schema.sql` preserva o snapshot completo sem credenciais; em um banco existente, use apenas migrações pendentes.

## Instalação em um banco vazio

1. Confirme acesso administrativo ao projeto alvo e inspecione tabelas, funções e políticas existentes. O snapshot cria recursos novos com prefixo `invox_`; em caso de colisão, reconcilie a estrutura antes de aplicar.
2. Aplique a migração inicial como uma única transação usando a conexão administrativa do Supabase e registre seu histórico.
3. Crie a conta do administrador pelo Supabase Auth no servidor. Associe o `user_id` real, o e-mail interno e o nome de usuário escolhido a `public.invox_admins`. Nenhuma conta recebe acesso por ser a primeira a entrar.
4. Publique a Edge Function `invox-api` e mantenha a chave administrativa somente nos segredos do servidor. O navegador usa apenas a chave publicável.
5. Valide o acesso autenticado, envie um feedback de teste e publique os instaladores reais pelo painel. Confira os advisors de segurança e desempenho após aplicar o esquema.

Todas as tabelas possuem RLS e negam acesso direto a `anon` e `authenticated`. A Edge Function valida a sessão com o Auth, confere `user_id` e `enabled` na lista de administradores e executa as operações pelo servidor. Dados editáveis de `user_metadata` não concedem autorização.

## Instaladores e liberação

O painel aceita instaladores de até **1,5 GiB (1.610.612.736 bytes)**. Arquivos grandes são divididos em **partes de 20 MiB**, cada uma armazenada como objeto privado separado. O limite global de 50 MiB por objeto permanece. Os formatos continuam EXE/MSI/ZIP, DMG/PKG/ZIP e APK.

O novo bucket privado `invox-installer-parts` tem limite de 20 MiB e MIME `application/octet-stream` e deve ser criado pela Storage API. O bucket legado `invox-installers` continua privado, com 50 MiB. A proposta antiga em `proposals/` não é necessária para o fluxo multipart.

A capacidade total continua contando. O orçamento conservador do servidor é **1.000.000.000 bytes** neste projeto. `INVOX_STORAGE_BUDGET_BYTES` só deve aumentar após confirmar uma capacidade real maior. O painel mostra espaço disponível e reservas transacionais, incluindo a capacidade integral da última parte. A versão nova precisa caber junto com a anterior durante a publicação. Um instalador de 1,5 GiB não cabe em 1 GB de armazenamento total. Consulte os [limites](https://supabase.com/docs/guides/storage/uploads/file-limits) e as [cotas](https://supabase.com/pricing).

O envio usa TUS em blocos de 6 MiB; o legado até 6 MiB usa PUT assinado. Após recarregar o painel, selecione novamente o mesmo arquivo, plataforma e versão para aproveitar as partes verificadas. Tokens não são persistidos e sair do painel interrompe o envio. O hash incremental lê blocos de 1 MiB. SDKs TUS 4.3.1 e hash-wasm 4.13.0 estão fixados localmente, com licenças e integridade verificadas.

Tokens assinados usam o endpoint TUS `/storage/v1/upload/resumable/sign`. A rota sem `/sign` é a de JWT/RLS e não autoriza esses uploads. O cliente valida também o host e a rota de cada `Location` antes de enviar novos blocos.

A API confere tamanho e SHA-256 dos bytes de cada parte. O banco fixa identidade e versão dos objetos e só publica manifestos completos. A troca é atômica e mantém plataformas omitidas. A limpeza respeita referências, downloads ativos e validade de autorizações.

No site, um ticket opaco de oito horas autoriza as partes; URLs assinadas de 60 segundos são emitidas quando necessárias. A página reúne o arquivo em fluxo, verifica cada parte e só libera a última após conferir o SHA-256 completo. Não há Blob do instalador inteiro. O navegador precisa suportar streams transferíveis com Service Worker ou File System Access. Mantenha a aba aberta; há cancelamento da transferência.

Os dois buckets continuam privados. Alterar acesso ou senha invalida tickets multipart; uma URL de parte já emitida pode durar até seu vencimento. O hash da senha nunca é retornado.

## Funções do banco

- `invox_take_rate_limit(p_key_hash text, p_category text, p_window_seconds integer, p_limit integer) → boolean`: incremento atômico de tentativas. Hash SHA-256 hexadecimal de 64 caracteres, categoria `[a-z][a-z0-9_-]{0,63}`, janela de 1 a 86400 segundos e limite de 1 a 10000. Limpa até mil contadores com mais de um dia por chamada.
- `invox_publish_release(p_version text, p_release_notes text, p_files jsonb, p_admin_id uuid) → void`: publicação atômica. O manifesto usa `[{"platform":"windows","path":"...","fileName":"INVOX.exe","size":123}]`. Aceita de zero a três plataformas sem repetição e exige correspondência com um upload autorizado.

As funções usam `SECURITY INVOKER`, `search_path` vazio e permissão de execução exclusiva de `service_role`. Nenhuma função privilegiada é exposta aos visitantes.

## Verificação realizada

Além dos testes isolados, a implantação real passou em login, autorização administrativa, CORS de `http://127.0.0.1:5500`, envio e classificação de feedback, upload, publicação de versão, download público e download privado por senha. O arquivo e o feedback temporários foram removidos.

A implantação multipart foi validada com **64 MiB reais**, em quatro objetos (20 + 20 + 20 + 4 MiB), via TUS assinado. Foram confirmadas a retomada da mesma sessão, a recuperação de confirmação perdida e a reconstrução por URLs assinadas, com SHA-256 idêntico ao original. O preview administrativo não publicou esse arquivo nas plataformas. Objetos, metadados, reservas e sessão temporária de teste foram removidos; o projeto voltou a zero bytes usados e reservados. A gravação do teste usou o helper real com sink de arquivo no Node; não houve teste interativo em navegador físico nesta sessão.

Todas as tabelas usam RLS, sem permissões diretas para visitantes, com RPCs restritas ao servidor e bucket privado. Os advisors não apontaram erros. Permanece um aviso de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); a disponibilidade dessa opção depende da configuração e do plano do projeto.

## Análises

`track-view` registra um carregamento visível do site publicado com um UUID temporário, reutilizado em tentativas de reenvio. Acessos locais ficam fora da contagem. São armazenados contadores horários agregados, sem cookies de análise, URLs completas ou identificação de visitantes. UUIDs de deduplicação com mais de um dia são limpos gradualmente.

O relatório `analytics` exige administrador. Hoje usa intervalos horários; 7 e 30 dias usam dias; 12 meses usa meses. Limites e rótulos seguem `America/Sao_Paulo`. O histórico começa em `analytics_started_at`; períodos anteriores à implantação não são recuperados. Downloads iniciados são URLs autorizadas pelo servidor, separados por plataforma; a conclusão da transferência não é medida.

O gráfico permite inspecionar os valores com uma linha vertical que acompanha o ponteiro. Tab entra no gráfico e as setas, Home e End percorrem os intervalos.

**Iniciar nova contagem** exige administrador e confirmação no painel. O servidor cria uma geração de contagem e registra seu instante inicial; não apaga os agregados anteriores. `invox_analytics_runs` guarda o histórico dos inícios e encerramentos, e os contadores usam a chave `(generation,bucket)`. A deduplicação dos acessos permanece global para não recontar um evento anterior reenviado. Eventos e reinícios coordenam o bloqueio da configuração antes de capturar o horário, permitindo um corte exato mesmo dentro da mesma hora. Totais e gráficos passam a consultar somente a geração atual.

O teste `tests/analytics-reset.sql` confirma contagem zerada, quatro períodos, histórico, deduplicação e permissões usando uma transação com rollback. Sua execução não reinicia a contagem real. A implantação preservou a geração inicial e o instante original da contagem.

## Sessões persistentes

O painel usa o armazenamento persistente do navegador com renovação de sessão pelo Supabase Auth. Uma sessão antiga do armazenamento da aba é migrada ao abrir o painel. **Sair** limpa a sessão.

O acesso privado dos visitantes usa um token aleatório por até 30 dias. O navegador guarda somente token e vencimento; o banco guarda seu hash e uma impressão da configuração protegida. Trocar a senha ou a visibilidade invalida o acesso anterior. **Encerrar acesso privado** remove o token do navegador e revoga esse token no servidor quando há conexão. Nenhuma senha é salva pelo site.
