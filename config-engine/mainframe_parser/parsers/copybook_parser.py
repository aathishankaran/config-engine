"""
Copybook parser for extracting field schemas from COBOL copybooks.
Handles all common COBOL PIC clause formats and usage clauses.
"""

import logging
import re
from pathlib import Path

from ..schema import FieldDefinition

LOG = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Parameterised Copybook Prefix  (e.g. :X9CNT01D:-FIELDNAME)
# ─────────────────────────────────────────────────────────────────────────────

# COBOL parameterised copybooks use a REPLACING convention where a prefix
# token surrounded by colons is substituted at COPY time, e.g.:
#   05 :CUST01D:-ACCT-NO    PIC X(10).
# becomes (after COPY … REPLACING :CUST01D:- BY CUSTOMER-):
#   05 CUSTOMER-ACCT-NO     PIC X(10).
# We strip the :TOKEN:- prefix so the parser exposes the meaningful field name.
_COBOL_PREFIX_RE = re.compile(r"^:[A-Za-z0-9]+:-", re.IGNORECASE)


def _strip_cobol_prefix(name: str) -> str:
    """Strip parameterised copybook prefix: :TOKEN:-FIELDNAME → FIELDNAME."""
    return _COBOL_PREFIX_RE.sub("", name)


# ─────────────────────────────────────────────────────────────────────────────
# PIC Clause Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def _expand_pic(pic: str) -> str:
    """Expand repeated characters: XXX → X(3), 9999 → 9(4), S9(5)V99 → S9(5)V9(2)."""
    # Expand runs of repeated characters that are NOT already in (n) form
    # e.g. 9999 → 9(4), XXX → X(3), SSSSS → S(5)
    def _expand_run(m):
        ch = m.group(1)
        count = len(m.group(0))
        return f"{ch}({count})"

    # Match 2+ identical chars not preceded/followed by ( or )
    expanded = re.sub(r"([XxAa9ZzSs])\1+", _expand_run, pic)
    return expanded


# ─────────────────────────────────────────────────────────────────────────────
# Date/Time Format Detection
# ─────────────────────────────────────────────────────────────────────────────

# Inline comment pattern: *> ...rest of line
_INLINE_COMMENT_RE = re.compile(r"\*>(.*)")

# Known date/time format strings to detect in comments (checked in order)
_FORMAT_PATTERNS = [
    (re.compile(r"\bYYYYMMDD\b", re.I), "YYYYMMDD"),
    (re.compile(r"\bMMDDYYYY\b", re.I), "MMDDYYYY"),
    (re.compile(r"\bYYYY-MM-DD\b", re.I), "YYYY-MM-DD"),
    (re.compile(r"\bMMDDYY\b",   re.I), "MMDDYY"),
    (re.compile(r"\bYYMMDD\b",   re.I), "YYMMDD"),
    (re.compile(r"\bYYYYMM\b",   re.I), "YYYYMM"),
    (re.compile(r"\bHHMMSS\b",   re.I), "HHMMSS"),
    (re.compile(r"\bHH:MM:SS\b", re.I), "HH:MM:SS"),
    (re.compile(r"\bHHMM\b",     re.I), "HHMM"),
]

# Format names that indicate a date or time field — used to override numeric spark type
_DATE_FMT_NAMES = {"YYYYMMDD", "MMDDYYYY", "YYYY-MM-DD", "MMDDYY", "YYMMDD", "YYYYMM"}
_TIME_FMT_NAMES = {"HHMMSS", "HH:MM:SS", "HHMM"}


def _extract_format_hint(line: str, name: str, pic_length: int | None) -> str | None:
    """
    Detect a date/time format hint for a copybook field.

    Priority:
      1. Inline comment on the same line (text after *>) — e.g. *> YYYYMMDD
      2. Field-name + PIC length heuristics
    """
    # 1. Inline comment
    cm = _INLINE_COMMENT_RE.search(line)
    if cm:
        comment = cm.group(1)
        for pat, fmt in _FORMAT_PATTERNS:
            if pat.search(comment):
                return fmt

    # 2. Name heuristics
    name_up = name.upper().replace("-", "_")
    is_date = (
        "DATE" in name_up
        or name_up.endswith("_DT")
        or "_DT_" in name_up
        or name_up.endswith("_DTE")
        or name_up.endswith("_DAT")
    )
    is_time = "TIME" in name_up

    if is_date:
        if pic_length == 8:
            return "YYYYMMDD"
        if pic_length == 6:
            return "YYYYMM"
        if pic_length == 10:
            return "YYYY-MM-DD"
    if is_time:
        if pic_length == 6:
            return "HHMMSS"
        if pic_length == 4:
            return "HHMM"

    return None


def _cobol_type_to_spark(pic: str, usage: str = "") -> str:
    """
    Map a normalised COBOL PIC clause (and optional USAGE) to Spark/Python type.

    USAGE clauses:
      COMP / COMP-5 / BINARY     → long (or int for small widths)
      COMP-3 / PACKED-DECIMAL    → decimal / double
      DISPLAY (default)          → follow PIC chars
    """
    usage_up = usage.upper().replace("-", "").replace(" ", "")
    pic_up   = pic.upper().replace(" ", "")

    # Packed decimal (COMP-3 / PACKED-DECIMAL) → double
    if usage_up in ("COMP3", "PACKEDDECIMAL"):
        return "double"

    # Binary integer (COMP / COMP-5 / BINARY) → long
    if usage_up in ("COMP", "COMP5", "BINARY", "COMPUTATIONAL", "COMPUTATIONAL5"):
        return "long"

    # COMP-1 = single-precision float, COMP-2 = double-precision float
    if usage_up in ("COMP1", "COMP2", "COMPUTATIONAL1", "COMPUTATIONAL2"):
        return "double"

    # Alphabetic / alphanumeric  (must come before digit checks — X(169) has digits)
    if "X" in pic_up or "A" in pic_up or "Z" in pic_up:
        return "string"

    # Decimal (signed or unsigned with V) — implied decimal point (COBOL V-clause)
    if "V" in pic_up and "9" in pic_up:
        return "decimal"

    # Signed integer
    if "S" in pic_up and "9" in pic_up:
        return "long"

    # Unsigned integer
    if "9" in pic_up:
        return "long"

    if "D" in pic_up:
        return "date"
    if "T" in pic_up:
        return "timestamp"

    return "string"


def _parse_pic_length(pic: str) -> tuple[int | None, int | None]:
    """
    Extract (length, precision) from a COBOL PIC clause.

    Handles:
      9(n)         → length=n
      9(n)V9(m)    → length=n+m, precision=m
      X(n)         → length=n
      S9(n)V9(m)   → length=n+m, precision=m
      S9(n)        → length=n
      COMP-3 bit-length → byte=(n//2+1) converted to char length
    """
    pic_up = pic.upper().replace(" ", "")
    length = None
    precision = None

    # Integer part of numeric: 9(n) or S9(n)
    int_match = re.search(r"9\((\d+)\)", pic_up)
    if int_match:
        length = int(int_match.group(1))

    # Decimal part: V9(m) or V99...
    v_match = re.search(r"V9\((\d+)\)", pic_up)
    if v_match:
        precision = int(v_match.group(1))
        length = (length or 0) + precision
    else:
        # V followed by repeated 9s: V99 etc
        v_inline = re.search(r"V(9+)", pic_up)
        if v_inline:
            precision = len(v_inline.group(1))
            length = (length or 0) + precision

    # Alphanumeric: X(n)
    x_match = re.search(r"[XA]\((\d+)\)", pic_up)
    if x_match and length is None:
        length = int(x_match.group(1))

    # Single X or A without parentheses
    if length is None and ("X" in pic_up or "A" in pic_up):
        length = 1

    # Single 9 without parens (rare)
    if length is None and "9" in pic_up and not re.search(r"9\(\d+\)", pic_up):
        # Count bare 9s
        bare = re.sub(r"9\(\d+\)", "", pic_up)
        cnt  = bare.count("9")
        if cnt > 0:
            length = cnt

    return length, precision


# ─────────────────────────────────────────────────────────────────────────────
# Parser
# ─────────────────────────────────────────────────────────────────────────────

class CopybookParser:
    """Parse COBOL copybook files to extract field schema for all common formats."""

    # Reusable sub-pattern for a COBOL identifier that may carry a
    # parameterised-copybook prefix of the form  :TOKEN:-  (non-capturing).
    _NAME_PAT = r"(?::[A-Za-z0-9]+:-)?[\w][\w\-]*"

    # Match level + name + optional PIC clause on same line.
    # Accepts both plain field names (TXN-ID) and parameterised names
    # (:X9CNT01D:-TXN-ID).
    FIELD_PATTERN = re.compile(
        r"^\s*(\d{2})\s+((?::[A-Za-z0-9]+:-)?[\w][\w\-]*)"  # level + name
        r"(?:\s+REDEFINES\s+((?::[A-Za-z0-9]+:-)?[\w][\w\-]*))?"  # optional REDEFINES
        r"(?:\s+(?:PIC\s+|PICTURE\s+)([\w\(\)V\.SsZz9XxAa]+))?"   # optional PIC
        r"(?:\s+(?:USAGE\s+(?:IS\s+)?)?(COMP(?:-[1-5])?|BINARY|PACKED-DECIMAL|COMPUTATIONAL(?:-[1-5])?))?",  # optional USAGE
        re.IGNORECASE | re.MULTILINE,
    )

    # Standalone USAGE clause (may appear on its own line after the field declaration)
    USAGE_PATTERN = re.compile(
        r"^\s+(?:USAGE\s+(?:IS\s+)?)?(COMP(?:-[1-5])?|BINARY|PACKED-DECIMAL|COMPUTATIONAL(?:-[1-5])?)\s*[,.]?\s*$",
        re.IGNORECASE,
    )

    # PIC continuation on separate line
    PIC_CONTINUATION = re.compile(
        r"^\s+(?:PIC\s+|PICTURE\s+)([\w\(\)V\.SsZz9XxAa]+)",
        re.IGNORECASE,
    )

    # Lines to skip: pure comments (* in col 7 COBOL convention) or blank
    COMMENT_LINE = re.compile(r"^\s*\*|^\s*$")

    # JUSTIFIED / JUST RIGHT clause — signals right-aligned alphanumeric field
    # COBOL allows abbreviated form JUST RIGHT as well as full JUSTIFIED RIGHT.
    JUSTIFIED_PATTERN = re.compile(r"\bJUST(?:IFIED)?\s+RIGHT\b", re.IGNORECASE)

    def parse_file(self, path: Path) -> list[FieldDefinition]:
        """Parse a copybook file and return field definitions."""
        content = path.read_text(encoding="utf-8", errors="ignore")
        return self.parse_content(content)

    def parse_content(self, content: str) -> list[FieldDefinition]:
        """Parse copybook content and extract field definitions."""
        try:
            fields = self._parse_with_copybook_lib(content)
            if not fields:
                fields = self._parse_with_regex(content)
            return fields
        except ImportError:
            return self._parse_with_regex(content)

    # Pattern to find 01-level group names (no PIC) for record-type tagging
    _GROUP01_PATTERN = re.compile(
        r"^\s*01\s+((?::[A-Za-z0-9]+:-)?[\w][\w\-]*)\s*[,.]?\s*$",
        re.IGNORECASE | re.MULTILINE,
    )

    def _build_group_record_type_map(self, content: str) -> list[tuple[str, str]]:
        """
        Pre-scan content for 01-level group names and return an ordered list of
        (group_name, record_type) so we can tag fields by their position range.
        """
        groups = []
        for m in self._GROUP01_PATTERN.finditer(content):
            group_name = _strip_cobol_prefix(m.group(1))
            groups.append((m.start(), group_name, self._group_record_type(group_name)))
        return groups  # [(char_offset, name, record_type), ...]

    def _parse_with_copybook_lib(self, content: str) -> list[FieldDefinition]:
        """Use the `copybook` library if available (elementary items only)."""
        try:
            from copybook import parse_string

            # Pre-scan for 01-level group boundaries to assign record_type
            group_ranges = self._build_group_record_type_map(content)
            # Build a position-range → record_type lookup from the pre-scan
            # Each group owns from its char offset up to the next group's offset
            def _record_type_for_byte_pos(byte_pos: int) -> str:
                rtype = "DATA"
                for offset, _name, rt in group_ranges:
                    if byte_pos >= offset:
                        rtype = rt
                    else:
                        break
                return rtype

            parsed = parse_string(content)
            fields: list[FieldDefinition] = []
            position = 1
            for item in parsed.flatten():
                pic = getattr(item, "pic", None)
                if not pic:
                    continue
                name = _strip_cobol_prefix(getattr(item, "name", str(item)))
                if name.upper() == "FILLER":
                    # Still advance position, but don't expose FILLER as a field
                    length = getattr(item, "length", None) or 1
                    position += length
                    continue
                length      = getattr(item, "length", None)
                usage       = getattr(item, "usage", "") or ""
                spark_type  = _cobol_type_to_spark(str(pic), str(usage))
                length_val, precision = _parse_pic_length(_expand_pic(str(pic)))
                len_use = length or length_val or 1
                # Attempt to find record_type via content byte offset of name
                item_offset = content.find(name)
                record_type = _record_type_for_byte_pos(item_offset) if item_offset >= 0 else "DATA"
                # Find the original line in content to extract format hint from comment
                raw_line = ""
                if item_offset >= 0:
                    line_start = content.rfind("\n", 0, item_offset) + 1
                    line_end   = content.find("\n", item_offset)
                    raw_line   = content[line_start: line_end if line_end >= 0 else len(content)]
                fmt_hint = _extract_format_hint(raw_line, name, length or length_val)
                # Override numeric type when format hint reveals a date/time field
                if fmt_hint in _DATE_FMT_NAMES and spark_type == "long":
                    spark_type = "date"
                elif fmt_hint in _TIME_FMT_NAMES and spark_type == "long":
                    spark_type = "string"
                # Detect JUSTIFIED RIGHT on the raw field line
                just_right = bool(self.JUSTIFIED_PATTERN.search(raw_line))
                if just_right:
                    LOG.info(
                        "[COPYBOOK] Field '%s' (start=%d, len=%s): "
                        "JUSTIFIED RIGHT detected — output will be right-aligned",
                        name, position, length or length_val,
                    )
                fields.append(
                    FieldDefinition(
                        name=name,
                        type=spark_type,
                        start=position,
                        length=length or length_val,
                        precision=precision,
                        format=fmt_hint,
                        record_type=record_type,
                        just_right=just_right,
                    )
                )
                position += len_use
            return fields
        except Exception:
            return self._parse_with_regex(content)

    # Matches REDEFINES for position reset; also handles :TOKEN:- prefixed names.
    _REDEFINES_PATTERN = re.compile(
        r"^\s*(\d{2})\s+((?::[A-Za-z0-9]+:-)?[\w][\w\-]*)\s+REDEFINES\s+((?::[A-Za-z0-9]+:-)?[\w][\w\-]*)",
        re.IGNORECASE | re.MULTILINE,
    )

    # Keywords that identify 01-level group names as header or trailer records
    _HEADER_KEYWORDS = ("HDR", "HEADER")
    _TRAILER_KEYWORDS = ("TRL", "TRAILER")

    @staticmethod
    def _group_record_type(group_name: str) -> str:
        """Return HEADER, TRAILER, or DATA based on the 01-level group name."""
        upper = group_name.upper()
        if any(k in upper for k in CopybookParser._HEADER_KEYWORDS):
            return "HEADER"
        if any(k in upper for k in CopybookParser._TRAILER_KEYWORDS):
            return "TRAILER"
        return "DATA"

    def _parse_with_regex(self, content: str) -> list[FieldDefinition]:
        """
        Robust regex-based copybook parser.

        Handles:
          - Standard PIC/PICTURE clauses (X, A, Z, 9, S, V, with/without parentheses)
          - Repeated PIC characters (XXX, 9999)
          - REDEFINES (resets byte-position to redefined item)
          - COMP / COMP-3 / BINARY / PACKED-DECIMAL USAGE clauses
          - PIC on a continuation line after the field name
          - FILLER fields (skipped from output, but position is advanced)
          - OCCURS clause (fields are included once; array expansion not done)
          - Column-6 comment lines (* in position 7) and blank lines
          - Multiple 01-level groups tagged as HEADER / TRAILER / DATA based on group name
        """
        fields: list[FieldDefinition] = []
        seen: set[str] = set()
        position = 1
        _current_record_type = "DATA"   # tracks current 01-level group type

        # Name → start position (for REDEFINES lookup)
        name_to_start: dict[str, int] = {}
        # Redefines map built in one pass: redefining → redefined.
        # Prefixes are stripped so lookups work regardless of placeholder tokens.
        redefines_map: dict[str, str] = {
            _strip_cobol_prefix(m.group(2)): _strip_cobol_prefix(m.group(3))
            for m in self._REDEFINES_PATTERN.finditer(content)
        }

        lines = content.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            i += 1

            # Skip blanks and COBOL column-7 comments
            if self.COMMENT_LINE.match(line):
                continue

            m = self.FIELD_PATTERN.match(line)
            if not m:
                continue

            level     = m.group(1)
            # Strip parameterised-copybook prefix if present (:TOKEN:-NAME → NAME)
            name      = _strip_cobol_prefix(m.group(2))
            redef_tgt = _strip_cobol_prefix(m.group(3)) if m.group(3) else None
            pic       = m.group(4)   # PIC clause value (may be None)
            usage     = (m.group(5) or "").strip()

            # 88-level condition values — skip entirely
            if level == "88":
                continue

            # 01 / 77 — top-level or working-storage record
            if level in ("01", "77"):
                name_to_start[name] = position
                # Determine record type from the 01-level group name
                _current_record_type = self._group_record_type(name)
                if pic is None:
                    # Group record — no data, no PIC; record type now updated
                    continue

            # Handle REDEFINES: reset position to the start of the redefined item
            if redef_tgt:
                reset_pos = name_to_start.get(redef_tgt, position)
                position  = reset_pos
                name_to_start[name] = position
                if not pic:
                    continue  # group-level REDEFINES

            # If no PIC on this line, check continuation lines for PIC / USAGE
            if pic is None:
                for lookahead in lines[i:i + 3]:
                    pic_m = self.PIC_CONTINUATION.match(lookahead)
                    if pic_m:
                        pic = pic_m.group(1)
                        break
                    use_m = self.USAGE_PATTERN.match(lookahead)
                    if use_m and not usage:
                        usage = use_m.group(1)
                    if not self.COMMENT_LINE.match(lookahead) and not use_m and not pic_m:
                        break  # stop looking ahead on non-continuation lines

            if pic is None:
                # Group item with no PIC at all
                if name not in name_to_start:
                    name_to_start[name] = position
                continue

            # Also check next line for USAGE if not yet found
            if not usage and i < len(lines):
                use_m = self.USAGE_PATTERN.match(lines[i])
                if use_m:
                    usage = use_m.group(1)

            # Skip FILLER — advance position without adding a field
            if name.upper() == "FILLER":
                pic_exp = _expand_pic(pic)
                length_val, _ = _parse_pic_length(pic_exp)
                position += length_val or 1
                continue

            # Deduplicate (some copybooks repeat REDEFINES names)
            if name in seen:
                continue
            seen.add(name)

            pic_exp    = _expand_pic(pic)
            length_val, precision = _parse_pic_length(pic_exp)
            spark_type = _cobol_type_to_spark(pic_exp, usage)
            len_use    = length_val or 1
            fmt_hint   = _extract_format_hint(line, name, length_val)
            # Override numeric type when format hint reveals a date/time field
            if fmt_hint in _DATE_FMT_NAMES and spark_type == "long":
                spark_type = "date"
            elif fmt_hint in _TIME_FMT_NAMES and spark_type == "long":
                spark_type = "string"

            # ── JUSTIFIED RIGHT detection ──────────────────────────────────────
            # The clause may appear on the same field line (most common) or on a
            # continuation line immediately following the PIC clause.
            # We scan the current line plus up to 3 subsequent lines, stopping
            # when we encounter the start of a new field declaration.
            just_right = bool(self.JUSTIFIED_PATTERN.search(line))
            if not just_right:
                for _la in lines[i:i + 3]:
                    if self.COMMENT_LINE.match(_la):
                        continue
                    if self.JUSTIFIED_PATTERN.search(_la):
                        just_right = True
                        break
                    # Next field declaration — stop looking ahead
                    if re.match(r"^\s*\d{2}\s+\w", _la):
                        break
            if just_right:
                LOG.info(
                    "[COPYBOOK] Field '%s' (start=%d, len=%s): "
                    "JUSTIFIED RIGHT detected — output will be right-aligned",
                    name, position, length_val,
                )

            fields.append(
                FieldDefinition(
                    name=name,
                    type=spark_type,
                    start=position,
                    length=length_val,
                    precision=precision,
                    format=fmt_hint,
                    record_type=_current_record_type,
                    just_right=just_right,
                )
            )
            name_to_start[name] = position
            position += len_use

        return fields
