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
