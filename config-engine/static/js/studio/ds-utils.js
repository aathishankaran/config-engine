/**
 * ds-utils.js — Pure utilities and metadata helpers for Dataflow Studio.
 * Depends: ds-namespace.js, ds-constants.js, ds-state.js
 */
(function(DS) {
"use strict";

var C = DS.C, S = DS.S;

/* ---- HTML escaping ---- */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ---- Grid snap ---- */
function snap(v) { return Math.round(v / C.GRID) * C.GRID; }

/* ---- Unique node ID ---- */
function uid(type) {
  var base = type.toUpperCase().slice(0,3);
  return base + '_' + (S._nodeCounter++);
}

/* ---- Generate step IDs like select_1, validate_2, filter_3 ---- */
function nextStepId(type) {
  S._typeCounters[type] = (S._typeCounters[type] || 0) + 1;
  return type + '_' + S._typeCounters[type];
}

/* ---- Auto-generate a name like IFACE-SEGMENT-01 ---- */
function autoName(segment, counterKey) {
  var iface = DS.fn._getInterfaceName() || 'UNNAMED';
  S[counterKey] = (S[counterKey] || 0) + 1;
  return iface + '-' + segment + '-' + String(S[counterKey]).padStart(2, '0');
}

/* ---- Re-sync type counters after loading a config (avoids clashes) ---- */
function syncTypeCounters() {
  S.nodes.forEach(function(n) {
    if (n.step_id) {
      var m = n.step_id.match(/^([a-z_]+)_(\d+)$/);
      if (m) {
        var t = m[1]; var num = parseInt(m[2], 10);
        if (!S._typeCounters[t] || S._typeCounters[t] < num) S._typeCounters[t] = num;
      }
      var vm = n.step_id.match(/-DATA-VALIDATION-(\d+)$/i);
      if (vm) {
        var vnum = parseInt(vm[1], 10);
        if (vnum > S._validateSeq) S._validateSeq = vnum;
      }
    }
    if (n.type === 'input' && n.name) {
      var im = n.name.match(/^INPUT_(\d+)$/i);
      if (im) {
        var inum = parseInt(im[1], 10);
        if (inum > S._inputCounter) S._inputCounter = inum;
      }
      var nim = n.name.match(/-INPUT-(\d+)$/i);
      if (nim) {
        var ninum = parseInt(nim[1], 10);
        if (ninum > S._inputSeq) S._inputSeq = ninum;
      }
    }
    if (n.type === 'output' && n.name) {
      var om = n.name.match(/-OUTPUT-(\d+)$/i);
      if (om) {
        var onum = parseInt(om[1], 10);
        if (onum > S._outputSeq) S._outputSeq = onum;
      }
    }
  });
}

/* ---- Node and connection lookup ---- */
function getNode(id) { return S.nodes.find(function(n){ return n.id===id; }); }
function getConn(id) { return S.connections.find(function(c){ return c.id===id; }); }

/* ---- Right-side notification card ---- */
function toast(msg, type) {
  type = type || 'info';
  var $alert = $('#studio-alert');
  if (!$alert.length) { _toastFallback(msg, type); return; }

  $alert.removeClass('alert-success alert-error alert-info alert-show');

  var iconMap = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  var titleMap = { success: 'Success', error: 'Error', info: 'Information' };
  var icon  = iconMap[type]  || 'fa-circle-info';
  var title = titleMap[type] || 'Notification';
  var hideDuration = type === 'error' ? 10000 : 3500;

  $alert[0].className = 'studio-alert alert-' + type;

  var closeJs = "var $a=$('#studio-alert');$a.removeClass('alert-show');if($a[0]._hideTimer)clearTimeout($a[0]._hideTimer);";
  $alert.html(
    '<div class="alert-header">' +
      '<i class="fa-solid ' + icon + ' alert-icon"></i>' +
      '<span>' + title + '</span>' +
      '<button class="alert-close-btn" aria-label="Dismiss" onclick="' + closeJs + '">&times;</button>' +
    '</div>' +
    '<div class="alert-timer" style="animation-duration:' + hideDuration + 'ms"></div>' +
    '<div class="alert-body">' + msg + '</div>');

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      $alert.addClass('alert-show');
    });
  });

  if ($alert[0]._hideTimer) clearTimeout($alert[0]._hideTimer);
  $alert[0]._hideTimer = setTimeout(function() {
    $alert.removeClass('alert-show');
  }, hideDuration);
}

function _toastFallback(msg, type) {
  var duration = (type === 'error') ? 10000 : 3500;
  var $el = $('<div>').addClass('toast ' + (type || 'info'));
  $el.html(
    '<div class="toast-content">' + esc(msg) + '</div>' +
    '<div class="toast-timer" style="animation-duration:' + duration + 'ms"></div>'
  );
  var $container = $('#toast-container');
  if ($container.length) {
    $container.append($el);
    setTimeout(function () { $el.remove(); }, duration);
  }
}

/* ---- Status bar update ---- */
function updateStatus() {
  var $sn = $('#status-nodes');
  var $sc = $('#status-conns');
  var $sm = $('#status-mode');
  if ($sn.length) $sn.text(S.nodes.length);
  if ($sc.length) $sc.text(S.connections.length);
  if ($sm.length) $sm.html('Mode: <b>' + (S.mode === 'select' ? 'Select' : 'Connect') + '</b>');
  $('#drop-hint').toggleClass('hidden', S.nodes.length > 0);
}

/* ---- Mode switch ---- */
function setMode(m) {
  S.mode = m;
  var $selBtn = $('#tb-mode-select');
  var $conBtn = $('#tb-mode-connect');
  if ($selBtn.length) $selBtn.toggleClass('active', m === 'select');
  if ($conBtn.length) $conBtn.toggleClass('active', m === 'connect');
  var $wrap = $('#canvas-wrap');
  if ($wrap.length) $wrap.toggleClass('connect-mode', m === 'connect');
  if (m !== 'connect') { S.connectFrom = null; DS.fn.hideTempConn(); }
  updateStatus();
}

/* ---- Default node data per type ---- */
function defaultNodeData(type) {
  var id = uid(type);
  var base = {
    id: id,
    type: type,
    x: snap(200 + Math.random() * 300),
    y: snap(150 + Math.random() * 200),
    width: C.NODE_W,
    height: C.NODE_H
  };
  if (type === 'input') {
    var inputName = autoName('INPUT', '_inputSeq');
    return Object.assign(base, {
      name: inputName, format: 'fixed', source_path: '', source_file_name: '',
      dataset: '', header_fields: [], fields: [], trailer_fields: [], delimiter_char: ''
    });
  }
  if (type === 'output') {
    var outputName = autoName('OUTPUT', '_outputSeq');
    return Object.assign(base, {
      name: outputName, format: 'fixed', source_path: '', dataset: '',
      write_mode: 'overwrite', source_inputs: [], fields: [],
      output_columns: '', delimiter_char: ''
    });
  }
  if (type === 'efs_write') {
    var efsName = autoName('EFS-OUTPUT', '_outputSeq');
    return Object.assign(base, {
      name: efsName, format: 'fixed', source_path: '', dataset: '',
      write_mode: 'overwrite', source_inputs: [], fields: [],
      output_columns: '', delimiter_char: '',
      target_storage: 'efs'
    });
  }
  var sId, outAlias;
  if (type === 'validate') {
    sId = autoName('DATA-VALIDATION', '_validateSeq');
    var seqStr = String(S._validateSeq).padStart(2, '0');
    var iface = DS.fn._getInterfaceName() || 'UNNAMED';
    outAlias = iface + '-DATA-VALIDATION-OUT-' + seqStr;
  } else {
    sId = nextStepId(type);
    outAlias = type + '_out_' + S._typeCounters[type];
  }
  var stepDefaults = Object.assign(base, {
    step_id: sId, description: '', output_alias: outAlias,
    source_inputs: [], filter_conditions: [], select_expressions: [],
    join_left: '', join_right: '', join_type: 'INNER', join_keys: [],
    agg_group_by: [], agg_aggregations: [], union_distinct: false, custom_logic: '{}'
  });
  if (type === 'oracle_write') {
    Object.assign(stepDefaults, {
      ora_host: '', ora_port: '1521', ora_service_name: '',
      ora_schema: '', ora_table: '', ora_load_mode: 'APPEND',
      ora_bad_file: '/tmp/sqlldr/output.bad', ora_log_file: '/tmp/sqlldr/output.log',
      ora_discard_file: '', ora_batch_size: 10000,
      vault_path: '', vault_username_key: 'username', vault_password_key: 'password'
    });
  }
  if (type === 'validate') {
    Object.assign(stepDefaults, { previous_day_check: false });
  }
  if (type === 'ctrl_file') {
    var cfName = autoName('CTRL-FILE', '_ctrlFileSeq');
    Object.assign(stepDefaults, {
      name: cfName, step_id: cfName, id: cfName,
      ctrl_file_name: '', ctrl_include_header: false,
      ctrl_file_fields: [], _ctrl_schema_file: ''
    });
  }
  return stepDefaults;
}

/* ---- Fuzzy token matching ---- */
function fuzzyTokenScore(a, b) {
  function tokenize(s) {
    return s.replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase().split(/[_\s\-]+/).filter(Boolean);
  }
  var ta = tokenize(a), tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  var shared = 0;
  ta.forEach(function(tok) { if (tb.indexOf(tok) >= 0) shared++; });
  return shared / Math.max(ta.length, tb.length);
}

function buildFuzzyMappings(srcFields, dstFields) {
  return srcFields.map(function(src) {
    var best = { name: src, score: 0 };
    dstFields.forEach(function(dst) {
      var s = fuzzyTokenScore(src, dst);
      if (s > best.score) best = { name: dst, score: s };
    });
    return { expression: src, target: best.score >= 0.4 ? best.name : src, score: best.score };
  });
}

/* ================================================================
   META — Node file metadata helpers
================================================================ */
function fetchNodeFileMeta(configName) {
  $.ajax({
    url: '/api/config/' + encodeURIComponent(configName) + '/test-data',
    dataType: 'json',
    success: function(data) {
      if (data && data.file_meta) {
        S._nodeFileMeta[configName] = data.file_meta;
      }
      var lrFiles   = (data && data.last_run_files)   || {};
      var ctrlFiles = (data && data.test_ctrl_files)   || {};
      Object.keys(lrFiles).forEach(function(stepId) {
        var node = S.nodes.find(function(n) { return (n.step_id || n.id) === stepId; });
        if (node) node._last_run_file = lrFiles[stepId].file || '';
      });
      Object.keys(ctrlFiles).forEach(function(stepId) {
        var node = S.nodes.find(function(n) { return (n.step_id || n.id) === stepId; });
        if (node) node._test_ctrl_file = ctrlFiles[stepId].file || '';
      });
    },
    error: function() {}
  });
}

function getNodeMeta(node) {
  var $cf = $('#current-file');
  var cfgName = $cf.length ? $cf.text() : '';
  var meta = S._nodeFileMeta[cfgName] || {};
  return meta[node.name || node.id] || {};
}

/* ---- Deduplicated helpers (used by both props and canvas) ---- */
function getNodeOutputAlias(nodeId) {
  var n = getNode(nodeId);
  if (!n) return nodeId;
  if (n.type === 'input') return n.name || n.id;
  if (n.type === 'output') return n.name || n.id;
  return n.output_alias || n.step_id || n.id;
}

function deriveSourceInputs(nodeId) {
  return S.connections
    .filter(function(c) { return c.to === nodeId; })
    .map(function(c) { return getNodeOutputAlias(c.from); })
    .filter(Boolean);
}

/* ---- Export to namespace ---- */
DS.fn.esc                = esc;
DS.fn.snap               = snap;
DS.fn.uid                = uid;
DS.fn.nextStepId         = nextStepId;
DS.fn.autoName           = autoName;
DS.fn.syncTypeCounters   = syncTypeCounters;
DS.fn.getNode            = getNode;
DS.fn.getConn            = getConn;
DS.fn.toast              = toast;
DS.fn.updateStatus       = updateStatus;
DS.fn.setMode            = setMode;
DS.fn.defaultNodeData    = defaultNodeData;
DS.fn.fuzzyTokenScore    = fuzzyTokenScore;
DS.fn.buildFuzzyMappings = buildFuzzyMappings;
DS.fn.fetchNodeFileMeta  = fetchNodeFileMeta;
DS.fn.getNodeMeta        = getNodeMeta;
DS.fn.getNodeOutputAlias = getNodeOutputAlias;
DS.fn.deriveSourceInputs = deriveSourceInputs;

})(window.DS);
