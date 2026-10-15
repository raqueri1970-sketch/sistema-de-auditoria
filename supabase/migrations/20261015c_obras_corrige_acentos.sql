-- 15/10/2026: textos importados dos PDFs de prestação vieram com acentuação quebrada ("â€”" no lugar de "—",
-- "Ã§" no lugar de "ç"): pedaços em UTF-8 lidos como Windows-1252, misturados com acentos certos na mesma frase.
-- Por isso a troca é por sequência conhecida. Só descrição e fornecedor; nada de valor, status ou pagamento.
create or replace function obras_interno.desfaz_mojibake(t text) returns text language plpgsql immutable as $$
declare par text[]; pares text[][] := array[
  ['â€”', '—'], ['â€“', '–'], ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€¢', '•'], ['â€¦', '…'], ['â€', '”'],
  ['Ã§', 'ç'], ['Ã£', 'ã'], ['Ã¡', 'á'], ['Ã©', 'é'], ['Ãª', 'ê'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãµ', 'õ'], ['Ã´', 'ô'],
  ['Ãº', 'ú'], ['Ã¢', 'â'], ['Ã¼', 'ü'], ['Ã‡', 'Ç'], ['Ã‰', 'É'], ['Ã“', 'Ó'], ['Ãš', 'Ú'], ['Ãƒ', 'Ã'],
  ['Ã•', 'Õ'], ['ÃŠ', 'Ê'], ['Ã‚', 'Â'], ['Âº', 'º'], ['Âª', 'ª'], ['Â·', '·'], ['Â°', '°']];
begin
  if t is null or t !~ '(â€|Ã|Â)' then return t; end if;
  foreach par slice 1 in array pares loop t := replace(t, par[1], par[2]); end loop;
  return t;
end $$;

update public.obras_comprovantes
   set descricao = obras_interno.desfaz_mojibake(descricao),
       fornecedor = obras_interno.desfaz_mojibake(fornecedor),
       updated_at = now()
 where (descricao ~ '(â€|Ã|Â)' or fornecedor ~ '(â€|Ã|Â)')
   and (obras_interno.desfaz_mojibake(descricao) is distinct from descricao or obras_interno.desfaz_mojibake(fornecedor) is distinct from fornecedor);
