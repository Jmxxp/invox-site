# Painel administrativo do INVOX

O painel usa o mesmo Supabase do site oficial e exige o usuário e a senha cadastrados para o administrador. A autorização é conferida no servidor antes de carregar os dados.

Na publicação, o endereço é `/admin/`. Para desenvolver, sirva a raiz do repositório por HTTP e abra `/painel-admin/`; abrir o HTML com `file://` não permite autenticação. Os recursos compartilhados ficam em `site-oficial/shared/` e o empacotamento ajusta os caminhos publicados.

## Análises

A área inicial exibe visualizações do site e downloads iniciados. Os filtros mostram Hoje (por hora), 7 dias, 30 dias e 12 meses, com intervalos no horário de Brasília. O gráfico permite consultar pontos pelo mouse ou teclado, e a tabela abaixo apresenta os valores completos.

Os downloads são separados em Windows, macOS e Android. A métrica registra a liberação do link pelo servidor; a conclusão da transferência no dispositivo não é confirmada. A contagem começa na ativação das análises e não reconstrói acessos anteriores. Acessos locais de desenvolvimento ficam fora das visualizações. Use **Atualizar** para consultar novamente.

## Feedbacks

A lista traz os feedbacks reais mais recentes. Busque por nome, contato ou mensagem e use os filtros Novo/Respondido. Selecionar um item não altera a classificação. Use **Salvar anotação** ou **Marcar como respondido/novo** para persistir a mudança. Essas ações não enviam uma resposta ao contato.

**Atualizar** busca os dados mais recentes sem descartar anotações ou formulários em edição. **Sair** fecha a sessão local e limpa os dados carregados na interface.

## Acesso aos downloads

No modo público, visitantes baixam sem senha. No privado, a senha é validada no servidor antes de gerar o link temporário. Senhas novas exigem pelo menos oito caracteres. O painel não recebe nem exibe o hash salvo; deixar o campo em branco mantém a senha já configurada.

## Versão e instaladores

Feedbacks, análises, acesso e versões recebem atualizações por um canal Realtime privado após validar a conta. As consultas são agrupadas para evitar excesso de requisições. Rascunhos e notas em edição são preservados; o canal é encerrado ao sair ou trocar de conta.

Edite a versão no formato `1.1.0` e as novidades. Selecione ou arraste os instaladores por plataforma e clique em **Publicar versão e arquivos**. Arquivos novos substituem o instalador daquela plataforma após a publicação; plataformas sem uma nova seleção são mantidas.

Cada plataforma tem seu próprio campo de versão. A versão geral do jogo identifica as novidades anunciadas no site; ela não obriga Windows, macOS e Android a usar o mesmo número. Para corrigir apenas a versão de um arquivo já publicado, use **Salvar versão** no cartão, sem selecionar outro arquivo. Isso não reenvia os bytes.

O histórico abaixo reúne as últimas 100 publicações e alterações, com arquivo, plataforma, versão e data/hora com segundos em Brasília. **Atual** identifica o registro em uso. Registros que já existiam antes desta atualização aparecem como importados, preservando a data conhecida. As alterações acrescentam registros, sem sobrescrever os anteriores.

O limite por arquivo vem do servidor e aparece acima dos cartões. O envio acontece para armazenamento privado, sem executar os instaladores. Se a publicação falhar, a seleção permanece para tentar novamente. Um arquivo enviado só fica disponível no site depois de a publicação ser confirmada.

Instaladores grandes são armazenados em partes de 20 MiB, com hashes e retomada. Após recarregar, selecione novamente o mesmo arquivo e versão para aproveitar as partes já confirmadas. O painel mostra a capacidade disponível, que precisa comportar a versão anterior e a nova durante a troca. O teto lógico de 1,5 GiB não aumenta a cota total do projeto.

As credenciais administrativas e chaves de serviço não devem ser incluídas nos arquivos públicos. O navegador recebe somente URL e chave publicável; as operações administrativas exigem sessão válida e permissão de administrador.
