"""Read-only inspection of the Quiz4Win API/Admin sheet."""
import warnings
warnings.filterwarnings("ignore")
import gspread
from google.oauth2.service_account import Credentials

SHEET_ID = "15gjlI2Wgh7G21dZG-WKw9Nu8r5imHpmxYHvnRHL2-_Q"
CREDS = "sanguine-form-439412-c2-ee1d2d1e48b8.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

creds = Credentials.from_service_account_file(CREDS, scopes=SCOPES)
gc = gspread.authorize(creds)
sh = gc.open_by_key(SHEET_ID)


def dump(title, max_cols=None):
    print(f"\n===== {title} =====")
    ws = sh.worksheet(title)
    rows = ws.get_all_values()
    for i, r in enumerate(rows):
        if not any(c.strip() for c in r):
            continue
        if max_cols:
            r = r[:max_cols]
        # truncate cells
        r = [c[:50] for c in r]
        print(f"  row{i+1}: {r}")


dump("Quiz4Win - APIs", max_cols=17)
print("\n\n")
dump("Admin Functionality")
