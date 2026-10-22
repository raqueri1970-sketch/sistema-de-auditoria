-- Código temporário para o envio das fotos dos PDFs do banco (fin-evidencias-banco). Guarda só o hash sha256 e a
-- validade; sem policies (só a chave de serviço lê).
create table if not exists public.fin_envio_token (
  id bigserial primary key,
  hash text not null unique,
  finalidade text not null,
  expira_em timestamptz not null,
  usos int not null default 0,
  criado_em timestamptz not null default now()
);
alter table public.fin_envio_token enable row level security;
