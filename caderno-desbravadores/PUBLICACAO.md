# Publicação do Caderno de Classes

## Arquitetura escolhida

- GitHub: código-fonte
- Cloudflare Pages: hospedagem do React/Vite
- Supabase Free: autenticação, banco e Storage

A interface do aplicativo não foi redesenhada. As alterações de código são apenas da camada de conexão e armazenamento online.

## 1. Supabase

1. Crie um projeto gratuito no Supabase.
2. Abra o SQL Editor e execute `supabase/migrations/001_initial.sql`.
3. Crie o primeiro usuário do Diretor em Authentication > Users.
   - O e-mail interno deve ser `diretor@login.clube.local` se você mantiver o usuário `diretor`.
   - Marque o usuário como confirmado.
   - A senha será a que você escolher.
4. Edite `supabase/seed.sql` com o usuário, nome e senha do Diretor e execute-o no SQL Editor.
5. Faça o deploy da função `manage-user`.

### Deploy da função

Com o Supabase CLI instalado e autenticado:

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy manage-user
```

A função usa a chave secreta do Supabase somente no ambiente da Edge Function. Ela nunca deve ser colocada no frontend, no GitHub ou em `.env` enviado ao Cloudflare.

## 2. Variáveis do Cloudflare Pages

No projeto do Cloudflare Pages, em Settings > Environment variables, configure:

```text
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Use a **Publishable key** do Supabase. Não use a Secret key/service_role no navegador.

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

## 3. GitHub

Envie somente o conteúdo de `caderno-desbravadores-online/`.

Não envie:

- `.env`
- `node_modules/`
- `dist/`
- chaves secretas
- dados reais do clube

O `.env.example` pode ser enviado porque contém somente nomes de variáveis e valores de exemplo.
