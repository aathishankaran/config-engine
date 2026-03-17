/**
 * ds-props.js — All property panel renderers + props core (showPropsPanel, applyPropsToNode, form helpers).
 * Depends: ds-namespace.js, ds-constants.js, ds-state.js, ds-utils.js, ds-schema.js, ds-editors.js
 */
(function(DS) {
"use strict";
var C = DS.C, S = DS.S;

/* ================================================================
   props/input.js
================================================================ */
/**
 * props/input.js — Input node properties panel renderer.
 */

function renderInputProps(body, node) {
  var meta = DS.fn.getNodeMeta(node);
  var schemaFile = meta.copybook_file || node._schema_file || '';
  var schemaFieldCount = meta.fields || (node.fields ? node.fields.length : 0);
  var schemaBtnClass = schemaFile ? ' has-file' : '';
  var schemaBtnLabel = schemaFile
    ? '<i class="fa-solid fa-check"></i> ' + DS.fn.esc(schemaFile) + ' (' + schemaFieldCount + ' fields)'
    : '<i class="fa-solid fa-file-import"></i> Import Schema';
  var testFile = meta.test_file || node._test_file || '';
  var testRows = meta.rows !== undefined ? meta.rows : (node._test_rows || 0);
  var tfBtnClass = testFile ? ' has-file' : '';
  var tfBtnLabel = testFile
    ? '<i class="fa-solid fa-check"></i> ' + DS.fn.esc(testFile) + ' (' + testRows + ' rows)'
    : '<i class="fa-solid fa-flask"></i> Upload Test Data File';

  var curFmt = (node.format || '').toUpperCase();
  var isFixed   = (curFmt === 'FIXED');
  var isDelim   = (curFmt === 'DELIMITED');
  var showFmtProps = isFixed || isDelim;
  var curFreq   = (node.frequency || '').toUpperCase();
  var curDataset = node.dataset_name || node.source_file_name || '';

  /* Format dropdown with labels */
  var fmtOptions = C.FORMATS_IN.map(function(f) {
    return '<option value="' + f + '"' + (f === (curFmt || C.FORMATS_IN[0]) ? ' selected' : '') + '>' + (C.FORMAT_LABELS[f] || f) + '</option>';
  }).join('');

  $(body).html(
    /* ── BASIC ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Basic</div>' +
      formRow('Name / ID', textInput('pi-name', node.name, 'e.g. IFACE-INPUT-01')) +
      formRow('Format', '<select id="pi-format" class="form-select">' + fmtOptions + '</select>') +
      formRow('Frequency',
        '<select id="pi-frequency" class="form-select">' +
          '<option value="">-- SELECT --</option>' +
          C.FREQUENCIES.map(function(f){ return '<option value="' + f + '"' + (curFreq === f ? ' selected' : '') + '>' + f + '</option>'; }).join('') +
        '</select>',
        'How often this dataset is refreshed') +
      formRow('Dataset Name', textInput('pi-dataset-name', curDataset, 'e.g. USB.HOGON.TRAN.DAT'),
        'File name with extension as produced by the source system') +
      DS.fn._pathInfoBannerHtml('pi-path-preview', S._appSettings.raw_bucket_prefix || '', curFreq, curDataset, '') +
    '</div>' +

    /* ── FORMAT PROPERTIES (conditional) ── */
    '<div class="props-section format-props-section" id="pi-format-props"' + (showFmtProps ? '' : ' style="display:none"') + '>' +
      '<div class="props-section-title">' +
        '<i class="fa-solid fa-sliders" style="margin-right:6px;font-size:10px"></i>Format Properties' +
      '</div>' +
      /* Fixed Width fields */
      '<div class="format-fields-group" id="pi-fixed-fields"' + (isFixed ? ' style="display:block"' : '') + '>' +
        formRow('Record Length',
          textInput('pi-record-length', node.record_length !== undefined ? node.record_length : '', 'e.g. 200'),
          'Total character width of one data record (optional validation)') +
        formRow('Header Records',
          textInput('pi-header-count', node.header_count !== undefined ? node.header_count : '0', '0'),
          'Number of header lines at top of file to skip') +
        formRow('Trailer Records',
          textInput('pi-trailer-count', node.trailer_count !== undefined ? node.trailer_count : '0', '0'),
          'Number of trailer lines at bottom of file to skip') +
      '</div>' +
      /* Delimited fields */
      '<div class="format-fields-group" id="pi-delimited-fields"' + (isDelim ? ' style="display:block"' : '') + '>' +
        formRow('Delimiter Character',
          textInput('pi-delimiter-char', node.delimiter_char || '', 'e.g. | or , or \\t'),
          'Single character used to separate fields') +
      '</div>' +
    '</div>' +

    /* ── HEADER RECORD SCHEMA (Fixed-width only) ── */
    (isFixed ?
    '<div class="props-section schema-section schema-section--header">' +
      '<div class="props-section-title">' +
        '<span class="schema-badge schema-badge--header">HDR</span>' +
        'Header Record Schema' +
        ((node.header_fields && node.header_fields.length) ? '<span class="schema-count"> (' + node.header_fields.length + ' fields)</span>' : '') +
      '</div>' +
      DS.fn.buildClickToEditFieldsEditor('pi-header-fields', node.header_fields || [], '') +
    '</div>'
    : '') +

    /* ── DATASET SCHEMA ── */
    '<div class="props-section schema-section schema-section--data">' +
      '<div class="props-section-title">' +
        '<span class="schema-badge schema-badge--data">DATA</span>' +
        'Dataset Schema' +
      '</div>' +
      DS.fn.buildClickToEditFieldsEditor('pi-fields', node.fields || [],
        '<button type="button" class="tbl-hdr-icon-btn' + schemaBtnClass + '" id="pi-import-schema-btn" title="' +
          (schemaFile ? 'Re-import schema \u2014 ' + DS.fn.esc(schemaFile) + ' (' + schemaFieldCount + ' fields)' : 'Import field schema from copybook / CSV') + '">' +
          '<i class="fa-solid fa-file-import"></i> Import' +
        '</button>'
      ) +
    '</div>' +

    /* ── TRAILER RECORD SCHEMA (Fixed-width only) ── */
    (isFixed ?
    '<div class="props-section schema-section schema-section--trailer">' +
      '<div class="props-section-title">' +
        '<span class="schema-badge schema-badge--trailer">TRL</span>' +
        'Trailer Record Schema' +
        ((node.trailer_fields && node.trailer_fields.length) ? '<span class="schema-count"> (' + node.trailer_fields.length + ' fields)</span>' : '') +
      '</div>' +
      DS.fn.buildClickToEditFieldsEditor('pi-trailer-fields', node.trailer_fields || [], '') +
    '</div>'
    : '') +

    /* ── TEST DATA (starts collapsed) ── */
    '<div class="props-section" data-default-fold="collapsed">' +
      '<div class="props-section-title">Test Data</div>' +
      '<p style="font-size:12px;color:#64748b;margin-bottom:8px">Upload a sample data file to use for testing this input node.</p>' +
      '<button type="button" class="btn-import-sm' + tfBtnClass + '" id="pi-test-file-btn" title="Upload a test data file for this input node">' +
        tfBtnLabel +
      '</button>' +
      '<div class="import-file-badge' + (testFile ? ' visible' : '') + '" id="pi-test-file-badge">' +
        (testFile ? '\u2713 ' + DS.fn.esc(testFile) + ' (' + testRows + ' rows)' : '') +
      '</div>' +
    '</div>' +

    '');

  rebindPropsApply(node);

  /* Dynamic path preview update */
  var $_piFreq    = $('#pi-frequency');
  var $_piDs      = $('#pi-dataset-name');
  var $_piPreview = $('#pi-path-preview');
  function _updateInputPreview() {
    if (!$_piPreview.length) return;
    var f = $_piFreq.val() || '';
    var d = $_piDs.val()   || '';
    $_piPreview.html('<i class="fa-solid fa-circle-info"></i> Files will be processed as: <code>' +
      DS.fn.esc(DS.fn._buildPathPreview(S._appSettings.raw_bucket_prefix || '', DS.fn._getInterfaceName(), f, d)) + '</code>');
  }
  $_piFreq.on('change', _updateInputPreview);
  $_piDs.on('input',    _updateInputPreview);

  /* Format toggle: show/hide format properties sections */
  var $piFormatSel    = $('#pi-format');
  var $piFormatProps  = $('#pi-format-props');
  var $piFixedFields  = $('#pi-fixed-fields');
  var $piDelimFields  = $('#pi-delimited-fields');
  $piFormatSel.on('change', function() {
    var fmt = $(this).val();
    var showProps = (fmt === 'FIXED' || fmt === 'DELIMITED');
    $piFormatProps.css('display', showProps ? '' : 'none');
    $piFixedFields.css('display', (fmt === 'FIXED') ? 'block' : '');
    $piDelimFields.css('display', (fmt === 'DELIMITED') ? 'block' : '');
    if (fmt !== 'FIXED') $piFixedFields.css('display', 'none');
    if (fmt !== 'DELIMITED') $piDelimFields.css('display', 'none');
  });

  var $schemaBtn = $('#pi-import-schema-btn');
  if ($schemaBtn.length) {
    $schemaBtn.on('click', function() {
      DS.fn.pickAndParseSchema(node, 'pi-fields', 'pi-copybook-badge', $schemaBtn[0], 'input');
    });
  }

  var $testFileBtn = $('#pi-test-file-btn');
  if ($testFileBtn.length) {
    $testFileBtn.on('click', function() {
      DS.fn.uploadNodeTestFile(node, 'pi-test-file-badge', $testFileBtn[0], 'input');
    });
  }
}


/* ================================================================
   props/output.js
================================================================ */
/**
 * props/output.js — Output node properties panel renderer.
 */

function renderOutputProps(body, node) {
  var _isEfsWriteNode = node.type === 'efs_write';
  var meta = DS.fn.getNodeMeta(node);
  var schemaFileO = meta.copybook_file || node._schema_file || '';
  var schemaFieldCountO = meta.fields || (node.fields ? node.fields.length : 0);
  var schemaBtnClass = schemaFileO ? ' has-file' : '';
  var schemaBtnLabel = schemaFileO
    ? '<i class="fa-solid fa-check"></i> ' + DS.fn.esc(schemaFileO) + ' (' + schemaFieldCountO + ' fields)'
    : '<i class="fa-solid fa-file-import"></i> Import from File';
  var testFileO = meta.test_file || node._test_file || '';
  var testRowsO = meta.rows !== undefined ? meta.rows : (node._test_rows || 0);
  var tfBtnClass = testFileO ? ' has-file' : '';
  var tfBtnLabel = testFileO
    ? '<i class="fa-solid fa-check"></i> ' + DS.fn.esc(testFileO) + ' (' + testRowsO + ' rows)'
    : '<i class="fa-solid fa-flask"></i> Upload Expected Output';

  var curFmtO = (node.format || '').toUpperCase();
  var isFixedO  = (curFmtO === 'FIXED');
  var isDelimO  = (curFmtO === 'DELIMITED');
  var showFmtPropsO = isFixedO || isDelimO;
  var curFreqO  = (node.frequency || '').toUpperCase();
  var curDatasetO = node.dataset_name || node.target_file_name || '';

  /* Build fuzzy source map: output field → best-matching upstream field */
  var _upstreamForSrcMap = _resolveUpstreamFields(node);
  var sourceMapO = {};
  if (_upstreamForSrcMap.length && node.fields && node.fields.length) {
    var _FUZZY_THRESH = 0.6; /* stricter threshold for display — avoids single-token false positives */
    /* No usedUpIdx — each field independently finds its best match for display */
    node.fields.forEach(function(f) {
      if (!f.name) return;
      var fnameU = f.name.toUpperCase();
      /* exact first */
      for (var ei = 0; ei < _upstreamForSrcMap.length; ei++) {
        if ((_upstreamForSrcMap[ei].name || '').toUpperCase() === fnameU) {
          sourceMapO[f.name] = { source: _upstreamForSrcMap[ei].name, score: 1, exact: true };
          return;
        }
      }
      /* fuzzy */
      var bestS = 0, bestI = -1;
      for (var fi = 0; fi < _upstreamForSrcMap.length; fi++) {
        var sc = DS.fn.fuzzyTokenScore(f.name, _upstreamForSrcMap[fi].name || '');
        if (sc > bestS) { bestS = sc; bestI = fi; }
      }
      if (bestS >= _FUZZY_THRESH) {
        sourceMapO[f.name] = { source: _upstreamForSrcMap[bestI].name, score: bestS, exact: false };
      }
    });
  }

  /* Format dropdown with labels */
  var fmtOptionsO = C.FORMATS_OUT.map(function(f) {
    return '<option value="' + f + '"' + (f === (curFmtO || C.FORMATS_OUT[0]) ? ' selected' : '') + '>' + (C.FORMAT_LABELS[f] || f) + '</option>';
  }).join('');

  $(body).html(
    /* ── BASIC ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Basic</div>' +
      formRow('Name / ID', textInput('po-name', node.name, 'e.g. IFACE-OUTPUT-01')) +
      formRow('Source Input', DS.fn.multiSourceSelect('po-src', node.source_inputs || [], node.id)) +
      formRow('Format', '<select id="po-format" class="form-select">' + fmtOptionsO + '</select>') +
      formRow('Frequency',
        '<select id="po-frequency" class="form-select">' +
          '<option value="">-- SELECT --</option>' +
          C.FREQUENCIES.map(function(f){ return '<option value="' + f + '"' + (curFreqO === f ? ' selected' : '') + '>' + f + '</option>'; }).join('') +
        '</select>',
        'How often this output is produced') +
      formRow('Dataset Name', textInput('po-dataset-name', curDatasetO, 'e.g. OUTPUT.SUMCOPY.DAT'),
        'Output file name with extension') +
      formRow('Write Mode', selectInput('po-wmode', C.WRITE_MODES, (node.write_mode || '').toUpperCase() || C.WRITE_MODES[0])) +
      DS.fn._pathInfoBannerHtml('po-path-preview',
        _isEfsWriteNode ? (S._appSettings.efs_output_prefix || '') : (S._appSettings.curated_bucket_prefix || ''),
        curFreqO, curDatasetO, '') +
    '</div>' +

    /* ── FORMAT PROPERTIES (conditional) ── */
    '<div class="props-section format-props-section" id="po-format-props"' + (showFmtPropsO ? '' : ' style="display:none"') + '>' +
      '<div class="props-section-title">' +
        '<i class="fa-solid fa-sliders" style="margin-right:6px;font-size:10px"></i>Format Properties' +
      '</div>' +
      /* Fixed Width fields */
      '<div class="format-fields-group" id="po-fixed-fields"' + (isFixedO ? ' style="display:block"' : '') + '>' +
        formRow('Record Length',
          textInput('po-record-length', node.record_length !== undefined ? node.record_length : '', 'e.g. 200'),
          'Total character width of one output record') +
        formRow('Header Records',
          textInput('po-header-count', node.header_count !== undefined ? node.header_count : '0', '0'),
          'Number of header lines to write at top of file') +
        formRow('Trailer Records',
          textInput('po-trailer-count', node.trailer_count !== undefined ? node.trailer_count : '0', '0'),
          'Number of trailer lines to write at bottom of file') +
      '</div>' +
      /* Delimited fields */
      '<div class="format-fields-group" id="po-delimited-fields"' + (isDelimO ? ' style="display:block"' : '') + '>' +
        formRow('Delimiter Character',
          textInput('po-delimiter-char', node.delimiter_char || '', 'e.g. | or , or \\t'),
          'Single character used to separate fields') +
      '</div>' +
    '</div>' +

    /* ── OUTPUT HEADER SCHEMA (FIXED only, shown when header_count > 0) ── */
    '<div class="props-section" id="po-header-schema-section"' + (!isFixedO || !parseInt(node.header_count, 10) ? ' style="display:none"' : '') + '>' +
      '<div class="props-section-title">' +
        '<i class="fa-solid fa-arrow-up-wide-short" style="margin-right:6px;font-size:10px;color:#0ea5e9"></i>Header Record Schema' +
      '</div>' +
      '<p style="font-size:11px;color:#64748b;margin:0 0 8px">Define the fields written into the header row. Use expressions to compute values (count, date, hardcoded, etc.).</p>' +
      DS.fn.buildControlFileFieldsEditor('po-header-fields', node.header_fields || []) +
    '</div>' +

    /* ── DATASET SCHEMA ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Dataset Schema</div>' +
      '<div class="col-mismatch-alert" id="po-col-mismatch" style="display:none">' +
        '<i class="fa-solid fa-triangle-exclamation"></i>' +
        '<span id="po-col-mismatch-msg"></span>' +
      '</div>' +
      '<div id="po-match-table-wrap" style="display:none"></div>' +
      DS.fn.buildClickToEditFieldsEditor('po-fields', node.fields || [],
        '<button type="button" class="tbl-hdr-icon-btn" id="po-match-steps-btn" title="Match output schema columns against previous step output">' +
          '<i class="fa-solid fa-code-compare"></i> Match' +
        '</button>' +
        '<button type="button" class="tbl-hdr-icon-btn' + schemaBtnClass + '" id="po-import-schema-btn" title="' +
          (schemaFileO ? 'Re-import schema \u2014 ' + DS.fn.esc(schemaFileO) + ' (' + schemaFieldCountO + ' fields)' : 'Import output schema from file') + '">' +
          '<i class="fa-solid fa-file-import"></i> Import' +
        '</button>',
        sourceMapO
      ) +
    '</div>' +

    /* ── OUTPUT TRAILER SCHEMA (FIXED only, shown when trailer_count > 0) ── */
    '<div class="props-section" id="po-trailer-schema-section"' + (!isFixedO || !parseInt(node.trailer_count, 10) ? ' style="display:none"' : '') + '>' +
      '<div class="props-section-title">' +
        '<i class="fa-solid fa-arrow-down-wide-short" style="margin-right:6px;font-size:10px;color:#f59e0b"></i>Trailer Record Schema' +
      '</div>' +
      '<p style="font-size:11px;color:#64748b;margin:0 0 8px">Define the fields written into the trailer row. Use expressions to compute values (count, date, hardcoded, etc.).</p>' +
      DS.fn.buildControlFileFieldsEditor('po-trailer-fields', node.trailer_fields || []) +
    '</div>' +

    /* ── TEST DATA (starts collapsed) ── */
    '<div class="props-section" data-default-fold="collapsed">' +
      '<div class="props-section-title">Test Data</div>' +
      '<p style="font-size:12px;color:#64748b;margin-bottom:8px">Upload the expected output file to compare against the generated output during test runs.</p>' +
      '<button type="button" class="btn-import-sm' + tfBtnClass + '" id="po-test-file-btn" title="Upload expected output file for reconciliation testing">' +
        tfBtnLabel +
      '</button>' +
      '<div class="import-file-badge' + (testFileO ? ' visible' : '') + '" id="po-test-file-badge">' +
        (testFileO ? '\u2713 ' + DS.fn.esc(testFileO) + ' (' + testRowsO + ' rows)' : '') +
      '</div>' +
    '</div>');

  rebindPropsApply(node);

  /* Dynamic path preview update */
  var $_poFreq    = $('#po-frequency');
  var $_poDs      = $('#po-dataset-name');
  var $_poPreview = $('#po-path-preview');
  function _updateOutputPreview() {
    if (!$_poPreview.length) return;
    var f = $_poFreq.val() || '';
    var d = $_poDs.val()   || '';
    var prefix = _isEfsWriteNode ? (S._appSettings.efs_output_prefix || '') : (S._appSettings.curated_bucket_prefix || '');
    $_poPreview.html('<i class="fa-solid fa-circle-info"></i> Files will be processed as: <code>' +
      DS.fn.esc(DS.fn._buildPathPreview(prefix, DS.fn._getInterfaceName(), f, d)) + '</code>');
  }
  $_poFreq.on('change', _updateOutputPreview);
  $_poDs.on('input',    _updateOutputPreview);

  /* Format toggle: show/hide format properties sections */
  var $poFormatSel    = $('#po-format');
  var $poFormatProps  = $('#po-format-props');
  var $poFixedFields  = $('#po-fixed-fields');
  var $poDelimFields  = $('#po-delimited-fields');
  function _syncHdrTrlSections() {
    var isFixed = $poFormatSel.val() === 'FIXED';
    var hCount  = parseInt($('#po-header-count').val(), 10) || 0;
    var tCount  = parseInt($('#po-trailer-count').val(), 10) || 0;
    $('#po-header-schema-section').css('display', (isFixed && hCount > 0) ? '' : 'none');
    $('#po-trailer-schema-section').css('display', (isFixed && tCount > 0) ? '' : 'none');
  }
  $poFormatSel.on('change', function() {
    var fmt = $(this).val();
    var showProps = (fmt === 'FIXED' || fmt === 'DELIMITED');
    $poFormatProps.css('display', showProps ? '' : 'none');
    $poFixedFields.css('display', (fmt === 'FIXED') ? 'block' : 'none');
    $poDelimFields.css('display', (fmt === 'DELIMITED') ? 'block' : 'none');
    _syncHdrTrlSections();
  });
  $('#po-header-count').on('change input', _syncHdrTrlSections);
  $('#po-trailer-count').on('change input', _syncHdrTrlSections);

  /* Match previous step columns button */
  $('#po-match-steps-btn').on('click', function() {
    var upstreamFields = _resolveUpstreamFields(node);
    if (!upstreamFields.length) {
      DS.fn.toast('No fields found in previous step. Define fields on the source step first.', 'error');
      return;
    }
    if (!node.fields || !node.fields.length) {
      DS.fn.toast('Import output schema first, then match against previous step.', 'error');
      return;
    }
    validateOutputColumnMismatch(node);
    _showMatchComparisonTable(node, upstreamFields);
  });

  var $schemaBtn = $('#po-import-schema-btn');
  if ($schemaBtn.length) {
    $schemaBtn.on('click', function() {
      DS.fn.pickAndParseSchema(node, 'po-fields', 'po-copybook-badge', $schemaBtn[0], 'output');
    });
  }

  var $testFileBtn = $('#po-test-file-btn');
  if ($testFileBtn.length) {
    $testFileBtn.on('click', function() {
      DS.fn.uploadNodeTestFile(node, 'po-test-file-badge', $testFileBtn[0], 'output');
    });
  }

  /* Validate output schema columns against upstream step output */
  validateOutputColumnMismatch(node);
}

/* ---- Import column names from source step ---- */
function importColumnsFromSourceStep(node) {
  var sources = node.source_inputs || DS.fn.getMultiSelectValues('po-src');
  if (!sources.length) {
    DS.fn.toast('No source inputs selected. Choose a Source Input first.', 'error');
    return;
  }
  var alias = sources[0];
  var srcNode = S.nodes.find(function(n) {
    if (n.type === 'input')  return (n.name || n.id) === alias;
    if (n.type === 'output') return false;
    return (n.output_alias || n.step_id || n.id) === alias;
  });
  if (!srcNode) {
    DS.fn.toast('Source "' + alias + '" not found on canvas.', 'error');
    return;
  }
  var cols = [];
  if (srcNode.fields && srcNode.fields.length > 0) {
    cols = srcNode.fields.filter(function(f){ return f.name; }).map(function(f){ return f.name; });
  } else if (srcNode.select_expressions && srcNode.select_expressions.length > 0) {
    cols = srcNode.select_expressions.filter(function(e){ return e.target; }).map(function(e){ return e.target; });
  } else if (srcNode.agg_aggregations && srcNode.agg_aggregations.length > 0) {
    var grpCols = (srcNode.agg_group_by || []).map(function(g){ return g.col || g; }).filter(Boolean);
    var aggCols = srcNode.agg_aggregations.filter(function(a){ return a.alias; }).map(function(a){ return a.alias; });
    cols = grpCols.concat(aggCols);
  } else if (srcNode.validate_rules && srcNode.validate_rules.length > 0) {
    cols = srcNode.validate_rules.filter(function(r){ return r.field; }).map(function(r){ return r.field; });
  }
  if (!cols.length) {
    DS.fn.toast('No columns found in "' + alias + '". Define fields or expressions on the source step first.', 'error');
    return;
  }
  var $outcolsEl = $('#po-outcols');
  if ($outcolsEl.length) {
    $outcolsEl.val(cols.join(', '));
    DS.fn.toast('Imported ' + cols.length + ' column(s) from "' + alias + '"', 'success');
  }
}

/* ---- Import schema fields from upstream steps into output node ---- */
function importSchemaFromSteps(node) {
  var sources = node.source_inputs || DS.fn.getMultiSelectValues('po-src');
  if (!sources.length) {
    DS.fn.toast('No source inputs selected. Choose a Source Input first.', 'error');
    return;
  }
  var alias = sources[0];
  var fields = DS.fn.getFieldsForAlias(alias);
  if (!fields.length) {
    /* Try to get from validate rules or select expressions */
    var srcNode = S.nodes.find(function(n) {
      if (n.type === 'input')  return (n.name || n.id) === alias;
      if (n.type === 'output') return false;
      return (n.output_alias || n.step_id || n.id) === alias;
    });
    if (srcNode && srcNode.validate_rules && srcNode.validate_rules.length > 0) {
      fields = srcNode.validate_rules.map(function(r) {
        return { name: r.field, type: r.data_type === 'NUMBER' ? 'long' : 'string', nullable: r.nullable !== false };
      });
    } else if (srcNode && srcNode.select_expressions && srcNode.select_expressions.length > 0) {
      fields = srcNode.select_expressions.filter(function(e){ return e.target; }).map(function(e) {
        return { name: e.target, type: 'string', nullable: true };
      });
    }
  }
  if (!fields.length) {
    DS.fn.toast('No fields found in "' + alias + '". Define fields on the source step first.', 'error');
    return;
  }
  node.fields = fields.map(function(f) {
    return { name: f.name || '', type: f.type || 'string', nullable: f.nullable !== false, format: f.format || '', start: f.start || '', length: f.length || '' };
  });
  showPropsPanel(node);
  DS.fn.toast('Imported ' + fields.length + ' field(s) from "' + alias + '"', 'success');
}

/* ---- Resolve upstream fields for a given node ---- */
function _resolveUpstreamFields(node) {
  var sources = node.source_inputs || DS.fn.getMultiSelectValues('po-src');
  if (!sources.length) return [];
  var upstreamFields = DS.fn.getFieldsForAlias(sources[0]);
  if (!upstreamFields.length) {
    /* Try validate_rules, fields on source node, or select_expressions as fallback */
    var srcNode = S.nodes.find(function(n) {
      if (n.type === 'input')  return (n.name || n.id) === sources[0];
      if (n.type === 'output') return false;
      return (n.output_alias || n.step_id || n.id) === sources[0];
    });
    if (srcNode && srcNode.validate_rules && srcNode.validate_rules.length > 0) {
      upstreamFields = srcNode.validate_rules.map(function(r) {
        return { name: r.field, type: r.data_type === 'NUMBER' ? 'long' : 'string', nullable: r.nullable !== false };
      });
    } else if (srcNode && srcNode.type === 'ctrl_file' && srcNode.ctrl_file_fields && srcNode.ctrl_file_fields.length > 0) {
      upstreamFields = srcNode.ctrl_file_fields.map(function(f) {
        return { name: f.name, type: (f.type || 'STRING').toLowerCase(), length: f.length || 0, begin: f.begin || 0, format: f.format || '', nullable: false };
      });
    } else if (srcNode && srcNode.fields && srcNode.fields.length > 0) {
      upstreamFields = srcNode.fields.filter(function(f) {
        var rt = (f.record_type || 'DATA').toUpperCase();
        return rt !== 'HEADER' && rt !== 'TRAILER';
      });
    } else if (srcNode && srcNode.select_expressions && srcNode.select_expressions.length > 0) {
      upstreamFields = srcNode.select_expressions.filter(function(e){ return e.target; }).map(function(e) {
        return { name: e.target, type: 'string', nullable: true };
      });
    }
  }
  return upstreamFields;
}

/* ---- Validate column mismatch between imported schema and upstream step (fuzzy) ---- */
function validateOutputColumnMismatch(node) {
  var $alertEl = $('#po-col-mismatch');
  var $msgEl = $('#po-col-mismatch-msg');
  if (!$alertEl.length || !$msgEl.length) return;

  if (!node.fields || !node.fields.length) {
    $alertEl.css('display', 'none');
    return;
  }

  var upstreamFields = _resolveUpstreamFields(node);
  if (!upstreamFields.length) {
    $alertEl.css('display', 'none');
    return;
  }

  var FUZZY_THRESHOLD = 0.4;

  /* Helper: returns true if field name has any fuzzy match in a list */
  function _hasFuzzyMatch(name, fieldList) {
    var nameUp = (name || '').toUpperCase();
    return fieldList.some(function(f) {
      if ((f.name || '').toUpperCase() === nameUp) return true;          /* exact */
      return DS.fn.fuzzyTokenScore(name, f.name || '') >= FUZZY_THRESHOLD; /* fuzzy */
    });
  }

  /* Columns in output schema with NO fuzzy match in upstream */
  var extraInSchema = node.fields.filter(function(f) {
    return f.name && !_hasFuzzyMatch(f.name, upstreamFields);
  });

  /* Columns in upstream with NO fuzzy match in output schema */
  var missingFromSchema = upstreamFields.filter(function(f) {
    return f.name && !_hasFuzzyMatch(f.name, node.fields);
  });

  if (extraInSchema.length > 0 || missingFromSchema.length > 0) {
    var html = '';
    if (extraInSchema.length > 0) {
      var extraNames = extraInSchema.map(function(f) { return f.name; });
      html += '<div style="margin-bottom:4px"><strong>' + extraInSchema.length +
        ' column(s)</strong> in output schema not found in previous step output: ' +
        '<code>' + DS.fn.esc(extraNames.join(', ')) + '</code></div>';
    }
    if (missingFromSchema.length > 0) {
      var missingNames = missingFromSchema.map(function(f) { return f.name; });
      html += '<div style="margin-bottom:4px"><strong>' + missingFromSchema.length +
        ' column(s)</strong> from previous step output missing in output schema: ' +
        '<code>' + DS.fn.esc(missingNames.join(', ')) + '</code></div>';
    }
    html += '<button type="button" class="col-mismatch-fix-btn" id="po-col-mismatch-fix" ' +
      'title="Auto-match columns from upstream step and sync output schema">' +
      '<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-fix</button>';

    $alertEl.css('display', '');
    $msgEl.html(html);

    $('#po-col-mismatch-fix').on('click', function() {
      autoMatchOutputSchema(node);
    });
  } else {
    $alertEl.css('display', 'none');
  }
}

/* ---- Auto-match output schema with upstream step columns (fuzzy) ---- */
function autoMatchOutputSchema(node) {
  var sources = node.source_inputs || DS.fn.getMultiSelectValues('po-src');
  if (!sources.length) {
    DS.fn.toast('No source inputs selected.', 'error');
    return;
  }
  var alias = sources[0];
  var upstreamFields = _resolveUpstreamFields(node);
  if (!upstreamFields.length) {
    DS.fn.toast('No fields found in upstream step "' + alias + '".', 'error');
    return;
  }

  var FUZZY_THRESHOLD = 0.4;
  var upNames  = upstreamFields.map(function(f) { return f.name || ''; });
  var usedUpIdx = {};

  /* For each output schema field, find best upstream match (exact > fuzzy) */
  var matched = [];
  (node.fields || []).forEach(function(f) {
    var fname  = f.name || '';
    var fnameU = fname.toUpperCase();

    /* exact */
    var exactIdx = -1;
    for (var ei = 0; ei < upstreamFields.length; ei++) {
      if (!usedUpIdx[ei] && (upstreamFields[ei].name || '').toUpperCase() === fnameU) {
        exactIdx = ei; break;
      }
    }
    if (exactIdx >= 0) {
      usedUpIdx[exactIdx] = true;
      var uf = upstreamFields[exactIdx];
      matched.push({ name: f.name, type: uf.type || f.type || 'string',
        nullable: f.nullable !== undefined ? f.nullable : (uf.nullable !== false),
        format: (uf.format && uf.format !== '') ? uf.format : (f.format || ''),
        start: f.start || uf.start || '', length: f.length || uf.length || '' });
      return;
    }

    /* fuzzy */
    var bestScore = 0, bestIdx = -1;
    for (var fi = 0; fi < upstreamFields.length; fi++) {
      if (usedUpIdx[fi]) continue;
      var s = DS.fn.fuzzyTokenScore(fname, upstreamFields[fi].name || '');
      if (s > bestScore) { bestScore = s; bestIdx = fi; }
    }
    if (bestScore >= FUZZY_THRESHOLD) {
      usedUpIdx[bestIdx] = true;
      var uf2 = upstreamFields[bestIdx];
      matched.push({ name: f.name, type: uf2.type || f.type || 'string',
        nullable: f.nullable !== undefined ? f.nullable : (uf2.nullable !== false),
        format: (uf2.format && uf2.format !== '') ? uf2.format : (f.format || ''),
        start: f.start || uf2.start || '', length: f.length || uf2.length || '' });
      return;
    }

    /* no match — keep as-is */
    matched.push(f);
  });

  /* Append upstream fields not yet matched to any output schema field */
  upstreamFields.forEach(function(f, idx) {
    if (!usedUpIdx[idx]) {
      matched.push({ name: f.name, type: f.type || 'string',
        nullable: f.nullable !== false, format: f.format || '',
        start: f.start || '', length: f.length || '' });
    }
  });

  node.fields = matched;
  showPropsPanel(node);
  DS.fn.toast('Auto-matched schema: ' + matched.length + ' field(s) from "' + alias + '"', 'success');
}

/* ---- Show match comparison table between upstream and output schema (fuzzy) ---- */
function _showMatchComparisonTable(node, upstreamFields) {
  var $wrap = $('#po-match-table-wrap');
  if (!$wrap.length) return;

  var FUZZY_THRESHOLD = 0.4;
  var schemaFields  = node.fields || [];

  /* For each output schema field find the best upstream match (exact first, then fuzzy) */
  var usedUpIdx = {};
  var matchResults = schemaFields.map(function(sf) {
    var sfName = sf.name || '';
    var sfUp   = sfName.toUpperCase();

    /* 1. Exact name match */
    for (var ei = 0; ei < upstreamFields.length; ei++) {
      if ((upstreamFields[ei].name || '').toUpperCase() === sfUp && !usedUpIdx[ei]) {
        usedUpIdx[ei] = true;
        return { schema: sf, up: upstreamFields[ei], type: 'exact', score: 1 };
      }
    }
    /* 2. Fuzzy match */
    var bestScore = 0, bestIdx = -1;
    for (var fi = 0; fi < upstreamFields.length; fi++) {
      if (usedUpIdx[fi]) continue;
      var s = DS.fn.fuzzyTokenScore(sfName, upstreamFields[fi].name || '');
      if (s > bestScore) { bestScore = s; bestIdx = fi; }
    }
    if (bestScore >= FUZZY_THRESHOLD) {
      usedUpIdx[bestIdx] = true;
      return { schema: sf, up: upstreamFields[bestIdx], type: 'fuzzy', score: bestScore };
    }
    return { schema: sf, up: null, type: 'none', score: 0 };
  });

  /* Upstream fields that weren't matched to anything */
  var unmatchedUp = upstreamFields.filter(function(_, i) { return !usedUpIdx[i]; });

  var exactCount = 0, fuzzyCount = 0, unmatchedSchemaCount = 0, typeMismatchCount = 0;
  matchResults.forEach(function(r) {
    if (r.type === 'exact')  exactCount++;
    else if (r.type === 'fuzzy') fuzzyCount++;
    else unmatchedSchemaCount++;
    if (r.up && (r.up.type || '').toUpperCase() !== (r.schema.type || '').toUpperCase()) typeMismatchCount++;
  });

  /* Build upstream field options for override dropdowns */
  var upstreamOpts = upstreamFields.map(function(uf) {
    var label = DS.fn.esc(uf.name || '') + ' (' + DS.fn.esc((uf.type || '').toUpperCase()) + (uf.format ? '/' + DS.fn.esc(uf.format) : '') + ')';
    return '<option value="' + DS.fn.esc(uf.name || '') + '">' + label + '</option>';
  }).join('');

  /* Helper: format label for a field */
  function _typeLabel(f) {
    if (!f) return '\u2014';
    var t = (f.type || '').toUpperCase();
    return f.format ? t + '/' + f.format : t;
  }

  /* Build table rows */
  var rows = matchResults.map(function(r) {
    var schemaName = r.schema.name || '';
    var upName     = r.up ? (r.up.name || '') : '';
    var statusIcon, statusClass, scoreBadge;

    if (r.type === 'exact') {
      statusIcon  = '<i class="fa-solid fa-circle-check"></i>';
      statusClass = 'match-row-ok';
      scoreBadge  = '';
    } else if (r.type === 'fuzzy') {
      statusIcon  = '<i class="fa-solid fa-circle-half-stroke"></i>';
      statusClass = 'match-row-fuzzy';
      scoreBadge  = ' <span class="match-score-badge">' + Math.round(r.score * 100) + '%</span>';
    } else {
      statusIcon  = '<i class="fa-solid fa-circle-xmark"></i>';
      statusClass = 'match-row-extra';
      scoreBadge  = '';
    }

    /* Type match indicator */
    var typeMatch = r.up && (r.up.type || '').toUpperCase() === (r.schema.type || '').toUpperCase();
    var fmtMatch  = !r.up || !r.up.format || !r.schema.format || r.up.format === r.schema.format;
    var typeMatchCell = r.up
      ? (typeMatch && fmtMatch
          ? '<i class="fa-solid fa-check" style="color:#16a34a" title="Type matches"></i>'
          : '<i class="fa-solid fa-triangle-exclamation" style="color:#d97706" title="Type or format mismatch"></i>')
      : '<span style="color:#94a3b8">\u2014</span>';

    /* Override dropdown — shown for all rows so user can always remap */
    var selectedVal = r.up ? DS.fn.esc(r.up.name || '') : '';
    var overrideSelect =
      '<select class="po-field-override match-override-sel" data-schema-field="' + DS.fn.esc(schemaName) + '">' +
        '<option value="">-- keep as-is --</option>' +
        upstreamOpts.replace('value="' + selectedVal + '"', 'value="' + selectedVal + '" selected') +
      '</select>';

    return '<tr class="' + statusClass + '">' +
      '<td class="match-tbl-cell">' + DS.fn.esc(schemaName) + '<br><span class="match-type-lbl">' + DS.fn.esc(_typeLabel(r.schema)) + '</span></td>' +
      '<td class="match-tbl-cell">' + DS.fn.esc(upName) + scoreBadge + (r.up ? '<br><span class="match-type-lbl">' + DS.fn.esc(_typeLabel(r.up)) + '</span>' : '') + '</td>' +
      '<td class="match-tbl-cell" style="text-align:center">' + typeMatchCell + '</td>' +
      '<td class="match-tbl-cell match-status-cell">' + statusIcon + '</td>' +
      '<td class="match-tbl-cell">' + overrideSelect + '</td>' +
    '</tr>';
  }).join('');

  /* Append unmatched upstream rows (source-only) */
  rows += unmatchedUp.map(function(uf) {
    return '<tr class="match-row-missing">' +
      '<td class="match-tbl-cell"><span style="color:#94a3b8">\u2014</span></td>' +
      '<td class="match-tbl-cell">' + DS.fn.esc(uf.name || '') + '<br><span class="match-type-lbl">' + DS.fn.esc(_typeLabel(uf)) + '</span></td>' +
      '<td class="match-tbl-cell"></td>' +
      '<td class="match-tbl-cell match-status-cell"><i class="fa-solid fa-circle-minus"></i></td>' +
      '<td class="match-tbl-cell"></td>' +
    '</tr>';
  }).join('');

  var totalUnmatched = unmatchedSchemaCount + unmatchedUp.length;
  var summaryClass = (totalUnmatched === 0 && typeMismatchCount === 0) ? 'match-summary-ok' : 'match-summary-warn';
  var summaryParts = [];
  if (exactCount)            summaryParts.push(exactCount + ' exact');
  if (fuzzyCount)            summaryParts.push(fuzzyCount + ' fuzzy');
  if (unmatchedSchemaCount)  summaryParts.push(unmatchedSchemaCount + ' unmatched');
  if (unmatchedUp.length)    summaryParts.push(unmatchedUp.length + ' source-only');
  if (typeMismatchCount)     summaryParts.push(typeMismatchCount + ' type mismatch');
  var summaryText = summaryParts.join(', ') || '0 matched';

  var html =
    '<div class="match-comparison">' +
      '<div class="match-comparison-header">' +
        '<span class="match-comparison-title"><i class="fa-solid fa-code-compare"></i> Column Match Results</span>' +
        '<span class="match-summary-badge ' + summaryClass + '">' + summaryText + '</span>' +
        '<button type="button" class="match-close-btn" id="po-match-close" title="Close">&times;</button>' +
      '</div>' +
      '<div class="match-legend">' +
        '<span class="match-legend-item match-legend-exact"><i class="fa-solid fa-circle-check"></i> Exact</span>' +
        '<span class="match-legend-item match-legend-fuzzy"><i class="fa-solid fa-circle-half-stroke"></i> Fuzzy</span>' +
        '<span class="match-legend-item match-legend-missing"><i class="fa-solid fa-circle-minus"></i> Source only</span>' +
        '<span class="match-legend-item match-legend-extra"><i class="fa-solid fa-circle-xmark"></i> Unmatched</span>' +
      '</div>' +
      '<div class="match-tbl-wrap">' +
        '<table class="match-tbl">' +
          '<thead><tr>' +
            '<th>Output Field / Type</th>' +
            '<th>Source Field / Type</th>' +
            '<th title="Type match">Type</th>' +
            '<th>Status</th>' +
            '<th>Override Source</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="match-apply-row">' +
        '<button type="button" class="btn-primary-sm" id="po-apply-overrides"><i class="fa-solid fa-check-double"></i> Apply Overrides</button>' +
        '<span class="match-apply-hint">Select overrides above then click Apply to update output schema types.</span>' +
      '</div>' +
    '</div>';

  $wrap.html(html).css('display', '');

  $('#po-match-close').on('click', function() {
    $wrap.css('display', 'none').html('');
  });

  $('#po-apply-overrides').on('click', function() {
    var changed = 0;
    $wrap.find('.po-field-override').each(function() {
      var schemaField = $(this).data('schema-field');
      var selectedUpName = $(this).val();
      if (!selectedUpName) return;
      var uf = upstreamFields.find(function(u) { return u.name === selectedUpName; });
      if (!uf) return;
      var sf = node.fields.find(function(f) { return f.name === schemaField; });
      if (!sf) return;
      sf.type   = uf.type || sf.type;
      sf.format = (uf.format && uf.format !== '') ? uf.format : sf.format;
      changed++;
    });
    if (changed > 0) {
      showPropsPanel(node);
      DS.fn.toast(changed + ' override(s) applied.', 'success');
    } else {
      DS.fn.toast('No overrides selected.', 'info');
    }
  });

  if (totalUnmatched === 0 && typeMismatchCount === 0) {
    DS.fn.toast('All ' + (exactCount + fuzzyCount) + ' column(s) matched (' + exactCount + ' exact, ' + fuzzyCount + ' fuzzy).', 'success');
  }
}

/* ---- Find the upstream input node for a validate/transform node ---- */
function _getInputNodeForValidate(node) {
  var sources = node.source_inputs || [];
  if (!sources.length) return null;
  var alias = sources[0];
  var inputNode = S.nodes.find(function(n) {
    return n.type === 'input' && ((n.name || n.id) === alias);
  });
  /* If not a direct input, walk up to find input node via connections */
  if (!inputNode) {
    var srcNode = S.nodes.find(function(n) {
      return (n.output_alias || n.step_id || n.id || n.name) === alias;
    });
    if (srcNode) {
      var visited = {};
      var queue = [srcNode.id];
      while (queue.length) {
        var cur = queue.shift();
        if (visited[cur]) continue;
        visited[cur] = true;
        var curN = DS.fn.getNode(cur);
        if (curN && curN.type === 'input') { inputNode = curN; break; }
        S.connections.forEach(function(c) {
          if (c.to === cur && !visited[c.from]) queue.push(c.from);
        });
      }
    }
  }
  return inputNode || null;
}

/* ---- Derive previous day info from connected input node ---- */
function derivePreviousDayInfo(node) {
  var inputNode = _getInputNodeForValidate(node);
  if (!inputNode) return null;
  /* Find downstream output node to get the curated output filename */
  var outputNode = null;
  S.connections.forEach(function(c) {
    if (!outputNode && c.from === node.id) {
      var downN = DS.fn.getNode(c.to);
      if (downN && downN.type === 'output') outputNode = downN;
    }
  });
  if (!outputNode) {
    var nodeAlias = node.output_alias || node.id;
    S.nodes.forEach(function(n) {
      if (!outputNode && n.type === 'output' && (n.source_inputs || []).indexOf(nodeAlias) >= 0) {
        outputNode = n;
      }
    });
  }
  return {
    dataset_name: inputNode.dataset_name || inputNode.source_file_name || '',
    output_dataset: outputNode ? (outputNode.dataset_name || outputNode.target_file_name || '') : '',
    frequency: inputNode.frequency || 'DAILY',
    bucket: S._appSettings.curated_bucket_prefix || S._appSettings.raw_bucket_prefix || ''
  };
}

/* ---- Import control file from upstream validate step ---- */
function importCtrlFileFromValidateStep(node, pathOnly) {
  var sources = DS.fn.getMultiSelectValues('po-src');
  if (!sources.length) sources = node.source_inputs || [];

  var validateNode = null;

  S.connections.forEach(function(c) {
    if (c.to === node.id && !validateNode) {
      var up = DS.fn.getNode(c.from);
      if (up && up.type === 'validate' && up.ctrl_file_create) {
        validateNode = up;
      }
    }
  });

  if (!validateNode) {
    sources.forEach(function(alias) {
      if (validateNode) return;
      var up = S.nodes.find(function(n) {
        return n.type === 'validate' &&
               n.ctrl_file_create &&
               ((n.output_alias || n.step_id || n.id) === alias);
      });
      if (up) validateNode = up;
    });
  }

  if (!validateNode) {
    DS.fn.toast('No upstream Validate step with "Enable Control File Creation" found. ' +
          'Connect a Validate step and enable Control File Creation first.', 'error');
    return;
  }

  var label = validateNode.output_alias || validateNode.step_id || validateNode.id;

  var $ctrlPathEl = $('#po-control-path');
  var ctrlSrcPath = validateNode.validated_path || '';
  if ($ctrlPathEl.length && ctrlSrcPath) {
    $ctrlPathEl.val(ctrlSrcPath);
  }

  if (pathOnly) {
    DS.fn.toast('Control file path populated from validate step "' + label + '"', 'success');
    return;
  }

  if (validateNode.ctrl_file_fields && validateNode.ctrl_file_fields.length > 0) {
    node.control_fields = validateNode.ctrl_file_fields.map(function(f) {
      return {
        name:     f.name     || '',
        type:     (f.type    || 'string').toLowerCase(),
        nullable: true,
        format:   '',
        start:    '',
        length:   ''
      };
    });
    showPropsPanel(node);
    DS.fn.toast('Control file schema populated from validate step "' + label + '" (' +
          node.control_fields.length + ' field(s))', 'success');
  } else {
    DS.fn.toast('Control file path populated from "' + label + '" (no fields to import \u2014 ' +
          'add ctrl_file_fields on the Validate step first)', 'info');
  }
}


/* ================================================================
   props/validate.js
================================================================ */
/**
 * props/validate.js — Validate node properties panel renderer.
 */

var _LR_PARTITION_TOOLTIP =
  '<b>Date expression for the file-path partition:</b><br><br>' +
  '<table style="border-collapse:collapse;font-size:11px;width:100%">' +
    '<tr style="color:#94a3b8">' +
      '<th style="text-align:left;padding:2px 6px 4px;border-bottom:1px solid #334155">Expression</th>' +
      '<th style="text-align:left;padding:2px 6px 4px;border-bottom:1px solid #334155">Output</th>' +
    '</tr>' +
    '<tr><td style="padding:3px 6px;font-family:monospace">current_date()</td><td style="padding:3px 6px;color:#94a3b8">2026-03-01</td></tr>' +
    '<tr><td style="padding:3px 6px;font-family:monospace">date_sub(current_date(), 1)</td><td style="padding:3px 6px;color:#94a3b8">2026-02-28</td></tr>' +
    '<tr><td style="padding:3px 6px;font-family:monospace">date_format(current_date(),\'MM-dd-yyyy\')</td><td style="padding:3px 6px;color:#94a3b8">03-01-2026</td></tr>' +
    '<tr><td style="padding:3px 6px;font-family:monospace">last_day(current_date())</td><td style="padding:3px 6px;color:#94a3b8">2026-03-31</td></tr>' +
  '</table>';

var _FAIL_MODE_TOOLTIP =
  '<b>FLAG</b>: keeps all rows, adds <code>_is_valid</code> &amp; <code>_validation_errors</code> columns.<br>' +
  '<b>DROP</b>: removes invalid rows, routes them to the Error Path.<br>' +
  '<b>ABORT</b>: raises an error immediately if any row fails validation.';

/* refreshValidateRulesUI is defined below */
function refreshValidateRulesUI(node) {
  var $ruleEditor = $('#pv-rules-editor');
  if (!$ruleEditor.length) return;
  var $container = $ruleEditor.closest('.list-editor');
  if (!$container.length) return;
  var $temp = $('<div>').html(DS.fn.buildTableValidationRulesEditor('pv-rules', node.validate_rules || []));
  $container.replaceWith($temp.children().first());
  rebindPropsApply(node);
}

function renderValidateProps(body, node) {
  /* Auto-derive validated/error dataset names from connected source input */
  function _deriveValidateDatasets(srcAlias) {
    var srcNode = S.nodes.find(function(n) {
      return (n.name || n.id || '') === srcAlias;
    });
    var srcDs = (srcNode && (srcNode.dataset_name || srcNode.source_file_name)) || '';
    if (srcDs) {
      /* BANK-BATCH-INPUT.DAT → BANK-BATCH-INPUTVAL.DAT / BANK-BATCH-INPUTERR.DAT */
      node.dataset_name       = srcDs.replace(/(\.[^.]+)$/, 'VAL$1');
      node.error_dataset_name = srcDs.replace(/(\.[^.]+)$/, 'ERR$1');
    }
  }
  var _pvSrcAlias = (node.source_inputs || [])[0] || '';
  if (_pvSrcAlias) _deriveValidateDatasets(_pvSrcAlias);
  var curVDataset = node.dataset_name || node.validated_file_name || '';
  var curEDataset = node.error_dataset_name || node.error_file_name || '';
  var failTooltipHtml =
    '<span class="field-info-tooltip">' +
      '<i class="fa-solid fa-circle-info info-icon"></i>' +
      '<span class="tooltip-text">' + _FAIL_MODE_TOOLTIP + '</span>' +
    '</span>';

  /* Test data file variables */
  var lrFile         = node._last_run_file || '';
  var lrBtnClass     = lrFile ? ' has-file' : '';
  var lrBtnLabel     = lrFile
    ? '<i class="fa-solid fa-check"></i> ' + DS.fn.esc(lrFile)
    : '<i class="fa-solid fa-file-arrow-up"></i> Upload Last Run File';
  var ctrlTestFile      = node._test_ctrl_file || '';
  var ctrlTestBtnClass  = ctrlTestFile ? ' has-file' : '';
  var ctrlTestBtnLabel  = ctrlTestFile
    ? '<i class="fa-solid fa-check"></i> ' + DS.fn.esc(ctrlTestFile)
    : '<i class="fa-solid fa-file-arrow-up"></i> Upload Expected Control File';

  /* Control file schema */
  var ctrlSchemaFile  = node._ctrl_schema_file || '';
  var ctrlFieldCount  = node.ctrl_file_fields ? node.ctrl_file_fields.length : 0;
  var ctrlSchemaBtnClass = ctrlSchemaFile ? ' has-file' : '';

  var curFreqV = (node.frequency || '').toUpperCase();

  /* Previous day path info: curated/<iface>/<freq>/PREV_DATE/<output_dataset> */
  var prevDayInfo = derivePreviousDayInfo(node);
  var prevDayBanner = '';
  if (node.previous_day_check && prevDayInfo) {
    var _rawBucketPD = (S._appSettings.raw_bucket_prefix || '').replace(/\/$/, '') || '<raw-path>';
    var _pvIface = DS.fn._getInterfaceName() || '<interface>';
    var _pvFreq  = prevDayInfo.frequency || '<frequency>';
    var _pvOutDs = prevDayInfo.dataset_name || '<INPUTFILENAME>';
    var _prevDayPath = _rawBucketPD + '/' + _pvIface + '/' + _pvFreq + '/PREV_DATE/' + _pvOutDs;
    prevDayBanner = '<div class="path-info-banner" id="pv-prev-day-preview">' +
      '<i class="fa-solid fa-circle-info"></i> Previous day raw layer path: <code>' + DS.fn.esc(_prevDayPath) + '</code>' +
    '</div>';
  }

  /* Fail modes with FLAGGED */
  var FAIL_MODES_EXT = ['ABORT', 'DROP', 'FLAGGED'];

  /* Header fields from connected input node for Previous Day Check dropdown & ctrl field date builder */
  var _inputNodePD    = _getInputNodeForValidate(node);
  var _hdrFieldsPD    = (_inputNodePD && Array.isArray(_inputNodePD.header_fields)) ? _inputNodePD.header_fields : [];
  var _hdrFieldNamesPD = _hdrFieldsPD.map(function(f){ return f.name || ''; }).filter(Boolean);
  var _curPdHdrField  = node.previous_day_header_date_field || '';
  var _hdrFieldOpts   = '<option value="">-- SELECT --</option>' +
    _hdrFieldsPD.map(function(f) {
      var n = f.name || '';
      return '<option value="' + DS.fn.esc(n) + '"' + (_curPdHdrField === n ? ' selected' : '') + '>' + DS.fn.esc(n) + '</option>';
    }).join('');

  /* Trailer fields from connected input node for Record Count Check dropdown */
  var _trlFieldsRC   = (_inputNodePD && Array.isArray(_inputNodePD.trailer_fields)) ? _inputNodePD.trailer_fields : [];
  var _curRcTrlField = node.record_count_trailer_field || '';
  var _trlFieldOpts  = '<option value="">-- SELECT --</option>' +
    _trlFieldsRC.map(function(f) {
      var n = f.name || '';
      return '<option value="' + DS.fn.esc(n) + '"' + (_curRcTrlField === n ? ' selected' : '') + '>' + DS.fn.esc(n) + '</option>';
    }).join('');

  var hasPrevDay     = !!(node.previous_day_check || node.last_run_check);
  var hasRecordCount = !!node.record_count_check;
  var hasCtrl        = !!node.ctrl_file_create;

  /* Record count path banner: raw/<iface>/<freq>/{YYYYMMDD}/<dataset> */
  var rcBanner = '';
  if (hasRecordCount && prevDayInfo) {
    var _rawBucketRC = (S._appSettings.raw_bucket_prefix || '').replace(/\/$/, '') || '<raw-path>';
    var _rcIface = DS.fn._getInterfaceName() || '<interface>';
    var _rcFreq  = prevDayInfo.frequency || '<frequency>';
    var _rcDs    = prevDayInfo.dataset_name || '<INPUTFILENAME>';
    var _rcPath  = _rawBucketRC + '/' + _rcIface + '/' + _rcFreq + '/{YYYYMMDD}/' + _rcDs;
    rcBanner = '<div class="path-info-banner" id="pv-record-count-preview">' +
      '<i class="fa-solid fa-circle-info"></i> Validating record count from input dataset: <code>' + DS.fn.esc(_rcPath) + '</code>' +
    '</div>';
  }

  $(body).html(
    /* ── STEP INFO ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID',     textInput('pv-id',   node.step_id,    'e.g. IFACE-DATA-VALIDATION-01')) +
      formRow('Description', textInput('pv-desc', node.description, 'Describe this validation')) +
      formRow('Output Alias',textInput('pv-alias', node.output_alias, 'e.g. IFACE-DATA-VALIDATION-OUT-01')) +
      formRow('Source Input', DS.fn.singleSourceSelect('pv-src', (node.source_inputs||[])[0] || '', node.id)) +
    '</div>' +

    /* ── DATASET DETAILS ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Dataset Details</div>' +
      formRow('Frequency',
        '<select id="pv-frequency" class="form-select">' +
          '<option value="">-- SELECT --</option>' +
          C.FREQUENCIES.map(function(f){ return '<option value="' + f + '"' + (curFreqV === f ? ' selected' : '') + '>' + f + '</option>'; }).join('') +
        '</select>',
        'How often this validation runs') +
      /* Auto-derived names shown as combined path+filename info banners */
      DS.fn._pathInfoBannerHtml('pv-valid-path-preview', S._appSettings.validation_bucket_prefix || '', curFreqV, curVDataset, '\u2705 Validated file:') +
      DS.fn._pathInfoBannerHtml('pv-error-path-preview', S._appSettings.error_bucket_prefix || '', curFreqV, curEDataset, '\u274c Error file:') +
    '</div>' +

    /* ── DATA VALIDATION SETTINGS ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Data Validation Settings</div>' +
      '<div class="form-row">' +
        '<label>On Failure ' + failTooltipHtml + '</label>' +
        '<select id="pv-fail-mode" class="form-select">' +
          FAIL_MODES_EXT.map(function(m){ return '<option value="' + m + '"' + ((node.fail_mode || 'ABORT').toUpperCase() === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') +
        '</select>' +
      '</div>' +

      /* Previous Day Check — toggle only, path banner shown when enabled */
      '<div class="pv-feature-card">' +
        '<div class="pv-feature-card-header">' +
          '<i class="fa-solid fa-calendar-check"></i>' +
          '<span>Previous Day Check</span>' +
          '<div class="pv-card-toggle">' +
            '<input type="checkbox" id="pv-prev-day-check"' + (hasPrevDay ? ' checked' : '') + '>' +
            '<label for="pv-prev-day-check">Enable</label>' +
          '</div>' +
        '</div>' +
        '<div id="pv-prev-day-section"' + (hasPrevDay ? '' : ' style="display:none;"') + '>' +
          '<div class="pv-feature-card-body">' +
            '<p style="font-size:11px;color:#64748b;margin:0 0 6px">' +
              'Previous business day is <strong>auto-calculated at runtime</strong> (skips holidays). Header date is always validated as a real calendar date.' +
            '</p>' +
            formRow('Header Date Field',
              '<select id="pv-prev-day-header-field" class="form-select">' + _hdrFieldOpts + '</select>',
              'Header field from the input file that contains the run date') +
            prevDayBanner +
            '<div class="path-info-banner">' +
              '<i class="fa-solid fa-calendar-check"></i> Calendar date check: header date is always validated as a real calendar date — invalid dates (e.g. Feb\u00a030) will fail the job.' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* Record Count Check */
      '<div class="pv-feature-card">' +
        '<div class="pv-feature-card-header">' +
          '<i class="fa-solid fa-hashtag"></i>' +
          '<span>Record Count Check</span>' +
          '<div class="pv-card-toggle">' +
            '<input type="checkbox" id="pv-record-count-check"' + (hasRecordCount ? ' checked' : '') + '>' +
            '<label for="pv-record-count-check">Enable</label>' +
          '</div>' +
        '</div>' +
        '<div id="pv-record-count-section"' + (hasRecordCount ? '' : ' style="display:none;"') + '>' +
          '<div class="pv-feature-card-body">' +
            '<p style="font-size:11px;color:#64748b;margin:0 0 6px">' +
              'Compares the actual record count of the input dataset with the count in the <strong>trailer record</strong>. Fails the job if they do not match.' +
            '</p>' +
            formRow('Trailer Count Field',
              '<select id="pv-record-count-trailer-field" class="form-select">' + _trlFieldOpts + '</select>',
              'Trailer field from the input file that contains the expected record count') +
            rcBanner +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>' +

    /* ── DATA VALIDATION RULES (table-based) ── */
    '<div class="props-section">' +
      '<div class="props-section-title props-section-title-row">' +
        '<span>Data Validation Rules</span>' +
        '<button class="tbl-hdr-icon-btn" id="btn-load-schema-rules" title="Auto-fill rules from the source input schema">' +
          '<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-fill' +
        '</button>' +
      '</div>' +
      DS.fn.buildTableValidationRulesEditor('pv-rules', node.validate_rules || []) +
    '</div>' +

    /* ── TEST DATA (starts collapsed) ── */
    '<div class="props-section" data-default-fold="collapsed">' +
      '<div class="props-section-title">Test Data</div>' +

      /* Last Run File — shown only when Previous Day Check is enabled */
      '<div id="pv-test-lr-wrap"' + (hasPrevDay ? '' : ' style="display:none"') + '>' +
        '<div class="props-import-section" style="margin-bottom:10px">' +
          '<div class="props-import-title">' +
            '<i class="fa-solid fa-calendar-day" style="color:#0ea5e9"></i> Last Run File' +
            '<span style="font-size:10px;color:#94a3b8;margin-left:5px">— for Previous Day Check</span>' +
          '</div>' +
          '<button type="button" class="btn-import-sm' + lrBtnClass + '" id="pv-last-run-file-btn" title="Upload a last-run file so the Previous Day Check can find the previous date">' +
            lrBtnLabel +
          '</button>' +
          '<div class="import-file-badge' + (lrFile ? ' visible' : '') + '" id="pv-last-run-file-badge">' +
            (lrFile ? '\u2713 ' + DS.fn.esc(lrFile) : '') +
          '</div>' +
        '</div>' +
      '</div>' +

      /* Empty state when no previous day check */
      (!hasPrevDay
        ? '<p style="font-size:12px;color:#94a3b8;margin:4px 0 0">Enable <strong>Previous Day Check</strong> above to upload test files here.</p>'
        : ''
      ) +
    '</div>');

  rebindPropsApply(node);

  /* Dynamic validate path preview updates */
  var $_pvFreq         = $('#pv-frequency');
  var $_pvValidPreview = $('#pv-valid-path-preview');
  var $_pvErrorPreview = $('#pv-error-path-preview');
  function _updateValidatePreview() {
    var f     = $_pvFreq.val() || '';
    var iface = DS.fn._getInterfaceName();
    var dv    = node.dataset_name       || '';
    var de    = node.error_dataset_name || '';
    if ($_pvValidPreview.length) {
      $_pvValidPreview.html('<i class="fa-solid fa-circle-info"></i> \u2705 Valid: Files will be processed as: <code>' +
        DS.fn.esc(DS.fn._buildPathPreview(S._appSettings.validation_bucket_prefix || '', iface, f, dv)) + '</code>');
    }
    if ($_pvErrorPreview.length) {
      $_pvErrorPreview.html('<i class="fa-solid fa-circle-info"></i> \u274c Error: Files will be processed as: <code>' +
        DS.fn.esc(DS.fn._buildPathPreview(S._appSettings.error_bucket_prefix || '', iface, f, de)) + '</code>');
    }
  }
  $_pvFreq.on('change', _updateValidatePreview);
  /* Re-derive names when source input changes */
  $('#pv-src').on('change', function() {
    var alias = $(this).val() || '';
    if (!alias) return;
    var srcNode = S.nodes.find(function(n){ return (n.name||n.id||'') === alias; });
    var srcDs = (srcNode && (srcNode.dataset_name || srcNode.source_file_name)) || '';
    if (srcDs) {
      node.dataset_name       = srcDs.replace(/(\.[^.]+)$/, 'VAL$1');
      node.error_dataset_name = srcDs.replace(/(\.[^.]+)$/, 'ERR$1');
    }
    _updateValidatePreview();
  });

  /* Previous Day Check toggle — also shows/hides the test data section */
  var $prevDayCheck   = $('#pv-prev-day-check');
  var $prevDaySection = $('#pv-prev-day-section');
  var $testLrWrap     = $('#pv-test-lr-wrap');
  $prevDayCheck.on('change', function() {
    var on = $(this).is(':checked');
    $prevDaySection.css('display', on ? '' : 'none');
    $testLrWrap.css('display', on ? '' : 'none');
  });

  /* Last Run File button (in Test Data section) */
  var $lastRunFileBtn = $('#pv-last-run-file-btn');
  if ($lastRunFileBtn.length) {
    $lastRunFileBtn.on('click', function() {
      DS.fn.uploadLastRunFile(node, 'pv-last-run-file-badge', $lastRunFileBtn[0]);
    });
  }

  /* Expected Control File button (in Test Data section) */
  var $testCtrlBtn = $('#pv-test-ctrl-file-btn');
  if ($testCtrlBtn.length) {
    $testCtrlBtn.on('click', function() {
      DS.fn.uploadTestCtrlFile(node, 'pv-test-ctrl-file-badge', $testCtrlBtn[0]);
    });
  }

  /* Record Count Check toggle */
  $('#pv-record-count-check').on('change', function() {
    $('#pv-record-count-section').css('display', $(this).is(':checked') ? '' : 'none');
  });

  /* Control File Creation toggle — also shows/hides the test ctrl section */
  var $ctrlCreateCheck   = $('#pv-ctrl-create-check');
  var $ctrlCreateSection = $('#pv-ctrl-create-section');
  var $testCtrlWrap      = $('#pv-test-ctrl-wrap');
  $ctrlCreateCheck.on('change', function() {
    var on = $(this).is(':checked');
    $ctrlCreateSection.css('display', on ? '' : 'none');
    $testCtrlWrap.css('display', on ? '' : 'none');
  });

  /* cf-expr-select change handler is registered globally in ds-editors.js */

  var $ctrlImportBtn = $('#pv-ctrl-import-schema-btn');
  if ($ctrlImportBtn.length) {
    $ctrlImportBtn.on('click', function() {
      _pickAndParseCtrlSchema(node, 'pv-ctrl-fields', 'pv-ctrl-schema-badge', $ctrlImportBtn[0]);
    });
  }

  var $btnFromSource = $('#btn-load-ctrl-from-source');
  if ($btnFromSource.length) {
    $btnFromSource.on('click', function() {
      var pvSrcVal = ($('#pv-src').val() || '').trim();
      if (pvSrcVal) node.source_inputs = [pvSrcVal].filter(Boolean);
      var srcFields = [];
      (node.source_inputs || []).some(function(alias) {
        var f = DS.fn.getFieldsForAlias(alias);
        if (f.length) { srcFields = f; return true; }
        return false;
      });
      if (!srcFields.length) { DS.fn.toast('No schema found for the selected source input(s).', 'error'); return; }
      readListEditorIntoNode(node);
      node.ctrl_file_fields = srcFields.map(function(f) {
        return { name: f.name || '', type: (f.type || 'STRING').toUpperCase(), expression: '', begin: 0, length: f.length || 0, format: f.format || '', just_right: !!f.just_right };
      });
      /* Update ctrl fields editor in-place to avoid fold/scroll reset */
      var $existingEditor = $('#pv-ctrl-fields-editor');
      if ($existingEditor.length) {
        var $t = $('<div>').html(DS.fn.buildControlFileFieldsEditor('pv-ctrl-fields', node.ctrl_file_fields));
        $existingEditor.replaceWith($t.children().first());
        rebindPropsApply(node);
      } else {
        showPropsPanel(node);
      }
      DS.fn.toast('Loaded ' + node.ctrl_file_fields.length + ' field(s) from source.', 'success');
    });
  }

  var $btnSchema = $('#btn-load-schema-rules');
  if ($btnSchema.length) {
    $btnSchema.on('click', function() {
      var pvSrcVal = ($('#pv-src').val() || '').trim();
      if (pvSrcVal) node.source_inputs = [pvSrcVal].filter(Boolean);
      var fields = [];
      (node.source_inputs || []).some(function(alias) {
        var f = DS.fn.getFieldsForAlias(alias);
        if (f.length) { fields = f; return true; }
        return false;
      });
      if (!fields.length) { DS.fn.toast('No schema found for the selected source input(s).', 'error'); return; }
      node.validate_rules = DS.fn.fieldsToValidateRules(fields);
      refreshValidateRulesUI(node);
      DS.fn.toast('Loaded ' + fields.length + ' rule(s) from schema.', 'success');
    });
  }
}

/* ---- Control file schema import for Validate ---- */
function _pickAndParseCtrlSchema(node, ctrlFieldsNs, badgeId, btn) {
  var $input = $('<input>').attr('type', 'file')
    .attr('accept', '.json,.csv,.txt,.cbl,.cpy,.cob').css('display', 'none');
  $(document.body).append($input);
  $input.on('change', function() {
    var file = $input[0].files && $input[0].files[0];
    if (!file) { $input.remove(); return; }
    var ext = file.name.split('.').pop().toLowerCase();
    $(btn).html('<i class="fa-solid fa-spinner fa-spin"></i> Parsing\u2026');
    btn.disabled = true;

    var applyCtrlFields = function(parsedFields, filename) {
      btn.disabled = false;
      if (!parsedFields.length) { DS.fn.toast('No fields found in schema file.', 'error'); return; }
      readListEditorIntoNode(node);
      node.ctrl_file_fields = parsedFields.map(function(f) {
        var existing = (node.ctrl_file_fields || []).find(function(x){ return x.name === f.name; });
        return { name: f.name || '', type: (f.type || 'STRING').toUpperCase(), expression: existing ? (existing.expression || '') : '', length: f.length || 0, begin: (existing ? (existing.begin || 0) : 0), format: (existing ? (existing.format || '') : ''), just_right: !!f.just_right };
      });
      node._ctrl_schema_file = filename;
      /* Update ctrl fields editor in-place — avoids fold/scroll reset from full re-render */
      if (S.selectedNodeId === node.id) {
        var $existingEditor = $('#pv-ctrl-fields-editor');
        if ($existingEditor.length) {
          var _ctrlBtnHtml =
            '<button type="button" class="tbl-hdr-icon-btn has-file" id="pv-ctrl-import-schema-btn" title="Re-import schema \u2014 ' + DS.fn.esc(filename) + ' (' + parsedFields.length + ' fields)">' +
              '<i class="fa-solid fa-file-import"></i> Import' +
            '</button>';
          var $tpl = $('<div>').html(DS.fn.buildControlFileFieldsEditor('pv-ctrl-fields', node.ctrl_file_fields || [], _ctrlBtnHtml));
          $existingEditor.replaceWith($tpl.children().first());
          /* Re-bind the import click handler on the new button */
          var $newBtn = $('#pv-ctrl-import-schema-btn');
          if ($newBtn.length) {
            $newBtn.on('click', function() {
              _pickAndParseCtrlSchema(node, ctrlFieldsNs, badgeId, $newBtn[0]);
            });
          }
          rebindPropsApply(node);
        } else {
          showPropsPanel(node);
        }
      }
      DS.fn.toast('Schema imported: ' + parsedFields.length + ' fields', 'success');
    };

    if (['cbl', 'cpy', 'cob'].indexOf(ext) >= 0) {
      var configPath = ($('#current-file').text() || '').trim();
      if (!configPath || configPath === 'Select an interface') {
        configPath = ($('#toolbar-config-name').val() || '').trim() || 'config.json';
      }
      if (!configPath.toLowerCase().endsWith('.json')) configPath += '.json';
      var fd = new FormData();
      fd.append('file', file);
      fd.append('node_name', node.name || node.id);
      fd.append('node_type', 'validate_ctrl');
      fetch('/api/config/' + encodeURIComponent(configPath) + '/node-copybook', {method: 'POST', body: fd})
        .then(function(r) { return r.json(); })
        .then(function(res) {
          btn.disabled = false;
          if (res.error) { DS.fn.toast('Schema parse error: ' + res.error, 'error'); return; }
          applyCtrlFields(res.fields || [], file.name);
        })
        .catch(function(e) { btn.disabled = false; DS.fn.toast('Schema import failed: ' + (e.message || e), 'error'); });
    } else {
      var reader = new FileReader();
      reader.onload = function(ev) {
        btn.disabled = false;
        try {
          var text = ev.target.result;
          var fields = ext === 'json' ? DS.fn._parseSchemaJSON(text)
                     : ext === 'csv'  ? DS.fn._parseSchemaCSV(text)
                     : DS.fn._parseSchemaTxt(text);
          applyCtrlFields(fields, file.name);
        } catch(e) { DS.fn.toast('Schema parse failed: ' + e.message, 'error'); }
      };
      reader.onerror = function() { btn.disabled = false; DS.fn.toast('File read failed', 'error'); };
      reader.readAsText(file);
    }
    $input.remove();
  });
  $input[0].click();
}


/* ================================================================
   props/steps.js
================================================================ */
/**
 * props/steps.js — Step node property panel renderers:
 *   select, filter, join, aggregate, union, custom, oracle_write.
 */

/* ---- SELECT / Mapping ---- */
function renderSelectProps(body, node) {
  $(body).html(
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID', textInput('ps-id', node.step_id, 'e.g. map_columns')) +
      formRow('Description', textInput('ps-desc', node.description, 'Describe this step')) +
      formRow('Output Alias', textInput('ps-alias', node.output_alias, 'e.g. mapped_data')) +
      formRow('Source Input', DS.fn.singleSourceSelect('ps-src', (node.source_inputs || [])[0] || '', node.id)) +
    '</div>' +
    '<div class="props-section">' +
      '<div class="props-section-title props-section-title-row">' +
        'Expressions' +
        '<button class="btn-from-schema" id="btn-auto-match-columns" title="Auto-match source columns to target columns using fuzzy matching">&#9889; Auto-Match</button>' +
      '</div>' +
      DS.fn.buildSelectExpressionsEditor('ps-exprs', node.select_expressions || [], node) +
    '</div>');

  rebindPropsApply(node);

  var $btnAutoMatch = $('#btn-auto-match-columns');
  if ($btnAutoMatch.length) {
    $btnAutoMatch.on('click', function() {
      var srcAlias = DS.fn.getSingleSelectValue('ps-src');
      if (srcAlias) node.source_inputs = [srcAlias];
      var srcFields = [];
      (node.source_inputs || []).some(function(alias) {
        var f = DS.fn.getFieldsForAlias(alias);
        if (f.length) { srcFields = f; return true; }
        return false;
      });
      if (!srcFields.length) {
        DS.fn.toast('No source fields found. Connect a source with a schema first.', 'error');
        return;
      }
      var srcNames = srcFields.map(function(f) { return f.name; });
      var dstFields = [];
      S.connections.forEach(function(c) {
        if (c.from === node.id) {
          var dn = DS.fn.getNode(c.to);
          if (dn && Array.isArray(dn.fields)) {
            dn.fields.forEach(function(f) {
              if (f.name && dstFields.indexOf(f.name) < 0) dstFields.push(f.name);
            });
          }
        }
      });
      var mappings = DS.fn.buildFuzzyMappings(srcNames, dstFields.length ? dstFields : srcNames);
      readListEditorIntoNode(node);
      node.select_expressions = mappings.map(function(m) {
        return { expression: m.expression, target: m.target, operation: 'MOVE' };
      });
      showPropsPanel(node);
      DS.fn.toast('Auto-matched ' + mappings.length + ' column(s)!', 'info');
    });
  }
}

/* ---- FILTER ---- */
function renderFilterProps(body, node) {
  $(body).html(
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID', textInput('pf-id', node.step_id, 'e.g. filter_active')) +
      formRow('Description', textInput('pf-desc', node.description, 'Describe this step')) +
      formRow('Output Alias', textInput('pf-alias', node.output_alias, 'e.g. active_records')) +
      formRow('Source Inputs', DS.fn.multiSourceSelect('pf-src', node.source_inputs || [], node.id)) +
    '</div>' +
    '<div class="props-section">' +
      '<div class="props-section-title">Conditions</div>' +
      DS.fn.buildFilterConditionsEditor('pf-conds', node.filter_conditions || []) +
    '</div>');
  rebindPropsApply(node);
}

/* ---- JOIN ---- */
function renderJoinProps(body, node) {
  $(body).html(
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID', textInput('pj-id', node.step_id, 'e.g. join_cust_trans')) +
      formRow('Description', textInput('pj-desc', node.description, 'Describe this step')) +
      formRow('Output Alias', textInput('pj-alias', node.output_alias, 'e.g. joined_data')) +
    '</div>' +
    '<div class="props-section">' +
      '<div class="props-section-title">Join Settings</div>' +
      formRow('Left Input', DS.fn.singleSourceSelect('pj-left', node.join_left, node.id)) +
      formRow('Right Input', DS.fn.singleSourceSelect('pj-right', node.join_right, node.id)) +
      formRow('Join Type', selectInput('pj-jtype', C.JOIN_TYPES, (node.join_type || 'INNER').toUpperCase())) +
    '</div>' +
    '<div class="props-section">' +
      '<div class="props-section-title">Join Keys</div>' +
      DS.fn.buildJoinKeysEditor('pj-keys', node.join_keys || []) +
    '</div>');
  rebindPropsApply(node);
}

/* ---- AGGREGATE ---- */
function renderAggregateProps(body, node) {
  $(body).html(
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID', textInput('pa-id', node.step_id, 'e.g. agg_by_region')) +
      formRow('Description', textInput('pa-desc', node.description, 'Describe this step')) +
      formRow('Output Alias', textInput('pa-alias', node.output_alias, 'e.g. region_totals')) +
      formRow('Source Inputs', DS.fn.multiSourceSelect('pa-src', node.source_inputs || [], node.id)) +
    '</div>' +
    '<div class="props-section">' +
      '<div class="props-section-title">Group By</div>' +
      DS.fn.buildGroupByEditor('pa-grp', node.agg_group_by || []) +
    '</div>' +
    '<div class="props-section">' +
      '<div class="props-section-title">Aggregations</div>' +
      DS.fn.buildAggregationsEditor('pa-aggs', node.agg_aggregations || []) +
    '</div>');
  rebindPropsApply(node);
}

/* ---- UNION ---- */
function renderUnionProps(body, node) {
  $(body).html(
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID', textInput('pu-id', node.step_id, 'e.g. union_all')) +
      formRow('Description', textInput('pu-desc', node.description, 'Describe this step')) +
      formRow('Output Alias', textInput('pu-alias', node.output_alias, 'e.g. combined_data')) +
      formRow('Source Inputs', DS.fn.multiSourceSelect('pu-src', node.source_inputs || [], node.id)) +
      '<div class="form-row checkbox-row">' +
        '<input type="checkbox" id="pu-distinct"' + (node.union_distinct ? ' checked' : '') + ' />' +
        '<label for="pu-distinct">Distinct (remove duplicates)</label>' +
      '</div>' +
    '</div>');
  rebindPropsApply(node);
}

/* ---- CUSTOM ---- */
function renderCustomProps(body, node) {
  var logicStr = node.custom_logic || '{}';
  if (typeof logicStr === 'object') logicStr = JSON.stringify(logicStr, null, 2);
  $(body).html(
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID', textInput('pc-id', node.step_id, 'e.g. custom_sort')) +
      formRow('Description', textInput('pc-desc', node.description, 'Describe this step')) +
      formRow('Output Alias', textInput('pc-alias', node.output_alias, 'e.g. sorted_data')) +
      formRow('Source Inputs', DS.fn.multiSourceSelect('pc-src', node.source_inputs || [], node.id)) +
    '</div>' +
    '<div class="props-section">' +
      '<div class="props-section-title">Logic (JSON)</div>' +
      '<div class="form-row">' +
        '<textarea id="pc-logic" rows="8">' + DS.fn.esc(logicStr) + '</textarea>' +
      '</div>' +
    '</div>');
  rebindPropsApply(node);
}

/* ---- ORACLE WRITE ---- */
function renderOracleWriteProps(body, node) {
  $(body).html(
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID',     textInput('pow-id',   node.step_id    || '', 'e.g. write_oracle_customers')) +
      formRow('Description', textInput('pow-desc', node.description || '', 'Describe this Oracle write step')) +
      formRow('Source Input', DS.fn.singleSourceSelect('pow-src', (node.source_inputs || [])[0] || '', node.id)) +
    '</div>' +

    '<div class="props-section">' +
      '<div class="props-section-title">Oracle Database</div>' +
      formRow('Host',         textInput('pow-host',    node.ora_host         || '', 'e.g. oracle-db.example.com')) +
      formRow('Port',         textInput('pow-port',    node.ora_port         || '1521', '1521')) +
      formRow('Service Name', textInput('pow-service', node.ora_service_name || '', 'e.g. ORCL or MYDB.example.com')) +
    '</div>' +

    '<div class="props-section">' +
      '<div class="props-section-title">Target Table</div>' +
      formRow('Schema Name', textInput('pow-schema', node.ora_schema || '', 'e.g. MYSCHEMA')) +
      formRow('Table Name',  textInput('pow-table',  node.ora_table  || '', 'e.g. CUSTOMER_DATA')) +
      formRow('Load Mode',   selectInput('pow-load-mode', C.ORACLE_LOAD_MODES, (node.ora_load_mode || 'APPEND').toUpperCase()),
        'INSERT: empty table only \xb7 APPEND: add rows \xb7 TRUNCATE_INSERT: clear then load \xb7 REPLACE: drop/recreate') +
    '</div>' +

    '<div class="props-section">' +
      '<div class="props-section-title">SQL*Loader Options</div>' +
      formRow('Bad File Path',     textInput('pow-bad-file',     node.ora_bad_file     || '/tmp/sqlldr/output.bad',  '/tmp/sqlldr/output.bad'),
        'Rows that fail to load are written here') +
      formRow('Log File Path',     textInput('pow-log-file',     node.ora_log_file     || '/tmp/sqlldr/output.log',  '/tmp/sqlldr/output.log')) +
      formRow('Discard File Path', textInput('pow-discard-file', node.ora_discard_file || '', '/tmp/sqlldr/output.dsc (optional)'),
        'Optional \u2014 rows rejected by WHEN clauses') +
      formRow('Batch Size',        textInput('pow-batch-size',   String(node.ora_batch_size || '10000'), '10000'),
        'Rows committed per batch (ROWS parameter)') +
    '</div>' +

    '<div class="props-section">' +
      '<div class="props-section-title">HashiCorp Vault \u2014 Credentials</div>' +
      '<div class="props-section-hint" style="padding:4px 0 10px;color:#64748b;font-size:11px;line-height:1.5">' +
        'Credentials are <strong>never stored in the config</strong>. They are fetched at runtime from Vault.<br>' +
        'Set <code>VAULT_ADDR</code> and <code>VAULT_TOKEN</code> (or <code>VAULT_ROLE_ID</code> + <code>VAULT_SECRET_ID</code>) as env vars.' +
      '</div>' +
      formRow('Vault Path',         textInput('pow-vault-path',      node.vault_path          || '', 'e.g. secret/data/oracle/prod'),
        'KV v2 path containing the Oracle credentials') +
      formRow('Username Key',       textInput('pow-vault-user-key',  node.vault_username_key  || 'username', 'username'),
        'Key name in the Vault secret that holds the DB username') +
      formRow('Password Key',       textInput('pow-vault-pass-key',  node.vault_password_key  || 'password', 'password'),
        'Key name in the Vault secret that holds the DB password') +
    '</div>');

  rebindPropsApply(node);
}


/* ================================================================
   props/core.js
================================================================ */
/**
 * props/core.js — Props panel orchestration: showPropsPanel, showEmptyProps, applyPropsToNode,
 *                 form helpers, list editor bindings, propagateNodeIdAndAlias, studioConfirm,
 *                 initSectionFold.
 */

/* ---- Callback injection for circular dep avoidance ---- */




/* ---- Form helpers ---- */
function formRow(label, inputHtml, infoText) {
  var labelTag = '<label title="' + DS.fn.esc(label) + '">' + label + '</label>';
  if (infoText) {
    var infoIcon =
      '<span class="field-info-tooltip">' +
        '<i class="fa-solid fa-circle-info info-icon" aria-label="More info"></i>' +
        '<span class="tooltip-text">' + infoText + '</span>' +
      '</span>';
    return '<div class="form-row">' +
             labelTag +
             '<div class="form-row-val">' + infoIcon + inputHtml + '</div>' +
           '</div>';
  }
  return '<div class="form-row">' + labelTag + inputHtml + '</div>';
}

function textInput(id, val, placeholder) {
  return '<input type="text" id="' + id + '" value="' + DS.fn.esc(val||'') + '" placeholder="' + DS.fn.esc(placeholder||'') + '" />';
}

function selectInput(id, options, selected) {
  var html = '<select id="' + id + '">';
  options.forEach(function(o){ html += '<option value="' + DS.fn.esc(o) + '"' + (o===selected?' selected':'') + '>' + DS.fn.esc(o) + '</option>'; });
  html += '</select>';
  return html;
}

function partitionColSelect(id, val) {
  val = (val === undefined || val === null) ? 'load_date()' : val;
  var matched = C.PARTITION_COL_OPTIONS.some(function(o){ return o.value === val; });
  var html = '<select id="' + id + '" class="form-select">';
  C.PARTITION_COL_OPTIONS.forEach(function(o){
    html += '<option value="' + DS.fn.esc(o.value) + '"' + (o.value === val ? ' selected' : '') + '>' + DS.fn.esc(o.label) + '</option>';
  });
  if (!matched && val) {
    html += '<option value="' + DS.fn.esc(val) + '" selected>' + DS.fn.esc(val) + '</option>';
  }
  html += '</select>';
  return html;
}

/* ---- Show empty props panel ---- */
function showEmptyProps() {
  var $drawer = $('#node-props-drawer');
  if ($drawer.length) $drawer.removeClass('drawer-open');
  S._currentPropsNode = null;
}

/* ---- Show props panel for a node ---- */
function showPropsPanel(node) {
  var $drawer = $('#node-props-drawer');
  if (!$drawer.length) return;

  S._currentPropsNode = node;

  if (node.source_inputs !== undefined) {
    node.source_inputs = DS.fn.deriveSourceInputs(node.id);
  }

  var meta = C.TYPE_META[node.type] || C.TYPE_META.custom;
  var icon = C.TYPE_ICONS[node.type] || C.TYPE_ICONS.custom;
  var $titleEl = $('#props-title');
  var $badge   = $('#props-type-badge');
  var $iconEl  = $('#props-type-icon');
  if ($titleEl.length) $titleEl.text('Properties');
  if ($badge.length)   { $badge.text(meta.label); $badge.css('background', meta.color); }
  if ($iconEl.length)  { $iconEl.html(icon); $iconEl.css('background', meta.color); $iconEl.attr('title', meta.label); }

  var $body = $('#props-body');
  var body = $body[0];
  if ($body.length) $body.html('');

  if (node.type === 'input')          renderInputProps(body, node);
  else if (node.type === 'output')    renderOutputProps(body, node);
  else if (node.type === 'select')    renderSelectProps(body, node);
  else if (node.type === 'filter')    renderFilterProps(body, node);
  else if (node.type === 'join')      renderJoinProps(body, node);
  else if (node.type === 'aggregate') renderAggregateProps(body, node);
  else if (node.type === 'union')     renderUnionProps(body, node);
  else if (node.type === 'validate')      renderValidateProps(body, node);
  else if (node.type === 'oracle_write')  renderOracleWriteProps(body, node);
  else if (node.type === 'efs_write')     renderOutputProps(body, node);
  else if (node.type === 'ctrl_file')    renderCtrlFileProps(body, node);
  else renderCustomProps(body, node);

  DS.fn.initSrcDropdowns(body);

  $drawer.addClass('drawer-open');

  /* Reset dirty flag and track form changes for unsaved-changes detection */
  S._propsDirty = false;
  if ($body.length) {
    $body.on('input',  function() { S._propsDirty = true; });
    $body.on('change', function() { S._propsDirty = true; });
  }
}

/* ---- Sync canvas connections from source select ---- */
function syncConnectionsFromSourceSelect(node, selectedAliases) {
  var nodeId = node.id;
  S.connections = S.connections.filter(function(c) { return c.to !== nodeId; });
  selectedAliases.filter(Boolean).forEach(function(alias) {
    var srcNode = S.nodes.find(function(n) {
      if (n.id === nodeId) return false;
      if (n.type === 'input')  return (n.name || n.id) === alias;
      if (n.type === 'output') return false;
      return (n.output_alias || n.step_id || n.id) === alias;
    });
    if (srcNode) {
      /* avoid duplicate */
      if (!S.connections.some(function(c){ return c.from===srcNode.id && c.to===nodeId; })) {
        var id = 'conn_' + (S._connCounter++);
        S.connections.push({ id: id, from: srcNode.id, to: nodeId });
      }
    }
  });
  DS.fn.renderConnections();
}

/* ---- Bind dynamic list editor events ---- */
function rebindPropsApply(node) {
  var $body = $('#props-body');
  if (!$body.length) return;

  $body.find('[data-action]').each(function() {
    var $btn = $(this);
    $btn.on('click', function() {
      var ns = $btn.attr('data-ns');
      var action = $btn.attr('data-action');
      readListEditorIntoNode(node);
      if (action === 'add-field') {
        if (ns === 'pi-header-fields' || ns === 'po-header-fields') {
          if (!node.header_fields) node.header_fields = [];
          node.header_fields.push({name:'', type:'string', nullable:true, format:'', start:'', length:''});
        } else if (ns === 'pi-trailer-fields' || ns === 'po-trailer-fields') {
          if (!node.trailer_fields) node.trailer_fields = [];
          node.trailer_fields.push({name:'', type:'string', nullable:true, format:'', start:'', length:''});
        } else if (ns === 'po-ctrl-fields') {
          if (!node.control_fields) node.control_fields = [];
          node.control_fields.push({name:'', type:'string', nullable:true, format:'', start:'', length:''});
        } else {
          if (!node.fields) node.fields = [];
          node.fields.push({name:'', type:'string', nullable:true, format:'', start:'', length:''});
        }
      } else if (action === 'add-expr') {
        if (!node.select_expressions) node.select_expressions = [];
        node.select_expressions.push({target:'', expression:'', operation:'MOVE'});
      } else if (action === 'add-cond') {
        if (!node.filter_conditions) node.filter_conditions = [];
        node.filter_conditions.push({field:'', operation:'==', value:''});
      } else if (action === 'add-key') {
        if (!node.join_keys) node.join_keys = [];
        node.join_keys.push({left:'', right:''});
      } else if (action === 'add-grp') {
        if (!node.agg_group_by) node.agg_group_by = [];
        node.agg_group_by.push({col:''});
      } else if (action === 'add-agg') {
        if (!node.agg_aggregations) node.agg_aggregations = [];
        node.agg_aggregations.push({field:'', operation:'sum', alias:'', condition:''});
      } else if (action === 'add-rule') {
        if (!node.validate_rules) node.validate_rules = [];
        node.validate_rules.push({field:'', data_type:'string', max_length:'', nullable:true, format:'any', date_format:'', pattern:''});
      } else if (action === 'add-cf-field') {
        /* ns determines which array: ctrl_file_fields, header_fields, or trailer_fields */
        if (ns === 'po-header-fields') {
          if (!node.header_fields) node.header_fields = [];
          node.header_fields.push({name:'', type:'STRING', expression:''});
        } else if (ns === 'po-trailer-fields') {
          if (!node.trailer_fields) node.trailer_fields = [];
          node.trailer_fields.push({name:'', type:'STRING', expression:''});
        } else {
          if (!node.ctrl_file_fields) node.ctrl_file_fields = [];
          node.ctrl_file_fields.push({name:'', type:'STRING', expression:'', begin: 0, length: 0, format: '', just_right: false});
        }
      } else if (action === 'add-ctrl-field') {
        if (!node.control_fields) node.control_fields = [];
        node.control_fields.push({name:'', type:'string', nullable:true, format:'', start:'', length:''});
      }
      showPropsPanel(node);
    });
  });

  $body.find('.list-item-up, .list-item-down').each(function() {
    var $mbtn = $(this);
    $mbtn.on('click', function() {
      if ($mbtn.prop('disabled')) return;
      readListEditorIntoNode(node);
      var ns  = $mbtn.attr('data-ns');
      var idx = parseInt($mbtn.attr('data-idx'), 10);
      var dir = $mbtn.hasClass('list-item-up') ? -1 : 1;
      moveListRow(node, ns, idx, dir);
      showPropsPanel(node);
    });
  });

  $body.find('.list-item-remove').each(function() {
    var $btn = $(this);
    $btn.on('click', function() {
      readListEditorIntoNode(node);
      var ns  = $btn.attr('data-ns');
      var idx = parseInt($btn.attr('data-idx'), 10);
      removeListRow(node, ns, idx);
      showPropsPanel(node);
    });
  });

  $body.find('.multi-source-select').each(function() {
    var $sel = $(this);
    $sel.on('change', function() {
      var selected = $sel.find('option:selected').map(function(){ return $(this).val(); }).get();
      syncConnectionsFromSourceSelect(node, selected);
      /* Re-validate output schema mismatch when source changes */
      if (node.type === 'output') {
        node.source_inputs = selected;
        validateOutputColumnMismatch(node);
      }
    });
  });
  $body.find('.single-source-select').each(function() {
    var $sel = $(this);
    $sel.on('change', function() {
      var alias = $sel.val();
      var selected = alias ? [alias] : [];
      syncConnectionsFromSourceSelect(node, selected);

      if (node.type === 'select' && alias) {
        var currentExprs = node.select_expressions || [];
        if (currentExprs.length === 0) {
          var fields = DS.fn.getFieldsForAlias(alias);
          if (fields.length > 0) {
            readListEditorIntoNode(node);
            if (!node.select_expressions || node.select_expressions.length === 0) {
              var dstFields = [];
              S.connections.forEach(function(c) {
                if (c.from === node.id) {
                  var dn = DS.fn.getNode(c.to);
                  if (dn && Array.isArray(dn.fields)) {
                    dn.fields.forEach(function(f){ if (f.name) dstFields.push(f.name); });
                  }
                }
              });
              var srcNames = fields.map(function(f){ return f.name; });
              if (dstFields.length > 0) {
                node.select_expressions = DS.fn.buildFuzzyMappings(srcNames, dstFields)
                  .map(function(m){ return { expression: m.expression, target: m.target, operation: 'MOVE' }; });
                DS.fn.toast('Expressions pre-populated with fuzzy column matching!', 'info');
              } else {
                node.select_expressions = srcNames.map(function(n){ return { expression: n, target: n, operation: 'MOVE' }; });
                DS.fn.toast('Expressions pre-populated from source fields!', 'info');
              }
              showPropsPanel(node);
            }
          }
        }
      }
    });
  });

  var $applyBtn = $('#prop-apply-btn');
  if ($applyBtn.length) {
    $applyBtn[0].onclick = function() {
      applyPropsToNode(node);
    };
  }

  var $delBtn = $('#prop-delete-btn');
  if ($delBtn.length) {
    $delBtn[0].onclick = function() {
      studioConfirm(
        'Delete "' + (node.name || node.step_id || node.id) + '"?',
        function() { DS.fn.deleteNode(node.id); }
      );
    };
  }

  initSectionFold($body[0]);
}

/* ---- List editor helpers ---- */
function _getListArr(node, ns) {
  if (ns === 'pi-header-fields' || ns === 'po-header-fields')  return node.header_fields;
  if (ns === 'pi-trailer-fields' || ns === 'po-trailer-fields') return node.trailer_fields;
  if (ns === 'pi-fields' || ns === 'po-fields') return node.fields;
  if (ns === 'po-ctrl-fields') return node.control_fields;
  if (ns === 'ps-exprs') return node.select_expressions;
  if (ns === 'pf-conds') return node.filter_conditions;
  if (ns === 'pj-keys') return node.join_keys;
  if (ns === 'pa-grp') return node.agg_group_by;
  if (ns === 'pa-aggs') return node.agg_aggregations;
  if (ns === 'pv-rules') return node.validate_rules;
  if (ns === 'pv-ctrl-fields' || ns === 'pcf-ctrl-fields') return node.ctrl_file_fields;
  return null;
}

function removeListRow(node, ns, idx) {
  var arr = _getListArr(node, ns);
  if (arr) arr.splice(idx, 1);
}

function moveListRow(node, ns, idx, dir) {
  var arr = _getListArr(node, ns);
  if (!arr) return;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= arr.length) return;
  var tmp = arr[idx];
  arr[idx] = arr[newIdx];
  arr[newIdx] = tmp;
}

function readListEditorIntoNode(node) {
  var $body = $('#props-body');
  if (!$body.length) return;

  function readItems(selector) {
    var items = {};
    $body.find('[data-idx][data-field]').each(function() {
      var $inp = $(this);
      if (!$inp.closest(selector).length) return;
      var idx = parseInt($inp.attr('data-idx'), 10);
      var field = $inp.attr('data-field');
      if (!items[idx]) items[idx] = {};
      items[idx][field] = $inp.is(':checkbox') ? $inp.prop('checked') : $inp.val();
    });
    return Object.keys(items).sort(function(a,b){return a-b;}).map(function(i){ return items[i]; });
  }

  if ($body.find('#pi-header-fields-editor').length) {
    node.header_fields = readItems('#pi-header-fields-editor');
  }
  var $fieldsEditor = $body.find('#pi-fields-editor, #po-fields-editor');
  if ($fieldsEditor.length) {
    node.fields = readItems('#' + $fieldsEditor.attr('id'));
  }
  if ($body.find('#pi-trailer-fields-editor').length) {
    node.trailer_fields = readItems('#pi-trailer-fields-editor');
  }
  var $pdcEnabled = $body.find('#pi-prev-day-check-enabled');
  if ($pdcEnabled.length) {
    node.prev_day_check = {
      enabled: $pdcEnabled.is(':checked'),
      header_date_field: ($body.find('#pi-prev-day-check-field').val() || '').trim()
    };
  }

  if ($body.find('#po-ctrl-fields-editor').length) {
    node.control_fields = readItems('#po-ctrl-fields-editor');
  }
  if ($body.find('#ps-exprs-editor').length) node.select_expressions = readItems('#ps-exprs-editor');
  if ($body.find('#pf-conds-editor').length) node.filter_conditions = readItems('#pf-conds-editor');
  if ($body.find('#pj-keys-editor').length) node.join_keys = readItems('#pj-keys-editor');
  if ($body.find('#pa-grp-editor').length) node.agg_group_by = readItems('#pa-grp-editor');
  var $aggEditor = $body.find('#pa-aggs-editor');
  if ($aggEditor.length) node.agg_aggregations = readItems('#pa-aggs-editor');
  /* Resolve expression value from cf-expr-wrap select + conditional inputs */
  function fixCfExpressions(arr, editorSelector) {
    $body.find(editorSelector + ' .cf-field-item').each(function(rowIdx) {
      if (!arr[rowIdx]) return;
      var $item  = $(this);
      var selVal = $item.find('.cf-expr-select').val() || '';
      if (selVal === '__literal__') {
        var lit = ($item.find('.cf-expr-literal').val() || '').trim();
        arr[rowIdx].expression = lit ? "'" + lit + "'" : '';
      } else if (selVal === '__custom__') {
        arr[rowIdx].expression = ($item.find('.cf-expr-custom').val() || '').trim();
      } else if (selVal === '__date__') {
        /* Format comes from the field's own FORMAT property (copybook-defined), not a UI dropdown */
        var dateFmt  = ((arr[rowIdx] && arr[rowIdx].format) || 'yyyyMMdd').trim() || 'yyyyMMdd';
        var dateFunc = ($item.find('.cf-expr-date-func').val() || '').trim();
        var dateSrc  = ($item.find('.cf-expr-date-src').val()  || '').trim();
        var dateExpr = '';
        if (dateFunc === 'CURRENTDATE') {
          dateExpr = 'current_date()';
        } else if (dateSrc) {
          dateExpr = "to_date(first(`" + dateSrc + "`),'" + dateFmt + "')";
        }
        if (dateFunc === 'LASTDAY') {
          if (dateExpr) {
            dateExpr = 'last_day(' + dateExpr + ')';
          } else {
            dateExpr = 'last_day(current_date())';
          }
        }
        arr[rowIdx].expression = dateExpr;
      }
    });
  }
  if ($body.find('#pcf-ctrl-fields-editor').length) {
    node.ctrl_file_fields = readItems('#pcf-ctrl-fields-editor');
    fixCfExpressions(node.ctrl_file_fields, '#pcf-ctrl-fields-editor');
  }
  if ($body.find('#po-header-fields-editor').length) {
    node.header_fields = readItems('#po-header-fields-editor');
    fixCfExpressions(node.header_fields, '#po-header-fields-editor');
  }
  if ($body.find('#po-trailer-fields-editor').length) {
    node.trailer_fields = readItems('#po-trailer-fields-editor');
    fixCfExpressions(node.trailer_fields, '#po-trailer-fields-editor');
  }
  var $ruleEditor = $body.find('#pv-rules-editor');
  if ($ruleEditor.length) {
    node.validate_rules = [];
    $ruleEditor.find('.validate-rule-item').each(function() {
      var $item = $(this);
      var gv = function(sel) { return $item.find(sel).val() || ''; };
      var gc2 = function(sel) { return $item.find(sel).is(':checked'); };
      var fmt = gv('.vr-fmt');
      /* null_check checked = nullable false (fail on null) */
      var nullCheckOn = gc2('.vr-null-check');
      var rule = {
        field:       gv('.vr-field'),
        data_type:   (gv('.vr-dtype') || 'TEXT').toUpperCase(),
        max_length:  gv('.vr-maxlen'),
        nullable:    !nullCheckOn,
        format:      (fmt || 'ANY').toUpperCase()
      };
      if (rule.field) node.validate_rules.push(rule);
    });
  }
}

/* ---- Propagate node ID and alias changes downstream ---- */
function propagateNodeIdAndAlias(oldId, oldAlias, node) {
  if (oldId && oldId !== node.id) {
    S.connections.forEach(function(c) {
      if (c.from === oldId) c.from = node.id;
      if (c.to   === oldId) c.to   = node.id;
    });
    var $el = $('[data-node-id="' + oldId + '"]');
    if ($el.length) $el.attr('data-node-id', node.id);
  }
  var newAlias = node.output_alias || node.step_id || node.id;
  if (oldAlias && oldAlias !== newAlias) {
    S.nodes.forEach(function(n) {
      if (!n.source_inputs) return;
      var idx = n.source_inputs.indexOf(oldAlias);
      if (idx >= 0) n.source_inputs[idx] = newAlias;
      if (n.join_left  === oldAlias) n.join_left  = newAlias;
      if (n.join_right === oldAlias) n.join_right = newAlias;
    });
  }
}

/* ---- Apply props to node ---- */
function applyPropsToNode(node) {
  S._propsDirty = false;
  var g = function(id){ return ($('#' + id).val() || '').trim(); };
  var gc = function(id){ return $('#' + id).is(':checked'); };

  readListEditorIntoNode(node);

  if (node.type === 'input') {
    var oldName = node.name;
    node.name          = g('pi-name') || node.id;
    node.id            = node.name;
    node.format           = g('pi-format');
    node.dataset_name     = g('pi-dataset-name') || '';
    delete node.source_path; delete node.source_file_name; delete node.partition_col;
    delete node.path;
    delete node.dataset;
    delete node.copybook;
    delete node.s3_path;
    var _rl = parseInt(g('pi-record-length'), 10);
    var _hc = parseInt(g('pi-header-count'),  10);
    var _tc = parseInt(g('pi-trailer-count'), 10);
    node.record_length     = isNaN(_rl) ? undefined : _rl;
    node.header_count      = isNaN(_hc) ? 0 : _hc;
    node.trailer_count     = isNaN(_tc) ? 0 : _tc;
    node.frequency         = g('pi-frequency') || undefined;
    node.delimiter_char    = g('pi-delimiter-char') || '';
    if (oldName && oldName !== node.name) {
      S.connections.forEach(function(c){
        if (c.from === oldName) c.from = node.id;
        if (c.to === oldName) c.to = node.id;
      });
      S.nodes.forEach(function(n){
        if (n.source_inputs) {
          var idx = n.source_inputs.indexOf(oldName);
          if (idx >= 0) n.source_inputs[idx] = node.name;
        }
      });
      var $el = $('[data-node-id="' + oldName + '"]');
      if ($el.length) $el.attr('data-node-id', node.id);
      /* Rename test data on server */
      var _cfgP = ($('#current-file').text() || '').trim();
      if (_cfgP && _cfgP !== 'Select an interface') {
        fetch('/api/config/' + encodeURIComponent(_cfgP) + '/rename-node-test-data', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_name: oldName, new_name: node.name, node_type: 'input' })
        }).catch(function(e) { console.warn('rename test data:', e); });
        if (S._nodeFileMeta[_cfgP] && S._nodeFileMeta[_cfgP][oldName]) {
          S._nodeFileMeta[_cfgP][node.name] = S._nodeFileMeta[_cfgP][oldName];
          delete S._nodeFileMeta[_cfgP][oldName];
        }
      }
    }
  } else if (node.type === 'output') {
    var oldNameO = node.name;
    node.name             = g('po-name') || node.id;
    node.id               = node.name;
    node.format           = g('po-format');
    node.dataset_name     = g('po-dataset-name') || '';
    delete node.source_path; delete node.target_file_name; delete node.partition_col;
    node.write_mode       = g('po-wmode');
    node.frequency        = g('po-frequency') || undefined;
    node.source_inputs    = DS.fn.getMultiSelectValues('po-src');
    delete node.s3_path;
    delete node.path;
    var _rlO = parseInt(g('po-record-length'), 10);
    var _hcO = parseInt(g('po-header-count'), 10);
    var _tcO = parseInt(g('po-trailer-count'), 10);
    node.record_length    = isNaN(_rlO) ? undefined : _rlO;
    node.header_count     = isNaN(_hcO) ? 0 : _hcO;
    node.trailer_count    = isNaN(_tcO) ? 0 : _tcO;
    node.delimiter_char   = g('po-delimiter-char') || '';
    if (oldNameO && oldNameO !== node.name) {
      var $elO = $('[data-node-id="' + oldNameO + '"]');
      if ($elO.length) $elO.attr('data-node-id', node.id);
      /* Rename test data on server */
      var _cfgPO = ($('#current-file').text() || '').trim();
      if (_cfgPO && _cfgPO !== 'Select an interface') {
        fetch('/api/config/' + encodeURIComponent(_cfgPO) + '/rename-node-test-data', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_name: oldNameO, new_name: node.name, node_type: 'output' })
        }).catch(function(e) { console.warn('rename test data:', e); });
        if (S._nodeFileMeta[_cfgPO] && S._nodeFileMeta[_cfgPO][oldNameO]) {
          S._nodeFileMeta[_cfgPO][node.name] = S._nodeFileMeta[_cfgPO][oldNameO];
          delete S._nodeFileMeta[_cfgPO][oldNameO];
        }
      }
    }
  } else if (node.type === 'efs_write') {
    var oldNameE = node.name;
    node.name             = g('po-name') || node.id;
    node.id               = node.name;
    node.format           = g('po-format');
    node.dataset_name     = g('po-dataset-name') || '';
    delete node.source_path; delete node.target_file_name; delete node.partition_col;
    node.write_mode       = g('po-wmode');
    node.frequency        = g('po-frequency') || undefined;
    node.source_inputs    = DS.fn.getMultiSelectValues('po-src');
    node.target_storage   = 'efs';
    delete node.s3_path;
    delete node.path;
    var _rlE = parseInt(g('po-record-length'), 10);
    var _hcE = parseInt(g('po-header-count'), 10);
    var _tcE = parseInt(g('po-trailer-count'), 10);
    node.record_length    = isNaN(_rlE) ? undefined : _rlE;
    node.header_count     = isNaN(_hcE) ? 0 : _hcE;
    node.trailer_count    = isNaN(_tcE) ? 0 : _tcE;
    node.delimiter_char   = g('po-delimiter-char') || '';
    if (oldNameE && oldNameE !== node.name) {
      var $elE = $('[data-node-id="' + oldNameE + '"]');
      if ($elE.length) $elE.attr('data-node-id', node.id);
      var _cfgPE = ($('#current-file').text() || '').trim();
      if (_cfgPE && _cfgPE !== 'Select an interface') {
        fetch('/api/config/' + encodeURIComponent(_cfgPE) + '/rename-node-test-data', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_name: oldNameE, new_name: node.name, node_type: 'efs_write' })
        }).catch(function(e) { console.warn('rename test data:', e); });
        if (S._nodeFileMeta[_cfgPE] && S._nodeFileMeta[_cfgPE][oldNameE]) {
          S._nodeFileMeta[_cfgPE][node.name] = S._nodeFileMeta[_cfgPE][oldNameE];
          delete S._nodeFileMeta[_cfgPE][oldNameE];
        }
      }
    }
  } else if (node.type === 'select') {
    var _oldIdS = node.id, _oldAliasS = node.output_alias || node.step_id || node.id;
    node.step_id     = g('ps-id') || node.id;
    node.id          = node.step_id;
    node.description = g('ps-desc');
    node.output_alias= g('ps-alias') || node.step_id;
    var _srcVal = DS.fn.getSingleSelectValue('ps-src');
    node.source_inputs = _srcVal ? [_srcVal] : [];
    propagateNodeIdAndAlias(_oldIdS, _oldAliasS, node);
  } else if (node.type === 'filter') {
    var _oldIdF = node.id, _oldAliasF = node.output_alias || node.step_id || node.id;
    node.step_id     = g('pf-id') || node.id;
    node.id          = node.step_id;
    node.description = g('pf-desc');
    node.output_alias= g('pf-alias') || node.step_id;
    node.source_inputs = DS.fn.getMultiSelectValues('pf-src');
    propagateNodeIdAndAlias(_oldIdF, _oldAliasF, node);
  } else if (node.type === 'join') {
    var _oldIdJ = node.id, _oldAliasJ = node.output_alias || node.step_id || node.id;
    node.step_id     = g('pj-id') || node.id;
    node.id          = node.step_id;
    node.description = g('pj-desc');
    node.output_alias= g('pj-alias') || node.step_id;
    node.join_left   = DS.fn.getSingleSelectValue('pj-left');
    node.join_right  = DS.fn.getSingleSelectValue('pj-right');
    node.join_type   = g('pj-jtype');
    node.source_inputs = [node.join_left, node.join_right].filter(Boolean);
    propagateNodeIdAndAlias(_oldIdJ, _oldAliasJ, node);
  } else if (node.type === 'aggregate') {
    var _oldIdA = node.id, _oldAliasA = node.output_alias || node.step_id || node.id;
    node.step_id     = g('pa-id') || node.id;
    node.id          = node.step_id;
    node.description = g('pa-desc');
    node.output_alias= g('pa-alias') || node.step_id;
    node.source_inputs = DS.fn.getMultiSelectValues('pa-src');
    propagateNodeIdAndAlias(_oldIdA, _oldAliasA, node);
  } else if (node.type === 'union') {
    var _oldIdU = node.id, _oldAliasU = node.output_alias || node.step_id || node.id;
    node.step_id       = g('pu-id') || node.id;
    node.id            = node.step_id;
    node.description   = g('pu-desc');
    node.output_alias  = g('pu-alias') || node.step_id;
    node.source_inputs = DS.fn.getMultiSelectValues('pu-src');
    node.union_distinct= gc('pu-distinct');
    propagateNodeIdAndAlias(_oldIdU, _oldAliasU, node);
  } else if (node.type === 'validate') {
    var _oldIdV = node.id, _oldAliasV = node.output_alias || node.step_id || node.id;
    node.step_id      = g('pv-id') || node.id;
    node.id           = node.step_id;
    node.description  = g('pv-desc');
    node.output_alias = g('pv-alias') || node.step_id;
    node.source_inputs = [DS.fn.getSingleSelectValue('pv-src')].filter(Boolean);
    node.fail_mode          = (g('pv-fail-mode') || 'ABORT').toUpperCase();
    node.frequency          = g('pv-frequency') || undefined;
    /* dataset_name / error_dataset_name are auto-derived — re-compute on save */
    (function() {
      var _src = (node.source_inputs || [])[0] || '';
      var _sn = S.nodes.find(function(n){ return (n.name||n.id||'') === _src; });
      var _ds = (_sn && (_sn.dataset_name || _sn.source_file_name)) || '';
      if (_ds) {
        node.dataset_name       = _ds.replace(/(\.[^.]+)$/, 'VAL$1');
        node.error_dataset_name = _ds.replace(/(\.[^.]+)$/, 'ERR$1');
      }
    })();
    delete node.path_partition_col; delete node.validated_path; delete node.validated_file_name;
    delete node.error_path; delete node.error_file_name;
    delete node.control_file_path;
    delete node.validation_bucket; delete node.error_bucket;
    /* Previous Day Check (replaces last_run_check) */
    node.previous_day_check = $('#pv-prev-day-check').is(':checked');
    /* Backward compat: also set last_run_check so old code paths work */
    node.last_run_check = node.previous_day_check;
    node.previous_day_header_date_field = $('#pv-prev-day-header-field').val() || '';
    /* Record Count Check */
    node.record_count_check = $('#pv-record-count-check').is(':checked');
    node.record_count_trailer_field = $('#pv-record-count-trailer-field').val() || '';
    /* Read validation rules from the editor DOM */
    node.validate_rules = [];
    $('#pv-rules-editor .validate-rule-item').each(function() {
      var $item = $(this);
      var getF = function(sel) { return $item.find(sel).val() || ''; };
      var getC = function(sel) { return $item.find(sel).is(':checked'); };
      var fmt = getF('.vr-fmt');
      /* null_check checked = nullable false (fail on null) */
      var nullCheckOn = getC('.vr-null-check');
      var rule = {
        field:       getF('.vr-field'),
        data_type:   (getF('.vr-dtype') || 'TEXT').toUpperCase(),
        max_length:  getF('.vr-maxlen') ? parseInt(getF('.vr-maxlen'), 10) || undefined : undefined,
        nullable:    !nullCheckOn,
        format:      (fmt || 'ANY').toUpperCase()
      };
      if (rule.field) node.validate_rules.push(rule);
    });
    propagateNodeIdAndAlias(_oldIdV, _oldAliasV, node);
  } else if (node.type === 'oracle_write') {
    var _oldIdOW = node.id, _oldAliasOW = node.output_alias || node.step_id || node.id;
    node.step_id         = g('pow-id') || node.id;
    node.id              = node.step_id;
    node.description     = g('pow-desc');
    node.output_alias    = node.step_id;
    var _owSrc = DS.fn.getSingleSelectValue('pow-src');
    node.source_inputs   = _owSrc ? [_owSrc] : [];
    node.ora_host         = g('pow-host')    || '';
    node.ora_port         = g('pow-port')    || '1521';
    node.ora_service_name = g('pow-service') || '';
    node.ora_schema       = g('pow-schema')    || '';
    node.ora_table        = g('pow-table')     || '';
    node.ora_load_mode    = (g('pow-load-mode') || 'APPEND').toUpperCase();
    node.ora_bad_file     = g('pow-bad-file')    || '/tmp/sqlldr/output.bad';
    node.ora_log_file     = g('pow-log-file')    || '/tmp/sqlldr/output.log';
    node.ora_discard_file = g('pow-discard-file') || '';
    node.ora_batch_size   = parseInt(g('pow-batch-size') || '10000', 10) || 10000;
    node.vault_path          = g('pow-vault-path')      || '';
    node.vault_username_key  = g('pow-vault-user-key')  || 'username';
    node.vault_password_key  = g('pow-vault-pass-key')  || 'password';
    propagateNodeIdAndAlias(_oldIdOW, _oldAliasOW, node);
  } else if (node.type === 'ctrl_file') {
    var _oldIdCF = node.id, _oldAliasCF = node.output_alias || node.step_id || node.id;
    node.step_id          = g('pcf-id') || node.id;
    node.id               = node.step_id;
    node.name             = node.step_id;
    node.description      = g('pcf-desc');
    node.output_alias     = g('pcf-alias') || node.step_id;
    node.source_inputs    = [DS.fn.getSingleSelectValue('pcf-src')].filter(Boolean);
    node.ctrl_file_name   = g('pcf-ctrl-file-name') || '';
    node.ctrl_include_header = gc('pcf-ctrl-include-header');
    if (!node.ctrl_file_fields) node.ctrl_file_fields = [];
    propagateNodeIdAndAlias(_oldIdCF, _oldAliasCF, node);
  } else {
    var _oldIdC = node.id, _oldAliasC = node.output_alias || node.step_id || node.id;
    node.step_id      = g('pc-id') || node.id;
    node.id           = node.step_id;
    node.description  = g('pc-desc');
    node.output_alias = g('pc-alias') || node.step_id;
    node.source_inputs = DS.fn.getMultiSelectValues('pc-src');
    try { node.custom_logic = JSON.parse(g('pc-logic') || '{}'); } catch(e) { node.custom_logic = g('pc-logic'); }
    propagateNodeIdAndAlias(_oldIdC, _oldAliasC, node);
  }

  DS.fn.refreshNodeEl(node.id);
  DS.fn.renderConnections();

  /* Auto-save to server */
  var cfgName = ($('#current-file').text() || '').trim();
  if (!cfgName || cfgName === 'Select an interface') {
    cfgName = ($('#toolbar-config-name').val() || '').trim();
  }
  if (cfgName && cfgName !== 'Select an interface' && window.CodeParser && window.CodeParser.API) {
    if (!cfgName.toLowerCase().endsWith('.json')) cfgName += '.json';
    /* buildJson is imported lazily to avoid circular dep */
    var cfg = DS.fn.buildJson();
    window.CodeParser.API.saveConfig(cfgName, cfg).then(function(res) {
      if (res && res.error) {
        DS.fn.toast('Save failed: ' + res.error, 'error');
      } else {
        DS.fn.toast('Saved!', 'success');
        if (typeof window.refreshConfigList === 'function') window.refreshConfigList();
        if (typeof window.updateCanvasSnapshot === 'function') window.updateCanvasSnapshot();
      }
    }).catch(function(err) {
      DS.fn.toast('Save error: ' + (err && err.message || 'unknown'), 'error');
    });
  } else {
    DS.fn.toast('Applied!', 'success');
  }
}


/* ---- Studio confirm dialog ---- */
function studioConfirm(msg, onConfirm, onCancel) {
  var $modal   = $('#studio-confirm-modal');
  var $msgEl   = $('#studio-confirm-message');
  var $okBtn   = $('#studio-confirm-ok');
  var $cancelBtn = $('#studio-confirm-cancel');
  var $cancelX   = $('#studio-confirm-cancel-x');
  if (!$modal.length) {
    if (confirm(msg)) { if (onConfirm) onConfirm(); }
    else { if (onCancel) onCancel(); }
    return;
  }
  if ($msgEl.length) $msgEl.text(msg);
  $modal.removeClass('hidden');
  function closeModal() { $modal.addClass('hidden'); }
  function doOk()    { closeModal(); if (onConfirm) onConfirm(); }
  function doCancel(){ closeModal(); if (onCancel)  onCancel();  }
  $okBtn[0].onclick     = doOk;
  $cancelBtn[0].onclick = doCancel;
  $cancelX[0].onclick   = doCancel;
  $modal.on('click', function(e) { if (e.target === $modal[0]) doCancel(); });
}

/* ---- Section fold/unfold ---- */
function initSectionFold(body) {
  if (!body) return;
  var $body = $(body);
  $body.find('.props-section').each(function() {
    var $sec = $(this);
    var $title = $sec.children('.props-section-title').first();
    if (!$title.length || $title.data('foldInit')) return;
    $title.data('foldInit', '1');

    var $children = $sec.children().filter(function() {
      return !$(this).is($title) && !$(this).hasClass('props-section-body');
    });
    if ($children.length === 0) return;

    var $bodyDiv = $('<div>').addClass('props-section-body');
    $children.each(function() { $bodyDiv.append(this); });
    $sec.append($bodyDiv);

    var $btn = $('<button>').attr('type', 'button').addClass('section-fold-btn')
      .attr('title', 'Collapse section').attr('aria-label', 'Toggle section')
      .html('<i class="fa-solid fa-chevron-up"></i>');
    $title.append($btn);

    $btn.on('click', function(e) {
      e.stopPropagation();
      var collapsed = $bodyDiv.css('display') === 'none';
      $bodyDiv.css('display', collapsed ? '' : 'none');
      $btn.find('i').css('transform', collapsed ? '' : 'rotate(180deg)');
      $btn.attr('title', collapsed ? 'Collapse section' : 'Expand section');
    });

    /* Support data-default-fold="collapsed" to start sections folded */
    if ($sec.attr('data-default-fold') === 'collapsed') {
      $bodyDiv.css('display', 'none');
      $btn.find('i').css('transform', 'rotate(180deg)');
      $btn.attr('title', 'Expand section');
    }
  });
}


/* ================================================================
   props/ctrl_file.js — Control File node properties panel renderer.
================================================================ */
function renderCtrlFileProps(body, node) {
  /* Header fields from upstream input node — for date builder dropdown */
  var _inputNode      = _getInputNodeForValidate(node);
  var _hdrFields      = (_inputNode && Array.isArray(_inputNode.header_fields)) ? _inputNode.header_fields : [];
  var _hdrFieldNames  = _hdrFields.map(function(f){ return f.name || ''; }).filter(Boolean);

  /* Schema import button */
  var ctrlSchemaFile     = node._ctrl_schema_file || '';
  var ctrlFieldCount     = node.ctrl_file_fields ? node.ctrl_file_fields.length : 0;
  var ctrlSchemaBtnClass = ctrlSchemaFile ? ' has-file' : '';
  var ctrlSchemaBtnHtml  = ctrlSchemaFile
    ? '<button type="button" class="tbl-hdr-icon-btn has-file" id="pcf-import-schema-btn" title="Re-import schema — ' + DS.fn.esc(ctrlSchemaFile) + ' (' + ctrlFieldCount + ' fields)">' +
        '<i class="fa-solid fa-file-import"></i> Import' +
      '</button>'
    : '<button type="button" class="tbl-hdr-icon-btn" id="pcf-import-schema-btn" title="Import field schema from copybook / CSV">' +
        '<i class="fa-solid fa-file-import"></i> Import' +
      '</button>';

  $(body).html(
    /* ── STEP INFO ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Step Info</div>' +
      formRow('Step ID',     textInput('pcf-id',   node.step_id,    'e.g. IFACE-CTRL-FILE-01')) +
      formRow('Description', textInput('pcf-desc', node.description, 'Describe this control file')) +
      formRow('Output Alias',textInput('pcf-alias', node.output_alias, 'e.g. IFACE-CTRL-FILE-OUT-01')) +
      formRow('Source Input', DS.fn.singleSourceSelect('pcf-src', (node.source_inputs||[])[0] || '', node.id)) +
    '</div>' +

    /* ── CONTROL FILE SETTINGS ── */
    '<div class="props-section">' +
      '<div class="props-section-title">Control File Settings</div>' +
      formRow('Control File Name', textInput('pcf-ctrl-file-name', node.ctrl_file_name || '', 'e.g. BANK-BATCH-CNT.CTL'),
        'Name of the generated control file') +
      '<div class="form-row checkbox-row">' +
        '<input type="checkbox" id="pcf-ctrl-include-header"' + (node.ctrl_include_header ? ' checked' : '') + '>' +
        '<label for="pcf-ctrl-include-header">Include header row in control file</label>' +
      '</div>' +
    '</div>' +

    /* ── CONTROL FILE FIELDS ── */
    '<div class="props-section">' +
      '<div class="props-section-title props-section-title-row cf-section-title">' +
        '<span>Control File Fields</span>' +
        ctrlSchemaBtnHtml +
      '</div>' +
      DS.fn.buildControlFileFieldsEditor('pcf-ctrl-fields', node.ctrl_file_fields || [], '', _hdrFieldNames) +
    '</div>' +

    /* ── TEST DATA (starts collapsed) ── */
    '<div class="props-section" data-default-fold="collapsed">' +
      '<div class="props-section-title">Test Data</div>' +
      '<div class="props-import-section" style="margin-bottom:10px">' +
        '<div class="props-import-title">' +
          '<i class="fa-solid fa-file-lines" style="color:#9333ea"></i> Expected Control File' +
          '<span style="font-size:10px;color:#94a3b8;margin-left:5px">— for reconciliation</span>' +
        '</div>' +
        '<button type="button" class="btn-import-sm' + (node._test_ctrl_file ? ' has-file' : '') + '" id="pcf-test-ctrl-file-btn" title="Upload expected control file for reconciliation">' +
          (node._test_ctrl_file
            ? '<i class="fa-solid fa-check"></i> ' + DS.fn.esc(node._test_ctrl_file)
            : '<i class="fa-solid fa-file-arrow-up"></i> Upload Expected Control File') +
        '</button>' +
        '<div class="import-file-badge' + (node._test_ctrl_file ? ' visible' : '') + '" id="pcf-test-ctrl-file-badge">' +
          (node._test_ctrl_file ? '\u2713 ' + DS.fn.esc(node._test_ctrl_file) : '') +
        '</div>' +
      '</div>' +
    '</div>'
  );

  rebindPropsApply(node);

  /* ---- Schema import button ---- */
  var $cfImportBtn = $('#pcf-import-schema-btn');
  if ($cfImportBtn.length) {
    $cfImportBtn.on('click', function() {
      _pickAndParseCtrlSchemaForCtrlNode(node, $cfImportBtn[0]);
    });
  }



  /* ---- Test ctrl file upload ---- */
  var $testCtrlBtn = $('#pcf-test-ctrl-file-btn');
  if ($testCtrlBtn.length) {
    $testCtrlBtn.on('click', function() {
      DS.fn.uploadTestCtrlFile(node, 'pcf-test-ctrl-file-badge', $testCtrlBtn[0]);
    });
  }
}

/* ---- Schema import specifically for ctrl_file node ---- */
function _pickAndParseCtrlSchemaForCtrlNode(node, btn) {
  var $input = $('<input>').attr('type', 'file')
    .attr('accept', '.json,.csv,.txt,.cbl,.cpy,.cob').css('display', 'none');
  $(document.body).append($input);
  $input.on('change', function() {
    var file = $input[0].files && $input[0].files[0];
    if (!file) { $input.remove(); return; }
    var ext = file.name.split('.').pop().toLowerCase();
    $(btn).html('<i class="fa-solid fa-spinner fa-spin"></i> Parsing\u2026');
    btn.disabled = true;

    var applyFields = function(parsedFields, filename) {
      btn.disabled = false;
      /* Reset button text whether parsing succeeded or not */
      $(btn).html('<i class="fa-solid fa-file-import"></i> Import');
      if (!parsedFields.length) { DS.fn.toast('No fields found in schema file.', 'error'); return; }
      readListEditorIntoNode(node);
      node.ctrl_file_fields = parsedFields.map(function(f) {
        var existing = (node.ctrl_file_fields || []).find(function(x){ return x.name === f.name; });
        return {
          name:       f.name || '',
          type:       (f.type || 'STRING').toUpperCase(),
          expression: existing ? (existing.expression || '') : '',
          begin:      parseInt(f.start || f.begin || 0, 10) || 0,
          length:     parseInt(f.length || 0, 10) || 0,
          format:     f.format || (existing ? (existing.format || '') : ''),
          just_right: !!f.just_right
        };
      });
      node._ctrl_schema_file = filename;
      if (S.selectedNodeId === node.id) {
        var _inputNode   = _getInputNodeForValidate(node);
        var _hdrFN       = (_inputNode && Array.isArray(_inputNode.header_fields))
                           ? _inputNode.header_fields.map(function(f){ return f.name || ''; }).filter(Boolean) : [];
        var $existingEditor = $('#pcf-ctrl-fields-editor');
        if ($existingEditor.length) {
          var _btnHtml =
            '<button type="button" class="tbl-hdr-icon-btn has-file" id="pcf-import-schema-btn" title="Re-import schema — ' + DS.fn.esc(filename) + ' (' + parsedFields.length + ' fields)">' +
              '<i class="fa-solid fa-file-import"></i> Import' +
            '</button>';
          var $tpl = $('<div>').html(DS.fn.buildControlFileFieldsEditor('pcf-ctrl-fields', node.ctrl_file_fields || [], _btnHtml, _hdrFN));
          $existingEditor.replaceWith($tpl.children().first());
          var $newBtn = $('#pcf-import-schema-btn');
          if ($newBtn.length) {
            $newBtn.on('click', function() {
              _pickAndParseCtrlSchemaForCtrlNode(node, $newBtn[0]);
            });
          }
          rebindPropsApply(node);
        } else {
          showPropsPanel(node);
        }
      }
      DS.fn.toast('Schema imported: ' + parsedFields.length + ' fields', 'success');
    };

    if (['cbl', 'cpy', 'cob'].indexOf(ext) >= 0) {
      var configPath = ($('#current-file').text() || '').trim();
      if (!configPath || configPath === 'Select an interface') {
        DS.fn.toast('Select an interface first.', 'error');
        btn.disabled = false;
        $input.remove();
        return;
      }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('config_name', configPath);
      $.ajax({
        url: '/api/parse-copybook',
        type: 'POST',
        data: fd,
        processData: false,
        contentType: false,
        success: function(res) {
          var allFields = (res && res.fields) || [];
          applyFields(allFields, file.name);
          $input.remove();
        },
        error: function() {
          DS.fn.toast('Failed to parse copybook.', 'error');
          btn.disabled = false;
          $(btn).html('<i class="fa-solid fa-file-import"></i> Import');
          $input.remove();
        }
      });
    } else {
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var parsed = JSON.parse(e.target.result);
          var fields = Array.isArray(parsed) ? parsed : (parsed.fields || []);
          applyFields(fields, file.name);
        } catch(ex) {
          var lines = (e.target.result || '').split(/\r?\n/).filter(Boolean);
          var csvFields = lines.map(function(ln) {
            var parts = ln.split(',');
            return { name: (parts[0] || '').trim(), type: (parts[1] || 'STRING').trim().toUpperCase(), length: parseInt(parts[2] || '0', 10) || 0 };
          });
          applyFields(csvFields, file.name);
        }
        $input.remove();
      };
      reader.readAsText(file);
    }
  });
  $input.trigger('click');
}

// Export
DS.fn.formRow                     = formRow;
DS.fn.textInput                   = textInput;
DS.fn.selectInput                 = selectInput;
DS.fn.partitionColSelect          = partitionColSelect;
DS.fn.showEmptyProps              = showEmptyProps;
DS.fn.showPropsPanel              = showPropsPanel;
DS.fn.syncConnectionsFromSourceSelect = syncConnectionsFromSourceSelect;
DS.fn.rebindPropsApply            = rebindPropsApply;
DS.fn.readListEditorIntoNode      = readListEditorIntoNode;
DS.fn.propagateNodeIdAndAlias     = propagateNodeIdAndAlias;
DS.fn.applyPropsToNode            = applyPropsToNode;
DS.fn.studioConfirm               = studioConfirm;
DS.fn.initSectionFold             = initSectionFold;
DS.fn.derivePreviousDayInfo       = derivePreviousDayInfo;
DS.fn.refreshValidateRulesUI      = refreshValidateRulesUI;
DS.fn.renderInputProps            = renderInputProps;
DS.fn.renderOutputProps           = renderOutputProps;
DS.fn.renderSelectProps           = renderSelectProps;
DS.fn.renderFilterProps           = renderFilterProps;
DS.fn.renderJoinProps             = renderJoinProps;
DS.fn.renderAggregateProps        = renderAggregateProps;
DS.fn.renderUnionProps            = renderUnionProps;
DS.fn.renderCustomProps           = renderCustomProps;
DS.fn.renderValidateProps         = renderValidateProps;
DS.fn.renderOracleWriteProps      = renderOracleWriteProps;
DS.fn.renderCtrlFileProps         = renderCtrlFileProps;
})(window.DS);
