-- 15/10/2026 (pedido do Ricardo): o que o prestador escreve na legenda da foto no WhatsApp ("Diária servente 12/10 - Maceió centro",
-- "Janta Jhony"...) passa a fazer parte da descrição da despesa. Antes ficava só em "legenda" e a descrição vinha vazia ou
-- genérica ("Transferência PIX", "Pagamento Pix"). Só texto: nenhum valor, status ou pagamento é alterado.
-- O robô (obras_bot.js) já grava assim nas fotos novas; aqui as já lançadas são acertadas.
update public.obras_comprovantes c
   set descricao = left(case
         when c.descricao is null or btrim(c.descricao) = ''
           or c.descricao ~* '^\s*(transfer[eê]ncia|pagamento|pix|ifoodbr)(\s+(de\s+)?pix)?\s*$'
         then btrim(c.legenda)
         else btrim(c.legenda) || ' · ' || c.descricao end, 2000),
       updated_at = now()
 where c.origem = 'whatsapp'
   and c.status in ('lancado', 'orcamento', 'duplicada', 'pagamento')
   and coalesce(btrim(c.legenda), '') <> ''
   and c.legenda !~* '\.(pdf|jpe?g|png|heic)\s*$'
   and coalesce(c.wa_msg_id, '') !~ '#T'
   and position(lower(btrim(c.legenda)) in lower(coalesce(c.descricao, ''))) = 0;
