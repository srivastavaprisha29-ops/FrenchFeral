begin;

create table if not exists public.learner_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  generation uuid not null default gen_random_uuid(),
  imported_guest boolean not null default false,
  progress jsonb not null check (
    jsonb_typeof(progress) = 'object' and
    octet_length(progress::text) <= 4096 and
    progress - array['version','total','passed','mastery','items','daily','lastDay','streak'] = '{}'::jsonb
  )
);

alter table public.learner_progress enable row level security;
revoke all on public.learner_progress from anon, authenticated;
grant select, insert, update on public.learner_progress to authenticated;

drop policy if exists learner_owner on public.learner_progress;
create policy learner_owner on public.learner_progress
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.delete_learner_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  learner uuid := auth.uid();
begin
  if learner is null then
    raise exception 'Sign in to delete your account';
  end if;
  delete from auth.users where id = learner;
end;
$$;
revoke all on function public.delete_learner_account() from public, anon;
grant execute on function public.delete_learner_account() to authenticated;

commit;
