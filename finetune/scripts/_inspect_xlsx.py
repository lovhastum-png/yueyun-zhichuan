import openpyxl, glob, os
base = r"d:\实验室项目\越韵智传完整demo\越韵智传-Alpaca微调数据集\原始语料\越剧大典数据"
for f in sorted(glob.glob(os.path.join(base, "*.xlsx"))):
    print("===", os.path.basename(f))
    wb = openpyxl.load_workbook(f, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    for r in rows[:4]:
        print(list(r))
    print("total rows:", len(rows))
    wb.close()
    print()