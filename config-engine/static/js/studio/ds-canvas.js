/**
 * ds-canvas.js — Node rendering, events, connections, canvas interactions,
 *                config loading, palette/toolbar/modal/keyboard setup, and init.
 *
 * Depends: ds-namespace.js, ds-constants.js, ds-state.js, ds-utils.js, ds-layout.js
 */
(function(DS) {
"use strict";

var C = DS.C, S = DS.S;

/* ── Connection delete popup target ── */
var _connDeleteTarget = null;

/* ================================================================
   NODE RENDERING
================================================================ */
function renderAllNodes() {
  var $container = $('#canvas-nodes');
  $container.empty();
  S.nodes.forEach(function(n) { $container.append(buildNodeEl(n)); });
  bindAllNodeEvents();
}

function buildNodeEl(node) {
  var meta = C.TYPE_META[node.type] || C.TYPE_META.custom;
  var icon = C.TYPE_ICONS[node.type] || C.TYPE_ICONS.custom;
  var isInput  = node.type === 'input';
  var isOutput = node.type === 'output' || node.type === 'efs_write';

  var isCtrlFile = node.type === 'ctrl_file';
  var title = isInput || isOutput ? node.name || node.id
             : node.step_id || node.output_alias || node.id;
  var isValidate = node.type === 'validate';
  var subtitle = isInput  ? (node.format || '') + (node.dataset_name ? ' · ' + node.dataset_name : (node.path ? ' · ' + node.path.split('/').pop() : ''))
               : isOutput ? (node.format || '') + (node.dataset_name ? ' · ' + node.dataset_name : (node.path ? ' · ' + node.path.split('/').pop() : ''))
               : isValidate ? (node.dataset_name || node.description || node.type)
               : isCtrlFile ? (node.ctrl_file_name || node.description || node.type)
               : node.description || node.type;

  var $el = $('<div>')
    .attr('class', 'df-node node-' + node.type + (node.id === S.selectedNodeId ? ' selected' : ''))
    .attr('data-node-id', node.id)
    .css({ left: node.x + 'px', top: node.y + 'px', width: node.width + 'px' });

  $el.html(
    (!isInput ? '<div class="node-port port-in" data-port="in" data-node="' + node.id + '"></div>' : '') +
    '<div class="node-header">' +
      '<span class="node-header-icon">' + icon + '</span>' +
      '<span class="node-type-label">' + DS.fn.esc(meta.label) + '</span>' +
    '</div>' +
    '<div class="node-body">' +
      '<div class="node-title">' + DS.fn.esc(title) + '</div>' +
      '<div class="node-subtitle">' + DS.fn.esc(subtitle) + '</div>' +
    '</div>' +
    (!isOutput ? '<div class="node-port port-out" data-port="out" data-node="' + node.id + '"></div>' : '')
  );
  return $el[0];
}

function refreshNodeEl(nodeId) {
  var node = DS.fn.getNode(nodeId);
  if (!node) return;
  var $old = $('[data-node-id="' + nodeId + '"]');
  if (!$old.length) return;
  var newEl = buildNodeEl(node);
  $old.replaceWith(newEl);
  bindNodeEvents(newEl);
}

/* ================================================================
   NODE EVENTS
================================================================ */
function bindAllNodeEvents() {
  $('.df-node').each(function() { bindNodeEvents(this); });
}

function bindNodeEvents(el) {
  if (!el) return;
  var $el = $(el);
  var nodeId = $el.attr('data-node-id');

  $el.on('mousedown', function(e) {
    if ($(e.target).hasClass('node-port')) return;
    e.stopPropagation();

    if (S.connectFrom && S.connectFrom !== nodeId) {
      addConnection(S.connectFrom, nodeId);
      hideTempConn();
      DS.fn.setMode('select');
      selectNode(nodeId);
      return;
    }

    if (S.mode === 'connect') return;

    selectNode(nodeId);
    var _wrap = document.getElementById('canvas-wrap');
    var _wr   = _wrap.getBoundingClientRect();
    var node  = DS.fn.getNode(nodeId);
    S.dragging = {
      nodeId: nodeId,
      offX: (e.clientX - _wr.left - S.panX) / S.zoom - node.x,
      offY: (e.clientY - _wr.top  - S.panY) / S.zoom - node.y,
      moved: false
    };
  });

  $el.on('contextmenu', function(e) {
    e.preventDefault();
    selectNode(nodeId);
    showContextMenuLocal(e.clientX, e.clientY, nodeId);
  });

  $el.find('.node-port').each(function() {
    var $port = $(this);
    $port.on('mousedown', function(e) {
      e.stopPropagation();
      var portType = $port.attr('data-port');

      if (portType === 'out') {
        S.connectFrom = nodeId;
        S.tempConnMouse = null;
        if (S.mode !== 'connect') DS.fn.setMode('connect');
      } else if (portType === 'in') {
        if (S.connectFrom && S.connectFrom !== nodeId) {
          addConnection(S.connectFrom, nodeId);
          hideTempConn();
          DS.fn.setMode('select');
        }
      }
    });

    $port.on('mouseenter', function() { $port.addClass('highlight'); });
    $port.on('mouseleave', function() { $port.removeClass('highlight'); });
  });
}

/* ================================================================
   CANVAS MOUSE EVENTS
================================================================ */
function setupCanvasEvents() {
  var wrap = document.getElementById('canvas-wrap');
  var $wrap = $(wrap);

  $wrap.on('mousedown', function(e) {
    if ($(e.target).hasClass('node-port')) return;
    if ($(e.target).closest('.df-node').length) return;

    if (S.connectFrom || S.mode === 'connect') {
      S.connectFrom = null;
      hideTempConn();
      DS.fn.setMode('select');
      return;
    }

    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      S.panning = {
        startX: e.clientX, startY: e.clientY,
        startPanX: S.panX, startPanY: S.panY,
        moved: false
      };
      $wrap.addClass('pan-mode');
    }
  });

  $wrap.on('mousemove', function(e) {
    if (S.dragging) {
      var node = DS.fn.getNode(S.dragging.nodeId);
      if (!node) return;
      var wrapRect = wrap.getBoundingClientRect();
      var nx = DS.fn.snap((e.clientX - wrapRect.left - S.panX) / S.zoom - S.dragging.offX);
      var ny = DS.fn.snap((e.clientY - wrapRect.top  - S.panY) / S.zoom - S.dragging.offY);
      if (Math.abs(nx - node.x) > 1 || Math.abs(ny - node.y) > 1) {
        S.dragging.moved = true;
        node.x = Math.max(0, nx);
        node.y = Math.max(0, ny);
        var $dragEl = $('[data-node-id="' + S.dragging.nodeId + '"]');
        if ($dragEl.length) { $dragEl.css({ left: node.x + 'px', top: node.y + 'px' }); }
        renderConnections();
      }
    }

    if (S.panning) {
      var dx = e.clientX - S.panning.startX;
      var dy = e.clientY - S.panning.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        S.panning.moved = true;
        S.panX = S.panning.startPanX + dx;
        S.panY = S.panning.startPanY + dy;
        DS.fn.applyTransform();
      }
    }

    if (S.connectFrom) {
      var wrapRect2 = wrap.getBoundingClientRect();
      var mx = (e.clientX - wrapRect2.left - S.panX) / S.zoom;
      var my = (e.clientY - wrapRect2.top  - S.panY) / S.zoom;
      S.tempConnMouse = { x: mx, y: my };
      drawTempConn(S.connectFrom, mx, my);
    }
  });

  $wrap.on('mouseup', function(e) {
    if (S.dragging) { S.dragging = null; }
    if (S.panning) {
      if (!S.panning.moved) { deselectAll(); }
      S.panning = null;
      $wrap.removeClass('pan-mode');
    }
    if (S.connectFrom) {
      var tPort   = e.target.closest ? e.target.closest('.node-port') : null;
      var tNodeEl = e.target.closest ? e.target.closest('.df-node')   : null;
      var tNodeId = tNodeEl ? tNodeEl.getAttribute('data-node-id') : null;

      if (tPort && tNodeId && tNodeId !== S.connectFrom && tPort.getAttribute('data-port') === 'in') {
        addConnection(S.connectFrom, tNodeId);
        hideTempConn();
        DS.fn.setMode('select');
      } else if (tNodeEl && tNodeId && tNodeId !== S.connectFrom && !tPort) {
        addConnection(S.connectFrom, tNodeId);
        hideTempConn();
        DS.fn.setMode('select');
        selectNode(tNodeId);
      } else if (!tNodeEl) {
        S.connectFrom = null;
        hideTempConn();
        DS.fn.setMode('select');
      }
    }
  });

  $(document).on('mouseup', function() {
    if (S.dragging) { S.dragging = null; }
    if (S.panning)  { S.panning = null; $wrap.removeClass('pan-mode'); }
  });

  /* KEEP RAW: wheel event with { passive: false } — jQuery .on() doesn't support passive option */
  wrap.addEventListener('wheel', function(e) {
    // Scroll the JSON editor manually — vendor library calls preventDefault() internally
    if (e.target.closest && e.target.closest('#studio-jsoneditor-container')) {
      var outer = document.querySelector('#studio-jsoneditor-container .jsoneditor-outer');
      if (outer) outer.scrollTop += e.deltaY;
      return;
    }
    e.preventDefault();
    var wrapRect = wrap.getBoundingClientRect();
    var mx = e.clientX - wrapRect.left;
    var my = e.clientY - wrapRect.top;
    var delta = e.deltaY > 0 ? -0.1 : 0.1;
    var newZoom = Math.min(2.5, Math.max(0.25, S.zoom + delta));
    S.panX = mx - (mx - S.panX) * (newZoom / S.zoom);
    S.panY = my - (my - S.panY) * (newZoom / S.zoom);
    S.zoom = newZoom;
    DS.fn.applyTransform();
  }, { passive: false });

  $wrap.on('dragover', function(e) { e.preventDefault(); e.originalEvent.dataTransfer.dropEffect = 'copy'; });
  $wrap.on('drop', function(e) {
    e.preventDefault();
    var data = e.originalEvent.dataTransfer.getData('application/json');
    if (!data) return;
    try {
      var payload = JSON.parse(data);
      var wrapRect = wrap.getBoundingClientRect();
      var cx = (e.clientX - wrapRect.left - S.panX) / S.zoom;
      var cy = (e.clientY - wrapRect.top  - S.panY) / S.zoom;
      var node = DS.fn.defaultNodeData(payload.type);
      node.x = DS.fn.snap(cx - C.NODE_W / 2);
      node.y = DS.fn.snap(cy - C.NODE_H / 2);
      addNode(node);
      selectNode(node.id);
      DS.fn.showPropsPanel(node);
    } catch(err) { console.warn('Drop error', err); }
  });
}

/* ================================================================
   NODE CRUD
================================================================ */
function addNode(node) {
  S.nodes.push(node);
  var $container = $('#canvas-nodes');
  var el = buildNodeEl(node);
  $container.append(el);
  bindNodeEvents(el);
  DS.fn.updateStatus();
}

function deleteNode(nodeId) {
  S.nodes = S.nodes.filter(function(n) { return n.id !== nodeId; });
  S.connections = S.connections.filter(function(c) { return c.from !== nodeId && c.to !== nodeId; });
  $('[data-node-id="' + nodeId + '"]').remove();
  if (S.selectedNodeId === nodeId) { S.selectedNodeId = null; DS.fn.showEmptyProps(); }
  renderConnections();
  DS.fn.updateStatus();
}

function duplicateNode(nodeId) {
  var node = DS.fn.getNode(nodeId);
  if (!node) return;
  var copy = JSON.parse(JSON.stringify(node));
  var newId = (copy.type.toUpperCase().slice(0, 3)) + '_' + (S._nodeCounter++);
  copy.id = newId;
  if (copy.name) copy.name = copy.name + '_copy';
  if (copy.step_id) copy.step_id = copy.step_id + '_copy';
  if (copy.output_alias) copy.output_alias = copy.output_alias + '_copy';
  copy.x = DS.fn.snap(copy.x + 30);
  copy.y = DS.fn.snap(copy.y + 30);
  copy.source_inputs = [];
  addNode(copy);
  selectNode(copy.id);
  DS.fn.showPropsPanel(copy);
}

function _finishSelectNode(nodeId) {
  S.selectedNodeId = nodeId;
  S.selectedConnId = null;
  $('.df-node').each(function() {
    $(this).toggleClass('selected', $(this).attr('data-node-id') === nodeId);
  });
  $('.conn-path').each(function() { $(this).removeClass('selected'); });
  var node = DS.fn.getNode(nodeId);
  if (node) DS.fn.showPropsPanel(node);
}

function selectNode(nodeId) {
  if (S._currentPropsNode && S._currentPropsNode.id !== nodeId) {
    if (S._propsDirty) {
      var _prevNode = S._currentPropsNode;
      var _targetId = nodeId;
      DS.fn.studioConfirm(
        'You have unsaved changes. Do you want to save?',
        function() { DS.fn.applyPropsToNode(_prevNode); S._propsDirty = false; _finishSelectNode(_targetId); },
        function() { S._propsDirty = false; _finishSelectNode(_targetId); }
      );
      return;
    }
    silentApplyProps(S._currentPropsNode);
  }
  _finishSelectNode(nodeId);
}

function deselectAll() {
  S.selectedNodeId = null;
  S.selectedConnId = null;
  $('.df-node').each(function() { $(this).removeClass('selected'); });
  $('.conn-path').each(function() {
    $(this).removeClass('selected');
    this.setAttribute('marker-end', 'url(#arrow-default)');
  });
  hideConnDeletePopup();
  DS.fn.showEmptyProps();
}

/* Apply props silently on node switch — no toast/modal */
function silentApplyProps(node) {
  if (!node) return;
  try {
    var g = function(id) { var $el = $('#' + id); return $el.length ? $el.val().trim() : null; };
    var gc = function(id) { var $el = $('#' + id); return $el.length ? $el[0].checked : false; };
    var formExists = false;
    if (node.type === 'input')       formExists = !!$('#pi-name').length;
    else if (node.type === 'output' || node.type === 'efs_write') formExists = !!$('#po-name').length;
    else if (node.type === 'select') formExists = !!$('#ps-id').length;
    else if (node.type === 'filter') formExists = !!$('#pf-id').length;
    else if (node.type === 'join')   formExists = !!$('#pj-id').length;
    else if (node.type === 'aggregate') formExists = !!$('#pa-id').length;
    else if (node.type === 'union')  formExists = !!$('#pu-id').length;
    else if (node.type === 'validate') formExists = !!$('#pv-id').length;
    else formExists = !!$('#pc-id').length;
    if (!formExists) return;

    /* Read list editors into node */
    DS.fn.readListEditorIntoNode(node);

    if (node.type === 'input') {
      var oldName = node.name;
      var newName = g('pi-name');
      if (newName === null) return;
      node.name = newName || node.id;
      node.id   = node.name;
      node.format           = g('pi-format') || node.format;
      node.dataset_name     = g('pi-dataset-name') !== null ? g('pi-dataset-name') : node.dataset_name;
      node.delimiter_char   = g('pi-delimiter-char') || node.delimiter_char || '';
      if (oldName && oldName !== node.name) {
        S.connections.forEach(function(c) { if (c.from === oldName) c.from = node.id; if (c.to === oldName) c.to = node.id; });
        var $elOld = $('[data-node-id="' + oldName + '"]');
        if ($elOld.length) $elOld.attr('data-node-id', node.id);
      }
    } else if (node.type === 'output' || node.type === 'efs_write') {
      var oldNameO = node.name;
      var newNameO = g('po-name');
      if (newNameO === null) return;
      node.name = newNameO || node.id;
      node.id   = node.name;
      node.format      = g('po-format') || node.format;
      node.dataset_name = g('po-dataset-name') !== null ? g('po-dataset-name') : node.dataset_name;
      node.write_mode  = g('po-wmode') || node.write_mode;
      node.delimiter_char = g('po-delimiter-char') || node.delimiter_char || '';
      if (oldNameO && oldNameO !== node.name) {
        var $elOldO = $('[data-node-id="' + oldNameO + '"]');
        if ($elOldO.length) $elOldO.attr('data-node-id', node.id);
      }
    } else {
      var sid = g('ps-id') || g('pf-id') || g('pj-id') || g('pa-id') || g('pu-id') || g('pc-id') || g('pv-id');
      if (sid === null) return;
      node.step_id = sid || node.id;
      node.id = node.step_id;
      var desc = g('ps-desc') || g('pf-desc') || g('pj-desc') || g('pa-desc') || g('pu-desc') || g('pc-desc') || g('pv-desc');
      if (desc !== null) node.description = desc;
      var alias = g('ps-alias') || g('pf-alias') || g('pj-alias') || g('pa-alias') || g('pu-alias') || g('pc-alias') || g('pv-alias');
      if (alias !== null) node.output_alias = alias || node.step_id;
    }
    refreshNodeEl(node.id);
    renderConnections();
  } catch(e) {
    console.warn('[Studio] silentApplyProps error:', e);
  }
}

/* ================================================================
   CONNECTIONS
================================================================ */
function addConnection(fromId, toId) {
  if (S.connections.some(function(c) { return c.from === fromId && c.to === toId; })) return;
  var id = 'conn_' + (S._connCounter++);
  S.connections.push({ id: id, from: fromId, to: toId });

  var toNode   = DS.fn.getNode(toId);
  var fromNode = DS.fn.getNode(fromId);
  if (toNode && toNode.source_inputs !== undefined) {
    var srcAlias = DS.fn.getNodeOutputAlias(fromId);
    if (toNode.source_inputs.indexOf(srcAlias) < 0) toNode.source_inputs.push(srcAlias);
    if (toNode.type === 'validate') tryPrePopulateValidateRules(toNode);
    if (toNode.type === 'select')   tryPrePopulateSelectExpressions(toNode);
    if (S.selectedNodeId === toId) DS.fn.showPropsPanel(toNode);
  }

  if (fromNode && fromNode.type === 'select') {
    var srcExprs = fromNode.select_expressions || [];
    if (srcExprs.length === 0 && fromNode.source_inputs && fromNode.source_inputs.length > 0) {
      var srcFields = DS.fn.getFieldsForAlias(fromNode.source_inputs[0]);
      if (srcFields.length > 0) {
        var dstFields = [];
        if (toNode && Array.isArray(toNode.fields)) {
          dstFields = toNode.fields.map(function(f) { return f.name; }).filter(Boolean);
        }
        var srcNames = srcFields.map(function(f) { return f.name; });
        var mappings = DS.fn.buildFuzzyMappings(srcNames, dstFields.length ? dstFields : srcNames);
        fromNode.select_expressions = mappings.map(function(m) {
          return { expression: m.expression, target: m.target, operation: 'MOVE' };
        });
        if (S.selectedNodeId === fromId) DS.fn.showPropsPanel(fromNode);
        DS.fn.toast('Mapping expressions auto-filled with fuzzy matching!', 'info');
      }
    }
  }

  renderConnections();
  DS.fn.updateStatus();
}

function deleteConnection(connId) {
  S.connections = S.connections.filter(function(c) { return c.id !== connId; });
  renderConnections();
  DS.fn.updateStatus();
}

function renderConnections() {
  var $g = $('#connections-group');
  if (!$g.length) return;
  $g.empty();
  S.connections.forEach(function(c) {
    var from = DS.fn.getPortCenter(c.from, 'out');
    var to   = DS.fn.getPortCenter(c.to,   'in');
    var d    = DS.fn.elbowPath(from, to);

    /* KEEP RAW: SVG creation requires createElementNS */
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'conn-path' + (c.id === S.selectedConnId ? ' selected' : ''));
    path.setAttribute('data-conn-id', c.id);
    path.setAttribute('marker-end', c.id === S.selectedConnId ? 'url(#arrow-selected)' : 'url(#arrow-default)');

    $(path).on('click', function(e) {
      e.stopPropagation();
      S.selectedConnId = c.id;
      $('.conn-path').each(function() {
        $(this).removeClass('selected');
        this.setAttribute('marker-end', 'url(#arrow-default)');
      });
      $(path).addClass('selected');
      path.setAttribute('marker-end', 'url(#arrow-selected)');
      showConnDeletePopup(c.id, e.clientX, e.clientY);
    });
    $g.append(path);
  });
}

function drawTempConn(fromId, mx, my) {
  var from = DS.fn.getPortCenter(fromId, 'out');
  var to   = { x: mx, y: my };
  /* temp-connection is an SVG element — keep raw setAttribute for SVG attrs */
  var el   = document.getElementById('temp-connection');
  el.setAttribute('d', DS.fn.elbowPath(from, to));
  $(el).removeClass('hidden');
  el.setAttribute('marker-end', 'url(#arrow-temp)');
}

function hideTempConn() {
  var el = document.getElementById('temp-connection');
  if (el) {
    $(el).addClass('hidden');
    el.setAttribute('d', 'M -9999 -9999');
    el.removeAttribute('marker-end');
  }
}

/* ── Connection delete popup ── */
function showConnDeletePopup(connId, clientX, clientY) {
  _connDeleteTarget = connId;
  var $popup = $('#conn-delete-popup');
  if (!$popup.length) return;
  $popup.removeClass('hidden');
  var pw = 160, ph = 48;
  var vw = window.innerWidth, vh = window.innerHeight;
  var left = Math.min(clientX + 12, vw - pw - 8);
  var top  = Math.min(clientY + 12, vh - ph - 8);
  $popup.css({ left: left + 'px', top: top + 'px' });
}

function hideConnDeletePopup() {
  _connDeleteTarget = null;
  $('#conn-delete-popup').addClass('hidden');
}

function getConnDeleteTarget() { return _connDeleteTarget; }

/* ================================================================
   SCHEMA -> VALIDATE RULES HELPERS
================================================================ */
function tryPrePopulateValidateRules(node) {
  if (!node || node.type !== 'validate') return;
  if (node.validate_rules && node.validate_rules.length > 0) return;
  var fields = [];
  (node.source_inputs || []).some(function(alias) {
    var f = DS.fn.getFieldsForAlias(alias);
    if (f.length) { fields = f; return true; }
    return false;
  });
  if (!fields.length) return;
  node.validate_rules = DS.fn.fieldsToValidateRules(fields);
}

function tryPrePopulateSelectExpressions(node) {
  if (!node || node.type !== 'select') return;
  if (node.select_expressions && node.select_expressions.length > 0) return;
  var srcFields = [];
  (node.source_inputs || []).some(function(alias) {
    var f = DS.fn.getFieldsForAlias(alias);
    if (f.length) { srcFields = f; return true; }
    return false;
  });
  if (!srcFields.length) return;
  var srcNames = srcFields.map(function(f) { return f.name; });
  var mappings = DS.fn.buildFuzzyMappings(srcNames, srcNames);
  node.select_expressions = mappings.map(function(m) {
    return { expression: m.expression, target: m.target, operation: 'MOVE' };
  });
  if (S.selectedNodeId === node.id) DS.fn.showPropsPanel(node);
  DS.fn.toast('Mapping expressions auto-filled from source fields!', 'info');
}

/* ── Local context menu helper (avoids importing from setup.js) ── */
function showContextMenuLocal(x, y, nodeId) {
  var $menu = $('#ctx-menu');
  if (!$menu.length) return;
  $menu.css({ left: x + 'px', top: y + 'px' });
  $menu.removeClass('hidden');
  $menu.attr('data-node-id', nodeId);
}


/* ================================================================
   LOAD CONFIG INTO CANVAS
================================================================ */
function loadConfig(config) {
  /* Clear canvas */
  S.nodes = []; S.connections = [];
  $('#canvas-nodes').empty();
  S._nodeCounter = 1; S._connCounter = 1; S._typeCounters = {};
  S._inputCounter = 0; S._inputSeq = 0; S._outputSeq = 0; S._validateSeq = 0;
  deselectAll();

  var inputs  = config.Inputs  || {};
  var outputs = config.Outputs || {};
  var steps   = (config.Transformations || {}).steps || [];

  var colW   = C.NODE_W + 50;
  var rowH   = C.NODE_H + 70;
  var startX = 80;
  var startY = 60;

  var inputKeys  = Object.keys(inputs);
  var outputKeys = Object.keys(outputs);

  /* Row 0 — Inputs */
  inputKeys.forEach(function(name, idx) {
    var d = inputs[name];
    var n = DS.fn.defaultNodeData('input');
    n.id = name; n.name = name;
    n.format           = (d.format           || 'FIXED').toUpperCase();
    n.dataset_name     = d.dataset_name || d.source_file_name || '';
    n.source_path      = d.source_path      || d.s3_path || '';
    n.frequency        = (d.frequency        || '').toUpperCase();
    n.header_fields    = Array.isArray(d.header_fields)  ? d.header_fields  : [];
    n.fields           = Array.isArray(d.fields)         ? d.fields         : [];
    n.trailer_fields   = Array.isArray(d.trailer_fields) ? d.trailer_fields : [];
    if (d.record_length  !== undefined) n.record_length  = d.record_length;
    if (d.header_count   !== undefined) n.header_count   = d.header_count;
    if (d.trailer_count  !== undefined) n.trailer_count  = d.trailer_count;
    if (d.control_file_name) n.control_file_name = d.control_file_name;
    else if (d.count_file_path) n.control_file_name = d.count_file_path.split('/').pop();
    if (d.has_count_file)    n.has_count_file    = d.has_count_file;
    if (d.count_file_path)   n.count_file_path   = d.count_file_path;
    if (d.count_field_name)  n.count_field_name  = d.count_field_name;
    if (d.delimiter_char)    n.delimiter_char    = d.delimiter_char;
    if (d._schema_file) n._schema_file = d._schema_file;
    if (d._test_file)   n._test_file   = d._test_file;
    if (d._test_rows !== undefined) n._test_rows = d._test_rows;
    if (d.prev_day_check) n.prev_day_check = d.prev_day_check;
    n.x = DS.fn.snap(startX + idx * colW);
    n.y = DS.fn.snap(startY);
    addNode(n);
  });

  /* Rows 1..N — Steps */
  var stepCentreX = DS.fn.snap(startX + Math.max(0, (inputKeys.length - 1)) * colW / 2);
  var stepY = startY + rowH;

  steps.forEach(function(s) {
    var n = DS.fn.defaultNodeData(s.type || 'custom');
    n.id = s.id; n.step_id = s.id;
    n.description = s.description || '';
    n.output_alias= s.output_alias || s.id;
    n.source_inputs = Array.isArray(s.source_inputs) ? s.source_inputs : [];
    n.x = DS.fn.snap(stepCentreX);
    n.y = DS.fn.snap(stepY);
    stepY += rowH;

    var logic = s.logic || {};
    if (s.type === 'filter') {
      n.filter_conditions = (logic.conditions || []).map(function(c) {
        return { field: c.field, operation: (c.operation || '==').toUpperCase(), value: Array.isArray(c.value) ? c.value.join(', ') : String(c.value || '') };
      });
    } else if (s.type === 'select') {
      if (logic.expressions) {
        n.select_expressions = logic.expressions.map(function(e) {
          return { target: e.target, expression: e.expression, operation: (e.operation || 'MOVE').toUpperCase() };
        });
      } else {
        n.select_expressions = [];
      }
    } else if (s.type === 'join') {
      n.join_left = logic.left || '';
      n.join_right= logic.right || '';
      n.join_type = (logic.how || 'INNER').toUpperCase();
      n.join_keys = (logic.on || []).map(function(pair) {
        return { left: pair[0] || '', right: pair[1] || '' };
      });
      n.source_inputs = [n.join_left, n.join_right].filter(Boolean);
    } else if (s.type === 'aggregate') {
      n.agg_group_by = (logic.group_by || []).map(function(c) { return { col: c }; });
      n.agg_aggregations = (logic.aggregations || []).map(function(a) {
        return { field: a.field, operation: (a.operation || 'SUM').toUpperCase(), alias: a.alias, condition: a.condition || '' };
      });
    } else if (s.type === 'union') {
      n.union_distinct = !!logic.distinct;
    } else if (s.type === 'validate') {
      /* Map FLAG back to FLAGGED for UI display */
      var rawFm = (logic.fail_mode || 'FLAG').toUpperCase();
      n.fail_mode           = rawFm === 'FLAG' ? 'FLAGGED' : rawFm;
      n.dataset_name        = logic.dataset_name || logic.validated_file_name || '';
      n.error_dataset_name  = logic.error_dataset_name || logic.error_file_name || '';
      n.validated_path      = logic.validated_path    || logic.validation_bucket || '';
      n.error_path          = logic.error_path        || logic.error_bucket      || '';
      n.frequency          = (logic.frequency         || '').toUpperCase();
      /* Previous Day Check — supports both old and new field names */
      n.previous_day_check  = !!(logic.previous_day_check || logic.last_run_check);
      n.last_run_check      = n.previous_day_check;
      n.previous_day_header_date_field = logic.previous_day_header_date_field || '';
      /* Record Count Check */
      n.record_count_check         = !!logic.record_count_check;
      n.record_count_trailer_field = logic.record_count_trailer_field || '';
      /* Legacy fields preserved for backward compat */
      n.last_run_frequency  = logic.last_run_frequency  || '';
      n.last_run_file_path  = logic.last_run_file_path  || '';
      n.last_run_file_name  = logic.last_run_file_name  || '';
      n.partition_column    = logic.partition_column    || '';
      n.validate_rules = (logic.rules || []).map(function(r) {
        return {
          field:       r.field       || '',
          data_type:   (r.data_type  || 'TEXT').toUpperCase(),
          max_length:  r.max_length  || '',
          nullable:    r.nullable !== false,
          format:      (r.format     || 'ANY').toUpperCase(),
          date_format: r.date_format || '',
          pattern:     r.pattern     || ''
        };
      });
    } else if (s.type === 'ctrl_file') {
      n.ctrl_file_name    = logic.ctrl_file_name   || '';
      n.ctrl_include_header = !!logic.ctrl_include_header;
      n.ctrl_file_fields  = (logic.ctrl_file_fields || []).map(function(f) {
        return { name: f.name || '', type: (f.type || 'STRING').toUpperCase(), expression: f.expression || '', length: f.length || 0, begin: f.begin || 0, format: f.format || '', just_right: !!f.just_right };
      });
      n._ctrl_schema_file = logic._ctrl_schema_file || '';
    } else if (s.type === 'oracle_write') {
      n.ora_host         = logic.host         || '';
      n.ora_port         = String(logic.port  || '1521');
      n.ora_service_name = logic.service_name  || '';
      n.ora_schema       = logic.schema        || '';
      n.ora_table        = logic.table         || '';
      n.ora_load_mode    = (logic.load_mode   || 'APPEND').toUpperCase();
      n.ora_bad_file     = logic.bad_file_path     || '/tmp/sqlldr/output.bad';
      n.ora_log_file     = logic.log_file_path     || '/tmp/sqlldr/output.log';
      n.ora_discard_file = logic.discard_file_path || '';
      n.ora_batch_size   = parseInt(logic.batch_size || '10000', 10) || 10000;
      n.vault_path          = logic.vault_path          || '';
      n.vault_username_key  = logic.vault_username_key  || 'username';
      n.vault_password_key  = logic.vault_password_key  || 'password';
    } else {
      n.custom_logic = JSON.stringify(logic, null, 2);
    }

    addNode(n);

    n.source_inputs.forEach(function(src) {
      var srcNode = S.nodes.find(function(nd) {
        return (nd.name || nd.id) === src || (nd.step_id || nd.id) === src || nd.output_alias === src;
      });
      if (srcNode) {
        S.connections.push({ id: 'conn_' + (S._connCounter++), from: srcNode.id, to: n.id });
      }
    });
  });

  /* ── Legacy migration: extract ctrl_file from validate steps ── */
  S.nodes.slice().forEach(function(vn) {
    if (vn.type !== 'validate') return;
    /* Check if this validate node has legacy ctrl_file_create in the original step logic */
    var origStep = steps.find(function(s){ return (s.id || '') === (vn.step_id || vn.id); });
    var origLogic = (origStep && origStep.logic) || {};
    if (!origLogic.ctrl_file_create) return;
    /* Create a ctrl_file node from the legacy data */
    var cfNode = DS.fn.defaultNodeData('ctrl_file');
    cfNode.ctrl_file_name    = origLogic.ctrl_file_name   || '';
    cfNode.ctrl_include_header = !!origLogic.ctrl_include_header;
    cfNode.ctrl_file_fields  = (origLogic.ctrl_file_fields || []).map(function(f) {
      return { name: f.name || '', type: (f.type || 'STRING').toUpperCase(), expression: f.expression || '', length: f.length || 0, begin: f.begin || 0, format: f.format || '', just_right: !!f.just_right };
    });
    cfNode._ctrl_schema_file = origLogic._ctrl_schema_file || '';
    cfNode.source_inputs = [vn.output_alias || vn.step_id || vn.id];
    cfNode.x = vn.x + 220;
    cfNode.y = vn.y + 60;
    addNode(cfNode);
    S.connections.push({ id: 'conn_' + (S._connCounter++), from: vn.id, to: cfNode.id });
  });

  /* Last row — Outputs */
  outputKeys.forEach(function(name, idx) {
    var d = outputs[name];
    var _outType = (d.target_storage || '').toLowerCase() === 'efs' ? 'efs_write' : 'output';
    var n = DS.fn.defaultNodeData(_outType);
    n.id = name; n.name = name;
    n.format       = (d.format     || 'FIXED').toUpperCase();
    n.dataset_name = d.dataset_name || d.target_file_name || '';
    n.source_path  = d.source_path || d.s3_path || '';
    n.write_mode   = (d.write_mode || 'OVERWRITE').toUpperCase();
    n.frequency      = (d.frequency     || '').toUpperCase();
    n.header_fields  = Array.isArray(d.header_fields)  ? d.header_fields  : [];
    n.fields         = Array.isArray(d.fields)         ? d.fields         : [];
    n.trailer_fields = Array.isArray(d.trailer_fields) ? d.trailer_fields : [];
    n.control_fields = Array.isArray(d.control_fields) ? d.control_fields : [];
    n.output_columns = Array.isArray(d.output_columns) ? d.output_columns.join(', ') : (d.output_columns || '');
    n.source_inputs = Array.isArray(d.source_inputs) ? d.source_inputs : [];
    if (d.record_length    !== undefined) n.record_length    = d.record_length;
    if (d.header_count     !== undefined) n.header_count     = d.header_count;
    if (d.trailer_count    !== undefined) n.trailer_count    = d.trailer_count;
    if (d.control_file_path) n.control_file_path = d.control_file_path;
    if (d.delimiter_char)    n.delimiter_char    = d.delimiter_char;
    if (d.target_file_name)  n.target_file_name  = d.target_file_name;
    if (d._schema_file) n._schema_file = d._schema_file;
    if (d._test_file)   n._test_file   = d._test_file;
    if (d._test_rows !== undefined) n._test_rows = d._test_rows;
    n.x = DS.fn.snap(startX + idx * colW);
    n.y = DS.fn.snap(stepY);
    addNode(n);

    if (n.source_inputs.length > 0) {
      n.source_inputs.forEach(function(src) {
        var srcNode = S.nodes.find(function(nd) {
          return (nd.name || nd.id) === src ||
                 (nd.step_id || nd.id) === src ||
                 nd.output_alias === src;
        });
        if (srcNode) S.connections.push({ id: 'conn_' + (S._connCounter++), from: srcNode.id, to: n.id });
      });
    } else {
      var srcStep = S.nodes.find(function(nd) { return nd.output_alias === name && nd.type !== 'output' && nd.type !== 'efs_write'; });
      if (srcStep) {
        S.connections.push({ id: 'conn_' + (S._connCounter++), from: srcStep.id, to: n.id });
        n.source_inputs = [srcStep.output_alias || srcStep.step_id || srcStep.id];
      }
    }
  });

  renderConnections();
  DS.fn.syncTypeCounters();
  DS.fn.updateStatus();

  setTimeout(function() {
    if (S.layoutMode === 'horizontal') {
      DS.fn.autoLayoutHorizontal();
    } else {
      DS.fn.autoLayout();
    }
  }, 0);

  var cfgName = ($('#current-file').text() || '');
  if (cfgName && cfgName !== 'Select an interface') {
    DS.fn.fetchNodeFileMeta(cfgName);
  }
}


/* ================================================================
   PALETTE SETUP
================================================================ */
function setupPalette() {
  $('.palette-item').each(function() {
    var el = this;
    $(el).on('dragstart', function(e) {
      e.originalEvent.dataTransfer.setData('application/json', JSON.stringify({ type: $(el).attr('data-type') }));
      e.originalEvent.dataTransfer.effectAllowed = 'copy';
    });
  });
}

/* ================================================================
   TOOLBAR SETUP
================================================================ */
function setupToolbar() {
  var $tbSel = $('#tb-mode-select');
  var $tbCon = $('#tb-mode-connect');
  if ($tbSel.length) $tbSel.on('click', function() { DS.fn.setMode('select'); });
  if ($tbCon.length) $tbCon.on('click', function() { DS.fn.setMode('connect'); });

  $('#tb-zoom-in').on('click', function() {
    if (window.isJsonEditorActive && window.isJsonEditorActive()) {
      if (window.jsonEditorZoomIn) window.jsonEditorZoomIn();
      return;
    }
    S.zoom = Math.min(C.MAX_ZOOM, S.zoom + 0.1);
    DS.fn.applyTransform();
  });
  $('#tb-zoom-out').on('click', function() {
    if (window.isJsonEditorActive && window.isJsonEditorActive()) {
      if (window.jsonEditorZoomOut) window.jsonEditorZoomOut();
      return;
    }
    S.zoom = Math.max(C.MIN_ZOOM, S.zoom - 0.1);
    DS.fn.applyTransform();
  });
  $('#tb-fit').on('click', DS.fn.fitCanvas);
  $('#tb-auto-layout').on('click', DS.fn.autoLayout);
  var $tbHAlign = $('#tb-h-align');
  if ($tbHAlign.length) $tbHAlign.on('click', DS.fn.autoLayoutHorizontal);

  DS.fn.updateLayoutToggle('vertical');

  $('#tb-clear').on('click', function() {
    function doClear() {
      S.nodes = []; S.connections = [];
      $('#canvas-nodes').empty();
      $('#connections-group').empty();
      deselectAll();
      DS.fn.updateStatus();
      DS.fn.toast('Canvas cleared', 'info');
    }
    if (S.nodes.length === 0) { doClear(); }
    else { DS.fn.studioConfirm('Clear all nodes and connections?', doClear); }
  });

  var $tbNew = $('#tb-new');
  if ($tbNew.length) $tbNew.on('click', function() {
    function doNew() {
      S.nodes = []; S.connections = [];
      $('#canvas-nodes').empty();
      $('#connections-group').empty();
      var $cnInput = $('#toolbar-config-name');
      if ($cnInput.length) $cnInput.val('');
      deselectAll(); DS.fn.updateStatus();
      S.zoom = 1; S.panX = 60; S.panY = 60; DS.fn.applyTransform();
      DS.fn.toast('New canvas', 'info');
    }
    if (S.nodes.length === 0) { doNew(); }
    else { DS.fn.studioConfirm('Start fresh? Current canvas will be cleared.', doNew); }
  });

  $('#tb-export-json').on('click', openExportModal);
  $('#tb-import-json').on('click', function() {
    $('#import-modal').removeClass('hidden');
  });

  var $tbLoad = $('#tb-load');
  if ($tbLoad.length) $tbLoad.on('click', function() { openLoadModal(); });

  $('#tb-save').on('click', function() {
    var cfgName  = $('#current-file').text().trim();
    var name = cfgName || '';
    if (!name || name === 'Select an interface') {
      var tbVal = $('#toolbar-config-name').val();
      name = tbVal ? tbVal.trim() : '';
    }
    if (!name || name === 'Select an interface') { DS.fn.toast('Select or create an interface first', 'error'); return; }
    if (!name.toLowerCase().endsWith('.json')) name += '.json';
    var cfg = DS.fn.buildJson();
    if (!window.CodeParser || !window.CodeParser.API) { DS.fn.toast('Server not available — use Export instead', 'error'); return; }
    window.CodeParser.API.saveConfig(name, cfg).then(function(res) {
      if (res && res.error) {
        DS.fn.toast('Save failed: ' + res.error, 'error');
      } else {
        DS.fn.toast('Saved: ' + name.replace(/\.json$/i, ''), 'success');
        if (typeof window.refreshConfigList === 'function') window.refreshConfigList();
        if (typeof window.updateCanvasSnapshot === 'function') window.updateCanvasSnapshot();
      }
    }).catch(function(err) { DS.fn.toast('Save failed: ' + (err.message || 'Unknown error'), 'error'); });
  });
}

function openExportModal() {
  var cfg = DS.fn.buildJson();
  var json = JSON.stringify(cfg, null, 2);
  $('#export-json-output').html(DS.fn.highlightJson(json));
  $('#export-json-output').attr('data-raw', json);
  $('#export-modal').removeClass('hidden');
}

function openLoadModal() {
  var $sel = $('#load-config-select');
  $sel.html('<option value="">-- Select a config --</option>');
  if (window.CodeParser && window.CodeParser.API) {
    window.CodeParser.API.configs().then(function(res) {
      (res.configs || []).forEach(function(c) {
        var $opt = $('<option>');
        $opt.val(c.relative || c.path);
        $opt.text(c.name || c.relative);
        $sel.append($opt);
      });
    }).catch(function() { DS.fn.toast('Could not load config list', 'error'); });
  }
  $('#load-modal').removeClass('hidden');
}

/* ================================================================
   MODAL SETUP
================================================================ */
function setupModals() {
  $('[data-modal]').each(function() {
    var $btn = $(this);
    $btn.on('click', function() {
      var mid = $btn.attr('data-modal');
      $('#' + mid).addClass('hidden');
    });
  });

  $('#export-copy-btn').on('click', function() {
    var raw = $('#export-json-output').attr('data-raw') || '';
    navigator.clipboard.writeText(raw).then(function() { DS.fn.toast('Copied to clipboard', 'success'); });
  });
  $('#export-download-btn').on('click', function() {
    var raw = $('#export-json-output').attr('data-raw') || '';
    var cfgName = $('#current-file').text().trim();
    var name = cfgName || 'dataflow_config';
    if (name === 'Select an interface') name = 'dataflow_config';
    name = name.replace(/\.json$/i, '');
    if (!name.endsWith('.json')) name += '.json';
    var $a = $('<a>');
    $a.attr('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(raw));
    $a.attr('download', name);
    $a[0].click();
  });

  /* Auto-read selected file into textarea and capture filename */
  var _importPendingJson = null;
  var _importPendingName = '';
  $('#import-file-input').on('change', function() {
    var file = this.files && this.files[0];
    if (!file) return;
    _importPendingName = file.name.replace(/\.json$/i, '');
    var reader = new FileReader();
    reader.onload = function(e) { $('#import-json-text').val(e.target.result); };
    reader.readAsText(file);
  });

  $('#import-apply-btn').on('click', function() {
    var text = $('#import-json-text').val().trim();
    if (!text) { DS.fn.toast('No JSON provided', 'error'); return; }
    var cfg;
    try { cfg = JSON.parse(text); }
    catch(err) { DS.fn.toast('Invalid JSON: ' + err.message, 'error'); return; }
    _importPendingJson = cfg;
    $('#import-confirm-name').val(_importPendingName || '');
    $('#import-modal').addClass('hidden');
    $('#import-confirm-modal').removeClass('hidden');
  });

  function closeImportConfirm() { $('#import-confirm-modal').addClass('hidden'); }
  $('#import-confirm-close, #import-confirm-cancel').on('click', closeImportConfirm);
  $('#import-confirm-modal').on('click', function(e) { if (e.target === this) closeImportConfirm(); });

  $('#import-confirm-ok').on('click', function() {
    var name = $('#import-confirm-name').val().trim();
    if (!name) { DS.fn.toast('Enter a config name', 'error'); return; }
    if (!_importPendingJson) { closeImportConfirm(); return; }
    var cfg  = _importPendingJson;
    var path = name.replace(/\.json$/i, '') + '.json';
    var api  = window.CodeParser && window.CodeParser.API;
    function afterSave() {
      loadConfig(cfg);
      var $cf = $('#current-file');
      if ($cf.length) $cf.text(name.replace(/\.json$/i, ''));
      if (window.refreshConfigList) window.refreshConfigList();
      DS.fn.toast('Loaded: ' + path, 'success');
    }
    if (api && api.saveConfig) {
      api.saveConfig(path, cfg).then(afterSave).catch(function(err) {
        DS.fn.toast('Save failed: ' + (err.message || err), 'error');
      });
    } else {
      afterSave();
    }
    _importPendingJson = null;
    _importPendingName = '';
    $('#import-file-input').val('');
    $('#import-json-text').val('');
    closeImportConfirm();
  });

  $('#load-apply-btn').on('click', function() {
    var path = $('#load-config-select').val();
    if (!path) { DS.fn.toast('Select a config first', 'error'); return; }
    if (!window.CodeParser || !window.CodeParser.API) { DS.fn.toast('Server not available', 'error'); return; }
    window.CodeParser.API.getConfig(path).then(function(cfg) {
      loadConfig(cfg);
      $('#load-modal').addClass('hidden');
      var name = path.split('/').pop().replace(/\.json$/i, '');
      $('#toolbar-config-name').val(name);
      DS.fn.toast('Loaded: ' + name, 'success');
    }).catch(function(err) { DS.fn.toast('Load failed: ' + (err.message || 'Unknown error'), 'error'); });
  });
}

/* ================================================================
   CONTEXT MENU
================================================================ */
function showContextMenu(x, y, nodeId) {
  var $menu = $('#ctx-menu');
  $menu.css({ left: x + 'px', top: y + 'px' });
  $menu.removeClass('hidden');
  $menu.attr('data-node-id', nodeId);
}

function setupContextMenu() {
  $('#ctx-edit').on('click', function() {
    var nid = $('#ctx-menu').attr('data-node-id');
    var node = S.nodes.find(function(n) { return n.id === nid; });
    if (node) { selectNode(nid); DS.fn.showPropsPanel(node); }
    $('#ctx-menu').addClass('hidden');
  });
  $('#ctx-duplicate').on('click', function() {
    var nid = $('#ctx-menu').attr('data-node-id');
    duplicateNode(nid);
    $('#ctx-menu').addClass('hidden');
  });
  $('#ctx-delete').on('click', function() {
    var nid = $('#ctx-menu').attr('data-node-id');
    deleteNode(nid);
    $('#ctx-menu').addClass('hidden');
  });
  $(document).on('click', function(e) {
    if (!$(e.target).closest('#ctx-menu').length) $('#ctx-menu').addClass('hidden');
  });
}

/* ================================================================
   KEYBOARD SHORTCUTS
================================================================ */
function setupKeyboard() {
  $(document).on('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    var $activeRp = $('.right-panel-content:not(.rp-hidden)');
    if ($activeRp.length && $activeRp.attr('id') !== 'right-panel-props' && $activeRp[0].contains(document.activeElement)) return;
    switch(e.key) {
      case 'f': case 'F':
        DS.fn.fitCanvas(); break;
      case 'a': case 'A':
        if (!e.ctrlKey && !e.metaKey) DS.fn.autoLayout(); break;
      case 'Delete': case 'Backspace':
        if (S.selectedNodeId) {
          DS.fn.studioConfirm('Delete selected node?', function() { deleteNode(S.selectedNodeId); });
        } else if (S.selectedConnId) {
          deleteConnection(S.selectedConnId);
        }
        break;
      case 'Escape':
        deselectAll();
        S.connectFrom = null; hideTempConn();
        hideConnDeletePopup();
        $('#ctx-menu').addClass('hidden');
        break;
      case '+': case '=':
        S.zoom = Math.min(C.MAX_ZOOM, S.zoom + 0.1); DS.fn.applyTransform(); break;
      case '-':
        S.zoom = Math.max(C.MIN_ZOOM, S.zoom - 0.1); DS.fn.applyTransform(); break;
      case 'h': case 'H':
        if (!e.ctrlKey && !e.metaKey) DS.fn.autoLayoutHorizontal(); break;
      case 's': case 'S':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); $('#tb-save').trigger('click'); } break;
      case 'e': case 'E':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); openExportModal(); } break;
    }
  });
}

/* ================================================================
   LOAD APP SETTINGS
================================================================ */
function loadAppSettings() {
  fetch('/api/settings').then(function(r) { return r.json(); }).then(function(d) {
    S._appSettings = d || {};
  }).catch(function() {});
}

/* ================================================================
   INIT
================================================================ */
function init() {
  loadAppSettings();
  setupPalette();
  setupCanvasEvents();
  setupToolbar();
  setupModals();
  setupContextMenu();
  setupKeyboard();
  DS.fn.updateStatus();
  DS.fn.applyTransform();

  /* Connection delete popup button */
  var $connDeleteBtn = $('#conn-delete-btn');
  if ($connDeleteBtn.length) {
    $connDeleteBtn.on('click', function() {
      var target = getConnDeleteTarget();
      if (target) {
        deleteConnection(target);
        hideConnDeletePopup();
        deselectAll();
      }
    });
  }
  $(document).on('mousedown', function(e) {
    var $popup = $('#conn-delete-popup');
    if ($popup.length && !$popup[0].contains(e.target) && !$(e.target).closest('.conn-path').length) {
      hideConnDeletePopup();
    }
  });

  /* ── Expose globals for integration script (app.js / CodeParser API) ── */
  window.studioLoadConfig  = loadConfig;
  window.studioGetJson     = DS.fn.buildJson;
  window.studioLoadJson    = function(jsonStr) {
    try { var cfg = JSON.parse(jsonStr); loadConfig(cfg); return { ok: true }; }
    catch(e) { DS.fn.toast('Invalid JSON: ' + e.message, 'error'); return { ok: false, error: e.message }; }
  };
  window.studioFit              = DS.fn.fitCanvas;
  window.studioAutoLayout       = DS.fn.autoLayout;
  window.studioAutoLayoutH      = DS.fn.autoLayoutHorizontal;
  window.studioClearCanvas = function() {
    S.nodes = []; S.connections = [];
    $('#canvas-nodes').empty();
    $('#connections-group').empty();
    S.layoutMode = 'vertical';
    var $cw = $('.studio-canvas-wrap');
    if ($cw.length) { $cw.removeClass('layout-h').addClass('layout-v'); }
    deselectAll(); DS.fn.updateStatus();
  };
  window.studioShowEmpty        = DS.fn.showEmptyProps;
  window.studioConfirm          = DS.fn.studioConfirm;
  window.studioToast            = DS.fn.toast;
  window.studioReloadSettings   = loadAppSettings;
  window._studioPropsDirty      = function() { return S._propsDirty; };
  window._studioCurrentPropsNode = function() { return S._currentPropsNode; };
  window._studioApplyProps      = DS.fn.applyPropsToNode;
  window._studioAddNode         = addNode;
  window._studioDeselectAll     = deselectAll;
  window._studioReadListEditorIntoNode = DS.fn.readListEditorIntoNode;
  window._studioShowPropsPanel  = DS.fn.showPropsPanel;
  window._studioBuildJson       = DS.fn.buildJson;

  /* ── Expression info popup toggle (i button in ctrl-file field editor) ── */
  $(document).on('click', function(e) {
    var $btn = $(e.target).closest('#cf-expr-info-btn');
    var $popup = $('#cf-expr-popup');
    if (!$popup.length) return;
    if ($btn.length) {
      e.stopPropagation();
      var isVisible = $popup.hasClass('visible');
      $popup.removeClass('visible');
      if (!isVisible) {
        // Position popup using fixed coords relative to button
        var r = $btn[0].getBoundingClientRect();
        var popupW = 360;
        // Prefer opening to the left of the button so it doesn't clip off screen
        var leftPos = r.right - popupW;
        if (leftPos < 8) leftPos = 8;
        $popup.css({ top: (r.bottom + 6) + 'px', left: leftPos + 'px', right: 'auto' });
        $popup.addClass('visible');
      }
      return;
    }
    // Close if click is outside the popup
    if (!$(e.target).closest('#cf-expr-popup').length) {
      $popup.removeClass('visible');
    }
  });

  /* ── Click-to-edit delegation for .cte-cell elements ── */
  $(document).on('click', function(e) {
    var $cell = $(e.target).closest('.cte-cell');
    if (!$cell.length || $cell.hasClass('cte-editing') || $cell.hasClass('cte-check-cell')) return;
    $cell.addClass('cte-editing');
    var $hidden = $cell.find('input[type="hidden"]');
    if (!$hidden.length) return;
    var $display = $cell.find('.cte-display');
    if ($display.length) $display.hide();

    var fieldName = $cell.attr('data-field');
    var $editor;
    if (fieldName === 'type') {
      $editor = $('<select>').addClass('cte-inline-input');
      C.FIELD_TYPES.forEach(function(ft) {
        var $opt = $('<option>').val(ft).text(ft);
        if (ft === $hidden.val()) $opt.prop('selected', true);
        $editor.append($opt);
      });
    } else if (fieldName === 'start' || fieldName === 'length') {
      $editor = $('<input>').attr('type', 'number').addClass('cte-inline-input').val($hidden.val());
    } else {
      $editor = $('<input>').attr('type', 'text').addClass('cte-inline-input').val($hidden.val());
    }
    $cell.append($editor);
    $editor.focus();
    if ($editor[0].select) $editor[0].select();

    function commit() {
      $hidden.val($editor.val());
      if ($display.length) {
        $display.text($editor.val() || '\u2014');
        $display.show();
      }
      $cell.removeClass('cte-editing');
      $editor.remove();
      S._propsDirty = true;
    }
    $editor.on('blur', commit);
    $editor.on('keydown', function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { $editor.val($hidden.val()); commit(); }
    });
  });

  /* ── Props drawer resize handle ── */
  (function() {
    var $handle = $('#drawer-resize-handle');
    var $drawer = $('#node-props-drawer');
    if (!$handle.length || !$drawer.length) return;

    var _dragging = false;
    var _startX   = 0;
    var _startW   = 0;
    var MIN_W     = 320;
    var MAX_W     = 820;

    try {
      var _savedDW = parseInt(localStorage.getItem('studio_drawer_w'), 10);
      if (_savedDW >= MIN_W && _savedDW <= MAX_W) {
        $drawer.css('width', _savedDW + 'px');
      }
    } catch(e) {}

    $handle.on('mousedown', function(e) {
      e.preventDefault();
      _dragging = true;
      _startX   = e.clientX;
      _startW   = $drawer.outerWidth();
      $(document.body).css({ userSelect: 'none', cursor: 'col-resize' });
    });

    $(document).on('mousemove', function(e) {
      if (!_dragging) return;
      var delta = _startX - e.clientX;
      var newW  = Math.min(Math.max(_startW + delta, MIN_W), MAX_W);
      $drawer.css('width', newW + 'px');
    });

    $(document).on('mouseup', function() {
      if (!_dragging) return;
      _dragging = false;
      $(document.body).css({ userSelect: '', cursor: '' });
      try { localStorage.setItem('studio_drawer_w', $drawer.outerWidth()); } catch(e) {}
    });
  })();
}

/* ================================================================
   EXPORTS TO DS.fn
================================================================ */
DS.fn.renderAllNodes       = renderAllNodes;
DS.fn.buildNodeEl          = buildNodeEl;
DS.fn.refreshNodeEl        = refreshNodeEl;
DS.fn.addNode              = addNode;
DS.fn.deleteNode           = deleteNode;
DS.fn.duplicateNode        = duplicateNode;
DS.fn.selectNode           = selectNode;
DS.fn.deselectAll          = deselectAll;
DS.fn.addConnection        = addConnection;
DS.fn.deleteConnection     = deleteConnection;
DS.fn.renderConnections    = renderConnections;
DS.fn.drawTempConn         = drawTempConn;
DS.fn.hideTempConn         = hideTempConn;
DS.fn.loadConfig           = loadConfig;
DS.fn.silentApplyProps     = silentApplyProps;

/* ================================================================
   BOOTSTRAP
================================================================ */
if (document.readyState === "loading") {
  $(init);
} else {
  init();
}

})(window.DS);
