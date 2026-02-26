/**
 * Dataflow Studio — draw.io-style dataflow JSON builder.
 * USB Bank Developer Portal template. Orthogonal (straight elbow) connections.
 * Supports: Input, Output, Select, Filter, Join, Aggregate, Union, Custom nodes.
 * Generates dataflow-engine compatible JSON.
 */
(function () {
  'use strict';

  /* ================================================================
     CONSTANTS & CONFIG
  ================================================================ */
  var GRID = 20;
  var NODE_W = 172;
  var NODE_H = 74;
  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 2.5;
  var ELBOW_GAP = 30; // vertical gap from port before horizontal segment

  /* SVG icons for each node type (used in node header) */
  var TYPE_ICONS = {
    input: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    output:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    select:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
    filter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    join:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/></svg>',
    aggregate:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4H6l6 8-6 8h12"/></svg>',
    union: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    custom:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14M12 2v2M12 20v2"/></svg>'
  };

  var TYPE_META = {
    input:     { label: 'Input',     color: '#16a34a' },
    output:    { label: 'Output',    color: '#d97706' },
    select:    { label: 'Select',    color: '#2563eb' },
    filter:    { label: 'Filter',    color: '#7c3aed' },
    join:      { label: 'Join',      color: '#0891b2' },
    aggregate: { label: 'Aggregate', color: '#dc2626' },
    union:     { label: 'Union',     color: '#0284c7' },
    custom:    { label: 'Custom',    color: '#64748b' }
  };

  var SELECT_OPS = ['move','add','subtract','multiply','divide','compute','initialize','string','unstring','inspect'];
  var FILTER_OPS = ['==','!=','>','<','>=','<=','in','not_in'];
  var JOIN_TYPES  = ['inner','left','right','full'];
  var AGG_OPS    = ['sum','count','avg','min','max'];
  var FORMATS_IN  = ['csv','parquet','cobol','fixed'];
  var FORMATS_OUT = ['parquet','csv','cobol'];
  var WRITE_MODES = ['overwrite','append'];
  var FIELD_TYPES = ['string','int','long','double','decimal','date','timestamp'];

  /* ================================================================
     STATE
  ================================================================ */
  var nodes = [];
  var connections = [];
  var selectedNodeId = null;
  var selectedConnId = null;
  var _currentPropsNode = null; // tracks node currently shown in props drawer
  var mode = 'select'; // 'select' | 'connect'
  var zoom = 1;
  var panX = 0, panY = 0;
  var _nodeCounter = 1;
  var _connCounter = 1;

  // drag state
  var dragging = null; // { nodeId, offX, offY, moved }
  // connect state
  var connectFrom = null; // nodeId
  var tempConnMouse = null;
  // pan state
  var panning = null; // { startX, startY, startPanX, startPanY, moved }

  /* ── per-config node file metadata cache ──
     Keyed by config name: { NODE_NAME: { test_file, copybook_file, rows, fields, type } }
  ── */
  var _nodeFileMeta = {};

  /* ================================================================
     UTILS
  ================================================================ */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function snap(v) { return Math.round(v / GRID) * GRID; }
  function uid(type) {
    var base = type.toUpperCase().slice(0,3);
    return base + '_' + (_nodeCounter++);
  }
  function getNode(id) { return nodes.find(function(n){ return n.id===id; }); }
  function getConn(id) { return connections.find(function(c){ return c.id===id; }); }

  function toast(msg, type) {
    type = type || 'info';
    var cp = window.CodeParser;

    /* ── Route to the shared modal popup system ── */
    if (type === 'error') {
      if (cp && cp.showErrorPopup) {
        cp.showErrorPopup('Error', msg, '');
      } else if (cp && cp.showMessagePopup) {
        cp.showMessagePopup('Error', msg, 'error');
      } else {
        _toastFallback(msg, type);
      }
      return;
    }

    if (type === 'success') {
      if (cp && cp.showMessagePopup) {
        cp.showMessagePopup('Success', msg, 'success');
      } else {
        _toastFallback(msg, type);
      }
      return;
    }

    /* info and everything else */
    if (cp && cp.showMessagePopup) {
      cp.showMessagePopup('Information', msg, 'success');
    } else {
      _toastFallback(msg, type);
    }
  }

  /* Fallback visual toast used only when CodeParser is not yet initialised */
  function _toastFallback(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    var container = document.getElementById('toast-container');
    if (container) {
      container.appendChild(el);
      setTimeout(function () { el.remove(); }, 3500);
    }
  }

  function updateStatus() {
    var sn = document.getElementById('status-nodes');
    var sc = document.getElementById('status-conns');
    var sm = document.getElementById('status-mode');
    if (sn) sn.textContent = nodes.length;
    if (sc) sc.textContent = connections.length;
    if (sm) sm.innerHTML = 'Mode: <b>' + (mode === 'select' ? 'Select' : 'Connect') + '</b>';
    document.getElementById('drop-hint').classList.toggle('hidden', nodes.length > 0);
  }

  /* ================================================================
     DEFAULT LOGIC per type
  ================================================================ */
  function defaultNodeData(type) {
    var id = uid(type);
    var base = {
      id: id,
      type: type,
      x: snap(200 + Math.random() * 300),
      y: snap(150 + Math.random() * 200),
      width: NODE_W,
      height: NODE_H
    };
    if (type === 'input') {
      return Object.assign(base, {
        name: id,
        format: 'csv',
        path: 'data/input/' + id.toLowerCase() + '.csv',
        s3_path: '',
        dataset: '',
        copybook: '',
        fields: []
      });
    }
    if (type === 'output') {
      return Object.assign(base, {
        name: id,
        format: 'parquet',
        path: 'data/output/' + id.toLowerCase(),
        s3_path: '',
        dataset: '',
        copybook: '',
        write_mode: 'overwrite',
        fields: [],
        output_columns: ''
      });
    }
    // steps
    return Object.assign(base, {
      step_id: id.toLowerCase(),
      description: '',
      output_alias: id.toLowerCase(),
      source_inputs: [],
      // type-specific logic fields
      filter_conditions: [], // [{field, op, value}]
      select_expressions: [], // [{target, expression, operation}]
      join_left: '',
      join_right: '',
      join_type: 'inner',
      join_keys: [], // [{left, right}]
      agg_group_by: [], // [{col}]
      agg_aggregations: [], // [{field, op, alias, condition}]
      union_distinct: false,
      custom_logic: '{}'
    });
  }

  /* ================================================================
     NODE RENDERING
  ================================================================ */
  function renderAllNodes() {
    var container = document.getElementById('canvas-nodes');
    container.innerHTML = '';
    nodes.forEach(function(n){ container.appendChild(buildNodeEl(n)); });
    bindAllNodeEvents();
  }

  function buildNodeEl(node) {
    var meta = TYPE_META[node.type] || TYPE_META.custom;
    var icon = TYPE_ICONS[node.type] || TYPE_ICONS.custom;
    var isInput  = node.type === 'input';
    var isOutput = node.type === 'output';

    var title = isInput || isOutput ? node.name || node.id
               : node.output_alias || node.step_id || node.id;
    var subtitle = isInput  ? (node.format || '') + (node.path ? ' · ' + node.path.split('/').pop() : '')
                 : isOutput ? (node.format || '') + (node.path ? ' · ' + node.path.split('/').pop() : '')
                 : node.description || node.type;

    var el = document.createElement('div');
    el.className = 'df-node node-' + node.type + (node.id === selectedNodeId ? ' selected' : '');
    el.setAttribute('data-node-id', node.id);
    el.style.left  = node.x + 'px';
    el.style.top   = node.y + 'px';
    el.style.width = node.width + 'px';

    /* Elevated circular badge + clean card body */
    el.innerHTML =
      (!isInput ? '<div class="node-port port-in" data-port="in" data-node="' + node.id + '"></div>' : '') +
      '<div class="node-icon-badge">' + icon + '</div>' +
      '<div class="node-body">' +
        '<div class="node-type-label">' + esc(meta.label) + '</div>' +
        '<div class="node-title">' + esc(title) + '</div>' +
        '<div class="node-subtitle">' + esc(subtitle) + '</div>' +
      '</div>' +
      (!isOutput ? '<div class="node-port port-out" data-port="out" data-node="' + node.id + '"></div>' : '');
    return el;
  }

  function refreshNodeEl(nodeId) {
    var node = getNode(nodeId);
    if (!node) return;
    var old = document.querySelector('[data-node-id="' + nodeId + '"]');
    if (!old) return;
    var newEl = buildNodeEl(node);
    old.replaceWith(newEl);
    bindNodeEvents(newEl);
  }

  /* ================================================================
     NODE EVENTS
  ================================================================ */
  function bindAllNodeEvents() {
    document.querySelectorAll('.df-node').forEach(bindNodeEvents);
  }

  function bindNodeEvents(el) {
    if (!el) return;
    var nodeId = el.getAttribute('data-node-id');

    // Select + drag start on node body
    el.addEventListener('mousedown', function(e) {
      if (e.target.classList.contains('node-port')) return;
      e.stopPropagation();

      if (mode === 'connect') {
        // in connect mode, clicking the node (not a port) does nothing special
        return;
      }

      selectNode(nodeId);
      // Use wrap-relative coords + pan offset so position is always accurate
      var _wrap = document.getElementById('canvas-wrap');
      var _wr   = _wrap.getBoundingClientRect();
      var node  = getNode(nodeId);
      dragging = {
        nodeId: nodeId,
        offX: (e.clientX - _wr.left - panX) / zoom - node.x,
        offY: (e.clientY - _wr.top  - panY) / zoom - node.y,
        moved: false
      };
    });

    // Right-click context menu
    el.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      selectNode(nodeId);
      showContextMenu(e.clientX, e.clientY, nodeId);
    });

    // Port events for connection
    el.querySelectorAll('.node-port').forEach(function(port) {
      port.addEventListener('mousedown', function(e) {
        e.stopPropagation();
        var portType = port.getAttribute('data-port');
        if (mode !== 'connect') return;

        if (portType === 'out') {
          connectFrom = nodeId;
          tempConnMouse = null;
        } else if (portType === 'in') {
          if (connectFrom && connectFrom !== nodeId) {
            addConnection(connectFrom, nodeId);
            connectFrom = null;
            hideTempConn();
          }
        }
      });

      port.addEventListener('mouseenter', function() { port.classList.add('highlight'); });
      port.addEventListener('mouseleave', function() { port.classList.remove('highlight'); });
    });
  }

  /* ================================================================
     CANVAS MOUSE EVENTS
  ================================================================ */
  function setupCanvasEvents() {
    var wrap = document.getElementById('canvas-wrap');

    wrap.addEventListener('mousedown', function(e) {
      if (e.target.classList.contains('node-port')) return;
      if (e.target.closest('.df-node')) return;

      if (mode === 'connect') {
        connectFrom = null;
        hideTempConn();
        return;
      }

      // Left-click (or middle-click) on empty canvas → start pan
      // Deselect only if the mouse is released without dragging (see mouseup)
      if (e.button === 0 || e.button === 1) {
        e.preventDefault();
        panning = {
          startX: e.clientX, startY: e.clientY,
          startPanX: panX, startPanY: panY,
          moved: false
        };
        wrap.classList.add('pan-mode');
      }
    });

    wrap.addEventListener('mousemove', function(e) {
      // ── Drag a node ──────────────────────────────────────────────
      if (dragging) {
        var node = getNode(dragging.nodeId);
        if (!node) return;
        var wrapRect = wrap.getBoundingClientRect();
        var nx = snap((e.clientX - wrapRect.left - panX) / zoom - dragging.offX);
        var ny = snap((e.clientY - wrapRect.top  - panY) / zoom - dragging.offY);
        if (Math.abs(nx - node.x) > 1 || Math.abs(ny - node.y) > 1) {
          dragging.moved = true;
          node.x = Math.max(0, nx);
          node.y = Math.max(0, ny);
          var el = document.querySelector('[data-node-id="' + dragging.nodeId + '"]');
          if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
          renderConnections();
        }
      }

      // ── Pan canvas ───────────────────────────────────────────────
      if (panning) {
        var dx = e.clientX - panning.startX;
        var dy = e.clientY - panning.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          panning.moved = true;
          panX = panning.startPanX + dx;
          panY = panning.startPanY + dy;
          applyTransform();
        }
      }

      // ── Temp connection line ─────────────────────────────────────
      if (mode === 'connect' && connectFrom) {
        var wrapRect = wrap.getBoundingClientRect();
        var mx = (e.clientX - wrapRect.left - panX) / zoom;
        var my = (e.clientY - wrapRect.top  - panY) / zoom;
        tempConnMouse = { x: mx, y: my };
        drawTempConn(connectFrom, mx, my);
      }
    });

    wrap.addEventListener('mouseup', function(e) {
      if (dragging) { dragging = null; }
      if (panning) {
        // Pure click (no drag) on empty canvas → deselect nodes
        if (!panning.moved) { deselectAll(); }
        panning = null;
        wrap.classList.remove('pan-mode');
      }
      if (mode === 'connect' && connectFrom) {
        if (!e.target.classList.contains('node-port')) {
          connectFrom = null;
          hideTempConn();
        }
      }
    });

    // Release drag/pan even when mouse leaves the canvas entirely
    document.addEventListener('mouseup', function() {
      if (dragging) { dragging = null; }
      if (panning)  { panning = null; wrap.classList.remove('pan-mode'); }
    });

    // Scroll to zoom
    wrap.addEventListener('wheel', function(e) {
      e.preventDefault();
      var wrapRect = wrap.getBoundingClientRect();
      var mx = e.clientX - wrapRect.left;
      var my = e.clientY - wrapRect.top;
      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      var newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
      // Zoom toward mouse position
      panX = mx - (mx - panX) * (newZoom / zoom);
      panY = my - (my - panY) * (newZoom / zoom);
      zoom = newZoom;
      applyTransform();
    }, { passive: false });

    // Drop from palette
    wrap.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    wrap.addEventListener('drop', function(e) {
      e.preventDefault();
      var data = e.dataTransfer.getData('application/json');
      if (!data) return;
      try {
        var payload = JSON.parse(data);
        var wrapRect = wrap.getBoundingClientRect();
        var cx = (e.clientX - wrapRect.left - panX) / zoom;
        var cy = (e.clientY - wrapRect.top  - panY) / zoom;
        var node = defaultNodeData(payload.type);
        node.x = snap(cx - NODE_W/2);
        node.y = snap(cy - NODE_H/2);
        addNode(node);
        selectNode(node.id);
        showPropsPanel(node);
      } catch(err) { console.warn('Drop error', err); }
    });
  }

  function applyTransform() {
    var canvas = document.getElementById('canvas');
    canvas.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    canvas.style.transformOrigin = '0 0';
    var disp = document.getElementById('zoom-display');
    if (disp) disp.textContent = Math.round(zoom * 100) + '%';
  }

  /* ================================================================
     NODE CRUD
  ================================================================ */
  function addNode(node) {
    nodes.push(node);
    var container = document.getElementById('canvas-nodes');
    var el = buildNodeEl(node);
    container.appendChild(el);
    bindNodeEvents(el);
    updateStatus();
  }

  function deleteNode(nodeId) {
    nodes = nodes.filter(function(n){ return n.id !== nodeId; });
    connections = connections.filter(function(c){ return c.from !== nodeId && c.to !== nodeId; });
    var el = document.querySelector('[data-node-id="' + nodeId + '"]');
    if (el) el.remove();
    if (selectedNodeId === nodeId) { selectedNodeId = null; showEmptyProps(); }
    renderConnections();
    updateStatus();
  }

  function duplicateNode(nodeId) {
    var node = getNode(nodeId);
    if (!node) return;
    var copy = JSON.parse(JSON.stringify(node));
    copy.id = uid(copy.type);
    if (copy.name) copy.name = copy.name + '_copy';
    if (copy.step_id) copy.step_id = copy.step_id + '_copy';
    if (copy.output_alias) copy.output_alias = copy.output_alias + '_copy';
    copy.x = snap(copy.x + 30);
    copy.y = snap(copy.y + 30);
    copy.source_inputs = [];
    addNode(copy);
    selectNode(copy.id);
    showPropsPanel(copy);
  }

  function selectNode(nodeId) {
    /* Auto-apply any unsaved edits from the previously open props panel */
    if (_currentPropsNode && _currentPropsNode.id !== nodeId) {
      silentApplyProps(_currentPropsNode);
    }
    selectedNodeId = nodeId;
    selectedConnId = null;
    document.querySelectorAll('.df-node').forEach(function(el){
      el.classList.toggle('selected', el.getAttribute('data-node-id') === nodeId);
    });
    document.querySelectorAll('.conn-path').forEach(function(el){ el.classList.remove('selected'); });
    var node = getNode(nodeId);
    if (node) showPropsPanel(node);
  }

  /* Apply props silently (no toast/modal, no auto-save) — used on switch */
  function silentApplyProps(node) {
    if (!node) return;
    try {
      var g = function(id){ var el=document.getElementById(id); return el ? el.value.trim() : null; };
      var gc = function(id){ var el=document.getElementById(id); return el ? el.checked : false; };
      /* Only apply if the form fields for this node type actually exist in the DOM */
      var formExists = false;
      if (node.type === 'input')     formExists = !!document.getElementById('pi-name');
      else if (node.type === 'output') formExists = !!document.getElementById('po-name');
      else if (node.type === 'select') formExists = !!document.getElementById('ps-id');
      else if (node.type === 'filter') formExists = !!document.getElementById('pf-id');
      else if (node.type === 'join')   formExists = !!document.getElementById('pj-id');
      else if (node.type === 'aggregate') formExists = !!document.getElementById('pa-id');
      else if (node.type === 'union')  formExists = !!document.getElementById('pu-id');
      else formExists = !!document.getElementById('pc-id');
      if (!formExists) return;

      readListEditorIntoNode(node);

      if (node.type === 'input') {
        var oldName = node.name;
        var newName = g('pi-name');
        if (newName === null) return;
        node.name = newName || node.id;
        node.id   = node.name;
        node.format = g('pi-format') || node.format;
        node.path   = g('pi-path') !== null ? g('pi-path') : node.path;
        node.s3_path= g('pi-s3path') !== null ? g('pi-s3path') : node.s3_path;
        node.dataset= g('pi-dataset') !== null ? g('pi-dataset') : node.dataset;
        node.copybook=g('pi-copybook') !== null ? g('pi-copybook') : node.copybook;
        if (oldName && oldName !== node.name) {
          connections.forEach(function(c){ if (c.from===oldName) c.from=node.id; if (c.to===oldName) c.to=node.id; });
          var el = document.querySelector('[data-node-id="' + oldName + '"]');
          if (el) el.setAttribute('data-node-id', node.id);
        }
      } else if (node.type === 'output') {
        var oldNameO = node.name;
        var newNameO = g('po-name');
        if (newNameO === null) return;
        node.name = newNameO || node.id;
        node.id   = node.name;
        node.format    = g('po-format') || node.format;
        node.path      = g('po-path') !== null ? g('po-path') : node.path;
        node.s3_path   = g('po-s3path') !== null ? g('po-s3path') : node.s3_path;
        node.write_mode= g('po-wmode') || node.write_mode;
        node.output_columns = g('po-outcols') !== null ? g('po-outcols') : node.output_columns;
        if (oldNameO && oldNameO !== node.name) {
          var elO = document.querySelector('[data-node-id="' + oldNameO + '"]');
          if (elO) elO.setAttribute('data-node-id', node.id);
        }
      } else {
        /* Steps: use shared fields */
        var sid = g('ps-id') || g('pf-id') || g('pj-id') || g('pa-id') || g('pu-id') || g('pc-id');
        if (sid === null) return;
        node.step_id = sid || node.id;
        node.id = node.step_id;
        var desc = g('ps-desc') || g('pf-desc') || g('pj-desc') || g('pa-desc') || g('pu-desc') || g('pc-desc');
        if (desc !== null) node.description = desc;
        var alias = g('ps-alias') || g('pf-alias') || g('pj-alias') || g('pa-alias') || g('pu-alias') || g('pc-alias');
        if (alias !== null) node.output_alias = alias || node.step_id;
      }
      refreshNodeEl(node.id);
      renderConnections();
    } catch(e) {
      console.warn('[Studio] silentApplyProps error:', e);
    }
  }

  function deselectAll() {
    selectedNodeId = null;
    selectedConnId = null;
    document.querySelectorAll('.df-node').forEach(function(el){ el.classList.remove('selected'); });
    document.querySelectorAll('.conn-path').forEach(function(el){ el.classList.remove('selected'); });
    showEmptyProps();
  }

  /* ================================================================
     CONNECTIONS
  ================================================================ */
  function addConnection(fromId, toId) {
    if (connections.some(function(c){ return c.from===fromId && c.to===toId; })) return;
    var id = 'conn_' + (_connCounter++);
    connections.push({ id: id, from: fromId, to: toId });
    // Auto-populate source_inputs on target step node
    var toNode = getNode(toId);
    if (toNode && toNode.source_inputs !== undefined) {
      var srcAlias = getNodeOutputAlias(fromId);
      if (toNode.source_inputs.indexOf(srcAlias) < 0) toNode.source_inputs.push(srcAlias);
      if (selectedNodeId === toId) showPropsPanel(toNode);
    }
    renderConnections();
    updateStatus();
  }

  function deleteConnection(connId) {
    connections = connections.filter(function(c){ return c.id !== connId; });
    renderConnections();
    updateStatus();
  }

  function getNodeOutputAlias(nodeId) {
    var n = getNode(nodeId);
    if (!n) return nodeId;
    if (n.type === 'input') return n.name || n.id;
    if (n.type === 'output') return n.name || n.id;
    return n.output_alias || n.step_id || n.id;
  }

  function getPortCenter(nodeId, portType) {
    var n = getNode(nodeId);
    if (!n) return {x:0, y:0};
    var cx = n.x + n.width / 2;
    if (portType === 'out') return { x: cx, y: n.y + NODE_H };
    return { x: cx, y: n.y };
  }

  /* Build an orthogonal elbow path between two points.
     Routing: from(x,y) → down ELBOW_GAP → horizontal to toX → up/down to to(y)
     This produces clean straight right-angle connector lines. */
  function elbowPath(from, to) {
    var mid1Y = from.y + ELBOW_GAP;
    var mid2Y = to.y   - ELBOW_GAP;

    // Simple straight line when nodes are vertically stacked (same X)
    if (Math.abs(from.x - to.x) < 4) {
      return 'M ' + from.x + ' ' + from.y + ' L ' + to.x + ' ' + to.y;
    }

    // When target is below source: simple Z-shaped elbow
    if (to.y >= from.y) {
      var midY = (from.y + to.y) / 2;
      return 'M ' + from.x + ' ' + from.y
           + ' L ' + from.x + ' ' + midY
           + ' L ' + to.x   + ' ' + midY
           + ' L ' + to.x   + ' ' + to.y;
    }

    // When target is above source (back-edge): route around the side
    var sideX = Math.max(from.x, to.x) + 50;
    return 'M ' + from.x + ' ' + from.y
         + ' L ' + from.x + ' ' + mid1Y
         + ' L ' + sideX  + ' ' + mid1Y
         + ' L ' + sideX  + ' ' + mid2Y
         + ' L ' + to.x   + ' ' + mid2Y
         + ' L ' + to.x   + ' ' + to.y;
  }

  function renderConnections() {
    var g = document.getElementById('connections-group');
    if (!g) return;
    g.innerHTML = '';
    connections.forEach(function(c) {
      var from = getPortCenter(c.from, 'out');
      var to   = getPortCenter(c.to,   'in');
      var d    = elbowPath(from, to);

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'conn-path' + (c.id === selectedConnId ? ' selected' : ''));
      path.setAttribute('data-conn-id', c.id);
      path.setAttribute('marker-end', c.id === selectedConnId ? 'url(#arrow-selected)' : 'url(#arrow-default)');

      path.addEventListener('click', function(e) {
        e.stopPropagation();
        selectedConnId = c.id;
        document.querySelectorAll('.conn-path').forEach(function(p) { p.classList.remove('selected'); p.setAttribute('marker-end','url(#arrow-default)'); });
        path.classList.add('selected');
        path.setAttribute('marker-end', 'url(#arrow-selected)');
      });
      path.addEventListener('dblclick', function() {
        if (confirm('Delete this connection?')) deleteConnection(c.id);
      });
      g.appendChild(path);
    });
  }

  function drawTempConn(fromId, mx, my) {
    var from = getPortCenter(fromId, 'out');
    var to   = { x: mx, y: my };
    var el   = document.getElementById('temp-connection');
    el.setAttribute('d', elbowPath(from, to));
    el.classList.remove('hidden');
    el.setAttribute('marker-end', 'url(#arrow-temp)');
  }

  function hideTempConn() {
    var el = document.getElementById('temp-connection');
    if (el) { el.classList.add('hidden'); el.setAttribute('d',''); }
  }

  /* ================================================================
     PROPERTIES DRAWER (slide-in from right)
  ================================================================ */
  function showEmptyProps() {
    var drawer = document.getElementById('node-props-drawer');
    if (drawer) drawer.classList.remove('drawer-open');
    _currentPropsNode = null;
  }

  function showPropsPanel(node) {
    var drawer = document.getElementById('node-props-drawer');
    if (!drawer) return;

    _currentPropsNode = node; // track for auto-save on switch

    var meta = TYPE_META[node.type] || TYPE_META.custom;
    var titleEl = document.getElementById('props-title');
    var badge   = document.getElementById('props-type-badge');
    if (titleEl) titleEl.textContent = 'Properties';
    if (badge)   { badge.textContent = meta.label; badge.style.background = meta.color; }

    var body = document.getElementById('props-body');
    if (body) body.innerHTML = '';

    if (node.type === 'input')          renderInputProps(body, node);
    else if (node.type === 'output')    renderOutputProps(body, node);
    else if (node.type === 'select')    renderSelectProps(body, node);
    else if (node.type === 'filter')    renderFilterProps(body, node);
    else if (node.type === 'join')      renderJoinProps(body, node);
    else if (node.type === 'aggregate') renderAggregateProps(body, node);
    else if (node.type === 'union')     renderUnionProps(body, node);
    else renderCustomProps(body, node);

    drawer.classList.add('drawer-open');
  }

  function formRow(label, inputHtml) {
    return '<div class="form-row"><label>' + label + '</label>' + inputHtml + '</div>';
  }
  function textInput(id, val, placeholder) {
    return '<input type="text" id="' + id + '" value="' + esc(val||'') + '" placeholder="' + esc(placeholder||'') + '" />';
  }
  function selectInput(id, options, selected) {
    var html = '<select id="' + id + '">';
    options.forEach(function(o){ html += '<option value="' + esc(o) + '"' + (o===selected?' selected':'') + '>' + esc(o) + '</option>'; });
    html += '</select>';
    return html;
  }

  /* ---- INPUT NODE ---- */
  function renderInputProps(body, node) {
    var meta = getNodeMeta(node);
    var cbBadgeHtml = meta.copybook_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)</div>'
      : '<div class="import-file-badge" id="pi-copybook-badge"></div>';
    var cbBtnClass = meta.copybook_file ? ' has-file' : '';
    var cbBtnLabel = meta.copybook_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)'
      : '<i class="fa-solid fa-upload"></i> Upload Copybook (.cbl / .cpy)';
    var tfBadgeHtml = meta.test_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)</div>'
      : '<div class="import-file-badge" id="pi-test-file-badge"></div>';
    var tfBtnClass = meta.test_file ? ' has-file' : '';
    var tfBtnLabel = meta.test_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)'
      : '<i class="fa-solid fa-flask"></i> Upload Test CSV / File';

    var isFixed = (node.format === 'fixed');

    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Basic</div>' +
        formRow('Name / ID', textInput('pi-name', node.name, 'e.g. CUSTOMER')) +
        formRow('Format', selectInput('pi-format', FORMATS_IN, node.format)) +
        formRow('Path', textInput('pi-path', node.path, 'data/input/file.csv')) +
        formRow('S3 Path', textInput('pi-s3path', node.s3_path, 's3://bucket/path')) +
        formRow('Dataset', textInput('pi-dataset', node.dataset, 'MAINFRAME.DATASET')) +
        formRow('Copybook', textInput('pi-copybook', node.copybook, 'copybook_name')) +
      '</div>' +
      /* ── Fixed Width Settings — only visible when format = "fixed" ── */
      '<div class="props-section fixed-only-section" id="pi-fixed-section"' + (isFixed ? '' : ' style="display:none"') + '>' +
        '<div class="props-section-title">' +
          '<i class="fa-solid fa-ruler-horizontal" style="margin-right:6px;font-size:10px"></i>Fixed Width Settings' +
        '</div>' +
        '<div class="fixed-info-banner">' +
          '<i class="fa-solid fa-circle-info"></i>' +
          ' Define fields below with Start position (1-based) and Length (chars). ' +
          'Header and Trailer records will be skipped automatically.' +
        '</div>' +
        formRow('Count File Path',
          textInput('pi-count-path', node.count_file_path || '', '/path/to/count.ctl') +
          '<span class="field-hint">Control file with expected record count — used for validation</span>') +
        formRow('Record Length',
          textInput('pi-record-length', node.record_length !== undefined ? node.record_length : '', 'e.g. 200') +
          '<span class="field-hint">Total character width of one data record (optional validation)</span>') +
        formRow('Header Records to Skip',
          textInput('pi-header-count', node.header_count !== undefined ? node.header_count : '0', '0') +
          '<span class="field-hint">Number of header lines at top of file (e.g. 1)</span>') +
        formRow('Trailer Records to Skip',
          textInput('pi-trailer-count', node.trailer_count !== undefined ? node.trailer_count : '0', '0') +
          '<span class="field-hint">Number of trailer lines at bottom of file (e.g. 1)</span>') +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Fields</div>' +
        buildFieldsEditor('pi-fields', node.fields || []) +
        '<div class="props-import-section">' +
          '<div class="props-import-title"><i class="fa-solid fa-file-code"></i> Import Copybook</div>' +
          '<button type="button" class="btn-import-sm' + cbBtnClass + '" id="pi-import-copybook-btn">' +
            cbBtnLabel +
          '</button>' +
          (meta.copybook_file ? cbBadgeHtml : '<div class="import-file-badge" id="pi-copybook-badge"></div>') +
        '</div>' +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Test Data</div>' +
        '<p style="font-size:12px;color:#64748b;margin-bottom:8px">Upload a CSV test file for this input node. Used during testing &amp; reconciliation.</p>' +
        '<button type="button" class="btn-import-sm' + tfBtnClass + '" id="pi-test-file-btn">' +
          tfBtnLabel +
        '</button>' +
        (meta.test_file ? tfBadgeHtml : '<div class="import-file-badge" id="pi-test-file-badge"></div>') +
      '</div>';

    rebindPropsApply(node);

    /* Show / hide Fixed Width Settings section when format changes */
    var piFormatSel = document.getElementById('pi-format');
    var piFixedSec  = document.getElementById('pi-fixed-section');
    if (piFormatSel && piFixedSec) {
      piFormatSel.addEventListener('change', function () {
        piFixedSec.style.display = (this.value === 'fixed') ? '' : 'none';
      });
    }

    /* Bind Import Copybook */
    var copybookBtn = document.getElementById('pi-import-copybook-btn');
    if (copybookBtn) {
      copybookBtn.addEventListener('click', function() {
        pickAndParseCopybook(node, 'pi-fields', 'pi-copybook-badge', copybookBtn, 'input');
      });
    }
    /* Bind Test File */
    var testFileBtn = document.getElementById('pi-test-file-btn');
    if (testFileBtn) {
      testFileBtn.addEventListener('click', function() {
        uploadNodeTestFile(node, 'pi-test-file-badge', testFileBtn, 'input');
      });
    }
  }

  /* ---- OUTPUT NODE ---- */
  function renderOutputProps(body, node) {
    var meta = getNodeMeta(node);
    var cbBadgeHtml = meta.copybook_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)</div>'
      : '<div class="import-file-badge" id="po-copybook-badge"></div>';
    var cbBtnClass = meta.copybook_file ? ' has-file' : '';
    var cbBtnLabel = meta.copybook_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)'
      : '<i class="fa-solid fa-upload"></i> Upload Copybook (.cbl / .cpy)';
    var tfBadgeHtml = meta.test_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)</div>'
      : '<div class="import-file-badge" id="po-test-file-badge"></div>';
    var tfBtnClass = meta.test_file ? ' has-file' : '';
    var tfBtnLabel = meta.test_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)'
      : '<i class="fa-solid fa-flask"></i> Upload Expected Output CSV';

    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Basic</div>' +
        formRow('Name / ID', textInput('po-name', node.name, 'e.g. REPORT1')) +
        formRow('Format', selectInput('po-format', FORMATS_OUT, node.format)) +
        formRow('Path', textInput('po-path', node.path, 'data/output/report')) +
        formRow('S3 Path', textInput('po-s3path', node.s3_path, 's3://bucket/output')) +
        formRow('Write Mode', selectInput('po-wmode', WRITE_MODES, node.write_mode)) +
        formRow('Output Columns (comma-sep)', textInput('po-outcols', node.output_columns, 'COL1, COL2, ...')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Fields (optional)</div>' +
        buildFieldsEditor('po-fields', node.fields || []) +
        '<div class="props-import-section">' +
          '<div class="props-import-title"><i class="fa-solid fa-file-code"></i> Import Copybook</div>' +
          '<button type="button" class="btn-import-sm' + cbBtnClass + '" id="po-import-copybook-btn">' +
            cbBtnLabel +
          '</button>' +
          (meta.copybook_file ? cbBadgeHtml : '<div class="import-file-badge" id="po-copybook-badge"></div>') +
        '</div>' +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Expected Output (Test Data)</div>' +
        '<p style="font-size:12px;color:#64748b;margin-bottom:8px">Upload expected output CSV for reconciliation.</p>' +
        '<button type="button" class="btn-import-sm' + tfBtnClass + '" id="po-test-file-btn">' +
          tfBtnLabel +
        '</button>' +
        (meta.test_file ? tfBadgeHtml : '<div class="import-file-badge" id="po-test-file-badge"></div>') +
      '</div>';
    rebindPropsApply(node);
    var copybookBtn = document.getElementById('po-import-copybook-btn');
    if (copybookBtn) {
      copybookBtn.addEventListener('click', function() {
        pickAndParseCopybook(node, 'po-fields', 'po-copybook-badge', copybookBtn, 'output');
      });
    }
    var testFileBtn = document.getElementById('po-test-file-btn');
    if (testFileBtn) {
      testFileBtn.addEventListener('click', function() {
        uploadNodeTestFile(node, 'po-test-file-badge', testFileBtn, 'output');
      });
    }
  }

  /* ================================================================
     COPYBOOK IMPORT — uploads file to /api/config/<path>/node-copybook,
     persists metadata, auto-populates the fields editor in the drawer
  ================================================================ */
  function pickAndParseCopybook(node, fieldsEditorId, badgeId, btn, nodeType) {
    var configPath = (document.getElementById('current-file') || {}).textContent || '';
    if (!configPath || configPath === 'Select a configuration') {
      toast('Select a configuration before uploading a copybook', 'error'); return;
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cbl,.cpy,.txt,.cob';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function() {
      var file = input.files && input.files[0];
      if (!file) { document.body.removeChild(input); return; }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('node_name', node.name || node.id);
      fd.append('node_type', nodeType || 'input');
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Parsing…';
      btn.disabled = true;
      fetch('/api/config/' + encodeURIComponent(configPath) + '/node-copybook', { method: 'POST', body: fd })
        .then(function(r){ return r.json(); })
        .then(function(res) {
          btn.disabled = false;
          if (res.error) { toast('Copybook parse error: ' + res.error, 'error'); return; }
          var fields = res.fields || [];
          /* Update node fields in memory */
          node.fields = fields.map(function(f){ return { name: f.name, type: f.type, length: f.length, precision: f.precision, nullable: true }; });
          /* Re-render fields editor — buildFieldsEditor creates id="<ns>-editor" */
          var fe = document.getElementById(fieldsEditorId + '-editor');
          if (fe) fe.outerHTML = buildFieldsEditor(fieldsEditorId, node.fields);
          /* Badge */
          var badge = document.getElementById(badgeId);
          if (badge) { badge.textContent = '✓ ' + fields.length + ' fields from ' + file.name; badge.classList.add('visible'); }
          btn.innerHTML = '<i class="fa-solid fa-check"></i> ' + esc(file.name) + ' (' + fields.length + ' fields)';
          btn.classList.add('has-file');
          /* Update local meta cache */
          var cfgName = configPath;
          if (!_nodeFileMeta[cfgName]) _nodeFileMeta[cfgName] = {};
          var existing = _nodeFileMeta[cfgName][node.name || node.id] || {};
          existing.copybook_file = file.name;
          existing.fields = fields.length;
          existing.type = nodeType || 'input';
          _nodeFileMeta[cfgName][node.name || node.id] = existing;
          toast('Copybook imported: ' + fields.length + ' fields', 'success');
        })
        .catch(function(e) {
          btn.disabled = false;
          toast('Copybook import failed: ' + (e.message || e), 'error');
        });
      document.body.removeChild(input);
    });
    input.click();
  }

  /* ================================================================
     TEST FILE UPLOAD — stores per-node CSV test file
  ================================================================ */
  function uploadNodeTestFile(node, badgeId, btn, nodeType) {
    var configPath = (document.getElementById('current-file') || {}).textContent || '';
    if (!configPath || configPath === 'Select a configuration') {
      toast('Select a configuration before uploading test files', 'error'); return;
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt,.tsv,.dat';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function() {
      var file = input.files && input.files[0];
      if (!file) { document.body.removeChild(input); return; }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('node_name', node.name || node.id);
      fd.append('node_type', nodeType || 'input');
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
      btn.disabled = true;
      fetch('/api/config/' + encodeURIComponent(configPath) + '/node-test-file', { method: 'POST', body: fd })
        .then(function(r){ return r.json(); })
        .then(function(res) {
          btn.disabled = false;
          if (res.error) { toast('Upload failed: ' + res.error, 'error'); return; }
          var rowCount = res.rows || 0;
          var badge = document.getElementById(badgeId);
          if (badge) { badge.textContent = '✓ ' + file.name + ' (' + rowCount + ' rows)'; badge.classList.add('visible'); }
          btn.innerHTML = '<i class="fa-solid fa-check"></i> ' + esc(file.name) + ' (' + rowCount + ' rows)';
          btn.classList.add('has-file');
          /* Update local meta cache */
          if (!_nodeFileMeta[configPath]) _nodeFileMeta[configPath] = {};
          var existing = _nodeFileMeta[configPath][node.name || node.id] || {};
          existing.test_file = file.name;
          existing.rows = rowCount;
          existing.type = nodeType || 'input';
          _nodeFileMeta[configPath][node.name || node.id] = existing;
          toast('Test file uploaded: ' + file.name, 'success');
        })
        .catch(function(e) {
          btn.disabled = false;
          toast('Upload failed: ' + (e.message || e), 'error');
        });
      document.body.removeChild(input);
    });
    input.click();
  }

  /* ---- SELECT STEP ---- */
  function renderSelectProps(body, node) {
    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Step Info</div>' +
        formRow('Step ID', textInput('ps-id', node.step_id, 'e.g. map_columns')) +
        formRow('Description', textInput('ps-desc', node.description, 'Describe this step')) +
        formRow('Output Alias', textInput('ps-alias', node.output_alias, 'e.g. mapped_data')) +
        formRow('Source Inputs (comma-sep)', textInput('ps-src', (node.source_inputs||[]).join(', '), 'e.g. CUSTOMER, filtered_data')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Expressions</div>' +
        buildSelectExpressionsEditor('ps-exprs', node.select_expressions || []) +
      '</div>';
    rebindPropsApply(node);
  }

  /* ---- FILTER STEP ---- */
  function renderFilterProps(body, node) {
    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Step Info</div>' +
        formRow('Step ID', textInput('pf-id', node.step_id, 'e.g. filter_active')) +
        formRow('Description', textInput('pf-desc', node.description, 'Describe this step')) +
        formRow('Output Alias', textInput('pf-alias', node.output_alias, 'e.g. active_records')) +
        formRow('Source Inputs (comma-sep)', textInput('pf-src', (node.source_inputs||[]).join(', '), 'e.g. CUSTOMER')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Conditions</div>' +
        buildFilterConditionsEditor('pf-conds', node.filter_conditions || []) +
      '</div>';
    rebindPropsApply(node);
  }

  /* ---- JOIN STEP ---- */
  function renderJoinProps(body, node) {
    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Step Info</div>' +
        formRow('Step ID', textInput('pj-id', node.step_id, 'e.g. join_cust_trans')) +
        formRow('Description', textInput('pj-desc', node.description, 'Describe this step')) +
        formRow('Output Alias', textInput('pj-alias', node.output_alias, 'e.g. joined_data')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Join Configuration</div>' +
        formRow('Left Input', textInput('pj-left', node.join_left, 'e.g. CUSTOMER')) +
        formRow('Right Input', textInput('pj-right', node.join_right, 'e.g. TRANS')) +
        formRow('Join Type', selectInput('pj-jtype', JOIN_TYPES, node.join_type || 'inner')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Join Keys</div>' +
        buildJoinKeysEditor('pj-keys', node.join_keys || []) +
      '</div>';
    rebindPropsApply(node);
  }

  /* ---- AGGREGATE STEP ---- */
  function renderAggregateProps(body, node) {
    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Step Info</div>' +
        formRow('Step ID', textInput('pa-id', node.step_id, 'e.g. agg_by_region')) +
        formRow('Description', textInput('pa-desc', node.description, 'Describe this step')) +
        formRow('Output Alias', textInput('pa-alias', node.output_alias, 'e.g. region_totals')) +
        formRow('Source Inputs (comma-sep)', textInput('pa-src', (node.source_inputs||[]).join(', '), 'e.g. joined_data')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Group By</div>' +
        buildGroupByEditor('pa-grp', node.agg_group_by || []) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Aggregations</div>' +
        buildAggregationsEditor('pa-aggs', node.agg_aggregations || []) +
      '</div>';
    rebindPropsApply(node);
  }

  /* ---- UNION STEP ---- */
  function renderUnionProps(body, node) {
    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Step Info</div>' +
        formRow('Step ID', textInput('pu-id', node.step_id, 'e.g. union_all')) +
        formRow('Description', textInput('pu-desc', node.description, 'Describe this step')) +
        formRow('Output Alias', textInput('pu-alias', node.output_alias, 'e.g. combined_data')) +
        formRow('Source Inputs (comma-sep)', textInput('pu-src', (node.source_inputs||[]).join(', '), 'e.g. input1, input2')) +
        '<div class="form-row checkbox-row">' +
          '<input type="checkbox" id="pu-distinct"' + (node.union_distinct ? ' checked' : '') + ' />' +
          '<label for="pu-distinct">Distinct (remove duplicates)</label>' +
        '</div>' +
      '</div>';
    rebindPropsApply(node);
  }

  /* ---- CUSTOM STEP ---- */
  function renderCustomProps(body, node) {
    var logicStr = node.custom_logic || '{}';
    if (typeof logicStr === 'object') logicStr = JSON.stringify(logicStr, null, 2);
    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Step Info</div>' +
        formRow('Step ID', textInput('pc-id', node.step_id, 'e.g. custom_sort')) +
        formRow('Description', textInput('pc-desc', node.description, 'Describe this step')) +
        formRow('Output Alias', textInput('pc-alias', node.output_alias, 'e.g. sorted_data')) +
        formRow('Source Inputs (comma-sep)', textInput('pc-src', (node.source_inputs||[]).join(', '), 'e.g. joined_data')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Logic (JSON)</div>' +
        '<div class="form-row">' +
          '<textarea id="pc-logic" rows="8">' + esc(logicStr) + '</textarea>' +
        '</div>' +
      '</div>';
    rebindPropsApply(node);
  }

  /* ================================================================
     LIST EDITORS
  ================================================================ */

  function buildFieldsEditor(ns, fields) {
    var rows = fields.map(function(f, i) {
      return '<div class="list-item">' +
        '<div class="list-item-inputs">' +
          '<input type="text" placeholder="Field name" value="' + esc(f.name||'') + '" data-field="name" data-idx="' + i + '" class="lci-name" title="Field name" />' +
          selectOpts(['string','int','long','double','decimal','date','timestamp'], f.type||'string', 'data-field="type" data-idx="' + i + '" class="lci-type" title="Data type"') +
          '<input type="number" placeholder="1" value="' + esc(f.start||'') + '" data-field="start" data-idx="' + i + '" class="lci-start" title="Start position (1-based)" />' +
          '<input type="number" placeholder="0" value="' + esc(f.length||'') + '" data-field="length" data-idx="' + i + '" class="lci-len" title="Field length in characters" />' +
        '</div>' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove field">×</button>' +
      '</div>';
    }).join('');
    return '<div class="list-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header"><span>Fields (' + fields.length + ')</span></div>' +
      '<div class="list-editor-col-header">' +
        '<span class="lch-name">Name</span>' +
        '<span class="lch-type">Type</span>' +
        '<span class="lch-start">Start</span>' +
        '<span class="lch-len">Length</span>' +
        '<span class="lch-del"></span>' +
      '</div>' +
      '<div class="list-editor-items">' + rows + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-field">+ Add Field</button>' +
    '</div>';
  }

  function buildSelectExpressionsEditor(ns, exprs) {
    var rows = exprs.map(function(ex, i) {
      return '<div class="list-item">' +
        '<div class="list-item-inputs">' +
          '<input type="text" placeholder="Target" value="' + esc(ex.target||'') + '" data-field="target" data-idx="' + i + '" title="Target column name" />' +
          '<input type="text" placeholder="Expression" value="' + esc(ex.expression||'') + '" data-field="expression" data-idx="' + i + '" title="Source column or expression" />' +
          selectOpts(SELECT_OPS, ex.operation||'move', 'data-field="operation" data-idx="' + i + '"') +
        '</div>' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">×</button>' +
      '</div>';
    }).join('');
    return '<div class="list-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header"><span>Expressions (' + exprs.length + ')</span><span style="font-size:10px;color:#94a3b8">Target | Expression | Operation</span></div>' +
      '<div class="list-editor-items">' + rows + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-expr">+ Add Expression</button>' +
    '</div>';
  }

  function buildFilterConditionsEditor(ns, conds) {
    var rows = conds.map(function(c, i) {
      return '<div class="list-item">' +
        '<div class="list-item-inputs">' +
          '<input type="text" placeholder="Field" value="' + esc(c.field||'') + '" data-field="field" data-idx="' + i + '" />' +
          selectOpts(FILTER_OPS, c.operation||'==', 'data-field="operation" data-idx="' + i + '"') +
          '<input type="text" placeholder="Value" value="' + esc(c.value !== undefined ? String(c.value) : '') + '" data-field="value" data-idx="' + i + '" />' +
        '</div>' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">×</button>' +
      '</div>';
    }).join('');
    return '<div class="list-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header"><span>Conditions (' + conds.length + ')</span><span style="font-size:10px;color:#94a3b8">Field | Op | Value</span></div>' +
      '<div class="list-editor-items">' + rows + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-cond">+ Add Condition</button>' +
    '</div>';
  }

  function buildJoinKeysEditor(ns, keys) {
    var rows = keys.map(function(k, i) {
      return '<div class="list-item">' +
        '<div class="list-item-inputs">' +
          '<input type="text" placeholder="Left col" value="' + esc(k.left||'') + '" data-field="left" data-idx="' + i + '" />' +
          '<input type="text" placeholder="Right col" value="' + esc(k.right||'') + '" data-field="right" data-idx="' + i + '" />' +
        '</div>' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">×</button>' +
      '</div>';
    }).join('');
    return '<div class="list-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header"><span>Key Pairs (' + keys.length + ')</span><span style="font-size:10px;color:#94a3b8">Left Col | Right Col</span></div>' +
      '<div class="list-editor-items">' + rows + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-key">+ Add Key Pair</button>' +
    '</div>';
  }

  function buildGroupByEditor(ns, grp) {
    var rows = grp.map(function(g, i) {
      return '<div class="list-item">' +
        '<div class="list-item-inputs">' +
          '<input type="text" placeholder="Column" value="' + esc(g.col||g||'') + '" data-field="col" data-idx="' + i + '" style="flex:1" />' +
        '</div>' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">×</button>' +
      '</div>';
    }).join('');
    return '<div class="list-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header"><span>Group By (' + grp.length + ')</span></div>' +
      '<div class="list-editor-items">' + rows + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-grp">+ Add Column</button>' +
    '</div>';
  }

  function buildAggregationsEditor(ns, aggs) {
    var rows = aggs.map(function(a, i) {
      return '<div class="list-item">' +
        '<div class="list-item-inputs">' +
          '<input type="text" placeholder="Field" value="' + esc(a.field||'') + '" data-field="field" data-idx="' + i + '" />' +
          selectOpts(AGG_OPS, a.operation||'sum', 'data-field="operation" data-idx="' + i + '"') +
          '<input type="text" placeholder="Alias" value="' + esc(a.alias||'') + '" data-field="alias" data-idx="' + i + '" />' +
          '<input type="text" placeholder="Condition (optional)" value="' + esc(a.condition||'') + '" data-field="condition" data-idx="' + i + '" title="e.g. TXN_TYPE = \'DR\'" />' +
        '</div>' +
        '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove">×</button>' +
      '</div>';
    }).join('');
    return '<div class="list-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header"><span>Aggregations (' + aggs.length + ')</span><span style="font-size:10px;color:#94a3b8">Field | Op | Alias | Cond</span></div>' +
      '<div class="list-editor-items">' + rows + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-agg">+ Add Aggregation</button>' +
    '</div>';
  }

  function selectOpts(options, selected, extraAttrs) {
    var html = '<select ' + (extraAttrs||'') + '>';
    options.forEach(function(o){ html += '<option value="' + esc(o) + '"' + (o===selected?' selected':'') + '>' + esc(o) + '</option>'; });
    html += '</select>';
    return html;
  }

  /* ---- Bind dynamic list editor events ---- */
  function rebindPropsApply(node) {
    var body = document.getElementById('props-body');
    if (!body) return;

    // Add row buttons
    body.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var ns = btn.getAttribute('data-ns');
        var action = btn.getAttribute('data-action');
        readListEditorIntoNode(node);
        if (action === 'add-field') {
          if (!node.fields) node.fields = [];
          node.fields.push({name:'', type:'string', start:'', length:''});
        } else if (action === 'add-expr') {
          if (!node.select_expressions) node.select_expressions = [];
          node.select_expressions.push({target:'', expression:'', operation:'move'});
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
        }
        showPropsPanel(node);
      });
    });

    // Remove row buttons
    body.querySelectorAll('.list-item-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        readListEditorIntoNode(node);
        var ns  = btn.getAttribute('data-ns');
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        removeListRow(node, ns, idx);
        showPropsPanel(node);
      });
    });

    // Apply button
    var applyBtn = document.getElementById('prop-apply-btn');
    if (applyBtn) {
      applyBtn.onclick = function() {
        applyPropsToNode(node);
      };
    }

    // Delete button
    var delBtn = document.getElementById('prop-delete-btn');
    if (delBtn) {
      delBtn.onclick = function() {
        if (confirm('Delete "' + (node.name || node.step_id || node.id) + '"?')) {
          deleteNode(node.id);
        }
      };
    }
  }

  function removeListRow(node, ns, idx) {
    if (ns === 'pi-fields' || ns === 'po-fields') {
      node.fields.splice(idx, 1);
    } else if (ns === 'ps-exprs') {
      node.select_expressions.splice(idx, 1);
    } else if (ns === 'pf-conds') {
      node.filter_conditions.splice(idx, 1);
    } else if (ns === 'pj-keys') {
      node.join_keys.splice(idx, 1);
    } else if (ns === 'pa-grp') {
      node.agg_group_by.splice(idx, 1);
    } else if (ns === 'pa-aggs') {
      node.agg_aggregations.splice(idx, 1);
    }
  }

  function readListEditorIntoNode(node) {
    // Read all currently rendered list items back into node data
    var body = document.getElementById('props-body');
    if (!body) return;

    function readItems(selector, builder) {
      var items = {};
      body.querySelectorAll('[data-idx][data-field]').forEach(function(inp) {
        if (!inp.closest(selector)) return;
        var idx = parseInt(inp.getAttribute('data-idx'), 10);
        var field = inp.getAttribute('data-field');
        if (!items[idx]) items[idx] = {};
        items[idx][field] = inp.value;
      });
      return Object.keys(items).sort(function(a,b){return a-b;}).map(function(i){ return items[i]; });
    }

    // fields
    var fieldsEditor = body.querySelector('#pi-fields-editor, #po-fields-editor');
    if (fieldsEditor) {
      node.fields = readItems('#' + fieldsEditor.id);
    }
    // select expressions
    var exprEditor = body.querySelector('#ps-exprs-editor');
    if (exprEditor) node.select_expressions = readItems('#ps-exprs-editor');
    // filter conditions
    var condEditor = body.querySelector('#pf-conds-editor');
    if (condEditor) node.filter_conditions = readItems('#pf-conds-editor');
    // join keys
    var keyEditor = body.querySelector('#pj-keys-editor');
    if (keyEditor) node.join_keys = readItems('#pj-keys-editor');
    // group by
    var grpEditor = body.querySelector('#pa-grp-editor');
    if (grpEditor) node.agg_group_by = readItems('#pa-grp-editor');
    // aggregations
    var aggEditor = body.querySelector('#pa-aggs-editor');
    if (aggEditor) node.agg_aggregations = readItems('#pa-aggs-editor');
  }

  /* ================================================================
     APPLY PROPS TO NODE (from form fields)
  ================================================================ */
  function applyPropsToNode(node) {
    var g = function(id){ var el=document.getElementById(id); return el ? el.value.trim() : ''; };
    var gc = function(id){ var el=document.getElementById(id); return el ? el.checked : false; };

    // Read list editors first
    readListEditorIntoNode(node);

    if (node.type === 'input') {
      var oldName = node.name;
      node.name   = g('pi-name') || node.id;
      node.id     = node.name; // sync id with name for inputs
      node.format = g('pi-format');
      node.path   = g('pi-path');
      node.s3_path= g('pi-s3path');
      node.dataset= g('pi-dataset');
      node.copybook=g('pi-copybook');
      /* Fixed-width specific fields — collected whenever format is fixed */
      var _rl = parseInt(g('pi-record-length'), 10);
      var _hc = parseInt(g('pi-header-count'),  10);
      var _tc = parseInt(g('pi-trailer-count'), 10);
      node.count_file_path = g('pi-count-path') || undefined;
      node.record_length   = isNaN(_rl) ? undefined : _rl;
      node.header_count    = isNaN(_hc) ? 0 : _hc;
      node.trailer_count   = isNaN(_tc) ? 0 : _tc;
      // Update connections that used old name
      if (oldName && oldName !== node.name) {
        connections.forEach(function(c){
          if (c.from === oldName) c.from = node.id;
          if (c.to === oldName) c.to = node.id;
        });
        nodes.forEach(function(n){
          if (n.source_inputs) {
            var idx = n.source_inputs.indexOf(oldName);
            if (idx >= 0) n.source_inputs[idx] = node.name;
          }
        });
        // Update DOM
        var el = document.querySelector('[data-node-id="' + oldName + '"]');
        if (el) el.setAttribute('data-node-id', node.id);
      }
    } else if (node.type === 'output') {
      var oldNameO = node.name;
      node.name      = g('po-name') || node.id;
      node.id        = node.name;
      node.format    = g('po-format');
      node.path      = g('po-path');
      node.s3_path   = g('po-s3path');
      node.write_mode= g('po-wmode');
      node.output_columns = g('po-outcols');
      if (oldNameO && oldNameO !== node.name) {
        var elO = document.querySelector('[data-node-id="' + oldNameO + '"]');
        if (elO) elO.setAttribute('data-node-id', node.id);
      }
    } else if (node.type === 'select') {
      node.step_id     = g('ps-id') || node.id;
      node.id          = node.step_id;
      node.description = g('ps-desc');
      node.output_alias= g('ps-alias') || node.step_id;
      node.source_inputs = g('ps-src').split(',').map(function(s){return s.trim();}).filter(Boolean);
    } else if (node.type === 'filter') {
      node.step_id     = g('pf-id') || node.id;
      node.id          = node.step_id;
      node.description = g('pf-desc');
      node.output_alias= g('pf-alias') || node.step_id;
      node.source_inputs = g('pf-src').split(',').map(function(s){return s.trim();}).filter(Boolean);
    } else if (node.type === 'join') {
      node.step_id     = g('pj-id') || node.id;
      node.id          = node.step_id;
      node.description = g('pj-desc');
      node.output_alias= g('pj-alias') || node.step_id;
      node.join_left   = g('pj-left');
      node.join_right  = g('pj-right');
      node.join_type   = g('pj-jtype');
      node.source_inputs = [node.join_left, node.join_right].filter(Boolean);
    } else if (node.type === 'aggregate') {
      node.step_id     = g('pa-id') || node.id;
      node.id          = node.step_id;
      node.description = g('pa-desc');
      node.output_alias= g('pa-alias') || node.step_id;
      node.source_inputs = g('pa-src').split(',').map(function(s){return s.trim();}).filter(Boolean);
    } else if (node.type === 'union') {
      node.step_id       = g('pu-id') || node.id;
      node.id            = node.step_id;
      node.description   = g('pu-desc');
      node.output_alias  = g('pu-alias') || node.step_id;
      node.source_inputs = g('pu-src').split(',').map(function(s){return s.trim();}).filter(Boolean);
      node.union_distinct= gc('pu-distinct');
    } else {
      node.step_id      = g('pc-id') || node.id;
      node.id           = node.step_id;
      node.description  = g('pc-desc');
      node.output_alias = g('pc-alias') || node.step_id;
      node.source_inputs= g('pc-src').split(',').map(function(s){return s.trim();}).filter(Boolean);
      try { node.custom_logic = JSON.parse(g('pc-logic') || '{}'); } catch(e) { node.custom_logic = g('pc-logic'); }
    }

    refreshNodeEl(node.id);
    renderConnections();
    showPropsPanel(node);
    toast('Applied!', 'success');

    /* Auto-save to server so the config JSON is updated immediately */
    var nameInput = document.getElementById('toolbar-config-name');
    var cfgName = nameInput ? nameInput.value.trim() : '';
    if (!cfgName) {
      var currentFileEl = document.getElementById('current-file');
      cfgName = currentFileEl ? currentFileEl.textContent.trim() : '';
    }
    if (cfgName && window.CodeParser && window.CodeParser.API) {
      if (!cfgName.toLowerCase().endsWith('.json')) cfgName += '.json';
      var cfg = buildJson();
      window.CodeParser.API.saveConfig(cfgName, cfg).then(function(res) {
        if (res && res.error) {
          console.warn('[Studio] Auto-save after Apply failed:', res.error);
        } else {
          if (typeof window.refreshConfigList === 'function') window.refreshConfigList();
        }
      }).catch(function(err) {
        console.warn('[Studio] Auto-save error:', err && err.message);
      });
    }
  }

  /* ================================================================
     JSON BUILDER
  ================================================================ */
  function buildJson() {
    var cfg = { Inputs: {}, Outputs: {}, Transformations: { description: 'Built with Dataflow Studio', steps: [] } };

    // topological order for steps
    var ordered = topoSort();

    nodes.forEach(function(n) {
      if (n.type === 'input') {
        var inp = { name: n.name || n.id, format: n.format || 'parquet', path: n.path || '' };
        if (n.s3_path)  inp.s3_path = n.s3_path;
        if (n.dataset)  inp.dataset = n.dataset;
        if (n.copybook) inp.copybook = n.copybook;
        if (n.fields && n.fields.length > 0) {
          inp.fields = n.fields.filter(function(f){ return f.name; }).map(function(f){
            var fd = { name: f.name, type: f.type || 'string' };
            if (f.start)  fd.start  = parseInt(f.start, 10);
            if (f.length) fd.length = parseInt(f.length, 10);
            return fd;
          });
        }
        cfg.Inputs[inp.name] = inp;
      } else if (n.type === 'output') {
        var out = {
          name: n.name || n.id,
          format: n.format || 'parquet',
          path: n.path || '',
          write_mode: n.write_mode || 'overwrite'
        };
        if (n.s3_path)  out.s3_path = n.s3_path;
        if (n.dataset)  out.dataset = n.dataset;
        if (n.copybook) out.copybook = n.copybook;
        if (n.fields && n.fields.length > 0) {
          out.fields = n.fields.filter(function(f){ return f.name; }).map(function(f){
            return { name: f.name, type: f.type || 'string' };
          });
        }
        if (n.output_columns) {
          out.output_columns = n.output_columns.split(',').map(function(s){return s.trim();}).filter(Boolean);
        }
        cfg.Outputs[out.name] = out;
      } else {
        // step
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

    // Sort steps topologically
    cfg.Transformations.steps.sort(function(a, b) {
      var ai = ordered.indexOf(a.id), bi = ordered.indexOf(b.id);
      if (ai < 0) ai = 9999; if (bi < 0) bi = 9999;
      return ai - bi;
    });

    return cfg;
  }

  function buildStepLogic(node) {
    if (node.type === 'filter') {
      return {
        conditions: (node.filter_conditions || []).filter(function(c){return c.field;}).map(function(c){
          var v = c.value;
          if (!isNaN(parseFloat(v)) && v !== '') v = parseFloat(v);
          if (c.operation === 'in' || c.operation === 'not_in') {
            v = String(c.value).split(',').map(function(s){return s.trim();}).filter(Boolean);
          }
          return { field: c.field, operation: c.operation || '==', value: v };
        })
      };
    }
    if (node.type === 'select') {
      var exprs = (node.select_expressions || []).filter(function(e){return e.target;}).map(function(e){
        return { target: e.target, expression: e.expression || '', operation: e.operation || 'move' };
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
        how: node.join_type || 'inner'
      };
    }
    if (node.type === 'aggregate') {
      return {
        group_by: (node.agg_group_by || []).map(function(g){ return g.col || g; }).filter(Boolean),
        aggregations: (node.agg_aggregations || []).filter(function(a){return a.field && a.alias;}).map(function(a){
          var agg = { field: a.field, operation: a.operation || 'sum', alias: a.alias };
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
    return {};
  }

  function topoSort() {
    var order = [], visited = {}, stack = {};
    function visit(id) {
      if (stack[id] || visited[id]) return;
      stack[id] = true;
      var n = getNode(id);
      if (n && n.source_inputs) n.source_inputs.forEach(function(src){
        var srcNode = nodes.find(function(n2){ return (n2.step_id||n2.id) === src || (n2.name||n2.id) === src; });
        if (srcNode) visit(srcNode.id);
      });
      stack[id] = false; visited[id] = true; order.push(id);
    }
    nodes.forEach(function(n){ visit(n.id); });
    return order;
  }

  /* ================================================================
     JSON SYNTAX HIGHLIGHT
  ================================================================ */
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

  /* ================================================================
     LOAD CONFIG INTO CANVAS
  ================================================================ */
  function loadConfig(config) {
    // Clear
    nodes = []; connections = [];
    document.getElementById('canvas-nodes').innerHTML = '';
    _nodeCounter = 1; _connCounter = 1;
    deselectAll();

    var inputs  = config.Inputs  || {};
    var outputs = config.Outputs || {};
    var steps   = (config.Transformations || {}).steps || [];

    /* Vertical layout: Inputs across the top, steps below, outputs at the bottom */
    var colW   = NODE_W + 50;  // horizontal spacing between sibling nodes
    var rowH   = NODE_H + 70;  // vertical row height
    var startX = 80;
    var startY = 60;

    var inputKeys  = Object.keys(inputs);
    var outputKeys = Object.keys(outputs);

    /* Row 0 — Inputs */
    inputKeys.forEach(function(name, idx) {
      var d = inputs[name];
      var n = defaultNodeData('input');
      n.id = name; n.name = name;
      n.format = d.format || 'csv';
      n.path   = d.path || d.s3_path || '';
      n.s3_path= d.s3_path || '';
      n.dataset= d.dataset || '';
      n.copybook=d.copybook || '';
      n.fields = Array.isArray(d.fields) ? d.fields : [];
      n.x = snap(startX + idx * colW);
      n.y = snap(startY);
      addNode(n);
    });

    /* Rows 1..N — Steps (stacked vertically, centred) */
    var stepCentreX = snap(startX + Math.max(0, (inputKeys.length - 1)) * colW / 2);
    var stepY = startY + rowH;

    // Steps
    steps.forEach(function(s) {
      var n = defaultNodeData(s.type || 'custom');
      n.id = s.id; n.step_id = s.id;
      n.description = s.description || '';
      n.output_alias= s.output_alias || s.id;
      n.source_inputs = Array.isArray(s.source_inputs) ? s.source_inputs : [];
      n.x = snap(stepCentreX);
      n.y = snap(stepY);
      stepY += rowH;

      // Extract structured logic
      var logic = s.logic || {};
      if (s.type === 'filter') {
        n.filter_conditions = (logic.conditions || []).map(function(c){
          return { field: c.field, operation: c.operation, value: Array.isArray(c.value) ? c.value.join(', ') : String(c.value||'') };
        });
      } else if (s.type === 'select') {
        if (logic.expressions) {
          n.select_expressions = logic.expressions.map(function(e){
            return { target: e.target, expression: e.expression, operation: e.operation || 'move' };
          });
        } else {
          n.select_expressions = [];
        }
      } else if (s.type === 'join') {
        n.join_left = logic.left || '';
        n.join_right= logic.right || '';
        n.join_type = logic.how || 'inner';
        n.join_keys = (logic.on || []).map(function(pair){
          return { left: pair[0]||'', right: pair[1]||'' };
        });
        n.source_inputs = [n.join_left, n.join_right].filter(Boolean);
      } else if (s.type === 'aggregate') {
        n.agg_group_by = (logic.group_by || []).map(function(c){ return { col: c }; });
        n.agg_aggregations = (logic.aggregations || []).map(function(a){
          return { field: a.field, operation: a.operation, alias: a.alias, condition: a.condition || '' };
        });
      } else if (s.type === 'union') {
        n.union_distinct = !!logic.distinct;
      } else {
        n.custom_logic = JSON.stringify(logic, null, 2);
      }

      addNode(n);

      // Add connections from source_inputs
      n.source_inputs.forEach(function(src) {
        var srcNode = nodes.find(function(nd){ return (nd.name||nd.id)===src || (nd.step_id||nd.id)===src || nd.output_alias===src; });
        if (srcNode) {
          connections.push({ id: 'conn_' + (_connCounter++), from: srcNode.id, to: n.id });
        }
      });
    });

    /* Last row — Outputs (spread horizontally below all steps) */
    outputKeys.forEach(function(name, idx) {
      var d = outputs[name];
      var n = defaultNodeData('output');
      n.id = name; n.name = name;
      n.format    = d.format || 'parquet';
      n.path      = d.path || d.s3_path || '';
      n.s3_path   = d.s3_path || '';
      n.write_mode= d.write_mode || 'overwrite';
      n.fields    = Array.isArray(d.fields) ? d.fields : [];
      n.output_columns = Array.isArray(d.output_columns) ? d.output_columns.join(', ') : '';
      n.x = snap(startX + idx * colW);
      n.y = snap(stepY);
      addNode(n);

      // Connect: find step that outputs to this name
      var srcStep = nodes.find(function(nd){ return nd.output_alias === name && nd.type !== 'output'; });
      if (srcStep) {
        connections.push({ id: 'conn_' + (_connCounter++), from: srcStep.id, to: n.id });
      }
    });

    renderConnections();
    updateStatus();
    fitCanvas();

    /* Fetch persisted file metadata for this config */
    var cfgName = (document.getElementById('current-file') || {}).textContent || '';
    if (cfgName && cfgName !== 'Select a configuration') {
      fetchNodeFileMeta(cfgName);
    }
  }

  /* ================================================================
     NODE FILE META — fetch persisted test file & copybook metadata
  ================================================================ */
  function fetchNodeFileMeta(configName) {
    fetch('/api/config/' + encodeURIComponent(configName) + '/test-data')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (data && data.file_meta) {
          _nodeFileMeta[configName] = data.file_meta;
        }
      })
      .catch(function() {});
  }

  function getNodeMeta(node) {
    var cfgName = (document.getElementById('current-file') || {}).textContent || '';
    var meta = _nodeFileMeta[cfgName] || {};
    return meta[node.name || node.id] || {};
  }

  /* ================================================================
     AUTO-LAYOUT
  ================================================================ */
  /* Auto-layout: VERTICAL top-to-bottom flow.
     Row 0 = Inputs (spread horizontally)
     Row 1-N = Steps (in topological order, centered)
     Last row = Outputs (spread horizontally)
     Straight elbow connections link them vertically. */
  function autoLayout() {
    var inputNodes  = nodes.filter(function(n){ return n.type === 'input'; });
    var outputNodes = nodes.filter(function(n){ return n.type === 'output'; });
    var stepNodes   = nodes.filter(function(n){ return n.type !== 'input' && n.type !== 'output'; });

    var colGap   = NODE_W + 40;  // horizontal gap between sibling nodes
    var rowGap   = NODE_H + 60;  // vertical gap between rows
    var startX   = 60;
    var startY   = 60;

    /* Helper: centre a row of N nodes starting at rowY */
    function layoutRow(arr, rowY) {
      var totalW = arr.length * NODE_W + (arr.length - 1) * 40;
      var rowStartX = startX + Math.max(0, (stepNodes.length * colGap - totalW) / 2);
      arr.forEach(function(n, i) {
        n.x = snap(rowStartX + i * (NODE_W + 40));
        n.y = snap(rowY);
      });
    }

    /* Sort steps topologically so layout follows data flow */
    var orderedIds  = topoSort();
    var sortedSteps = stepNodes.slice().sort(function(a, b) {
      var ai = orderedIds.indexOf(a.id), bi = orderedIds.indexOf(b.id);
      if (ai < 0) ai = 9999; if (bi < 0) bi = 9999;
      return ai - bi;
    });

    /* Layout rows */
    var currentY = startY;
    layoutRow(inputNodes, currentY);
    if (inputNodes.length > 0) currentY += rowGap;

    sortedSteps.forEach(function(n) {
      n.x = snap(startX + Math.max(0, (inputNodes.length - 1)) * (NODE_W + 40) / 2);
      n.y = snap(currentY);
      currentY += rowGap;
    });

    layoutRow(outputNodes, currentY);

    /* Apply positions to DOM elements */
    nodes.forEach(function(n) {
      var el = document.querySelector('[data-node-id="' + n.id + '"]');
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    renderConnections();
    fitCanvas();
  }

  function fitCanvas() {
    if (nodes.length === 0) { zoom=1; panX=60; panY=60; applyTransform(); return; }
    var wrap = document.getElementById('canvas-wrap');
    var ww = wrap.clientWidth, wh = wrap.clientHeight;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function(n){ minX=Math.min(minX,n.x); minY=Math.min(minY,n.y); maxX=Math.max(maxX,n.x+NODE_W); maxY=Math.max(maxY,n.y+NODE_H); });
    var pad = 60;
    var zx = (ww - pad*2) / (maxX - minX + pad);
    var zy = (wh - pad*2) / (maxY - minY + pad);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(zx, zy)));
    panX = (ww - (maxX - minX) * zoom) / 2 - minX * zoom;
    panY = (wh - (maxY - minY) * zoom) / 2 - minY * zoom;
    applyTransform();
  }

  /* ================================================================
     PALETTE SETUP
  ================================================================ */
  function setupPalette() {
    document.querySelectorAll('.palette-item').forEach(function(el) {
      el.addEventListener('dragstart', function(e) {
        e.dataTransfer.setData('application/json', JSON.stringify({ type: el.getAttribute('data-type') }));
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  /* ================================================================
     TOOLBAR SETUP
  ================================================================ */
  function setupToolbar() {
    // Mode buttons
    document.getElementById('tb-mode-select').addEventListener('click', function() {
      setMode('select');
    });
    document.getElementById('tb-mode-connect').addEventListener('click', function() {
      setMode('connect');
    });

    function setMode(m) {
      mode = m;
      document.getElementById('tb-mode-select').classList.toggle('active', m==='select');
      document.getElementById('tb-mode-connect').classList.toggle('active', m==='connect');
      var wrap = document.getElementById('canvas-wrap');
      wrap.classList.toggle('connect-mode', m==='connect');
      if (m !== 'connect') { connectFrom = null; hideTempConn(); }
      updateStatus();
    }

    // Zoom
    document.getElementById('tb-zoom-in').addEventListener('click', function() {
      zoom = Math.min(MAX_ZOOM, zoom + 0.1);
      applyTransform();
    });
    document.getElementById('tb-zoom-out').addEventListener('click', function() {
      zoom = Math.max(MIN_ZOOM, zoom - 0.1);
      applyTransform();
    });
    document.getElementById('tb-fit').addEventListener('click', fitCanvas);
    document.getElementById('tb-auto-layout').addEventListener('click', autoLayout);
    document.getElementById('tb-clear').addEventListener('click', function() {
      if (nodes.length === 0 || confirm('Clear all nodes and connections?')) {
        nodes = []; connections = [];
        document.getElementById('canvas-nodes').innerHTML = '';
        document.getElementById('connections-group').innerHTML = '';
        deselectAll();
        updateStatus();
        toast('Canvas cleared', 'info');
      }
    });
    document.getElementById('tb-new').addEventListener('click', function() {
      if (nodes.length === 0 || confirm('Start fresh? Current canvas will be cleared.')) {
        nodes = []; connections = [];
        document.getElementById('canvas-nodes').innerHTML = '';
        document.getElementById('connections-group').innerHTML = '';
        document.getElementById('toolbar-config-name').value = '';
        deselectAll(); updateStatus();
        zoom=1; panX=60; panY=60; applyTransform();
        toast('New canvas', 'info');
      }
    });

    // Export JSON
    document.getElementById('tb-export-json').addEventListener('click', openExportModal);

    // Import JSON
    document.getElementById('tb-import-json').addEventListener('click', function() {
      document.getElementById('import-modal').classList.remove('hidden');
    });

    // Load from server
    document.getElementById('tb-load').addEventListener('click', function() {
      openLoadModal();
    });

    // Save to server
    document.getElementById('tb-save').addEventListener('click', function() {
      var name = document.getElementById('toolbar-config-name').value.trim();
      if (!name) { toast('Enter a config name first', 'error'); return; }
      if (!name.toLowerCase().endsWith('.json')) name += '.json';
      var cfg = buildJson();
      if (!window.CodeParser || !window.CodeParser.API) { toast('Server not available — use Export instead', 'error'); return; }
      window.CodeParser.API.saveConfig(name, cfg).then(function(res){
        if (res && res.error) {
          toast('Save failed: ' + res.error, 'error');
        } else {
          toast('Saved as ' + name, 'success');
          document.getElementById('toolbar-config-name').value = name.replace(/\.json$/i,'');
          /* Refresh config list in sidebar without page reload */
          if (typeof window.refreshConfigList === 'function') window.refreshConfigList();
        }
      }).catch(function(err){ toast('Save failed: ' + (err.message||'Unknown error'), 'error'); });
    });
  }

  function openExportModal() {
    var cfg = buildJson();
    var json = JSON.stringify(cfg, null, 2);
    document.getElementById('export-json-output').innerHTML = highlightJson(json);
    document.getElementById('export-json-output').setAttribute('data-raw', json);
    document.getElementById('export-modal').classList.remove('hidden');
  }

  function openLoadModal() {
    var sel = document.getElementById('load-config-select');
    sel.innerHTML = '<option value="">-- Select a config --</option>';
    if (window.CodeParser && window.CodeParser.API) {
      window.CodeParser.API.configs().then(function(res){
        (res.configs || []).forEach(function(c){
          var opt = document.createElement('option');
          opt.value = c.relative || c.path;
          opt.textContent = c.name || c.relative;
          sel.appendChild(opt);
        });
      }).catch(function(){ toast('Could not load config list', 'error'); });
    }
    document.getElementById('load-modal').classList.remove('hidden');
  }

  /* ================================================================
     MODAL SETUP
  ================================================================ */
  function setupModals() {
    // Generic close buttons
    document.querySelectorAll('[data-modal]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mid = btn.getAttribute('data-modal');
        document.getElementById(mid).classList.add('hidden');
      });
    });

    // Export: copy & download
    document.getElementById('export-copy-btn').addEventListener('click', function() {
      var raw = document.getElementById('export-json-output').getAttribute('data-raw') || '';
      navigator.clipboard.writeText(raw).then(function(){ toast('Copied to clipboard', 'success'); });
    });
    document.getElementById('export-download-btn').addEventListener('click', function() {
      var raw = document.getElementById('export-json-output').getAttribute('data-raw') || '';
      var name = (document.getElementById('toolbar-config-name').value.trim() || 'dataflow_config');
      if (!name.endsWith('.json')) name += '.json';
      var a = document.createElement('a');
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(raw);
      a.download = name;
      a.click();
    });

    // Import: apply
    document.getElementById('import-apply-btn').addEventListener('click', function() {
      var fileInput = document.getElementById('import-file-input');
      var textArea  = document.getElementById('import-json-text');
      if (fileInput.files && fileInput.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
          try { loadConfig(JSON.parse(e.target.result)); document.getElementById('import-modal').classList.add('hidden'); toast('Loaded from file', 'success'); }
          catch(err){ toast('Invalid JSON: ' + err.message, 'error'); }
        };
        reader.readAsText(fileInput.files[0]);
      } else {
        var text = textArea.value.trim();
        if (!text) { toast('No JSON provided', 'error'); return; }
        try { loadConfig(JSON.parse(text)); document.getElementById('import-modal').classList.add('hidden'); toast('Loaded from JSON', 'success'); }
        catch(err){ toast('Invalid JSON: ' + err.message, 'error'); }
      }
    });

    // Load from server: apply
    document.getElementById('load-apply-btn').addEventListener('click', function() {
      var path = document.getElementById('load-config-select').value;
      if (!path) { toast('Select a config first', 'error'); return; }
      if (!window.CodeParser || !window.CodeParser.API) { toast('Server not available', 'error'); return; }
      window.CodeParser.API.getConfig(path).then(function(cfg){
        loadConfig(cfg);
        document.getElementById('load-modal').classList.add('hidden');
        var name = path.split('/').pop().replace(/\.json$/i,'');
        document.getElementById('toolbar-config-name').value = name;
        toast('Loaded: ' + name, 'success');
      }).catch(function(err){ toast('Load failed: ' + (err.message||'Unknown error'), 'error'); });
    });
  }

  /* ================================================================
     CONTEXT MENU
  ================================================================ */
  function showContextMenu(x, y, nodeId) {
    var menu = document.getElementById('ctx-menu');
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    menu.classList.remove('hidden');
    menu.setAttribute('data-node-id', nodeId);
  }

  function setupContextMenu() {
    document.getElementById('ctx-edit').addEventListener('click', function() {
      var nid = document.getElementById('ctx-menu').getAttribute('data-node-id');
      var node = getNode(nid);
      if (node) { selectNode(nid); showPropsPanel(node); }
      document.getElementById('ctx-menu').classList.add('hidden');
    });
    document.getElementById('ctx-duplicate').addEventListener('click', function() {
      var nid = document.getElementById('ctx-menu').getAttribute('data-node-id');
      duplicateNode(nid);
      document.getElementById('ctx-menu').classList.add('hidden');
    });
    document.getElementById('ctx-delete').addEventListener('click', function() {
      var nid = document.getElementById('ctx-menu').getAttribute('data-node-id');
      deleteNode(nid);
      document.getElementById('ctx-menu').classList.add('hidden');
    });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#ctx-menu')) document.getElementById('ctx-menu').classList.add('hidden');
    });
  }

  /* ================================================================
     KEYBOARD SHORTCUTS
  ================================================================ */
  function setupKeyboard() {
    document.addEventListener('keydown', function(e) {
      // Block shortcuts when typing in any form field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      // Block shortcuts when focus is inside a non-props right panel (import/test/settings)
      var activeRp = document.querySelector('.right-panel-content:not(.rp-hidden)');
      if (activeRp && activeRp.id !== 'right-panel-props' && activeRp.contains(document.activeElement)) return;
      switch(e.key) {
        case 'v': case 'V':
          document.getElementById('tb-mode-select').click(); break;
        case 'c': case 'C':
          if (!e.ctrlKey && !e.metaKey) document.getElementById('tb-mode-connect').click(); break;
        case 'f': case 'F':
          fitCanvas(); break;
        case 'a': case 'A':
          if (!e.ctrlKey && !e.metaKey) autoLayout(); break;
        case 'Delete': case 'Backspace':
          if (selectedNodeId) { if (confirm('Delete selected node?')) deleteNode(selectedNodeId); }
          else if (selectedConnId) { deleteConnection(selectedConnId); }
          break;
        case 'Escape':
          deselectAll();
          connectFrom = null; hideTempConn();
          document.getElementById('ctx-menu').classList.add('hidden');
          break;
        case '+': case '=':
          zoom = Math.min(MAX_ZOOM, zoom + 0.1); applyTransform(); break;
        case '-':
          zoom = Math.max(MIN_ZOOM, zoom - 0.1); applyTransform(); break;
        case 'e': case 'E':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); openExportModal(); } break;
      }
    });
  }

  /* ================================================================
     INIT
  ================================================================ */
  function init() {
    setupPalette();
    setupCanvasEvents();
    setupToolbar();
    setupModals();
    setupContextMenu();
    setupKeyboard();
    updateStatus();
    applyTransform();

    /* ── Expose globals for integration script ── */
    window.studioLoadConfig  = loadConfig;
    window.studioGetJson     = buildJson;
    window.studioLoadJson    = function(jsonStr) {
      try { var cfg = JSON.parse(jsonStr); loadConfig(cfg); return { ok: true }; }
      catch(e) { toast('Invalid JSON: ' + e.message, 'error'); return { ok: false, error: e.message }; }
    };
    window.studioFit         = fitCanvas;
    window.studioAutoLayout  = autoLayout;
    window.studioClearCanvas = function() { nodes=[]; connections=[]; document.getElementById('canvas-nodes').innerHTML=''; document.getElementById('connections-group').innerHTML=''; deselectAll(); updateStatus(); };
    window.studioShowEmpty   = showEmptyProps;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
