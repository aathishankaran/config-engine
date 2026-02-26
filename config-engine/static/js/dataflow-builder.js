/**
 * Dataflow Builder - draw.io style drag-and-drop canvas to create dataflow JSON.
 * Exports format compatible with dataflow-engine.
 */
(function () {
  var API = window.CodeParser && window.CodeParser.API;
  if (!API) {
    console.error('API module required');
    return;
  }

  /* ── Popup helper — uses existing modal system; falls back to alert ── */
  function builderMsg(title, msg, type) {
    var cp = window.CodeParser;
    if (type === 'error') {
      if (cp && cp.showErrorPopup) { cp.showErrorPopup(title, msg, ''); return; }
      if (cp && cp.showMessagePopup) { cp.showMessagePopup(title, msg, 'error'); return; }
    } else {
      if (cp && cp.showMessagePopup) { cp.showMessagePopup(title, msg, 'success'); return; }
    }
    /* last-resort native fallback */
    alert(msg);
  }

  var GRID_SIZE = 20;
  var NODE_WIDTH = 160;
  var NODE_HEIGHT = 60;
  var CONNECTOR_SIZE = 10;

  var nodes = [];
  var connections = [];
  var nodeIdCounter = 1;
  var connectionIdCounter = 1;
  var mode = 'select'; // 'select' | 'connect'
  var connectSource = null;
  var zoom = 1;
  var panX = 0;
  var panY = 0;
  var selectedNodeId = null;
  var dragOffset = { x: 0, y: 0 };
  var isDragging = false;
  var dragStartPos = { x: 0, y: 0 };
  var DRAG_THRESHOLD = 5;

  var defaultLogic = {
    select: { columns: ['*'] },
    filter: { conditions: [{ field: 'FIELD', operation: '==', value: 'value' }] },
    join: { left: 'left_input', right: 'right_input', on: [['KEY', 'KEY']], how: 'inner' },
    aggregate: { group_by: ['COL'], aggregations: [{ field: 'AMT', operation: 'sum', alias: 'TOTAL' }] },
    union: { inputs: ['input1', 'input2'], distinct: false },
    custom: {}
  };

  function generateId(type) {
    var base = type === 'input' ? 'INPUT' : type === 'output' ? 'OUTPUT' : 'step';
    var id = base + '_' + (nodeIdCounter++);
    return id;
  }

  function createNode(type, x, y) {
    var id = generateId(type);
    var label = type.charAt(0).toUpperCase() + type.slice(1) + ' ' + id;
    var node = {
      id: id,
      type: type,
      label: label,
      x: Math.round(x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(y / GRID_SIZE) * GRID_SIZE,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      description: '',
      source_inputs: [],
      output_alias: type === 'output' ? id : type === 'input' ? id : '',
      format: type === 'input' || type === 'output' ? 'parquet' : null,
      path: type === 'input' ? 'data/input/' + id.toLowerCase() : type === 'output' ? 'data/output/' + id.toLowerCase() : null,
      dataset: '',
      copybook: '',
      write_mode: type === 'output' ? 'overwrite' : null,
      fields: [],
      logic: type in defaultLogic ? JSON.parse(JSON.stringify(defaultLogic[type])) : {}
    };
    if (type === 'step' || ['select', 'filter', 'join', 'aggregate', 'union', 'custom'].indexOf(type) >= 0) {
      node.type = type;
      node.output_alias = node.output_alias || 'step_' + id;
    }
    return node;
  }

  function getNodeElement(id) {
    return document.querySelector('[data-node-id="' + id + '"]');
  }

  function renderNode(node) {
    var isInput = node.type === 'input';
    var isOutput = node.type === 'output';
    var typeClass = 'node-' + node.type;
    var html = '<div class="builder-node ' + typeClass + '" data-node-id="' + node.id + '" ';
    html += 'style="left:' + node.x + 'px;top:' + node.y + 'px;width:' + node.width + 'px;height:' + node.height + 'px;">';
    if (!isInput) html += '<div class="node-connector node-input-connector" data-connector="input" title="Connect from here (source)"></div>';
    html += '<div class="node-label">' + escapeHtml(node.label || node.id) + '</div>';
    if (!isOutput) html += '<div class="node-connector node-output-connector" data-connector="output" title="Connect to here (target)"></div>';
    html += '</div>';
    return html;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function addNodeToCanvas(node) {
    nodes.push(node);
    var container = document.getElementById('nodes-container');
    if (container) {
      var div = document.createElement('div');
      div.innerHTML = renderNode(node);
      container.appendChild(div.firstElementChild);
      bindNodeEvents(div.firstElementChild);
    }
    renderConnections();
    document.getElementById('drop-hint').classList.add('hidden');
  }

  function removeNode(nodeId) {
    nodes = nodes.filter(function (n) { return n.id !== nodeId; });
    connections = connections.filter(function (c) { return c.from !== nodeId && c.to !== nodeId; });
    var el = getNodeElement(nodeId);
    if (el) el.remove();
    renderConnections();
    if (selectedNodeId === nodeId) {
      selectedNodeId = null;
      showPropsPanel(null);
    }
  }

  function bindNodeEvents(el) {
    var nodeId = el.getAttribute('data-node-id');
    var node = nodes.find(function (n) { return n.id === nodeId; });
    if (!node) return;

    el.addEventListener('mousedown', function (e) {
      if (e.target.closest('.node-connector')) return;
      if (mode === 'connect') return;
      e.preventDefault();
      selectedNodeId = nodeId;
      showPropsPanel(node);
      document.querySelectorAll('.builder-node').forEach(function (n) { n.classList.remove('selected'); });
      el.classList.add('selected');
      if (mode === 'select') {
        dragOffset.x = (typeof e.offsetX === 'number' ? e.offsetX : node.width / 2);
        dragOffset.y = (typeof e.offsetY === 'number' ? e.offsetY : node.height / 2);
        dragStartPos.x = e.clientX;
        dragStartPos.y = e.clientY;
        isDragging = false;
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
      }
    });

    el.addEventListener('dblclick', function (e) {
      if (e.target.closest('.node-connector')) return;
      e.preventDefault();
      selectedNodeId = nodeId;
      showPropsPanel(node);
    });

    el.querySelectorAll('.node-connector').forEach(function (conn) {
      conn.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        if (mode !== 'connect') return;
        var isOutput = conn.classList.contains('node-output-connector');
        if (isOutput) {
          connectSource = nodeId;
          document.body.classList.add('connect-mode-active');
        } else {
          if (connectSource && connectSource !== nodeId) {
            addConnection(connectSource, nodeId);
            connectSource = null;
            document.body.classList.remove('connect-mode-active');
          }
        }
      });
    });

  }

  function handleDragMove(e) {
    if (mode !== 'select' || !selectedNodeId || e.buttons !== 1) return;
    var node = nodes.find(function (n) { return n.id === selectedNodeId; });
    var el = getNodeElement(selectedNodeId);
    if (!node || !el) return;
    if (!isDragging) {
      var dx = e.clientX - dragStartPos.x;
      var dy = e.clientY - dragStartPos.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      isDragging = true;
    }
    var wrap = document.getElementById('canvas-wrap');
    var rect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
    var canvasX = e.clientX - rect.left + (wrap ? wrap.scrollLeft : 0) - panX;
    var canvasY = e.clientY - rect.top + (wrap ? wrap.scrollTop : 0) - panY;
    node.x = Math.max(0, Math.round((canvasX - dragOffset.x) / GRID_SIZE) * GRID_SIZE);
    node.y = Math.max(0, Math.round((canvasY - dragOffset.y) / GRID_SIZE) * GRID_SIZE);
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    renderConnections();
  }

  function handleDragEnd() {
    isDragging = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
  }

  function addConnection(fromId, toId) {
    if (connections.some(function (c) { return c.from === fromId && c.to === toId; })) return;
    connections.push({ id: 'conn_' + (connectionIdCounter++), from: fromId, to: toId });
    var toNode = nodes.find(function (n) { return n.id === toId; });
    if (toNode && toNode.source_inputs && toNode.source_inputs.indexOf(fromId) < 0) {
      toNode.source_inputs.push(fromId);
    }
    renderConnections();
  }

  function removeConnection(fromId, toId) {
    connections = connections.filter(function (c) { return !(c.from === fromId && c.to === toId); });
    var toNode = nodes.find(function (n) { return n.id === toId; });
    if (toNode && toNode.source_inputs) {
      toNode.source_inputs = toNode.source_inputs.filter(function (s) { return s !== fromId; });
    }
    renderConnections();
  }

  function getConnectorCenter(nodeId, connectorType) {
    var node = nodes.find(function (n) { return n.id === nodeId; });
    if (!node) return { x: 0, y: 0 };
    var cx = node.x + node.width / 2;
    var cy = connectorType === 'output' ? node.y + node.height : node.y;
    return { x: cx, y: cy };
  }

  function renderConnections() {
    var svg = document.getElementById('connections-svg');
    if (!svg) return;
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    var w = 2000;
    var h = 1200;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.innerHTML = '<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#64748b" /></marker></defs>';
    connections.forEach(function (c) {
      var from = getConnectorCenter(c.from, 'output');
      var to = getConnectorCenter(c.to, 'input');
      var path = 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + 60) + ' ' + from.y + ', ' + (to.x - 60) + ' ' + to.y + ', ' + to.x + ' ' + to.y;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', path);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', '#64748b');
      line.setAttribute('stroke-width', 2);
      line.setAttribute('marker-end', 'url(#arrowhead)');
      line.setAttribute('class', 'connection-line');
      line.setAttribute('data-from', c.from);
      line.setAttribute('data-to', c.to);
      svg.appendChild(line);
    });
  }

  function showPropsPanel(node) {
    var empty = document.getElementById('props-empty');
    var form = document.getElementById('props-form');
    if (!node) {
      empty.classList.remove('hidden');
      form.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    form.classList.remove('hidden');

    document.getElementById('prop-id').value = node.id;
    document.getElementById('prop-description').value = node.description || '';
    document.getElementById('prop-type').value = node.type;
    document.getElementById('prop-source-inputs').value = (node.source_inputs || []).join(', ');
    document.getElementById('prop-output-alias').value = node.output_alias || '';
    document.getElementById('prop-format').value = node.format || 'parquet';
    document.getElementById('prop-path').value = node.path || '';
    document.getElementById('prop-dataset').value = node.dataset || '';
    document.getElementById('prop-copybook').value = node.copybook || '';
    document.getElementById('prop-write-mode').value = node.write_mode || 'overwrite';
    document.getElementById('prop-fields').value = Array.isArray(node.fields) && node.fields.length > 0
      ? JSON.stringify(node.fields, null, 2) : '';
    document.getElementById('prop-logic').value = typeof node.logic === 'object' ? JSON.stringify(node.logic, null, 2) : (node.logic || '{}');

    var isInput = node.type === 'input';
    var isOutput = node.type === 'output';
    var isIO = isInput || isOutput;
    document.getElementById('prop-type-group').style.display = isIO ? 'none' : 'block';
    document.getElementById('prop-description-group').style.display = isIO ? 'none' : 'block';
    document.getElementById('prop-source-inputs-group').style.display = isIO ? 'none' : 'block';
    document.getElementById('prop-output-alias-group').style.display = isInput ? 'none' : 'block';
    document.getElementById('prop-format-group').style.display = isIO ? 'block' : 'none';
    document.getElementById('prop-path-group').style.display = isIO ? 'block' : 'none';
    document.getElementById('prop-dataset-group').style.display = isIO ? 'block' : 'none';
    document.getElementById('prop-copybook-group').style.display = isIO ? 'block' : 'none';
    document.getElementById('prop-write-mode-group').style.display = isOutput ? 'block' : 'none';
    document.getElementById('prop-fields-group').style.display = isIO ? 'block' : 'none';
    document.getElementById('prop-logic-group').style.display = isIO ? 'none' : 'block';
  }

  function applyPropsFromForm() {
    var oldId = selectedNodeId;
    var node = nodes.find(function (n) { return n.id === oldId; });
    if (!node) return;
    var newId = document.getElementById('prop-id').value.trim() || node.id;
    node.id = newId;
    node.description = document.getElementById('prop-description').value.trim();
    node.type = document.getElementById('prop-type').value;
    var srcStr = document.getElementById('prop-source-inputs').value.trim();
    node.source_inputs = srcStr ? srcStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    node.output_alias = document.getElementById('prop-output-alias').value.trim() || node.id;
    node.format = document.getElementById('prop-format').value;
    node.path = document.getElementById('prop-path').value.trim();
    node.dataset = document.getElementById('prop-dataset').value.trim();
    node.copybook = document.getElementById('prop-copybook').value.trim();
    node.write_mode = document.getElementById('prop-write-mode').value;
    var fieldsStr = document.getElementById('prop-fields').value.trim();
    try {
      node.fields = fieldsStr ? JSON.parse(fieldsStr) : [];
    } catch (e) {
      console.warn('Invalid fields JSON, keeping existing');
    }
    try {
      node.logic = JSON.parse(document.getElementById('prop-logic').value || '{}');
    } catch (e) {
      console.warn('Invalid logic JSON, keeping existing');
    }
    node.label = (node.type === 'input' || node.type === 'output' ? node.id : node.output_alias || node.id) + ' [' + (node.type || 'step').toUpperCase() + ']';
    selectedNodeId = node.id;
    var el = getNodeElement(oldId);
    if (el) {
      el.setAttribute('data-node-id', node.id);
      var labelEl = el.querySelector('.node-label');
      if (labelEl) labelEl.textContent = node.label;
    }
    if (oldId !== node.id) {
      connections.forEach(function (c) {
        if (c.from === oldId) c.from = node.id;
        if (c.to === oldId) c.to = node.id;
      });
      nodes.forEach(function (n) {
        if (n.source_inputs) {
          var idx = n.source_inputs.indexOf(oldId);
          if (idx >= 0) n.source_inputs[idx] = node.id;
        }
      });
    }
    renderConnections();
  }

  function buildJsonConfig() {
    var inputs = {};
    var outputs = {};
    var steps = [];
    var stepOrder = topologicalSort();

    nodes.forEach(function (n) {
      if (n.type === 'input') {
        var inp = {
          name: n.id,
          format: n.format || 'parquet',
          path: n.path || 'data/input/' + n.id,
          fields: Array.isArray(n.fields) ? n.fields : []
        };
        if (n.dataset) inp.dataset = n.dataset;
        if (n.copybook) inp.copybook = n.copybook;
        inputs[n.id] = inp;
      } else if (n.type === 'output') {
        var out = {
          name: n.id,
          format: n.format || 'parquet',
          path: n.path || 'data/output/' + n.id,
          write_mode: n.write_mode || 'overwrite',
          fields: Array.isArray(n.fields) ? n.fields : []
        };
        if (n.dataset) out.dataset = n.dataset;
        if (n.copybook) out.copybook = n.copybook;
        outputs[n.id] = out;
      } else if (['select', 'filter', 'join', 'aggregate', 'union', 'custom'].indexOf(n.type) >= 0) {
        steps.push({
          id: n.id,
          description: n.description || '',
          type: n.type,
          source_inputs: n.source_inputs || [],
          logic: n.logic || {},
          output_alias: n.output_alias || n.id
        });
      }
    });

    steps.sort(function (a, b) {
      var ai = stepOrder.indexOf(a.id);
      var bi = stepOrder.indexOf(b.id);
      if (ai < 0) ai = 9999;
      if (bi < 0) bi = 9999;
      return ai - bi;
    });

    return {
      Inputs: inputs,
      Outputs: outputs,
      Transformations: {
        description: 'Dataflow built with Dataflow Builder',
        steps: steps
      }
    };
  }

  function topologicalSort() {
    var order = [];
    var visited = {};
    var stack = {};
    function visit(id) {
      if (stack[id]) return;
      if (visited[id]) return;
      stack[id] = true;
      var node = nodes.find(function (n) { return n.id === id; });
      if (node && node.source_inputs) {
        node.source_inputs.forEach(visit);
      }
      stack[id] = false;
      visited[id] = true;
      order.push(id);
    }
    nodes.forEach(function (n) { visit(n.id); });
    return order;
  }

  function setupPalette() {
    document.querySelectorAll('.palette-item').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        var type = el.getAttribute('data-type');
        e.dataTransfer.setData('application/json', JSON.stringify({ type: type }));
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  function setupCanvas() {
    var canvas = document.getElementById('canvas');
    var wrap = document.getElementById('canvas-wrap');
    if (!canvas || !wrap) return;

    wrap.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    wrap.addEventListener('mousedown', function (e) {
      if (!e.target.closest('.builder-node') && !e.target.closest('.node-connector')) {
        selectedNodeId = null;
        showPropsPanel(null);
        document.querySelectorAll('.builder-node').forEach(function (n) { n.classList.remove('selected'); });
      }
    });

    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      var data = e.dataTransfer.getData('application/json');
      if (!data) return;
      try {
        var payload = JSON.parse(data);
        var type = payload.type;
        var rect = wrap.getBoundingClientRect();
        var x = e.clientX - rect.left + wrap.scrollLeft - panX;
        var y = e.clientY - rect.top + wrap.scrollTop - panY;
        var node = createNode(type, x, y);
        addNodeToCanvas(node);
      } catch (err) {
        console.warn(err);
      }
    });

    document.addEventListener('mouseup', function () {
      if (connectSource) {
        connectSource = null;
        document.body.classList.remove('connect-mode-active');
      }
    });
  }

  function setupToolbar() {
    document.getElementById('builder-mode-select').addEventListener('click', function () {
      mode = 'select';
      document.querySelectorAll('.builder-toolbar .btn').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
    });
    document.getElementById('builder-mode-connect').addEventListener('click', function () {
      mode = 'connect';
      document.querySelectorAll('.builder-toolbar .btn').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
    });
    document.getElementById('builder-mode-select').classList.add('active');

    var canvasEl = document.getElementById('canvas');
    document.getElementById('builder-zoom-in').addEventListener('click', function () {
      zoom = Math.min(2, zoom + 0.2);
      if (canvasEl) canvasEl.style.transform = 'scale(' + zoom + ') translate(' + panX + 'px, ' + panY + 'px)';
    });
    document.getElementById('builder-zoom-out').addEventListener('click', function () {
      zoom = Math.max(0.4, zoom - 0.2);
      if (canvasEl) canvasEl.style.transform = 'scale(' + zoom + ') translate(' + panX + 'px, ' + panY + 'px)';
    });
    document.getElementById('builder-fit').addEventListener('click', function () {
      zoom = 1;
      panX = panY = 0;
      if (canvasEl) canvasEl.style.transform = 'scale(1) translate(0, 0)';
    });

    document.getElementById('builder-export-json').addEventListener('click', function () {
      var config = buildJsonConfig();
      document.getElementById('builder-json-output').textContent = JSON.stringify(config, null, 2);
      document.getElementById('builder-json-modal').classList.remove('hidden');
    });

    document.getElementById('builder-save').addEventListener('click', function () {
      var name = document.getElementById('builder-config-name').value.trim();
      if (!name) {
        builderMsg('Validation', 'Enter a config name before saving.', 'error');
        return;
      }
      if (!name.toLowerCase().endsWith('.json')) name += '.json';
      var config = buildJsonConfig();
      API.saveConfig(name, config)
        .then(function (res) {
          if (res && res.error) {
            builderMsg('Save Failed', 'Save failed: ' + res.error, 'error');
          } else {
            builderMsg('Saved', 'Configuration saved as "' + name + '".', 'success');
            document.getElementById('builder-config-name').value = name.replace(/\.json$/i, '');
          }
        })
        .catch(function (err) {
          builderMsg('Save Failed', 'Save failed: ' + (err.message || JSON.stringify(err)), 'error');
        });
    });

    document.getElementById('prop-save').addEventListener('click', function () {
      applyPropsFromForm();
    });
    document.getElementById('prop-delete').addEventListener('click', function () {
      if (selectedNodeId && confirm('Delete this node?')) {
        removeNode(selectedNodeId);
        selectedNodeId = null;
        showPropsPanel(null);
      }
    });
  }

  function setupModals() {
    function closeJsonModal() {
      document.getElementById('builder-json-modal').classList.add('hidden');
    }
    document.getElementById('builder-json-modal-close').addEventListener('click', closeJsonModal);
    document.getElementById('builder-json-modal-close-btn').addEventListener('click', closeJsonModal);
    document.getElementById('builder-json-copy').addEventListener('click', function () {
      var text = document.getElementById('builder-json-output').textContent;
      navigator.clipboard.writeText(text).then(function () { builderMsg('Copied', 'JSON copied to clipboard.', 'success'); });
    });
    document.getElementById('builder-json-download').addEventListener('click', function () {
      var text = document.getElementById('builder-json-output').textContent;
      var a = document.createElement('a');
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
      a.download = document.getElementById('builder-config-name').value.trim() || 'dataflow_config.json';
      a.click();
    });
  }

  function loadConfig(config) {
    nodes = [];
    connections = [];
    selectedNodeId = null;
    var container = document.getElementById('nodes-container');
    if (container) container.innerHTML = '';
    document.getElementById('drop-hint').classList.remove('hidden');

    var inputs = config.Inputs || {};
    var outputs = config.Outputs || {};
    var steps = (config.Transformations || {}).steps || [];
    var x = 50;
    var y = 50;

    Object.keys(inputs).forEach(function (name) {
      var data = inputs[name];
      var node = createNode('input', x, y);
      node.id = name;
      node.label = name + ' [INPUT]';
      node.format = data.format || 'parquet';
      node.path = data.path || 'data/input/' + name;
      node.dataset = data.dataset || '';
      node.copybook = data.copybook || '';
      node.fields = Array.isArray(data.fields) ? data.fields : [];
      addNodeToCanvas(node);
      y += 80;
    });
    x = 350;
    y = 50;
    steps.forEach(function (s) {
      var node = createNode(s.type || 'select', x, y);
      node.id = s.id;
      node.description = s.description || '';
      node.type = s.type || 'select';
      node.source_inputs = s.source_inputs || [];
      node.output_alias = s.output_alias || s.id;
      node.logic = s.logic || {};
      node.label = (node.output_alias || node.id) + ' [' + (node.type || 'step').toUpperCase() + ']';
      addNodeToCanvas(node);
      s.source_inputs.forEach(function (src) {
        connections.push({ id: 'conn_' + (connectionIdCounter++), from: src, to: node.id });
      });
      y += 80;
    });
    x = 600;
    y = 50;
    Object.keys(outputs).forEach(function (name) {
      var data = outputs[name];
      var node = createNode('output', x, y);
      node.id = name;
      node.label = name + ' [OUTPUT]';
      node.format = data.format || 'parquet';
      node.path = data.path || 'data/output/' + name;
      node.dataset = data.dataset || '';
      node.copybook = data.copybook || '';
      node.write_mode = data.write_mode || 'overwrite';
      node.fields = Array.isArray(data.fields) ? data.fields : [];
      addNodeToCanvas(node);
      var stepForOut = steps.find(function (s) { return (s.output_alias || '') === name; });
      if (stepForOut) {
        connections.push({ id: 'conn_' + (connectionIdCounter++), from: stepForOut.id, to: node.id });
      }
      y += 80;
    });

    renderConnections();
  }

  function loadConfigList() {
    API.configs().then(function (res) {
      var sel = document.getElementById('builder-load-select');
      if (!sel) return;
      sel.innerHTML = '<option value="">-- Start empty --</option>';
      (res.configs || []).forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.relative || c.path;
        opt.textContent = c.name || c.relative;
        sel.appendChild(opt);
      });
    }).catch(function () {});
  }

  function init() {
    setupPalette();
    setupCanvas();
    setupToolbar();
    setupModals();
    loadConfigList();

    document.getElementById('builder-load').addEventListener('click', function () {
      loadConfigList();
      document.getElementById('builder-load-modal').classList.remove('hidden');
    });

    document.getElementById('builder-load-close').addEventListener('click', function () {
      document.getElementById('builder-load-modal').classList.add('hidden');
    });
    document.getElementById('builder-load-cancel').addEventListener('click', function () {
      document.getElementById('builder-load-modal').classList.add('hidden');
    });
    document.getElementById('builder-load-apply').addEventListener('click', function () {
      var path = document.getElementById('builder-load-select').value;
      if (!path) {
        loadConfig({ Inputs: {}, Outputs: {}, Transformations: { steps: [] } });
        document.getElementById('builder-load-modal').classList.add('hidden');
        return;
      }
      API.getConfig(path).then(function (config) {
        loadConfig(config);
        document.getElementById('builder-load-modal').classList.add('hidden');
      }).catch(function (err) {
        builderMsg('Load Failed', 'Load failed: ' + (err.message || 'Unknown error'), 'error');
      });
    });

    window.addEventListener('resize', renderConnections);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
