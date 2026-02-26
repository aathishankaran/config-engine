"""
Discover mainframe artifact files from a folder.

Scans a directory recursively for COBOL, JCL, PROC, and copybook files.
Supports both flat layout (all files in one folder) and nested layout
(e.g. cobol/, copybooks/, jcl/ subfolders).
Counts are deduplicated by resolved path so the same file is never counted twice.
"""

from pathlib import Path

# File extensions by artifact type (case-insensitive). Only these extensions are counted.
JCL_EXTENSIONS = {".jcl"}
PROC_EXTENSIONS = {".proc", ".prc"}
COBOL_EXTENSIONS = {".cbl", ".cob", ".cobol"}
COPYBOOK_EXTENSIONS = {".cpy", ".cpybook", ".copybook", ".copy"}


def _dedupe_paths(paths: list[Path], by_name: bool = False) -> list[Path]:
    """Return paths deduplicated so each file is counted once.
    If by_name=True, dedupe by lowercase filename (same name in different folders counts as one).
    Otherwise dedupe by resolved path.
    """
    if by_name:
        seen: set[str] = set()
        out: list[Path] = []
        for p in paths:
            key = p.name.lower()
            if key not in seen:
                seen.add(key)
                out.append(p)
        return out
    seen_abs: set[Path] = set()
    out_abs: list[Path] = []
    for p in paths:
        try:
            r = p.resolve()
        except OSError:
            r = p
        if r not in seen_abs:
            seen_abs.add(r)
            out_abs.append(p)
    return out_abs


def discover_mainframe_files(
    folder: Path,
    recursive: bool = True,
) -> tuple[list[Path], list[Path], list[Path], list[Path]]:
    """
    Discover mainframe files in a folder (and all subfolders when recursive=True).
    Each file is counted at most once (deduplicated by resolved path).

    Works with:
    - Single folder: all .jcl, .cbl, .cpy etc. in one directory.
    - Multiple subfolders: e.g. cobol/, copybooks/, jcl/ with files in each.

    Returns:
        (jcl_paths, proc_paths, cobol_paths, copybook_paths)
    """
    folder = Path(folder)
    if not folder.is_dir():
        raise NotADirectoryError(f"Not a directory: {folder}")

    jcl_paths: list[Path] = []
    proc_paths: list[Path] = []
    cobol_paths: list[Path] = []
    copybook_paths: list[Path] = []

    pattern = "**/*" if recursive else "*"
    for path in folder.glob(pattern):
        if not path.is_file():
            continue
        # Skip macOS AppleDouble resource-fork files (._FILENAME) that appear in
        # ZIPs created on macOS — they share the same extension as real files and
        # would otherwise be counted and parsed as duplicate mainframe artifacts.
        if path.name.startswith("._"):
            continue

        ext = path.suffix.lower()

        if ext in JCL_EXTENSIONS:
            jcl_paths.append(path)
        elif ext in PROC_EXTENSIONS:
            proc_paths.append(path)
        elif ext in COPYBOOK_EXTENSIONS:
            copybook_paths.append(path)
        elif ext in COBOL_EXTENSIONS:
            cobol_paths.append(path)

    # Dedupe by filename so the same file in multiple folder copies (e.g. duplicate ZIP layout) counts once
    return (
        _dedupe_paths(jcl_paths, by_name=True),
        _dedupe_paths(proc_paths, by_name=True),
        _dedupe_paths(cobol_paths, by_name=True),
        _dedupe_paths(copybook_paths, by_name=True),
    )
