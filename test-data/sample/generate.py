#!/usr/bin/env python3
"""
generate.py — Comprehensive sample data for cloude-engine local testing
=======================================================================

Produces:
  copybooks/BANK-BATCH-INPUT.CPY   — Input file layout  (120 bytes: HDR + DATA + TRL)
  copybooks/BANK-BATCH-OUTPUT.CPY  — Output file layout (140 bytes: HDR + DATA + TRL)
  copybooks/BANK-BATCH-CTRL.CPY    — Control file layout (80 bytes, parameterised prefix)
  INPUT/BANK-BATCH-INPUT.DAT       — Today (2026-03-05): 1 HDR + 5 DATA + 1 TRL
  INPUT/BANK-BATCH-INPUT-PREV.DAT  — Yesterday (2026-03-04): 1 HDR + 5 DATA + 1 TRL
  OUTPUT/BANK-BATCH-OUTPUT.DAT     — Validated output (140 bytes/rec): 1 HDR + 5 DATA + 1 TRL
  CONTROL/BANK-BATCH-CTRL.DAT      — PySpark-generated control record (80 bytes)

Field format overview (INPUT DATA record, 120 bytes):
  POS   1      REC-TYPE    X(1)        'D'
  POS   2-11   TXN-ID      X(10)       TEXT
  POS  12-19   TXN-DATE    9(8)        DATE   YYYYMMDD
  POS  20-27   VAL-DATE    9(8)        DATE   YYYYMMDD (value/settlement date)
  POS  28-30   TXN-TYPE    X(3)        TEXT   DEP/WDR/TRF/FEE
  POS  31-42   ACCT-NUM    X(12)       TEXT
  POS  43-54   TXN-AMOUNT  9(10)V99    DECIMAL $max 9999999999.99 (12 chars, V implied)
  POS  55-57   CURRENCY    X(3)        TEXT   USD/EUR/CAD
  POS  58-67   EXCH-RATE   9(4)V9(6)  DECIMAL 9999.999999 (10 chars, V implied)
  POS  68      TXN-STATUS  X(1)        TEXT   A=Active P=Pending R=Rejected E=Error
  POS  69-73   BRANCH-CD   X(5)        TEXT
  POS  74-103  TXN-DESC    X(30)       TEXT
  POS 104-118  TXN-MEMO    X(15)       TEXT
  POS 119-120  FILLER      X(2)
"""

import os

BASE    = os.path.dirname(os.path.abspath(__file__))
CPY_DIR = os.path.join(BASE, "copybooks")
INP_DIR = os.path.join(BASE, "INPUT")
OUT_DIR = os.path.join(BASE, "OUTPUT")
CTL_DIR = os.path.join(BASE, "CONTROL")

for d in [CPY_DIR, INP_DIR, OUT_DIR, CTL_DIR]:
    os.makedirs(d, exist_ok=True)


# ── helpers ────────────────────────────────────────────────────────────────────

def A(v, w):
    """Text field: left-justify, space-pad, truncate to w."""
    return str(v).ljust(w)[:w]

def N(v, w):
    """Numeric field: right-justify, zero-pad, truncate to w."""
    return str(int(v)).rjust(w, '0')[:w]

def chk(r, n, tag):
    assert len(r) == n, f"{tag}: got {len(r)}, expected {n}\n{r!r}"
    return r


# ── INPUT record builders (all records 120 bytes) ──────────────────────────────

def i_hdr(file_date, seq, src_id, file_name):
    # H(1) FILE-DATE(8) SEQ(6) SRC-ID(10) FILE-NAME(20) FILLER(75) = 120
    return chk(
        'H' + N(file_date, 8) + N(seq, 6) + A(src_id, 10) + A(file_name, 20) + ' ' * 75,
        120, 'I-HDR')

def i_dat(tid, tdt, vdt, typ, acct, cents, ccy, xrate, st, br, desc, memo):
    # D(1) TXN-ID(10) TXN-DATE(8) VAL-DATE(8) TXN-TYPE(3) ACCT-NUM(12)
    # AMOUNT(12) CURRENCY(3) EXCH-RATE(10) STATUS(1) BRANCH(5)
    # DESC(30) MEMO(15) FILLER(2) = 120
    return chk(
        'D'
        + A(tid,  10)           # TEXT
        + N(tdt,   8)           # DATE  YYYYMMDD
        + N(vdt,   8)           # DATE  YYYYMMDD
        + A(typ,   3)           # TEXT  DEP/WDR/TRF/FEE
        + A(acct, 12)           # TEXT
        + N(cents, 12)          # DECIMAL PIC 9(10)V99 → 12 raw digits
        + A(ccy,   3)           # TEXT  USD/EUR/CAD
        + A(xrate, 10)          # DECIMAL PIC 9(4)V9(6) → 10 raw digits (passed as str)
        + A(st,    1)           # TEXT  A/P/R/E
        + A(br,    5)           # TEXT
        + A(desc, 30)           # TEXT
        + A(memo, 15)           # TEXT
        + '  ',                 # FILLER
        120, 'I-DAT')

def i_trl(cnt, total, hsh, err):
    # T(1) REC-COUNT(8) TOTAL-AMT(16) HASH-TOTAL(10) ERR-COUNT(8) FILLER(77) = 120
    return chk(
        'T' + N(cnt, 8) + N(total, 16) + N(hsh, 10) + N(err, 8) + ' ' * 77,
        120, 'I-TRL')


# ── OUTPUT record builders (all records 140 bytes) ─────────────────────────────

def o_hdr(file_date, seq, src_id, file_name):
    # same header prefix + 20 extra FILLER = 140
    return chk(i_hdr(file_date, seq, src_id, file_name) + ' ' * 20, 140, 'O-HDR')

def o_dat(inp120, val_flag, proc_ts, err_code):
    # original 120 + VAL-FLAG(1) + PROC-TS(14) + ERR-CODE(4) + FILLER(1) = 140
    return chk(
        inp120 + A(val_flag, 1) + N(proc_ts, 14) + A(err_code, 4) + ' ',
        140, 'O-DAT')

def o_trl(cnt, total, hsh, err, valid_cnt, invalid_cnt):
    # T(1) REC-COUNT(8) TOTAL-AMT(16) HASH-TOTAL(10) ERR-COUNT(8)
    # VALID-COUNT(8) INVALID-COUNT(8) FILLER(81) = 140
    return chk(
        'T'
        + N(cnt,         8)
        + N(total,      16)
        + N(hsh,        10)
        + N(err,         8)
        + N(valid_cnt,   8)
        + N(invalid_cnt, 8)
        + ' ' * 81,
        140, 'O-TRL')


# ── CONTROL record builder (80 bytes) ──────────────────────────────────────────

def ctrl_rec(count, eff_date, as_of_date, src_code, src_id):
    # COUNT-RECORDS(13) EFFECTIVE-RECORD(8) AS-OF-DATE(8)
    # SOURCE-CODE(8) SOURCE-ID(40) FILLER(3) = 80
    return chk(
        N(count, 13)
        + A(eff_date,    8)
        + A(as_of_date,  8)
        + A(src_code,    8).rjust(8)   # JUSTIFIED RIGHT
        + A(src_id,     40)
        + '   ',
        80, 'CTRL')


# ── file writers ───────────────────────────────────────────────────────────────

def write_dat(path, records):
    with open(path, 'w', newline='\n') as f:
        for r in records:
            f.write(r + '\n')
    n  = len(records)
    sz = os.path.getsize(path)
    print(f"  ✓  {os.path.relpath(path, BASE):<46}  {n:>2} rec  {sz:>7} bytes")

def write_txt(path, content):
    with open(path, 'w') as f:
        f.write(content)
    sz = os.path.getsize(path)
    print(f"  ✓  {os.path.relpath(path, BASE):<46}         {sz:>7} bytes")


# ══════════════════════════════════════════════════════════════════════════════
# DATA DEFINITIONS
# ══════════════════════════════════════════════════════════════════════════════

TODAY = 20260305
PREV  = 20260304

# Tuple layout:
#   (tid, tdt, vdt, typ, acct, cents, ccy, xrate, st, br, desc, memo)
#
# TXN-AMOUNT: PIC 9(10)V99 → store as integer cents (no decimal point)
#   $5 000.00 →  500 000  → N(500000, 12) = "000000500000"
#   $  250.50 →   25 050  → N(25050,  12) = "000000025050"
#
# EXCH-RATE: PIC 9(4)V9(6) → store 10 raw digits (1.000000 → "0001000000")

today_rows = [
    # tid           tdt    vdt      typ    acct              cents    ccy    xrate        st    br       desc                             memo
    ("TXN2026001", TODAY, 20260307, "DEP", "100200300001",  500000,  "USD", "0001000000", "A", "10001", "PAYROLL DEPOSIT MARCH 2026",    "DIRECT DEP"),
    ("TXN2026002", TODAY, TODAY,    "WDR", "100200300002",   25050,  "USD", "0001000000", "A", "10001", "ATM WITHDRAWAL MAIN ST",        "ATM#4521"),
    ("TXN2026003", TODAY, 20260306, "TRF", "100200300003",  250000,  "USD", "0001000000", "A", "10002", "WIRE TRANSFER TO SAVINGS ACCT", "REF#W2026001"),
    ("TXN2026004", TODAY, TODAY,    "FEE", "100200300001",     500,  "USD", "0001000000", "A", "10001", "MONTHLY SERVICE CHARGE",        "SVC FEE MAR26"),
    ("TXN2026005", TODAY, 20260308, "DEP", "100200300004",  108500,  "EUR", "0001085000", "P", "10003", "INTL WIRE RECEIPT EUR PAYMENT", "SWIFT REF#0305"),
]

prev_rows = [
    ("TXN2026P01",  PREV, 20260306, "DEP", "200100400001",  750000,  "USD", "0001000000", "A", "20001", "DIRECT DEPOSIT SALARY",         "FEB 2026 SAL"),
    ("TXN2026P02",  PREV, PREV,     "WDR", "200100400002",   50000,  "USD", "0001000000", "A", "20001", "POS PURCHASE WALMART STORE",    "POS#W2026030"),
    ("TXN2026P03",  PREV, TODAY,    "TRF", "200100400001",  500000,  "USD", "0001000000", "A", "20002", "ACH DEBIT TO SAVINGS LINK",     "SAVINGS-LINK"),
    ("TXN2026P04",  PREV, PREV,     "FEE", "200100400003",    1500,  "USD", "0001000000", "A", "20001", "OVERDRAFT FEE Q1 2026",         "OD FEE CODE01"),
    ("TXN2026P05",  PREV, 20260307, "DEP", "200100400004",  200000,  "CAD", "0000750000", "A", "20003", "CROSS BORDER WIRE RECEIPT",     "WIRE-TF-20260"),
]

# Aggregates for trailer records
today_cents = sum(r[5] for r in today_rows)                    # 884050
today_hash  = sum(int(r[4][-4:]) for r in today_rows)          # 0001+0002+0003+0001+0004 = 11
today_err   = sum(1 for r in today_rows if r[8] != 'A')        # 1  (TXN2026005 status=P)

prev_cents  = sum(r[5] for r in prev_rows)                     # 1501500
prev_hash   = sum(int(r[4][-4:]) for r in prev_rows)           # 0001+0002+0001+0003+0004 = 11
prev_err    = 0

# Build raw DATA records (reuse in output)
today_dat = [i_dat(*r) for r in today_rows]
prev_dat   = [i_dat(*r) for r in prev_rows]


# ══════════════════════════════════════════════════════════════════════════════
# WRITE DATA FILES
# ══════════════════════════════════════════════════════════════════════════════

print("\n── Data Files ──────────────────────────────────────────────────────")

# ── INPUT/BANK-BATCH-INPUT.DAT  (today) ─────────────────────────────────────
write_dat(os.path.join(INP_DIR, "BANK-BATCH-INPUT.DAT"), [
    i_hdr(TODAY, 1, "BANKING01", "BANK-BATCH-INPUT.DAT"),
    *today_dat,
    i_trl(len(today_rows), today_cents, today_hash, today_err),
])

# ── INPUT/BANK-BATCH-INPUT-PREV.DAT  (previous day) ─────────────────────────
write_dat(os.path.join(INP_DIR, "BANK-BATCH-INPUT-PREV.DAT"), [
    i_hdr(PREV, 1, "BANKING01", "BANK-BATCH-INPUT.DAT"),
    *prev_dat,
    i_trl(len(prev_rows), prev_cents, prev_hash, prev_err),
])

# ── OUTPUT/BANK-BATCH-OUTPUT.DAT  (post-validation) ─────────────────────────
# Validation rule: TXN-STATUS must be 'A'; status='P' → VAL-FLAG='N' ERR-CODE='E001'
PROC_TS_BASE = 20260305103040   # 10:30:40 on processing day

out_data   = []
valid_n    = 0
invalid_n  = 0
for i, (inp, row) in enumerate(zip(today_dat, today_rows)):
    if row[8] == 'A':
        out_data.append(o_dat(inp, 'Y', PROC_TS_BASE + i + 1, '0000'))
        valid_n += 1
    else:
        out_data.append(o_dat(inp, 'N', PROC_TS_BASE + i + 1, 'E001'))
        invalid_n += 1

write_dat(os.path.join(OUT_DIR, "BANK-BATCH-OUTPUT.DAT"), [
    o_hdr(TODAY, 1, "BANKING01", "BANK-BATCH-OUTPUT.DAT"),
    *out_data,
    o_trl(len(today_rows), today_cents, today_hash, today_err, valid_n, invalid_n),
])

# ── CONTROL/BANK-BATCH-CTRL.DAT  (PySpark-generated) ────────────────────────
write_dat(os.path.join(CTL_DIR, "BANK-BATCH-CTRL.DAT"), [
    ctrl_rec(len(today_rows), str(TODAY), str(TODAY), "105", "BANK-BATCH-INPUT.DAT"),
])


# ══════════════════════════════════════════════════════════════════════════════
# COPYBOOKS
# ══════════════════════════════════════════════════════════════════════════════

print("\n── Copybooks ───────────────────────────────────────────────────────")

write_txt(os.path.join(CPY_DIR, "BANK-BATCH-INPUT.CPY"), """\
      *================================================================*
      * BANK-BATCH-INPUT.CPY                                          *
      * Input transaction batch file  —  120 bytes per record         *
      * REC-TYPE:  'H' = Header   'D' = Data   'T' = Trailer          *
      *================================================================*
      *
      *  ── HEADER RECORD  (first record in file) ───────────────────
       01  INP-HEADER-RECORD.
           05  INP-HDR-REC-TYPE     PIC X(1).    *> POS   1      'H'
           05  INP-HDR-FILE-DATE    PIC 9(8).    *> POS   2-9    DATE YYYYMMDD
           05  INP-HDR-SEQ-NUM      PIC 9(6).    *> POS  10-15   NUMBER file sequence
           05  INP-HDR-SRC-ID       PIC X(10).   *> POS  16-25   TEXT  source system
           05  INP-HDR-FILE-NAME    PIC X(20).   *> POS  26-45   TEXT  original file name
           05  INP-HDR-FILLER       PIC X(75).   *> POS  46-120
      *
      *  ── DATA RECORD  (all records between header and trailer) ───
       01  INP-DATA-RECORD.
           05  INP-DAT-REC-TYPE     PIC X(1).    *> POS   1      'D'
           05  INP-DAT-TXN-ID       PIC X(10).   *> POS   2-11   TEXT   transaction id
           05  INP-DAT-TXN-DATE     PIC 9(8).    *> POS  12-19   DATE   YYYYMMDD
           05  INP-DAT-VAL-DATE     PIC 9(8).    *> POS  20-27   DATE   YYYYMMDD value date
           05  INP-DAT-TXN-TYPE     PIC X(3).    *> POS  28-30   TEXT   DEP/WDR/TRF/FEE
           05  INP-DAT-ACCT-NUM     PIC X(12).   *> POS  31-42   TEXT
           05  INP-DAT-AMOUNT       PIC 9(10)V99. *> POS  43-54  DECIMAL $max 9999999999.99
           05  INP-DAT-CURRENCY     PIC X(3).    *> POS  55-57   TEXT   USD/EUR/CAD
           05  INP-DAT-EXCH-RATE    PIC 9(4)V9(6). *> POS 58-67 DECIMAL max 9999.999999
           05  INP-DAT-STATUS       PIC X(1).    *> POS  68      TEXT   A/P/R/E
           05  INP-DAT-BRANCH-CD    PIC X(5).    *> POS  69-73   TEXT
           05  INP-DAT-DESC         PIC X(30).   *> POS  74-103  TEXT
           05  INP-DAT-MEMO         PIC X(15).   *> POS 104-118  TEXT
           05  INP-DAT-FILLER       PIC X(2).    *> POS 119-120
      *
      *  ── TRAILER RECORD  (last record in file) ───────────────────
       01  INP-TRAILER-RECORD.
           05  INP-TRL-REC-TYPE     PIC X(1).    *> POS   1      'T'
           05  INP-TRL-REC-COUNT    PIC 9(8).    *> POS   2-9    NUMBER total data records
           05  INP-TRL-TOTAL-AMT    PIC 9(14)V99. *> POS 10-25  DECIMAL sum of AMOUNT
           05  INP-TRL-HASH-TOTAL   PIC 9(10).   *> POS  26-35   NUMBER hash of acct nums
           05  INP-TRL-ERR-COUNT    PIC 9(8).    *> POS  36-43   NUMBER failed records
           05  INP-TRL-FILLER       PIC X(77).   *> POS  44-120
""")

write_txt(os.path.join(CPY_DIR, "BANK-BATCH-OUTPUT.CPY"), """\
      *================================================================*
      * BANK-BATCH-OUTPUT.CPY                                         *
      * Validated output file  —  140 bytes per record                *
      * Original 120-byte input + 20 bytes of PySpark enrichment      *
      * REC-TYPE:  'H' = Header   'D' = Data   'T' = Trailer          *
      *================================================================*
      *
      *  ── HEADER RECORD  (140 bytes) ──────────────────────────────
       01  OUT-HEADER-RECORD.
           05  OUT-HDR-REC-TYPE     PIC X(1).    *> POS   1      'H'
           05  OUT-HDR-FILE-DATE    PIC 9(8).    *> POS   2-9    DATE YYYYMMDD
           05  OUT-HDR-SEQ-NUM      PIC 9(6).    *> POS  10-15
           05  OUT-HDR-SRC-ID       PIC X(10).   *> POS  16-25
           05  OUT-HDR-FILE-NAME    PIC X(20).   *> POS  26-45
           05  OUT-HDR-FILLER       PIC X(95).   *> POS  46-140
      *
      *  ── DATA RECORD  (140 bytes: 120 original + 20 enrichment) ──
       01  OUT-DATA-RECORD.
      *    ── Original input fields (positions unchanged) ─────────
           05  OUT-DAT-REC-TYPE     PIC X(1).    *> POS   1      'D'
           05  OUT-DAT-TXN-ID       PIC X(10).   *> POS   2-11   TEXT
           05  OUT-DAT-TXN-DATE     PIC 9(8).    *> POS  12-19   DATE   YYYYMMDD
           05  OUT-DAT-VAL-DATE     PIC 9(8).    *> POS  20-27   DATE   YYYYMMDD
           05  OUT-DAT-TXN-TYPE     PIC X(3).    *> POS  28-30   TEXT   DEP/WDR/TRF/FEE
           05  OUT-DAT-ACCT-NUM     PIC X(12).   *> POS  31-42   TEXT
           05  OUT-DAT-AMOUNT       PIC 9(10)V99. *> POS  43-54  DECIMAL
           05  OUT-DAT-CURRENCY     PIC X(3).    *> POS  55-57   TEXT
           05  OUT-DAT-EXCH-RATE    PIC 9(4)V9(6). *> POS 58-67 DECIMAL
           05  OUT-DAT-STATUS       PIC X(1).    *> POS  68      TEXT   A/P/R/E
           05  OUT-DAT-BRANCH-CD    PIC X(5).    *> POS  69-73   TEXT
           05  OUT-DAT-DESC         PIC X(30).   *> POS  74-103  TEXT
           05  OUT-DAT-MEMO         PIC X(15).   *> POS 104-118  TEXT
           05  OUT-DAT-FILLER-1     PIC X(2).    *> POS 119-120
      *    ── Enrichment fields added by PySpark validation ────────
           05  OUT-DAT-VAL-FLAG     PIC X(1).    *> POS 121      Y=valid  N=invalid
           05  OUT-DAT-PROC-TS      PIC 9(14).   *> POS 122-135  TIMESTAMP YYYYMMDDHHMMSS
           05  OUT-DAT-ERR-CODE     PIC X(4).    *> POS 136-139  0000 or E001..Ennn
           05  OUT-DAT-FILLER-2     PIC X(1).    *> POS 140
      *
      *  ── TRAILER RECORD  (140 bytes) ─────────────────────────────
       01  OUT-TRAILER-RECORD.
           05  OUT-TRL-REC-TYPE     PIC X(1).    *> POS   1      'T'
           05  OUT-TRL-REC-COUNT    PIC 9(8).    *> POS   2-9    NUMBER total data recs
           05  OUT-TRL-TOTAL-AMT    PIC 9(14)V99. *> POS 10-25  DECIMAL sum of AMOUNT
           05  OUT-TRL-HASH-TOTAL   PIC 9(10).   *> POS  26-35   NUMBER
           05  OUT-TRL-ERR-COUNT    PIC 9(8).    *> POS  36-43   NUMBER failed records
           05  OUT-TRL-VALID-CNT    PIC 9(8).    *> POS  44-51   NUMBER passed validation
           05  OUT-TRL-INVALID-CNT  PIC 9(8).    *> POS  52-59   NUMBER failed validation
           05  OUT-TRL-FILLER       PIC X(81).   *> POS  60-140
""")

write_txt(os.path.join(CPY_DIR, "BANK-BATCH-CTRL.CPY"), """\
      *================================================================*
      * BANK-BATCH-CTRL.CPY                                           *
      * PySpark-generated control file  —  80 bytes per record        *
      *                                                               *
      * Uses parameterised prefix  :BNKCTL:-  which is stripped by    *
      * the copybook parser (same pattern as existing TXNCTRL.CPY).   *
      *================================================================*
       01  :BNKCTL:-COUNT-OUT-RECORD.
           05  :BNKCTL:-COUNT-RECORDS      PIC 9(13).    *> POS  1-13  NUMBER total records
           05  :BNKCTL:-EFFECTIVE-RECORD   PIC X(8).     *> POS 14-21  TEXT   YYYYMMDD
           05  :BNKCTL:-AS-OF-DATE         PIC X(8).     *> POS 22-29  TEXT   YYYYMMDD
           05  :BNKCTL:-SOURCE-CODE        PIC X(8)      *> POS 30-37  TEXT   right-justified
                                           JUSTIFIED RIGHT.
           05  :BNKCTL:-SOURCE-ID          PIC X(40).    *> POS 38-77  TEXT   source file name
           05  :BNKCTL:-FILLER             PIC X(3).     *> POS 78-80
""")


# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════

print("\n── Summary ─────────────────────────────────────────────────────────")
print(f"  Today ({TODAY}):    {len(today_rows)} data recs  "
      f"total ${today_cents/100:>12,.2f}  errors: {today_err}")
print(f"  Prev  ({PREV}):    {len(prev_rows)} data recs  "
      f"total ${prev_cents/100:>12,.2f}  errors: {prev_err}")
print(f"  Output:              {valid_n} valid, {invalid_n} invalid")
print()

# Spot-check record lengths
for r in today_dat: assert len(r) == 120
for r in prev_dat:  assert len(r) == 120
for r in out_data:  assert len(r) == 140
print("All record lengths verified ✓")
print(f"\nTest data directory: {BASE}")
