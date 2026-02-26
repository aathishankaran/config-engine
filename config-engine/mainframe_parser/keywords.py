"""
COBOL and JCL keyword reference for parsing and PySpark conversion.

Maps mainframe keywords to PySpark configuration elements.
"""

# =============================================================================
# COBOL RESERVED WORDS & VERBS -> PySpark Transformation Mapping
# =============================================================================

# Arithmetic verbs -> PySpark: withColumn, expr
COBOL_ARITHMETIC = frozenset({
    "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "COMPUTE",
})

# Data movement -> PySpark: select, withColumn, alias
COBOL_DATA_MOVE = frozenset({
    "MOVE", "INITIALIZE", "SET", "STRING", "UNSTRING", "INSPECT",
})

# Control flow / conditional -> PySpark: filter, when/otherwise
COBOL_CONDITIONAL = frozenset({
    "IF", "EVALUATE", "WHEN", "ELSE", "END-IF", "END-EVALUATE",
    "GREATER", "LESS", "EQUAL", "NOT", "AND", "OR",
    "GREATER-THAN", "LESS-THAN", "EQUAL-TO",
})

# Sorting/merging -> PySpark: orderBy, sort, union
COBOL_SORT_MERGE = frozenset({
    "SORT", "MERGE", "RELEASE", "RETURN", "COLLATING",
    "ASCENDING", "DESCENDING",
})

# File I/O -> PySpark: read, write
COBOL_FILE_IO = frozenset({
    "READ", "WRITE", "REWRITE", "OPEN", "CLOSE", "START", "DELETE",
})

# Aggregation / table -> PySpark: groupBy, agg, count, sum
COBOL_AGGREGATE = frozenset({
    "SUM", "COUNT", "ADD", "TALLYING", "GIVING",
})

# Procedure/loop -> PySpark: pipeline step chaining
COBOL_PROCEDURE = frozenset({
    "PERFORM", "UNTIL", "TIMES", "VARYING", "THRU", "THROUGH",
    "CALL", "EXIT", "GOBACK", "STOP", "RUN",
})

# Data definition -> schema
COBOL_DATA_DEF = frozenset({
    "PIC", "PICTURE", "COMP", "COMP-3", "OCCURS", "REDEFINES",
    "VALUE", "VALUES", "INDEXED", "KEY",
})

# All COBOL verbs relevant for transformation extraction
COBOL_TRANSFORMATION_VERBS = (
    COBOL_ARITHMETIC | COBOL_DATA_MOVE | COBOL_CONDITIONAL
    | COBOL_SORT_MERGE | COBOL_FILE_IO | COBOL_AGGREGATE | COBOL_PROCEDURE
)

# COBOL verb -> PySpark transformation type
COBOL_VERB_TO_PYSPARK = {
    "ADD": "aggregate",      # or expr
    "SUBTRACT": "expr",
    "MULTIPLY": "expr",
    "DIVIDE": "expr",
    "COMPUTE": "expr",
    "MOVE": "select",
    "IF": "filter",
    "EVALUATE": "filter",
    "SORT": "sort",
    "MERGE": "union",
    "READ": "input",
    "WRITE": "output",
    "PERFORM": "pipeline",
}

# =============================================================================
# JCL KEYWORDS -> PySpark Input/Output Config
# =============================================================================

# JOB statement
JCL_JOB_KEYWORDS = frozenset({
    "CLASS", "MSGCLASS", "MSGLEVEL", "NOTIFY", "PRTY", "REGION",
    "TYPRUN", "USER", "GROUP", "PASSWORD", "COND", "TIME",
    "ADDRSPC", "SCHENV",
})

# EXEC statement
JCL_EXEC_KEYWORDS = frozenset({
    "PGM", "PROC", "PARM", "COND", "ADDRSPC", "REGION",
    "TIME", "ACCT", "DYNAMNBR",
})

# DD statement - dataset definition
JCL_DD_KEYWORDS = frozenset({
    "DSN", "DSNAME", "DISP", "UNIT", "VOL", "SPACE",
    "DCB", "RECFM", "LRECL", "BLKSIZE", "DSORG",
    "LABEL", "SYSOUT", "DUMMY", "DATA", "DLM",
    "DEST", "FREE", "HOLD", "KEYLEN", "RETPD",
    "EXPDT", "DATACLAS", "STORCLAS", "MGMTCLAS",
})

# DISP values -> Input/Output
JCL_DISP_INPUT = frozenset({"SHR", "OLD"})
JCL_DISP_OUTPUT = frozenset({"NEW", "MOD"})
JCL_DISP_ACTION = frozenset({"KEEP", "DELETE", "CATLG", "UNCATLG", "PASS"})

# SPACE units
JCL_SPACE_UNITS = frozenset({"TRK", "CYL", "BLK"})

# =============================================================================
# PROC & SYMBOLIC KEYWORDS
# =============================================================================
PROC_KEYWORDS = frozenset({
    "PROC", "PEND", "SET", "INCLUDE", "JCLLIB", "EXPORT",
})

# Symbolic parameters start with &
SYMBOLIC_PREFIX = "&"
