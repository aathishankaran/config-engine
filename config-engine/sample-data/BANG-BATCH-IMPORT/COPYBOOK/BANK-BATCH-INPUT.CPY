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
