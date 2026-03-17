/**
 * ds-json.js — JSON builder, step logic builder, topological sort, JSON highlight.
 */
(function(DS) {
  "use strict";
  var C = DS.C, S = DS.S;

  /* ---- Topological sort ---- */
  function topoSort() {
    var order = [], visited = {}, stack = {};
    function visit(id) {
      if (stack[id] || visited[id]) return;
      stack[id] = true;
      var n = DS.fn.getNode(id);
      if (n && n.source_inputs) n.source_inputs.forEach(function(src){
        var srcNode = S.nodes.find(function(n2){ return (n2.step_id||n2.id) === src || (n2.name||n2.id) === src; });
        if (srcNode) visit(srcNode.id);
      });
      stack[id] = false; visited[id] = true; order.push(id);
    }
    S.nodes.forEach(function(n){ visit(n.id); });
    return order;
  }

  /* ---- Build step logic object ---- */
  function buildStepLogic(node) {
    if (node.type === 'filter') {
      return {
        conditions: (node.filter_conditions || []).filter(function(c){return c.field;}).map(function(c){
          var v = c.value;
          var op = (c.operation || '==').toLowerCase();
          if (!isNaN(parseFloat(v)) && v !== '') v = parseFloat(v);
          if (op === 'in' || op === 'not_in') {
            v = String(c.value).split(',').map(function(s){return s.trim();}).filter(Boolean);
          }
          return { field: c.field, operation: op, value: v };
        })
      };
    }
    if (node.type === 'select') {
      var exprs = (node.select_expressions || []).filter(function(e){return e.target;}).map(function(e){
        return { target: e.target, expression: e.expression || '', operation: (e.operation || 'MOVE').toLowerCase() };
      });
      if (exprs.length === 0) return { columns: ['*'] };
      return { expressions: exprs };
    }
    if (node.type === 'join') {
      return {
        left: node.join_left || '',
        right: node.join_right || '',
        on: (node.join_keys || []).filter(function(k){return k.left && k.right;}).map(function(k){
          return [k.left, k.right];
        }),
        how: (node.join_type || 'INNER').toLowerCase()
      };
    }
    if (node.type === 'aggregate') {
      return {
        group_by: (node.agg_group_by || []).map(function(g){ return g.col || g; }).filter(Boolean),
        aggregations: (node.agg_aggregations || []).filter(function(a){return a.field && a.alias;}).map(function(a){
          var agg = { field: a.field, operation: (a.operation || 'SUM').toLowerCase(), alias: a.alias };
          if (a.condition) agg.condition = a.condition;
          return agg;
        })
      };
    }
    if (node.type === 'union') {
      return { source_inputs: node.source_inputs || [], distinct: !!node.union_distinct };
    }
    if (node.type === 'custom') {
      try {
        return typeof node.custom_logic === 'string' ? JSON.parse(node.custom_logic || '{}') : (node.custom_logic || {});
      } catch(e) { return {}; }
    }
    if (node.type === 'validate') {
      var fmMap = { 'FLAGGED': 'FLAG' };
      var fm = (node.fail_mode || 'ABORT').toUpperCase();
      var vLogic = {
        fail_mode: fmMap[fm] || fm,
        rules: (node.validate_rules || [])
          .filter(function(r) { return r.field; })
          .map(function(r) {
            var fmtUp = (r.format || 'ANY').toUpperCase();
            var rule = {
              field:     r.field,
              data_type: (r.data_type || 'TEXT').toUpperCase(),
              nullable:  r.nullable !== false
            };
            if (r.max_length) rule.max_length = parseInt(r.max_length, 10);
            if (fmtUp) rule.format = fmtUp;
            return rule;
          })
      };
      if (node.dataset_name)        vLogic.dataset_name        = node.dataset_name;
      if (node.error_dataset_name)  vLogic.error_dataset_name  = node.error_dataset_name;
      if (node.frequency)          vLogic.frequency           = node.frequency;
      var _valBucket = (S._appSettings.validation_bucket_prefix || '').replace(/\/$/, '');
      var _errBucket = (S._appSettings.error_bucket_prefix || '').replace(/\/$/, '');
      var _ifaceVal  = DS.fn._getInterfaceName();
      if (_valBucket && _ifaceVal) vLogic.validated_path = _valBucket + '/' + _ifaceVal + '/';
      if (_errBucket && _ifaceVal) vLogic.error_path     = _errBucket + '/' + _ifaceVal + '/';
      if (node.previous_day_check) {
        vLogic.previous_day_check = true;
        if (node.previous_day_header_date_field)
          vLogic.previous_day_header_date_field = node.previous_day_header_date_field;
        var _pvInfo = DS.fn.derivePreviousDayInfo(node);
        if (_pvInfo) {
          var _curBucketPv = (S._appSettings.raw_bucket_prefix || '').replace(/\/$/, '');
          var _ifacePv     = DS.fn._getInterfaceName();
          var _freqPv      = (_pvInfo.frequency || 'DAILY').toUpperCase();
          var _fileNamePv  = _pvInfo.dataset_name || '';
          if (_curBucketPv && _ifacePv) {
            vLogic.previous_day_file_path      = _curBucketPv + '/' + _ifacePv + '/';
            vLogic.previous_day_frequency      = _freqPv;
          }
          if (_fileNamePv) vLogic.previous_day_file_name = _fileNamePv;
        }
      }
      if (node.record_count_check) {
        vLogic.record_count_check = true;
        if (node.record_count_trailer_field)
          vLogic.record_count_trailer_field = node.record_count_trailer_field;
        var _rcInfo = DS.fn.derivePreviousDayInfo(node);
        if (_rcInfo) {
          var _rawBucketRC = (S._appSettings.raw_bucket_prefix || '').replace(/\/$/, '');
          var _ifaceRC     = DS.fn._getInterfaceName();
          var _freqRC      = (_rcInfo.frequency || 'DAILY').toUpperCase();
          var _fileNameRC  = _rcInfo.dataset_name || '';
          if (_rawBucketRC && _ifaceRC) {
            vLogic.record_count_file_path = _rawBucketRC + '/' + _ifaceRC + '/';
            vLogic.record_count_frequency = _freqRC;
          }
          if (_fileNameRC) vLogic.record_count_file_name = _fileNameRC;
        }
      }
      return vLogic;
    }
    if (node.type === 'ctrl_file') {
      var cfLogic = {
        ctrl_file_name: node.ctrl_file_name || '',
        ctrl_include_header: !!node.ctrl_include_header,
        ctrl_file_fields: (node.ctrl_file_fields || [])
          .filter(function(f){ return f.name; })
          .map(function(f){
            var fd = { name: f.name, type: (f.type||'STRING').toUpperCase(), expression: f.expression || '', length: parseInt(f.length || 0, 10) || 0, begin: parseInt(f.begin || 0, 10) || 0, format: f.format || '' };
            if (f.just_right) fd.just_right = true;
            return fd;
          })
      };
      if (node._ctrl_schema_file) cfLogic._ctrl_schema_file = node._ctrl_schema_file;
      return cfLogic;
    }
    if (node.type === 'oracle_write') {
      var owLogic = {
        host:               node.ora_host         || '',
        port:               parseInt(node.ora_port || '1521', 10) || 1521,
        service_name:       node.ora_service_name  || '',
        schema:             node.ora_schema         || '',
        table:              node.ora_table           || '',
        load_mode:          (node.ora_load_mode || 'APPEND').toUpperCase(),
        bad_file_path:      node.ora_bad_file        || '/tmp/sqlldr/output.bad',
        log_file_path:      node.ora_log_file        || '/tmp/sqlldr/output.log',
        batch_size:         parseInt(node.ora_batch_size || '10000', 10) || 10000,
        vault_path:         node.vault_path           || '',
        vault_username_key: node.vault_username_key   || 'username',
        vault_password_key: node.vault_password_key   || 'password'
      };
      if (node.ora_discard_file) owLogic.discard_file_path = node.ora_discard_file;
      return owLogic;
    }
    return {};
  }

  /* ---- Build full config JSON ---- */
  function buildJson() {
    var cfg = { Inputs: {}, Outputs: {}, Transformations: { description: 'Built with Dataflow Studio', steps: [] } };
    var ordered = topoSort();

    S.nodes.forEach(function(n) {
      if (n.type === 'input') {
        var inp = { name: n.name || n.id, format: (n.format || 'FIXED').toUpperCase() };
        if (n.dataset_name)     inp.dataset_name     = n.dataset_name;
        if (n.dataset_name)     inp.source_file_name = n.dataset_name;
        if (n.frequency)        inp.frequency        = n.frequency;
        var _rawBucket = (S._appSettings.raw_bucket_prefix || '').replace(/\/$/, '');
        var _ifaceName = DS.fn._getInterfaceName();
        if (_rawBucket && _ifaceName) {
          inp.source_path = _rawBucket + '/' + _ifaceName + '/';
        }
        if (n.record_length !== undefined) inp.record_length = n.record_length;
        if (n.header_count  !== undefined) inp.header_count  = n.header_count;
        if (n.trailer_count !== undefined) inp.trailer_count = n.trailer_count;
        if (n.delimiter_char)   inp.delimiter_char   = n.delimiter_char;
        function _serializeFields(arr) {
          return (arr || []).filter(function(f){ return f.name; }).map(function(f){
            var fd = { name: f.name, type: (f.type || 'STRING').toUpperCase() };
            if (f.start)      fd.start      = parseInt(f.start,  10);
            if (f.length)     fd.length     = parseInt(f.length, 10);
            if (f.nullable !== undefined) fd.nullable = f.nullable !== false && f.nullable !== 'false';
            if (f.format)     fd.format     = f.format;
            if (f.just_right) fd.just_right = true;
            return fd;
          });
        }
        if (n.header_fields && n.header_fields.length > 0) {
          inp.header_fields = _serializeFields(n.header_fields);
        }
        if (n.fields && n.fields.length > 0) {
          inp.fields = _serializeFields(n.fields);
        }
        if (n.trailer_fields && n.trailer_fields.length > 0) {
          inp.trailer_fields = _serializeFields(n.trailer_fields);
        }
        if (n._schema_file) inp._schema_file = n._schema_file;
        if (n._test_file)   inp._test_file   = n._test_file;
        if (n._test_rows !== undefined) inp._test_rows = n._test_rows;
        if (n.prev_day_check && n.prev_day_check.enabled) {
          inp.prev_day_check = {
            enabled: true,
            header_date_field: n.prev_day_check.header_date_field || ''
          };
        }
        cfg.Inputs[inp.name] = inp;
      } else if (n.type === 'output' || n.type === 'efs_write') {
        var out = {
          name: n.name || n.id,
          format: (n.format || 'PARQUET').toUpperCase(),
          write_mode: (n.write_mode || 'OVERWRITE').toUpperCase()
        };
        if (n.dataset_name)     out.dataset_name     = n.dataset_name;
        if (n.dataset_name)     out.source_file_name = n.dataset_name;
        if (n.frequency)        out.frequency        = n.frequency;
        var _isEfsOut  = n.type === 'efs_write';
        var _curBucket = (_isEfsOut
          ? (S._appSettings.efs_output_prefix || '')
          : (S._appSettings.curated_bucket_prefix || '')
        ).replace(/\/$/, '');
        var _ifaceOut  = DS.fn._getInterfaceName();
        if (_curBucket && _ifaceOut) {
          out.source_path = _curBucket + '/' + _ifaceOut + '/';
        }
        if (_isEfsOut) out.target_storage = 'efs';
        if (n.source_inputs && n.source_inputs.length > 0) out.source_inputs = n.source_inputs;
        var outFmt = (n.format || '').toUpperCase();
        if (outFmt === 'FIXED') {
          if (n.record_length !== undefined) out.record_length = n.record_length;
          if (n.header_count  !== undefined) out.header_count  = n.header_count;
          if (n.trailer_count !== undefined) out.trailer_count = n.trailer_count;
        }
        if (outFmt === 'DELIMITED' && n.delimiter_char) {
          out.delimiter_char = n.delimiter_char;
        }
        if (n.fields && n.fields.length > 0) {
          out.fields = n.fields.filter(function(f){ return f.name; }).map(function(f){
            var fd = { name: f.name, type: (f.type || 'STRING').toUpperCase() };
            if (f.start)              fd.start      = parseInt(f.start, 10);
            if (f.length)             fd.length     = parseInt(f.length, 10);
            if (f.nullable !== undefined) fd.nullable = f.nullable !== false && f.nullable !== 'false';
            if (f.format)             fd.format     = f.format;
            if (f.just_right)         fd.just_right = true;
            return fd;
          });
        }
        if (n.control_fields && n.control_fields.length > 0) {
          out.control_fields = n.control_fields.filter(function(f){ return f.name; }).map(function(f){
            var fd = { name: f.name, type: (f.type || 'STRING').toUpperCase() };
            if (f.start)  fd.start  = parseInt(f.start, 10);
            if (f.length) fd.length = parseInt(f.length, 10);
            if (f.nullable !== undefined) fd.nullable = f.nullable !== false && f.nullable !== 'false';
            if (f.format) fd.format = f.format;
            return fd;
          });
        }
        if (n.fields && n.fields.length > 0) {
          out.output_columns = n.fields.filter(function(f){ return f.name; }).map(function(f){ return f.name; });
        } else if (n.output_columns) {
          out.output_columns = (typeof n.output_columns === 'string')
            ? n.output_columns.split(',').map(function(s){return s.trim();}).filter(Boolean)
            : n.output_columns;
        }
        /* Header/trailer schema for FIXED output — include expression for computed values */
        if (n.header_fields && n.header_fields.length > 0) {
          out.header_fields = n.header_fields.filter(function(f){ return f.name; }).map(function(f){
            var fd = { name: f.name, type: (f.type || 'STRING').toUpperCase() };
            if (f.expression) fd.expression = f.expression;
            if (f.length)     fd.length     = parseInt(f.length, 10);
            if (f.just_right) fd.just_right = true;
            return fd;
          });
        }
        if (n.trailer_fields && n.trailer_fields.length > 0) {
          out.trailer_fields = n.trailer_fields.filter(function(f){ return f.name; }).map(function(f){
            var fd = { name: f.name, type: (f.type || 'STRING').toUpperCase() };
            if (f.expression) fd.expression = f.expression;
            if (f.length)     fd.length     = parseInt(f.length, 10);
            if (f.just_right) fd.just_right = true;
            return fd;
          });
        }
        if (n._schema_file) out._schema_file = n._schema_file;
        if (n._test_file)   out._test_file   = n._test_file;
        if (n._test_rows !== undefined) out._test_rows = n._test_rows;
        cfg.Outputs[out.name] = out;
      } else {
        var step = {
          id: n.step_id || n.id,
          description: n.description || '',
          type: n.type,
          source_inputs: n.source_inputs || [],
          logic: buildStepLogic(n),
          output_alias: n.output_alias || n.step_id || n.id
        };
        cfg.Transformations.steps.push(step);
      }
    });

    cfg.Transformations.steps.sort(function(a, b) {
      var ai = ordered.indexOf(a.id), bi = ordered.indexOf(b.id);
      if (ai < 0) ai = 9999; if (bi < 0) bi = 9999;
      return ai - bi;
    });

    return cfg;
  }

  /* ---- JSON syntax highlight ---- */
  function highlightJson(json) {
    return json
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        function(match) {
          var cls = 'json-number';
          if (/^"/.test(match)) { cls = /:$/.test(match) ? 'json-key' : 'json-string'; }
          else if (/true|false/.test(match)) { cls = 'json-bool'; }
          else if (/null/.test(match)) { cls = 'json-null'; }
          return '<span class="' + cls + '">' + match + '</span>';
        });
  }

  // Export
  DS.fn.topoSort       = topoSort;
  DS.fn.buildStepLogic  = buildStepLogic;
  DS.fn.buildJson       = buildJson;
  DS.fn.highlightJson   = highlightJson;
})(window.DS);
