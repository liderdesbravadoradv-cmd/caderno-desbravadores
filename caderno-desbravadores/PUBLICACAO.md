# Publicação do Caderno de Classes

## Arquitetura atual

- GitHub: código-fonte.
- Cloudflare Pages: hospedagem opcional da interface React/Vite.
- IndexedDB: contas, atividades e anexos guardados localmente em cada navegador.

O app não se conecta mais ao Supabase. O projeto e os dados que ainda existam na conta Supabase não são alterados por esta mudança.

## Uso

Execute `npm install` e `npm run dev` para abrir o app no computador. No primeiro acesso, use `diretor` / `1234` e altere a senha em **Meu acesso**.

O armazenamento local pertence ao perfil do navegador e à origem do site. O uso em um endereço hospedado no Cloudflare Pages cria uma base separada da execução local e de outros dispositivos. Não há compartilhamento automático de contas, atividades ou anexos entre eles.

Se publicar no Cloudflare Pages, use `npm run build` como comando de build e `dist` como pasta de saída. Não configure variáveis `VITE_SUPABASE_*`.

Os dados podem ser apagados ao limpar os dados do site no navegador. O primeiro usuário usa uma senha inicial conhecida; altere-a antes de cadastrar informações.
