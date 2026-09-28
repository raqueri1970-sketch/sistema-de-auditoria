# Gera AJUSTE_EXPRESS_PACOTE.zip para levar a outro computador: sem token, sem diario, sem logs.
import zipfile, sys
from pathlib import Path
BASE = Path(__file__).resolve().parent
OUT = BASE.parent / "AJUSTE_EXPRESS_PACOTE.zip"
EXCLUIR_NOMES = {"config.json", "journal.json", "state.json", "STOP", "PAUSA", "loop_out.txt", "loop_err.txt", "testes_resultado.txt", "supervisor.log", "executor.log", "executor.log.1"}
EXCLUIR_DIRS = {"__pycache__", "diag", "_backup_pre_auditoria"}
n = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(BASE.rglob("*")):
        rel = p.relative_to(BASE)
        if p.is_dir() or p.name in EXCLUIR_NOMES or any(part in EXCLUIR_DIRS for part in rel.parts) or p.suffix in (".bak", ".pyc") or ".bak" in p.name: continue
        z.write(p, "AJUSTE_EXPRESS_EXECUTOR/" + rel.as_posix()); n += 1
print(f"{n} arquivos -> {OUT}  ({OUT.stat().st_size // 1024} KB)")
with zipfile.ZipFile(OUT) as z:
    nomes = [i.filename for i in z.infolist()]
    assert not any(x.endswith("config.json") for x in nomes), "config.json nao pode ir no pacote!"
    print("conferido: sem config.json/token no pacote")
