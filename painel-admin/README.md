# Painel administrativo do INVOX

O painel usa o mesmo Supabase do site oficial e exige o usuário e a senha cadastrados para o administrador. A autorização é conferida no servidor antes de carregar os dados.

Na publicação, o endereço é `/admin/`. Para desenvolver, sirva a raiz do repositório por HTTP e abra `/painel-admin/`; abrir o HTML com `file://` não permite autenticação. Os recursos compartilhados ficam em `site-oficial/shared/` e o empacotamento ajusta os caminhos publicados.

## Análises

A área inicial exibe visualizações do site e downloads iniciados. Os filtros mostram Hoje (por hora), 7 dias, 30 dias e 12 meses, com intervalos no horário de Brasília. O gráfico permite consultar pontos pelo mouse ou teclado, e a tabela abaixo apresenta os valores completos.

Os downloads são separados em Windows, macOS e Android. A métrica registra a liberação do link pelo servidor; a conclusão da transferência no dispositivo não é confirmada. A contagem começa na ativação das análises e não reconstrói acessos anteriores. Acessos locais de desenvolvimento ficam fora das visualizações. Use **Atualizar** para consultar novamente.

## Feedbacks

A lista traz as duzentas mensagens mais recentes do site e do jogo, identificadas como ajuda/feedback ou sugestão. Busque por nome, mensagem, tipo ou origem e combine o filtro de tipo com Novo/Tratado. Novos envios pedem apenas nome e conteúdo; contatos históricos são preservados para consulta. Selecionar um item não altera a classificação. Use **Salvar anotação** ou **Marcar como tratado/novo** para persistir a mudança. Essas ações não enviam uma resposta ao jogador.

O painel consulta novidades a cada vinte segundos enquanto estiver aberto e autorizado. Novas mensagens atualizam o contador lateral; registros da carga inicial e IDs já anunciados não disparam outro aviso na mesma sessão. **Ativar notificações do navegador** pede permissão somente após o clique. Não são enviados e-mails ou mensagens a outros canais.

**Atualizar** busca os dados mais recentes sem descartar anotações ou formulários em edição. **Sair** fecha a sessão local e limpa os dados carregados na interface.

## Recados no jogo

Na área **Recados no jogo**, informe título e mensagem e use **Publicar para todos**. A publicação cria um ID novo. A lista permite desativar ou reativar os recados; reativar o mesmo ID não força novo aviso para quem já o fechou. O jogo aberto e conectado consulta até vinte recados ativos recentes. Não há notificação para um jogo fechado. Os limites são cem caracteres no título e dois mil na mensagem.

As migrações `20261117193242_invox_game_feedback.sql` e `20261117194103_invox_game_announcements.sql` e a função `invox-api` versão 6 já estão implantadas no projeto INVOX. O teste HTTPS dos clientes do jogo confirmou gravação real de feedback e sugestão sem contato; os dois registros temporários foram removidos por UUID. A interface está publicada em https://jmxxp.github.io/invox-site/admin/, com Actions e recursos HTTPS conferidos. A função mesclada com multipart, Realtime e versões independentes foi publicada como versão 8. O teste visual de login administrativo no navegador não foi repetido. Consulte `../supabase/README.md`.

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
