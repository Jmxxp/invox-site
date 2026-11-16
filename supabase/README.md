# Backend do INVOX

Projeto alvo: `wsfdwyghqqaerivyrbil`. `schema.sql` é um snapshot de instalação, sem senhas, usuários de exemplo ou dados fictícios. A configuração inicial usa versão **1.1.0**, acesso público e nenhum instalador publicado.

## Instalação

1. Confirme acesso administrativo ao projeto alvo e inspecione tabelas, funções e políticas existentes. O snapshot cria recursos novos com prefixo `invox_`; em caso de colisão, reconcilie a estrutura antes de aplicar.
2. Aplique `schema.sql` como uma única transação usando a conexão administrativa do Supabase.
3. Crie a conta do administrador pelo Supabase Auth no servidor. Associe o `user_id` real, o e-mail interno e o nome de usuário escolhido a `public.invox_admins`. Nenhuma conta recebe acesso por ser a primeira a entrar.
4. Publique a Edge Function `invox-api` e mantenha a chave administrativa somente nos segredos do servidor. O navegador usa apenas a chave publicável.
5. Valide o acesso autenticado, envie um feedback de teste e publique os instaladores reais pelo painel. Confira os advisors de segurança e desempenho após aplicar o esquema.

Todas as tabelas possuem RLS e negam acesso direto a `anon` e `authenticated`. A Edge Function valida a sessão com o Auth, confere `user_id` e `enabled` na lista de administradores e executa as operações pelo servidor. Dados editáveis de `user_metadata` não concedem autorização.

## Instaladores e liberação

O bucket `invox-installers` é privado, aceita `application/octet-stream` e limita cada arquivo a **50 MiB**, sem presumir um plano pago. Os formatos são EXE/MSI/ZIP no Windows, DMG/PKG/ZIP no macOS e APK no Android. Um limite maior exige conferir o projeto e ajustar bucket, API e restrições do banco em conjunto.

Políticas restritivas para esse bucket impedem que regras amplas existentes abram os arquivos para clientes. Outros buckets não são afetados. O servidor emite tokens de upload para caminhos novos e URLs de download de curta duração. O modo privado valida a senha no servidor antes de emitir a URL; seu hash nunca é retornado. Uma URL já emitida permanece válida até vencer.

A publicação confere o manifesto contra `invox_uploads`: administrador, plataforma, caminho, nome, tamanho e versão. A API também confirma o tamanho real do objeto no Storage antes da transação. Plataformas omitidas preservam o instalador anterior. Arquivos antigos e uploads abandonados não são excluídos automaticamente; a limpeza deve respeitar os objetos ainda referidos por `invox_installers`.

## Funções do banco

- `invox_take_rate_limit(p_key_hash text, p_category text, p_window_seconds integer, p_limit integer) → boolean`: incremento atômico de tentativas. Hash SHA-256 hexadecimal de 64 caracteres, categoria `[a-z][a-z0-9_-]{0,63}`, janela de 1 a 86400 segundos e limite de 1 a 10000. Limpa até mil contadores com mais de um dia por chamada.
- `invox_publish_release(p_version text, p_release_notes text, p_files jsonb, p_admin_id uuid) → void`: publicação atômica. O manifesto usa `[{"platform":"windows","path":"...","fileName":"INVOX.exe","size":123}]`. Aceita de zero a três plataformas sem repetição e exige correspondência com um upload autorizado.

As funções usam `SECURITY INVOKER`, `search_path` vazio e permissão de execução exclusiva de `service_role`. Nenhuma função privilegiada é exposta aos visitantes.

## Verificação pendente

O snapshot passou em um PostgreSQL isolado via PGlite: compilação de DDL/PLpgSQL, RLS, permissões, restrições de senha, publicação atômica e limites de tentativas. Isso não substitui testes no Supabase. A aplicação e os testes contra o projeto alvo dependem da autorização dessa conexão; não considere o backend publicado apenas porque estes arquivos existem.
