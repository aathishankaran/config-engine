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
