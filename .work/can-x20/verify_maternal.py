import csv
import sys
import zipfile
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree as ET


OLD, NEW, ARFF = map(Path, sys.argv[1:4])
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def normalize(value):
    if value is None:
        return None
    try:
        return str(Decimal(value).quantize(Decimal("0.00000001")).normalize())
    except (InvalidOperation, ValueError):
        return value


def cells(archive, index):
    root = ET.fromstring(archive.read(f"xl/worksheets/sheet{index}.xml"))
    values = {}
    for item in root.findall(".//m:sheetData/m:row/m:c", NS):
        key = item.attrib["r"]
        if item.attrib.get("t") == "inlineStr":
            value = "".join(t.text or "" for t in item.findall(".//m:t", NS))
        else:
            element = item.find("m:v", NS)
            if element is None:
                continue
            value = element.text
        values[key] = normalize(value)
    return root, values


with zipfile.ZipFile(OLD) as old, zipfile.ZipFile(NEW) as new:
    assert new.testzip() is None
    for i in range(1, 6):
        assert cells(old, i)[1] == cells(new, i)[1], f"Prior sheet {i} changed"
    workbook = ET.fromstring(new.read("xl/workbook.xml"))
    names = [x.attrib["name"] for x in workbook.findall("m:sheets/m:sheet", NS)]
    assert names == ["Customer churn", "Fantasy football", "Sales forecast", "Employee attrition", "House prices", "Maternal health risk", "Sources & notes"]

    root, values = cells(new, 6)
    headers = [values.get(f"{chr(65+i)}1") for i in range(7)]
    assert headers == ["Age", "SystolicBP", "DiastolicBP", "BS", "BodyTemp", "HeartRate", "RiskLevel"]
    labels = Counter(values.get(f"G{r}") for r in range(2, 1016))
    assert labels[None] == 51 and set(labels) == {None, "low risk", "mid risk", "high risk"}

    source_features = []
    source_labels = Counter()
    in_data = False
    for raw in ARFF.read_text().splitlines():
        line = raw.strip()
        if line.lower() == "@data":
            in_data = True
            continue
        if in_data and line and not line.startswith("%"):
            fields = next(csv.reader([line], quotechar="'", skipinitialspace=True))
            source_features.append(tuple(normalize(v) for v in fields[:6]))
            source_labels[fields[6]] += 1
    saved_features = [tuple(values.get(f"{chr(65+i)}{r}") for i in range(6)) for r in range(2, 1016)]
    assert len(source_features) == len(saved_features) == 1014
    assert Counter(source_features) == Counter(saved_features), "Features differ from OpenML source"
    assert saved_features[:10] != source_features[:10], "Rows not shuffled"
    assert sum(labels[k] for k in source_labels) == 963
    assert all(labels[k] <= source_labels[k] for k in source_labels)

    header_cells = root.findall("m:sheetData/m:row", NS)[0].findall("m:c", NS)
    body_cells = root.findall("m:sheetData/m:row", NS)[1:]
    assert all(c.attrib.get("s") == "5" for c in header_cells)
    assert all(c.attrib.get("s") is None for row in body_cells for c in row.findall("m:c", NS))
    styles = ET.fromstring(new.read("xl/styles.xml"))
    style = styles.find("m:cellXfs", NS)[5]
    assert style.attrib.get("fillId") == "0" and style.attrib.get("borderId") == "0"
    font = styles.find("m:fonts", NS)[int(style.attrib["fontId"])]
    assert font.find("m:b", NS) is not None
    assert font.find("m:color", NS) is None
    print("Verified 1,014 shuffled source rows, 51 missing targets, six unchanged features, plain cells and bold headers.")
    print("Existing five dataset sheets unchanged.")
