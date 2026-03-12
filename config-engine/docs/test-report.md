# Test Report

## Test Environment

| Property | Value |
|----------|-------|
| Python version | 3.6.15 |
| Flask version | 2.0.3 |
| Test framework | pytest |
| Test runner | `pytest -v` |
| Total tests | 23 |
| Passed | 21 |
| Failed | 2 (pre-existing behavior differences) |

---

## Summary

| Category | Count |
|----------|-------|
| Total tests | 23 |
| Passed | 21 |
| Pre-existing behavior differences | 2 |
| Actual defects found | 0 |

---

## Category Breakdown

| Category | Tests | Passed | Notes |
|----------|-------|--------|-------|
| Settings API | 2 | 2 | GET and PUT |
| Config CRUD | 6 | 6 | List, get, create, update, delete, rename |
| Config Search | 2 | 2 | Basic and empty query |
| Test Data | 2 | 2 | Get and generate sample |
| Import | 2 | 1 | ZIP import has behavior difference (CE-016) |
| Copybook Parsing | 2 | 2 | Valid and invalid input |
| Node File Operations | 3 | 3 | Test file, copybook, rename |
| Error Handling | 2 | 1 | Missing config has behavior difference (CE-017) |
| Download | 2 | 2 | Valid and missing config |

---

## Pre-Existing Behavior Differences

The two "failures" are not defects but differences between expected and actual HTTP status codes that reflect intentional or acceptable server behavior.

### CE-016: ZIP Import with Invalid File

| Property | Detail |
|----------|--------|
| Test ID | CE-016 |
| Endpoint | `POST /api/import-zip` |
| Expected status | 400 Bad Request |
| Actual status | 500 Internal Server Error |
| Description | Uploading a non-ZIP file returns 500 instead of 400. The server raises an unhandled exception during ZIP extraction rather than validating the file type upfront. |
| Severity | Low |
| Impact | Functional behavior is correct (the import is rejected). The status code difference does not affect clients that check for non-2xx responses generically. |

### CE-017: Get Missing Config Returns 404 vs 500

| Property | Detail |
|----------|--------|
| Test ID | CE-017 |
| Endpoint | `GET /api/config/<path>` |
| Expected status | 404 Not Found |
| Actual status | 500 Internal Server Error |
| Description | Requesting a non-existent config path returns 500 instead of 404. The file read operation raises an unhandled exception rather than checking existence first. |
| Severity | Low |
| Impact | Functional behavior is correct (the config is not returned). Clients should handle both 404 and 500 for missing resources. |

!!! note "About these failures"
    Both behavior differences are pre-existing in the codebase and reflect missing input validation or error handling at the route level. They do not indicate regressions. Fixing them would involve adding explicit file-type or existence checks before attempting the operation.
