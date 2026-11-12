-- Segurança Patrimonial e CFTV — 12/11/2026.
--
-- Módulo do Portal (tela seguranca-cftv/). Só cria objetos novos com prefixo cftv_; não altera tabelas de outros módulos.
--
--   Lojas ............ o total de lojas vem do cadastro oficial (portal_lojas, ativo = true). cftv_lojas guarda só o que é
--                      de CFTV (gravador, canais livres, dias de gravação, levantamento) e os apelidos usados para achar a
--                      loja de destino de cada nota. Código da loja = 900 + número da filial (05 - CAMARAGIBE = 905).
--                      Código 0 = CD / matriz (não é loja e não entra no total de lojas).
--   Documentos ....... notas fiscais (NF-e e NFS-e), recibos e relatórios. Uma nota nunca entra duas vezes: chave de acesso
--                      única, arquivo (SHA-256) único e, sem chave, emitente + tipo + número + série + valor.
--   Itens ............ linhas das notas, com categoria (câmera, DVR/NVR, HD, alarme…). COMPRADO ≠ INSTALADO.
--   Equipamentos ..... inventário por loja: patrimônio anterior a 2026, aquisições de 2026 (ligadas ao item da nota) e
--                      situação atual. Patrimônio atualizado = o que está na loja (desconta retirados, baixados e substituídos).
--   Movimentos ....... instalação, retirada, substituição, baixa e transferência.
--   Cobertura ........ por loja e área (entrada, caixa, vendas, estoque, recebimento, outra), com histórico.
--   Manutenções ...... 7 classificações; "possível mau uso" só com evidência registrada. Nunca atribui culpa sozinho.
--   Ocorrências ...... auditoria automática (cftv_auditar) separada em pendente / suspeita / confirmada, com histórico de
--                      correções (quem e quando).
--   Detalhes sensíveis (localização exata de câmeras, pontos cegos, configurações) ficam em tabela separada, visível só
--   para Segurança, Presidência e administração.
--
-- Perfis: administrador/controladoria (orc_perfis) = administração do módulo; diretoria (orc_perfis) = leitura;
-- cftv_acessos = Presidência, Diretoria, Segurança e consulta autorizada, liberados pelo administrador.

-- =====================================================================================================================
-- 1. Acesso
-- =====================================================================================================================
create table if not exists public.cftv_acessos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  papel text not null check (papel in ('presidencia', 'diretoria', 'seguranca', 'consulta')),
  ativo boolean not null default true,
  observacao text,
  criado_por text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);

-- Papel efetivo no módulo: admin | presidencia | diretoria | seguranca | consulta | null (sem acesso)
create or replace function public.cftv_papel() returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.perfil in ('administrador', 'controladoria') then 'admin' when p.perfil = 'diretoria' then 'diretoria' end
       from public.orc_perfis p where p.user_id = (select auth.uid()) and p.ativo and p.perfil in ('administrador', 'controladoria', 'diretoria')),
    (select a.papel from public.cftv_acessos a where a.user_id = (select auth.uid()) and a.ativo))
$$;
-- Chamada de servidor (SQL do administrador do banco, cron, edge function com chave de serviço)
create or replace function public.cftv_servidor() returns boolean language sql stable set search_path = public as $$
  -- session_user (e não current_user): dentro de função SECURITY DEFINER o current_user é sempre o dono da função.
  -- Pela API o session_user é "authenticator"; só o próprio banco (SQL do administrador, cron) entra como postgres.
  select coalesce(auth.role(), '') = 'service_role' or session_user in ('postgres', 'supabase_admin')
$$;
create or replace function public.cftv_pode_ver() returns boolean language sql stable security definer set search_path = public as $$
  select public.cftv_servidor() or public.cftv_papel() is not null
$$;
create or replace function public.cftv_pode_editar() returns boolean language sql stable security definer set search_path = public as $$
  select public.cftv_servidor() or public.cftv_papel() in ('admin', 'seguranca')
$$;
-- Detalhe sensível: localização exata, pontos cegos e configuração técnica
create or replace function public.cftv_pode_detalhe() returns boolean language sql stable security definer set search_path = public as $$
  select public.cftv_servidor() or public.cftv_papel() in ('admin', 'seguranca', 'presidencia')
$$;

alter table public.cftv_acessos enable row level security;
drop policy if exists cftv_acessos_sel on public.cftv_acessos;
create policy cftv_acessos_sel on public.cftv_acessos for select to authenticated using (user_id = (select auth.uid()) or public.cftv_papel() = 'admin');
drop policy if exists cftv_acessos_all on public.cftv_acessos;
create policy cftv_acessos_all on public.cftv_acessos for all to authenticated using (public.cftv_papel() = 'admin') with check (public.cftv_papel() = 'admin');

-- Registro de acessos e alterações relevantes
create table if not exists public.cftv_log (
  id bigserial primary key,
  em timestamptz not null default now(),
  usuario text default coalesce(auth.jwt() ->> 'email', current_user),
  acao text not null,               -- acesso | insert | update | delete | importacao | decisao | exportacao
  tabela text,
  registro text,
  dados jsonb
);
alter table public.cftv_log enable row level security;
drop policy if exists cftv_log_sel on public.cftv_log;
create policy cftv_log_sel on public.cftv_log for select to authenticated using (public.cftv_papel() = 'admin');

create or replace function public.cftv_registrar(p_acao text, p_tabela text default null, p_registro text default null, p_dados jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.cftv_pode_ver() then raise exception 'Sem acesso ao módulo Segurança Patrimonial e CFTV' using errcode = '42501'; end if;
  insert into public.cftv_log (acao, tabela, registro, dados) values (left(p_acao, 40), left(p_tabela, 60), left(p_registro, 120), p_dados);
end $$;

create or replace function public.cftv_trg_log() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(coalesce(new, old)) ->> 'id', to_jsonb(coalesce(new, old)) ->> 'codigo', to_jsonb(coalesce(new, old)) ->> 'loja_codigo');
  insert into public.cftv_log (acao, tabela, registro, dados)
  values (lower(tg_op), tg_table_name, v_id,
          case tg_op when 'INSERT' then null when 'DELETE' then to_jsonb(old)
            else (select jsonb_object_agg(k, jsonb_build_object('de', to_jsonb(old) -> k, 'para', to_jsonb(new) -> k))
                    from jsonb_object_keys(to_jsonb(new)) k where to_jsonb(new) -> k is distinct from to_jsonb(old) -> k and k not in ('atualizado_em')) end);
  return coalesce(new, old);
end $$;

-- =====================================================================================================================
-- 2. Lojas (dados de CFTV) e premissas
-- =====================================================================================================================
create table if not exists public.cftv_lojas (
  codigo int primary key,                 -- 900 + nº da filial; 0 = CD / matriz
  nome text not null,
  cidade text,
  tipo text,                              -- CENTRO/RUA, SHOPPING, MIX MATEUS, CARREFOUR, CD
  regional text,
  responsavel text,
  apelidos text[] not null default '{}',  -- nomes distintivos para achar a loja na nota ("~" = apelido inferido, só sugere)
  chaves text[] not null default '{}',    -- palavras comuns a mais de uma loja (só geram sugestão)
  cnpjs text[] not null default '{}',     -- CNPJs de filial confirmados para esta loja
  dias_gravacao int,
  capacidade_canais int,                  -- canais do gravador
  canais_analog_livres int,
  canais_ip_livres int,
  necessidade_texto text,                 -- levantamento de necessidades (texto original)
  necessidade_cameras int,
  situacao_cftv text,                     -- ex.: LOJA DESATIVADA, LOJA SENDO REALOCADA
  fonte text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.cftv_premissas (
  chave text primary key,
  valor numeric not null,
  unidade text,
  descricao text not null,
  fonte text not null,
  validada boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por text default (auth.jwt() ->> 'email')
);

-- =====================================================================================================================
-- 3. Importação e documentos
-- =====================================================================================================================
create table if not exists public.cftv_importacoes (
  id bigserial primary key,
  em timestamptz not null default now(),
  usuario text default coalesce(auth.jwt() ->> 'email', current_user),
  origem text not null default 'tela',     -- tela | servidor
  arquivos int not null default 0,
  resumo jsonb not null default '{}'
);

create table if not exists public.cftv_documentos (
  id bigserial primary key,
  tipo text not null check (tipo in ('NF-e', 'NFS-e', 'recibo', 'relatorio', 'outro')),
  chave text,
  numero text,
  serie text,
  emissao date,
  competencia date,
  fornecedor text,
  fornecedor_cnpj text,
  destinatario text,
  destinatario_cnpj text,
  destinatario_endereco text,
  destinatario_municipio text,
  loja_codigo int,
  loja_confianca text check (loja_confianca in ('alta', 'media', 'confirmada')),
  loja_motivo text,
  descricao text,
  valor_produtos numeric(14, 2),
  frete numeric(14, 2) not null default 0,
  outras numeric(14, 2) not null default 0,
  desconto numeric(14, 2) not null default 0,
  valor_total numeric(14, 2),
  natureza text not null default 'outro' check (natureza in ('aquisicao', 'instalacao', 'manutencao', 'monitoramento', 'outro')),
  natureza_motivo text,
  finalidade text not null default 'nao_informada' check (finalidade in ('ampliacao', 'substituicao', 'nao_informada')),
  orcamento_ref text,
  pedido text,
  ocr boolean not null default false,
  status text not null default 'conferir' check (status in ('ok', 'conferir', 'duplicado', 'descartado')),
  conferir text[] not null default '{}',   -- motivos da conferência manual
  duplicado_de bigint references public.cftv_documentos(id),
  arquivo_nome text,
  arquivo_hash text,
  arquivo_path text,                       -- storage: cftv-documentos/<hash>.<ext>
  importacao_id bigint references public.cftv_importacoes(id),
  conferido_por text,
  conferido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists cftv_doc_chave_uk on public.cftv_documentos (chave) where chave is not null and status <> 'duplicado';
create unique index if not exists cftv_doc_hash_uk on public.cftv_documentos (arquivo_hash) where arquivo_hash is not null;
create index if not exists cftv_doc_emissao on public.cftv_documentos (emissao);
create index if not exists cftv_doc_loja on public.cftv_documentos (loja_codigo);

create table if not exists public.cftv_importacao_arquivos (
  id bigserial primary key,
  importacao_id bigint references public.cftv_importacoes(id) on delete cascade,
  nome text not null,
  hash text,
  tamanho bigint,
  tipo text,                               -- pdf | xml | xlsx | csv | imagem | outro
  resultado text not null,                 -- inserido | conferir | duplicado | anexado | planilha | ignorado | erro
  documento_id bigint references public.cftv_documentos(id),
  mensagem text,
  em timestamptz not null default now()
);

create table if not exists public.cftv_documento_itens (
  id bigserial primary key,
  documento_id bigint not null references public.cftv_documentos(id) on delete cascade,
  ordem int not null default 0,
  codigo text,
  descricao text not null,
  ncm text,
  unidade text,
  quantidade numeric(14, 4),
  valor_unit numeric(14, 4),
  valor_total numeric(14, 2),
  categoria text not null default 'outro' check (categoria in ('camera', 'dvr_nvr', 'hd', 'alarme_sensor', 'perimetro', 'incendio', 'fonte_energia',
    'rede_rack', 'cabeamento', 'conector_acessorio', 'servico', 'outro')),
  loja_codigo int
);
create index if not exists cftv_item_doc on public.cftv_documento_itens (documento_id);

-- =====================================================================================================================
-- 4. Inventário, movimentos e cobertura
-- =====================================================================================================================
create table if not exists public.cftv_equipamentos (
  id bigserial primary key,
  loja_codigo int not null,
  categoria text not null check (categoria in ('camera', 'dvr_nvr', 'hd', 'alarme_sensor', 'perimetro', 'incendio', 'fonte_energia',
    'rede_rack', 'cabeamento', 'conector_acessorio', 'outro')),
  descricao text,
  marca text,
  modelo text,
  numero_serie text,
  quantidade int not null default 1 check (quantidade > 0),
  custo_unit numeric(14, 2),               -- nulo = custo não cadastrado (nunca inventado)
  data_aquisicao date,
  origem text not null check (origem in ('anterior_2026', 'aquisicao_2026')),
  estimado boolean not null default false, -- quantidade estimada (ex.: canais ocupados do gravador)
  area text check (area in ('entrada', 'caixa', 'vendas', 'estoque', 'recebimento', 'outra')),
  situacao text not null default 'instalado' check (situacao in ('instalado', 'em_estoque', 'defeito', 'fora_operacao', 'retirado', 'baixado', 'substituido')),
  documento_item_id bigint references public.cftv_documento_itens(id),
  substitui_id bigint references public.cftv_equipamentos(id),
  fonte text,
  fonte_chave text unique,                 -- reimportar a mesma planilha atualiza, não duplica
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists cftv_eq_loja on public.cftv_equipamentos (loja_codigo);

create table if not exists public.cftv_movimentos (
  id bigserial primary key,
  loja_codigo int not null,
  tipo text not null check (tipo in ('instalacao', 'retirada', 'substituicao', 'baixa', 'transferencia')),
  data date not null,
  equipamento_id bigint references public.cftv_equipamentos(id),
  equipamento_substituido_id bigint references public.cftv_equipamentos(id),
  categoria text,
  quantidade int not null default 1,
  documento_id bigint references public.cftv_documentos(id),
  loja_destino int,
  observacao text,
  fonte_chave text unique,
  usuario text default coalesce(auth.jwt() ->> 'email', current_user),
  criado_em timestamptz not null default now()
);

create table if not exists public.cftv_cobertura (
  loja_codigo int not null,
  area text not null check (area in ('entrada', 'caixa', 'vendas', 'estoque', 'recebimento', 'outra')),
  situacao text not null default 'nao_avaliada' check (situacao in ('coberta', 'parcial', 'sem_cobertura', 'nao_se_aplica', 'nao_avaliada')),
  cameras_qtd int,
  necessidade_cameras int not null default 0,
  observacao text,
  fonte text,
  avaliado_em date,
  avaliado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now(),
  primary key (loja_codigo, area)
);
create table if not exists public.cftv_cobertura_hist (
  id bigserial primary key,
  loja_codigo int not null,
  area text not null,
  situacao text not null,
  necessidade_cameras int,
  em timestamptz not null default now(),
  usuario text default coalesce(auth.jwt() ->> 'email', current_user)
);
create or replace function public.cftv_trg_cobertura_hist() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.situacao is distinct from old.situacao or new.necessidade_cameras is distinct from old.necessidade_cameras then
    insert into public.cftv_cobertura_hist (loja_codigo, area, situacao, necessidade_cameras) values (new.loja_codigo, new.area, new.situacao, new.necessidade_cameras);
  end if;
  return new;
end $$;

-- Detalhes sensíveis: só Segurança, Presidência e administração
create table if not exists public.cftv_detalhes_sensiveis (
  id bigserial primary key,
  loja_codigo int not null,
  equipamento_id bigint references public.cftv_equipamentos(id) on delete cascade,
  tipo text not null check (tipo in ('localizacao', 'ponto_cego', 'configuracao', 'acesso_remoto', 'outro')),
  descricao text not null,
  criado_por text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);

-- Plano de investimentos futuros
create table if not exists public.cftv_plano (
  id bigserial primary key,
  loja_codigo int not null,
  descricao text not null,
  cameras int not null default 0,
  gravadores int not null default 0,
  valor_estimado numeric(14, 2),
  memoria_calculo jsonb,
  prioridade int not null default 3 check (prioridade between 1 and 5),
  situacao text not null default 'planejado' check (situacao in ('planejado', 'aprovado', 'comprado', 'instalado', 'cancelado')),
  fonte text,
  fonte_chave text unique,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- =====================================================================================================================
-- 5. Manutenção e custos evitáveis
-- =====================================================================================================================
create table if not exists public.cftv_manutencoes (
  id bigserial primary key,
  loja_codigo int,
  data date not null,
  categoria text,                          -- equipamento envolvido (mesmas categorias do inventário)
  equipamento_id bigint references public.cftv_equipamentos(id),
  fornecedor text,
  documento_id bigint unique references public.cftv_documentos(id) on delete set null,
  descricao text,
  classificacao text not null default 'causa_nao_identificada' check (classificacao in ('preventiva', 'desgaste_natural', 'defeito_tecnico',
    'substituicao_modernizacao', 'dano_acidental', 'possivel_mau_uso', 'causa_nao_identificada')),
  evidencia text,                          -- fotos, laudo, relato técnico (descrição/link)
  evidencia_suficiente boolean not null default false,
  pecas numeric(14, 2) not null default 0,
  mao_obra numeric(14, 2) not null default 0,
  valor_total numeric(14, 2) not null default 0,
  status text not null default 'conferir' check (status in ('ok', 'conferir', 'descartado')),
  classificado_por text,
  classificado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Mau uso só com evidência registrada e marcada como suficiente: o sistema nunca atribui culpa sozinho.
  constraint cftv_mau_uso_com_evidencia check (classificacao <> 'possivel_mau_uso' or (evidencia_suficiente and length(coalesce(evidencia, '')) >= 10))
);
create index if not exists cftv_man_loja on public.cftv_manutencoes (loja_codigo, categoria, data);

-- =====================================================================================================================
-- 6. Auditoria
-- =====================================================================================================================
create table if not exists public.cftv_ocorrencias (
  id bigserial primary key,
  chave text not null unique,              -- regra + referência (a mesma ocorrência não se repete)
  regra text not null,
  titulo text not null,
  detalhe text,
  loja_codigo int,
  valor numeric(14, 2),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'suspeita', 'confirmada', 'descartada', 'corrigida')),
  decidida boolean not null default false, -- true depois de decisão humana: a auditoria automática não muda mais a situação
  gravidade text not null default 'media' check (gravidade in ('alta', 'media', 'baixa')),
  refs jsonb not null default '{}',
  ativo boolean not null default true,     -- false quando a regra deixou de encontrar o caso
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.cftv_ocorrencias_hist (
  id bigserial primary key,
  ocorrencia_id bigint not null references public.cftv_ocorrencias(id) on delete cascade,
  de text,
  para text not null,
  observacao text,
  usuario text default coalesce(auth.jwt() ->> 'email', current_user),
  em timestamptz not null default now()
);

-- =====================================================================================================================
-- 7. RLS, permissões e gatilhos
-- =====================================================================================================================
do $$
declare t text;
begin
  foreach t in array array['cftv_lojas', 'cftv_premissas', 'cftv_importacoes', 'cftv_importacao_arquivos', 'cftv_documentos', 'cftv_documento_itens',
    'cftv_equipamentos', 'cftv_movimentos', 'cftv_cobertura', 'cftv_cobertura_hist', 'cftv_plano', 'cftv_manutencoes', 'cftv_ocorrencias',
    'cftv_ocorrencias_hist'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.cftv_pode_ver())', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.cftv_pode_editar())', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.cftv_pode_editar()) with check (public.cftv_pode_editar())', t || '_upd', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
-- exclusão física só em itens de nota e movimentos lançados por engano (o resto é corrigido por situação/status)
drop policy if exists cftv_documento_itens_del on public.cftv_documento_itens;
create policy cftv_documento_itens_del on public.cftv_documento_itens for delete to authenticated using (public.cftv_pode_editar());
grant delete on public.cftv_documento_itens to authenticated;

alter table public.cftv_detalhes_sensiveis enable row level security;
drop policy if exists cftv_sens_all on public.cftv_detalhes_sensiveis;
create policy cftv_sens_all on public.cftv_detalhes_sensiveis for all to authenticated using (public.cftv_pode_detalhe()) with check (public.cftv_pode_detalhe());
revoke all on public.cftv_detalhes_sensiveis from anon;
grant select, insert, update, delete on public.cftv_detalhes_sensiveis to authenticated;
revoke all on public.cftv_acessos, public.cftv_log from anon;
grant select, insert, update, delete on public.cftv_acessos to authenticated;
grant select on public.cftv_log to authenticated;

do $$
declare t text;
begin
  foreach t in array array['cftv_lojas', 'cftv_premissas', 'cftv_documentos', 'cftv_documento_itens', 'cftv_equipamentos', 'cftv_movimentos',
    'cftv_cobertura', 'cftv_plano', 'cftv_manutencoes', 'cftv_detalhes_sensiveis', 'cftv_acessos'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_log', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.cftv_trg_log()', t || '_log', t);
  end loop;
end $$;
drop trigger if exists cftv_cobertura_hist_trg on public.cftv_cobertura;
create trigger cftv_cobertura_hist_trg after insert or update on public.cftv_cobertura for each row execute function public.cftv_trg_cobertura_hist();

-- Detalhe sensível nunca é gravado no inventário comum: a área (estoque, caixa…) fica; o ponto exato vai para
-- cftv_detalhes_sensiveis.

-- =====================================================================================================================
-- 8. Manutenção ligada à nota: nota de manutenção gera (ou atualiza) a ocorrência de manutenção
-- =====================================================================================================================
create or replace function public.cftv_sync_manutencao() returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat text; v_pecas numeric; v_mo numeric;
begin
  if new.natureza = 'manutencao' and new.status in ('ok', 'conferir') then
    select categoria into v_cat from public.cftv_documento_itens where documento_id = new.id and categoria <> 'servico'
      group by categoria order by sum(valor_total) desc nulls last limit 1;
    v_pecas := case when new.tipo = 'NF-e' then coalesce(new.valor_total, 0) else 0 end;
    v_mo := case when new.tipo <> 'NF-e' then coalesce(new.valor_total, 0) else 0 end;
    insert into public.cftv_manutencoes (loja_codigo, data, categoria, fornecedor, documento_id, descricao, pecas, mao_obra, valor_total, status)
    values (new.loja_codigo, coalesce(new.emissao, new.criado_em::date), v_cat, new.fornecedor, new.id, new.descricao, v_pecas, v_mo, coalesce(new.valor_total, 0), 'conferir')
    on conflict (documento_id) do update set loja_codigo = excluded.loja_codigo, data = excluded.data, fornecedor = excluded.fornecedor,
      valor_total = excluded.valor_total, pecas = excluded.pecas, mao_obra = excluded.mao_obra,
      categoria = coalesce(cftv_manutencoes.categoria, excluded.categoria),
      status = case when cftv_manutencoes.status = 'descartado' then 'conferir' else cftv_manutencoes.status end, atualizado_em = now();
  elsif tg_op = 'UPDATE' then
    update public.cftv_manutencoes set status = 'descartado', atualizado_em = now() where documento_id = new.id and status <> 'descartado';
  end if;
  return new;
end $$;
create or replace trigger cftv_doc_manutencao after insert or update of natureza, status, valor_total, loja_codigo, emissao on public.cftv_documentos
  for each row execute function public.cftv_sync_manutencao();

-- =====================================================================================================================
-- 9. Importação de documento (mesma regra para a tela e para o servidor): nunca duplica
-- =====================================================================================================================
create or replace function public.cftv_importar_documento(p jsonb, p_importacao bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ex public.cftv_documentos; v_id bigint; v_status text; v_conf text[]; v_it jsonb; v_ord int := 0; v_loja int; v_conf_loja text;
begin
  if not public.cftv_pode_editar() then raise exception 'Sem permissão para importar no módulo CFTV' using errcode = '42501'; end if;
  -- 1) mesmo arquivo
  if p ->> 'arquivo_hash' is not null then
    select * into v_ex from public.cftv_documentos where arquivo_hash = p ->> 'arquivo_hash';
    if found then return jsonb_build_object('resultado', 'duplicado', 'documento_id', v_ex.id, 'mensagem', 'Arquivo já importado (mesmo conteúdo).'); end if;
  end if;
  -- 2) mesma chave de acesso → não duplica; se o original ainda não tem arquivo, anexa
  if p ->> 'chave' is not null then
    select * into v_ex from public.cftv_documentos where chave = p ->> 'chave' and status <> 'duplicado';
    if found then
      if v_ex.arquivo_path is null and p ->> 'arquivo_path' is not null then
        update public.cftv_documentos set arquivo_path = p ->> 'arquivo_path', arquivo_hash = coalesce(arquivo_hash, p ->> 'arquivo_hash'), atualizado_em = now() where id = v_ex.id;
        return jsonb_build_object('resultado', 'anexado', 'documento_id', v_ex.id, 'mensagem', 'Nota já cadastrada: arquivo anexado ao registro existente.');
      end if;
      insert into public.cftv_documentos (tipo, chave, numero, serie, emissao, fornecedor, fornecedor_cnpj, valor_total, natureza, status, duplicado_de,
        arquivo_nome, arquivo_hash, importacao_id, conferir)
      values (p ->> 'tipo', p ->> 'chave', p ->> 'numero', p ->> 'serie', (p ->> 'emissao')::date, p ->> 'fornecedor', p ->> 'fornecedor_cnpj',
        (p ->> 'valor_total')::numeric, coalesce(p ->> 'natureza', 'outro'), 'duplicado', v_ex.id, p ->> 'arquivo_nome', p ->> 'arquivo_hash', p_importacao,
        array['Mesma chave de acesso da nota #' || v_ex.id || ' (' || coalesce(v_ex.arquivo_nome, '') || '). Não somada.'])
      returning id into v_id;
      return jsonb_build_object('resultado', 'duplicado', 'documento_id', v_id, 'original_id', v_ex.id, 'mensagem', 'Nota já importada (mesma chave de acesso): registrada como duplicada e não somada.');
    end if;
  end if;
  -- 3) sem chave: mesmo emitente, tipo, número, série e valor → duplicada
  if p ->> 'chave' is null and p ->> 'numero' is not null then
    select * into v_ex from public.cftv_documentos d where d.status <> 'duplicado' and d.tipo = p ->> 'tipo' and d.numero = p ->> 'numero'
      and coalesce(d.serie, '') = coalesce(p ->> 'serie', '') and coalesce(d.fornecedor_cnpj, '') = coalesce(p ->> 'fornecedor_cnpj', '')
      and d.valor_total is not distinct from (p ->> 'valor_total')::numeric limit 1;
    if found then
      insert into public.cftv_documentos (tipo, numero, serie, emissao, fornecedor, fornecedor_cnpj, valor_total, natureza, status, duplicado_de, arquivo_nome, arquivo_hash, importacao_id, conferir)
      values (p ->> 'tipo', p ->> 'numero', p ->> 'serie', (p ->> 'emissao')::date, p ->> 'fornecedor', p ->> 'fornecedor_cnpj', (p ->> 'valor_total')::numeric,
        coalesce(p ->> 'natureza', 'outro'), 'duplicado', v_ex.id, p ->> 'arquivo_nome', p ->> 'arquivo_hash', p_importacao,
        array['Mesmo emitente, número, série e valor da nota #' || v_ex.id || '. Não somada.'])
      returning id into v_id;
      return jsonb_build_object('resultado', 'duplicado', 'documento_id', v_id, 'original_id', v_ex.id, 'mensagem', 'Mesmo emitente, número e valor de uma nota já importada.');
    end if;
  end if;
  -- loja: CNPJ de filial já confirmado manda
  v_loja := nullif(p ->> 'loja_codigo', '')::int;
  v_conf_loja := p ->> 'loja_confianca';
  v_conf := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'conferir', '[]'))), '{}');
  if p ->> 'destinatario_cnpj' is not null and p ->> 'destinatario_cnpj' <> '44.616.854/0001-72' then
    select l.codigo into v_loja from public.cftv_lojas l where (p ->> 'destinatario_cnpj') = any (l.cnpjs) limit 1;
    if found then
      v_conf_loja := 'alta';
      v_conf := array(select x from unnest(v_conf) x where x not like 'Loja%' and x not like 'Mais de uma loja%');
    else v_loja := nullif(p ->> 'loja_codigo', '')::int;
    end if;
  end if;
  v_status := case when cardinality(v_conf) = 0 then 'ok' else 'conferir' end;
  insert into public.cftv_documentos (tipo, chave, numero, serie, emissao, competencia, fornecedor, fornecedor_cnpj, destinatario, destinatario_cnpj,
    destinatario_endereco, destinatario_municipio, loja_codigo, loja_confianca, loja_motivo, descricao, valor_produtos, frete, outras, desconto, valor_total,
    natureza, natureza_motivo, orcamento_ref, pedido, ocr, status, conferir, arquivo_nome, arquivo_hash, arquivo_path, importacao_id)
  values (p ->> 'tipo', p ->> 'chave', p ->> 'numero', p ->> 'serie', (p ->> 'emissao')::date, (p ->> 'competencia')::date, p ->> 'fornecedor',
    p ->> 'fornecedor_cnpj', p ->> 'destinatario', p ->> 'destinatario_cnpj', p ->> 'destinatario_endereco', p ->> 'destinatario_municipio', v_loja,
    v_conf_loja, p ->> 'loja_motivo', p ->> 'descricao', (p ->> 'valor_produtos')::numeric, coalesce((p ->> 'frete')::numeric, 0),
    coalesce((p ->> 'outras')::numeric, 0) + coalesce((p ->> 'seguro')::numeric, 0) + coalesce((p ->> 'ipi')::numeric, 0), coalesce((p ->> 'desconto')::numeric, 0),
    (p ->> 'valor_total')::numeric, coalesce(p ->> 'natureza', 'outro'), p ->> 'natureza_motivo', p ->> 'orcamento_ref', p ->> 'pedido',
    coalesce((p ->> 'ocr')::boolean, false), v_status, v_conf, p ->> 'arquivo_nome', p ->> 'arquivo_hash', p ->> 'arquivo_path', p_importacao)
  returning id into v_id;
  for v_it in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]')) loop
    v_ord := v_ord + 1;
    insert into public.cftv_documento_itens (documento_id, ordem, codigo, descricao, ncm, unidade, quantidade, valor_unit, valor_total, categoria, loja_codigo)
    values (v_id, v_ord, v_it ->> 'codigo', coalesce(v_it ->> 'descricao', '(sem descrição)'), v_it ->> 'ncm', v_it ->> 'unidade', (v_it ->> 'quantidade')::numeric,
      (v_it ->> 'valor_unit')::numeric, (v_it ->> 'valor_total')::numeric, coalesce(v_it ->> 'categoria', 'outro'), v_loja);
  end loop;
  -- recalcula a manutenção agora que os itens existem (categoria do equipamento)
  update public.cftv_documentos set atualizado_em = now(), natureza = natureza where id = v_id and natureza = 'manutencao';
  return jsonb_build_object('resultado', case when v_status = 'ok' then 'inserido' else 'conferir' end, 'documento_id', v_id, 'status', v_status, 'conferir', to_jsonb(v_conf));
end $$;

-- Conferência manual: confirma loja / natureza / finalidade; o CNPJ de filial passa a identificar a loja nas próximas notas.
create or replace function public.cftv_conferir_documento(p_id bigint, p_loja int, p_natureza text, p_finalidade text default null,
  p_status text default 'ok', p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.cftv_documentos;
begin
  if not public.cftv_pode_editar() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  select * into v from public.cftv_documentos where id = p_id for update;
  if not found then raise exception 'Documento % não encontrado', p_id; end if;
  if p_status not in ('ok', 'conferir', 'descartado') then raise exception 'Situação inválida: %', p_status; end if;
  update public.cftv_documentos set loja_codigo = p_loja, loja_confianca = case when p_loja is not null then 'confirmada' end,
    natureza = coalesce(p_natureza, natureza), finalidade = coalesce(p_finalidade, finalidade), status = p_status,
    conferir = case when p_status = 'ok' then '{}'::text[] else conferir end,
    conferido_por = coalesce(auth.jwt() ->> 'email', current_user), conferido_em = now(), atualizado_em = now()
  where id = p_id;
  update public.cftv_documento_itens set loja_codigo = p_loja where documento_id = p_id;
  if p_loja is not null and p_loja <> 0 and v.destinatario_cnpj is not null and v.destinatario_cnpj <> '44.616.854/0001-72' then
    update public.cftv_lojas set cnpjs = array(select distinct x from unnest(cnpjs || v.destinatario_cnpj) x) where codigo = p_loja;
  end if;
  insert into public.cftv_log (acao, tabela, registro, dados) values ('conferencia', 'cftv_documentos', p_id::text,
    jsonb_build_object('loja', p_loja, 'natureza', p_natureza, 'finalidade', p_finalidade, 'status', p_status, 'obs', p_obs));
end $$;

-- =====================================================================================================================
-- 10. Planilhas: cadastro CFTV por loja, levantamento de necessidades, inventário e movimentações
-- =====================================================================================================================
-- p_linhas vem já lido pela tela (leitor.js) — o mesmo formato para a tela e para o servidor.
create or replace function public.cftv_importar_planilha(p_tipo text, p_linhas jsonb, p_arquivo text, p_importacao bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; ign int := 0; v_area text; v_nec jsonb; v_loja int; v_ocup int; msgs text[] := '{}';
begin
  if not public.cftv_pode_editar() then raise exception 'Sem permissão para importar no módulo CFTV' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    v_loja := nullif(r ->> 'loja_codigo', '')::int;
    if v_loja is null then ign := ign + 1; msgs := msgs || ('Linha sem loja: ' || coalesce(r ->> 'filial', r::text)); continue; end if;
    if p_tipo in ('cadastro_lojas', 'levantamento') then
      insert into public.cftv_lojas (codigo, nome, tipo, regional, responsavel, dias_gravacao, capacidade_canais, canais_analog_livres, canais_ip_livres, fonte)
      values (v_loja, coalesce(r ->> 'nome', 'Loja ' || v_loja), r ->> 'tipo', r ->> 'regional', r ->> 'responsavel', (r ->> 'dias_gravacao')::int,
        (r ->> 'capacidade_canais')::int, (r ->> 'canais_analog_livres')::int, (r ->> 'canais_ip_livres')::int, p_arquivo)
      on conflict (codigo) do update set
        tipo = coalesce(excluded.tipo, cftv_lojas.tipo), regional = coalesce(excluded.regional, cftv_lojas.regional),
        responsavel = coalesce(excluded.responsavel, cftv_lojas.responsavel), dias_gravacao = coalesce(excluded.dias_gravacao, cftv_lojas.dias_gravacao),
        capacidade_canais = coalesce(excluded.capacidade_canais, cftv_lojas.capacidade_canais),
        canais_analog_livres = coalesce(excluded.canais_analog_livres, cftv_lojas.canais_analog_livres),
        canais_ip_livres = coalesce(excluded.canais_ip_livres, cftv_lojas.canais_ip_livres), fonte = excluded.fonte, atualizado_em = now();
      -- gravador e câmeras existentes (patrimônio anterior a 2026). Câmeras = canais analógicos ocupados: estimativa, marcada.
      if (r ->> 'capacidade_canais') is not null then
        insert into public.cftv_equipamentos (loja_codigo, categoria, descricao, quantidade, origem, situacao, fonte, fonte_chave, observacao)
        values (v_loja, 'dvr_nvr', 'Gravador ' || (r ->> 'capacidade_canais') || ' canais', 1, 'anterior_2026', 'instalado', p_arquivo, 'planilha:gravador:' || v_loja,
          'Capacidade ' || (r ->> 'capacidade_canais') || ' canais (planilha ' || p_arquivo || ').')
        on conflict (fonte_chave) do update set descricao = excluded.descricao, observacao = excluded.observacao, fonte = excluded.fonte, atualizado_em = now();
        if (r ->> 'canais_analog_livres') is not null then
          v_ocup := (r ->> 'capacidade_canais')::int - (r ->> 'canais_analog_livres')::int;
          if v_ocup > 0 then
            insert into public.cftv_equipamentos (loja_codigo, categoria, descricao, quantidade, origem, estimado, situacao, fonte, fonte_chave, observacao)
            values (v_loja, 'camera', 'Câmeras analógicas existentes', v_ocup, 'anterior_2026', true, 'instalado', p_arquivo, 'planilha:cameras:' || v_loja,
              'Estimativa: canais analógicos ocupados no gravador (' || (r ->> 'capacidade_canais') || ' − ' || (r ->> 'canais_analog_livres') || ' livres). Confirmar na loja.')
            on conflict (fonte_chave) do update set quantidade = excluded.quantidade, observacao = excluded.observacao, fonte = excluded.fonte, atualizado_em = now();
          end if;
        end if;
      end if;
      if p_tipo = 'levantamento' then
        update public.cftv_lojas set necessidade_texto = r ->> 'necessidade_texto', necessidade_cameras = (r ->> 'necessidade_cameras')::int,
          situacao_cftv = r ->> 'situacao_cftv', atualizado_em = now() where codigo = v_loja;
        v_nec := r -> 'areas';
        if v_nec is not null and coalesce(r ->> 'situacao_cftv', '') not ilike '%DESATIVADA%' then
          foreach v_area in array array['estoque', 'caixa', 'vendas', 'recebimento', 'entrada', 'outra'] loop
            insert into public.cftv_cobertura (loja_codigo, area, situacao, necessidade_cameras, observacao, fonte, avaliado_em)
            values (v_loja, v_area,
              case when (v_nec ->> 'completo')::boolean then case when v_area = 'estoque' then 'coberta' else 'nao_avaliada' end
                   when v_area = 'estoque' and (v_nec ->> 'sem_cameras_estoque')::boolean then 'sem_cobertura'
                   when coalesce((v_nec ->> v_area)::int, 0) > 0 then 'parcial'
                   else 'nao_avaliada' end,
              coalesce((v_nec ->> v_area)::int, 0), 'Levantamento: ' || coalesce(r ->> 'necessidade_texto', ''), p_arquivo, current_date)
            on conflict (loja_codigo, area) do update set
              -- avaliação feita na tela (fonte = 'manual') não é sobrescrita pela planilha
              situacao = case when cftv_cobertura.fonte = 'manual' then cftv_cobertura.situacao else excluded.situacao end,
              necessidade_cameras = excluded.necessidade_cameras, observacao = excluded.observacao, fonte = excluded.fonte, avaliado_em = excluded.avaliado_em, atualizado_em = now();
          end loop;
        end if;
      end if;
      n := n + 1;
    elsif p_tipo = 'inventario' then
      insert into public.cftv_equipamentos (loja_codigo, categoria, descricao, marca, modelo, numero_serie, quantidade, custo_unit, data_aquisicao, origem, area,
        situacao, fonte, fonte_chave, observacao)
      values (v_loja, coalesce(r ->> 'categoria', 'outro'), r ->> 'descricao', r ->> 'marca', r ->> 'modelo', r ->> 'numero_serie', coalesce((r ->> 'quantidade')::int, 1),
        (r ->> 'custo_unit')::numeric, (r ->> 'data_aquisicao')::date,
        case when (r ->> 'data_aquisicao')::date >= date '2026-01-01' then 'aquisicao_2026' else 'anterior_2026' end, r ->> 'area',
        coalesce(r ->> 'situacao', 'instalado'), p_arquivo, r ->> 'fonte_chave', r ->> 'observacao')
      on conflict (fonte_chave) do update set categoria = excluded.categoria, descricao = excluded.descricao, marca = excluded.marca, modelo = excluded.modelo,
        numero_serie = excluded.numero_serie, quantidade = excluded.quantidade, custo_unit = excluded.custo_unit, data_aquisicao = excluded.data_aquisicao,
        origem = excluded.origem, area = excluded.area, situacao = excluded.situacao, observacao = excluded.observacao, atualizado_em = now();
      n := n + 1;
    elsif p_tipo = 'movimentos' then
      insert into public.cftv_movimentos (loja_codigo, tipo, data, categoria, quantidade, observacao, loja_destino, fonte_chave)
      values (v_loja, r ->> 'tipo', (r ->> 'data')::date, r ->> 'categoria', coalesce((r ->> 'quantidade')::int, 1), r ->> 'observacao',
        nullif(r ->> 'loja_destino', '')::int, r ->> 'fonte_chave')
      on conflict (fonte_chave) do nothing;
      n := n + 1;
    else
      raise exception 'Tipo de planilha desconhecido: %', p_tipo;
    end if;
  end loop;
  if p_tipo = 'levantamento' then perform public.cftv_estimar_plano(); end if;
  insert into public.cftv_log (acao, tabela, registro, dados) values ('importacao', 'planilha:' || p_tipo, p_arquivo, jsonb_build_object('linhas', n, 'ignoradas', ign));
  return jsonb_build_object('resultado', 'planilha', 'tipo', p_tipo, 'linhas', n, 'ignoradas', ign, 'mensagens', to_jsonb(msgs));
end $$;

-- Registrar instalação a partir de um item comprado (comprado → instalado), com baixa opcional do equipamento substituído.
create or replace function public.cftv_instalar_item(p_item bigint, p_qtd int, p_area text, p_data date, p_substitui bigint default null, p_obs text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare i public.cftv_documento_itens; d public.cftv_documentos; v_inst int; v_eq bigint;
begin
  if not public.cftv_pode_editar() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  select * into i from public.cftv_documento_itens where id = p_item;
  select * into d from public.cftv_documentos where id = i.documento_id;
  if i.categoria in ('servico', 'cabeamento', 'conector_acessorio') then raise exception 'Item de serviço/consumo não vira equipamento.'; end if;
  if d.loja_codigo is null then raise exception 'Confirme a loja da nota antes de registrar a instalação.'; end if;
  select coalesce(sum(quantidade), 0) into v_inst from public.cftv_equipamentos where documento_item_id = p_item;
  if p_qtd < 1 or v_inst + p_qtd > ceil(i.quantidade) then raise exception 'Quantidade maior que a comprada (comprado %, já registrado %).', i.quantidade, v_inst; end if;
  insert into public.cftv_equipamentos (loja_codigo, categoria, descricao, quantidade, custo_unit, data_aquisicao, origem, area, situacao, documento_item_id,
    substitui_id, fonte, observacao)
  values (d.loja_codigo, i.categoria, i.descricao, p_qtd, i.valor_unit, d.emissao, 'aquisicao_2026', p_area, 'instalado', p_item, p_substitui,
    'NF ' || d.numero, p_obs) returning id into v_eq;
  insert into public.cftv_movimentos (loja_codigo, tipo, data, equipamento_id, equipamento_substituido_id, categoria, quantidade, documento_id, observacao)
  values (d.loja_codigo, case when p_substitui is null then 'instalacao' else 'substituicao' end, coalesce(p_data, current_date), v_eq, p_substitui, i.categoria,
    p_qtd, d.id, p_obs);
  if p_substitui is not null then update public.cftv_equipamentos set situacao = 'substituido', atualizado_em = now() where id = p_substitui; end if;
  return v_eq;
end $$;

-- =====================================================================================================================
-- 11. Plano de investimentos futuros (estimativa com premissas explícitas)
-- =====================================================================================================================
create or replace function public.cftv_estimar_plano() returns int language plpgsql security definer set search_path = public as $$
-- Valoriza a necessidade de cada loja pelo ORÇAMENTO vigente (proposta KGMlan 1011040400 de 26/10/2026):
--   equipamento (preço do orçamento) = câmeras × câmera + 2 conectores por câmera
--                                      + gravadores novos × (gravador 16 canais + HD 2TB + power balun 16 canais)
--   cabeamento  = câmeras × metros por câmera (premissa) × preço do metro do orçamento
--   mão de obra = câmeras × valor por ponto pago nas NFS-e de 2026
-- Gravador novo só quando a necessidade passa dos canais livres; sem canais livres informados, considera gravador novo.
declare l record; p_cam numeric; p_cabo numeric; p_m numeric; p_con numeric; p_mo numeric; p_dvr numeric; p_hd numeric; p_bal numeric;
  v_livres int; v_extra int; v_grav int; v_eq numeric; v_cab numeric; v_mo numeric; n int := 0;
begin
  select valor into p_cam from cftv_premissas where chave = 'preco_camera';
  select valor into p_cabo from cftv_premissas where chave = 'preco_cabo_metro';
  select valor into p_m from cftv_premissas where chave = 'metros_cabo_por_camera';
  select valor into p_con from cftv_premissas where chave = 'preco_conector';
  select valor into p_mo from cftv_premissas where chave = 'mao_obra_por_ponto';
  select valor into p_dvr from cftv_premissas where chave = 'preco_gravador_16';
  select valor into p_hd from cftv_premissas where chave = 'preco_hd_2tb';
  select valor into p_bal from cftv_premissas where chave = 'preco_power_balun_16';
  for l in select * from cftv_lojas where coalesce(necessidade_cameras, 0) > 0 and coalesce(situacao_cftv, '') not ilike '%DESATIVADA%' loop
    v_livres := case when l.canais_analog_livres is null and l.canais_ip_livres is null then null else coalesce(l.canais_analog_livres, 0) + coalesce(l.canais_ip_livres, 0) end;
    v_extra := greatest(0, l.necessidade_cameras - coalesce(v_livres, 0));
    v_grav := ceil(v_extra / 16.0);
    v_eq := round(l.necessidade_cameras * (p_cam + 2 * p_con) + v_grav * (p_dvr + p_hd + p_bal), 2);
    v_cab := round(l.necessidade_cameras * p_m * p_cabo, 2);
    v_mo := round(l.necessidade_cameras * p_mo, 2);
    insert into cftv_plano (loja_codigo, descricao, cameras, gravadores, valor_estimado, memoria_calculo, fonte, fonte_chave)
    values (l.codigo, 'Completar cobertura conforme levantamento: ' || coalesce(l.necessidade_texto, ''), l.necessidade_cameras, v_grav, v_eq + v_cab + v_mo,
      jsonb_build_object('cameras', l.necessidade_cameras, 'canais_livres', v_livres, 'canais_livres_informados', v_livres is not null,
        'gravadores_16_canais', v_grav, 'equipamento_orcamento', v_eq, 'cabeamento', v_cab, 'mao_obra', v_mo,
        'cameras_valor', round(l.necessidade_cameras * p_cam, 2), 'conectores_valor', round(l.necessidade_cameras * 2 * p_con, 2),
        'gravadores_valor', round(v_grav * (p_dvr + p_hd + p_bal), 2), 'orcamento', 'KGMlan 1011040400 (26/10/2026)'),
      'levantamento', 'levantamento:' || l.codigo)
    on conflict (fonte_chave) do update set descricao = excluded.descricao, cameras = excluded.cameras, gravadores = excluded.gravadores,
      valor_estimado = excluded.valor_estimado, memoria_calculo = excluded.memoria_calculo, atualizado_em = now()
      where cftv_plano.situacao = 'planejado';
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================================================================
-- 12. Painel: uma só fonte de números para a tela, o Cérebro Executivo e o Sentinela
-- =====================================================================================================================
-- Documentos que contam: status ok ou conferir (duplicados e descartados nunca somam).
create or replace function public.cftv_painel(p_de date default '2026-01-01', p_ate date default '2026-12-31', p_loja int default null,
  p_fornecedor text default null, p_categoria text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.cftv_pode_ver() then raise exception 'Sem acesso ao módulo Segurança Patrimonial e CFTV' using errcode = '42501'; end if;
  with
  docs as (
    select d.* from cftv_documentos d
    where d.status in ('ok', 'conferir') and d.emissao between p_de and p_ate
      and (p_loja is null or d.loja_codigo = p_loja) and (p_fornecedor is null or d.fornecedor ilike '%' || p_fornecedor || '%')
      and (p_categoria is null or exists (select 1 from cftv_documento_itens i where i.documento_id = d.id and i.categoria = p_categoria))),
  itens as (
    select i.*, d.emissao, d.natureza, d.fornecedor, d.finalidade from cftv_documento_itens i join docs d on d.id = i.documento_id
    where (p_categoria is null or i.categoria = p_categoria)),
  inv as (select d.* from docs d where d.natureza in ('aquisicao', 'instalacao')),
  man as (
    select m.* from cftv_manutencoes m
    where m.status <> 'descartado' and m.data between p_de and p_ate and (p_loja is null or m.loja_codigo = p_loja)
      and (p_fornecedor is null or m.fornecedor ilike '%' || p_fornecedor || '%') and (p_categoria is null or m.categoria = p_categoria)),
  eq as (select e.* from cftv_equipamentos e where (p_loja is null or e.loja_codigo = p_loja) and (p_categoria is null or e.categoria = p_categoria)),
  lojas_ativas as (select codigo from portal_lojas where ativo),
  pend as (
    select i.id, i.documento_id, i.descricao, i.categoria, i.loja_codigo, i.quantidade, i.valor_unit,
      greatest(0, i.quantidade - coalesce((select sum(e.quantidade) from cftv_equipamentos e where e.documento_item_id = i.id), 0)) as falta
    from itens i where i.natureza = 'aquisicao' and i.categoria in ('camera', 'dvr_nvr', 'hd', 'alarme_sensor', 'perimetro', 'incendio', 'rede_rack')),
  cob as (
    select l.codigo,
      bool_and(c.situacao = 'coberta') filter (where c.area in ('entrada', 'caixa', 'vendas', 'estoque', 'recebimento')) and count(c.*) filter (where c.area in ('entrada', 'caixa', 'vendas', 'estoque', 'recebimento')) = 5 as completa,
      bool_or(c.situacao in ('parcial', 'sem_cobertura')) as incompleta,
      max(c.situacao) filter (where c.area = 'estoque') as estoque
    from lojas_ativas l left join cftv_cobertura c on c.loja_codigo = l.codigo where (p_loja is null or l.codigo = p_loja) group by l.codigo)
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'filtros', jsonb_build_object('loja', p_loja, 'fornecedor', p_fornecedor, 'categoria', p_categoria),
    'atualizado_em', (select max(greatest(criado_em, atualizado_em)) from cftv_documentos),
    'fonte', 'Notas fiscais importadas (cftv_documentos/cftv_documento_itens), inventário (cftv_equipamentos), manutenções (cftv_manutencoes), cobertura (cftv_cobertura) e cadastro oficial de lojas (portal_lojas).',
    'financeiro', jsonb_build_object(
      'investimento_total', (select coalesce(sum(valor_total), 0) from inv),
      'aquisicao_equipamentos', (select coalesce(sum(valor_total), 0) from docs where natureza = 'aquisicao'),
      'servicos_instalacao', (select coalesce(sum(valor_total), 0) from docs where natureza = 'instalacao'),
      'frete_outras', (select coalesce(sum(frete + outras), 0) from docs where natureza = 'aquisicao'),
      'manutencao_total', (select coalesce(sum(valor_total), 0) from man),
      'monitoramento', (select coalesce(sum(valor_total), 0) from docs where natureza = 'monitoramento'),
      'outros', (select coalesce(sum(valor_total), 0) from docs where natureza = 'outro'),
      'evitavel', (select coalesce(sum(valor_total), 0) from man where classificacao in ('dano_acidental', 'possivel_mau_uso')),
      'evitavel_pct', (select case when sum(valor_total) > 0 then round(100 * coalesce(sum(valor_total) filter (where classificacao in ('dano_acidental', 'possivel_mau_uso')), 0) / sum(valor_total), 1) end from man),
      'reincidencia', (select coalesce(sum(valor_total), 0) from (select m.valor_total, count(*) over (partition by m.loja_codigo, m.categoria) n from man m where m.categoria is not null) x where n >= 2),
      'patrimonio_anterior_valor', (select sum(custo_unit * quantidade) from eq where origem = 'anterior_2026' and custo_unit is not null),
      'patrimonio_anterior_sem_custo', (select coalesce(sum(quantidade), 0) from eq where origem = 'anterior_2026' and custo_unit is null),
      'patrimonio_anterior_reposicao_estimada', (select round(sum(e.quantidade * case e.categoria when 'camera' then (select valor from cftv_premissas where chave = 'preco_camera')
          when 'dvr_nvr' then (select valor from cftv_premissas where chave = 'preco_gravador_16') end), 2) from eq e where e.origem = 'anterior_2026' and e.situacao not in ('retirado', 'baixado', 'substituido')),
      'patrimonio_atual_valor', (select coalesce(sum(custo_unit * quantidade), 0) from eq where situacao not in ('retirado', 'baixado', 'substituido') and custo_unit is not null),
      'pendente_instalacao_valor', (select round(coalesce(sum(falta * valor_unit), 0), 2) from pend where falta > 0),
      'docs_conferir', (select count(*) from docs where status = 'conferir'),
      'docs_conferir_valor', (select coalesce(sum(valor_total), 0) from docs where status = 'conferir')),
    'operacional', jsonb_build_object(
      'total_lojas', (select count(*) from lojas_ativas),
      'lojas_com_dados_cftv', (select count(*) from cftv_lojas c join lojas_ativas l on l.codigo = c.codigo where c.capacidade_canais is not null),
      'cameras_instaladas', (select coalesce(sum(quantidade), 0) from eq where categoria = 'camera' and situacao in ('instalado', 'defeito', 'fora_operacao')),
      'cameras_estimadas', (select coalesce(sum(quantidade), 0) from eq where categoria = 'camera' and estimado and situacao in ('instalado', 'defeito', 'fora_operacao')),
      'cameras_operando', (select coalesce(sum(quantidade), 0) from eq where categoria = 'camera' and situacao = 'instalado'),
      'gravadores', (select coalesce(sum(quantidade), 0) from eq where categoria = 'dvr_nvr' and situacao in ('instalado', 'defeito', 'fora_operacao')),
      'capacidade_canais', (select coalesce(sum(capacidade_canais), 0) from cftv_lojas c join lojas_ativas l on l.codigo = c.codigo where (p_loja is null or c.codigo = p_loja)),
      'canais_livres', (select coalesce(sum(coalesce(canais_analog_livres, 0) + coalesce(canais_ip_livres, 0)), 0) from cftv_lojas c join lojas_ativas l on l.codigo = c.codigo where (p_loja is null or c.codigo = p_loja)),
      'equipamentos_defeito', (select coalesce(sum(quantidade), 0) from eq where situacao in ('defeito', 'fora_operacao')),
      'lojas_estoque_coberto', (select count(*) from cob where estoque = 'coberta'),
      'lojas_estoque_avaliado', (select count(*) from cob where estoque is not null and estoque <> 'nao_avaliada'),
      'lojas_cobertura_completa', (select count(*) from cob where completa),
      'lojas_cobertura_incompleta', (select count(*) from cob where incompleta),
      'lojas_sem_avaliacao', (select count(*) from cob where estoque is null),
      'instalacoes_pendentes_itens', (select coalesce(sum(falta), 0) from pend where falta > 0),
      'cameras_compradas', (select coalesce(sum(quantidade), 0) from itens where categoria = 'camera' and natureza = 'aquisicao'),
      'necessidade_cameras', (select coalesce(sum(necessidade_cameras), 0) from cftv_lojas c join lojas_ativas l on l.codigo = c.codigo where (p_loja is null or c.codigo = p_loja) and coalesce(situacao_cftv, '') not ilike '%DESATIVADA%'),
      'plano_valor_estimado', (select coalesce(sum(valor_estimado), 0) from cftv_plano p join lojas_ativas l on l.codigo = p.loja_codigo where p.situacao in ('planejado', 'aprovado') and (p_loja is null or p.loja_codigo = p_loja))),
    'plano', (select jsonb_build_object('lojas', count(*), 'cameras', coalesce(sum(p.cameras), 0), 'gravadores', coalesce(sum(p.gravadores), 0),
        'equipamento_orcamento', coalesce(sum((p.memoria_calculo ->> 'equipamento_orcamento')::numeric), 0),
        'cameras_valor', coalesce(sum((p.memoria_calculo ->> 'cameras_valor')::numeric), 0),
        'conectores_valor', coalesce(sum((p.memoria_calculo ->> 'conectores_valor')::numeric), 0),
        'gravadores_valor', coalesce(sum((p.memoria_calculo ->> 'gravadores_valor')::numeric), 0),
        'cabeamento', coalesce(sum((p.memoria_calculo ->> 'cabeamento')::numeric), 0), 'mao_obra', coalesce(sum((p.memoria_calculo ->> 'mao_obra')::numeric), 0),
        'total', coalesce(sum(p.valor_estimado), 0), 'lojas_sem_canais_informados', count(*) filter (where not (p.memoria_calculo ->> 'canais_livres_informados')::boolean))
      from cftv_plano p join lojas_ativas l on l.codigo = p.loja_codigo where p.situacao in ('planejado', 'aprovado') and (p_loja is null or p.loja_codigo = p_loja)),
    'medias', jsonb_build_object(
      'custo_medio_camera', (select round(sum(valor_total) / nullif(sum(quantidade), 0), 2) from itens where categoria = 'camera' and natureza = 'aquisicao'),
      'lojas_com_investimento', (select count(distinct loja_codigo) from inv where loja_codigo > 0),
      'custo_medio_loja', (select round(sum(valor_total) filter (where loja_codigo > 0) / nullif(count(distinct loja_codigo) filter (where loja_codigo > 0), 0), 2) from inv)),
    'mensal', (select coalesce(jsonb_agg(x order by mes), '[]') from (
      select to_char(emissao, 'YYYY-MM') mes, sum(valor_total) filter (where natureza = 'aquisicao') aquisicao, sum(valor_total) filter (where natureza = 'instalacao') instalacao,
        sum(valor_total) filter (where natureza = 'monitoramento') monitoramento, sum(valor_total) filter (where natureza = 'manutencao') manutencao, sum(valor_total) filter (where natureza = 'outro') outros
      from docs group by 1) x),
    'manutencao_mensal', (select coalesce(jsonb_agg(x order by mes), '[]') from (select to_char(data, 'YYYY-MM') mes, sum(valor_total) valor, count(*) qtd from man group by 1) x),
    'por_loja', (select coalesce(jsonb_agg(x order by investimento desc nulls last), '[]') from (
      select d.loja_codigo, coalesce(l.nome, case when d.loja_codigo = 0 then 'CD / Matriz' else 'Sem loja definida' end) nome,
        sum(d.valor_total) investimento,
        sum(d.valor_total) filter (where d.natureza = 'aquisicao') aquisicao, sum(d.valor_total) filter (where d.natureza = 'instalacao') instalacao, count(*) notas
      from inv d left join cftv_lojas l on l.codigo = d.loja_codigo group by 1, 2) x),
    'por_fornecedor', (select coalesce(jsonb_agg(x order by valor desc), '[]') from (
      select coalesce(fornecedor, '(não lido)') fornecedor, sum(valor_total) valor, count(*) notas from docs group by 1) x),
    'por_categoria', (select coalesce(jsonb_agg(x order by valor desc), '[]') from (
      select categoria, sum(valor_total) valor, sum(quantidade) quantidade from itens where natureza = 'aquisicao' group by 1) x),
    'finalidade', (select coalesce(jsonb_agg(x), '[]') from (select finalidade, sum(valor_total) valor, count(*) notas from inv group by 1) x),
    'manutencao_classificacao', (select coalesce(jsonb_agg(x order by valor desc), '[]') from (select classificacao, sum(valor_total) valor, count(*) qtd from man group by 1) x),
    'manutencao_categoria', (select coalesce(jsonb_agg(x order by valor desc), '[]') from (select coalesce(categoria, 'nao_informada') categoria, sum(valor_total) valor, count(*) qtd from man group by 1) x),
    'ranking_manutencao', (select coalesce(jsonb_agg(x order by valor desc), '[]') from (
      select m.loja_codigo, coalesce(l.nome, case when m.loja_codigo = 0 then 'CD / Matriz' else 'Sem loja definida' end) nome, sum(m.valor_total) valor, count(*) ocorrencias,
        (select coalesce(sum(e.quantidade), 0) from cftv_equipamentos e where e.loja_codigo = m.loja_codigo and e.situacao in ('instalado', 'defeito', 'fora_operacao') and e.categoria in ('camera', 'dvr_nvr', 'alarme_sensor', 'hd')) equipamentos
      from man m left join cftv_lojas l on l.codigo = m.loja_codigo group by 1, 2) x),
    'cobertura_evolucao', (select coalesce(jsonb_agg(x order by dia), '[]') from (
      select dia, count(*) filter (where situacao = 'coberta') estoque_coberto, count(*) avaliadas from (
        select distinct on (h.loja_codigo, d.dia) d.dia, h.loja_codigo, h.situacao
        from (select distinct em::date dia from cftv_cobertura_hist) d join cftv_cobertura_hist h on h.area = 'estoque' and h.em::date <= d.dia
        order by h.loja_codigo, d.dia, h.em desc) s group by dia) x),
    'auditoria', (select jsonb_build_object('pendente', count(*) filter (where situacao = 'pendente'), 'suspeita', count(*) filter (where situacao = 'suspeita'),
       'confirmada', count(*) filter (where situacao = 'confirmada'), 'valor_suspeito', coalesce(sum(valor) filter (where situacao in ('suspeita', 'pendente')), 0))
       from cftv_ocorrencias where ativo and situacao not in ('descartada', 'corrigida') and (p_loja is null or loja_codigo = p_loja))
  ) into res;
  return res;
end $$;

-- =====================================================================================================================
-- 13. Auditoria automática
-- =====================================================================================================================
create or replace function public.cftv_auditar() returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; v_novas int;
begin
  if not public.cftv_pode_editar() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  create temp table if not exists _oc (chave text, regra text, titulo text, detalhe text, loja_codigo int, valor numeric, situacao text, gravidade text, refs jsonb) on commit drop;
  truncate _oc;

  -- R1 arquivo/nota repetida (já bloqueada na importação): confirmada, não somada
  insert into _oc select 'nf_duplicada:' || d.id, 'nf_duplicada', 'Nota fiscal importada em duplicidade', coalesce(d.conferir[1], 'Mesma nota em outro arquivo.'),
    o.loja_codigo, d.valor_total, 'confirmada', 'baixa', jsonb_build_object('documentos', jsonb_build_array(d.duplicado_de, d.id), 'arquivos', jsonb_build_array(o.arquivo_nome, d.arquivo_nome))
  from cftv_documentos d left join cftv_documentos o on o.id = d.duplicado_de where d.status = 'duplicado';
  -- R1b mesmo orçamento e mesmo valor em notas diferentes (possível cobrança em dobro)
  insert into _oc select 'mesmo_orcamento_valor:' || min(id) || ':' || max(id), 'nf_duplicada', 'Mesmo orçamento e mesmo valor em notas diferentes',
    'Orçamento ' || orcamento_ref || ': ' || count(*) || ' notas de ' || to_char(valor_total, 'FM999G999G990D00') || ' (nº ' || string_agg(numero, ', ' order by numero) || '). Conferir se são entregas distintas.',
    min(loja_codigo), valor_total, 'suspeita', 'alta', jsonb_build_object('documentos', jsonb_agg(id))
  from cftv_documentos where status in ('ok', 'conferir') and orcamento_ref is not null and valor_total > 0 group by orcamento_ref, valor_total, tipo having count(*) > 1;
  -- R2 nota sem loja vinculada
  insert into _oc select 'sem_loja:' || id, 'sem_loja', 'Documento sem loja vinculada', coalesce(loja_motivo, 'Loja não identificada.'), null, valor_total, 'pendente', 'media',
    jsonb_build_object('documentos', jsonb_build_array(id)) from cftv_documentos where status in ('ok', 'conferir') and loja_codigo is null;
  -- R3/R4 comprado e não instalado (equipamento físico sem registro de instalação no inventário)
  insert into _oc select 'nao_instalado:' || i.documento_id, 'comprado_nao_instalado', 'Equipamento comprado sem instalação registrada',
    string_agg(trim(to_char(i.falta, 'FM9999990')) || ' × ' || left(i.descricao, 50), '; '), d.loja_codigo, round(sum(i.falta * i.valor_unit), 2), 'pendente',
    case when sum(i.falta * i.valor_unit) > 3000 then 'alta' else 'media' end, jsonb_build_object('documentos', jsonb_build_array(d.id), 'itens', jsonb_agg(i.id))
  from (select it.*, greatest(0, it.quantidade - coalesce((select sum(e.quantidade) from cftv_equipamentos e where e.documento_item_id = it.id), 0)) falta
        from cftv_documento_itens it where it.categoria in ('camera', 'dvr_nvr', 'hd', 'alarme_sensor', 'perimetro', 'incendio', 'rede_rack')) i
  join cftv_documentos d on d.id = i.documento_id and d.status in ('ok', 'conferir') and d.natureza = 'aquisicao'
  where i.falta > 0 group by i.documento_id, d.id, d.loja_codigo;
  -- R3b compra × inventário por loja: aquisições 2026 cadastradas no inventário sem nota correspondente
  insert into _oc select 'inventario_sem_nota:' || e.loja_codigo || ':' || e.categoria, 'divergencia_compra_inventario', 'Inventário 2026 acima do comprado',
    'Loja ' || e.loja_codigo || ', ' || e.categoria || ': ' || sum(e.quantidade) || ' no inventário como aquisição 2026 sem item de nota vinculado.', e.loja_codigo, null, 'suspeita', 'media',
    jsonb_build_object('equipamentos', jsonb_agg(e.id))
  from cftv_equipamentos e where e.origem = 'aquisicao_2026' and e.documento_item_id is null group by e.loja_codigo, e.categoria;
  -- R5 substituição sem baixa do equipamento antigo
  insert into _oc select 'substituicao_sem_baixa:' || m.id, 'substituicao_sem_baixa', 'Substituição sem baixa do equipamento antigo',
    'Movimento ' || m.id || ' em ' || to_char(m.data, 'DD/MM/YYYY') || ': o equipamento substituído continua como "' || coalesce(e.situacao, 'não informado') || '".',
    m.loja_codigo, null, 'suspeita', 'media', jsonb_build_object('movimentos', jsonb_build_array(m.id))
  from cftv_movimentos m left join cftv_equipamentos e on e.id = m.equipamento_substituido_id
  where m.tipo = 'substituicao' and (m.equipamento_substituido_id is null or e.situacao in ('instalado', 'defeito', 'fora_operacao', 'em_estoque'));
  -- R6 manutenção repetida: 3+ ocorrências semelhantes na mesma loja em 12 meses → alerta para a Segurança
  insert into _oc select 'manutencao_recorrente:' || m.loja_codigo || ':' || coalesce(m.categoria, 'geral'), 'manutencao_recorrente',
    'Manutenção recorrente: ' || count(*) || ' ocorrências de ' || coalesce(m.categoria, 'equipamento não informado'),
    'Loja ' || m.loja_codigo || ', de ' || to_char(min(m.data), 'DD/MM/YYYY') || ' a ' || to_char(max(m.data), 'DD/MM/YYYY') || '. Avaliar causa e prevenção com a equipe de Segurança.',
    m.loja_codigo, sum(m.valor_total), 'suspeita', 'alta', jsonb_build_object('manutencoes', jsonb_agg(m.id))
  from cftv_manutencoes m where m.status <> 'descartado' and m.loja_codigo is not null and m.data >= current_date - 365
  group by m.loja_codigo, m.categoria having count(*) >= 3;
  -- R7 valores inconsistentes: soma dos itens ≠ total de produtos; quantidade × unitário ≠ total
  insert into _oc select 'soma_itens:' || d.id, 'valor_inconsistente', 'Soma dos itens diferente do total da nota',
    'Itens ' || to_char(s.soma, 'FM999G999G990D00') || ' × produtos ' || to_char(d.valor_produtos, 'FM999G999G990D00'), d.loja_codigo, abs(s.soma - d.valor_produtos), 'suspeita', 'media',
    jsonb_build_object('documentos', jsonb_build_array(d.id))
  from cftv_documentos d join (select documento_id, sum(valor_total) soma from cftv_documento_itens group by 1) s on s.documento_id = d.id
  where d.tipo = 'NF-e' and d.status in ('ok', 'conferir') and d.valor_produtos is not null and abs(s.soma - d.valor_produtos) > 0.05;
  insert into _oc select 'qtd_x_unit:' || i.id, 'valor_inconsistente', 'Quantidade × unitário diferente do total do item', left(i.descricao, 80), d.loja_codigo,
    abs(i.quantidade * i.valor_unit - i.valor_total), 'suspeita', 'baixa', jsonb_build_object('documentos', jsonb_build_array(d.id), 'itens', jsonb_build_array(i.id))
  from cftv_documento_itens i join cftv_documentos d on d.id = i.documento_id and d.status in ('ok', 'conferir')
  where i.quantidade is not null and i.valor_unit is not null and abs(round(i.quantidade * i.valor_unit, 2) - i.valor_total) > greatest(0.05, i.valor_total * 0.001);
  -- R7b mesmo produto (código do fornecedor) com preço unitário 30% acima do menor preço pago no ano
  insert into _oc select 'preco_divergente:' || i.id, 'valor_inconsistente', 'Mesmo produto com preço bem acima do menor preço pago',
    left(i.descricao, 60) || ': R$ ' || to_char(i.valor_unit, 'FM999G990D00') || ' na NF ' || d.numero || ' contra R$ ' || to_char(p.menor, 'FM999G990D00') || ' (NF ' || p.nf_menor || ').',
    d.loja_codigo, round((i.valor_unit - p.menor) * i.quantidade, 2), 'suspeita', case when (i.valor_unit - p.menor) * i.quantidade > 500 then 'alta' else 'media' end,
    jsonb_build_object('documentos', jsonb_build_array(d.id, p.doc_menor), 'itens', jsonb_build_array(i.id))
  from cftv_documento_itens i join cftv_documentos d on d.id = i.documento_id and d.status in ('ok', 'conferir')
  join lateral (select i2.valor_unit menor, d2.numero nf_menor, d2.id doc_menor from cftv_documento_itens i2 join cftv_documentos d2 on d2.id = i2.documento_id and d2.status in ('ok', 'conferir')
                where i2.codigo = i.codigo and i2.categoria = i.categoria and d2.fornecedor_cnpj = d.fornecedor_cnpj and i2.valor_unit > 0 order by i2.valor_unit limit 1) p on true
  where i.codigo is not null and i.valor_unit > p.menor * 1.3 and i.categoria not in ('servico');
  -- R8 gasto de manutenção sem documento
  insert into _oc select 'sem_documento:' || m.id, 'sem_documentacao', 'Manutenção sem nota ou comprovante', left(coalesce(m.descricao, ''), 120), m.loja_codigo, m.valor_total,
    'pendente', 'media', jsonb_build_object('manutencoes', jsonb_build_array(m.id))
  from cftv_manutencoes m where m.status <> 'descartado' and m.documento_id is null and m.valor_total > 0 and coalesce(m.evidencia, '') = '';
  -- R9 câmeras acima da capacidade do gravador
  insert into _oc select 'acima_capacidade:' || l.codigo, 'acima_capacidade', 'Câmeras acima da capacidade de gravação',
    'Loja ' || l.codigo || ': ' || c.cams || ' câmeras no inventário para ' || (l.capacidade_canais + coalesce(l.canais_ip_livres, 0)) || ' canais.', l.codigo, null, 'suspeita', 'alta',
    jsonb_build_object('loja', l.codigo)
  from cftv_lojas l join (select loja_codigo, sum(quantidade) cams from cftv_equipamentos where categoria = 'camera' and situacao in ('instalado', 'defeito', 'fora_operacao') group by 1) c
    on c.loja_codigo = l.codigo
  where l.capacidade_canais is not null and c.cams > l.capacidade_canais + coalesce(l.canais_ip_livres, 0);
  -- R10 mesmo CNPJ de filial atribuído a lojas diferentes
  insert into _oc select 'cnpj_lojas:' || destinatario_cnpj, 'cadastro_divergente', 'Mesmo CNPJ de destino em lojas diferentes',
    destinatario_cnpj || ': lojas ' || string_agg(distinct loja_codigo::text, ', '), null, null, 'suspeita', 'media', jsonb_build_object('documentos', jsonb_agg(id))
  from cftv_documentos where status in ('ok', 'conferir') and loja_codigo is not null and destinatario_cnpj is not null and destinatario_cnpj <> '44.616.854/0001-72'
  group by destinatario_cnpj having count(distinct loja_codigo) > 1;
  -- R11 investimento em loja desativada
  insert into _oc select 'loja_desativada:' || d.id, 'loja_desativada', 'Gasto em loja desativada', 'Loja ' || d.loja_codigo || ' está inativa no cadastro oficial.', d.loja_codigo, d.valor_total,
    'suspeita', 'alta', jsonb_build_object('documentos', jsonb_build_array(d.id))
  from cftv_documentos d join portal_lojas p on p.codigo = d.loja_codigo and not p.ativo where d.status in ('ok', 'conferir');

  -- grava: novas entram; existentes atualizam texto/valor; decisão humana é mantida; o que sumiu fica inativo
  insert into cftv_ocorrencias (chave, regra, titulo, detalhe, loja_codigo, valor, situacao, gravidade, refs)
  select distinct on (chave) chave, regra, titulo, detalhe, loja_codigo, valor, situacao, gravidade, refs from _oc
  on conflict (chave) do update set titulo = excluded.titulo, detalhe = excluded.detalhe, loja_codigo = excluded.loja_codigo, valor = excluded.valor,
    gravidade = excluded.gravidade, refs = excluded.refs, ativo = true, atualizado_em = now(),
    situacao = case when cftv_ocorrencias.decidida then cftv_ocorrencias.situacao else excluded.situacao end;
  get diagnostics n = row_count;
  update cftv_ocorrencias set ativo = false, atualizado_em = now() where ativo and chave not in (select chave from _oc);
  select count(*) into v_novas from cftv_ocorrencias where criado_em > now() - interval '1 minute';
  insert into cftv_log (acao, tabela, dados) values ('auditoria', 'cftv_ocorrencias', jsonb_build_object('casos', n, 'novas', v_novas));
  return jsonb_build_object('casos', n, 'novas', v_novas,
    'por_situacao', (select jsonb_object_agg(situacao, q) from (select situacao, count(*) q from cftv_ocorrencias where ativo group by 1) x));
end $$;

-- Decisão humana sobre uma ocorrência (histórico com responsável e data)
create or replace function public.cftv_decidir(p_id bigint, p_situacao text, p_obs text) returns void language plpgsql security definer set search_path = public as $$
declare v_de text;
begin
  if not public.cftv_pode_editar() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if p_situacao not in ('pendente', 'suspeita', 'confirmada', 'descartada', 'corrigida') then raise exception 'Situação inválida: %', p_situacao; end if;
  if length(coalesce(trim(p_obs), '')) < 5 then raise exception 'Informe a observação da decisão (mínimo 5 caracteres).'; end if;
  select situacao into v_de from cftv_ocorrencias where id = p_id for update;
  if not found then raise exception 'Ocorrência % não encontrada', p_id; end if;
  update cftv_ocorrencias set situacao = p_situacao, decidida = true, atualizado_em = now() where id = p_id;
  insert into cftv_ocorrencias_hist (ocorrencia_id, de, para, observacao) values (p_id, v_de, p_situacao, p_obs);
  insert into cftv_log (acao, tabela, registro, dados) values ('decisao', 'cftv_ocorrencias', p_id::text, jsonb_build_object('de', v_de, 'para', p_situacao, 'obs', p_obs));
end $$;

-- Verdade independente para o Sentinela: só devolve valor para o servidor (chave de serviço); para os demais, nenhuma linha.
-- (As funções conferem a permissão por dentro: cftv_pode_ver / cftv_pode_editar. Sem revoke, para não exigir aprovação extra.)
create or replace view public.sentinel_cftv_truth as
  select coalesce(sum(valor_total), 0)::numeric as total_investimento_2026
  from public.cftv_documentos where status in ('ok', 'conferir') and natureza in ('aquisicao', 'instalacao') and emissao between date '2026-01-01' and date '2026-12-31'
  having public.cftv_servidor();

-- =====================================================================================================================
-- 14. Armazenamento dos arquivos (notas, relatórios, evidências): privado
-- =====================================================================================================================
insert into storage.buckets (id, name, public) values ('cftv-documentos', 'cftv-documentos', false) on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cftv_docs_sel') then
    create policy cftv_docs_sel on storage.objects for select to authenticated using (bucket_id = 'cftv-documentos' and public.cftv_pode_ver());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cftv_docs_ins') then
    create policy cftv_docs_ins on storage.objects for insert to authenticated with check (bucket_id = 'cftv-documentos' and public.cftv_pode_editar());
  end if;
end $$;

-- =====================================================================================================================
-- 15. Premissas (preços da proposta KGMlan 1011040400 de 26/10/2026 e mão de obra das NFS-e de 2026)
-- =====================================================================================================================
insert into public.cftv_premissas (chave, valor, unidade, descricao, fonte, validada) values
  ('preco_camera', 211.46, 'R$/un', 'Câmera dome VHD 1230 D (Intelbras)', 'Proposta KGMlan 1011040400, 26/10/2026, item 2', true),
  ('preco_gravador_16', 1168.55, 'R$/un', 'Gravador MHDX 1216-C 16 canais', 'Proposta KGMlan 1011040400, 26/10/2026, item 4', true),
  ('preco_hd_2tb', 1300.00, 'R$/un', 'HD 2TB WD23PURZ', 'Proposta KGMlan 1011040400, 26/10/2026, item 6', true),
  ('preco_power_balun_16', 1549.90, 'R$/un', 'Power balun 16 canais VB 1016 WP', 'Proposta KGMlan 1011040400, 26/10/2026, item 7', true),
  ('preco_cabo_metro', 3.60, 'R$/m', 'Cabo UTP CAT6 (caixa 305 m por R$ 1.098,00)', 'Proposta KGMlan 1011040400, 26/10/2026, item 1', true),
  ('preco_conector', 0.99, 'R$/un', 'Conector macho RJ45 CAT6', 'Proposta KGMlan 1011040400, 26/10/2026, item 3', true),
  ('mao_obra_por_ponto', 70.00, 'R$/ponto', 'Mão de obra por ponto instalado', 'NFS-e D. Guardian 2026: 9 mão de obra = R$ 630 (nº 203), 3 = R$ 210 (nº 204), 2 = R$ 140 (nº 136/137)', true),
  ('preco_gravador_16_com_hd', 2341.85, 'R$/un', 'Gravador MHDX 1216-C dual com HD 2TB', 'Proposta KGMlan 1011040400, 26/10/2026, item 5', true),
  ('preco_rack_5u', 760.37, 'R$/un', 'Rack de parede desmontável 19" 5U', 'Proposta KGMlan 1011040400, 26/10/2026, item 8', true),
  ('metros_cabo_por_camera', 20, 'm', 'Metragem média de cabo por câmera', 'Premissa a validar pela Segurança (não há medição por loja)', false)
on conflict (chave) do nothing;

-- =====================================================================================================================
-- 16. Lojas: nomes e apelidos para reconhecer a loja de destino das notas (códigos do cadastro oficial portal_lojas).
--     "~" = apelido inferido (ex.: "CARUARU 1"): só sugere, a nota vai para conferência.
-- =====================================================================================================================
insert into public.cftv_lojas (codigo, nome, cidade, apelidos, chaves, tipo) values
  (0, 'CD / Matriz', 'Recife', array['CENTRO DE DISTRIBUICAO']::text[], '{}'::text[], 'CD'),
  (905, 'Camaragibe', 'Camaragibe', array['CAMARAGIBE']::text[], '{}'::text[], ''),
  (906, 'Abreu e Lima', 'Abreu e Lima', array['ABREU E LIMA']::text[], '{}'::text[], ''),
  (907, 'Casa Amarela', 'Recife', array['CASA AMARELA']::text[], '{}'::text[], ''),
  (908, 'Shopping Boa Vista', 'Recife', array['SHOPPING BOA VISTA']::text[], array['BOA VISTA']::text[], ''),
  (909, 'Mix Mateus Casa Forte', 'Recife', array['CASA FORTE']::text[], '{}'::text[], ''),
  (912, 'Shopping Recife', 'Recife', array['SHOPPING RECIFE']::text[], '{}'::text[], ''),
  (913, 'Paulista', 'Paulista', array['PAULISTA']::text[], '{}'::text[], ''),
  (914, 'Shopping Tacaruna I', 'Recife', array['TACARUNA']::text[], '{}'::text[], ''),
  (915, 'Shopping Guararapes', 'Jaboatao dos Guararapes', array['GUARARAPES']::text[], '{}'::text[], ''),
  (916, 'Mix Mateus Peixinhos', 'Olinda', array['PEIXINHOS']::text[], '{}'::text[], ''),
  (917, 'Mix Mateus Boa Viagem (desativada)', 'Recife', array['MIX MATEUS BOA VIAGEM','MIX MATHEUS BOA VIAGEM']::text[], '{}'::text[], ''),
  (918, 'Shopping Patteo', 'Olinda', array['SHOPPING PATTEO','PATTEO OLINDA']::text[], '{}'::text[], ''),
  (919, 'Prazeres', 'Jaboatao dos Guararapes', array['PRAZERES']::text[], '{}'::text[], ''),
  (920, 'Rua da Palma', 'Recife', array['RUA DA PALMA']::text[], '{}'::text[], ''),
  (921, 'Goiana', 'Goiana', array['GOIANA']::text[], '{}'::text[], ''),
  (923, 'North Shopping Caruaru', 'Caruaru', array['NORTH SHOPPING CARUARU']::text[], array['CARUARU']::text[], ''),
  (924, 'Duque de Caxias', 'Recife', array['DUQUE DE CAXIAS']::text[], '{}'::text[], ''),
  (926, 'Macaíba', 'Macaiba', array['MACAIBA']::text[], '{}'::text[], ''),
  (927, 'Mangabeira Rua', 'Joao Pessoa', array['MANGABEIRA RUA']::text[], array['MANGABEIRA']::text[], ''),
  (928, 'ES Sports Manaíra', 'Joao Pessoa', array['ES SPORTS MANAIRA','ES SPORT MANAIRA']::text[], array['MANAIRA']::text[], ''),
  (929, 'Caruaru Centro II', 'Caruaru', array['CARUARU CENTRO II','~CARUARU 2','~CARUARU II']::text[], array['CARUARU']::text[], ''),
  (930, 'Palmares', 'Palmares', array['PALMARES']::text[], '{}'::text[], ''),
  (931, 'ES Sports Riomar', 'Recife', array['ES SPORTS RIOMAR','ES SPORTS RIO MAR']::text[], '{}'::text[], ''),
  (932, 'Shopping Difusora', 'Caruaru', array['DIFUSORA']::text[], array['CARUARU']::text[], ''),
  (933, 'Natal Centro', 'Natal', array['NATAL CENTRO']::text[], array['NATAL']::text[], ''),
  (934, 'Petrolina (Mix Mateus)', 'Petrolina', array['MIX MATEUS PETROLINA']::text[], array['PETROLINA']::text[], ''),
  (935, 'Shopping Midway Mall', 'Natal', array['MIDWAY']::text[], array['NATAL']::text[], ''),
  (936, 'Natal Shopping', 'Natal', array['NATAL SHOPPING']::text[], array['NATAL']::text[], ''),
  (937, 'Juazeiro', 'Juazeiro', array['JUAZEIRO']::text[], '{}'::text[], ''),
  (938, 'Beberibe', 'Recife', array['BEBERIBE']::text[], '{}'::text[], ''),
  (939, 'Bezerros', 'Bezerros', array['BEZERROS']::text[], '{}'::text[], ''),
  (940, 'Carrefour Av. Recife', 'Recife', array['CARREFOUR']::text[], '{}'::text[], ''),
  (941, 'Vitória de Santo Antão', 'Vitoria de Santo Antao', array['VITORIA DE SANTO ANTAO']::text[], array['VITORIA']::text[], ''),
  (942, 'Cabo de Santo Agostinho', 'Cabo de Santo Agostinho', array['CABO DE SANTO AGOSTINHO']::text[], '{}'::text[], ''),
  (943, 'Caruaru Centro I', 'Caruaru', array['CARUARU CENTRO I','~CARUARU 1','~CARUARU I']::text[], array['CARUARU']::text[], ''),
  (944, 'ES Natal', 'Natal', array['ES NATAL','ES SPORTS NATAL','ES SPORT NATAL','ES ESPORT NATAL','ES SPORTS NATAL SHOPPING']::text[], array['NATAL']::text[], ''),
  (945, 'Jaboatão Velho', 'Jaboatao dos Guararapes', array['JABOATAO VELHO']::text[], '{}'::text[], ''),
  (946, 'ES Shopping Boa Vista', 'Recife', array['ES SHOPPING BOA VISTA','ES SPORTS BOA VISTA','ES SPORT BOA VISTA']::text[], array['BOA VISTA']::text[], ''),
  (947, 'ES Shopping Pátio Maceió', 'Maceio', array['ES SHOPPING PATIO MACEIO','ES SPORTS MACEIO','ESPORTE MACEIO','ES SPORTS PATIO MACEIO']::text[], array['MACEIO']::text[], ''),
  (948, 'Esposende Shopping Pátio Maceió', 'Maceio', array['SHOPPING PATIO MACEIO','SHOPPING PATTEO MACEIO','~SHOPPING MACEIO']::text[], array['MACEIO']::text[], ''),
  (949, 'North Shopping Partage', 'Natal', array['~NORTH SHOPPING PARTAGE','~PARTAGE']::text[], array['NATAL']::text[], ''),
  (950, 'Shopping Manaíra', 'Joao Pessoa', array['SHOPPING MANAIRA']::text[], array['MANAIRA']::text[], ''),
  (951, 'Maceió Centro', 'Maceio', array['MACEIO CENTRO']::text[], array['MACEIO']::text[], ''),
  (953, 'Carpina', 'Carpina', array['CARPINA']::text[], '{}'::text[], ''),
  (954, 'Shopping Costa Dourada', 'Cabo de Santo Agostinho', array['COSTA DOURADA']::text[], '{}'::text[], ''),
  (955, 'Limoeiro', 'Limoeiro', array['LIMOEIRO']::text[], '{}'::text[], ''),
  (956, 'Ipojuca', 'Ipojuca', array['IPOJUCA']::text[], '{}'::text[], ''),
  (957, 'São Lourenço', 'Sao Lourenco da Mata', array['SAO LOURENCO']::text[], '{}'::text[], ''),
  (958, 'Santa Cruz do Capibaribe', 'Santa Cruz do Capibaribe', array['SANTA CRUZ DO CAPIBARIBE','SANTA CRUZ DO CAPIPARIBE','SANTA CRUZ']::text[], '{}'::text[], ''),
  (959, 'Partage Norte Shopping', 'Natal', '{}'::text[], array['PARTAGE']::text[], ''),
  (960, 'Gravatá', 'Gravata', array['GRAVATA']::text[], '{}'::text[], ''),
  (961, 'Surubim', 'Surubim', array['SURUBIM']::text[], '{}'::text[], ''),
  (963, 'Shopping Igarassu', 'Igarassu', array['IGARASSU']::text[], '{}'::text[], ''),
  (964, 'Shopping River Petrolina', 'Petrolina', array['SHOPPING RIVER','RIVER PETROLINA']::text[], array['PETROLINA']::text[], ''),
  (972, 'Cavaleiro', 'Jaboatao dos Guararapes', array['CAVALEIRO']::text[], '{}'::text[], ''),
  (974, 'Shopping RioMar', 'Recife', array['SHOPPING RIO MAR','SHOPPING RIOMAR']::text[], '{}'::text[], ''),
  (975, 'Alecrim', 'Natal', array['ALECRIM']::text[], array['NATAL']::text[], ''),
  (977, 'Arcoverde', 'Arcoverde', array['ARCOVERDE']::text[], '{}'::text[], ''),
  (978, 'Vitória Shopping', 'Vitoria de Santo Antao', array['VITORIA SHOPPING']::text[], array['VITORIA']::text[], ''),
  (980, 'Salgueiro', 'Salgueiro', array['SALGUEIRO']::text[], '{}'::text[], ''),
  (982, 'Pesqueira', 'Pesqueira', array['PESQUEIRA']::text[], '{}'::text[], ''),
  (983, 'Shopping Mangabeira', 'Joao Pessoa', array['SHOPPING MANGABEIRA']::text[], array['MANGABEIRA']::text[], ''),
  (991, 'Parnamirim', 'Parnamirim', array['PARNAMIRIM']::text[], '{}'::text[], ''),
  (992, 'Afogados', 'Recife', array['AFOGADOS']::text[], '{}'::text[], ''),
  (993, 'Mix Mateus Casa Caiada', 'Olinda', array['CASA CAIADA']::text[], '{}'::text[], ''),
  (994, 'Bayeux', 'Bayeux', array['BAYEUX']::text[], '{}'::text[], ''),
  (995, 'Garanhuns', 'Garanhuns', array['GARANHUNS']::text[], '{}'::text[], ''),
  (996, 'Paulista North Way Shopping', 'Paulista', array['NORTH WAY']::text[], array['PAULISTA']::text[], '')
on conflict (codigo) do update set apelidos = excluded.apelidos, chaves = excluded.chaves, cidade = coalesce(cftv_lojas.cidade, excluded.cidade),
  nome = excluded.nome;
update public.cftv_lojas set tipo = null where tipo = '';
