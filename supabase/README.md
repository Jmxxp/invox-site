# Backend do INVOX

Projeto ativo: `wsfdwyghqqaerivyrbil`. Banco, bucket privado e função `invox-api` implantados em **17/11/2026**. O administrador `jmxxp` está cadastrado no Supabase Auth e autorizado no servidor. A configuração atual usa versão **1.1.0**, acesso público e aguarda os instaladores reais.

As migrações `20261117121558_invox_backend_init.sql`, `20261117124106_invox_analytics.sql`, `20261117125912_invox_download_sessions.sql` e `20261117175159_invox_analytics_generations.sql` estão aplicadas. `schema.sql` preserva o snapshot completo sem credenciais; em um banco existente, use apenas migrações pendentes.

## Instalação em um banco vazio

1. Confirme acesso administrativo ao projeto alvo e inspecione tabelas, funções e políticas existentes. O snapshot cria recursos novos com prefixo `invox_`; em caso de colisão, reconcilie a estrutura antes de aplicar.
2. Aplique a migração inicial como uma única transação usando a conexão administrativa do Supabase e registre seu histórico.
3. Crie a conta do administrador pelo Supabase Auth no servidor. Associe o `user_id` real, o e-mail interno e o nome de usuário escolhido a `public.invox_admins`. Nenhuma conta recebe acesso por ser a primeira a entrar.
4. Publique a Edge Function `invox-api` e mantenha a chave administrativa somente nos segredos do servidor. O navegador usa apenas a chave publicável.
5. Valide o acesso autenticado, envie um feedback de teste e publique os instaladores reais pelo painel. Confira os advisors de segurança e desempenho após aplicar o esquema.

Todas as tabelas possuem RLS e negam acesso direto a `anon` e `authenticated`. A Edge Function valida a sessão com o Auth, confere `user_id` e `enabled` na lista de administradores e executa as operações pelo servidor. Dados editáveis de `user_metadata` não concedem autorização.

## Instaladores e liberação

O limite ativo é **50 MiB** por arquivo. O código aceita configurar até **1,5 GB (1.610.612.736 bytes)** por `INVOX_UPLOAD_LIMIT_BYTES` quando banco e Storage suportarem esse tamanho; valores ausentes ou inválidos preservam o padrão de 50 MiB. Os formatos são EXE/MSI/ZIP no Windows, DMG/PKG/ZIP no macOS e APK no Android. O bucket `invox-installers` permanece privado e aceita apenas `application/octet-stream`.

**Proposta não aplicada:** em 17/11/2026 a Management API confirmou que a organização `dhkdnkulbjafrouchbqy` está no plano Free, com limite global e bucket de 52.428.800 bytes. A proposta `proposals/invox_installer_limit_1_5gb.sql` permanece fora da cadeia de migrações ativas. O painel usa o limite informado pelo servidor, portanto não anuncia 1,5 GB enquanto o armazenamento ativo ainda bloqueia esse tamanho.

Para liberar o novo limite, é necessário um plano compatível. Depois, configure `fileSizeLimit` global em 1.610.612.736 bytes, promova a proposta para uma nova migração e configure o mesmo limite na função. Confirme o limite global, o bucket, as duas restrições de tamanho, a RPC de publicação e `admin-state` antes de enviar um instalador grande. Consulte os [limites do Supabase](https://supabase.com/docs/guides/storage/uploads/file-limits).

Arquivos de até 6 MiB usam PUT assinado. Os maiores usam TUS com blocos de 6 MiB, progresso e retentativas em memória, sem carregar o arquivo inteiro em um ArrayBuffer. A biblioteca oficial `tus-js-client` 4.3.1 está fixada em `shared/vendor/`, com licença e integridade verificadas. O token de upload não é persistido no navegador; a retomada ocorre durante as tentativas da mesma transferência. O token assinado vale duas horas; uma tentativa após sua expiração pode exigir um novo envio autorizado.

Políticas restritivas para esse bucket impedem que regras amplas existentes abram os arquivos para clientes. Outros buckets não são afetados. O servidor emite tokens de upload para caminhos novos e URLs de download de curta duração. O modo privado valida a senha no servidor antes de emitir a URL; seu hash nunca é retornado. Uma URL já emitida permanece válida até vencer.

A publicação confere o manifesto contra `invox_uploads`: administrador, plataforma, caminho, nome, tamanho e versão. A API também confirma o tamanho real do objeto no Storage antes da transação. Plataformas omitidas preservam o instalador anterior. Arquivos antigos e uploads abandonados não são excluídos automaticamente; a limpeza deve respeitar os objetos ainda referidos por `invox_installers`.

## Funções do banco

- `invox_take_rate_limit(p_key_hash text, p_category text, p_window_seconds integer, p_limit integer) → boolean`: incremento atômico de tentativas. Hash SHA-256 hexadecimal de 64 caracteres, categoria `[a-z][a-z0-9_-]{0,63}`, janela de 1 a 86400 segundos e limite de 1 a 10000. Limpa até mil contadores com mais de um dia por chamada.
- `invox_publish_release(p_version text, p_release_notes text, p_files jsonb, p_admin_id uuid) → void`: publicação atômica. O manifesto usa `[{"platform":"windows","path":"...","fileName":"INVOX.exe","size":123}]`. Aceita de zero a três plataformas sem repetição e exige correspondência com um upload autorizado.

As funções usam `SECURITY INVOKER`, `search_path` vazio e permissão de execução exclusiva de `service_role`. Nenhuma função privilegiada é exposta aos visitantes.

## Verificação realizada

Além dos testes isolados, a implantação real passou em login, autorização administrativa, CORS de `http://127.0.0.1:5500`, envio e classificação de feedback, upload, publicação de versão, download público e download privado por senha. O arquivo e o feedback temporários foram removidos.

As nove tabelas usam RLS, sem permissões diretas para visitantes, com RPCs restritas ao servidor e bucket privado. Os advisors não apontaram erros. Permanece um aviso de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); a disponibilidade dessa opção depende da configuração e do plano do projeto.

## Análises

`track-view` registra um carregamento visível do site publicado com um UUID temporário, reutilizado em tentativas de reenvio. Acessos locais ficam fora da contagem. São armazenados contadores horários agregados, sem cookies de análise, URLs completas ou identificação de visitantes. UUIDs de deduplicação com mais de um dia são limpos gradualmente.

O relatório `analytics` exige administrador. Hoje usa intervalos horários; 7 e 30 dias usam dias; 12 meses usa meses. Limites e rótulos seguem `America/Sao_Paulo`. O histórico começa em `analytics_started_at`; períodos anteriores à implantação não são recuperados. Downloads iniciados são URLs autorizadas pelo servidor, separados por plataforma; a conclusão da transferência não é medida.

O gráfico permite inspecionar os valores com uma linha vertical que acompanha o ponteiro. Tab entra no gráfico e as setas, Home e End percorrem os intervalos.

**Iniciar nova contagem** exige administrador e confirmação no painel. O servidor cria uma geração de contagem e registra seu instante inicial; não apaga os agregados anteriores. `invox_analytics_runs` guarda o histórico dos inícios e encerramentos, e os contadores usam a chave `(generation,bucket)`. A deduplicação dos acessos permanece global para não recontar um evento anterior reenviado. Eventos e reinícios coordenam o bloqueio da configuração antes de capturar o horário, permitindo um corte exato mesmo dentro da mesma hora. Totais e gráficos passam a consultar somente a geração atual.

O teste `tests/analytics-reset.sql` confirma contagem zerada, quatro períodos, histórico, deduplicação e permissões usando uma transação com rollback. Sua execução não reinicia a contagem real. A implantação preservou a geração inicial e o instante original da contagem.

## Sessões persistentes

O painel usa o armazenamento persistente do navegador com renovação de sessão pelo Supabase Auth. Uma sessão antiga do armazenamento da aba é migrada ao abrir o painel. **Sair** limpa a sessão.

O acesso privado dos visitantes usa um token aleatório por até 30 dias. O navegador guarda somente token e vencimento; o banco guarda seu hash e uma impressão da configuração protegida. Trocar a senha ou a visibilidade invalida o acesso anterior. **Encerrar acesso privado** remove o token do navegador e revoga esse token no servidor quando há conexão. Nenhuma senha é salva pelo site.
