-- Speak Up IA: base para o app de conversação por voz (projeto Supabase "Mapa da mima").
-- Aparelho do aluno -> usuário (o app não pede login; o servidor cria o usuário e guarda só o hash do token).
create table if not exists english_ai.devices (
  token_hash   text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table english_ai.devices enable row level security;
create index if not exists devices_user_idx on english_ai.devices(user_id);

-- Repetição espaçada (SM-2 simplificado) em learning_items.
alter table english_ai.learning_items
  add column if not exists ease          numeric  not null default 2.5,
  add column if not exists interval_days numeric  not null default 0,
  add column if not exists reps          smallint not null default 0,
  add column if not exists lesson_id     text;
create index if not exists learning_items_due_idx on english_ai.learning_items(user_id, next_review_at);

create index if not exists turns_session_idx on english_ai.turns(session_id, id);
create index if not exists usage_events_type_day_idx on english_ai.usage_events(event_type, created_at);

-- IA gratuita (Gemini, com Groq de reserva). Limites protegem a cota grátis.
insert into english_ai.feature_flags (key, enabled, config) values
  ('ai_conversation', true, '{"provider":"gemini","fallback":"groq","daily_user_limit":300,"daily_global_limit":1200}')
on conflict (key) do update set enabled = excluded.enabled, config = excluded.config, updated_at = now();