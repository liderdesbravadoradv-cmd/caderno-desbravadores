# Caderno de Classes — Desbravadores

Protótipo funcional em React + Vite para o Caderno de Classes.

## O que já está implementado

- As seis classes completas, na ordem fornecida: Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista e Guia.
- Checklist das seis classes com as cores correspondentes.
- Capa e identificação individual.
- Login por **usuário e senha**, sem e-mail.
- Três perfis: `DESBRAVADOR`, `ADMIN` (liderança) e `REGIONAL`.
- Desbravador: visualiza/edita sua classe, registra data, envia evidência e texto e acompanha o retorno.
- Liderança: visualiza os desbravadores, analisa cada requisito e aprova/devolve com comentário.
- Regional: visualiza evidências, analisa requisitos aprovados pela liderança e aprova/devolve com comentário; a devolução fica registrada para a liderança.
- Geração de **Caderno Digital HTML somente do caderno individual** do desbravador, com textos, imagens, vídeos, PDFs e incorporações do YouTube quando disponíveis. Não há geração de relatório administrativo.
- Persistência local neste navegador, incluindo anexos, sem conexão a banco remoto.

## Acesso de teste

No primeiro acesso neste navegador, entre como Diretor com `diretor` / `1234` e altere a senha em **Meu acesso**. Os demais acessos podem ser criados e gerenciados pelo Diretor.

## Executar

```bash
npm install
npm run dev
```

Se o PowerShell bloquear `npm.ps1`, use:

```bash
npm.cmd install
npm.cmd run dev
```

## Observação sobre o Caderno Digital

O Caderno Digital é gerado como um arquivo HTML baixado pelo usuário; ele não é publicado pelo aplicativo nem fica aberto para toda a internet. Contas, atividades e anexos ficam somente no IndexedDB do navegador neste dispositivo. Não há sincronização entre navegadores ou aparelhos.


## v1.0 — ajustes finais antes da publicação
- A Liderança/Diretoria de avaliação agora exibe a mesma checklist do Desbravador.
- A checklist da Liderança é preenchida com a aprovação da Liderança.
- A aprovação do Regional continua sendo a confirmação final; uma reprovação regional remove a confirmação da checklist.
- O perfil Diretor fica somente no gerenciamento de acessos e não exibe a checklist.

- Removido o símbolo “Salvação e Serviço” da capa.
- Removida a caixa de acessos de teste da tela de login.
- O Diretor pode alterar o próprio usuário e a própria senha.
- O Diretor não possui checklist nem acesso às páginas de atividades.
- O botão de reset geral foi removido para proteger a memória do caderno.
- Ao excluir um acesso de Desbravador, suas respostas, mensagens e arquivos daquele acesso são excluídos junto.
- A Liderança pode enviar mensagens por requisito mesmo antes do envio de uma atividade.
- A mensagem da Liderança aparece para o Desbravador e é apagada quando ele reenvia a atividade.

> Importante: os dados ficam neste navegador e podem ser perdidos se os dados do site forem apagados. A conexão com o Supabase foi removida do aplicativo; o projeto remoto e seus dados não foram alterados. O primeiro acesso local do Diretor é `diretor` / `1234`; altere a senha logo após entrar.
