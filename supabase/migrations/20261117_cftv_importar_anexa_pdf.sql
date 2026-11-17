-- CFTV · Importação: arquivo idêntico (mesmo SHA-256) a uma nota já lançada SEM PDF passa a ANEXAR o arquivo
-- ao registro existente (resultado 'anexado'), em vez de só responder 'duplicado'. Nada é somado de novo.
-- Uso: notas lançadas pela auditoria de 17/11/2026 (NF_2.zip) ficaram sem o PDF; basta reimportar o ZIP na aba Importação.
do $mig$
declare d text;
  velho text := $q$    if found then return jsonb_build_object('resultado', 'duplicado', 'documento_id', v_ex.id, 'mensagem', 'Arquivo já importado (mesmo conteúdo).'); end if;$q$;
  novo text := $q$    if found then
      if v_ex.arquivo_path is null and p ->> 'arquivo_path' is not null then
        update public.cftv_documentos set arquivo_path = p ->> 'arquivo_path', atualizado_em = now() where id = v_ex.id;
        return jsonb_build_object('resultado', 'anexado', 'documento_id', v_ex.id, 'mensagem', 'Nota já cadastrada: PDF anexado ao registro existente.');
      end if;
      return jsonb_build_object('resultado', 'duplicado', 'documento_id', v_ex.id, 'mensagem', 'Arquivo já importado (mesmo conteúdo).');
    end if;$q$;
begin
  d := pg_get_functiondef('public.cftv_importar_documento(jsonb,bigint)'::regprocedure);
  if position(velho in d) = 0 then
    if position('PDF anexado ao registro existente' in d) > 0 then return; end if; -- já aplicada
    raise exception 'cftv_importar_documento mudou: trecho do arquivo duplicado não encontrado';
  end if;
  execute replace(d, velho, novo);
end $mig$;
