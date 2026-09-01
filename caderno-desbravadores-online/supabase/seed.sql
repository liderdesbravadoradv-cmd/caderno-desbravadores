-- PRIMEIRO ACESSO DO DIRETOR
--
-- 1. No Supabase Dashboard, crie manualmente um usuário em Authentication
--    > Users com o mesmo usuário virtual usado pelo aplicativo:
--    <USUARIO>@login.clube.local
-- 2. Marque a confirmação do e-mail como concluída e defina a senha.
-- 3. Substitua os valores abaixo e execute este arquivo no SQL Editor.
--
-- Exemplo: se o usuário de acesso for "diretor", o e-mail virtual será
-- "diretor@login.clube.local". O desbravador nunca precisa conhecer esse e-mail.

insert into public.profiles (id, username, role, name, birth_date, club, unit)
select
  id,
  'diretor',
  'DIRECTOR',
  'Diretor do Clube',
  null,
  'Clube Manancial',
  null
from auth.users
where lower(email) = lower('diretor@login.clube.local')
on conflict (id) do update set
  username = excluded.username,
  role = excluded.role,
  name = excluded.name,
  club = excluded.club,
  unit = excluded.unit;

insert into public.director_credentials (profile_id, password_plain)
select
  id,
  'TROQUE-ESTA-SENHA'
from public.profiles
where username = 'diretor'
on conflict (profile_id) do update set
  password_plain = excluded.password_plain,
  updated_at = now();

insert into public.club_state (profile_id)
select id from public.profiles where username = 'diretor'
on conflict (profile_id) do nothing;

-- Depois de executar, entre no aplicativo e altere a senha do Diretor
-- pela própria tela "Meu acesso" se desejar.
