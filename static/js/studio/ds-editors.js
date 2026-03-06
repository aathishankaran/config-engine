(function(DS) {
  "use strict";
  var C = DS.C, S = DS.S;

/* ---- selectOpts helper ---- */
function selectOpts(options, selected, extraAttrs) {
  var html = '<select ' + (extraAttrs||'') + '>';
  options.forEach(function(o){ html += '<option value="' + DS.fn.esc(o) + '"' + (o===selected?' selected':'') + '>' + DS.fn.esc(o) + '</option>'; });
  html += '</select>';
  return html;
}

/* ---- Fields editor ---- */
function buildFieldsEditor(ns, fields) {
  var rows = fields.map(function(f, i) {
    var curType = (f.type || 'STRING').toUpperCase();
    var isNullable = f.nullable !== false;
    var fmt = f.format || '';
    return '<div class="list-item">' +
      '<div class="list-item-inputs">' +
        '<input type="text" placeholder="Field name" value="' + DS.fn.esc(f.name||'') + '" data-field="name" data-idx="' + i + '" class="lci-name" title="Field name" />' +
        selectOpts(C.FIELD_TYPES, curType, 'data-field="type" data-idx="' + i + '" class="lci-type" title="Data type"') +
        '<label class="lci-null-wrap" title="Nullable (allow nulls)">' +
          '<input type="checkbox" data-field="nullable" data-idx="' + i + '" class="lci-nullable"' + (isNullable ? ' checked' : '') + ' />' +
          '<span class="lci-null-lbl">Null</span>' +
        '</label>' +
        '<input type="text" placeholder="fmt" value="' + DS.fn.esc(fmt) + '" data-field="format" data-idx="' + i + '" class="lci-fmt" title="Format pattern (e.g. yyyy-MM-dd)" />' +
        '<input type="number" placeholder="1" value="' + DS.fn.esc(f.start||'') + '" data-field="start" data-idx="' + i + '" class="lci-start" title="Start position (1-based)" />' +
        '<input type="number" placeholder="0" value="' + DS.fn.esc(f.length||'') + '" data-field="length" data-idx="' + i + '" class="lci-len" title="Field length in characters" />' +
      '</div>' +
      '<div class="list-item-actions">' +
        '<button class="list-item-up" data-ns="' + ns + '" data-idx="' + i + '" title="Move up"' + (i === 0 ? ' disabled' : '') + '>\u2191</button>' +
        '<button class="list-item-down" data-ns="' + ns + '" data-idx="' + i + '" title="Move down"' + (i === fields.length - 1 ? ' disabled' : '') + '>\u2193</button>' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove field">\xd7</button>' +
      '</div>' +
    '</div>';
  }).join('');
  return '<div class="list-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header"><span>Fields (' + fields.length + ')</span></div>' +
    '<div class="list-editor-col-header">' +
      '<span class="lch-name">Name</span>' +
      '<span class="lch-type">Type</span>' +
      '<span class="lch-null">Null</span>' +
      '<span class="lch-fmt">Format</span>' +
      '<span class="lch-start">Start</span>' +
      '<span class="lch-len">Length</span>' +
      '<span class="lch-del"></span>' +
    '</div>' +
    '<div class="list-editor-items">' + rows + '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-field" title="Add a new field definition">+ Add Field</button>' +
  '</div>';
}

/* ---- Click-to-edit Fields editor ---- */
/* sourceMap (optional): { fieldName: { source: upstreamName, score: 0-1, exact: bool } } */
function buildClickToEditFieldsEditor(ns, fields, headerBtns, sourceMap) {
  var hasSrcMap = !!(sourceMap && Object.keys(sourceMap).length);
  var rows = fields.map(function(f, i) {
    var curType = (f.type || 'STRING').toUpperCase();
    var isNullable = f.nullable !== false;
    var fmt = f.format || '';

    var srcCell = '';
    if (hasSrcMap) {
      var sm = sourceMap[f.name || ''];
      if (sm) {
        var cls   = sm.exact ? 'src-match-exact' : 'src-match-fuzzy';
        var badge = sm.exact ? '' : '<span class="src-match-badge">' + Math.round(sm.score * 100) + '%</span>';
        srcCell = '<td class="cte-cell cte-cell-src"><span class="' + cls + '">' + DS.fn.esc(sm.source) + badge + '</span></td>';
      } else {
        srcCell = '<td class="cte-cell cte-cell-src"><span class="src-match-none">\u2014</span></td>';
      }
    }

    return '<tr class="list-item cte-row">' +
      '<td class="cte-cell" data-field="name" data-idx="' + i + '">' +
        '<input type="hidden" data-field="name" data-idx="' + i + '" value="' + DS.fn.esc(f.name||'') + '" />' +
        '<span class="cte-display">' + DS.fn.esc(f.name||'') + '</span>' +
      '</td>' +
      '<td class="cte-cell" data-field="type" data-idx="' + i + '">' +
        '<input type="hidden" data-field="type" data-idx="' + i + '" value="' + DS.fn.esc(curType) + '" />' +
        '<span class="cte-display">' + DS.fn.esc(curType) + '</span>' +
      '</td>' +
      '<td class="cte-cell cte-check-cell" data-field="nullable" data-idx="' + i + '">' +
        '<input type="checkbox" data-field="nullable" data-idx="' + i + '" class="lci-nullable"' + (isNullable ? ' checked' : '') + ' />' +
      '</td>' +
      '<td class="cte-cell" data-field="format" data-idx="' + i + '">' +
        '<input type="hidden" data-field="format" data-idx="' + i + '" value="' + DS.fn.esc(fmt) + '" />' +
        '<span class="cte-display">' + DS.fn.esc(fmt || '\u2014') + '</span>' +
      '</td>' +
      '<td class="cte-cell" data-field="start" data-idx="' + i + '">' +
        '<input type="hidden" data-field="start" data-idx="' + i + '" value="' + DS.fn.esc(f.start||'') + '" />' +
        '<span class="cte-display">' + DS.fn.esc(f.start||'') + '</span>' +
      '</td>' +
      '<td class="cte-cell" data-field="length" data-idx="' + i + '">' +
        '<input type="hidden" data-field="length" data-idx="' + i + '" value="' + DS.fn.esc(f.length||'') + '" />' +
        '<span class="cte-display">' + DS.fn.esc(f.length||'') + '</span>' +
      '</td>' +
      srcCell +
      '<td class="cte-action-cell">' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove field">\xd7</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  var srcHeader = hasSrcMap ? '<th class="cte-th-src">Source</th>' : '';

  return '<div class="list-editor cte-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header">' +
      '<span>Fields (' + fields.length + ')</span>' +
      (headerBtns ? '<span class="tbl-hdr-btn-group">' + headerBtns + '</span>' : '') +
    '</div>' +
    '<div class="cte-table-wrap">' +
      '<table class="cte-table' + (hasSrcMap ? ' cte-table-has-src' : '') + '">' +
        '<thead><tr>' +
          '<th class="cte-th-name">Name</th>' +
          '<th class="cte-th-type">Type</th>' +
          '<th class="cte-th-null">Null</th>' +
          '<th class="cte-th-fmt">Format</th>' +
          '<th class="cte-th-start">Start</th>' +
          '<th class="cte-th-len">Length</th>' +
          srcHeader +
          '<th class="cte-th-del"></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-field" title="Add a new field definition">+ Add Field</button>' +
  '</div>';
}

/* ---- Table-based Validation rules editor ---- */
function buildTableValidationRulesEditor(ns, rules, headerBtns) {
  var rows = rules.map(function(r, i) {
    return '<tr class="validate-rule-item vr-tbl-row">' +
      '<td>' +
        '<input type="text" placeholder="Field name" value="' + DS.fn.esc(r.field||'') + '" data-field="field" data-idx="' + i + '" class="vr-field vr-tbl-input" title="Column name to validate" />' +
      '</td>' +
      '<td>' +
        '<select data-field="data_type" data-idx="' + i + '" class="vr-dtype vr-tbl-sel">' +
          C.VALIDATE_DTYPES.map(function(d){ return '<option value="' + d + '"' + (d === (r.data_type||'TEXT') ? ' selected':'') + '>' + d + '</option>'; }).join('') +
        '</select>' +
      '</td>' +
      '<td class="vr-tbl-check">' +
        '<input type="checkbox" data-field="null_check" data-idx="' + i + '" class="vr-null-check"' + (r.nullable === false ? ' checked' : '') + ' />' +
      '</td>' +
      '<td>' +
        '<input type="number" placeholder="\u2014" value="' + DS.fn.esc(r.max_length||'') + '" data-field="max_length" data-idx="' + i + '" class="vr-maxlen vr-tbl-input" title="Max length" />' +
      '</td>' +
      '<td>' +
        '<select data-field="format" data-idx="' + i + '" class="vr-fmt vr-tbl-sel">' +
          C.VALIDATE_FMTS.map(function(f2){ return '<option value="' + f2 + '"' + (f2 === (r.format||'ANY') ? ' selected':'') + '>' + f2 + '</option>'; }).join('') +
        '</select>' +
      '</td>' +
      '<td class="vr-tbl-del">' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove rule">\xd7</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  return '<div class="list-editor vr-table-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header">' +
      '<span>Rules (' + rules.length + ')</span>' +
      (headerBtns ? '<span class="tbl-hdr-btn-group">' + headerBtns + '</span>' : '') +
    '</div>' +
    '<div class="vr-table-wrap">' +
      '<table class="vr-table">' +
        '<thead><tr>' +
          '<th>Field</th>' +
          '<th>Type</th>' +
          '<th>Null Check</th>' +
          '<th>Max Len</th>' +
          '<th>Format</th>' +
          '<th></th>' +
        '</tr></thead>' +
        '<tbody class="vr-cards-list">' + rows + '</tbody>' +
      '</table>' +
    '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-rule" title="Add a new validation rule">+ Add Rule</button>' +
  '</div>';
}

/* ---- Validation rules editor (legacy card-based) ---- */
function buildValidationRulesEditor(ns, rules) {
  var cards = rules.map(function(r, i) {
    return '<div class="vr-card validate-rule-item">' +
      '<button class="vr-card-remove list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove rule">\xd7</button>' +
      '<div class="vr-card-row">' +
        '<input type="text" placeholder="Field name" value="' + DS.fn.esc(r.field||'') + '" data-field="field" data-idx="' + i + '" class="vr-field" title="Column name to validate" />' +
        selectOpts(C.VALIDATE_DTYPES, r.data_type||'TEXT', 'data-field="data_type" data-idx="' + i + '" class="vr-dtype" title="Expected data type"') +
        '<label class="vr-nullable-wrap" title="Check = fail validation if null found">' +
          '<input type="checkbox" data-field="null_check" data-idx="' + i + '" class="vr-null-check"' + (r.nullable === false ? ' checked' : '') + ' />' +
          '<span>Null Check</span>' +
        '</label>' +
      '</div>' +
      '<div class="vr-card-row vr-card-row2">' +
        '<label class="vr-sub-lbl">Max Len</label>' +
        '<input type="number" placeholder="\u2014" value="' + DS.fn.esc(r.max_length||'') + '" data-field="max_length" data-idx="' + i + '" class="vr-maxlen" title="Maximum character length (blank = no check)" />' +
        '<label class="vr-sub-lbl">Format</label>' +
        selectOpts(C.VALIDATE_FMTS, r.format||'ANY', 'data-field="format" data-idx="' + i + '" class="vr-fmt" title="Value format check"') +
      '</div>' +
    '</div>';
  }).join('');

  return '<div class="list-editor vr-cards-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header">' +
      '<span>Rules (' + rules.length + ')</span>' +
    '</div>' +
    '<div class="vr-cards-list">' + cards + '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-rule" title="Add a new validation rule">+ Add Rule</button>' +
  '</div>';
}

/* ---- Control file fields editor ---- */
var _CF_EXPR_POPUP_HTML =
  '<div class="cf-expr-popup" id="cf-expr-popup">' +
    '<div class="cf-expr-popup-title">Supported Expressions</div>' +

    '<div class="cf-expr-section">' +
      '<div class="cf-expr-section-label">Aggregations (operate on all rows)</div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">count(*)</span><span class="cf-expr-desc">Total number of rows</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">sum(amount)</span><span class="cf-expr-desc">Sum of a numeric column</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">max(load_date)</span><span class="cf-expr-desc">Maximum value in a column</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">min(load_date)</span><span class="cf-expr-desc">Minimum value in a column</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">avg(balance)</span><span class="cf-expr-desc">Average of a numeric column</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">count(distinct acct_id)</span><span class="cf-expr-desc">Count of unique values</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">sum(case when status=\'E\' then 1 else 0 end)</span><span class="cf-expr-desc">Conditional count</span></div>' +
    '</div>' +

    '<div class="cf-expr-section">' +
      '<div class="cf-expr-section-label">Date &amp; Time (scalar)</div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">current_date()</span><span class="cf-expr-desc">Today\'s date</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">current_timestamp()</span><span class="cf-expr-desc">Current date and time</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">date_format(current_date(),\'yyyyMMdd\')</span><span class="cf-expr-desc">Formatted date string</span></div>' +
    '</div>' +

    '<div class="cf-expr-section">' +
      '<div class="cf-expr-section-label">Literals &amp; Casts</div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">\'USB.HOGAN.FILE.DAT\'</span><span class="cf-expr-desc">Hard-coded string</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">42</span><span class="cf-expr-desc">Hard-coded integer</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">cast(count(*) as string)</span><span class="cf-expr-desc">Count as string</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">cast(null as string)</span><span class="cf-expr-desc">Empty / null value</span></div>' +
      '<div class="cf-expr-row"><span class="cf-expr-code">lpad(cast(count(*) as string),10,\'0\')</span><span class="cf-expr-desc">Zero-padded count</span></div>' +
    '</div>' +

    '<div class="cf-expr-default-note">' +
      '<strong>Default (when left blank):</strong><br>' +
      'LONG / INT fields &rarr; <span style="font-family:monospace;font-size:10.5px;color:#93c5fd">count(*)</span><br>' +
      'STRING fields &rarr; <span style="font-family:monospace;font-size:10.5px;color:#93c5fd">cast(null as string)</span>' +
    '</div>' +
  '</div>';

/* Preset expressions for control file / header / trailer fields */
var _CF_EXPR_PRESETS = [
  { value: '',                                          label: '-- Select expression --' },
  { value: 'count(*)',                                  label: 'count(*) \u2014 row count' },
  { value: 'sum(amount)',                               label: 'sum(col) \u2014 sum of column' },
  { value: 'max(load_date)',                            label: 'max(col) \u2014 max value' },
  { value: 'min(load_date)',                            label: 'min(col) \u2014 min value' },
  { value: 'current_date()',                            label: 'current_date() \u2014 today\'s date' },
  { value: 'current_timestamp()',                       label: 'current_timestamp() \u2014 now' },
  { value: "date_format(current_date(),'yyyyMMdd')",    label: 'date_format \u2014 formatted date' },
  { value: 'lpad(cast(count(*) as string),10,\'0\')',   label: 'lpad count \u2014 zero-padded count' },
  { value: '__literal__',                               label: '\u270f\ufe0f Hardcoded value...' },
  { value: '__custom__',                                label: '\u2699\ufe0f Custom expression...' }
];

function _buildCfExprCell(expr, i) {
  /* Determine which preset matches, or literal/custom */
  var presetValues = _CF_EXPR_PRESETS.map(function(p){ return p.value; }).filter(function(v){ return v && v !== '__literal__' && v !== '__custom__'; });
  var isLiteral = expr && /^'.*'$/.test(expr.trim());
  var isPreset  = presetValues.indexOf(expr) >= 0;
  var selVal    = isPreset ? expr : (isLiteral ? '__literal__' : (expr ? '__custom__' : ''));
  var literalVal = isLiteral ? expr.slice(1, -1) : '';
  var customVal  = (!isPreset && !isLiteral && expr) ? expr : '';

  var opts = _CF_EXPR_PRESETS.map(function(p) {
    return '<option value="' + DS.fn.esc(p.value) + '"' + (p.value === selVal ? ' selected' : '') + '>' + p.label + '</option>';
  }).join('');

  return '<div class="cf-expr-wrap">' +
    '<select class="cf-expr-select" data-field="expression" data-idx="' + i + '">' + opts + '</select>' +
    '<input type="text" class="cf-expr-literal" placeholder="Hardcoded value (no quotes needed)" ' +
      'style="' + (selVal === '__literal__' ? '' : 'display:none;') + '" ' +
      'value="' + DS.fn.esc(literalVal) + '" />' +
    '<input type="text" class="cf-expr-custom" placeholder="PySpark expression" ' +
      'style="' + (selVal === '__custom__' ? '' : 'display:none;') + '" ' +
      'value="' + DS.fn.esc(customVal) + '" />' +
  '</div>';
}

function buildControlFileFieldsEditor(ns, fields, headerBtns) {
  var rows = (fields || []).map(function(f, i) {
    var curType = (f.type || 'STRING').toUpperCase();
    return '<div class="list-item cf-field-item">' +
      '<div class="list-item-inputs cf-field-inputs">' +
        '<input type="text" placeholder="Field name" value="' + DS.fn.esc(f.name||'') + '" data-field="name" data-idx="' + i + '" class="cf-name" title="Control file field name" />' +
        selectOpts(C.FIELD_TYPES, curType, 'data-field="type" data-idx="' + i + '" class="cf-type" title="Data type"') +
        _buildCfExprCell(f.expression || '', i) +
      '</div>' +
      '<div class="list-item-actions">' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove field">\xd7</button>' +
      '</div>' +
    '</div>';
  }).join('');
  return '<div class="list-editor cf-fields-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header"><span>Fields (' + (fields||[]).length + ')</span>' + (headerBtns ? '<span class="tbl-hdr-btn-group">' + headerBtns + '</span>' : '') + '</div>' +
    '<div class="list-editor-col-header cf-col-header">' +
      '<span class="cf-ch-name">Name</span>' +
      '<span class="cf-ch-type">Type</span>' +
      '<span class="cf-ch-expr">Expression ' +
        '<button type="button" class="cf-expr-info-btn" id="cf-expr-info-btn" title="View supported expressions">i</button>' +
        _CF_EXPR_POPUP_HTML +
      '</span>' +
      '<span class="cf-ch-del"></span>' +
    '</div>' +
    '<div class="list-editor-items" id="' + ns + '-items">' + rows + '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-cf-field" title="Add a new control file field">+ Add Field</button>' +
  '</div>';
}

/* ---- Select expressions editor ---- */
function buildSelectExpressionsEditor(ns, exprs, node) {
  var dlId = ns + '-dl';
  var dlHints = [];
  if (node) {
    S.connections.forEach(function(c) {
      if (c.from === node.id) {
        var dn = DS.fn.getNode(c.to);
        if (dn && Array.isArray(dn.fields)) {
          dn.fields.forEach(function(f) { if (f.name && dlHints.indexOf(f.name) < 0) dlHints.push(f.name); });
        }
      }
    });
    (node.source_inputs || []).forEach(function(alias) {
      DS.fn.getFieldsForAlias(alias).forEach(function(f) { if (f.name && dlHints.indexOf(f.name) < 0) dlHints.push(f.name); });
    });
  }
  var datalist = dlHints.length
    ? '<datalist id="' + dlId + '">' + dlHints.map(function(h){ return '<option value="' + DS.fn.esc(h) + '">'; }).join('') + '</datalist>'
    : '';

  var cards = exprs.map(function(ex, i) {
    return '<div class="vr-card se-card select-expr-item">' +
      '<button class="vr-card-remove list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove expression">\xd7</button>' +
      '<div class="vr-card-row">' +
        '<label class="se-lbl">Expression</label>' +
        '<input type="text" class="se-expression" placeholder="Source column / expression" ' +
          'value="' + DS.fn.esc(ex.expression||'') + '" data-field="expression" data-idx="' + i + '" ' +
          (dlHints.length ? 'list="' + dlId + '"' : '') + ' title="Source column name or formula" />' +
      '</div>' +
      '<div class="vr-card-row">' +
        '<label class="se-lbl">Target</label>' +
        '<input type="text" class="se-target" placeholder="Output column name" ' +
          'value="' + DS.fn.esc(ex.target||'') + '" data-field="target" data-idx="' + i + '" ' +
          (dlHints.length ? 'list="' + dlId + '"' : '') + ' title="Target column name in output" />' +
      '</div>' +
      '<div class="vr-card-row">' +
        '<label class="se-lbl">Operation</label>' +
        selectOpts(C.SELECT_OPS, ex.operation||'MOVE', 'data-field="operation" data-idx="' + i + '" class="se-operation"') +
      '</div>' +
    '</div>';
  }).join('');

  return datalist +
    '<div class="list-editor vr-cards-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header">' +
        '<span>Expressions (' + exprs.length + ')</span>' +
        '<span style="font-size:10px;color:#94a3b8">Expression \u2192 Target via Operation</span>' +
      '</div>' +
      '<div class="vr-cards-list se-cards-list">' + cards + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-expr" title="Add a new column expression / mapping">+ Add Expression</button>' +
    '</div>';
}

/* ---- Filter conditions editor ---- */
function buildFilterConditionsEditor(ns, conds) {
  var rows = conds.map(function(c, i) {
    return '<div class="list-item">' +
      '<div class="list-item-inputs">' +
        '<input type="text" placeholder="Field" value="' + DS.fn.esc(c.field||'') + '" data-field="field" data-idx="' + i + '" />' +
        selectOpts(C.FILTER_OPS, c.operation||'==', 'data-field="operation" data-idx="' + i + '"') +
        '<input type="text" placeholder="Value" value="' + DS.fn.esc(c.value !== undefined ? String(c.value) : '') + '" data-field="value" data-idx="' + i + '" />' +
      '</div>' +
      '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">\xd7</button>' +
    '</div>';
  }).join('');
  return '<div class="list-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header"><span>Conditions (' + conds.length + ')</span><span style="font-size:10px;color:#94a3b8">Field | Op | Value</span></div>' +
    '<div class="list-editor-items">' + rows + '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-cond" title="Add a new filter condition">+ Add Condition</button>' +
  '</div>';
}

/* ---- Join keys editor ---- */
function buildJoinKeysEditor(ns, keys) {
  var rows = keys.map(function(k, i) {
    return '<div class="list-item">' +
      '<div class="list-item-inputs">' +
        '<input type="text" placeholder="Left col" value="' + DS.fn.esc(k.left||'') + '" data-field="left" data-idx="' + i + '" />' +
        '<input type="text" placeholder="Right col" value="' + DS.fn.esc(k.right||'') + '" data-field="right" data-idx="' + i + '" />' +
      '</div>' +
      '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">\xd7</button>' +
    '</div>';
  }).join('');
  return '<div class="list-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header"><span>Key Pairs (' + keys.length + ')</span><span style="font-size:10px;color:#94a3b8">Left Col | Right Col</span></div>' +
    '<div class="list-editor-items">' + rows + '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-key" title="Add a new join key pair">+ Add Key Pair</button>' +
  '</div>';
}

/* ---- Group by editor ---- */
function buildGroupByEditor(ns, grp) {
  var rows = grp.map(function(g, i) {
    return '<div class="list-item">' +
      '<div class="list-item-inputs">' +
        '<input type="text" placeholder="Column" value="' + DS.fn.esc(g.col||g||'') + '" data-field="col" data-idx="' + i + '" style="flex:1" />' +
      '</div>' +
      '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">\xd7</button>' +
    '</div>';
  }).join('');
  return '<div class="list-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header"><span>Group By (' + grp.length + ')</span></div>' +
    '<div class="list-editor-items">' + rows + '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-grp" title="Add a new group-by column">+ Add Column</button>' +
  '</div>';
}

/* ---- Aggregations editor ---- */
function buildAggregationsEditor(ns, aggs) {
  var rows = aggs.map(function(a, i) {
    return '<div class="list-item">' +
      '<div class="list-item-inputs">' +
        '<input type="text" placeholder="Field" value="' + DS.fn.esc(a.field||'') + '" data-field="field" data-idx="' + i + '" />' +
        selectOpts(C.AGG_OPS, (a.operation||'SUM').toUpperCase(), 'data-field="operation" data-idx="' + i + '"') +
        '<input type="text" placeholder="Alias" value="' + DS.fn.esc(a.alias||'') + '" data-field="alias" data-idx="' + i + '" />' +
        '<input type="text" placeholder="Condition (optional)" value="' + DS.fn.esc(a.condition||'') + '" data-field="condition" data-idx="' + i + '" title="e.g. TXN_TYPE = \'DR\'" />' +
      '</div>' +
      '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">\xd7</button>' +
    '</div>';
  }).join('');
  return '<div class="list-editor" id="' + ns + '-editor">' +
    '<div class="list-editor-header"><span>Aggregations (' + aggs.length + ')</span><span style="font-size:10px;color:#94a3b8">Field | Op | Alias | Cond</span></div>' +
    '<div class="list-editor-items">' + rows + '</div>' +
    '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-agg">+ Add Aggregation</button>' +
  '</div>';
}

/* ---- Source options helper ---- */
function getSourceOptions(excludeNodeId) {
  var opts = [];
  S.nodes.forEach(function(n) {
    if (n.id === excludeNodeId) return;
    if (n.type === 'input') {
      opts.push({ value: n.name || n.id, label: (n.name || n.id) + ' [Input]' });
    } else if (n.type !== 'output') {
      var alias = n.output_alias || n.step_id || n.id;
      var lbl   = (C.TYPE_META[n.type] || { label: n.type }).label;
      opts.push({ value: alias, label: alias + ' [' + lbl + ']' });
    }
  });
  return opts;
}

/* ---- Multi-select source dropdown ---- */
function multiSourceSelect(id, currentValues, excludeNodeId) {
  var opts = getSourceOptions(excludeNodeId);
  var vals = currentValues || [];

  var cbHtml = '';
  if (opts.length === 0 && vals.length === 0) {
    cbHtml = '<div class="src-no-opts">No nodes on canvas yet</div>';
  } else {
    opts.forEach(function(o) {
      var chk = vals.indexOf(o.value) >= 0 ? ' checked' : '';
      cbHtml += '<label class="src-cb-label"><input type="checkbox" class="src-cb" value="' +
                DS.fn.esc(o.value) + '"' + chk + '> ' + DS.fn.esc(o.label) + '</label>';
    });
    vals.forEach(function(v) {
      if (!v) return;
      var exists = opts.some(function(o) { return o.value === v; });
      if (!exists) {
        cbHtml += '<label class="src-cb-label"><input type="checkbox" class="src-cb" value="' +
                  DS.fn.esc(v) + '" checked> ' + DS.fn.esc(v) + ' <em style="color:#94a3b8">(saved)</em></label>';
      }
    });
  }

  var chipsHtml = vals.length
    ? vals.filter(Boolean).map(function(v){ return '<span class="src-tag">' + DS.fn.esc(v) + '</span>'; }).join('')
    : '<span class="src-placeholder">\u2014 select source(s) \u2014</span>';

  var selHtml = '<select id="' + id + '" multiple style="display:none">';
  opts.forEach(function(o) {
    var sel = vals.indexOf(o.value) >= 0 ? ' selected' : '';
    selHtml += '<option value="' + DS.fn.esc(o.value) + '"' + sel + '>' + DS.fn.esc(o.label) + '</option>';
  });
  vals.forEach(function(v) {
    if (!v) return;
    var exists = opts.some(function(o) { return o.value === v; });
    if (!exists) selHtml += '<option value="' + DS.fn.esc(v) + '" selected>' + DS.fn.esc(v) + '</option>';
  });
  selHtml += '</select>';

  return '<div class="src-select-wrap" data-id="' + id + '">' +
           '<div class="src-display">' +
             '<div class="src-chips">' + chipsHtml + '</div>' +
             '<span class="src-chevron">\u25be</span>' +
           '</div>' +
           '<div class="src-dropdown hidden">' + cbHtml + '</div>' +
           selHtml +
         '</div>';
}

/* ---- Single-select source dropdown ---- */
function singleSourceSelect(id, currentValue, excludeNodeId) {
  var opts = getSourceOptions(excludeNodeId);
  var html = '<select id="' + id + '" class="single-source-select">';
  html += '<option value="">\u2014 select source \u2014</option>';
  opts.forEach(function(o) {
    var sel = o.value === currentValue ? ' selected' : '';
    html += '<option value="' + DS.fn.esc(o.value) + '"' + sel + '>' + DS.fn.esc(o.label) + '</option>';
  });
  if (currentValue) {
    var exists = opts.some(function(o) { return o.value === currentValue; });
    if (!exists) html += '<option value="' + DS.fn.esc(currentValue) + '" selected>' + DS.fn.esc(currentValue) + ' (saved)</option>';
  }
  html += '</select>';
  return html;
}

/* ---- Read multi-select values ---- */
function getMultiSelectValues(id) {
  var $el = $('#' + id);
  if (!$el.length) return [];
  return Array.prototype.slice.call($el[0].options)
    .filter(function(o) { return o.selected; })
    .map(function(o) { return o.value; })
    .filter(Boolean);
}

/* ---- Read single select value ---- */
function getSingleSelectValue(id) {
  var $el = $('#' + id);
  return $el.length ? $el.val().trim() : '';
}

/* ---- Wire up checkbox-dropdown interactivity ---- */
function initSrcDropdowns(container) {
  $(container || document).find('.src-select-wrap').each(function() {
    var wrap = this;
    var $wrap = $(wrap);
    var $display  = $wrap.find('.src-display');
    var $dropdown = $wrap.find('.src-dropdown');
    var $selectEl = $wrap.find('select');
    if (!$display.length || !$dropdown.length || !$selectEl.length) return;

    $display.on('click', function(e) {
      e.stopPropagation();
      var opening = $dropdown.hasClass('hidden');
      $('.src-dropdown').addClass('hidden');
      if (opening) $dropdown.removeClass('hidden');
    });

    $wrap.find('.src-cb').each(function() {
      $(this).on('change', function() {
        _syncSrcSelect(wrap);
        _redrawSrcChips(wrap);
      });
    });
  });

  if (!document.__srcDropdownListening) {
    document.__srcDropdownListening = true;
    $(document).on('click', function() {
      $('.src-dropdown').addClass('hidden');
    });
  }
}

function _syncSrcSelect(wrap) {
  var $wrap = $(wrap);
  var $selectEl = $wrap.find('select');
  if (!$selectEl.length) return;
  var vals = [];
  $wrap.find('.src-cb:checked').each(function() { vals.push(this.value); });
  Array.prototype.slice.call($selectEl[0].options).forEach(function(opt) {
    opt.selected = vals.indexOf(opt.value) >= 0;
  });
}

function _redrawSrcChips(wrap) {
  var $chipsEl = $(wrap).find('.src-chips');
  if (!$chipsEl.length) return;
  var checked = [];
  $(wrap).find('.src-cb:checked').each(function() { checked.push(this); });
  $chipsEl.html(checked.length
    ? checked.map(function(cb){ return '<span class="src-tag">' + DS.fn.esc(cb.value) + '</span>'; }).join('')
    : '<span class="src-placeholder">\u2014 select source(s) \u2014</span>');
}

  /* ---- Export public functions ---- */
  DS.fn.selectOpts = selectOpts;
  DS.fn.buildFieldsEditor = buildFieldsEditor;
  DS.fn.buildClickToEditFieldsEditor = buildClickToEditFieldsEditor;
  DS.fn.buildTableValidationRulesEditor = buildTableValidationRulesEditor;
  DS.fn.buildValidationRulesEditor = buildValidationRulesEditor;
  DS.fn.buildControlFileFieldsEditor = buildControlFileFieldsEditor;
  DS.fn.buildSelectExpressionsEditor = buildSelectExpressionsEditor;
  DS.fn.buildFilterConditionsEditor = buildFilterConditionsEditor;
  DS.fn.buildJoinKeysEditor = buildJoinKeysEditor;
  DS.fn.buildGroupByEditor = buildGroupByEditor;
  DS.fn.buildAggregationsEditor = buildAggregationsEditor;
  DS.fn.getSourceOptions = getSourceOptions;
  DS.fn.multiSourceSelect = multiSourceSelect;
  DS.fn.singleSourceSelect = singleSourceSelect;
  DS.fn.getMultiSelectValues = getMultiSelectValues;
  DS.fn.getSingleSelectValue = getSingleSelectValue;
  DS.fn.initSrcDropdowns = initSrcDropdowns;

  /* ---- Global delegated handler: cf-expr-select show/hide literal/custom inputs ---- */
  /* Registered once at module load — covers all panels (validate, output header/trailer) */
  $(document).on('change', '.cf-expr-select', function() {
    var $sel  = $(this);
    var $wrap = $sel.closest('.cf-expr-wrap');
    var val   = $sel.val();
    $wrap.find('.cf-expr-literal').toggle(val === '__literal__');
    $wrap.find('.cf-expr-custom').toggle(val === '__custom__');
  });

})(window.DS);
