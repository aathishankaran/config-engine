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
