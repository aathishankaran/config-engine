      *----------------------------------------------------------------*
      * TXNCTRL.CPY  -  Control File Record Layout                    *
      * Record length : 50 bytes                                      *
      *----------------------------------------------------------------*
       01 :X9CNT01D:-COUNT-OUT-RECORD.
          05 :X9CNT01D:-COUNT-RECORDS       PIC 9(13).
          05 :X9CNT01D:-EFFECTIVE-RECORD    PIC X(08).
          05 :X9CNT01D:-AS-OF-DATE          PIC X(08).
          05 :X9CNT01D:-SOURCE-CODE         PIC X(08) JUSTIFIED RIGHT.
          05 :X9CNT01D:-SOURCE-ID           PIC X(40).
          05 :X9CNT01D:-FILLER              PIC X(03).
