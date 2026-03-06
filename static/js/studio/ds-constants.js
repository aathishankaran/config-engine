/**
 * ds-constants.js — All constants for Dataflow Studio.
 * Depends: ds-namespace.js
 */
(function(DS) {
"use strict";

var C = DS.C;

C.GRID = 20;
C.NODE_W = 190;
C.NODE_H = 97;
C.MIN_ZOOM = 0.25;
C.MAX_ZOOM = 2.5;
C.ELBOW_GAP = 30;

C.TYPE_ICONS = {
  input: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  output:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  select:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  filter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
  join:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/></svg>',
  aggregate:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4H6l6 8-6 8h12"/></svg>',
  union: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  custom:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14M12 2v2M12 20v2"/></svg>',
  validate:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
  oracle_write:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><polyline points="8 14 12 18 16 14"/></svg>'
};

C.TYPE_META = {
  input:     { label: 'Input',     color: '#16a34a' },
  output:    { label: 'Output',    color: '#d97706' },
  select:    { label: 'Mapping', color: '#2563eb' },
  filter:    { label: 'Filter',    color: '#7c3aed' },
  join:      { label: 'Join',      color: '#0891b2' },
  aggregate: { label: 'Aggregate', color: '#dc2626' },
  union:     { label: 'Union',     color: '#0284c7' },
  custom:    { label: 'Custom',    color: '#64748b' },
  validate:      { label: 'Data Validation', color: '#0d9488' },
  oracle_write:  { label: 'Oracle Write', color: '#c2410c' }
};

C.SELECT_OPS      = ['MOVE','ADD','SUBTRACT','MULTIPLY','DIVIDE','COMPUTE','INITIALIZE','STRING','UNSTRING','INSPECT'];
C.FILTER_OPS      = ['==','!=','>','<','>=','<=','IN','NOT_IN'];
C.JOIN_TYPES      = ['INNER','LEFT','RIGHT','FULL'];
C.AGG_OPS         = ['SUM','COUNT','AVG','MIN','MAX'];
C.FORMATS_IN      = ['FIXED','CSV','PARQUET','DELIMITED'];
C.FORMATS_OUT     = ['FIXED','PARQUET','CSV','DELIMITED'];
C.WRITE_MODES     = ['OVERWRITE','APPEND'];
C.FIELD_TYPES     = ['STRING','INT','LONG','DOUBLE','DECIMAL','DATE','TIMESTAMP'];
C.FREQUENCIES     = ['DAILY','WEEKLY','MONTHLY'];
C.FORMAT_LABELS   = { 'FIXED': 'FIXED WIDTH', 'DELIMITED': 'DELIMITED', 'CSV': 'CSV', 'PARQUET': 'PARQUET' };
C.PARTITION_COL_OPTIONS = [
  { value: 'load_date()',                               label: 'load_date()  \u2192  curr_date()  (e.g. 20260301)'   },
  { value: 'current_date()',                            label: 'current_date()  \u2192  2026-03-01'                   },
  { value: 'date_sub(current_date(), 1)',               label: 'Yesterday  \u2192  date_sub(current_date(), 1)'       },
  { value: "date_format(current_date(), 'MM-dd-yyyy')", label: "Custom format  \u2192  03-01-2026"                    },
  { value: 'last_day(current_date())',                  label: 'Last day of month  \u2192  2026-03-31'                },
];
C.VALIDATE_DTYPES = ['TEXT','NUMBER','DATE','TIMESTAMP'];
C.VALIDATE_FMTS   = ['ANY','ALPHA','NUMERIC','ALPHANUMERIC','DATE','EMAIL','REGEX'];
C.FAIL_MODES      = ['FLAG','DROP','ABORT'];
C.ORACLE_LOAD_MODES = ['INSERT','APPEND','TRUNCATE_INSERT','REPLACE'];

/* ── Path preview helpers ─────────────────────────────────────── */
DS.fn._buildPathPreview = function(bucketPrefix, interfaceName, frequency, datasetName) {
  var parts = [bucketPrefix || '<bucket>'];
  if (parts[0].endsWith('/')) parts[0] = parts[0].slice(0, -1);
  parts.push(interfaceName || '<interface>');
  parts.push(frequency || '<frequency>');
  parts.push('YYYYMMDD');
  parts.push(datasetName || '<dataset-name>');
  return parts.join('/');
};
DS.fn._getInterfaceName = function() {
  var $el = $('#current-file');
  var name = $el.length ? $el.text().trim() : '';
  if (!name || name === 'Select an interface') return '';
  return name.replace(/\.json$/i, '');
};
DS.fn._pathInfoBannerHtml = function(id, bucketPrefix, frequency, datasetName, label) {
  var preview = DS.fn._buildPathPreview(bucketPrefix, DS.fn._getInterfaceName(), frequency, datasetName);
  return '<div class="path-info-banner" id="' + id + '">' +
    '<i class="fa-solid fa-circle-info"></i> ' +
    (label ? label + ' ' : '') +
    'Files will be processed as: <code>' + DS.fn.esc(preview) + '</code>' +
  '</div>';
};

})(window.DS);
