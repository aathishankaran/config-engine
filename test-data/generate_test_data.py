#!/usr/bin/env python3
"""
generate_test_data.py
=====================
Generates all fixed-width COBOL-style test-data files for the
dataflow-engine pipeline tests.

Run:
    python3 generate_test_data.py

Files created (in the same directory as this script):
  TXNREC.CPY   – 84-byte transaction record copybook
  TXNCTRL.CPY  – 50-byte control file copybook
  TXNOUT.CPY   – 103-byte enriched output record copybook
  TXNSRC.DAT   – 5 source transaction records (84 bytes each)
  TXNSRC.CTL   – 1 source control record    (50 bytes)
  TXNPREV.DAT  – 6 previous-day records     (84 bytes each)
  TXNPREV.CTL  – 1 previous-day control     (50 bytes)
  TXNOUT.DAT   – 5 enriched output records  (103 bytes each)
  TXNOUT.CTL   – 1 output control record    (50 bytes)
"""

import os

BASE = os.path.dirname(os.path.abspath(__file__))


# ── LOW-LEVEL HELPERS ──────────────────────────────────────────────────────────

def alpha(value, width):
    """Left-justify, space-pad to 'width'. Truncate if longer."""
    return str(value).ljust(width)[:width]


def numeric(value, width):
    """Right-justify, zero-pad to 'width'. Truncate if longer."""
    return str(value).rjust(width, '0')[:width]


# ── RECORD BUILDERS ────────────────────────────────────────────────────────────

def txn_rec(txn_id, date, typ, acct, amt_raw, ccy, desc, status, branch):
    """
    Build an 84-byte fixed-width transaction record.

    TXN-AMOUNT (PIC 9(10)V99) stores the value without a physical decimal point.
    Pass the integer representation, e.g. $5000.00 → 500000, $750.50 → 75050.
    """
    row = (
        alpha(txn_id, 10)       # POS  1-10  X(10)
        + numeric(date, 8)      # POS 11-18  9(8)   YYYYMMDD
        + alpha(typ, 3)         # POS 19-21  X(3)   DEP/WDR/TRF/FEE
        + alpha(acct, 12)       # POS 22-33  X(12)
        + numeric(amt_raw, 12)  # POS 34-45  9(10)V99  (12 digits, V implied)
        + alpha(ccy, 3)         # POS 46-48  X(3)
        + alpha(desc, 30)       # POS 49-78  X(30)
        + alpha(status, 1)      # POS 79     X(1)   A=active
        + alpha(branch, 5)      # POS 80-84  X(5)
    )
    assert len(row) == 84, f"TXN record length {len(row)} != 84\n{row!r}"
    return row


def ctrl_rec(proc_date, file_id, count, total_cents, hash_tot):
    """
    Build a 50-byte fixed-width control record.

    CTRL-TOTAL-AMT (PIC 9(14)) stores amount in integer cents.
    e.g. $18,275.50 → 1827550 → '00000001827550' (14 chars)
    """
    row = (
        numeric(proc_date, 8)    # POS  1-8   9(8)   YYYYMMDD
        + alpha(file_id, 10)     # POS  9-18  X(10)
        + numeric(count, 6)      # POS 19-24  9(6)   record count
        + numeric(total_cents, 14)  # POS 25-38  9(14)  total in cents
        + numeric(hash_tot, 10)  # POS 39-48  9(10)  hash total
        + '  '                   # POS 49-50  X(2)   filler
    )
    assert len(row) == 50, f"CTRL record length {len(row)} != 50\n{row!r}"
    return row


def out_rec(src_84, valid_flag, proc_ts, proc_code):
    """
    Build a 103-byte fixed-width enriched output record.
    = source record (84) + OUT-VALID-FLAG (1) + OUT-PROC-TS (14) + OUT-PROC-CODE (4)
    """
    row = (
        src_84                   # POS   1-84   TXNREC copy
        + alpha(valid_flag, 1)   # POS  85      X(1)   Y=valid N=invalid
        + numeric(proc_ts, 14)   # POS  86-99   9(14)  YYYYMMDDHHMMSS
        + alpha(proc_code, 4)    # POS 100-103  X(4)   processing code
    )
    assert len(row) == 103, f"OUT record length {len(row)} != 103\n{row!r}"
    return row


# ── FILE WRITERS ───────────────────────────────────────────────────────────────

def write_fixed(filename, records):
    path = os.path.join(BASE, filename)
    with open(path, 'w', newline='\n') as f:
        for rec in records:
            f.write(rec + '\n')
    size = os.path.getsize(path)
    print(f"  ✓  {filename:20s}  {len(records):3d} record(s)   {size:6d} bytes")


def write_text(filename, content):
    path = os.path.join(BASE, filename)
    with open(path, 'w') as f:
        f.write(content)
    size = os.path.getsize(path)
    print(f"  ✓  {filename:20s}  (copybook)   {size:6d} bytes")


# ── COPYBOOKS ──────────────────────────────────────────────────────────────────

write_text("TXNREC.CPY", """\
      *----------------------------------------------------------------*
      * TXNREC.CPY  -  Transaction Record Layout                      *
      * Record length : 84 bytes                                      *
      *----------------------------------------------------------------*
       01 TXN-RECORD.
          05 TXN-ID             PIC X(10).    *> POS  1-10
          05 TXN-DATE           PIC 9(8).     *> POS 11-18  YYYYMMDD
          05 TXN-TYPE           PIC X(3).     *> POS 19-21  DEP/WDR/TRF/FEE
          05 TXN-ACCT-NBR       PIC X(12).    *> POS 22-33
          05 TXN-AMOUNT         PIC 9(10)V99. *> POS 34-45  implied decimal
          05 TXN-CURRENCY       PIC X(3).     *> POS 46-48
          05 TXN-DESC           PIC X(30).    *> POS 49-78
          05 TXN-STATUS         PIC X(1).     *> POS 79     A=active
          05 TXN-BRANCH-CODE    PIC X(5).     *> POS 80-84
""")

write_text("TXNCTRL.CPY", """\
      *----------------------------------------------------------------*
      * TXNCTRL.CPY  -  Control File Record Layout                    *
      * Record length : 50 bytes                                      *
      *----------------------------------------------------------------*
       01 CTRL-RECORD.
          05 CTRL-PROC-DATE     PIC 9(8).     *> POS  1-8   YYYYMMDD
          05 CTRL-FILE-ID       PIC X(10).    *> POS  9-18
          05 CTRL-REC-COUNT     PIC 9(6).     *> POS 19-24  total records
          05 CTRL-TOTAL-AMT     PIC 9(14).    *> POS 25-38  sum in cents
          05 CTRL-HASH-TOTAL    PIC 9(10).    *> POS 39-48  hash total
          05 CTRL-FILLER        PIC X(2).     *> POS 49-50
""")

write_text("TXNOUT.CPY", """\
      *----------------------------------------------------------------*
      * TXNOUT.CPY  -  Output (Enriched) Record Layout                *
      * Record length : 103 bytes  (= TXNREC 84 + enrichment 19)     *
      *----------------------------------------------------------------*
       01 TXN-OUT-RECORD.
          05 TXN-ID             PIC X(10).    *> POS   1-10
          05 TXN-DATE           PIC 9(8).     *> POS  11-18  YYYYMMDD
          05 TXN-TYPE           PIC X(3).     *> POS  19-21
          05 TXN-ACCT-NBR       PIC X(12).    *> POS  22-33
          05 TXN-AMOUNT         PIC 9(10)V99. *> POS  34-45  implied decimal
          05 TXN-CURRENCY       PIC X(3).     *> POS  46-48
          05 TXN-DESC           PIC X(30).    *> POS  49-78
          05 TXN-STATUS         PIC X(1).     *> POS  79
          05 TXN-BRANCH-CODE    PIC X(5).     *> POS  80-84
          05 OUT-VALID-FLAG     PIC X(1).     *> POS  85     Y=valid N=invalid
          05 OUT-PROC-TS        PIC 9(14).    *> POS  86-99  YYYYMMDDHHMMSS
          05 OUT-PROC-CODE      PIC X(4).     *> POS 100-103
""")

# ── SOURCE RECORDS (TXNSRC.DAT) ───────────────────────────────────────────────
#
#  TXN-AMOUNT values (PIC 9(10)V99 → 12 digits, no decimal point):
#    $5,000.00   →  500000  → "000000500000"
#    $  750.50   →   75050  → "000000075050"
#    $2,500.00   →  250000  → "000000250000"
#    $10,000.00  → 1000000  → "000001000000"
#    $   25.00   →    2500  → "000000002500"
#
src_recs = [
    txn_rec("TXN0000001", "20260227", "DEP", "100200300001",  500000, "USD", "PAYROLL DEPOSIT",        "A", "10001"),
    txn_rec("TXN0000002", "20260227", "WDR", "100200300002",   75050, "USD", "ATM WITHDRAWAL NYC",     "A", "10002"),
    txn_rec("TXN0000003", "20260227", "TRF", "100200300001",  250000, "USD", "ONLINE TRANSFER OUT",    "A", "10001"),
    txn_rec("TXN0000004", "20260227", "DEP", "100200300003", 1000000, "USD", "WIRE TRANSFER RECEIVED", "A", "10003"),
    txn_rec("TXN0000005", "20260227", "FEE", "100200300002",    2500, "USD", "MONTHLY SERVICE FEE",    "A", "10002"),
]

write_fixed("TXNSRC.DAT", src_recs)

src_total = 500000 + 75050 + 250000 + 1000000 + 2500  # = 1,827,550 cents
src_hash  = 1 + 2 + 3 + 4 + 5                          # = 15

write_fixed("TXNSRC.CTL", [
    ctrl_rec("20260227", "TXNSRCFILE", 5, src_total, src_hash)
])

# ── PREVIOUS DAY RECORDS (TXNPREV.DAT) ───────────────────────────────────────
#
#  $7,500.00   → 750000
#  $1,250.00   → 125000
#  $3,000.00   → 300000
#  $5,000.00   → 500000
#  $  450.00   →  45000
#  $   25.00   →   2500
#
prev_recs = [
    txn_rec("TXN00P0001", "20260226", "DEP", "100200300001", 750000, "USD", "PAYROLL ADVANCE",            "A", "10001"),
    txn_rec("TXN00P0002", "20260226", "WDR", "100200300004", 125000, "USD", "POS PURCHASE GROCERY STORE", "A", "10004"),
    txn_rec("TXN00P0003", "20260226", "DEP", "100200300005", 300000, "USD", "CHECK DEPOSIT",              "A", "10005"),
    txn_rec("TXN00P0004", "20260226", "TRF", "100200300002", 500000, "USD", "ONLINE TRANSFER IN",         "A", "10002"),
    txn_rec("TXN00P0005", "20260226", "WDR", "100200300003",  45000, "USD", "CASH WITHDRAWAL",            "A", "10003"),
    txn_rec("TXN00P0006", "20260226", "FEE", "100200300004",   2500, "USD", "MONTHLY SERVICE FEE",        "A", "10004"),
]

write_fixed("TXNPREV.DAT", prev_recs)

prev_total = 750000 + 125000 + 300000 + 500000 + 45000 + 2500  # = 1,722,500 cents
prev_hash  = 1 + 2 + 3 + 4 + 5 + 6                              # = 21

write_fixed("TXNPREV.CTL", [
    ctrl_rec("20260226", "TXNPREVFIL", 6, prev_total, prev_hash)
])

# ── OUTPUT RECORDS (TXNOUT.DAT) ───────────────────────────────────────────────
#  All 5 source records pass validation (Y), processed sequentially.
#  OUT-PROC-TS: YYYYMMDDHHMMSS  →  20260227083015 … 083019
#  OUT-PROC-CODE: "PASS"

proc_timestamps = [
    "20260227083015",
    "20260227083016",
    "20260227083017",
    "20260227083018",
    "20260227083019",
]

out_recs = [
    out_rec(src_recs[i], "Y", proc_timestamps[i], "PASS")
    for i in range(len(src_recs))
]

write_fixed("TXNOUT.DAT", out_recs)

out_total = src_total   # same 5 records, all valid
out_hash  = src_hash

write_fixed("TXNOUT.CTL", [
    ctrl_rec("20260227", "TXNOUTFILE", 5, out_total, out_hash)
])

# ── SUMMARY ────────────────────────────────────────────────────────────────────
print()
print("=== Verification ===")
print(f"  Source  total (cents) : {src_total:>14}  →  ${src_total/100:>12,.2f}")
print(f"  PrevDay total (cents) : {prev_total:>14}  →  ${prev_total/100:>12,.2f}")
print(f"  Output  total (cents) : {out_total:>14}  →  ${out_total/100:>12,.2f}")
print()

# Quick length verification
for rec in src_recs:
    assert len(rec) == 84
for rec in prev_recs:
    assert len(rec) == 84
for rec in out_recs:
    assert len(rec) == 103

print("All record lengths verified ✓")
print(f"\nTest data directory: {BASE}")
