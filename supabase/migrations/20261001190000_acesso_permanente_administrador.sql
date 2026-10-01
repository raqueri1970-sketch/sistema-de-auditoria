-- Acesso permanente: quem está nesta lista é sempre reconhecido e liberado em tudo,
-- independente das atualizações da Base Mãe (portal_funcionarios).
create table if not exists public.portal_acesso_permanente (
  cpf text primary key check (cpf ~ '^\d{11}$'),
  nome text not null,
  cargo text not null default 'Administrador',
  setor_id bigint references public.portal_setores(id),
  user_id uuid references auth.users(id) on delete set null,
  motivo text not null default 'administrador',
  criado_em timestamptz not null default now()
);
alter table public.portal_acesso_permanente enable row level security;
-- Sem policies: só funções security definer e o service_role leem/escrevem.
revoke all on public.portal_acesso_permanente from anon, authenticated;

insert into public.portal_acesso_permanente(cpf,nome,cargo,setor_id,user_id,motivo)
values ('10461295890','RICARDO AQUERI','Administrador',17,'b9321e57-4944-4c1d-9984-0dab0a7b5430','administrador do portal')
on conflict (cpf) do nothing;

-- Base Mãe: atualização nunca desativa nem apaga quem tem acesso permanente.
create or replace function public.portal_protege_acesso_permanente()
 returns trigger language plpgsql security definer set search_path to ''
as $$
declare p public.portal_acesso_permanente;
begin
  select * into p from public.portal_acesso_permanente where cpf = coalesce(new.cpf, old.cpf);
  if not found then
    if TG_OP = 'DELETE' then return old; end if;
    return new;
  end if;
  if TG_OP = 'DELETE' then return null; end if;
  new.ativo := true;
  if new.situacao is null or new.situacao ~* '(deslig|demit|inativ)' then new.situacao := 'Ativo'; end if;
  new.nome := coalesce(nullif(btrim(new.nome),''), p.nome);
  new.cargo := coalesce(nullif(btrim(new.cargo),''), p.cargo);
  new.setor_id := coalesce(new.setor_id, p.setor_id);
  return new;
end $$;
drop trigger if exists trg_protege_acesso_permanente on public.portal_funcionarios;
create trigger trg_protege_acesso_permanente before update or delete on public.portal_funcionarios
  for each row execute function public.portal_protege_acesso_permanente();

-- Treinamento: identificação cai na lista permanente se o CPF não estiver ativo na Base Mãe.
-- Administrador logado que se identifica entra na lista automaticamente (primeiro login).
create or replace function public.curso_identificar_funcionario(p_cpf text)
 returns table(cpf text, nome text, cargo text, loja_codigo integer)
 language plpgsql volatile security definer set search_path to public
as $$
declare v text := regexp_replace(coalesce(p_cpf,''),'\D','','g');
begin
  if public.portal_is_admin() and length(v) = 11 then
    insert into public.portal_acesso_permanente(cpf,nome,cargo,setor_id,user_id,motivo)
    select v, coalesce(f.nome, x.nome), coalesce(f.cargo, x.cargo, 'Administrador'), f.setor_id, auth.uid(), 'administrador (primeiro login no Treinamento)'
    from (select 1) d
    left join public.portal_funcionarios f on f.cpf = v
    left join public.ajuste_cadastro_extra x on x.cpf = v
    where coalesce(f.nome, x.nome) is not null
    on conflict on constraint portal_acesso_permanente_pkey do nothing;
  end if;
  return query select f.cpf, f.nome, f.cargo, f.loja_codigo from public.portal_funcionarios f where f.cpf = v and f.ativo = true limit 1;
  if found then return; end if;
  return query select a.cpf, a.nome, a.cargo, null::integer from public.portal_acesso_permanente a where a.cpf = v limit 1;
end $$;

-- Treinamento: CPF com acesso permanente vê todas as áreas ativas.
alter function public.curso_areas_permitidas(text) rename to curso_areas_permitidas_regra;
revoke all on function public.curso_areas_permitidas_regra(text) from public, anon, authenticated;
create function public.curso_areas_permitidas(p_cpf text)
 returns table(area_id text, permitido boolean, motivo text)
 language plpgsql stable security definer set search_path to public
as $$
declare v text := regexp_replace(coalesce(p_cpf,''),'\D','','g');
begin
  if exists (select 1 from public.portal_acesso_permanente a where a.cpf = v) then
    return query select ca.id, true, 'acesso_permanente'::text from public.curso_areas ca where ca.ativo = true;
    return;
  end if;
  return query select * from public.curso_areas_permitidas_regra(p_cpf);
end $$;
grant execute on function public.curso_areas_permitidas(text) to anon, authenticated, service_role;
