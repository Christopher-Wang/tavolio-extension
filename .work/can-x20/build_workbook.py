import csv
import random
import re
import sys
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = Path(sys.argv[1])
RNG = random.Random(20261001)


def read(name):
    with (DATA / f"{name}.csv").open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def numeric(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


def selected(source, columns, numeric_columns):
    return [{c: numeric(row.get(c)) if c in numeric_columns else row.get(c) for c in columns} for row in read(source)]


def mess(rows, target, *, missing_rate=.035, category_rate=.025, text_number_rate=.012):
    counts = Counter()
    if not rows:
        return rows, counts
    keys = [key for key in rows[0] if key not in target and key.lower() not in {"id", "customerid", "employeenumber", "element", "month", "gameweek"}]
    for row in rows:
        for key in keys:
            val = row[key]
            if val is None or val == "":
                continue
            p = RNG.random()
            if p < missing_rate:
                row[key] = None
                counts["added blanks"] += 1
            elif isinstance(val, str) and p < missing_rate + category_rate:
                row[key] = val.lower() if RNG.random() < .5 else f" {val} "
                counts["category variants"] += 1
            elif isinstance(val, (float, int)) and p < missing_rate + category_rate + text_number_rate:
                row[key] = str(val)
                counts["numbers stored as text"] += 1
    return rows, counts


churn_cols = ["customerID", "gender", "SeniorCitizen", "Partner", "Dependents", "tenure", "InternetService", "OnlineSecurity", "Contract", "PaymentMethod", "MonthlyCharges", "TotalCharges", "Churn"]
churn = selected("churn", churn_cols, {"SeniorCitizen", "tenure", "MonthlyCharges", "TotalCharges"})
churn, churn_counts = mess(churn, {"Churn"})

hr_cols = ["EmployeeNumber", "Age", "BusinessTravel", "Department", "DistanceFromHome", "EducationField", "EnvironmentSatisfaction", "JobRole", "JobSatisfaction", "MaritalStatus", "MonthlyIncome", "OverTime", "StockOptionLevel", "TotalWorkingYears", "WorkLifeBalance", "YearsAtCompany", "Attrition"]
hr_nums = {"EmployeeNumber", "Age", "DistanceFromHome", "EnvironmentSatisfaction", "JobSatisfaction", "MonthlyIncome", "StockOptionLevel", "TotalWorkingYears", "WorkLifeBalance", "YearsAtCompany"}
hr = selected("hr", hr_cols, hr_nums)
hr, hr_counts = mess(hr, {"Attrition"})

house_cols = ["Id", "MSSubClass", "LotArea", "OverallQual", "OverallCond", "YearRemodAdd", "RoofStyle", "TotalBsmtSF", "FirstFlrSF", "SecondFlrSF", "GrLivArea", "GarageArea", "MoSold", "SaleCondition", "SalePrice"]
house_nums = set(house_cols) - {"RoofStyle", "SaleCondition"}
house = selected("house", house_cols, house_nums)
house, house_counts = mess(house, {"SalePrice"})

gw1 = read("gw1")
gw2 = {row["element"]: row for row in read("gw2")}
football = []
for row in gw1:
    nxt = gw2.get(row["element"])
    if not nxt:
        continue
    football.append({
        "element": numeric(row["element"]), "name": row["name"], "position": row["position"],
        "team": row["team"], "gameweek": 1, "minutes": numeric(row["minutes"]),
        "goals_scored": numeric(row["goals_scored"]), "assists": numeric(row["assists"]),
        "expected_goals": numeric(row["expected_goals"]), "expected_assists": numeric(row["expected_assists"]),
        "was_home": row["was_home"], "opponent_team": numeric(row["opponent_team"]),
        "value_tenths_million": numeric(row["value"]), "current_game_points": numeric(row["total_points"]),
        "next_game_points": numeric(nxt["total_points"]),
    })
football, football_counts = mess(football, {"next_game_points"})

sale_source = read("sales")
sales = []
for i, row in enumerate(sale_source[:-1]):
    year_part, month_part = map(int, row["Month"].split("-"))
    sales.append({"Month": date(1900 + year_part, month_part, 1),
                  "Sales": numeric(row["Sales"]),
                  "PriorMonthSales": numeric(sale_source[i - 1]["Sales"]) if i else None,
                  "NextMonthSales": numeric(sale_source[i + 1]["Sales"])})
sales, sales_counts = mess(sales, {"NextMonthSales"}, missing_rate=.04, category_rate=0, text_number_rate=.015)

sources = [
    ["Sheet", "Target", "Rows", "Source", "Preparation and intentional issues"],
    ["Customer churn", "Churn", len(churn), "https://raw.githubusercontent.com/IBM/telco-customer-churn-on-icp4d/master/data/Telco-Customer-Churn.csv", "First 129 source records; selected predictors; blanks, category variants and numbers as text added. Target unchanged."],
    ["Fantasy football", "next_game_points", len(football), "https://github.com/vaastav/Fantasy-Premier-League/tree/master/data/2023-24/gws", "2023–24 FPL gameweeks 1 and 2 joined by element ID; gameweek 1 features predict actual gameweek 2 points. Selected source records; feature issues added. Target unchanged."],
    ["Sales forecast", "NextMonthSales", len(sales), "https://gist.github.com/csakaszamok/0a59d388d2af2cbf6cf7d5202b794dc4", "Shampoo sales, 36 consecutive months. NextMonthSales is shifted from the following month; first 35 months retained. Feature blanks and text numbers added. Units unspecified in source."],
    ["Employee attrition", "Attrition", len(hr), "https://gist.github.com/mmphego/67a4f2acb93f6d571eb18c430d5654e9", "First 120 source records; selected predictors; blanks, category variants and numbers as text added. IBM sample data; target unchanged."],
    ["House prices", "SalePrice", len(house), "https://gist.github.com/sri7harsha/774156dc48e3630065a781ad2d615446", "First 130 source records from Ames house price subset; blanks, category variants and numbers as text added. SalePrice unchanged; USD."],
    ["Method", "", "", "", "Deterministic random seed 20261001. Missingness and formatting changes affect predictors only. Rows in forecasting sheets have observed next-period targets; do not use future information as a feature."],
]

sheets = [
    ("Customer churn", churn_cols, churn, "Churn", churn_counts),
    ("Fantasy football", list(football[0]), football, "next_game_points", football_counts),
    ("Sales forecast", list(sales[0]), sales, "NextMonthSales", sales_counts),
    ("Employee attrition", hr_cols, hr, "Attrition", hr_counts),
    ("House prices", house_cols, house, "SalePrice", house_counts),
    ("Sources & notes", sources[0], [dict(zip(sources[0], r)) for r in sources[1:]], "", Counter()),
]

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def colname(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def cell(ref, val, style=0):
    if val is None or val == "":
        return ""
    attr = f' r="{ref}" s="{style}"'
    if isinstance(val, date):
        serial = (val - date(1899, 12, 30)).days
        return f'<c{attr}><v>{serial}</v></c>'
    if isinstance(val, (int, float)):
        return f'<c{attr}><v>{val}</v></c>'
    return f'<c{attr} t="inlineStr"><is><t xml:space="preserve">{escape(str(val))}</t></is></c>'


def worksheet(headers, rows, target):
    width = len(headers)
    xml = [f'<worksheet xmlns="{NS}">', '<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>']
    xml.append('<sheetFormatPr defaultRowHeight="17"/>')
    xml.append('<cols>')
    for i, h in enumerate(headers, 1):
        w = min(42, max(13, len(h) + 3))
        if h in {"Source", "Preparation and intentional issues"}:
            w = 80
        xml.append(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>')
    xml.append('</cols><sheetData>')
    xml.append('<row r="1" ht="25" customHeight="1">')
    for i, h in enumerate(headers, 1):
        xml.append(cell(f'{colname(i)}1', h, 2 if h == target else 1))
    xml.append('</row>')
    for ri, row in enumerate(rows, 2):
        xml.append(f'<row r="{ri}">')
        for ci, h in enumerate(headers, 1):
            val = row.get(h)
            style = 3 if isinstance(val, date) else (4 if h == target else 0)
            xml.append(cell(f'{colname(ci)}{ri}', val, style))
        xml.append('</row>')
    xml.append('</sheetData>')
    xml.append(f'<autoFilter ref="A1:{colname(width)}{len(rows)+1}"/>')
    xml.append('</worksheet>')
    return ''.join(xml)


styles = f'''<styleSheet xmlns="{NS}"><fonts count="3"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF14532D"/><sz val="10"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243B53"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''

workbook_xml = f'<workbook xmlns="{NS}" xmlns:r="{REL}"><sheets>' + ''.join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, *_rest) in enumerate(sheets, 1)) + '</sheets></workbook>'
relationships = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="{REL}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets)+1)) + f'<Relationship Id="rId{len(sheets)+1}" Type="{REL}/styles" Target="styles.xml"/></Relationships>'
types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets)+1)) + '</Types>'
root_rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'

OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', types)
    z.writestr('_rels/.rels', root_rels)
    z.writestr('xl/workbook.xml', workbook_xml)
    z.writestr('xl/_rels/workbook.xml.rels', relationships)
    z.writestr('xl/styles.xml', styles)
    for i, (_name, headers, rows, target, _counts) in enumerate(sheets, 1):
        z.writestr(f'xl/worksheets/sheet{i}.xml', worksheet(headers, rows, target))

for name, _headers, rows, _target, counts in sheets:
    print(f'{name}: {len(rows)} rows; {dict(counts)}')
print(OUT)
