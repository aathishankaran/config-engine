"""
Rule-based extraction of transformation logic from COBOL programs.

Parses COBOL comments and code structure to extract filter, join, aggregate,
sort, move, compute logic for PySpark configuration (no AI required).
"""

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..keywords import COBOL_VERB_TO_PYSPARK
from ..schema import TransformationStep, TransformationConfig


class COBOLTransformationExtractor:
    """Extract transformation steps from COBOL source using patterns and comments."""

    JOIN_PATTERN = re.compile(
        r"Join\s+([\w\-]+)\s*\+\s*([\w\-]+)\s+on\s+([\w\-]+)\s*=\s*([\w\-]+)",
        re.IGNORECASE,
    )
    FILTER_PATTERN = re.compile(
        r"Filter:\s*([\w\-]+)\s*([<>!=]+|GREATER\s+THAN|LESS\s+THAN)\s*(\d+)",
        re.IGNORECASE,
    )
    FILTER_SIMPLE_PATTERN = re.compile(
        r"Filter:\s*([\w\-]+)\s+>\s*(\d+)",
        re.IGNORECASE,
    )
    AGGREGATE_PATTERN = re.compile(
        r"Aggregate\s+by\s+([\w\-]+):?\s*SUM\(([\w\-]+)\)|COUNT",
        re.IGNORECASE,
    )
    AGGREGATE_GROUP_PATTERN = re.compile(
        r"Aggregate\s+by\s+([\w\-]+):?\s*(.+)",
        re.IGNORECASE,
    )
    WRITE_TO_PATTERN = re.compile(
        r"write\s+to\s+([\w\-]+)",
        re.IGNORECASE,
    )
    IF_GREATER_PATTERN = re.compile(
        r"IF\s+([\w\-]+)\s+GREATER\s+THAN\s+(\d+)",
        re.IGNORECASE,
    )
    IF_LESS_PATTERN = re.compile(
        r"IF\s+([\w\-]+)\s+LESS\s+THAN\s+(\d+)",
        re.IGNORECASE,
    )
    WRITE_REC_PATTERN = re.compile(
        r"WRITE\s+([\w\-]+)-REC",
        re.IGNORECASE,
    )
    SELECT_PATTERN = re.compile(
        r"SELECT\s+([\w\-]+)-FILE\s+ASSIGN\s+TO\s+['\"]?([\w\-]+)['\"]?",
        re.IGNORECASE,
    )
    ADD_PATTERN = re.compile(r"ADD\s+([\w\-]+)\s+TO\s+([\w\-]+)", re.IGNORECASE)
    SUBTRACT_PATTERN = re.compile(r"SUBTRACT\s+([\w\-]+)\s+FROM\s+([\w\-]+)", re.IGNORECASE)
    MULTIPLY_PATTERN = re.compile(r"MULTIPLY\s+([\w\-]+)\s+BY\s+([\w\-]+)", re.IGNORECASE)
    COMPUTE_PATTERN = re.compile(r"COMPUTE\s+([\w\-]+)\s*=\s*(.+)", re.IGNORECASE)
    MOVE_PATTERN = re.compile(r"MOVE\s+([\w\-]+)\s+TO\s+([\w\-]+)", re.IGNORECASE)
    # MOVE literal (number or quoted string) so runner uses F.lit() not F.col("16")
    MOVE_LITERAL_PATTERN = re.compile(
        r"MOVE\s+(\d+(?:\.\d+)?|'[^']*'|\"[^\"]*\")\s+TO\s+([\w\-]+)",
        re.IGNORECASE,
    )
    SORT_PATTERN = re.compile(r"SORT\s+([\w\-]+)\s+(?:ON\s+)?(?:ASCENDING|DESCENDING)?\s+KEY\s+([\w\-]+)", re.IGNORECASE)
    MERGE_PATTERN = re.compile(r"MERGE\s+([\w\-]+)\s+ON\s+([\w\-]+)", re.IGNORECASE)
    IF_EQUAL_PATTERN = re.compile(r"IF\s+([\w\-]+)\s+=\s+([\w\-]+)", re.IGNORECASE)
    IF_NOT_EQUAL_PATTERN = re.compile(r"IF\s+([\w\-]+)\s+NOT\s+EQUAL\s+([\w\-]+)", re.IGNORECASE)
    SELECT_PATTERN_ANY = re.compile(
        r"SELECT\s+([\w\-]+)\s+ASSIGN\s+TO\s+['\"]?([\w\-]+)['\"]?",
        re.IGNORECASE,
    )
    IF_DR_PATTERN = re.compile(
        r"IF\s+([\w\-]+)\s*(?:EQUAL\s+TO\s+|=)\s*['\"]DR['\"]",
        re.IGNORECASE,
    )
    IF_CR_PATTERN = re.compile(
        r"IF\s+([\w\-]+)\s*(?:EQUAL\s+TO\s+|=)\s*['\"]CR['\"]",
        re.IGNORECASE,
    )
    ROUNDED_PATTERN = re.compile(r"\bROUNDED\b", re.IGNORECASE)
    # ELSE branch: MOVE '...' TO ERROR-RECORD and WRITE ERROR-RECORD (error/reject path)
    ELSE_ERROR_MOVE_PATTERN = re.compile(
        r"ELSE\s+(?:MOVE\s+)?['\"]([^'\"]+)['\"]\s+TO\s+([\w\-]+)(?:-RECORD)?",
        re.IGNORECASE,
    )
    WRITE_ERROR_REC_PATTERN = re.compile(
        r"WRITE\s+([\w\-]+)-RECORD",
        re.IGNORECASE,
    )

    def extract_from_content(
        self,
        cobol_content: str,
        input_names: List[str],
        output_names: List[str],
    ) -> Optional[TransformationConfig]:
        """Extract transformation steps from COBOL content."""
        steps: List[TransformationStep] = []
        content_upper = cobol_content.upper()

        dd_map: Dict[str, str] = {}
        for m in self.SELECT_PATTERN.finditer(cobol_content):
            prog_name = m.group(1).replace("-", "_").upper()
            dd_name = m.group(2).replace("-", "_").upper()
            dd_map[prog_name] = dd_name
        for m in self.SELECT_PATTERN_ANY.finditer(cobol_content):
            prog_name = m.group(1).replace("-", "_").upper()
            dd_name = m.group(2).replace("-", "_").upper()
            if prog_name not in dd_map:
                dd_map[prog_name] = dd_name

        has_dr = bool(self.IF_DR_PATTERN.search(cobol_content))
        has_cr = bool(self.IF_CR_PATTERN.search(cobol_content))

        # Infer DR/CR accumulation pattern from ADD statement targets when explicit
        # IF DR / IF CR statements are absent or use non-standard syntax.
        # The evidence from the generated JSON shows the COBOL always has:
        #   ADD TXN-AMT TO WS-DEBIT-TOTAL
        #   ADD TXN-AMT TO WS-CREDIT-TOTAL
        # even when the surrounding IF/ELSE uses syntax our regex does not match.
        # Strategy: collect all ADD targets; if BOTH a DEBIT and a CREDIT target exist,
        # this is definitively a debit/credit accumulation program.
        if not (has_dr and has_cr):
            add_targets = [m.group(2).upper() for m in self.ADD_PATTERN.finditer(cobol_content)]
            has_debit_add = any("DEBIT" in t for t in add_targets)
            has_credit_add = any("CREDIT" in t for t in add_targets)
            if has_debit_add and has_credit_add:
                # Both debit and credit working-storage accumulators found in ADD statements
                # → treat this as a DR/CR batch program unconditionally.
                has_dr = True
                has_cr = True
            elif has_dr and has_credit_add:
                has_cr = True
            elif has_cr and has_debit_add:
                has_dr = True

        has_rounded = bool(self.ROUNDED_PATTERN.search(cobol_content))
        error_out = next((o for o in output_names if "ERR" in (o or "").upper() or "ERROR" in (o or "").upper()), None)
        sum_out = next((o for o in output_names if "SUM" in (o or "").upper() or "REPORT" in (o or "").upper() or "SUMMARY" in (o or "").upper()), output_names[0] if output_names else None)
        txn_input = next((n for n in input_names if "TXN" in n.upper() or "TRANS" in n.upper() or "TRAN" in n.upper()), input_names[0] if input_names else None)
        acct_input = next((n for n in input_names if "ACCT" in n.upper()), None)
        cust_input = next((n for n in input_names if "CUST" in n.upper()), None)
        use_joins = txn_input and acct_input and cust_input and len(input_names) >= 3

        if has_dr and has_cr and input_names and output_names:
            type_field_dr = None
            type_field_cr = None
            for m in self.IF_DR_PATTERN.finditer(cobol_content):
                type_field_dr = m.group(1)
                break
            for m in self.IF_CR_PATTERN.finditer(cobol_content):
                type_field_cr = m.group(1)
                break
            type_field = type_field_dr or type_field_cr or "TXN_TYPE"

            # 0) Join all inputs (CUSTIN, ACCTIN, TXNIN) so no input is left alone
            if use_joins:
                steps.append(
                    TransformationStep(
                        id="join_txn_acct",
                        description="Join TXNIN with ACCTIN on account",
                        type="join",
                        source_inputs=[txn_input, acct_input],
                        logic={"left": txn_input, "right": acct_input, "on": [["TXN_ACCT_NO", "ACCT_NO"]], "how": "inner"},
                        output_alias="joined_txn_acct",
                    )
                )
                steps.append(
                    TransformationStep(
                        id="join_with_cust",
                        description="Join with CUSTIN on customer",
                        type="join",
                        source_inputs=["joined_txn_acct", cust_input],
                        logic={"left": "joined_txn_acct", "right": cust_input, "on": [["CUST_ID", "CUST_ID"]], "how": "inner"},
                        output_alias="joined_data",
                    )
                )
                filter_source = ["joined_data"]
            else:
                filter_source = [txn_input]

            # 1) Filter valid (DR/CR) so PySpark flow: valid_txns → aggregate → SUMOUT; invalid → ERROUT
            steps.append(
                TransformationStep(
                    id="filter_valid_txn_type",
                    description="Filter valid transaction type: DR or CR only",
                    type="filter",
                    source_inputs=filter_source,
                    logic={
                        "conditions": [
                            {"field": type_field, "operation": "in", "value": ["DR", "CR"]},
                        ],
                        "pyspark_equiv": "filter(col('TXN_TYPE').isin('DR','CR'))",
                    },
                    output_alias="valid_txns",
                )
            )
            # 2) Aggregate on valid_txns → SUMOUT (group by key from COBOL, e.g. TXN-ACCT-NO / SUM-CUST-ID)
            group_key_candidates = ["TXN-ACCT-NO", "ACCT-NO", "CUST-ID", "ACCOUNT-ID", "TXN-ACCT-NUM"]
            group_by_field = "ACCOUNT_ID"
            content_upper = cobol_content.upper()
            for cand in group_key_candidates:
                if cand.replace("-", " ").upper() in content_upper or cand.upper() in content_upper:
                    group_by_field = cand
                    break
            desc = "Sum debit (DR) and credit (CR) transactions into SUM_TOTAL_DEBIT and SUM_TOTAL_CREDIT"
            if has_rounded:
                desc += "; ROUNDED"
            desc += "."
            # Output to intermediate so we can add SUM_NET and SUM_CUST_ID in next step
            agg_alias = "agg_debit_credit"
            steps.append(
                TransformationStep(
                    id="categorize_debit_credit",
                    description=desc,
                    type="aggregate",
                    source_inputs=["valid_txns"],
                    logic={
                        "group_by": [group_by_field],
                        "aggregations": [
                            {
                                "field": "TXN_AMT",
                                "operation": "sum",
                                "alias": "SUM_TOTAL_DEBIT",
                                "condition": f"{type_field} = 'DR'",
                            },
                            {
                                "field": "TXN_AMT",
                                "operation": "sum",
                                "alias": "SUM_TOTAL_CREDIT",
                                "condition": f"{type_field} = 'CR'",
                            },
                        ],
                        "note": "IF TXN-TYPE='DR' ADD TXN-AMT TO sum; IF TXN-TYPE='CR' ADD TO sum; then SUM_NET = CREDIT - DEBIT.",
                    },
                    output_alias=agg_alias,
                )
            )
            # Finalize summary: SUM_NET = SUM_TOTAL_CREDIT - SUM_TOTAL_DEBIT, SUM_CUST_ID from group key
            steps.append(
                TransformationStep(
                    id="summary_finalize",
                    description="Compute SUM_NET and map group key to SUM_CUST_ID for output",
                    type="select",
                    source_inputs=[agg_alias],
                    logic={
                        "expressions": [
                            {"target": "SUM_NET", "expression": "SUM_TOTAL_CREDIT - SUM_TOTAL_DEBIT", "operation": "compute"},
                            {"target": "SUM_CUST_ID", "expression": group_by_field, "operation": "move"},
                        ],
                        "pyspark_equiv": "withColumn(SUM_NET, credit - debit); withColumn(SUM_CUST_ID, group_key)",
                    },
                    output_alias=sum_out,
                )
            )
            # 3) Filter invalid (not DR/CR) → ERROUT (runnable in PySpark framework)
            if error_out:
                steps.append(
                    TransformationStep(
                        id="filter_invalid_to_error",
                        description="Filter invalid transaction type → error output",
                        type="filter",
                        source_inputs=filter_source,
                        logic={
                            "conditions": [
                                {"field": type_field, "operation": "not_in", "value": ["DR", "CR"]},
                            ],
                            "pyspark_equiv": "filter(~col('TXN_TYPE').isin('DR','CR')) → ERROUT",
                        },
                        output_alias=error_out,
                    )
                )

        join_match = self.JOIN_PATTERN.search(cobol_content)
        if join_match:
            left = join_match.group(1).replace("-", "_").upper()
            right = join_match.group(2).replace("-", "_").upper()
            left_key = join_match.group(3)
            right_key = join_match.group(4)
            left_dd = dd_map.get(left, left)
            right_dd = dd_map.get(right, right)
            if left_dd in input_names and right_dd in input_names:
                steps.append(
                    TransformationStep(
                        id="join_customer_trans",
                        description="Join on key",
                        type="join",
                        source_inputs=[left_dd, right_dd],
                        logic={
                            "left": left_dd,
                            "right": right_dd,
                            "on": [[left_key, right_key]],
                            "how": "inner",
                        },
                        output_alias="joined_data",
                    )
                )

        filter_cond = None
        filter_simple = self.FILTER_SIMPLE_PATTERN.search(cobol_content)
        if filter_simple:
            field = filter_simple.group(1)
            val = int(filter_simple.group(2))
            filter_cond = {"field": field, "operation": ">", "value": val}
        else:
            filter_match = self.FILTER_PATTERN.search(cobol_content)
            if filter_match:
                field = filter_match.group(1)
                op = filter_match.group(2).replace(" ", "_").upper()
                val = int(filter_match.group(3))
                if "GREATER" in op:
                    filter_cond = {"field": field, "operation": ">", "value": val}
                elif "LESS" in op:
                    filter_cond = {"field": field, "operation": "<", "value": val}
        if not filter_cond:
            for m in self.IF_GREATER_PATTERN.finditer(cobol_content):
                filter_cond = {
                    "field": m.group(1),
                    "operation": ">",
                    "value": int(m.group(2)),
                }
                break

        if filter_cond and output_names:
            join_step = next((s for s in steps if s.type == "join"), None)
            source = [join_step.output_alias] if (join_step and join_step.output_alias) else input_names
            report1 = next((o for o in output_names if "REPORT1" in o.upper() or "DTL" in o.upper()), output_names[0] if output_names else None)
            steps.append(
                TransformationStep(
                    id="filter_amount",
                    description=f"Filter: {filter_cond['field']} > {filter_cond['value']}",
                    type="filter",
                    source_inputs=source,
                    logic={"conditions": [filter_cond]},
                    output_alias=report1 or "REPORT1",
                )
            )

        agg_matches = list(self.AGGREGATE_GROUP_PATTERN.finditer(cobol_content))
        agg_match = None
        for m in reversed(agg_matches):
            if "SUM(" in m.group(0).upper() or "COUNT" in m.group(0).upper():
                agg_match = m
                break
        if not agg_match and agg_matches:
            agg_match = agg_matches[-1]
        if agg_match:
            group_field = agg_match.group(1)
            agg_part = agg_match.group(2)
            aggs: List[Dict[str, Any]] = []
            if "SUM(" in agg_part.upper():
                sum_m = re.search(r"SUM\(([\w\-]+)\)", agg_part, re.IGNORECASE)
                if sum_m:
                    aggs.append({"field": sum_m.group(1), "operation": "sum", "alias": f"SUM_{sum_m.group(1).replace('-', '_')}"})
            if "COUNT" in agg_part.upper():
                aggs.append({"field": "*", "operation": "count", "alias": "COUNT"})
            if not aggs:
                aggs = [
                    {"field": "TR_AMOUNT", "operation": "sum", "alias": "TOTAL_AMOUNT"},
                    {"field": "*", "operation": "count", "alias": "TXN_COUNT"},
                ]
            if output_names and len(output_names) >= 2:
                report2 = output_names[1] if len(output_names) > 1 else output_names[0]
                join_step = next((s for s in steps if s.type == "join"), None)
                agg_sources = [join_step.output_alias] if (join_step and join_step.output_alias) else input_names
                if join_step and join_step.output_alias and len(input_names) >= 3:
                    third = next((n for n in input_names if n not in (join_step.source_inputs or [])), None)
                    if third:
                        steps.append(
                            TransformationStep(
                                id="join_with_master",
                                description="Join with Master for region (Customer+Trans+Master)",
                                type="join",
                                source_inputs=[join_step.output_alias, third],
                                logic={"left": join_step.output_alias, "right": third, "on": [], "how": "inner"},
                                output_alias="joined_for_report2",
                            )
                        )
                        agg_sources = ["joined_for_report2"]
                steps.append(
                    TransformationStep(
                        id="aggregate_region",
                        description=f"Aggregate by {group_field}: SUM, COUNT",
                        type="aggregate",
                        source_inputs=agg_sources,
                        logic={"group_by": [group_field], "aggregations": aggs},
                        output_alias=report2,
                    )
                )

        # SUMMARY / executive summary: from global counters (WS-STATS), not from input files
        if len(output_names) >= 3:
            summary_out = output_names[2]
            is_summary = "SUMMARY" in (summary_out or "").upper()
            steps.append(
                TransformationStep(
                    id="exec_summary",
                    description="Global Summarization (WS-STATS: CUST-COUNT, TXN-COUNT, GRAND-TOTAL)"
                    if is_summary
                    else "Executive summary stats",
                    type="aggregate" if is_summary else "select",
                    source_inputs=[],  # SUMMARY comes from global counters, not from CUSTOMER/MASTER/TRANS
                    logic={
                        "note": "Global counters accumulated during run; CURRENT-DATE injected",
                        "pyspark_equiv": "single-row summary from driver",
                    }
                    if is_summary
                    else {"columns": ["*"], "note": "Totals"},
                    output_alias=summary_out,
                )
            )

        move_steps = self._extract_move_compute(cobol_content, input_names, output_names)
        report1_name = next((o for o in output_names if "REPORT1" in (o or "").upper() or "DTL" in (o or "").upper()), output_names[0] if output_names else None)
        report1_already_fed = any((s.output_alias or "").upper() == (report1_name or "").upper() for s in steps)
        # Do not add move/compute steps when we already have DR/CR aggregate (sum debit/credit); they would overwrite correct logic
        has_dr_cr_aggregate = any(s.id == "categorize_debit_credit" for s in steps)
        if move_steps and not any(s.type == "select" and "move" in s.description.lower() for s in steps) and not report1_already_fed and not has_dr_cr_aggregate:
            steps.extend(move_steps)

        sort_step = self._extract_sort_merge(cobol_content, input_names, output_names)
        if sort_step:
            steps.append(sort_step)

        # ELSE branch (when not already covered by DR/CR filter_invalid): MOVE 'INVALID...' TO ERROR-RECORD, WRITE ERROR-RECORD
        else_move = self.ELSE_ERROR_MOVE_PATTERN.search(cobol_content)
        write_error = self.WRITE_ERROR_REC_PATTERN.search(cobol_content)
        already_has_error_filter = any(s.id == "filter_invalid_to_error" for s in steps)
        if error_out and (else_move or write_error) and not already_has_error_filter:
            msg = else_move.group(1).strip() if else_move else "Invalid record"
            rec_name = (else_move.group(2) if else_move else (write_error.group(1) if write_error else "ERROR"))
            steps.append(
                TransformationStep(
                    id="error_branch",
                    description=f"Else: {msg} → error record (WRITE {rec_name})",
                    type="filter",
                    source_inputs=input_names,
                    logic={
                        "else_branch": True,
                        "error_message": msg,
                        "error_record": rec_name,
                        "reject_to": error_out,
                        "pyspark_equiv": "filter(valid) → main path; otherwise → error path",
                    },
                    output_alias=error_out,
                )
            )

        if not steps:
            return None
        return TransformationConfig(steps=steps)

    def _extract_move_compute(
        self,
        content: str,
        input_names: List[str],
        output_names: List[str],
    ) -> List[TransformationStep]:
        """Extract MOVE, ADD, COMPUTE as column expressions.
        Splits so that MOVE to SUM_* (summary output) is a separate step placed last."""
        steps: List[TransformationStep] = []
        expressions: List[dict] = []
        seen: set[str] = set()

        for m in self.COMPUTE_PATTERN.finditer(content):
            tgt = m.group(1)
            if tgt not in seen:
                seen.add(tgt)
                # Only replace hyphens inside COBOL identifiers (word-char on both sides),
                # not arithmetic minus operators (which have spaces around them).
                expr = re.sub(r'(?<=[A-Za-z0-9])-(?=[A-Za-z0-9])', '_', m.group(2)).strip()[:100]
                expressions.append({"target": tgt, "expression": expr, "operation": "compute"})

        for m in self.ADD_PATTERN.finditer(content):
            val = m.group(1)
            tgt = m.group(2)
            key = f"add_{tgt}_{val}"
            if key not in seen:
                seen.add(key)
                expressions.append({"target": tgt, "expression": f"{tgt} + {val}", "operation": "add"})

        for m in self.MOVE_LITERAL_PATTERN.finditer(content):
            raw_val = m.group(1).strip()
            tgt = m.group(2)
            key = f"move_{tgt}"
            if key not in seen:
                seen.add(key)
                if raw_val.lstrip("-").replace(".", "", 1).isdigit() and "." in raw_val:
                    try:
                        val = float(raw_val)
                    except ValueError:
                        val = raw_val
                elif raw_val.lstrip("-").isdigit():
                    val = int(raw_val)
                elif len(raw_val) >= 2 and raw_val[0] == raw_val[-1] and raw_val[0] in ("'", '"'):
                    val = raw_val[1:-1]
                else:
                    val = raw_val
                expressions.append({
                    "target": tgt,
                    "expression": raw_val,
                    "operation": "move",
                    "literal": True,
                    "value": val,
                })
        for m in self.MOVE_PATTERN.finditer(content):
            src = m.group(1)
            tgt = m.group(2)
            key = f"move_{tgt}"
            if key in seen:
                continue
            # Skip if source is a literal (numeric or quoted); already handled by MOVE_LITERAL_PATTERN
            s = m.group(1).strip()
            if s.lstrip("-").isdigit() or (len(s) >= 2 and s[0] in ("'", '"') and s[0] == s[-1]):
                continue
            seen.add(key)
            expressions.append({"target": tgt, "expression": src, "operation": "move"})

        if not expressions or not output_names or len(expressions) > 30:
            return steps

        # Bank batch: sum (MOVE WS-* TO SUM-*) is at end of process. Split into:
        # 1) accumulation (ADD/COMPUTE, MOVE to non-SUM targets), 2) summary (MOVE to SUM_*) last.
        summary_exprs = [e for e in expressions if e["target"].replace("-", "_").startswith("SUM_")]  # alias uses _
        accum_exprs = [e for e in expressions if e not in summary_exprs]

        summary_out = next(
            (o for o in output_names if "SUM" in (o or "").upper() or "REPORT" in (o or "").upper() or "SUMMARY" in (o or "").upper()),
            output_names[0] if output_names else None,
        )
        if summary_exprs and accum_exprs:
            # Step 1: accumulate (ADD/COMPUTE and non-SUM moves); output intermediate.
            # Working-storage targets from ADD (e.g. WS_DEBIT_TOTAL) are in-memory; framework treats missing as 0.
            add_targets = list({e["target"] for e in accum_exprs if (e.get("operation") or "").lower() == "add"})
            intermediate = "with_ws_totals"
            logic = {"expressions": accum_exprs[:20], "pyspark_equiv": "withColumn / select"}
            if add_targets:
                logic["working_storage"] = add_targets
            steps.append(
                TransformationStep(
                    id="accumulate_totals",
                    description=f"Accumulate: {len(accum_exprs)} ADD/COMPUTE/MOVE to working storage",
                    type="select",
                    source_inputs=input_names,
                    logic=logic,
                    output_alias=intermediate,
                )
            )
            # Step 2: write summary (MOVE to SUM_*) — last in process.
            steps.append(
                TransformationStep(
                    id="write_summary",
                    description="Write summary: MOVE WS totals to SUM output",
                    type="select",
                    source_inputs=[intermediate],
                    logic={"expressions": summary_exprs[:20], "pyspark_equiv": "select (summary output)"},
                    output_alias=summary_out,
                )
            )
        elif summary_exprs and not accum_exprs:
            steps.append(
                TransformationStep(
                    id="write_summary",
                    description="Write summary: MOVE to SUM output",
                    type="select",
                    source_inputs=input_names,
                    logic={"expressions": summary_exprs[:20], "pyspark_equiv": "select"},
                    output_alias=summary_out,
                )
            )
        else:
            steps.append(
                TransformationStep(
                    id="column_expressions",
                    description=f"Column mappings: {len(expressions)} MOVE/ADD/COMPUTE",
                    type="select",
                    source_inputs=input_names,
                    logic={"expressions": expressions[:20], "pyspark_equiv": "withColumn / select"},
                    output_alias=output_names[0] if output_names else None,
                )
            )
        return steps

    def _extract_sort_merge(
        self,
        content: str,
        input_names: List[str],
        output_names: List[str],
    ) -> Optional[TransformationStep]:
        """Extract SORT or MERGE as sort/union transformation."""
        sort_m = self.SORT_PATTERN.search(content)
        if sort_m:
            key = sort_m.group(2)
            desc = "SORT on key " + key
            if "SORTCNTL" in content.upper() or "SORT.CNTL" in content.upper():
                desc = "Sort by ID and sum packed-decimal fields (SORTCNTL)"
            return TransformationStep(
                id="sort",
                description=desc,
                type="custom",
                source_inputs=input_names,
                logic={
                    "operation": "sort",
                    "key": key,
                    "pyspark_equiv": "orderBy",
                    "note": "Utility sorts records by key; SORTCNTL can define SUM FIELDS for totals.",
                },
            )
        merge_m = self.MERGE_PATTERN.search(content)
        if merge_m:
            return TransformationStep(
                id="merge",
                description="MERGE files",
                type="union",
                source_inputs=input_names,
                logic={"on": merge_m.group(2), "pyspark_equiv": "unionByName"},
            )
        return None

    def extract_from_files(
        self,
        cobol_paths: List[Path],
        input_names: List[str],
        output_names: List[str],
    ) -> Optional[TransformationConfig]:
        """Extract transformations from COBOL file paths."""
        content = ""
        for path in cobol_paths or []:
            content += path.read_text(encoding="utf-8", errors="ignore") + "\n\n"
        if not content.strip():
            return None
        return self.extract_from_content(content, input_names, output_names)
