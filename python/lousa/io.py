"""Leitura de CSV e Excel vindos do navegador (bytes), com o jeito brasileiro de exportar planilhas em mente:
`;` como separador, vírgula decimal, ponto de milhar e arquivos em Latin-1."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass

import pandas as pd

MAX_COLUMNS = 500
EXCEL_EXT = (".xlsx", ".xlsm", ".xls", ".xlsb", ".ods")

_BR_NUMBER = re.compile(r"^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+,\d+$")


class ReadError(ValueError):
    """Erro de leitura com mensagem pronta para a tela."""


@dataclass
class CsvDialect:
    encoding: str
    sep: str
    decimal: str
    thousands: str | None


def is_excel(filename: str) -> bool:
    return filename.lower().endswith(EXCEL_EXT)


def decode(data: bytes) -> tuple[str, str]:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1"), "latin-1"


def sniff(text: str) -> CsvDialect:
    sample = "\n".join(text.splitlines()[:50])
    try:
        sep = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        counts = {d: sample.count(d) for d in (",", ";", "\t", "|")}
        sep = max(counts, key=counts.get)
    decimal, thousands = ".", None
    if sep != ",":
        cells = [c.strip().strip('"') for line in sample.splitlines()[1:] for c in line.split(sep)]
        br = sum(1 for c in cells if _BR_NUMBER.match(c) and ("," in c))
        if br >= max(3, len(cells) * 0.02):
            decimal, thousands = ",", "."
    return CsvDialect(encoding="", sep=sep, decimal=decimal, thousands=thousands)


def read_csv(data: bytes) -> tuple[pd.DataFrame, dict]:
    text, enc = decode(data)
    if not text.strip():
        raise ReadError("O arquivo está vazio.")
    d = sniff(text)
    try:
        df = pd.read_csv(
            io.StringIO(text), sep=d.sep, decimal=d.decimal, thousands=d.thousands, low_memory=False
        )
    except pd.errors.ParserError as e:
        raise ReadError(f"Não consegui ler o CSV: {e}") from e
    info = {"format": "csv", "encoding": enc, "sep": d.sep, "decimal": d.decimal}
    return _clean(df), info


def excel_sheets(data: bytes) -> list[dict]:
    from python_calamine import CalamineWorkbook

    wb = CalamineWorkbook.from_filelike(io.BytesIO(data))
    out = []
    for name in wb.sheet_names:
        sheet = wb.get_sheet_by_name(name)
        out.append({"name": name, "rows": max(sheet.height - 1, 0), "cols": sheet.width})
    return out


def read_excel(data: bytes, sheet: str | None = None) -> tuple[pd.DataFrame, dict]:
    try:
        sheets = excel_sheets(data)
    except Exception as e:  # o calamine levanta tipos próprios
        raise ReadError(f"Não consegui abrir a planilha: {e}") from e
    if not sheets:
        raise ReadError("A planilha não tem abas.")
    names = [s["name"] for s in sheets]
    if sheet is None:
        sheet = max(sheets, key=lambda s: s["rows"] * max(s["cols"], 1))["name"]
    if sheet not in names:
        raise ReadError(f"A aba '{sheet}' não existe. Abas: {', '.join(names)}.")
    df = pd.read_excel(io.BytesIO(data), sheet_name=sheet, engine="calamine")
    return _clean(df), {"format": "excel", "sheet": sheet, "sheets": sheets}


def read_table(data: bytes, filename: str, sheet: str | None = None) -> tuple[pd.DataFrame, dict]:
    df, info = read_excel(data, sheet) if is_excel(filename) else read_csv(data)
    if df.shape[1] > MAX_COLUMNS:
        raise ReadError(f"O arquivo tem {df.shape[1]} colunas; o limite é {MAX_COLUMNS}.")
    if df.empty:
        raise ReadError("Não encontrei linhas de dados no arquivo.")
    info.update({"filename": filename, "rows": int(df.shape[0]), "cols": int(df.shape[1])})
    return df, info


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(how="all").dropna(axis=1, how="all")
    cols, seen = [], {}
    for i, c in enumerate(df.columns):
        name = str(c).strip()
        if not name or name.startswith("Unnamed:"):
            name = f"coluna_{i + 1}"
        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0
        cols.append(name)
    df.columns = cols
    # Texto com espaços nas pontas vira texto limpo; "" vira nulo.
    for c in df.columns:
        if df[c].dtype == object or pd.api.types.is_string_dtype(df[c]):
            s = df[c].astype("string").str.strip()
            df[c] = s.mask(s == "")
    return df.reset_index(drop=True)
