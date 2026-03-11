/**
 * ds-schema.js — Schema import (copybook/CSV/JSON/TXT), test file upload, schema template download.
 * Depends: ds-namespace.js, ds-constants.js, ds-state.js, ds-utils.js
 */
(function(DS) {
  "use strict";
  var S = DS.S;

  /* ---- Schema template content ---- */
  function _schemaTemplateContent(fmt) {
    if (fmt === 'csv') {
      return {
        text: 'name,type,start,length\nFIELD1,STRING,1,10\nFIELD2,DECIMAL,11,10\nFIELD3,DATE,21,8\n',
        mime: 'text/csv', filename: 'schema_template.csv'
      };
    } else if (fmt === 'json') {
      return {
        text: JSON.stringify({
          fields: [
            {name: 'FIELD1', type: 'STRING', start: 1, length: 10},
            {name: 'FIELD2', type: 'DECIMAL', start: 11, length: 10},
            {name: 'FIELD3', type: 'DATE', start: 21, length: 8}
          ]
        }, null, 2),
        mime: 'application/json', filename: 'schema_template.json'
      };
    } else if (fmt === 'txt') {
      return {
        text: '# Schema Definition - pipe-delimited\n# Format: name|type|start|length\nFIELD1|STRING|1|10\nFIELD2|DECIMAL|11|10\nFIELD3|DATE|21|8\n',
        mime: 'text/plain', filename: 'schema_template.txt'
      };
    } else if (fmt === 'cbl') {
      return {
        text: '      * COBOL Copybook Template\n       01  RECORD-LAYOUT.\n           05  FIELD1          PIC X(10).\n           05  FIELD2          PIC 9(8)V99.\n           05  FIELD3          PIC 9(8).\n',
        mime: 'text/plain', filename: 'schema_template.cbl'
      };
    }
    return null;
  }

  /* ---- Download schema template ---- */
  function downloadSchemaTemplate(fmt) {
    var tpl = _schemaTemplateContent(fmt);
    if (!tpl) return;
    var blob = new Blob([tpl.text], {type: tpl.mime});
    var url = URL.createObjectURL(blob);
    var $a = $('<a>').attr('href', url).attr('download', tpl.filename);
    $('body').append($a);
    $a[0].click();
    setTimeout(function() { URL.revokeObjectURL(url); $a.remove(); }, 1000);
  }

  /* ---- Client-side schema parsers ---- */
  function _parseSchemaCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
    var nameIdx = headers.indexOf('name');
    var typeIdx = headers.indexOf('type');
    var startIdx = headers.indexOf('start');
    var lengthIdx = headers.indexOf('length');
    if (nameIdx < 0) return [];
    return lines.slice(1).filter(function(l) { return l.trim(); }).map(function(line) {
      var parts = line.split(',');
      return {
        name: (parts[nameIdx] || '').trim(),
        type: (parts[typeIdx] || 'STRING').trim().toUpperCase(),
        start: startIdx >= 0 ? (parseInt((parts[startIdx] || ''), 10) || undefined) : undefined,
        length: lengthIdx >= 0 ? (parseInt((parts[lengthIdx] || ''), 10) || undefined) : undefined
      };
    }).filter(function(f) { return f.name; });
  }

  function _parseSchemaJSON(text) {
    var obj = JSON.parse(text);
    var fields = obj.fields || obj.schema || obj;
    if (!Array.isArray(fields)) return [];
    return fields.map(function(f) {
      return {
        name: f.name || '',
        type: (f.type || 'STRING').toUpperCase(),
        start: f.start,
        length: f.length
      };
    }).filter(function(f) { return f.name; });
  }

  function _parseSchemaTxt(text) {
    var lines = text.trim().split(/\r?\n/);
    return lines
      .filter(function(l) { return l.trim() && !l.trim().startsWith('#'); })
      .map(function(line) {
        var parts = line.split('|');
        return {
          name: (parts[0] || '').trim(),
          type: (parts[1] || 'STRING').trim().toUpperCase(),
          start: parseInt((parts[2] || ''), 10) || undefined,
          length: parseInt((parts[3] || ''), 10) || undefined
        };
      }).filter(function(f) { return f.name; });
  }

  /* ---- Apply parsed fields to node ---- */
  function _applySchemaFields(parsedFields, filename, node, fieldsEditorId, badgeId, btn, configPath, nodeType) {
    var hasMultiRecord = parsedFields.some(function(f) { return (f.record_type || 'DATA') !== 'DATA'; });
    function _mapField(f) {
      var fd = {name: f.name, type: (f.type || 'STRING').toUpperCase(), length: f.length, start: f.start, nullable: true, format: f.format || ''};
      if (f.just_right) fd.just_right = true;
      return fd;
    }
    if (hasMultiRecord) {
      node.header_fields  = parsedFields.filter(function(f){ return (f.record_type||'DATA') === 'HEADER'; }).map(_mapField);
      node.trailer_fields = parsedFields.filter(function(f){ return (f.record_type||'DATA') === 'TRAILER'; }).map(_mapField);
      node.fields         = parsedFields.filter(function(f){ return (f.record_type||'DATA') === 'DATA'; }).map(_mapField);
      if (node.header_fields.length && !node.header_count) node.header_count = 1;
      if (node.trailer_fields.length && !node.trailer_count) node.trailer_count = 1;
      /* Fixed-width output copybooks always imply FIXED format */
      if (nodeType === 'output' && !node.format) node.format = 'FIXED';
    } else {
      node.fields = parsedFields.map(_mapField);
    }
    var $badge = $('#' + badgeId);
    if ($badge.length) { $badge.text('\u2713 ' + parsedFields.length + ' fields from ' + filename).addClass('visible'); }
    $(btn).html('<i class="fa-solid fa-check"></i> ' + DS.fn.esc(filename) + ' (' + parsedFields.length + ' fields)');
    $(btn).addClass('has-file');
    if (!S._nodeFileMeta[configPath]) S._nodeFileMeta[configPath] = {};
    var existing = S._nodeFileMeta[configPath][node.name || node.id] || {};
    existing.copybook_file = filename;
    existing.fields = parsedFields.length;
    existing.type = nodeType || 'input';
    S._nodeFileMeta[configPath][node.name || node.id] = existing;
    node._schema_file = filename;
    if (S.selectedNodeId === node.id) DS.fn.showPropsPanel(node);
  }

  /* ---- Multi-format schema import ---- */
  function pickAndParseSchema(node, fieldsEditorId, badgeId, btn, nodeType) {
    var $cf = $('#current-file');
    var configPath = $cf.length ? $cf.text() : '';
    if (!configPath || configPath === 'Select an interface') {
      var $tbName = $('#toolbar-config-name');
      configPath = $tbName.length ? ($tbName.val() || '').trim() : '';
    }
    if (!configPath) {
      DS.fn.toast('Enter or select an interface name before importing a schema', 'error'); return;
    }
    if (!configPath.toLowerCase().endsWith('.json')) configPath += '.json';
    var $input = $('<input>').attr('type', 'file').attr('accept', '.cbl,.cpy,.cob,.json,.csv,.txt,.xlsx').hide();
    $('body').append($input);
    $input.on('change', function() {
      var file = $input[0].files && $input[0].files[0];
      if (!file) { $input.remove(); return; }
      var ext = file.name.split('.').pop().toLowerCase();

      if (['cbl', 'cpy', 'cob'].indexOf(ext) >= 0) {
        var fd = new FormData();
        fd.append('file', file);
        fd.append('node_name', node.name || node.id);
        fd.append('node_type', nodeType || 'input');
        $(btn).html('<i class="fa-solid fa-spinner fa-spin"></i> Parsing\u2026');
        btn.disabled = true;
        $.ajax({
          url: '/api/config/' + encodeURIComponent(configPath) + '/node-copybook',
          method: 'POST',
          data: fd,
          processData: false,
          contentType: false,
          dataType: 'json',
          success: function(res) {
            btn.disabled = false;
            if (res.error) { DS.fn.toast('Schema parse error: ' + res.error, 'error'); return; }
            var fields = res.fields || [];
            _applySchemaFields(fields, file.name, node, fieldsEditorId, badgeId, btn, configPath, nodeType);
            DS.fn.toast('Schema imported: ' + fields.length + ' fields', 'success');
          },
          error: function(xhr, status, e) {
            btn.disabled = false;
            DS.fn.toast('Schema import failed: ' + (e || status), 'error');
          }
        });
      } else {
        var reader = new FileReader();
        $(btn).html('<i class="fa-solid fa-spinner fa-spin"></i> Parsing\u2026');
        btn.disabled = true;
        reader.onload = function(ev) {
          btn.disabled = false;
          try {
            var text = ev.target.result;
            var fields = [];
            if (ext === 'json') {
              fields = _parseSchemaJSON(text);
            } else if (ext === 'csv') {
              fields = _parseSchemaCSV(text);
            } else {
              fields = _parseSchemaTxt(text);
            }
            if (!fields.length) { DS.fn.toast('No fields found in schema file. Check the format.', 'error'); return; }
            _applySchemaFields(fields, file.name, node, fieldsEditorId, badgeId, btn, configPath, nodeType);
            DS.fn.toast('Schema imported: ' + fields.length + ' fields', 'success');
          } catch(e) {
            DS.fn.toast('Schema parse failed: ' + e.message, 'error');
          }
        };
        reader.onerror = function() { btn.disabled = false; DS.fn.toast('File read failed', 'error'); };
        reader.readAsText(file);
      }
      $input.remove();
    });
    $input[0].click();
  }

  var pickAndParseCopybook = pickAndParseSchema;

  /* ---- Test file upload ---- */
  function uploadNodeTestFile(node, badgeId, btn, nodeType) {
    var $cf = $('#current-file');
    var configPath = $cf.length ? $cf.text() : '';
    if (!configPath || configPath === 'Select an interface') {
      DS.fn.toast('Select an interface before uploading test files', 'error'); return;
    }
    var $input = $('<input>').attr('type', 'file').attr('accept', '.csv,.txt,.tsv,.dat,.fixed,.del,.ctl,.CTL').hide();
    $('body').append($input);
    $input.on('change', function() {
      var file = $input[0].files && $input[0].files[0];
      if (!file) { $input.remove(); return; }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('node_name', node.name || node.id);
      fd.append('node_type', nodeType || 'input');
      fd.append('format', (node.format || '').toUpperCase());
      fd.append('fields', JSON.stringify(node.fields || []));
      $(btn).html('<i class="fa-solid fa-spinner fa-spin"></i> Uploading\u2026');
      btn.disabled = true;
      $.ajax({
        url: '/api/config/' + encodeURIComponent(configPath) + '/node-test-file',
        method: 'POST',
        data: fd,
        processData: false,
        contentType: false,
        dataType: 'json',
        success: function(res) {
          btn.disabled = false;
          if (res.error) { DS.fn.toast('Upload failed: ' + res.error, 'error'); return; }
          var rowCount = res.rows || 0;
          var $badge = $('#' + badgeId);
          if ($badge.length) { $badge.text('\u2713 ' + file.name + ' (' + rowCount + ' rows)').addClass('visible'); }
          $(btn).html('<i class="fa-solid fa-check"></i> ' + DS.fn.esc(file.name) + ' (' + rowCount + ' rows)');
          $(btn).addClass('has-file');
          if (!S._nodeFileMeta[configPath]) S._nodeFileMeta[configPath] = {};
          var existing = S._nodeFileMeta[configPath][node.name || node.id] || {};
          existing.test_file = file.name;
          existing.rows = rowCount;
          existing.type = nodeType || 'input';
          S._nodeFileMeta[configPath][node.name || node.id] = existing;
          node._test_file = file.name;
          node._test_rows = rowCount;
          DS.fn.toast('Test file uploaded: ' + file.name, 'success');
        },
        error: function(xhr, status, e) {
          btn.disabled = false;
          DS.fn.toast('Upload failed: ' + (e || status), 'error');
        }
      });
      $input.remove();
    });
    $input[0].click();
  }

  /* ---- Last run file upload ---- */
  function uploadLastRunFile(node, badgeId, btn) {
    var $cf = $('#current-file');
    var configPath = $cf.length ? $cf.text() : '';
    if (!configPath || configPath === 'Select an interface') {
      DS.fn.toast('Select an interface before uploading test files', 'error'); return;
    }
    var stepId = (node.step_id || node.id || 'validate');
    var $input = $('<input>').attr('type', 'file').attr('accept', '.txt,.dat,.csv,.ctl,.CTL').hide();
    $('body').append($input);
    $input.on('change', function() {
      var file = $input[0].files && $input[0].files[0];
      if (!file) { $input.remove(); return; }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('step_id', stepId);
      $(btn).html('<i class="fa-solid fa-spinner fa-spin"></i> Uploading\u2026');
      btn.disabled = true;
      $.ajax({
        url: '/api/config/' + encodeURIComponent(configPath) + '/last-run-file',
        method: 'POST',
        data: fd,
        processData: false,
        contentType: false,
        dataType: 'json',
        success: function(res) {
          btn.disabled = false;
          if (res.error) { DS.fn.toast('Upload failed: ' + res.error, 'error'); return; }
          var $badge = $('#' + badgeId);
          if ($badge.length) { $badge.text('\u2713 ' + file.name).addClass('visible'); }
          $(btn).html('<i class="fa-solid fa-check"></i> ' + DS.fn.esc(file.name));
          $(btn).addClass('has-file');
          node._last_run_file = file.name;
          DS.fn.toast('Last run file uploaded: ' + file.name, 'success');
        },
        error: function(xhr, status, e) {
          btn.disabled = false;
          DS.fn.toast('Upload failed: ' + (e || status), 'error');
        }
      });
      $input.remove();
    });
    $input[0].click();
  }

  /* ---- Test control file upload (for validate test data section) ---- */
  function uploadTestCtrlFile(node, badgeId, btn) {
    var $cf = $('#current-file');
    var configPath = $cf.length ? $cf.text() : '';
    if (!configPath || configPath === 'Select an interface') {
      DS.fn.toast('Select an interface before uploading test files', 'error'); return;
    }
    var stepId = (node.step_id || node.id || 'validate');
    var $input = $('<input>').attr('type', 'file').attr('accept', '.txt,.dat,.csv,.ctl,.CTL,.fixed').hide();
    $('body').append($input);
    $input.on('change', function() {
      var file = $input[0].files && $input[0].files[0];
      if (!file) { $input.remove(); return; }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('step_id', stepId);
      fd.append('file_type', 'test_ctrl');
      $(btn).html('<i class="fa-solid fa-spinner fa-spin"></i> Uploading\u2026');
      btn.disabled = true;
      $.ajax({
        url: '/api/config/' + encodeURIComponent(configPath) + '/last-run-file',
        method: 'POST',
        data: fd,
        processData: false,
        contentType: false,
        dataType: 'json',
        success: function(res) {
          btn.disabled = false;
          if (res.error) { DS.fn.toast('Upload failed: ' + res.error, 'error'); return; }
          var $badge = $('#' + badgeId);
          if ($badge.length) { $badge.text('\u2713 ' + file.name).addClass('visible'); }
          $(btn).html('<i class="fa-solid fa-check"></i> ' + DS.fn.esc(file.name));
          $(btn).addClass('has-file');
          node._test_ctrl_file = file.name;
          DS.fn.toast('Test control file uploaded: ' + file.name, 'success');
        },
        error: function(xhr, status, e) {
          btn.disabled = false;
          DS.fn.toast('Upload failed: ' + (e || status), 'error');
        }
      });
      $input.remove();
    });
    $input[0].click();
  }

  /* ---- Schema helpers also used in canvas.js for validate/select pre-population ---- */
  function mapTypeToValidateDtype(type) {
    var t = (type || '').toLowerCase();
    if (t === 'int' || t === 'integer' || t === 'long' || t === 'bigint' ||
        t === 'double' || t === 'float' || t === 'decimal' || t === 'number' ||
        t === 'number' || t === 'numeric') return 'NUMBER';
    if (t === 'date') return 'DATE';
    if (t === 'timestamp') return 'TIMESTAMP';
    return 'TEXT';
  }

  function getFieldsForAlias(alias) {
    var a = (alias || '').trim();
    var srcNode = S.nodes.find(function(n) {
      return (n.name        || n.id           || '').trim() === a ||
             (n.output_alias || n.step_id || n.id || '').trim() === a;
    });
    /* Exclude HEADER/TRAILER fields — only return DATA fields for validation/mapping */
    return (srcNode && Array.isArray(srcNode.fields) ? srcNode.fields : []).filter(function(f) {
      var rt = (f.record_type || 'DATA').toUpperCase();
      return rt !== 'HEADER' && rt !== 'TRAILER';
    });
  }

  function fieldsToValidateRules(fields) {
    return fields.map(function(f) {
      var dtype = mapTypeToValidateDtype(f.type);
      var fmt = 'ANY';
      if (dtype === 'DATE' || dtype === 'TIMESTAMP') {
        fmt = 'DATE';
      } else if (f.format && /^(YYYY|MM|YY|HH)/.test(f.format)) {
        fmt = 'DATE';
      }
      return {
        field:      f.name  || '',
        data_type:  dtype,
        nullable:   f.nullable !== false,
        max_length: f.length ? String(f.length) : '',
        format:     fmt
      };
    });
  }

  // Export
  DS.fn.downloadSchemaTemplate   = downloadSchemaTemplate;
  DS.fn.pickAndParseSchema       = pickAndParseSchema;
  DS.fn.pickAndParseCopybook     = pickAndParseCopybook;
  DS.fn.uploadNodeTestFile       = uploadNodeTestFile;
  DS.fn.uploadLastRunFile        = uploadLastRunFile;
  DS.fn.uploadTestCtrlFile       = uploadTestCtrlFile;
  DS.fn.mapTypeToValidateDtype   = mapTypeToValidateDtype;
  DS.fn.getFieldsForAlias        = getFieldsForAlias;
  DS.fn.fieldsToValidateRules    = fieldsToValidateRules;
  DS.fn._parseSchemaCSV          = _parseSchemaCSV;
  DS.fn._parseSchemaJSON         = _parseSchemaJSON;
  DS.fn._parseSchemaTxt          = _parseSchemaTxt;
})(window.DS);
