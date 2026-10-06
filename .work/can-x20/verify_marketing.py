import csv
import re
import sys
import zipfile
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET


OLD = Path(sys.argv[1])
NEW = Path(sys.argv[2])
ARFF = Path(sys.argv[3])
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.findall(".//m:t", NS)) for si in root.findall("m:si", NS)]


def sheet_cells(z, index):
    strings = shared_strings(z)
    root = ET.fromstring(z.read(f"xl/worksheets/sheet{index}.xml"))
    result = {}
    for cell in root.findall(".//m:sheetData/m:row/m:c", NS):
        addr = cell.attrib["r"]
        typ = cell.attrib.get("t")
        if typ == "inlineStr":
            value = "".join(x.text or "" for x in cell.findall(".//m:t", NS))
        else:
            v = cell.find("m:v", NS)
            if v is None:
                continue
            value = strings[int(v.text)] if typ == "s" else v.text
        result[addr] = value
    return result


def normalized(value):
    if value is None:
        return None
    try:
        return str(Decimal(value).quantize(Decimal("0.00000001")).normalize())
    except (ValueError, ArithmeticError):
        return value


with zipfile.ZipFile(OLD) as original, zipfile.ZipFile(NEW) as updated:
    assert updated.testzip() is None
    for index in range(1, 6):
        before = {k: normalized(v) for k, v in sheet_cells(original, index).items()}
        after = {k: normalized(v) for k, v in sheet_cells(updated, index).items()}
        if before != after:
            keys = sorted(set(before) | set(after))
            differences = [(k, before.get(k), after.get(k)) for k in keys if before.get(k) != after.get(k)]
            raise AssertionError(f"Prior sheet {index} changed: {len(differences)} differences; sample {differences[:5]}")

    workbook = ET.fromstring(updated.read("xl/workbook.xml"))
    sheet_names = [s.attrib["name"] for s in workbook.findall("m:sheets/m:sheet", NS)]
    assert sheet_names == ["Customer churn", "Fantasy football", "Sales forecast", "Employee attrition", "House prices", "Marketing campaign", "Sources & notes"]
    marketing = sheet_cells(updated, 6)
    headers = [marketing.get(f"{chr(64+c)}1") for c in range(1, 27)]
    assert len(headers) == 26 and headers[-1] == "Response"
    labels = Counter(marketing.get(f"Z{r}") for r in range(2, 2242))
    assert sum(labels.values()) == 2240 and labels[None] == 112
    assert set(labels) == {"No", "Yes", None}

    source_data = []
    in_data = False
    for raw in ARFF.read_text().splitlines():
        line = raw.strip()
        if line.lower() == "@data":
            in_data = True
            continue
        if in_data and line and not line.startswith("%"):
            values = next(csv.reader([line], quotechar="'", skipinitialspace=True))
            converted = []
            for i, value in enumerate(values[:25]):
                if value == "?":
                    converted.append(None)
                elif i == 6:
                    converted.append(normalized(str((date.fromisoformat(value) - date(1899, 12, 30)).days)))
                else:
                    converted.append(normalized(value))
            source_data.append(tuple(converted))
    assert len(source_data) == 2240

    def column(c):
        value = ""
        while c:
            c, digit = divmod(c - 1, 26)
            value = chr(65 + digit) + value
        return value

    workbook_data = [tuple(normalized(marketing.get(f"{column(c)}{r}")) for c in range(1, 26)) for r in range(2, 2242)]
    if Counter(source_data) != Counter(workbook_data):
        missing = Counter(source_data) - Counter(workbook_data)
        added = Counter(workbook_data) - Counter(source_data)
        example = next(iter(missing))
        matches = [row for row in workbook_data if row[:4] == example[:4]]
        raise AssertionError(f"Feature rows differ: missing {sum(missing.values())} added {sum(added.values())}; source sample {example}; nearest {matches[:2]}")
    assert workbook_data[:10] != source_data[:10], "Rows were not shuffled"
    notes = sheet_cells(updated, 7)
    assert any(v == "Marketing campaign" for v in notes.values())
    print("verified sheets:", sheet_names)
    print("marketing rows: 2240; features: 25; target labels:", dict(labels))
    print("features match source, order changed, prior dataset cells unchanged")
