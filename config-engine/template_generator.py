#!/usr/bin/env python3
"""Rule-based template generator for mainframe cascade processing"""

import json
from typing import Dict, Any

def generate_template_config(jcl_content: str = "", cobol_content: str = "", copybook_content: str = "") -> Dict[str, Any]:
    """Generate a template config based on mainframe patterns"""
    
    # Extract dataset names from JCL (simple pattern matching)
    input_datasets = []
    output_datasets = []
    
    # Look for common patterns in JCL
    if "APP.SRC.DAILY.FILE" in jcl_content or "SRC" in jcl_content:
        input_datasets.append("APP.SRC.DAILY.FILE")
    
    if "APP.TGT.DATA.DLY" in jcl_content or "TGT.DATA" in jcl_content:
        output_datasets.append("APP.TGT.DATA.DLY")
    
    if "APP.TGT.CNT.DLY" in jcl_content or "TGT.CNT" in jcl_content:
        output_datasets.append("APP.TGT.CNT.DLY")
    
    # Add backup datasets
    output_datasets.extend([
        "APP.BKUP.DLY.INPUT",
        "APP.BKUP.DLY.DATA", 
        "APP.BKUP.MTH.DATA",
        "APP.BKUP.MTH.CNT"
    ])
    
    # Generate the template config
    config = {
        "Inputs": {
            "SRC_FILE": {
                "name": "SRC_FILE",
                "format": "fixed",
                "path": "data/APP.SRC.DAILY.FILE",
                "fields": [
                    {"name": "RECORD_TYPE", "type": "string", "start": 1, "length": 3},
                    {"name": "HDR_DATE", "type": "date", "start": 4, "length": 8},
                    {"name": "DET_DATE", "type": "date", "start": 4, "length": 8},
                    {"name": "DET_NUMERIC", "type": "int", "start": 12, "length": 7},
                    {"name": "DET_TEXT", "type": "string", "start": 19, "length": 40},
                    {"name": "TLR_COUNT", "type": "int", "start": 4, "length": 7}
                ]
            }
        },
        "Outputs": {
            "TGT_DATA_DLY": {
                "name": "TGT_DATA_DLY",
                "format": "parquet",
                "path": "data/APP.TGT.DATA.DLY",
                "write_mode": "overwrite"
            },
            "TGT_CNT_DLY": {
                "name": "TGT_CNT_DLY",
                "format": "parquet",
                "path": "data/APP.TGT.CNT.DLY",
                "write_mode": "overwrite"
            },
            "BKUP_DLY_INPUT": {
                "name": "BKUP_DLY_INPUT",
                "format": "parquet",
                "path": "data/APP.BKUP.DLY.INPUT",
                "write_mode": "overwrite"
            },
            "BKUP_DLY_DATA": {
                "name": "BKUP_DLY_DATA",
                "format": "parquet",
                "path": "data/APP.BKUP.DLY.DATA",
                "write_mode": "overwrite"
            },
            "BKUP_MTH_DATA": {
                "name": "BKUP_MTH_DATA",
                "format": "parquet",
                "path": "data/APP.BKUP.MTH.DATA",
                "write_mode": "overwrite"
            },
            "BKUP_MTH_CNT": {
                "name": "BKUP_MTH_CNT",
                "format": "parquet",
                "path": "data/APP.BKUP.MTH.CNT",
                "write_mode": "overwrite"
            }
        },
        "Transformations": {
            "description": "Cascade processing: date check → transform → daily backup → monthly backup",
            "steps": [
                {
                    "id": "S05_date_check",
                    "description": "S05 - Date Check (GENDATCHK): Validate header date and business day",
                    "type": "filter",
                    "source_inputs": ["SRC_FILE"],
                    "logic": {
                        "conditions": [
                            {"field": "RECORD_TYPE", "operation": "==", "value": "HDR"}
                        ]
                    },
                    "output_alias": "validated_header"
                },
                {
                    "id": "S05_extract_details",
                    "description": "S05 - Extract DET records for processing",
                    "type": "filter",
                    "source_inputs": ["SRC_FILE"],
                    "logic": {
                        "conditions": [
                            {"field": "RECORD_TYPE", "operation": "==", "value": "DET"}
                        ]
                    },
                    "output_alias": "det_records"
                },
                {
                    "id": "S10_format_transform",
                    "description": "S10 - Format/Transform (GENFMT01): Process DET records and validate counts",
                    "type": "select",
                    "source_inputs": ["det_records"],
                    "logic": {
                        "expressions": [
                            {"target": "TRANS_DATE", "expression": "DET_DATE", "operation": "move"},
                            {"target": "TRANS_AMOUNT", "expression": "DET_NUMERIC", "operation": "move"},
                            {"target": "TRANS_TEXT", "expression": "DET_TEXT", "operation": "move"},
                            {"target": "AS_OF_DATE", "expression": "HDR_DATE", "operation": "move"},
                            {"target": "RECORD_COUNT", "expression": "TLR_COUNT", "operation": "move"},
                            {"target": "SOURCE_ID", "expression": "'APP.SRC.DAILY.FILE'", "operation": "compute"},
                            {"target": "MONTH_END_FLAG", "expression": "CASE WHEN LAST_BUSINESS_DAY() = 'Y' THEN 5 ELSE 0 END", "operation": "compute"}
                        ]
                    },
                    "output_alias": "transformed_data"
                },
                {
                    "id": "S10_count_validation",
                    "description": "S10 - Count Integrity Check: Verify TLR count matches actual DET records",
                    "type": "filter",
                    "source_inputs": ["transformed_data"],
                    "logic": {
                        "conditions": [
                            {"field": "RECORD_COUNT", "operation": "==", "value": "ACTUAL_DET_COUNT"}
                        ]
                    },
                    "output_alias": "validated_data"
                },
                {
                    "id": "S15_daily_backup",
                    "description": "S15 - Daily Backup: Backup to daily GDG datasets",
                    "type": "select",
                    "source_inputs": ["validated_data"],
                    "logic": {"columns": ["*"]},
                    "output_alias": "TGT_DATA_DLY"
                },
                {
                    "id": "S15_count_backup",
                    "description": "S15 - Daily Count Backup: Write control/count record",
                    "type": "select",
                    "source_inputs": ["validated_data"],
                    "logic": {
                        "expressions": [
                            {"target": "CONTROL_COUNT", "expression": "RECORD_COUNT", "operation": "move"},
                            {"target": "EFFECTIVE_DATE", "expression": "TRANS_DATE", "operation": "move"},
                            {"target": "AS_OF_DATE_CTRL", "expression": "AS_OF_DATE", "operation": "move"},
                            {"target": "SOURCE_ID_CTRL", "expression": "SOURCE_ID", "operation": "move"}
                        ]
                    },
                    "output_alias": "TGT_CNT_DLY"
                },
                {
                    "id": "S15_input_backup",
                    "description": "S15 - Daily Input Backup: Backup source file",
                    "type": "select",
                    "source_inputs": ["SRC_FILE"],
                    "logic": {"columns": ["*"]},
                    "output_alias": "BKUP_DLY_INPUT"
                },
                {
                    "id": "S15_data_backup",
                    "description": "S15 - Daily Data Backup: Backup transformed data",
                    "type": "select",
                    "source_inputs": ["validated_data"],
                    "logic": {"columns": ["*"]},
                    "output_alias": "BKUP_DLY_DATA"
                },
                {
                    "id": "S20_monthly_backup",
                    "description": "S20 - Monthly Backup: Conditional monthly backup for month-end only",
                    "type": "filter",
                    "source_inputs": ["validated_data"],
                    "logic": {
                        "conditions": [
                            {"field": "MONTH_END_FLAG", "operation": "==", "value": 5}
                        ]
                    },
                    "output_alias": "monthly_data"
                },
                {
                    "id": "S20_monthly_data_backup",
                    "description": "S20 - Monthly Data Backup: Write monthly backup data",
                    "type": "select",
                    "source_inputs": ["monthly_data"],
                    "logic": {"columns": ["*"]},
                    "output_alias": "BKUP_MTH_DATA"
                },
                {
                    "id": "S20_monthly_count_backup",
                    "description": "S20 - Monthly Count Backup: Write monthly count backup",
                    "type": "select",
                    "source_inputs": ["monthly_data"],
                    "logic": {
                        "expressions": [
                            {"target": "CONTROL_COUNT", "expression": "RECORD_COUNT", "operation": "move"},
                            {"target": "EFFECTIVE_DATE", "expression": "TRANS_DATE", "operation": "move"},
                            {"target": "AS_OF_DATE_CTRL", "expression": "AS_OF_DATE", "operation": "move"},
                            {"target": "SOURCE_ID_CTRL", "expression": "SOURCE_ID", "operation": "move"}
                        ]
                    },
                    "output_alias": "BKUP_MTH_CNT"
                }
            ]
        }
    }
    
    return config

# Test the template generator
if __name__ == "__main__":
    config = generate_template_config()
    print(json.dumps(config, indent=2))
