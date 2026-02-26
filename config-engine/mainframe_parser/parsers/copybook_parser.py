"""
Copybook parser for extracting field schemas.
"""

import re
from pathlib import Path

from ..schema import FieldDefinition


def _cobol_type_to_spark(pic: str) -> str:
    """Map COBOL PIC clause to Spark/Python type.

    IMPORTANT: Alphabetic types (X, A) are checked FIRST because digits like
    "9" can appear inside the length specifier of an X clause (e.g. X(169))
    and would otherwise be mis-classified as numeric.
    """
    pic_upper = pic.upper().replace(" ", "")
    # Alphanumeric / alphabetic — must come before the "9" checks
    if "X" in pic_upper or "A" in pic_upper:
        return "string"
    if "9" in pic_upper and "V" in pic_upper:
        return "double"
    if "9" in pic_upper and "S" in pic_upper:
        return "long"
    if "9" in pic_upper:
        return "long"
    if "D" in pic_upper:
        return "date"
    if "T" in pic_upper:
        return "timestamp"
    return "string"


def _parse_pic_length(pic: str) -> tuple[int | None, int | None]:
    """Extract length and precision from PIC clause."""
    pic_upper = pic.upper().replace(" ", "")
    length = None
    precision = None
    match = re.search(r"9\((\d+)\)", pic_upper)
    if match:
        length = int(match.group(1))
    v_match = re.search(r"V9\((\d+)\)", pic_upper)
    if v_match:
        precision = int(v_match.group(1))
        if length:
            length += precision
    x_match = re.search(r"[XA]\((\d+)\)", pic_upper)
    if x_match:
        length = int(x_match.group(1))
    return length, precision


class CopybookParser:
    """Parse COBOL copybook files to extract field schema."""

    FIELD_PATTERN = re.compile(
        r"^\s*(\d{2})\s+([\w\-]+)(?:\s+PIC\s+([\w\(\)V\.]+))?",
        re.IGNORECASE | re.MULTILINE,
    )

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

    def _parse_with_copybook_lib(self, content: str) -> list[FieldDefinition]:
        """Use copybook library if available. Only elementary items (with PIC) are included; level-01/group names are skipped."""
        try:
            from copybook import parse_string

            parsed = parse_string(content)
            fields: list[FieldDefinition] = []
            position = 1
            for item in parsed.flatten():
                pic = getattr(item, "pic", None)
                if not pic:
                    # Skip group levels (e.g. 01 ACCT-MASTER-REC with no PIC) — not a data field
                    continue
                name = getattr(item, "name", str(item))
                length = getattr(item, "length", None)
                spark_type = _cobol_type_to_spark(str(pic))
                length_val, precision = _parse_pic_length(str(pic))
                len_use = length or length_val or 1
                fields.append(
                    FieldDefinition(
                        name=name,
                        type=spark_type,
                        start=position,
                        length=length or length_val,
                        precision=precision,
                    )
                )
                position += len_use
            return fields
        except Exception:
            return self._parse_with_regex(content)

    # Detects "NN  FIELDNAME REDEFINES OTHERNAME" so positions can be reset correctly
    _REDEFINES_PATTERN = re.compile(
        r"^\s*(\d{2})\s+([\w\-]+)\s+REDEFINES\s+([\w\-]+)",
        re.IGNORECASE | re.MULTILINE,
    )

    def _parse_with_regex(self, content: str) -> list[FieldDefinition]:
        """Fallback regex-based copybook parsing.

        Handles REDEFINES groups by resetting the byte-position counter to the
        start position of the redefined item, so DET and TLR record overlays in
        copybooks like GENIN01 get correct field offsets instead of accumulating
        past the end of the HDR layout.
        """
        fields: list[FieldDefinition] = []
        seen: set[str] = set()
        position = 1  # 1-based starting position for fixed-width

        # Map group/field name -> its start position (for REDEFINES lookup)
        name_to_start: dict[str, int] = {}
        # Build the REDEFINES map: {redefining_name: redefined_name}
        redefines_map: dict[str, str] = {
            m.group(2): m.group(3)
            for m in self._REDEFINES_PATTERN.finditer(content)
        }
        # Track which group we are currently inside a REDEFINES block for
        current_redefines_reset: int | None = None
        current_redefines_group: str | None = None

        for match in self.FIELD_PATTERN.finditer(content):
            level = match.group(1)
            name = match.group(2)
            pic = match.group(3)

            if level == "01":
                # Top-level record — record its start, skip (no PIC)
                name_to_start[name] = position
                continue

            # Check if this field starts a REDEFINES group (no PIC on this line)
            if name in redefines_map and not pic:
                redefined = redefines_map[name]
                reset_pos = name_to_start.get(redefined, position)
                position = reset_pos
                current_redefines_reset = reset_pos
                current_redefines_group = name
                name_to_start[name] = position
                continue

            if not pic:
                # Group item without PIC and without REDEFINES — track start
                name_to_start[name] = position
                continue

            if name in seen:
                continue
            seen.add(name)

            length, precision = _parse_pic_length(pic)
            spark_type = _cobol_type_to_spark(pic)
            length_val = length or 1
            fields.append(
                FieldDefinition(
                    name=name,
                    type=spark_type,
                    start=position,
                    length=length,
                    precision=precision,
                )
            )
            name_to_start[name] = position
            position += length_val
        return fields
