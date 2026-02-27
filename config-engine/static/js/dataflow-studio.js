/**
 * Dataflow Studio — draw.io-style dataflow JSON builder.
 * USB Bank Developer Portal template. Orthogonal (straight elbow) connections.
 * Supports: Input, Output, Select, Filter, Join, Aggregate, Union, Custom, Validate nodes.
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
    custom:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14M12 2v2M12 20v2"/></svg>',
    validate:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>'
  };

  var TYPE_META = {
    input:     { label: 'Input',     color: '#16a34a' },
    output:    { label: 'Output',    color: '#d97706' },
    select:    { label: 'Select',    color: '#2563eb' },
    filter:    { label: 'Filter',    color: '#7c3aed' },
    join:      { label: 'Join',      color: '#0891b2' },
    aggregate: { label: 'Aggregate', color: '#dc2626' },
    union:     { label: 'Union',     color: '#0284c7' },
    custom:    { label: 'Custom',    color: '#64748b' },
    validate:  { label: 'Validate',  color: '#0d9488' }
  };

  var SELECT_OPS      = ['move','add','subtract','multiply','divide','compute','initialize','string','unstring','inspect'];
  var FILTER_OPS      = ['==','!=','>','<','>=','<=','in','not_in'];
  var JOIN_TYPES      = ['inner','left','right','full'];
  var AGG_OPS         = ['sum','count','avg','min','max'];
  var FORMATS_IN      = ['CSV','PARQUET','FIXED','DELIMITED'];
  var FORMATS_OUT     = ['PARQUET','CSV','DELIMITED'];
  var WRITE_MODES     = ['OVERWRITE','APPEND'];
  var FIELD_TYPES     = ['STRING','INT','LONG','DOUBLE','DECIMAL','DATE','TIMESTAMP'];
  var VALIDATE_DTYPES = ['TEXT','NUMBER','DATE','TIMESTAMP'];
  var VALIDATE_FMTS   = ['ANY','ALPHA','NUMERIC','ALPHANUMERIC','DATE','EMAIL','REGEX'];
  var FAIL_MODES      = ['flag','drop','abort'];

  /* ================================================================
     STATE
  ================================================================ */
  var _appSettings = {}; // loaded from /api/settings on init
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
  var _typeCounters = {};  // per-type counter for step IDs

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

  /* Generate step IDs like select_1, validate_2, filter_3 */
  function nextStepId(type) {
    _typeCounters[type] = (_typeCounters[type] || 0) + 1;
    return type + '_' + _typeCounters[type];
  }

  /* Re-sync type counters after loading a config (avoids clashes) */
  function syncTypeCounters() {
    nodes.forEach(function(n) {
      if (!n.step_id) return;
      var m = n.step_id.match(/^([a-z_]+)_(\d+)$/);
      if (m) {
        var t = m[1]; var num = parseInt(m[2], 10);
        if (!_typeCounters[t] || _typeCounters[t] < num) _typeCounters[t] = num;
      }
    });
  }

  function getNode(id) { return nodes.find(function(n){ return n.id===id; }); }
  function getConn(id) { return connections.find(function(c){ return c.id===id; }); }

  /* ── Top alert bar — slides down from top, auto-hides after 3.5 s ── */
  function toast(msg, type) {
    type = type || 'info';
    var alertEl = document.getElementById('studio-alert');
    if (!alertEl) { _toastFallback(msg, type); return; }

    /* clear previous state */
    alertEl.classList.remove('alert-success', 'alert-error', 'alert-info', 'alert-show');

    var iconMap = {
      success: 'fa-circle-check',
      error:   'fa-circle-xmark',
      info:    'fa-circle-info'
    };
    var icon = iconMap[type] || 'fa-circle-info';

    alertEl.className = 'studio-alert alert-' + type;
    alertEl.innerHTML =
      '<i class="fa-solid ' + icon + ' alert-icon"></i>' +
      '<span class="alert-msg">' + msg + '</span>' +
      '<button class="alert-close-btn" aria-label="Dismiss" ' +
        'onclick="var a=document.getElementById(\'studio-alert\');' +
                 'a.classList.remove(\'alert-show\');"' +
      '>&times;</button>';

    /* trigger slide-in (requestAnimationFrame ensures class change takes effect) */
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        alertEl.classList.add('alert-show');
      });
    });

    /* auto-hide */
    if (alertEl._hideTimer) clearTimeout(alertEl._hideTimer);
    alertEl._hideTimer = setTimeout(function() {
      alertEl.classList.remove('alert-show');
    }, type === 'error' ? 10000 : 3500);
  }

  /* Fallback visual toast used only when #studio-alert is not in the DOM */
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

  /* setMode is defined at module scope so it's accessible from any handler
     (bindNodeEvents, setupCanvasEvents, setupKeyboard, setupToolbar …) */
  function setMode(m) {
    mode = m;
    var selBtn = document.getElementById('tb-mode-select');
    var conBtn = document.getElementById('tb-mode-connect');
    if (selBtn) selBtn.classList.toggle('active', m === 'select');
    if (conBtn) conBtn.classList.toggle('active', m === 'connect');
    var wrap = document.getElementById('canvas-wrap');
    if (wrap) wrap.classList.toggle('connect-mode', m === 'connect');
    if (m !== 'connect') { connectFrom = null; hideTempConn(); }
    updateStatus();
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
    var sId = nextStepId(type);
    return Object.assign(base, {
      step_id: sId,
      description: '',
      output_alias: sId,
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

      // If a connection is in progress from another node, clicking this node body completes it
      if (connectFrom && connectFrom !== nodeId) {
        addConnection(connectFrom, nodeId);
        hideTempConn();
        setMode('select');
        selectNode(nodeId);
        return;
      }

      if (mode === 'connect') {
        // in connect mode, clicking the node body (not a port) does nothing special
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

    // Port events for connection — clicking a port always works (no mode-switch needed)
    el.querySelectorAll('.node-port').forEach(function(port) {
      port.addEventListener('mousedown', function(e) {
        e.stopPropagation();
        var portType = port.getAttribute('data-port');

        if (portType === 'out') {
          // Clicking the output port starts a connection regardless of current mode
          connectFrom = nodeId;
          tempConnMouse = null;
          if (mode !== 'connect') setMode('connect');
        } else if (portType === 'in') {
          // Clicking the input port completes a pending connection
          if (connectFrom && connectFrom !== nodeId) {
            addConnection(connectFrom, nodeId);
            hideTempConn();
            setMode('select'); // Return to select mode after completing connection
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

      // Cancel any active connection attempt when clicking empty canvas
      if (connectFrom || mode === 'connect') {
        connectFrom = null;
        hideTempConn();
        setMode('select');
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

      // ── Temp connection line — draw whenever a connection is in progress ────
      if (connectFrom) {
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
      // Handle drag-to-connect: user pressed output port, dragged, then released
      if (connectFrom) {
        var tPort   = e.target.closest ? e.target.closest('.node-port') : null;
        var tNodeEl = e.target.closest ? e.target.closest('.df-node')   : null;
        var tNodeId = tNodeEl ? tNodeEl.getAttribute('data-node-id') : null;

        if (tPort && tNodeId && tNodeId !== connectFrom && tPort.getAttribute('data-port') === 'in') {
          // Released on an input port of a different node
          addConnection(connectFrom, tNodeId);
          hideTempConn();
          setMode('select');
        } else if (tNodeEl && tNodeId && tNodeId !== connectFrom && !tPort) {
          // Released on the body of a different node
          addConnection(connectFrom, tNodeId);
          hideTempConn();
          setMode('select');
          selectNode(tNodeId);
        } else if (!tNodeEl) {
          // Released on empty canvas — cancel
          connectFrom = null;
          hideTempConn();
          setMode('select');
        }
        // (Released on same node or output-port of other node: wait for next click)
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
    document.querySelectorAll('.conn-path').forEach(function(el){
      el.classList.remove('selected');
      el.setAttribute('marker-end', 'url(#arrow-default)');
    });
    hideConnDeletePopup();
    showEmptyProps();
  }

  /* ================================================================
     CONNECTIONS
  ================================================================ */

  /* ── Schema → ValidateRules helpers ──────────────────────────────
     Used to pre-populate a Validate node's rules from a source input's field schema.
  ─────────────────────────────────────────────────────────────────── */
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
    var srcNode = nodes.find(function(n) {
      return (n.name        || n.id           || '').trim() === a ||
             (n.output_alias || n.step_id || n.id || '').trim() === a;
    });
    return srcNode && Array.isArray(srcNode.fields) ? srcNode.fields : [];
  }

  function fieldsToValidateRules(fields) {
    return fields.map(function(f) {
      return {
        field:       f.name  || '',
        data_type:   mapTypeToValidateDtype(f.type),
        nullable:    f.nullable !== false,
        max_length:  f.length ? String(f.length) : '',
        format:      'any',
        date_format: '',
        pattern:     ''
      };
    });
  }

  /* Only pre-populates when rules are currently empty */
  function tryPrePopulateValidateRules(node) {
    if (!node || node.type !== 'validate') return;
    if (node.validate_rules && node.validate_rules.length > 0) return;
    var fields = [];
    (node.source_inputs || []).some(function(alias) {
      var f = getFieldsForAlias(alias);
      if (f.length) { fields = f; return true; }
      return false;
    });
    if (!fields.length) return;
    node.validate_rules = fieldsToValidateRules(fields);
  }

  /* Re-render only the rules list-editor inside the open props panel */
  function refreshValidateRulesUI(node) {
    var ruleEditor = document.getElementById('pv-rules-editor');
    if (!ruleEditor) return;
    var container = ruleEditor.closest('.list-editor');
    if (!container) return;
    var temp = document.createElement('div');
    temp.innerHTML = buildValidationRulesEditor('pv-rules', node.validate_rules || []);
    container.replaceWith(temp.firstChild);
    // Re-attach format-change listener
    var newEditor = document.getElementById('pv-rules-editor');
    if (newEditor) {
      newEditor.addEventListener('change', function(e) {
        if (e.target && e.target.classList.contains('vr-fmt')) {
          var item  = e.target.closest('.validate-rule-item');
          var patEl = item && item.querySelector('.vr-pattern');
          var show  = (e.target.value === 'DATE' || e.target.value === 'REGEX');
          if (patEl) {
            patEl.style.display = show ? '' : 'none';
            patEl.placeholder   = e.target.value === 'DATE' ? 'yyyy-MM-dd' : 'regex pattern';
          }
        }
      });
    }
    rebindPropsApply(node);
  }

  /* Sync canvas connections when user picks sources in the props panel.
     Clears all connections TO this node, then re-creates from selectedAliases. */
  function syncConnectionsFromSourceSelect(node, selectedAliases) {
    var nodeId = node.step_id || node.id;
    // Remove all existing connections into this node
    connections = connections.filter(function(c) { return c.to !== nodeId; });
    // Re-create for every selected alias
    selectedAliases.filter(Boolean).forEach(function(alias) {
      var srcNode = nodes.find(function(n) {
        if ((n.step_id || n.id) === nodeId) return false;
        if (n.type === 'input')  return (n.name || n.id) === alias;
        if (n.type === 'output') return false;
        return (n.output_alias || n.step_id || n.id) === alias;
      });
      if (srcNode) addConnection(srcNode.id, nodeId);
    });
    renderConnections();
    updateStatus();
  }

  function addConnection(fromId, toId) {
    if (connections.some(function(c){ return c.from===fromId && c.to===toId; })) return;
    var id = 'conn_' + (_connCounter++);
    connections.push({ id: id, from: fromId, to: toId });
    // Auto-populate source_inputs on the target step node
    var toNode = getNode(toId);
    if (toNode && toNode.source_inputs !== undefined) {
      var srcAlias = getNodeOutputAlias(fromId);
      if (toNode.source_inputs.indexOf(srcAlias) < 0) toNode.source_inputs.push(srcAlias);
      // Pre-populate validate rules from the source schema (only when rules are empty)
      if (toNode.type === 'validate') tryPrePopulateValidateRules(toNode);
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
        document.querySelectorAll('.conn-path').forEach(function(p) {
          p.classList.remove('selected');
          p.setAttribute('marker-end', 'url(#arrow-default)');
        });
        path.classList.add('selected');
        path.setAttribute('marker-end', 'url(#arrow-selected)');
        showConnDeletePopup(c.id, e.clientX, e.clientY);
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
    if (el) {
      el.classList.add('hidden');
      el.setAttribute('d', 'M -9999 -9999');  /* move off-screen — d="" + marker-end causes artifact at origin */
      el.removeAttribute('marker-end');
    }
  }

  /* ── Connection delete popup ── */
  var _connDeleteTarget = null; // connId currently targeted by popup

  function showConnDeletePopup(connId, clientX, clientY) {
    _connDeleteTarget = connId;
    var popup = document.getElementById('conn-delete-popup');
    if (!popup) return;
    popup.classList.remove('hidden');
    /* Position near cursor, keeping inside viewport */
    var pw = 160, ph = 48;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(clientX + 12, vw - pw - 8);
    var top  = Math.min(clientY + 12, vh - ph - 8);
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';
  }

  function hideConnDeletePopup() {
    _connDeleteTarget = null;
    var popup = document.getElementById('conn-delete-popup');
    if (popup) popup.classList.add('hidden');
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
    else if (node.type === 'validate')  renderValidateProps(body, node);
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
    var schemaBadgeHtml = meta.copybook_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)</div>'
      : '<div class="import-file-badge" id="pi-copybook-badge"></div>';
    var schemaBtnClass = meta.copybook_file ? ' has-file' : '';
    var schemaBtnLabel = meta.copybook_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)'
      : '<i class="fa-solid fa-file-import"></i> Upload Schema File';
    var tfBadgeHtml = meta.test_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)</div>'
      : '<div class="import-file-badge" id="pi-test-file-badge"></div>';
    var tfBtnClass = meta.test_file ? ' has-file' : '';
    var tfBtnLabel = meta.test_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)'
      : '<i class="fa-solid fa-flask"></i> Upload Test Data File';

    var curFmt = (node.format || '').toUpperCase();
    var isFixed = (curFmt === 'FIXED');

    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Basic</div>' +
        formRow('Name / ID', textInput('pi-name', node.name, 'e.g. CUSTOMER')) +
        formRow('Format', selectInput('pi-format', FORMATS_IN, curFmt || FORMATS_IN[0])) +
        formRow('S3 Path', textInput('pi-s3path', node.s3_path, 's3://bucket/path/to/file')) +
        formRow('Partition Column', textInput('pi-partition-col', node.partition_col !== undefined ? node.partition_col : 'load_date()', 'e.g. load_date()')) +
      '</div>' +
      /* ── Fixed Width Settings — only visible when format = "FIXED" ── */
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
          '<div class="props-import-title"><i class="fa-solid fa-file-import"></i> Import Schema</div>' +
          '<div class="schema-template-links">' +
            '<span class="schema-tpl-label">Templates:</span>' +
            '<a href="#" class="schema-tpl-link" data-fmt="csv">CSV</a>' +
            '<a href="#" class="schema-tpl-link" data-fmt="json">JSON</a>' +
            '<a href="#" class="schema-tpl-link" data-fmt="txt">Text</a>' +
            '<a href="#" class="schema-tpl-link" data-fmt="cbl">COBOL</a>' +
          '</div>' +
          '<button type="button" class="btn-import-sm' + schemaBtnClass + '" id="pi-import-schema-btn">' +
            schemaBtnLabel +
          '</button>' +
          (meta.copybook_file ? schemaBadgeHtml : '<div class="import-file-badge" id="pi-copybook-badge"></div>') +
        '</div>' +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Test Data</div>' +
        '<p style="font-size:12px;color:#64748b;margin-bottom:8px">Upload a test data file (CSV, fixed-width, delimited, DAT, etc.) for this input node.</p>' +
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
        piFixedSec.style.display = (this.value === 'FIXED') ? '' : 'none';
      });
    }

    /* Bind Import Schema */
    var schemaBtn = document.getElementById('pi-import-schema-btn');
    if (schemaBtn) {
      schemaBtn.addEventListener('click', function() {
        pickAndParseSchema(node, 'pi-fields', 'pi-copybook-badge', schemaBtn, 'input');
      });
    }

    /* Bind template download links */
    body.querySelectorAll('.schema-tpl-link').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        downloadSchemaTemplate(a.getAttribute('data-fmt'));
      });
    });

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
    var schemaBadgeHtml = meta.copybook_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)</div>'
      : '<div class="import-file-badge" id="po-copybook-badge"></div>';
    var schemaBtnClass = meta.copybook_file ? ' has-file' : '';
    var schemaBtnLabel = meta.copybook_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.copybook_file) + ' (' + (meta.fields || 0) + ' fields)'
      : '<i class="fa-solid fa-file-import"></i> Upload Schema File';
    var tfBadgeHtml = meta.test_file
      ? '<div class="import-file-badge visible">✓ ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)</div>'
      : '<div class="import-file-badge" id="po-test-file-badge"></div>';
    var tfBtnClass = meta.test_file ? ' has-file' : '';
    var tfBtnLabel = meta.test_file
      ? '<i class="fa-solid fa-check"></i> ' + esc(meta.test_file) + ' (' + (meta.rows || 0) + ' rows)'
      : '<i class="fa-solid fa-flask"></i> Upload Expected Output CSV';

    var curFmtO = (node.format || '').toUpperCase();

    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Basic</div>' +
        formRow('Name / ID', textInput('po-name', node.name, 'e.g. REPORT1')) +
        formRow('Format', selectInput('po-format', FORMATS_OUT, curFmtO || FORMATS_OUT[0])) +
        formRow('S3 Path', textInput('po-s3path', node.s3_path, 's3://bucket/output')) +
        formRow('Write Mode', selectInput('po-wmode', WRITE_MODES, (node.write_mode || '').toUpperCase() || WRITE_MODES[0])) +
        formRow('Output Columns (comma-sep)', textInput('po-outcols', node.output_columns, 'COL1, COL2, ...')) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Fields (optional)</div>' +
        buildFieldsEditor('po-fields', node.fields || []) +
        '<div class="props-import-section">' +
          '<div class="props-import-title"><i class="fa-solid fa-file-import"></i> Import Schema</div>' +
          '<div class="schema-template-links">' +
            '<span class="schema-tpl-label">Templates:</span>' +
            '<a href="#" class="schema-tpl-link" data-fmt="csv">CSV</a>' +
            '<a href="#" class="schema-tpl-link" data-fmt="json">JSON</a>' +
            '<a href="#" class="schema-tpl-link" data-fmt="txt">Text</a>' +
            '<a href="#" class="schema-tpl-link" data-fmt="cbl">COBOL</a>' +
          '</div>' +
          '<button type="button" class="btn-import-sm' + schemaBtnClass + '" id="po-import-schema-btn">' +
            schemaBtnLabel +
          '</button>' +
          (meta.copybook_file ? schemaBadgeHtml : '<div class="import-file-badge" id="po-copybook-badge"></div>') +
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
    var schemaBtn = document.getElementById('po-import-schema-btn');
    if (schemaBtn) {
      schemaBtn.addEventListener('click', function() {
        pickAndParseSchema(node, 'po-fields', 'po-copybook-badge', schemaBtn, 'output');
      });
    }
    /* Bind template download links */
    body.querySelectorAll('.schema-tpl-link').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        downloadSchemaTemplate(a.getAttribute('data-fmt'));
      });
    });
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
     SCHEMA TEMPLATE DOWNLOADS
  ================================================================ */
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

  function downloadSchemaTemplate(fmt) {
    var tpl = _schemaTemplateContent(fmt);
    if (!tpl) return;
    var blob = new Blob([tpl.text], {type: tpl.mime});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = tpl.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
  }

  /* ================================================================
     SCHEMA CLIENT-SIDE PARSERS
  ================================================================ */
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

  function _applySchemaFields(parsedFields, filename, node, fieldsEditorId, badgeId, btn, configPath, nodeType) {
    node.fields = parsedFields.map(function(f) {
      return {name: f.name, type: (f.type || 'STRING').toUpperCase(), length: f.length, start: f.start, nullable: true};
    });
    var fe = document.getElementById(fieldsEditorId + '-editor');
    if (fe) fe.outerHTML = buildFieldsEditor(fieldsEditorId, node.fields);
    var badge = document.getElementById(badgeId);
    if (badge) { badge.textContent = '✓ ' + parsedFields.length + ' fields from ' + filename; badge.classList.add('visible'); }
    btn.innerHTML = '<i class="fa-solid fa-check"></i> ' + esc(filename) + ' (' + parsedFields.length + ' fields)';
    btn.classList.add('has-file');
    if (!_nodeFileMeta[configPath]) _nodeFileMeta[configPath] = {};
    var existing = _nodeFileMeta[configPath][node.name || node.id] || {};
    existing.copybook_file = filename;
    existing.fields = parsedFields.length;
    existing.type = nodeType || 'input';
    _nodeFileMeta[configPath][node.name || node.id] = existing;
  }

  /* ================================================================
     IMPORT SCHEMA — multi-format (COBOL server-side; JSON/CSV/TXT client-side)
  ================================================================ */
  function pickAndParseSchema(node, fieldsEditorId, badgeId, btn, nodeType) {
    var configPath = (document.getElementById('current-file') || {}).textContent || '';
    if (!configPath || configPath === 'Select a configuration') {
      toast('Select a configuration before importing a schema', 'error'); return;
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cbl,.cpy,.cob,.json,.csv,.txt,.xlsx';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function() {
      var file = input.files && input.files[0];
      if (!file) { document.body.removeChild(input); return; }
      var ext = file.name.split('.').pop().toLowerCase();

      if (['cbl', 'cpy', 'cob'].indexOf(ext) >= 0) {
        /* COBOL — server-side parsing (existing endpoint) */
        var fd = new FormData();
        fd.append('file', file);
        fd.append('node_name', node.name || node.id);
        fd.append('node_type', nodeType || 'input');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Parsing…';
        btn.disabled = true;
        fetch('/api/config/' + encodeURIComponent(configPath) + '/node-copybook', {method: 'POST', body: fd})
          .then(function(r) { return r.json(); })
          .then(function(res) {
            btn.disabled = false;
            if (res.error) { toast('Schema parse error: ' + res.error, 'error'); return; }
            var fields = res.fields || [];
            _applySchemaFields(fields, file.name, node, fieldsEditorId, badgeId, btn, configPath, nodeType);
            toast('Schema imported: ' + fields.length + ' fields', 'success');
          })
          .catch(function(e) {
            btn.disabled = false;
            toast('Schema import failed: ' + (e.message || e), 'error');
          });
      } else {
        /* JSON / CSV / TXT — client-side parsing */
        var reader = new FileReader();
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Parsing…';
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
            if (!fields.length) { toast('No fields found in schema file. Check the format.', 'error'); return; }
            _applySchemaFields(fields, file.name, node, fieldsEditorId, badgeId, btn, configPath, nodeType);
            toast('Schema imported: ' + fields.length + ' fields', 'success');
          } catch(e) {
            toast('Schema parse failed: ' + e.message, 'error');
          }
        };
        reader.onerror = function() { btn.disabled = false; toast('File read failed', 'error'); };
        reader.readAsText(file);
      }
      document.body.removeChild(input);
    });
    input.click();
  }

  /* Keep old name as alias for backward-compat (in case any other caller uses it) */
  var pickAndParseCopybook = pickAndParseSchema;

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
    input.accept = '.csv,.txt,.tsv,.dat,.fixed,.del';
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
        formRow('Source Inputs', multiSourceSelect('ps-src', node.source_inputs || [], node.id)) +
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
        formRow('Source Inputs', multiSourceSelect('pf-src', node.source_inputs || [], node.id)) +
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
        formRow('Left Input', singleSourceSelect('pj-left', node.join_left, node.id)) +
        formRow('Right Input', singleSourceSelect('pj-right', node.join_right, node.id)) +
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
        formRow('Source Inputs', multiSourceSelect('pa-src', node.source_inputs || [], node.id)) +
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
        formRow('Source Inputs', multiSourceSelect('pu-src', node.source_inputs || [], node.id)) +
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
        formRow('Source Inputs', multiSourceSelect('pc-src', node.source_inputs || [], node.id)) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Logic (JSON)</div>' +
        '<div class="form-row">' +
          '<textarea id="pc-logic" rows="8">' + esc(logicStr) + '</textarea>' +
        '</div>' +
      '</div>';
    rebindPropsApply(node);
  }

  /* ---- VALIDATE STEP ---- */
  var _FAIL_MODE_TOOLTIP =
    '<b>flag</b>: keeps all rows, adds <code>_is_valid</code> &amp; <code>_validation_errors</code> columns.<br>' +
    '<b>drop</b>: removes invalid rows, routes them to the Error Bucket.<br>' +
    '<b>abort</b>: raises an error immediately if any row fails validation.';

  function renderValidateProps(body, node) {
    /* Pre-populate bucket paths from global settings if node fields are empty */
    var defValidBucket = node.validation_bucket !== undefined
      ? node.validation_bucket
      : (_appSettings.validation_bucket_prefix || '');
    var defErrorBucket = node.error_bucket !== undefined
      ? node.error_bucket
      : (_appSettings.error_bucket_prefix || '');

    var failTooltipHtml =
      '<span class="field-info-tooltip">' +
        '<i class="fa-solid fa-circle-info info-icon"></i>' +
        '<span class="tooltip-text">' + _FAIL_MODE_TOOLTIP + '</span>' +
      '</span>';

    body.innerHTML =
      '<div class="props-section">' +
        '<div class="props-section-title">Step Info</div>' +
        formRow('Step ID',     textInput('pv-id',   node.step_id,    'e.g. validate_accounts')) +
        formRow('Description', textInput('pv-desc', node.description, 'Describe this validation')) +
        formRow('Output Alias',textInput('pv-alias', node.output_alias, 'e.g. validated_data')) +
        formRow('Source Input', singleSourceSelect('pv-src', (node.source_inputs||[])[0] || '', node.id)) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title">Validation Settings</div>' +
        /* On Failure row with inline tooltip icon */
        '<div class="form-row">' +
          '<label>On Failure ' + failTooltipHtml + '</label>' +
          selectInput('pv-fail-mode', FAIL_MODES, node.fail_mode || 'abort') +
        '</div>' +
        formRow('Validation Bucket',
          textInput('pv-validation-bucket', defValidBucket, 's3://bucket/validation/') +
          '<span class="field-hint">S3 path for validation result records</span>'
        ) +
        formRow('Error Bucket',
          textInput('pv-error-bucket', defErrorBucket, 's3://bucket/errors/') +
          '<span class="field-hint">S3 path for invalid rows (applies when On Failure = <b>drop</b>)</span>'
        ) +
      '</div>' +
      '<div class="props-section">' +
        '<div class="props-section-title props-section-title-row">' +
          'Validation Rules' +
          '<button class="btn-from-schema" id="btn-load-schema-rules" title="Pre-populate rules from source input schema">↻ From Schema</button>' +
        '</div>' +
        buildValidationRulesEditor('pv-rules', node.validate_rules || []) +
      '</div>';
    rebindPropsApply(node);

    /* Show / hide pattern input when format changes in any rule card */
    var ruleEditor = document.getElementById('pv-rules-editor');
    if (ruleEditor) {
      ruleEditor.addEventListener('change', function(e) {
        if (e.target && e.target.classList.contains('vr-fmt')) {
          var card   = e.target.closest('.validate-rule-item');
          var patEl  = card && card.querySelector('.vr-pattern');
          var showPat = (e.target.value === 'DATE' || e.target.value === 'REGEX');
          if (patEl) {
            patEl.style.display = showPat ? '' : 'none';
            patEl.placeholder = e.target.value === 'DATE' ? 'yyyy-MM-dd' : 'regex pattern';
          }
        }
      });
    }

    /* "From Schema" button */
    var btnSchema = document.getElementById('btn-load-schema-rules');
    if (btnSchema) {
      btnSchema.addEventListener('click', function() {
        var pvSrcEl = document.getElementById('pv-src');
        if (pvSrcEl && pvSrcEl.value.trim()) node.source_inputs = [pvSrcEl.value.trim()].filter(Boolean);
        var fields = [];
        (node.source_inputs || []).some(function(alias) {
          var f = getFieldsForAlias(alias);
          if (f.length) { fields = f; return true; }
          return false;
        });
        if (!fields.length) { toast('No schema found for the selected source input(s).', 'error'); return; }
        node.validate_rules = fieldsToValidateRules(fields);
        refreshValidateRulesUI(node);
        toast('Loaded ' + fields.length + ' rule(s) from schema.', 'success');
      });
    }
  }

  /* ── Source / alias dropdowns — populated from current canvas nodes ──
     getSourceOptions: returns [{value, label}] of all available inputs/steps
     excluding the current node (to prevent self-reference).
  ─────────────────────────────────────────────────────────────────── */
  function getSourceOptions(excludeNodeId) {
    var opts = [];
    nodes.forEach(function(n) {
      if (n.id === excludeNodeId) return;
      if (n.type === 'input') {
        opts.push({ value: n.name || n.id, label: (n.name || n.id) + ' [Input]' });
      } else if (n.type !== 'output') {
        var alias = n.output_alias || n.step_id || n.id;
        var lbl   = (TYPE_META[n.type] || { label: n.type }).label;
        opts.push({ value: alias, label: alias + ' [' + lbl + ']' });
      }
    });
    return opts;
  }

  /* Multi-select dropdown (source_inputs for most step types) */
  function multiSourceSelect(id, currentValues, excludeNodeId) {
    var opts = getSourceOptions(excludeNodeId);
    var vals = currentValues || [];
    var html = '<select id="' + id + '" class="multi-source-select" multiple' +
               ' size="' + Math.min(Math.max(opts.length, 2), 5) + '">';
    opts.forEach(function(o) {
      var sel = vals.indexOf(o.value) >= 0 ? ' selected' : '';
      html += '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
    });
    /* Keep any current values not in the grid (loaded from JSON) */
    vals.forEach(function(v) {
      if (!v) return;
      var exists = opts.some(function(o) { return o.value === v; });
      if (!exists) html += '<option value="' + esc(v) + '" selected>' + esc(v) + ' (saved)</option>';
    });
    if (!opts.length && !vals.length) {
      html += '<option disabled value="">No nodes on canvas yet</option>';
    }
    html += '</select>';
    return html;
  }

  /* Single-select dropdown (join left / right, validate source) */
  function singleSourceSelect(id, currentValue, excludeNodeId) {
    var opts = getSourceOptions(excludeNodeId);
    var html = '<select id="' + id + '" class="single-source-select">';
    html += '<option value="">— select source —</option>';
    opts.forEach(function(o) {
      var sel = o.value === currentValue ? ' selected' : '';
      html += '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
    });
    if (currentValue) {
      var exists = opts.some(function(o) { return o.value === currentValue; });
      if (!exists) html += '<option value="' + esc(currentValue) + '" selected>' + esc(currentValue) + ' (saved)</option>';
    }
    html += '</select>';
    return html;
  }

  /* Read selected values from a multi-select */
  function getMultiSelectValues(id) {
    var el = document.getElementById(id);
    if (!el) return [];
    return Array.prototype.slice.call(el.options)
      .filter(function(o) { return o.selected; })
      .map(function(o) { return o.value; })
      .filter(Boolean);
  }

  /* Read single select value (with fallback) */
  function getSingleSelectValue(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /* Build the validation rules list editor */
  function buildValidationRulesEditor(ns, rules) {
    var cards = rules.map(function(r, i) {
      var showPattern = (r.format === 'REGEX' || r.format === 'DATE');
      return '<div class="vr-card validate-rule-item">' +
        /* Close button — top-right corner of card */
        '<button class="vr-card-remove list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove rule">×</button>' +
        /* Row 1: Field name + Data type + Nullable checkbox */
        '<div class="vr-card-row">' +
          '<input type="text" placeholder="Field name" value="' + esc(r.field||'') + '" data-field="field" data-idx="' + i + '" class="vr-field" title="Column name to validate" />' +
          selectOpts(VALIDATE_DTYPES, r.data_type||'TEXT', 'data-field="data_type" data-idx="' + i + '" class="vr-dtype" title="Expected data type"') +
          '<label class="vr-nullable-wrap" title="Uncheck = field is required (must not be null)">' +
            '<input type="checkbox" data-field="nullable" data-idx="' + i + '" class="vr-nullable"' + (r.nullable !== false ? ' checked' : '') + ' />' +
            '<span>Null OK</span>' +
          '</label>' +
        '</div>' +
        /* Row 2: Max Length + Format + optional Pattern */
        '<div class="vr-card-row vr-card-row2">' +
          '<label class="vr-sub-lbl">Max Len</label>' +
          '<input type="number" placeholder="—" value="' + esc(r.max_length||'') + '" data-field="max_length" data-idx="' + i + '" class="vr-maxlen" title="Maximum character length (blank = no check)" />' +
          '<label class="vr-sub-lbl">Format</label>' +
          selectOpts(VALIDATE_FMTS, r.format||'ANY', 'data-field="format" data-idx="' + i + '" class="vr-fmt" title="Value format check"') +
          '<input type="text" placeholder="' + (r.format === 'DATE' ? 'yyyy-MM-dd' : 'regex pattern') + '" value="' + esc(r.pattern||r.date_format||'') + '" data-field="pattern" data-idx="' + i + '" class="vr-pattern" title="Date format or regex pattern"' + (showPattern ? '' : ' style="display:none"') + ' />' +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="list-editor vr-cards-editor" id="' + ns + '-editor">' +
      '<div class="list-editor-header">' +
        '<span>Rules (' + rules.length + ')</span>' +
      '</div>' +
      '<div class="vr-cards-list">' + cards + '</div>' +
      '<button class="btn-add-row" data-ns="' + ns + '" data-action="add-rule">+ Add Rule</button>' +
    '</div>';
  }

  /* ================================================================
     LIST EDITORS
  ================================================================ */

  function buildFieldsEditor(ns, fields) {
    var rows = fields.map(function(f, i) {
      var curType = (f.type || 'STRING').toUpperCase();
      return '<div class="list-item">' +
        '<div class="list-item-inputs">' +
          '<input type="text" placeholder="Field name" value="' + esc(f.name||'') + '" data-field="name" data-idx="' + i + '" class="lci-name" title="Field name" />' +
          selectOpts(FIELD_TYPES, curType, 'data-field="type" data-idx="' + i + '" class="lci-type" title="Data type"') +
          '<input type="number" placeholder="1" value="' + esc(f.start||'') + '" data-field="start" data-idx="' + i + '" class="lci-start" title="Start position (1-based)" />' +
          '<input type="number" placeholder="0" value="' + esc(f.length||'') + '" data-field="length" data-idx="' + i + '" class="lci-len" title="Field length in characters" />' +
        '</div>' +
        '<div class="list-item-actions">' +
          '<button class="list-item-up" data-ns="' + ns + '" data-idx="' + i + '" title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="list-item-down" data-ns="' + ns + '" data-idx="' + i + '" title="Move down"' + (i === fields.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="list-item-remove" data-ns="' + ns + '" data-idx="' + i + '" title="Remove field">×</button>' +
        '</div>' +
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
        } else if (action === 'add-rule') {
          if (!node.validate_rules) node.validate_rules = [];
          node.validate_rules.push({field:'', data_type:'string', max_length:'', nullable:true, format:'any', date_format:'', pattern:''});
        }
        showPropsPanel(node);
      });
    });

    // Move row up / down buttons
    body.querySelectorAll('.list-item-up, .list-item-down').forEach(function(mbtn) {
      mbtn.addEventListener('click', function() {
        if (mbtn.disabled) return;
        readListEditorIntoNode(node);
        var ns  = mbtn.getAttribute('data-ns');
        var idx = parseInt(mbtn.getAttribute('data-idx'), 10);
        var dir = mbtn.classList.contains('list-item-up') ? -1 : 1;
        moveListRow(node, ns, idx, dir);
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

    // Auto-create canvas connections when source select changes
    body.querySelectorAll('.multi-source-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var selected = Array.from(sel.selectedOptions).map(function(o){ return o.value; });
        syncConnectionsFromSourceSelect(node, selected);
      });
    });
    body.querySelectorAll('.single-source-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var selected = sel.value ? [sel.value] : [];
        syncConnectionsFromSourceSelect(node, selected);
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

  function _getListArr(node, ns) {
    if (ns === 'pi-fields' || ns === 'po-fields') return node.fields;
    if (ns === 'ps-exprs') return node.select_expressions;
    if (ns === 'pf-conds') return node.filter_conditions;
    if (ns === 'pj-keys') return node.join_keys;
    if (ns === 'pa-grp') return node.agg_group_by;
    if (ns === 'pa-aggs') return node.agg_aggregations;
    if (ns === 'pv-rules') return node.validate_rules;
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
    // validate rules — has checkboxes, read specially
    var ruleEditor = body.querySelector('#pv-rules-editor');
    if (ruleEditor) {
      node.validate_rules = [];
      ruleEditor.querySelectorAll('.validate-rule-item').forEach(function(item) {
        var gv = function(sel) { var el = item.querySelector(sel); return el ? el.value : ''; };
        var gc2 = function(sel) { var el = item.querySelector(sel); return el ? el.checked : true; };
        var fmt = gv('.vr-fmt');
        var pat = gv('.vr-pattern');
        var rule = {
          field:       gv('.vr-field'),
          data_type:   gv('.vr-dtype') || 'string',
          max_length:  gv('.vr-maxlen'),
          nullable:    gc2('.vr-nullable'),
          format:      fmt || 'any',
          date_format: fmt === 'date'  ? pat : '',
          pattern:     fmt === 'regex' ? pat : ''
        };
        if (rule.field) node.validate_rules.push(rule);
      });
    }
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
      node.name          = g('pi-name') || node.id;
      node.id            = node.name; // sync id with name for inputs
      node.format        = g('pi-format');
      node.s3_path       = g('pi-s3path');
      node.partition_col = g('pi-partition-col') || 'load_date()';
      /* Remove legacy fields that are no longer used */
      delete node.path;
      delete node.dataset;
      delete node.copybook;
      /* Fixed-width specific fields — collected whenever format is FIXED */
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
      node.s3_path   = g('po-s3path');
      node.write_mode= g('po-wmode');
      node.output_columns = g('po-outcols');
      delete node.path;
      if (oldNameO && oldNameO !== node.name) {
        var elO = document.querySelector('[data-node-id="' + oldNameO + '"]');
        if (elO) elO.setAttribute('data-node-id', node.id);
      }
    } else if (node.type === 'select') {
      node.step_id     = g('ps-id') || node.id;
      node.id          = node.step_id;
      node.description = g('ps-desc');
      node.output_alias= g('ps-alias') || node.step_id;
      node.source_inputs = getMultiSelectValues('ps-src');
    } else if (node.type === 'filter') {
      node.step_id     = g('pf-id') || node.id;
      node.id          = node.step_id;
      node.description = g('pf-desc');
      node.output_alias= g('pf-alias') || node.step_id;
      node.source_inputs = getMultiSelectValues('pf-src');
    } else if (node.type === 'join') {
      node.step_id     = g('pj-id') || node.id;
      node.id          = node.step_id;
      node.description = g('pj-desc');
      node.output_alias= g('pj-alias') || node.step_id;
      node.join_left   = getSingleSelectValue('pj-left');
      node.join_right  = getSingleSelectValue('pj-right');
      node.join_type   = g('pj-jtype');
      node.source_inputs = [node.join_left, node.join_right].filter(Boolean);
    } else if (node.type === 'aggregate') {
      node.step_id     = g('pa-id') || node.id;
      node.id          = node.step_id;
      node.description = g('pa-desc');
      node.output_alias= g('pa-alias') || node.step_id;
      node.source_inputs = getMultiSelectValues('pa-src');
    } else if (node.type === 'union') {
      node.step_id       = g('pu-id') || node.id;
      node.id            = node.step_id;
      node.description   = g('pu-desc');
      node.output_alias  = g('pu-alias') || node.step_id;
      node.source_inputs = getMultiSelectValues('pu-src');
      node.union_distinct= gc('pu-distinct');
    } else if (node.type === 'validate') {
      node.step_id      = g('pv-id') || node.id;
      node.id           = node.step_id;
      node.description  = g('pv-desc');
      node.output_alias = g('pv-alias') || node.step_id;
      node.source_inputs = [getSingleSelectValue('pv-src')].filter(Boolean);
      node.fail_mode         = g('pv-fail-mode') || 'abort';
      node.validation_bucket = g('pv-validation-bucket') || '';
      node.error_bucket      = g('pv-error-bucket') || '';
      /* Read validation rules from the editor DOM */
      var ruleItems = document.querySelectorAll('#pv-rules-editor .validate-rule-item');
      node.validate_rules = [];
      ruleItems.forEach(function(item) {
        var getF = function(sel) { var el = item.querySelector(sel); return el ? el.value : ''; };
        var getC = function(sel) { var el = item.querySelector(sel); return el ? el.checked : true; };
        var fmt = getF('.vr-fmt');
        var pat = getF('.vr-pattern');
        var rule = {
          field:       getF('.vr-field'),
          data_type:   getF('.vr-dtype') || 'TEXT',
          max_length:  getF('.vr-maxlen') ? parseInt(getF('.vr-maxlen'), 10) || undefined : undefined,
          nullable:    getC('.vr-nullable'),
          format:      fmt || 'ANY'
        };
        if (fmt === 'DATE' && pat) rule.date_format = pat;
        else if (fmt === 'REGEX' && pat) rule.pattern = pat;
        if (rule.field) node.validate_rules.push(rule);
      });
    } else {
      node.step_id      = g('pc-id') || node.id;
      node.id           = node.step_id;
      node.description  = g('pc-desc');
      node.output_alias = g('pc-alias') || node.step_id;
      node.source_inputs = getMultiSelectValues('pc-src');
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
    if (node.type === 'validate') {
      return {
        fail_mode: node.fail_mode || 'flag',
        rules: (node.validate_rules || [])
          .filter(function(r) { return r.field; })
          .map(function(r) {
            var rule = {
              field:     r.field,
              data_type: r.data_type  || 'string',
              nullable:  r.nullable !== false
            };
            if (r.max_length) rule.max_length = parseInt(r.max_length, 10);
            if (r.format && r.format !== 'any') rule.format = r.format;
            if (r.format === 'date'  && r.date_format) rule.date_format = r.date_format;
            if (r.format === 'date'  && r.pattern)     rule.date_format = r.pattern;
            if (r.format === 'regex' && r.pattern)     rule.pattern     = r.pattern;
            return rule;
          })
      };
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
    _nodeCounter = 1; _connCounter = 1; _typeCounters = {};
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
      } else if (s.type === 'validate') {
        n.fail_mode = logic.fail_mode || 'flag';
        n.validate_rules = (logic.rules || []).map(function(r) {
          return {
            field:       r.field       || '',
            data_type:   r.data_type   || 'string',
            max_length:  r.max_length  || '',
            nullable:    r.nullable !== false,
            format:      r.format      || 'any',
            date_format: r.date_format || '',
            pattern:     r.pattern     || ''
          };
        });
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
    syncTypeCounters();
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
    // Mode buttons (optional — toolbar buttons removed; port-click handles mode switching)
    var tbSel = document.getElementById('tb-mode-select');
    var tbCon = document.getElementById('tb-mode-connect');
    if (tbSel) tbSel.addEventListener('click', function() { setMode('select'); });
    if (tbCon) tbCon.addEventListener('click', function() { setMode('connect'); });

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
          hideConnDeletePopup();
          var ctxMenu = document.getElementById('ctx-menu');
          if (ctxMenu) ctxMenu.classList.add('hidden');
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
  /* Load global app settings (bucket prefixes etc.) for use in prop panels */
  function loadAppSettings() {
    fetch('/api/settings').then(function(r){ return r.json(); }).then(function(d){
      _appSettings = d || {};
    }).catch(function(){});
  }

  function init() {
    loadAppSettings();
    setupPalette();
    setupCanvasEvents();
    setupToolbar();
    setupModals();
    setupContextMenu();
    setupKeyboard();
    updateStatus();
    applyTransform();

    /* ── Connection delete popup button ── */
    var connDeleteBtn = document.getElementById('conn-delete-btn');
    if (connDeleteBtn) {
      connDeleteBtn.addEventListener('click', function() {
        if (_connDeleteTarget) {
          deleteConnection(_connDeleteTarget);
          hideConnDeletePopup();
          deselectAll();
        }
      });
    }
    /* Close popup when clicking anywhere outside it */
    document.addEventListener('mousedown', function(e) {
      var popup = document.getElementById('conn-delete-popup');
      if (popup && !popup.contains(e.target) && !e.target.closest('.conn-path')) {
        hideConnDeletePopup();
      }
    }, true);

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
