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
