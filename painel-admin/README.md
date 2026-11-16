# Painel administrativo do INVOX

Abra `index.html` no navegador. Funciona como arquivo local, sem instalação ou build. Fonte Montserrat, ícones Font Awesome e identidade visual estão nesta pasta.

## Áreas

- **Feedbacks:** exemplos fictícios recentes, busca, filtros Novo/Respondido, nome, contato, anotação de resposta e reclassificação.
- **Acesso ao site:** rascunho público ou privado com campo de senha.
- **Versão e arquivos:** versão, notas e seleção ou arraste de instaladores Windows, macOS e Android.

## Prévia sem backend

Os feedbacks não são recebidos do site. Os contatos de exemplo usam o domínio reservado `example.test`. Marcar como respondido não envia mensagem.

Tudo existe somente na memória da sessão e se perde ao recarregar. A senha não é persistida e **ainda não protege o site**. O painel não tem autenticação nesta etapa.

Os instaladores são apenas selecionados: exibimos nome e tamanho, sem ler, executar ou enviar seu conteúdo. Salvar rascunho não publica versões ou altera os downloads reais. `1.0.0` é o exemplo inicial.

**Restaurar prévia** limpa os rascunhos e restaura os exemplos. A integração futura deverá implementar autenticação, feedbacks, proteção no servidor e publicação de instaladores.
