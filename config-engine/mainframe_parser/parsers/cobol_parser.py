"""
COBOL parser for extracting file references and basic structure.
"""

import re
from pathlib import Path
from typing import List, Optional, Tuple


class FileDescriptor:
    """Represents a COBOL FD (File Descriptor)."""

    def __init__(
        self,
        fd_name,        # type: str
        copybook=None,  # type: Optional[str]
        record_name=None,  # type: Optional[str]
    ):
        self.fd_name = fd_name
        self.copybook = copybook
        self.record_name = record_name


class SelectAssignment:
    """Represents SELECT...ASSIGN."""

    def __init__(
        self,
        file_name,    # type: str
        dd_name=None, # type: Optional[str]
    ):
        self.file_name = file_name
        self.dd_name = dd_name


class COBOLParser:
    """Parse COBOL source to extract file references and structure."""

    FD_PATTERN = re.compile(
        r"^\s*FD\s+([\w\-]+)(?:\s+COPY\s+([\w\-]+))?",
        re.IGNORECASE | re.MULTILINE,
    )
    SELECT_PATTERN = re.compile(
        r"SELECT\s+([\w\-]+)\s+ASSIGN\s+TO\s+[\"']?([\w\-]+)[\"']?",
        re.IGNORECASE | re.MULTILINE,
    )
    FILE_CONTROL_PATTERN = re.compile(
        r"FILE-CONTROL\.(.*?)(?:\.|$)",
        re.IGNORECASE | re.DOTALL,
    )
    # Patterns used by the FD lookahead parser
    _FD_LINE = re.compile(r"^\s*FD\s+([\w\-]+)", re.IGNORECASE)
    _COPY_STMT = re.compile(r"\bCOPY\s+([\w\-]+)", re.IGNORECASE)
    _STOP_LOOKAHEAD = re.compile(
        r"\bPROCEDURE\s+DIVISION\b|\bWORKING-STORAGE\s+SECTION\b|\bLINKAGE\s+SECTION\b",
        re.IGNORECASE,
    )
    # 01-level record line under an FD (also handles "-01" continuation typos)
    _FD_01_RECORD = re.compile(r"^\s*-?01\s+([\w\-]+)", re.IGNORECASE)
    # WRITE fd-record FROM ws-record
    _WRITE_FROM_PATTERN = re.compile(
        r"\bWRITE\s+([\w\-]+)\s+FROM\s+([\w\-]+)",
        re.IGNORECASE,
    )
    # Section markers for WORKING-STORAGE / PROCEDURE DIVISION boundaries
    _WS_SECTION_RE = re.compile(r"\bWORKING-STORAGE\s+SECTION\b", re.IGNORECASE)
    _PROC_DIV_RE = re.compile(r"\bPROCEDURE\s+DIVISION\b", re.IGNORECASE)

    def _parse_fds_with_copybook(self, content: str) -> List[FileDescriptor]:
        """
        Parse FD statements and find the associated COPY copybook by scanning ahead
        into the 01-record definition that follows each FD block.

        Real COBOL places the COPY in the 01-record, not on the FD line itself:
            FD  SRC-IN
                RECORDING MODE IS F
                ...
            01  SRC-REC.
                COPY GENIN01.
        """
        fds: List[FileDescriptor] = []
        lines = content.splitlines()
        for i, line in enumerate(lines):
            fd_m = self._FD_LINE.match(line)
            if not fd_m:
                continue
            fd_name = fd_m.group(1).replace("-", "_")
            copybook: Optional[str] = None
            # Look ahead up to 25 lines within the FILE SECTION only — stop at
            # the next FD, WORKING-STORAGE, LINKAGE SECTION, or PROCEDURE DIVISION.
            for j in range(i + 1, min(i + 26, len(lines))):
                ahead = lines[j]
                if self._FD_LINE.match(ahead) or self._STOP_LOOKAHEAD.search(ahead):
                    break
                copy_m = self._COPY_STMT.search(ahead)
                if copy_m:
                    # Keep the original copybook name (no hyphen→underscore) so
                    # the engine can match it to the file stem (e.g. GENIN01).
                    copybook = copy_m.group(1)
                    break
            fds.append(FileDescriptor(fd_name=fd_name, copybook=copybook))
        return fds

    def parse_file(self, path: Path) -> Tuple[List[FileDescriptor], List[SelectAssignment]]:
        """Parse COBOL file and return FD and SELECT info."""
        content = path.read_text(encoding="utf-8", errors="ignore")
        return self.parse_content(content)

    def parse_content(
        self, content: str
    ) -> Tuple[List[FileDescriptor], List[SelectAssignment]]:
        """Parse COBOL content and extract file structure."""
        # Use lookahead-based FD parsing to capture COPY inside the 01-record
        fds = self._parse_fds_with_copybook(content)
        selects: List[SelectAssignment] = []

        for match in self.SELECT_PATTERN.finditer(content):
            file_name = match.group(1).replace("-", "_")
            dd_name = match.group(2) if match.lastindex >= 2 else None
            if dd_name:
                dd_name = dd_name.replace("-", "_")
            selects.append(SelectAssignment(file_name=file_name, dd_name=dd_name))

        return fds, selects

    def get_program_context(self, content: str, max_chars: int = 8000) -> str:
        """Get truncated COBOL content for context."""
        lines = content.splitlines()
        cleaned = []
        in_proc = False
        for line in lines:
            if not line.strip() or line.strip().startswith("*") or line.strip().startswith("/"):
                continue
            if "PROCEDURE DIVISION" in line.upper():
                in_proc = True
            if in_proc:
                cleaned.append(line[6:] if len(line) > 6 else line)
        text = "\n".join(cleaned)
        if len(text) > max_chars:
            text = text[:max_chars] + "\n... [truncated]"
        return text
