(function () {
  var API = window.CodeParser && window.CodeParser.API;
  var $ = window.CodeParser && window.CodeParser.$;
  var escapeHtml = window.CodeParser && window.CodeParser.escapeHtml;
  var showMessagePopup = window.CodeParser && window.CodeParser.showMessagePopup;
  var showErrorPopup = window.CodeParser && window.CodeParser.showErrorPopup;
  var closeMessageModal = window.CodeParser && window.CodeParser.closeMessageModal;
  var closeErrorModal = window.CodeParser && window.CodeParser.closeErrorModal;

  if (!API || !$) { console.error('CodeParser modules not loaded'); return; }

  let currentConfig = null;
  let currentPath = null;
  let editMode = false;
  let configViewMode = 'diagram'; // 'diagram' | 'json'
  let jsonEditorDirty = false;
  let jsonEditorView = 'tree'; // always tree
  window.CodeParser.hoverPopupsEnabled = true;

  function getByPath(obj, path) {
    var p = obj;
    for (var i = 0; i < path.length; i++) {
      if (p == null) return undefined;
      var seg = path[i];
      if (typeof seg === 'string' && /^\d+$/.test(seg)) seg = parseInt(seg, 10);
      p = p[seg];
    }
    return p;
  }
  function setByPath(obj, path, value) {
    if (path.length === 0) return;
    var p = obj;
    for (var i = 0; i < path.length - 1; i++) {
      var seg = path[i];
      if (typeof seg === 'string' && /^\d+$/.test(seg)) seg = parseInt(seg, 10);
      p = p[seg];
    }
    var last = path[path.length - 1];
    if (typeof last === 'string' && /^\d+$/.test(last)) last = parseInt(last, 10);
    p[last] = value;
  }

  function escapeHtmlForJson(str) {
    if (str == null) return '';
    var s = String(str);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildJsonViewerHtml(value, indent) {
    indent = indent || 0;
    var pad = '';
    for (var i = 0; i < indent; i++) pad += '  ';
    var pad2 = pad + '  ';
    if (value === null) {
      return '<span class="json-null">null</span>';
    }
    if (typeof value === 'boolean') {
      return '<span class="json-boolean">' + (value ? 'true' : 'false') + '</span>';
    }
    if (typeof value === 'number') {
      return '<span class="json-number">' + String(value) + '</span>';
    }
    if (typeof value === 'string') {
      return '<span class="json-string">"' + escapeHtmlForJson(value) + '"</span>';
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '<span class="json-bracket">[</span><span class="json-bracket">]</span>';
      var parts = ['<span class="json-line"><span class="json-fold-toggle json-fold-open" role="button" tabindex="0" aria-label="Collapse">−</span><span class="json-fold-toggle json-fold-closed" role="button" tabindex="0" aria-label="Expand">+</span> <span class="json-bracket">[</span></span>'];
      parts.push('<div class="json-block" data-type="array"><div class="json-block-inner">');
      for (var a = 0; a < value.length; a++) {
        parts.push('<span class="json-line">' + pad2);
        parts.push(buildJsonViewerHtml(value[a], indent + 1));
        if (a < value.length - 1) parts.push('<span class="json-punctuation">,</span>');
        parts.push('</span>');
      }
      parts.push('</div></div>');
      parts.push('<span class="json-line">' + pad + '<span class="json-bracket">]</span></span>');
      return parts.join('');
    }
    if (typeof value === 'object') {
      var keys = Object.keys(value);
      if (keys.length === 0) return '<span class="json-bracket">{</span><span class="json-bracket">}</span>';
      var out = ['<span class="json-line"><span class="json-fold-toggle json-fold-open" role="button" tabindex="0" aria-label="Collapse">−</span><span class="json-fold-toggle json-fold-closed" role="button" tabindex="0" aria-label="Expand">+</span> <span class="json-bracket">{</span></span>'];
      out.push('<div class="json-block" data-type="object"><div class="json-block-inner">');
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = value[key];
        out.push('<span class="json-line">' + pad2 + '<span class="json-key">"' + escapeHtmlForJson(key) + '"</span><span class="json-punctuation">: </span>');
        if (val !== null && typeof val === 'object' && (Array.isArray(val) || Object.keys(val).length > 0)) {
          out.push(buildJsonViewerHtml(val, indent + 1));
        } else {
          out.push(buildJsonViewerHtml(val, indent + 1));
        }
        if (k < keys.length - 1) out.push('<span class="json-punctuation">,</span>');
        out.push('</span>');
      }
      out.push('</div></div>');
      out.push('<span class="json-line">' + pad + '<span class="json-bracket">}</span></span>');
      return out.join('');
    }
    return '';
  }

  function renderJsonViewer() {
    var viewerEl = document.getElementById('json-viewer');
    if (!viewerEl) return;
    if (!currentConfig) {
      viewerEl.innerHTML = '<span class="json-null">null</span>';
      return;
    }
    try {
      viewerEl.innerHTML = buildJsonViewerHtml(currentConfig, 0);
    } catch (e) {
      viewerEl.innerHTML = '<span class="json-null">Invalid config</span>';
    }
    viewerEl.querySelectorAll('.json-fold-toggle').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var line = el.closest('.json-line');
        var block = line && line.nextElementSibling;
        if (block && block.classList.contains('json-block')) {
          block.classList.toggle('collapsed');
          if (line) line.classList.toggle('is-collapsed', block.classList.contains('collapsed'));
        }
      });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    });
    // Default: collapse root-level sections (Inputs, Outputs, Transformations) for readable first view
    var rootBlock = viewerEl.querySelector(':scope > .json-block');
    var rootInner = rootBlock && rootBlock.querySelector(':scope > .json-block-inner');
    if (rootInner) {
      rootInner.querySelectorAll(':scope > .json-block').forEach(function (block) {
        block.classList.add('collapsed');
        var prev = block.previousElementSibling;
        if (prev && prev.classList.contains('json-line')) prev.classList.add('is-collapsed');
      });
    }
  }

  var jsonTreeIndent = 8;
  var jsonTreeFontSize = 12;
  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function highlightSearch(escapedHtml, searchTerm) {
    if (!searchTerm || !escapedHtml) return escapedHtml;
    var term = escapeHtmlForJson(searchTerm);
    if (!term) return escapedHtml;
    try {
      var re = new RegExp(escapeRegex(term), 'gi');
      return escapedHtml.replace(re, '<span class="json-tree-search-highlight">$&</span>');
    } catch (e) { return escapedHtml; }
  }
  function buildJsonTreeHtml(value, key, depth, path, searchTerm) {
    path = path || [];
    depth = depth || 0;
    searchTerm = searchTerm || '';
    var keyLabel = key !== undefined && key !== null ? escapeHtmlForJson(String(key)) : '';
    keyLabel = highlightSearch(keyLabel, searchTerm);
    var keyHtml = keyLabel ? '<span class="json-tree-key">' + keyLabel + '</span>' : '';
    var pathAttr = path.length ? ' data-path="' + escapeHtmlForJson(JSON.stringify(path)) + '"' : '';
    var indent = depth * jsonTreeIndent;
    if (value === null) {
      var nullVal = highlightSearch('null', searchTerm);
      return '<div class="json-tree-node json-tree-leaf" style="padding-left:' + indent + 'px">' +
        keyHtml + (keyLabel ? '<span class="json-tree-colon">: </span>' : '') +
        '<span class="json-tree-value json-null" data-type="null"' + pathAttr + '>' + nullVal + '</span></div>';
    }
    if (typeof value === 'boolean') {
      var boolVal = highlightSearch(value ? 'true' : 'false', searchTerm);
      return '<div class="json-tree-node json-tree-leaf" style="padding-left:' + indent + 'px">' +
        keyHtml + (keyLabel ? '<span class="json-tree-colon">: </span>' : '') +
        '<span class="json-tree-value json-boolean" data-type="boolean"' + pathAttr + '>' + boolVal + '</span></div>';
    }
    if (typeof value === 'number') {
      var numVal = highlightSearch(String(value), searchTerm);
      return '<div class="json-tree-node json-tree-leaf" style="padding-left:' + indent + 'px">' +
        keyHtml + (keyLabel ? '<span class="json-tree-colon">: </span>' : '') +
        '<span class="json-tree-value json-number" data-type="number"' + pathAttr + '>' + numVal + '</span></div>';
    }
    if (typeof value === 'string') {
      var strVal = highlightSearch(escapeHtmlForJson(value), searchTerm);
      return '<div class="json-tree-node json-tree-leaf" style="padding-left:' + indent + 'px">' +
        keyHtml + (keyLabel ? '<span class="json-tree-colon">: </span>' : '') +
        '<span class="json-tree-value json-string" data-type="string"' + pathAttr + '>"' + strVal + '"</span></div>';
    }
    if (Array.isArray(value)) {
      var n = value.length;
      var childrenHtml = value.map(function (item, i) {
        return buildJsonTreeHtml(item, i, depth + 1, path.concat(i), searchTerm);
      }).join('');
      return '<div class="json-tree-node json-tree-branch" data-type="array" style="padding-left:' + indent + 'px">' +
        '<div class="json-tree-row" role="button" tabindex="0">' +
        '<span class="json-tree-toggle json-tree-expanded" aria-label="Collapse"><i class="fa-solid fa-chevron-down"></i></span>' +
        '<span class="json-tree-toggle json-tree-collapsed" aria-label="Expand"><i class="fa-solid fa-chevron-right"></i></span>' +
        (keyLabel ? keyHtml + '<span class="json-tree-colon">: </span>' : '') +
        '<span class="json-tree-bracket">[</span><span class="json-tree-bracket">]</span>' +
        '</div><div class="json-tree-children">' + childrenHtml + '</div></div>';
    }
    if (typeof value === 'object') {
      var keys = Object.keys(value);
      var childrenHtml = keys.map(function (k) {
        return buildJsonTreeHtml(value[k], k, depth + 1, path.concat(k), searchTerm);
      }).join('');
      return '<div class="json-tree-node json-tree-branch" data-type="object" style="padding-left:' + indent + 'px">' +
        '<div class="json-tree-row" role="button" tabindex="0">' +
        '<span class="json-tree-toggle json-tree-expanded" aria-label="Collapse"><i class="fa-solid fa-chevron-down"></i></span>' +
        '<span class="json-tree-toggle json-tree-collapsed" aria-label="Expand"><i class="fa-solid fa-chevron-right"></i></span>' +
        (keyLabel ? keyHtml + '<span class="json-tree-colon">: </span>' : '') +
        '<span class="json-tree-bracket">{</span><span class="json-tree-bracket">}</span>' +
        '</div><div class="json-tree-children">' + childrenHtml + '</div></div>';
    }
    return '';
  }

  function parseTreeValue(raw, type) {
    var s = (raw == null ? '' : String(raw)).trim();
    if (type === 'number') {
      var num = Number(s);
      if (s !== '' && !isNaN(num)) return num;
      return 0;
    }
    if (type === 'boolean') {
      if (s === 'true') return true;
      if (s === 'false') return false;
      return Boolean(s);
    }
    if (type === 'null') return null;
    return s;
  }

  function startTreeValueEdit(span) {
    var pathStr = span.getAttribute('data-path');
    var type = span.getAttribute('data-type') || 'string';
    if (!pathStr || !currentConfig) return;
    var path = JSON.parse(pathStr);
    var current = getByPath(currentConfig, path);
    var displayVal = type === 'string' ? (typeof current === 'string' ? current : '') : String(current);
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'json-tree-edit-input';
    input.value = displayVal;
    input.setAttribute('data-path', pathStr);
    input.setAttribute('data-type', type);
    span.style.display = 'none';
    span.parentNode.appendChild(input);
    input.focus();
    input.select();
    function finish() {
      var val = parseTreeValue(input.value, type);
      setByPath(currentConfig, path, val);
      input.remove();
      span.style.display = '';
      renderJsonTreeView();
      setJsonEditorDirty(true);
      var applyBtn = document.getElementById('json-editor-apply-btn');
      if (applyBtn) applyBtn.classList.remove('hidden');
    }
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        input.value = displayVal;
        input.remove();
        span.style.display = '';
      }
    });
  }

  function getJsonTreeSearchTerm() {
    var input = document.getElementById('json-editor-search-input');
    return input && input.value ? input.value.trim() : '';
  }
  function renderJsonTreeView() {
    var treeEl = document.getElementById('json-tree-view');
    if (!treeEl) return;
    if (!currentConfig) {
      treeEl.innerHTML = '<span class="json-null">null</span>';
      return;
    }
    var searchTerm = getJsonTreeSearchTerm();
    try {
      treeEl.innerHTML = buildJsonTreeHtml(currentConfig, null, 0, [], searchTerm);
    } catch (e) {
      treeEl.innerHTML = '<span class="json-null">Invalid config</span>';
    }
    if (jsonTreeFontSize) treeEl.style.fontSize = jsonTreeFontSize + 'px';
    treeEl.querySelectorAll('.json-tree-row').forEach(function (row) {
      var node = row.closest('.json-tree-node');
      if (!node || !node.classList.contains('json-tree-branch')) return;
      row.addEventListener('click', function (e) {
        if (e.target.closest('.json-tree-value')) return;
        e.preventDefault();
        e.stopPropagation();
        node.classList.toggle('collapsed');
      });
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
    });
    treeEl.querySelectorAll('.json-tree-value[data-path]').forEach(function (span) {
      span.classList.add('json-tree-value-editable');
      span.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startTreeValueEdit(span);
      });
    });
    var root = treeEl.querySelector('.json-tree-node.json-tree-branch');
    if (root) {
      root.querySelectorAll(':scope > .json-tree-children > .json-tree-node.json-tree-branch').forEach(function (child) {
        child.classList.add('collapsed');
      });
    }
  }

  function setJsonEditorView(view) {
    jsonEditorView = view;
    var textTab = document.getElementById('json-editor-tab-text');
    var treeTab = document.getElementById('json-editor-tab-tree');
    var textEl = document.getElementById('json-editor-text');
    var treeEl = document.getElementById('json-tree-view');
    if (textTab) { textTab.classList.toggle('active', view === 'text'); textTab.setAttribute('aria-selected', view === 'text'); }
    if (treeTab) { treeTab.classList.toggle('active', view === 'tree'); treeTab.setAttribute('aria-selected', view === 'tree'); }
    if (textEl) textEl.classList.toggle('hidden', view !== 'text');
    if (treeEl) {
      treeEl.classList.toggle('hidden', view !== 'tree');
      if (view === 'tree') renderJsonTreeView();
    }
  }

  function updateJsonEditorMode() {
    var treeEl = document.getElementById('json-tree-view');
    var applyBtn = document.getElementById('json-editor-apply-btn');
    if (treeEl) {
      treeEl.classList.remove('hidden');
      renderJsonTreeView();
    }
    if (applyBtn) applyBtn.classList.toggle('hidden', !jsonEditorDirty);
  }

  function getConfigJsonString() {
    if (!currentConfig) return '';
    try { return JSON.stringify(currentConfig, null, 2); } catch (e) { return ''; }
  }

  function setJsonEditorDirty(dirty) {
    jsonEditorDirty = dirty;
    var applyBtn = document.getElementById('json-editor-apply-btn');
    if (applyBtn) applyBtn.classList.toggle('hidden', !dirty);
  }

  const configList = $('config-list');
  const searchInput = $('search-input');
  const searchResults = $('search-results');
  const diagramContainer = $('diagram-container');
  const emptyState = $('empty-state');
  const currentFileEl = $('current-file');
  const detailDrawer = $('detail-drawer');
  const logicModalTitle = $('logic-modal-title');
  const logicModalClose = $('logic-modal-close');
  const detailDrawerBackdrop = $('detail-drawer-backdrop');
  const stepEditPanel = $('step-edit-panel');
  const stepEditPanelClose = $('step-edit-panel-close');
  const stepEditPanelBackdrop = $('step-edit-panel-backdrop');
  const editSave = $('edit-save');
  const editDelete = $('edit-delete');
  const renameModal = $('rename-modal');
  const renameInput = $('rename-input');
  const renameCancel = $('rename-cancel');
  const renameSubmit = $('rename-submit');
  const renameModalClose = $('rename-modal-close');
  const deleteModal = $('delete-modal');
  const deleteMessage = $('delete-message');
  const deleteCancel = $('delete-cancel');
  const deleteConfirm = $('delete-confirm');
  const deleteModalClose = $('delete-modal-close');
  const errorModal = $('error-modal');
  const errorModalTitle = $('error-modal-title');
  const errorModalMessage = $('error-modal-message');
  const errorModalDetails = $('error-modal-details');
  const messageModal = $('message-modal');
  const messageModalTitle = $('message-modal-title');
  const messageModalBody = $('message-modal-body');
  const messageModalHeader = $('message-modal-header');
  let renameDeleteTargetPath = null;

  window.CodeParser.nodeClickHandler = function (nodeId, info) {
    if (editMode && info.type === 'step') {
      openEditStep(info);
    } else {
      (window.CodeParser.showLogicPopup)(nodeId, info);
    }
  };

  function initNetwork(container, config) {
    window.CodeParser.hoverPopupsEnabled = window.CodeParser.hoverPopupsEnabled !== false;
    window.CodeParser.initNetwork(container, config);
    syncDiagramToolbarState();
  }

  function openEditStep(info) {
    const s = info.data;
    $('edit-id').value = s.id || '';
    $('edit-description').value = s.description || '';
    $('edit-type').value = s.type || 'select';
    $('edit-logic').value = JSON.stringify(s.logic || {}, null, 2);
    $('edit-source-inputs').value = Array.isArray(s.source_inputs) ? s.source_inputs.join(', ') : '';
    $('edit-output-alias').value = s.output_alias || '';
    if (stepEditPanel) {
      stepEditPanel.dataset.stepIndex = String(info.index);
      stepEditPanel.classList.add('open');
    }
  }

  function closeStepEditPanel() {
    if (stepEditPanel) stepEditPanel.classList.remove('open');
  }

  function closeModals() {
    if (detailDrawer) detailDrawer.classList.remove('open');
    closeStepEditPanel();
  }

  if (logicModalClose) logicModalClose.addEventListener('click', closeModals);
  if (detailDrawerBackdrop) detailDrawerBackdrop.addEventListener('click', closeModals);
  if (stepEditPanelClose) stepEditPanelClose.addEventListener('click', closeStepEditPanel);
  if (stepEditPanelBackdrop) stepEditPanelBackdrop.addEventListener('click', closeStepEditPanel);

  var logicToggleVisual = $('logic-toggle-visual');
  var logicToggleKv = $('logic-toggle-kv');
  var logicToggleJson = $('logic-toggle-json');
  if (logicToggleVisual) logicToggleVisual.addEventListener('click', function () { (window.CodeParser.setLogicViewMode)('visual'); });
  if (logicToggleKv) logicToggleKv.addEventListener('click', function () { (window.CodeParser.setLogicViewMode)('kv'); });
  if (logicToggleJson) logicToggleJson.addEventListener('click', function () { (window.CodeParser.setLogicViewMode)('json'); });

  editSave.addEventListener('click', () => {
    const stepIndex = parseInt(stepEditPanel && stepEditPanel.dataset.stepIndex, 10);
    if (isNaN(stepIndex) || !currentConfig) return;
    const steps = (currentConfig.Transformations || currentConfig.transformations || {}).steps || [];
    if (!steps[stepIndex]) return;
    let logic = {};
    try {
      logic = JSON.parse($('edit-logic').value);
    } catch (e) {
      showMessagePopup('Invalid Logic', 'The Logic field must be valid JSON.', 'error');
      return;
    }
    const srcInput = $('edit-source-inputs').value || '';
    const source_inputs = srcInput.split(',').map(x => x.trim()).filter(Boolean);
    steps[stepIndex] = {
      id: $('edit-id').value || steps[stepIndex].id,
      description: $('edit-description').value,
      type: $('edit-type').value,
      source_inputs,
      logic,
      output_alias: $('edit-output-alias').value
    };
    currentConfig.Transformations = currentConfig.Transformations || {};
    currentConfig.Transformations.steps = steps;
    closeStepEditPanel();
    initNetwork($('network'), currentConfig);
    if (currentPath) {
      API.saveConfig(currentPath, currentConfig).then(function (res) {
        if (res.error) showMessagePopup('Save failed', res.error, 'error');
        else showMessagePopup('Saved', 'Configuration saved.', 'success');
      }).catch(function (err) { showMessagePopup('Save failed', err.message || String(err), 'error'); });
    }
  });

  editDelete.addEventListener('click', () => {
    const stepIndex = parseInt(stepEditPanel && stepEditPanel.dataset.stepIndex, 10);
    if (isNaN(stepIndex) || !currentConfig) return;
    const steps = (currentConfig.Transformations || currentConfig.transformations || {}).steps || [];
    steps.splice(stepIndex, 1);
    currentConfig.Transformations = currentConfig.Transformations || {};
    currentConfig.Transformations.steps = steps;
    closeStepEditPanel();
    initNetwork($('network'), currentConfig);
    if (currentPath) {
      API.saveConfig(currentPath, currentConfig).then(function (res) {
        if (res.error) showMessagePopup('Save failed', res.error, 'error');
        else showMessagePopup('Saved', 'Configuration saved.', 'success');
      }).catch(function (err) { showMessagePopup('Save failed', err.message || String(err), 'error'); });
    }
  });

  function applyConfigInView(path, config) {
    if (!config || config.error) return;
    currentConfig = config;
    currentPath = path;
    editMode = false;
    if (currentFileEl) currentFileEl.textContent = path || '';
    if (emptyState) emptyState.classList.add('hidden');
    if (diagramContainer) diagramContainer.classList.add('visible');
    if ($('btn-download-json')) $('btn-download-json').style.display = 'inline-block';
    var diagramEditBtn = document.getElementById('diagram-edit-btn');
    if (diagramEditBtn) diagramEditBtn.classList.remove('active');
    if (configViewMode === 'json' && typeof syncJsonEditorFromConfig === 'function') syncJsonEditorFromConfig();
    if ($('btn-test')) $('btn-test').style.display = 'inline-block';
    if ($('btn-rename')) $('btn-rename').style.display = 'inline-block';
    if ($('btn-delete')) $('btn-delete').style.display = 'inline-block';
    var container = $('network');
    if (container) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            initNetwork(container, config);
          } catch (e) {
            console.error(e);
            (window.CodeParser.showErrorPopup || showErrorPopup)('Diagram error', e.message || String(e), e.stack || '');
          }
        });
      });
    }
  }

  function loadConfig(path) {
    API.getConfig(path).then(config => {
      if (config && config.error) {
        showErrorPopup('Error loading configuration', config.error, config.details != null ? String(config.details) : '');
        return;
      }
      applyConfigInView(path, config);
      // Load persisted test data (input/expected_output) so it survives refresh/restart
      API.getConfigTestData(path).then(function (data) {
        uploadedTestData[path] = {
          input_data: data.input_data || {},
          expected_output: data.expected_output || {}
        };
      }).catch(function () {
        uploadedTestData[path] = { input_data: {}, expected_output: {} };
      });
    }).catch(err => {
      console.error(err);
      const msg = err.message || String(err);
      const details = err.stack || (err.body && JSON.stringify(err.body, null, 2)) || '';
      showErrorPopup('Failed to load config', msg, details);
    });
  }

  function refreshConfigList() {
    API.configs().then(data => renderConfigList(data.configs || [])).catch(() => renderConfigList([]));
  }
  window.refreshConfigList = refreshConfigList;

  /* ── Expose JSON-tree helpers for Studio overlay ── */
  window.buildJsonTreeHtml = buildJsonTreeHtml;
  window.parseTreeValue    = parseTreeValue;
  window.getByPath         = getByPath;
  window.setByPath         = setByPath;
  window.escapeHtmlForJson = escapeHtmlForJson;

  function renderConfigList(configs) {
    configList.innerHTML = '';
    (configs || []).forEach(c => {
      const path = c.path || c.name;
      const li = document.createElement('li');
      li.dataset.path = path;
      li.className = 'config-list-item';
      const label = document.createElement('span');
      label.className = 'config-list-label';
      label.textContent = path;
      li.appendChild(label);

      li.addEventListener('click', () => {
        document.querySelectorAll('.config-list li').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        loadConfig(path);
      });

      configList.appendChild(li);
    });
  }

  function closeRenameModal() {
    renameModal.classList.remove('visible');
    renameDeleteTargetPath = null;
  }
  function closeDeleteModal() {
    deleteModal.classList.remove('visible');
    renameDeleteTargetPath = null;
  }

  if (renameModalClose) renameModalClose.addEventListener('click', closeRenameModal);
  if (renameCancel) renameCancel.addEventListener('click', closeRenameModal);
  if (renameSubmit) renameSubmit.addEventListener('click', () => {
    const path = renameDeleteTargetPath;
    const raw = renameInput.value.trim();
    if (!raw || !path) { closeRenameModal(); return; }
    const name = raw.replace(/\.json$/i, '') + '.json';
    API.renameConfig(path, name).then(res => {
      if (res.error) showMessagePopup('Rename failed', res.error, 'error');
      else {
        closeRenameModal();
        refreshConfigList();
        if (currentPath === path) {
          currentPath = res.path;
          currentFileEl.textContent = res.path;
          loadConfig(res.path);
        }
        showMessagePopup('Success', 'Configuration renamed to <strong>' + escapeHtml(name) + '</strong>.', 'success', true);
      }
    }).catch(() => showMessagePopup('Rename failed', 'Could not rename configuration.', 'error'));
  });
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameSubmit.click();
    if (e.key === 'Escape') closeRenameModal();
  });

  if (deleteModalClose) deleteModalClose.addEventListener('click', closeDeleteModal);
  if (deleteCancel) deleteCancel.addEventListener('click', closeDeleteModal);
  if (deleteConfirm) deleteConfirm.addEventListener('click', () => {
    const path = renameDeleteTargetPath;
    if (!path) { closeDeleteModal(); return; }
    API.deleteConfig(path).then(res => {
      if (res.error) showMessagePopup('Delete failed', res.error, 'error');
      else {
        closeDeleteModal();
        if (currentPath === path) {
          currentPath = null;
          currentConfig = null;
          currentFileEl.textContent = 'Select a configuration';
          diagramContainer.classList.remove('visible');
          emptyState.classList.remove('hidden');
          if ($('btn-download-json')) $('btn-download-json').style.display = 'none';
          if ($('btn-test')) $('btn-test').style.display = 'none';
          if ($('btn-rename')) $('btn-rename').style.display = 'none';
          if ($('btn-delete')) $('btn-delete').style.display = 'none';
        }
        refreshConfigList();
        showMessagePopup('Success', 'Configuration <strong>' + escapeHtml(path) + '</strong> has been deleted.', 'success', true);
      }
    }).catch(() => showMessagePopup('Delete failed', 'Could not delete configuration.', 'error'));
  });

  renameModal.addEventListener('click', (e) => { if (e.target === renameModal) closeRenameModal(); });
  deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) closeDeleteModal(); });

  if (errorModal) {
    const errClose = $('error-modal-close');
    const errCloseBtn = $('error-modal-close-btn');
    if (errClose) errClose.addEventListener('click', closeErrorModal);
    if (errCloseBtn) errCloseBtn.addEventListener('click', closeErrorModal);
    errorModal.addEventListener('click', (e) => { if (e.target === errorModal) closeErrorModal(); });
  }
  if (messageModal) {
    const msgClose = $('message-modal-close');
    const msgCloseBtn = $('message-modal-close-btn');
    if (msgClose) msgClose.addEventListener('click', closeMessageModal);
    if (msgCloseBtn) msgCloseBtn.addEventListener('click', closeMessageModal);
    messageModal.addEventListener('click', (e) => { if (e.target === messageModal) closeMessageModal(); });
  }

  (function () {
    var layout = $('layout');
    var toggleBtn = $('sidebar-toggle');
    var toggleIcon = $('sidebar-toggle-icon');
    var collapsedKey = 'config-engine-sidebar-collapsed';
    if (layout && toggleBtn) {
      if (localStorage.getItem(collapsedKey) === '1') layout.classList.add('sidebar-collapsed');
      if (toggleIcon) toggleIcon.className = layout.classList.contains('sidebar-collapsed') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-bars';
      toggleBtn.addEventListener('click', function () {
        layout.classList.toggle('sidebar-collapsed');
        if (toggleIcon) toggleIcon.className = layout.classList.contains('sidebar-collapsed') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-bars';
        localStorage.setItem(collapsedKey, layout.classList.contains('sidebar-collapsed') ? '1' : '0');
      });
    }
  })();

  (function () {
    var layout = $('layout');
    var importPage = $('import-page');
    var testPage = $('test-page');
    var settingsPage = $('settings-page');
    var navConfig = $('nav-configurations');
    var navImport = $('nav-import');
    var navSettings = $('nav-settings');
    var pageKey = 'config-engine-page';
    function setNavActive(which) {
      [navConfig, navImport, navSettings].forEach(function (n) {
        if (n) {
          n.classList.toggle('active', n === which);
          n.setAttribute('aria-current', n === which ? 'page' : null);
        }
      });
    }
    function showConfigurations() {
      if (layout) layout.classList.remove('hidden');
      if (importPage) importPage.classList.add('hidden');
      if (testPage) testPage.classList.add('hidden');
      if (settingsPage) settingsPage.classList.add('hidden');
      setNavActive(navConfig);
      localStorage.setItem(pageKey, 'configurations');
    }
    function showTest() {
      if (layout) layout.classList.add('hidden');
      if (importPage) importPage.classList.add('hidden');
      if (testPage) testPage.classList.remove('hidden');
      if (settingsPage) settingsPage.classList.add('hidden');
      setNavActive(null);
      localStorage.setItem(pageKey, 'test');
      if (typeof loadTestSampleData === 'function') loadTestSampleData();
    }
    function showImport() {
      if (layout) layout.classList.add('hidden');
      if (importPage) importPage.classList.remove('hidden');
      if (testPage) testPage.classList.add('hidden');
      if (settingsPage) settingsPage.classList.add('hidden');
      setNavActive(navImport);
      localStorage.setItem(pageKey, 'import');
      updateImportParsingMode();
    }
    function updateImportParsingMode() {
      var el = $('import-parsing-mode');
      var api = window.CodeParser && window.CodeParser.API;
      if (!api || !api.getSettings) {
        if (el) el.textContent = '';
        return;
      }
      api.getSettings().then(function (data) {
        if (data.error) {
          if (el) el.textContent = '';
          return;
        }
        if (el) {
          el.textContent = data.use_llm
            ? 'Config will be generated using the LLM (as set in Settings).'
            : 'Config will be generated using the simple Python parser (as set in Settings).';
        }
      }).catch(function () {
        if (el) el.textContent = '';
      });
    }
    function showSettings() {
      if (layout) layout.classList.add('hidden');
      if (importPage) importPage.classList.add('hidden');
      if (testPage) testPage.classList.add('hidden');
      if (settingsPage) settingsPage.classList.remove('hidden');
      setNavActive(navSettings);
      localStorage.setItem(pageKey, 'settings');
      loadSettingsIntoForm();
    }
    function updateLlmPanelVisibility() {
      var useLlm = $('settings-use-llm');
      var panel = $('settings-llm-panel');
      if (panel) panel.classList.toggle('hidden', !(useLlm && useLlm.checked));
    }
    function loadSettingsIntoForm() {
      var api = window.CodeParser && window.CodeParser.API;
      if (!api || !api.getSettings) return;
      api.getSettings().then(function (data) {
        if (data.error) return;
        var useLlm = $('settings-use-llm');
        var pathPrefix = $('settings-input-output-path-prefix');
        var inputPrefix = $('settings-input-dataset-prefix');
        var outputPrefix = $('settings-output-dataset-prefix');
        var llmBase = $('settings-llm-base-url');
        var llmModel = $('settings-llm-model');
        var llmTimeout = $('settings-llm-timeout');
        var configDir = $('settings-config-dir');
        var validationBucketPrefix = $('settings-validation-bucket-prefix');
        var errorBucketPrefix = $('settings-error-bucket-prefix');
        var rawBucketPrefix = $('settings-raw-bucket-prefix');
        if (useLlm) useLlm.checked = !!data.use_llm;
        if (pathPrefix) pathPrefix.value = data.input_output_path_prefix || '';
        if (inputPrefix) inputPrefix.value = data.input_dataset_prefix || '';
        if (outputPrefix) outputPrefix.value = data.output_dataset_prefix || '';
        if (llmBase) llmBase.value = data.llm_base_url || '';
        if (llmModel) llmModel.value = data.llm_model || '';
        if (llmTimeout) llmTimeout.value = data.llm_timeout_seconds != null ? data.llm_timeout_seconds : 600;
        if (configDir) configDir.value = data.config_dir || '';
        if (validationBucketPrefix) validationBucketPrefix.value = data.validation_bucket_prefix || '';
        if (errorBucketPrefix) errorBucketPrefix.value = data.error_bucket_prefix || '';
        if (rawBucketPrefix) rawBucketPrefix.value = data.raw_bucket_prefix || '';
        updateLlmPanelVisibility();
      }).catch(function () {});
    }
    function saveSettingsFromForm(e) {
      if (e) e.preventDefault();
      var useLlm = $('settings-use-llm');
      var pathPrefix = $('settings-input-output-path-prefix');
      var inputPrefix = $('settings-input-dataset-prefix');
      var outputPrefix = $('settings-output-dataset-prefix');
      var llmBase = $('settings-llm-base-url');
      var llmModel = $('settings-llm-model');
      var llmTimeout = $('settings-llm-timeout');
      var configDir = $('settings-config-dir');
      var validationBucketPrefix = $('settings-validation-bucket-prefix');
      var errorBucketPrefix = $('settings-error-bucket-prefix');
      var rawBucketPrefix = $('settings-raw-bucket-prefix');
      var msg = $('settings-message');
      var api = window.CodeParser && window.CodeParser.API;
      if (!api || !api.saveSettings) return;
      var timeoutVal = (llmTimeout && llmTimeout.value) ? parseInt(llmTimeout.value, 10) : 600;
      if (isNaN(timeoutVal) || timeoutVal < 60) timeoutVal = 600;
      if (timeoutVal > 3600) timeoutVal = 3600;
      var payload = {
        use_llm: !!(useLlm && useLlm.checked),
        input_output_path_prefix: (pathPrefix && pathPrefix.value) ? pathPrefix.value.trim() : '',
        input_dataset_prefix: (inputPrefix && inputPrefix.value) ? inputPrefix.value.trim() : '',
        output_dataset_prefix: (outputPrefix && outputPrefix.value) ? outputPrefix.value.trim() : '',
        llm_base_url: (llmBase && llmBase.value) ? llmBase.value.trim() : '',
        llm_model: (llmModel && llmModel.value) ? llmModel.value.trim() : '',
        llm_timeout_seconds: timeoutVal,
        config_dir: (configDir && configDir.value) ? configDir.value.trim() : '',
        validation_bucket_prefix: (validationBucketPrefix && validationBucketPrefix.value) ? validationBucketPrefix.value.trim() : '',
        error_bucket_prefix: (errorBucketPrefix && errorBucketPrefix.value) ? errorBucketPrefix.value.trim() : '',
        raw_bucket_prefix: (rawBucketPrefix && rawBucketPrefix.value) ? rawBucketPrefix.value.trim() : ''
      };
      if (msg) msg.textContent = 'Saving...';
      api.saveSettings(payload).then(function (res) {
        if (msg) msg.textContent = res.error ? res.error : 'Settings saved.';
        if (msg) msg.className = 'import-message' + (res.error ? ' error' : ' success');
      }).catch(function () {
        if (msg) { msg.textContent = 'Failed to save.'; msg.className = 'import-message error'; }
      });
    }
    function backToConfigAndSelect() {
      showConfigurations();
      if (currentPath && configList) {
        configList.querySelectorAll('li').forEach(function (el) {
          el.classList.toggle('active', el.dataset.path === currentPath);
        });
      }
    }
    if (navConfig) navConfig.addEventListener('click', function (e) { e.preventDefault(); showConfigurations(); });
    if (navImport) navImport.addEventListener('click', function (e) { e.preventDefault(); showImport(); });
    if (navSettings) navSettings.addEventListener('click', function (e) { e.preventDefault(); showSettings(); });
    var settingsForm = $('settings-form');
    if (settingsForm) settingsForm.addEventListener('submit', saveSettingsFromForm);
    var useLlmCheck = $('settings-use-llm');
    if (useLlmCheck) useLlmCheck.addEventListener('change', updateLlmPanelVisibility);
    var importLinkSettings = $('import-link-settings');
    if (importLinkSettings) importLinkSettings.addEventListener('click', function (e) { e.preventDefault(); showSettings(); });
    var btnTest = $('btn-test');
    if (btnTest) btnTest.addEventListener('click', function (e) { e.preventDefault(); showTest(); });
    var testPageBackBtn = $('test-page-back-btn');
    if (testPageBackBtn) testPageBackBtn.addEventListener('click', function (e) { e.preventDefault(); backToConfigAndSelect(); });
    showConfigurations();
    window.showConfigurationsView = showConfigurations;
    window.showTestPage = showTest;
    window.backToConfigAndSelect = backToConfigAndSelect;
  })();

  (function () {
    var tabs = document.querySelectorAll('.import-tab');
    var panels = document.querySelectorAll('.import-panel');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-tab');
        tabs.forEach(function (t) {
          t.classList.toggle('active', t.getAttribute('data-tab') === id);
          t.setAttribute('aria-selected', t.getAttribute('data-tab') === id ? 'true' : 'false');
        });
        panels.forEach(function (p) {
          var panelId = p.id ? p.id.replace('import-panel-', '') : '';
          var match = p.id === 'import-panel-' + id;
          p.classList.toggle('active', match);
          p.classList.toggle('hidden', !match);
        });
      });
    });
  })();

  function switchTestTab(tabId) {
    var testTabs = document.querySelectorAll('#test-page .test-tab');
    var testPanels = document.querySelectorAll('#test-page .test-panel');
    testTabs.forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
      t.setAttribute('aria-selected', t.getAttribute('data-tab') === tabId ? 'true' : 'false');
    });
    testPanels.forEach(function (p) {
      var match = p.id === 'test-panel-' + tabId;
      p.classList.toggle('active', match);
      p.classList.toggle('hidden', !match);
    });
    if (tabId === 'reconciliation' && typeof renderReconciliation === 'function') renderReconciliation();
  }

  (function testPageTabs() {
    var testTabs = document.querySelectorAll('#test-page .test-tab');
    var testPanels = document.querySelectorAll('#test-page .test-panel');
    testTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchTestTab(tab.getAttribute('data-tab'));
      });
    });
  })();

  function configNameToPath(name) {
    if (!name || !String(name).trim()) return null;
    var n = String(name).trim().replace(/\.json$/i, '') + '.json';
    return n;
  }

  function getConfigCounts(config) {
    if (!config || typeof config !== 'object') return { inputs: 0, outputs: 0, transformations: 0 };
    var inputs = config.Inputs || config.inputs || {};
    var outputs = config.Outputs || config.outputs || {};
    var trans = config.Transformations || config.transformations || {};
    var steps = Array.isArray(trans.steps) ? trans.steps.length : 0;
    return {
      inputs: typeof inputs === 'object' ? Object.keys(inputs).length : 0,
      outputs: typeof outputs === 'object' ? Object.keys(outputs).length : 0,
      transformations: steps
    };
  }

  function formatCounts(counts) {
    var c = counts || {};
    var parts = [];
    if (c.inputs != null) parts.push(c.inputs + ' source' + (c.inputs !== 1 ? 's' : ''));
    if (c.outputs != null) parts.push(c.outputs + ' target' + (c.outputs !== 1 ? 's' : ''));
    if (c.transformations != null) parts.push(c.transformations + ' transformation' + (c.transformations !== 1 ? 's' : ''));
    return parts.length ? parts.join(', ') : '';
  }
  function formatCountsHtml(counts) {
    var c = counts || {};
    var parts = [];
    if (c.inputs != null) parts.push('<span class="msg-count-item"><i class="fa-solid fa-database" aria-hidden="true"></i> <strong>' + (c.inputs) + '</strong></span> source' + (c.inputs !== 1 ? 's' : ''));
    if (c.outputs != null) parts.push('<span class="msg-count-item"><i class="fa-solid fa-bullseye" aria-hidden="true"></i> <strong>' + (c.outputs) + '</strong></span> target' + (c.outputs !== 1 ? 's' : ''));
    if (c.transformations != null) parts.push('<span class="msg-count-item"><i class="fa-solid fa-filter" aria-hidden="true"></i> <strong>' + (c.transformations) + '</strong></span> transformation' + (c.transformations !== 1 ? 's' : ''));
    return parts.length ? parts.join(', ') : '';
  }

  var overwriteModal = $('overwrite-modal');
  var overwriteMessage = $('overwrite-message');
  var overwriteCancelBtn = $('overwrite-cancel');
  var overwriteConfirmBtn = $('overwrite-confirm');
  var overwriteModalClose = $('overwrite-modal-close');
  var overwriteCallback = null;

  function showOverwriteConfirm(path, onConfirm) {
    if (overwriteMessage) overwriteMessage.innerHTML = 'A configuration named <strong class="overwrite-filename">' + escapeHtml(path || '') + '</strong> already exists. Overwrite?';
    overwriteCallback = onConfirm;
    if (overwriteModal) overwriteModal.classList.add('visible');
  }

  function closeOverwriteModal() {
    overwriteCallback = null;
    if (overwriteModal) overwriteModal.classList.remove('visible');
  }

  if (overwriteConfirmBtn) overwriteConfirmBtn.addEventListener('click', function () {
    if (typeof overwriteCallback === 'function') overwriteCallback();
    closeOverwriteModal();
  });
  if (overwriteCancelBtn) overwriteCancelBtn.addEventListener('click', closeOverwriteModal);
  if (overwriteModalClose) overwriteModalClose.addEventListener('click', closeOverwriteModal);
  if (overwriteModal) overwriteModal.addEventListener('click', function (e) { if (e.target === overwriteModal) closeOverwriteModal(); });

  function configPathExists(path, configsList) {
    if (!path || !configsList || !Array.isArray(configsList)) return false;
    return configsList.some(function (c) { return (c.path || c.name || '') === path; });
  }

  /**
   * Validate JSON against expected dataflow config format (Inputs, Outputs, Transformations).
   * Returns { valid: boolean, errors: [ { path: string, message: string } ] }.
   */
  function validateDataflowConfig(data) {
    var errors = [];
    if (!data || typeof data !== 'object') {
      errors.push({ path: '', message: 'Config must be a JSON object.' });
      return { valid: false, errors: errors };
    }
    var hasInputs = 'Inputs' in data || 'inputs' in data;
    var hasOutputs = 'Outputs' in data || 'outputs' in data;
    if (!hasInputs) errors.push({ path: 'Inputs', message: 'Missing top-level "Inputs" (or "inputs").' });
    if (!hasOutputs) errors.push({ path: 'Outputs', message: 'Missing top-level "Outputs" (or "outputs").' });
    var inputs = data.Inputs || data.inputs;
    var outputs = data.Outputs || data.outputs;
    var trans = data.Transformations || data.transformations;
    if (inputs != null && typeof inputs !== 'object') errors.push({ path: 'Inputs', message: '"Inputs" must be an object (map of dataset names to config).' });
    if (outputs != null && typeof outputs !== 'object') errors.push({ path: 'Outputs', message: '"Outputs" must be an object (map of dataset names to config).' });
    if (trans != null && typeof trans !== 'object') errors.push({ path: 'Transformations', message: '"Transformations" must be an object (e.g. { "steps": [] }).' });
    if (trans && typeof trans === 'object' && trans.steps != null && !Array.isArray(trans.steps)) errors.push({ path: 'Transformations.steps', message: '"Transformations.steps" must be an array.' });
    return { valid: errors.length === 0, errors: errors };
  }

  function showValidationErrors(containerEl, errors, parseError) {
    if (!containerEl) return;
    containerEl.classList.remove('hidden');
    var html = '';
    if (parseError) html += '<p class="import-validation-parse-error"><strong>Parse error:</strong> ' + escapeHtml(parseError) + '</p>';
    if (errors && errors.length) {
      html += '<p class="import-validation-title"><strong>Dataflow format:</strong></p><ul>';
      errors.forEach(function (e) {
        html += '<li>' + (e.path ? '<code>' + escapeHtml(e.path) + '</code>: ' : '') + escapeHtml(e.message) + '</li>';
      });
      html += '</ul>';
    }
    containerEl.innerHTML = html || '';
  }

  function hideValidationErrors(containerEl) {
    if (containerEl) { containerEl.classList.add('hidden'); containerEl.innerHTML = ''; }
  }

  $('import-json-file').addEventListener('change', function () {
    var nameInput = $('import-json-name');
    if (!nameInput || !this.files || this.files.length === 0) return;
    var name = this.files[0].name.replace(/\.json$/i, '');
    if (name) nameInput.value = name;
  });

  $('btn-import-json-file').addEventListener('click', function () {
    var fileInput = $('import-json-file');
    var nameInput = $('import-json-name');
    var msgEl = $('import-json-message');
    var validationEl = $('import-json-validation');
    if (!fileInput.files || fileInput.files.length === 0) {
      showMessagePopup('Import JSON', 'Please select a JSON file first.', 'error');
      return;
    }
    var path = configNameToPath(nameInput ? nameInput.value : '');
    if (!path) {
      showMessagePopup('Import JSON', 'Please enter a config name.', 'error');
      return;
    }
    hideValidationErrors(validationEl);
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'import-message'; }
    var file = fileInput.files[0];
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var validation = validateDataflowConfig(data);
        if (!validation.valid) {
          showValidationErrors(validationEl, validation.errors, null);
          showMessagePopup('Invalid dataflow config', 'The JSON does not match the expected dataflow format. See errors below.', 'error');
          return;
        }
        function doSave() {
          API.saveConfig(path, data).then(function (res) {
            if (res.error) {
              showMessagePopup('Import failed', res.error, 'error');
              return;
            }
            var counts = getConfigCounts(data);
            var countHtml = formatCountsHtml(counts);
            var msg = 'Configuration <strong>' + escapeHtml(path) + '</strong> imported and saved.';
            if (countHtml) msg += ' ' + countHtml + '.';
            showMessagePopup('Success', msg, 'success', true);
            fileInput.value = '';
            if (nameInput) nameInput.value = '';
            if (msgEl) { msgEl.textContent = ''; msgEl.className = 'import-message'; }
            hideValidationErrors(validationEl);
            refreshConfigList();
            loadConfig(path);
            if (window.showConfigurationsView) window.showConfigurationsView();
          }).catch(function (err) {
            showMessagePopup('Import failed', err.message || String(err), 'error');
          });
        }
        API.configs().then(function (cfg) {
          if (configPathExists(path, cfg.configs || [])) {
            showOverwriteConfirm(path, doSave);
          } else {
            doSave();
          }
        }).catch(function () { doSave(); });
      } catch (e) {
        showValidationErrors(validationEl, [], e.message || 'The file is not valid JSON.');
        showMessagePopup('Invalid JSON', e.message || 'The file is not valid JSON.', 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
  });

  var pasteTextarea = $('import-json-paste');
  var pasteValidationEl = $('import-paste-validation');
  if (pasteTextarea) pasteTextarea.addEventListener('input', function () {
    pasteTextarea.classList.remove('has-error');
    hideValidationErrors(pasteValidationEl);
  });

  $('btn-save-paste-json').addEventListener('click', function () {
    var textarea = $('import-json-paste');
    var nameInput = $('import-json-paste-name');
    var msgEl = $('import-paste-message');
    var validationEl = $('import-paste-validation');
    var raw = textarea && textarea.value ? textarea.value.trim() : '';
    var path = configNameToPath(nameInput ? nameInput.value : '');
    if (!path) {
      showMessagePopup('Save config', 'Please enter a config name.', 'error');
      return;
    }
    if (!raw) {
      showMessagePopup('Save config', 'Please paste JSON into the text area.', 'error');
      return;
    }
    if (textarea) textarea.classList.remove('has-error');
    hideValidationErrors(validationEl);
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'import-message'; }
    var parseError = null;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      parseError = e.message || 'The pasted text is not valid JSON.';
      if (e.message && /line \d+/i.test(e.message)) parseError = e.message;
      showValidationErrors(validationEl, [], parseError);
      if (textarea) textarea.classList.add('has-error');
      showMessagePopup('Invalid JSON', parseError, 'error');
      return;
    }
    var validation = validateDataflowConfig(data);
    if (!validation.valid) {
      showValidationErrors(validationEl, validation.errors, null);
      if (textarea) textarea.classList.add('has-error');
      showMessagePopup('Invalid dataflow config', 'The JSON does not match the expected dataflow format. See errors below.', 'error');
      return;
    }
    function doSave() {
      API.saveConfig(path, data).then(function (res) {
        if (res.error) {
          showMessagePopup('Save failed', res.error, 'error');
          return;
        }
        var counts = getConfigCounts(data);
        var countHtml = formatCountsHtml(counts);
        var msg = 'Configuration <strong>' + escapeHtml(path) + '</strong> saved.';
        if (countHtml) msg += ' ' + countHtml + '.';
        showMessagePopup('Success', msg, 'success', true);
        textarea.value = '';
        if (nameInput) nameInput.value = '';
        if (msgEl) { msgEl.textContent = ''; msgEl.className = 'import-message'; }
        if (textarea) textarea.classList.remove('has-error');
        hideValidationErrors(validationEl);
        refreshConfigList();
        loadConfig(path);
        if (window.showConfigurationsView) window.showConfigurationsView();
      }).catch(function (err) {
        showMessagePopup('Save failed', err.message || String(err), 'error');
      });
    }
    API.configs().then(function (cfg) {
      if (configPathExists(path, cfg.configs || [])) {
        showOverwriteConfirm(path, doSave);
      } else {
        doSave();
      }
    }).catch(function () { doSave(); });
  });

  $('btn-download-json').addEventListener('click', () => {
    if (!currentPath) return;
    window.location.href = '/api/config/' + encodeURIComponent(currentPath) + '/download';
  });
  if ($('btn-rename')) $('btn-rename').addEventListener('click', () => {
    if (!currentPath) return;
    renameDeleteTargetPath = currentPath;
    renameInput.value = currentPath.replace(/\.json$/i, '');
    renameModal.classList.add('visible');
    renameInput.focus();
  });

  if ($('btn-delete')) $('btn-delete').addEventListener('click', () => {
    if (!currentPath) return;
    renameDeleteTargetPath = currentPath;
    deleteMessage.textContent = 'Delete "' + currentPath + '"? This cannot be undone.';
    deleteModal.classList.add('visible');
  });

  $('zip-file').addEventListener('change', function () {
    var nameInput = $('import-config-name');
    if (!nameInput) return;
    var files = this.files;
    if (files && files.length > 0) {
      var name = files[0].name.replace(/\.zip$/i, '');
      if (name) nameInput.value = name;
    }
  });

  $('btn-import-zip').addEventListener('click', () => {
    const fileInput = $('zip-file');
    const nameInput = $('import-config-name');
    const msgEl = $('import-message');
    if (!fileInput.files || fileInput.files.length === 0) {
      msgEl.textContent = 'Please select a ZIP file.';
      msgEl.className = 'import-message error';
      showMessagePopup('Import', 'Please select a ZIP file first.', 'error');
      return;
    }
    var configName = (nameInput && nameInput.value ? nameInput.value : 'imported_mainflow').trim() || 'imported_mainflow';
    var path = configNameToPath(configName);
    function formatElapsed(ms) {
      var sec = Math.floor(ms / 1000);
      if (sec < 60) return '0:' + (sec < 10 ? '0' : '') + sec;
      var min = Math.floor(sec / 60);
      sec = sec % 60;
      if (min < 60) return min + ':' + (sec < 10 ? '0' : '') + sec;
      var hr = Math.floor(min / 60);
      min = min % 60;
      return hr + 'h ' + min + 'm ' + sec + 's';
    }
    function formatDuration(ms) {
      var sec = Math.floor(ms / 1000);
      if (sec < 60) return sec + 's';
      var min = Math.floor(sec / 60);
      sec = sec % 60;
      if (min < 60) return min + 'm ' + (sec ? sec + 's' : '');
      var hr = Math.floor(min / 60);
      min = min % 60;
      return hr + 'h ' + min + 'm' + (sec ? ' ' + sec + 's' : '');
    }
    function doImport() {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      formData.append('config_name', configName);
      formData.append('save', 'true');
      msgEl.textContent = 'Generating config...';
      msgEl.className = 'import-message';
      var importPanelZip = $('import-panel-zip');
      var importLogsEl = $('import-logs');
      var importLogsProgress = $('import-logs-progress');
      var importLogsTimer = $('import-logs-timer');
      if (importPanelZip) importPanelZip.classList.add('has-logs');
      if (importLogsProgress) importLogsProgress.classList.remove('hidden');
      if (importLogsTimer) importLogsTimer.textContent = '0:00';
      if (importLogsEl) {
        importLogsEl.textContent = 'Generating config...';
        importLogsEl.dataset.raw = 'Generating config...';
      }
      var startTime = Date.now();
      var timerInterval = setInterval(function () {
        if (importLogsTimer) importLogsTimer.textContent = formatElapsed(Date.now() - startTime);
      }, 1000);
      function stopTimer(success) {
        clearInterval(timerInterval);
        var duration = formatDuration(Date.now() - startTime);
        if (importLogsProgress) importLogsProgress.classList.add('hidden');
        return success ? 'Completed in ' + duration + '.' : 'Failed after ' + duration + '.';
      }
      API.importZip(formData).then(data => {
        if (importPanelZip) importPanelZip.classList.add('has-logs');
        var durationLine = stopTimer(!data.error);
        var logLines = Array.isArray(data.logs) ? data.logs : [];
        logLines.push(durationLine);
        if (importLogsEl) {
          importLogsEl.textContent = logLines.length ? logLines.join('\n') : (data.error ? 'Import failed.' : '');
          importLogsEl.dataset.raw = importLogsEl.textContent;
        }
        if (data.error) {
          msgEl.textContent = 'Import failed. See error details below.';
          msgEl.className = 'import-message error';
          showErrorPopup('Import failed', data.error, data.details != null ? String(data.details) : '');
          return;
        }
        var d = data.discovery || {};
        var parts = [];
        if (d.jcl) parts.push(d.jcl + ' JCL');
        if (d.proc) parts.push(d.proc + ' PROC');
        if (d.cobol) parts.push(d.cobol + ' COBOL');
        if (d.copybook) parts.push(d.copybook + ' copybook(s)');
        var found = parts.length ? 'Found ' + parts.join(', ') + '.' : '';
        var counts = getConfigCounts(data.config);
        var countHtml = formatCountsHtml(counts);
        var body = (found ? escapeHtml(found) + '<br><br>' : '') + 'Config generated: <strong>' + escapeHtml(data.filename || '') + '</strong>' + (data.saved ? ' (saved)' : '');
        if (data.discovery && data.discovery.llm) body += ' <em>(via LLM)</em>.';
        if (countHtml) body += '<br><br>Imported: ' + countHtml + '.';
        var summary = data.test_data_summary || {};
        var inputNames = (data.input_data && Object.keys(data.input_data).length) ? Object.keys(data.input_data) : (summary.input_files || []);
        var outputNames = (data.expected_output && Object.keys(data.expected_output).length) ? Object.keys(data.expected_output) : (summary.output_files || []);
        if (inputNames.length || outputNames.length) {
          body += '<br><br><strong>Input and output files found in ZIP</strong><br>';
          if (inputNames.length) body += '<span class="import-success-test-data-line">• Input file(s): <code>' + inputNames.map(escapeHtml).join('</code>, <code>') + '</code></span>';
          if (outputNames.length) body += '<span class="import-success-test-data-line">• Output file(s): <code>' + outputNames.map(escapeHtml).join('</code>, <code>') + '</code></span>';
          body += '<br>Run the dataflow from <strong>Test</strong>, then use the <strong>Reconciliation</strong> tab to compare generated vs expected output.';
          if (!inputNames.length) body += ' (No input file matched — sample data will be used for the run.)';
        } else {
          body += '<br><br>No input or output files were found in the ZIP. To use reconciliation, add CSV/Parquet in <code>INPUT/</code> and <code>OUTPUT/</code> (or <code>expected_output/</code>) with names matching your config and re-import.';
        }
        if (!d.copybook || d.copybook === 0) {
          body += '<br><br>' + escapeHtml('Schema fields are empty because no copybook files (.cpy) were found in the ZIP. To populate field definitions, add COBOL copybook files to the ZIP (e.g. names matching your input/output DD names like CUSTIN.cpy, ACCTIN.cpy) and re-import.');
        }
        msgEl.textContent = 'Config generated. See message below.';
        msgEl.className = 'import-message success';
        fileInput.value = '';
        nameInput.value = '';
        if (data.filename && (data.input_data || data.expected_output)) {
          uploadedTestData[data.filename] = {
            input_data: data.input_data || {},
            expected_output: data.expected_output || {}
          };
        }
        showMessagePopup('Import successful', body, 'success', true);
        API.configs().then(cfg => {
          renderConfigList(cfg.configs || []);
          if (data.filename && data.config) {
            applyConfigInView(data.filename, data.config);
          } else if (data.filename) {
            loadConfig(data.filename);
          }
          if (window.showConfigurationsView) window.showConfigurationsView();
        });
      }).catch(err => {
        const msg = err.message || String(err);
        msgEl.textContent = 'Import failed. See error details below.';
        msgEl.className = 'import-message error';
        var importPanelZip = $('import-panel-zip');
        var importLogsProgress = $('import-logs-progress');
        var importLogsEl = $('import-logs');
        var durationLine = stopTimer(false);
        if (importPanelZip) importPanelZip.classList.add('has-logs');
        if (importLogsProgress) importLogsProgress.classList.add('hidden');
        if (importLogsEl) {
          var prev = importLogsEl.textContent || '';
          importLogsEl.textContent = prev + (prev ? '\n' : '') + 'Import failed: ' + msg + '\n' + durationLine;
          importLogsEl.dataset.raw = importLogsEl.textContent;
        }
        showErrorPopup('Import failed', msg, err.stack || '');
      });
    }
    API.configs().then(function (cfg) {
      var configs = cfg.configs || [];
      if (path && configPathExists(path, configs)) {
        showOverwriteConfirm(path, doImport);
      } else {
        doImport();
      }
    }).catch(function () { doImport(); });
  });

  (function () {
    var importLogsCopyBtn = $('import-logs-copy-btn');
    if (importLogsCopyBtn) importLogsCopyBtn.addEventListener('click', function () {
      var logsEl = $('import-logs');
      var raw = (logsEl && logsEl.dataset.raw) || (logsEl && logsEl.textContent) || '';
      if (!raw) {
        (window.CodeParser.showMessagePopup || showMessagePopup)('Copy', 'Import logs are empty.', 'info');
        return;
      }
      navigator.clipboard.writeText(raw).then(function () {
        (window.CodeParser.showMessagePopup || showMessagePopup)('Copied', 'Import logs copied to clipboard.', 'success', true);
      }).catch(function () {
        (window.CodeParser.showMessagePopup || showMessagePopup)('Copy failed', 'Could not copy to clipboard.', 'error');
      });
    });
  })();

  function toggleEditMode() {
    editMode = !editMode;
    var diagramEdit = document.getElementById('diagram-edit-btn');
    if (diagramEdit) diagramEdit.classList.toggle('active', editMode);
    if (configViewMode === 'json') updateJsonEditorMode();
  }
  var diagramEditBtn = document.getElementById('diagram-edit-btn');
  if (diagramEditBtn) diagramEditBtn.addEventListener('click', toggleEditMode);

  function toggleHoverPopups() {
    window.CodeParser.hoverPopupsEnabled = !window.CodeParser.hoverPopupsEnabled;
    var diagramHover = document.getElementById('diagram-hover-popups-btn');
    var popup = document.getElementById('step-hover-popup');
    if (diagramHover) diagramHover.classList.toggle('active', window.CodeParser.hoverPopupsEnabled);
    if (popup) {
      popup.classList.add('hidden');
      popup.setAttribute('aria-hidden', 'true');
    }
  }
  var diagramHoverBtn = document.getElementById('diagram-hover-popups-btn');
  if (diagramHoverBtn) diagramHoverBtn.addEventListener('click', toggleHoverPopups);

  var diagramFitBtn = document.getElementById('diagram-fit-btn');
  if (diagramFitBtn) diagramFitBtn.addEventListener('click', function () {
    if (window.CodeParser && window.CodeParser.fitDiagram) window.CodeParser.fitDiagram();
  });

  var diagramZoomIn = document.getElementById('diagram-zoom-in-btn');
  if (diagramZoomIn) diagramZoomIn.addEventListener('click', function () {
    if (window.CodeParser && window.CodeParser.zoomIn) window.CodeParser.zoomIn();
  });
  var diagramZoomOut = document.getElementById('diagram-zoom-out-btn');
  if (diagramZoomOut) diagramZoomOut.addEventListener('click', function () {
    if (window.CodeParser && window.CodeParser.zoomOut) window.CodeParser.zoomOut();
  });

  var moveMode = false;
  var diagramMoveBtn = document.getElementById('diagram-move-btn');
  if (diagramMoveBtn) diagramMoveBtn.addEventListener('click', function () {
    moveMode = !moveMode;
    diagramMoveBtn.classList.toggle('active', moveMode);
    if (window.CodeParser && window.CodeParser.setMoveMode) window.CodeParser.setMoveMode(moveMode);
  });

  function setConfigViewMode(mode) {
    configViewMode = mode;
    var diagramPanel = document.getElementById('diagram-view-panel');
    var jsonWrap = document.getElementById('json-editor-wrap');
    var tabDiagram = document.getElementById('diagram-view-tab-diagram');
    var tabJson = document.getElementById('diagram-view-tab-json');
    if (mode === 'json') {
      if (diagramPanel) diagramPanel.classList.add('hidden');
      if (jsonWrap) {
        jsonWrap.classList.remove('hidden');
        jsonWrap.setAttribute('aria-hidden', 'false');
      }
      if (tabDiagram) { tabDiagram.classList.remove('active'); tabDiagram.setAttribute('aria-selected', 'false'); }
      if (tabJson) { tabJson.classList.add('active'); tabJson.setAttribute('aria-selected', 'true'); }
      syncJsonEditorFromConfig();
      updateJsonEditorMode();
    } else {
      if (jsonWrap) {
        jsonWrap.classList.add('hidden');
        jsonWrap.setAttribute('aria-hidden', 'true');
      }
      if (diagramPanel) diagramPanel.classList.remove('hidden');
      if (tabDiagram) { tabDiagram.classList.add('active'); tabDiagram.setAttribute('aria-selected', 'true'); }
      if (tabJson) { tabJson.classList.remove('active'); tabJson.setAttribute('aria-selected', 'false'); }
    }
  }

  function syncJsonEditorFromConfig() {
    var statusEl = document.getElementById('json-editor-status');
    jsonEditorDirty = false;
    var applyBtn = document.getElementById('json-editor-apply-btn');
    if (applyBtn) applyBtn.classList.add('hidden');
    if (configViewMode === 'json') {
      updateJsonEditorMode();
    }
    if (statusEl) statusEl.textContent = '';
  }

  var tabDiagram = document.getElementById('diagram-view-tab-diagram');
  var tabJson = document.getElementById('diagram-view-tab-json');
  if (tabDiagram) tabDiagram.addEventListener('click', function () { setConfigViewMode('diagram'); });
  if (tabJson) tabJson.addEventListener('click', function () { setConfigViewMode('json'); });


  var jsonEditorApply = document.getElementById('json-editor-apply-btn');
  var jsonEditorStatus = document.getElementById('json-editor-status');
  if (jsonEditorApply) {
    jsonEditorApply.addEventListener('click', function () {
      if (!currentConfig || !currentPath) return;
      try {
        jsonEditorDirty = false;
        jsonEditorApply.classList.add('hidden');
        if (jsonEditorStatus) jsonEditorStatus.textContent = 'Saving…';
        var container = $('network');
        if (container) initNetwork(container, currentConfig);
        API.saveConfig(currentPath, currentConfig).then(function (res) {
          if (res.error) {
            if (jsonEditorStatus) jsonEditorStatus.textContent = '';
            showMessagePopup('Save failed', res.error, 'error');
          } else {
            if (jsonEditorStatus) jsonEditorStatus.textContent = 'Saved.';
            showMessagePopup('Saved', 'Configuration saved.', 'success');
            setTimeout(function () { if (jsonEditorStatus) jsonEditorStatus.textContent = ''; }, 2000);
          }
        }).catch(function (err) {
          if (jsonEditorStatus) jsonEditorStatus.textContent = '';
          showMessagePopup('Save failed', err.message || String(err), 'error');
        });
      } catch (e) {
        if (jsonEditorStatus) jsonEditorStatus.textContent = 'Error: ' + (e.message || String(e));
      }
    });
  }

  var jsonEditorFontIncrease = document.getElementById('json-editor-font-increase');
  var jsonEditorFontDecrease = document.getElementById('json-editor-font-decrease');
  if (jsonEditorFontIncrease) jsonEditorFontIncrease.addEventListener('click', function () {
    jsonTreeFontSize = Math.min(24, jsonTreeFontSize + 2);
    if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
  });
  if (jsonEditorFontDecrease) jsonEditorFontDecrease.addEventListener('click', function () {
    jsonTreeFontSize = Math.max(10, jsonTreeFontSize - 2);
    if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
  });

  var jsonEditorSearchToggle = document.getElementById('json-editor-search-toggle');
  var jsonEditorSearchInput = document.getElementById('json-editor-search-input');
  if (jsonEditorSearchToggle && jsonEditorSearchInput) {
    jsonEditorSearchToggle.addEventListener('click', function () {
      jsonEditorSearchInput.classList.toggle('hidden');
      if (!jsonEditorSearchInput.classList.contains('hidden')) jsonEditorSearchInput.focus();
    });
    jsonEditorSearchInput.addEventListener('input', function () {
      if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
    });
    jsonEditorSearchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        jsonEditorSearchInput.value = '';
        jsonEditorSearchInput.classList.add('hidden');
        if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
      }
    });
  }

  (function diagramToolbarAutoHide() {
    var container = document.getElementById('diagram-container');
    var layer = document.getElementById('diagram-toolbar-layer');
    var toolbar = document.getElementById('diagram-toolbar');
    var hideTimer;
    var HIDE_DELAY_MS = 2500;
    var TOP_ZONE_HEIGHT = 70;
    var wasInZone = false;

    function isInDiagramTopZone(x, y) {
      if (!container || !container.getBoundingClientRect) return false;
      var r = container.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
      return (y - r.top) <= TOP_ZONE_HEIGHT;
    }

    function showAutoHideLayer() {
      if (layer) layer.classList.add('diagram-autohide-visible');
      if (toolbar) toolbar.classList.add('diagram-toolbar-visible');
    }

    function hideAutoHideLayer() {
      if (layer) layer.classList.remove('diagram-autohide-visible');
      if (toolbar) toolbar.classList.remove('diagram-toolbar-visible');
    }

    function onMouseMove(e) {
      if (!container || !layer || !toolbar) return;
      if (!container.classList.contains('visible')) return;
      var inZone = isInDiagramTopZone(e.clientX, e.clientY);
      if (inZone) {
        clearTimeout(hideTimer);
        showAutoHideLayer();
        wasInZone = true;
      } else if (wasInZone) {
        wasInZone = false;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hideAutoHideLayer, HIDE_DELAY_MS);
      }
    }

    if (container && layer && toolbar) {
      document.addEventListener('mousemove', onMouseMove);
    }
  })();

  function syncDiagramToolbarState() {
    var diagramEdit = document.getElementById('diagram-edit-btn');
    var diagramHover = document.getElementById('diagram-hover-popups-btn');
    var diagramMoveBtn = document.getElementById('diagram-move-btn');
    if (diagramEdit) diagramEdit.classList.toggle('active', editMode);
    if (diagramHover) diagramHover.classList.toggle('active', window.CodeParser.hoverPopupsEnabled);
    if (diagramMoveBtn) {
      diagramMoveBtn.classList.toggle('active', moveMode);
      if (window.CodeParser && window.CodeParser.setMoveMode) window.CodeParser.setMoveMode(moveMode);
    }
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    console.log('Search input triggered with query:', q);
    if (q.length < 2) {
      console.log('Query too short, hiding results');
      searchResults.classList.remove('visible');
      searchResults.innerHTML = '';
      return;
    }
    console.log('Calling API.search with:', q);
    API.search(q).then(data => {
      console.log('API.search response:', data);
      const results = (data.results || []).slice(0, 20);
      console.log('Results to display:', results.length);
      searchResults.innerHTML = results.map(r => {
        const snippet = (r.snippet || '').replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => '<mark>' + m + '</mark>');
        return '<div class="search-result-item" data-file="' + (r.file || '') + '">' +
          '<span class="file">' + (r.file || '') + '</span> <span class="path">' + (r.path || '') + '</span>' +
          '<div class="snippet">' + snippet + '</div></div>';
      }).join('');
      console.log('Search results HTML set, showing results');
      searchResults.classList.add('visible');
      searchResults.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
          const file = el.dataset.file;
          if (file) loadConfig(file);
          searchResults.classList.remove('visible');
          searchInput.value = '';
        });
      });
    }).catch(err => {
      console.error('Search API error:', err);
    });
  });

  document.addEventListener('click', (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput)
      searchResults.classList.remove('visible');
  });

  var lastTestSampleData = null;
  var lastGeneratedOutput = null;
  var uploadedTestData = {};
  var testLogsRaw = '';

  function escapeLogHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightLogText(raw) {
    if (!raw) return '';
    var html = escapeLogHtml(raw);
    // File paths: "/path/to/file.py" or /path/to/file.py
    html = html.replace(/(File\s+")([^"]+?)(")/g, '$1<span class="log-path">$2</span>$3');
    html = html.replace(/(["'])(\/[\w./\-]+\.py)(["']?)/g, '$1<span class="log-path">$2</span>$3');
    html = html.replace(/(\s)(\/[\w./\-]+\.[a-z]+)(\s|$)/g, '$1<span class="log-path">$2</span>$3');
    // line N
    html = html.replace(/(,\s*line\s+)(\d+)/g, '$1<span class="log-line-num">$2</span>');
    // [INFO], [ERROR], [WARNING], [DEBUG]
    html = html.replace(/\[(INFO)\]/g, '<span class="log-info">[$1]</span>');
    html = html.replace(/\[(WARNING)\]/g, '<span class="log-warn">[$1]</span>');
    html = html.replace(/\[(ERROR)\]/g, '<span class="log-err">[$1]</span>');
    html = html.replace(/\[(DEBUG)\]/g, '<span class="log-debug">[$1]</span>');
    // Exception names
    html = html.replace(/\b(AnalysisException|ValueError|TypeError|AttributeError|KeyError|RuntimeError|Exception)(\b|:)/g, '<span class="log-exception">$1</span>$2');
    // "Did you mean ..." suggestion
    html = html.replace(/(Did you mean one of the following\?)/g, '<span class="log-suggestion">$1</span>');
    html = html.replace(/(\[`)([^`]+)(`\])/g, '$1<span class="log-col">$2</span>$3');
    // Traceback line
    html = html.replace(/^(Traceback \(most recent call last\))/gm, '<span class="log-traceback">$1</span>');
    return html;
  }

  function setTestLogsContent(el, raw) {
    if (!el) return;
    testLogsRaw = raw;
    el.dataset.raw = raw;
    el.innerHTML = highlightLogText(raw);
  }

  function appendTestLogsContent(el, more) {
    if (!el) return;
    testLogsRaw += more;
    el.dataset.raw = testLogsRaw;
    el.innerHTML = highlightLogText(testLogsRaw);
  }

  var testLogsCopyBtn = document.getElementById('test-logs-copy-btn');
  if (testLogsCopyBtn) testLogsCopyBtn.addEventListener('click', function () {
    var logsEl = document.getElementById('test-logs');
    var raw = (logsEl && logsEl.dataset.raw) || testLogsRaw || '';
    if (!raw) {
      (window.CodeParser.showMessagePopup || showMessagePopup)('Copy', 'Logs are empty.', 'info');
      return;
    }
    navigator.clipboard.writeText(raw).then(function () {
      (window.CodeParser.showMessagePopup || showMessagePopup)('Copied', 'Logs copied to clipboard. Paste in your editor to debug.', 'success', true);
    }).catch(function () {
      (window.CodeParser.showMessagePopup || showMessagePopup)('Copy failed', 'Could not copy to clipboard.', 'error');
    });
  });

  var lastTestConfigPath = null;

  function loadTestSampleData() {
    var progressSection = document.getElementById('test-progress-section');
    var progressText = document.getElementById('test-progress-text');
    var sourceSection = document.getElementById('test-source-section');
    var sourceTables = document.getElementById('test-source-tables');
    var configNameEl = document.getElementById('test-page-config-name');
    var logsEl = document.getElementById('test-logs');
    if (!sourceSection) return;
    if (!currentPath || !currentConfig) {
      if (configNameEl) configNameEl.textContent = '';
      return;
    }
    if (currentPath !== lastTestConfigPath) {
      lastTestConfigPath = currentPath;
      if (logsEl) setTestLogsContent(logsEl, '');
    }
    if (configNameEl) configNameEl.textContent = currentPath;
    switchTestTab('input');
    var uploaded = currentPath && uploadedTestData[currentPath] && uploadedTestData[currentPath].input_data && Object.keys(uploadedTestData[currentPath].input_data).length > 0;
    var hasExpectedOutput = currentPath && uploadedTestData[currentPath] && uploadedTestData[currentPath].expected_output && Object.keys(uploadedTestData[currentPath].expected_output).length > 0;
    var reconBtnOutput = document.getElementById('btn-show-reconciliation-output');
    var reconCtaOutput = document.getElementById('test-output-recon-cta');
    if (reconBtnOutput) reconBtnOutput.classList.toggle('hidden', !hasExpectedOutput);
    if (reconCtaOutput) reconCtaOutput.classList.toggle('hidden', !hasExpectedOutput);
    var inputTitleEl = document.getElementById('test-input-panel-title');
    if (inputTitleEl) inputTitleEl.textContent = uploaded ? 'Input datasets (from uploaded ZIP)' : 'Input datasets (sample)';
    if (uploaded) {
      if (progressSection) progressSection.classList.add('hidden');
      lastTestSampleData = uploadedTestData[currentPath].input_data;
      sourceTables.innerHTML = '';
      Object.keys(lastTestSampleData).forEach(function (name) {
        var rows = lastTestSampleData[name] || [];
        var cols = rows[0] ? Object.keys(rows[0]).filter(function (k) { return !String(k).startsWith('_'); }) : [];
        if (cols.length === 0 && rows[0]) cols = Object.keys(rows[0]).filter(function (k) { return !String(k).startsWith('_'); });
        var html = '<div class="test-table-wrap"><h3>' + (window.CodeParser.escapeHtml || escapeHtml)(name) + '</h3><table class="test-table"><thead><tr>' +
          cols.map(function (c) { return '<th>' + (window.CodeParser.escapeHtml || escapeHtml)(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.slice(0, 10).forEach(function (r) {
          html += '<tr>' + cols.map(function (c) { return '<td>' + (window.CodeParser.escapeHtml || escapeHtml)(String(r[c] != null ? r[c] : '')) + '</td>'; }).join('') + '</tr>';
        });
        html += '</tbody></table></div>';
        sourceTables.insertAdjacentHTML('beforeend', html);
      });
      return;
    }
    if (progressSection) {
      progressSection.classList.remove('hidden');
      if (progressText) progressText.textContent = 'Generating sample data...';
    }
    API.generateTestSample({ config_path: currentPath, num_rows: 5 }).then(function (res) {
      if (progressSection) progressSection.classList.add('hidden');
      if (res.error) {
        (window.CodeParser.showMessagePopup || showMessagePopup)('Error', res.error, 'error');
        return;
      }
      lastTestSampleData = res.inputs || {};
      sourceTables.innerHTML = '';
      Object.keys(lastTestSampleData).forEach(function (name) {
        var rows = lastTestSampleData[name] || [];
        var cols = rows[0] ? Object.keys(rows[0]) : [];
        var html = '<div class="test-table-wrap"><h3>' + (window.CodeParser.escapeHtml || escapeHtml)(name) + '</h3><table class="test-table"><thead><tr>' +
          cols.map(function (c) { return '<th>' + (window.CodeParser.escapeHtml || escapeHtml)(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.slice(0, 10).forEach(function (r) {
          html += '<tr>' + cols.map(function (c) { return '<td>' + (window.CodeParser.escapeHtml || escapeHtml)(String(r[c] != null ? r[c] : '')) + '</td>'; }).join('') + '</tr>';
        });
        html += '</tbody></table></div>';
        sourceTables.insertAdjacentHTML('beforeend', html);
      });
    }).catch(function () {
      if (progressSection) progressSection.classList.add('hidden');
      (window.CodeParser.showMessagePopup || showMessagePopup)('Error', 'Failed to generate sample data.', 'error');
    });
  }

  // --- Reconciliation helpers ---

  function normalizeReconValue(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    if (s === '') return '';
    // Numeric normalization: "100.0" == "100" == "100.00"
    var n = Number(s);
    if (!isNaN(n) && isFinite(n)) return String(n);
    return s;
  }

  function normalizeColKey(c) {
    // Similar matching: case-insensitive, collapse spaces/hyphens/dots to underscore; (*) and * stripped for matching only.
    // Header column names (including "ACCT-NO*" or "ACCT-NO (*)") are shown as-is in the table.
    var s = String(c).trim().toLowerCase();
    s = s.replace(/\s*\(\*\)\s*|\*/g, '').replace(/[\s\-\._,;:]+/g, '_').replace(/[^a-z0-9_]/g, '');
    s = s.replace(/_+/g, '_').replace(/^_|_$/g, '');
    return s || String(c).trim().toLowerCase();
  }

  function looseColKey(c) {
    // For fallback: alphanumeric only, so "Revenue_Amount" and "Revenue Amount" both match
    return String(c).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Match expected rows to generated rows. Returns:
  //   { pairs, expCols, genCols, colMap }
  // colMap: expCol -> matched genCol (null if no match found)
  // pairs:  [ { exp: row|null, gen: row|null }, ... ]
  function buildReconPairs(expRows, genRows) {
    var expCols = (expRows[0] ? Object.keys(expRows[0]) : []).filter(function (k) { return !String(k).startsWith('_'); });
    var genCols = (genRows[0] ? Object.keys(genRows[0]) : []).filter(function (k) { return !String(k).startsWith('_'); });

    // Similar column mapping: do not require exact match. Hyphen (-) and underscore (_) treated as equivalent
    // so schema columns (SUM-CUST-ID) match generated output (SUM_CUST_ID).
    var genColByKey = {};
    var genColByLoose = {};
    var genColByHyphenNorm = {}; // key: ec with - replaced by _, value: gen col (for fallback)
    genCols.forEach(function (c) {
      var k = normalizeColKey(c);
      var l = looseColKey(c);
      genColByKey[k] = c;
      if (!genColByLoose[l]) genColByLoose[l] = c;
      var norm = c.replace(/-/g, '_').toLowerCase();
      if (!genColByHyphenNorm[norm]) genColByHyphenNorm[norm] = c;
    });
    var colMap = {};
    expCols.forEach(function (ec) {
      var mapped = genColByKey[normalizeColKey(ec)];
      if (mapped === undefined) mapped = genColByLoose[looseColKey(ec)] || null;
      if (mapped === undefined) mapped = genColByHyphenNorm[ec.replace(/-/g, '_').toLowerCase()] || null;
      colMap[ec] = mapped;
    });

    // Find one key column to match expected ↔ generated by identity (not by row order)
    var keyCol = null;
    var genKeyCol = null;

    function keyScore(colName) {
      var lc = normalizeColKey(colName);
      if (lc === 'id' || lc === 'key') return 100;
      if (lc.endsWith('_id') || lc.endsWith('_key') || lc === 'pk') return 90;
      if (lc.endsWith('_no') || lc.endsWith('_num') || lc.endsWith('_code') || lc.endsWith('_ref') || lc.endsWith('_seq')) return 80;
      if (lc.indexOf('id') >= 0 || lc.indexOf('key') >= 0 || lc.indexOf('acct') >= 0 || lc.indexOf('cust') >= 0) return 70;
      if (lc.indexOf('no') >= 0 || lc.indexOf('num') >= 0 || lc.indexOf('code') >= 0 || lc.indexOf('ref') >= 0 || lc.indexOf('seq') >= 0) return 50;
      return 0;
    }

    var keyCandidates = [];
    expCols.forEach(function (ec) {
      var score = keyScore(ec);
      if (score > 0 && colMap[ec]) keyCandidates.push({ col: ec, genCol: colMap[ec], score: score });
    });
    if (keyCandidates.length > 0) {
      keyCandidates.sort(function (a, b) { return b.score - a.score; });
      keyCol = keyCandidates[0].col;
      genKeyCol = keyCandidates[0].genCol;
    }
    // Fallback: use first column as key if it exists in both (many schemas put ID first)
    if (!keyCol && expCols.length > 0 && colMap[expCols[0]]) {
      keyCol = expCols[0];
      genKeyCol = colMap[expCols[0]];
    }

    var pairs = [];
    if (keyCol && genKeyCol) {
      // Match by key: group generated rows by key value, match each expected row to one generated row with same key
      var genByKey = {};
      genRows.forEach(function (r, i) {
        var k = normalizeReconValue(r[genKeyCol]);
        if (!genByKey[k]) genByKey[k] = [];
        genByKey[k].push(i);
      });
      var usedGen = {};
      expRows.forEach(function (er) {
        var k = normalizeReconValue(er[keyCol]);
        var candidates = (genByKey[k] || []).filter(function (i) { return !usedGen[i]; });
        if (candidates.length > 0) {
          usedGen[candidates[0]] = true;
          pairs.push({ exp: er, gen: genRows[candidates[0]] });
        } else {
          pairs.push({ exp: er, gen: null });
        }
      });
      genRows.forEach(function (r, i) {
        if (!usedGen[i]) pairs.push({ exp: null, gen: r });
      });
    } else {
      // No key column: match by position (order may not align)
      var maxLen = Math.max(expRows.length, genRows.length);
      for (var i = 0; i < maxLen; i++) {
        pairs.push({ exp: expRows[i] || null, gen: genRows[i] || null });
      }
    }
    return { pairs: pairs, expCols: expCols, genCols: genCols, colMap: colMap, keyCol: keyCol || null, genKeyCol: genKeyCol || null };
  }

  function computeReconDiff(expRows, genRows) {
    var r = buildReconPairs(expRows, genRows);
    var pairs = r.pairs, expCols = r.expCols, colMap = r.colMap;
    var diffs = [];
    pairs.forEach(function (pair, pi) {
      if (!pair.gen) {
        diffs.push({ type: 'only_in_expected', rowIndex: pi + 1, row: pair.exp });
      } else if (!pair.exp) {
        diffs.push({ type: 'only_in_generated', rowIndex: pi + 1, row: pair.gen });
      } else {
        var cellDiffs = [];
        expCols.forEach(function (ec) {
          var gc = colMap[ec];
          var ev = normalizeReconValue(pair.exp[ec]);
          var gv = gc ? normalizeReconValue(pair.gen[gc]) : '';
          if (ev !== gv) cellDiffs.push({ col: ec, expected: ev, generated: gv });
        });
        if (cellDiffs.length) diffs.push({ type: 'cells', rowIndex: pi + 1, cells: cellDiffs });
      }
    });
    return diffs;
  }

  function renderReconciliation() {
    var container = document.getElementById('test-reconciliation-content');
    if (!container) return;
    var expected = (currentPath && uploadedTestData[currentPath] && uploadedTestData[currentPath].expected_output) || {};
    var generated = lastGeneratedOutput || {};
    var escape = window.CodeParser.escapeHtml || escapeHtml;
    if (!expected || Object.keys(expected).length === 0) {
      container.innerHTML = '<p class="test-recon-placeholder">Upload a ZIP that contains an <code>output/</code> or <code>expected_output/</code> folder with CSV or Parquet files named to match your config (e.g. DAILY_REVENUE.csv). Include <code>input/</code> with input files to run the test using your data; then run the dataflow and open this tab to compare.</p>';
      return;
    }
    if (!generated || Object.keys(generated).length === 0) {
      container.innerHTML = '<p class="test-recon-placeholder">Run the dataflow from the Input datasets tab first (use uploaded input files from your ZIP if you included an <code>input/</code> folder). After it completes, open this tab to compare generated output with the expected output from your ZIP.</p>';
      return;
    }
    var allNames = {};
    Object.keys(expected).forEach(function (n) { allNames[n] = true; });
    Object.keys(generated).forEach(function (n) { allNames[n] = true; });
    var names = Object.keys(allNames);
    var html = '';

    names.forEach(function (name, ni) {
      var expRows = expected[name] || [];
      var genRows = generated[name] || [];
      var reconResult = buildReconPairs(expRows, genRows);
      var pairs = reconResult.pairs;
      var expCols = reconResult.expCols;
      var genCols = reconResult.genCols;
      var colMap = reconResult.colMap;
      var keyCol = reconResult.keyCol;
      var genKeyCol = reconResult.genKeyCol;

      // Build unified column list: expected cols first, then extra gen cols with no match
      var matchedGenCols = {};
      expCols.forEach(function (ec) { if (colMap[ec]) matchedGenCols[colMap[ec]] = true; });
      var allCols = expCols.slice();
      genCols.forEach(function (gc) { if (!matchedGenCols[gc]) allCols.push(gc); });

      // Count row stats
      var matchCount = 0, diffCount = 0, onlyExpCount = 0, onlyGenCount = 0;
      pairs.forEach(function (pair) {
        if (!pair.gen) { onlyExpCount++; return; }
        if (!pair.exp) { onlyGenCount++; return; }
        var hasDiff = allCols.some(function (ec) {
          var gc = colMap[ec] || ec;
          return normalizeReconValue(pair.exp[ec]) !== normalizeReconValue(pair.gen[gc]);
        });
        if (hasDiff) diffCount++; else matchCount++;
      });

      var statusMatch = diffCount === 0 && onlyExpCount === 0 && onlyGenCount === 0;
      var statusClass = statusMatch ? 'test-recon-match' : 'test-recon-mismatch';
      var statusText = statusMatch ? '✓ Match' : '✗ Mismatch';
      var tableId = 'recon-tbl-' + ni;

      html += '<div class="test-recon-dataset">';
      // Header row: title + hide-matching toggle
      html += '<div class="recon-dataset-header">';
      html += '<h4 class="test-recon-dataset-title">' + escape(name) + ' <span class="' + statusClass + '">' + statusText + '</span></h4>';
      if (matchCount > 0) {
        html += '<label class="recon-toggle-match"><input type="checkbox" onchange="var t=document.getElementById(\'' + tableId + '\');if(t)t.classList.toggle(\'recon-hide-match\',this.checked)"> Hide ' + matchCount + ' matching row' + (matchCount !== 1 ? 's' : '') + '</label>';
      }
      html += '</div>';

      // Stats bar
      html += '<div class="recon-stats-bar">';
      html += '<span class="recon-stat recon-stat-match">✓ <strong>' + matchCount + '</strong> matching</span>';
      if (diffCount > 0) html += '<span class="recon-stat recon-stat-diff">△ <strong>' + diffCount + '</strong> with differences</span>';
      if (onlyExpCount > 0) html += '<span class="recon-stat recon-stat-exp">− <strong>' + onlyExpCount + '</strong> only in expected</span>';
      if (onlyGenCount > 0) html += '<span class="recon-stat recon-stat-gen">+ <strong>' + onlyGenCount + '</strong> only in generated</span>';
      html += '</div>';

      // Row matching method: by key or by position
      if (keyCol && genKeyCol) {
        html += '<div class="recon-col-mapping-note recon-key-note">🔑 Rows matched by key column: <code>' + escape(keyCol) + '</code> (same key in expected and generated; order does not matter).</div>';
      } else {
        html += '<div class="recon-col-mapping-note recon-key-warning">⚠ No key column detected — rows compared by position. For different record order, include an ID-like column (e.g. <code>id</code>, <code>*_id</code>, <code>*_no</code>, <code>account</code>) so records are matched by key.</div>';
      }

      // Column normalization note
      var remappedCols = expCols.filter(function (ec) { return colMap[ec] && colMap[ec] !== ec; });
      if (remappedCols.length > 0) {
        html += '<div class="recon-col-mapping-note">ℹ Column names matched by normalization: ';
        html += remappedCols.map(function (ec) { return '<code>' + escape(ec) + '</code> ↔ <code>' + escape(colMap[ec]) + '</code>'; }).join(', ');
        html += '</div>';
      }
      var unmappedExpCols = expCols.filter(function (ec) { return !colMap[ec]; });
      if (unmappedExpCols.length > 0) {
        html += '<div class="recon-col-mapping-note recon-col-warning">⚠ Expected column(s) not found in generated output: ' + unmappedExpCols.map(function (c) { return '<code>' + escape(c) + '</code>'; }).join(', ') + '</div>';
      }

      // Unified diff table
      var cap = 200;
      html += '<div class="test-recon-table-scroll"><table id="' + tableId + '" class="test-table test-recon-table recon-unified-table">';
      html += '<thead><tr>';
      html += '<th class="recon-th-row">#</th>';
      html += '<th class="recon-th-source">Source</th>';
      allCols.forEach(function (c) { html += '<th>' + escape(c) + '</th>'; });
      html += '</tr></thead><tbody>';

      var shownCount = 0;
      pairs.forEach(function (pair, pi) {
        if (shownCount >= cap) return;
        var rowNum = pi + 1;

        if (!pair.gen) {
          // Row only in expected
          shownCount++;
          html += '<tr class="recon-row-only-exp">';
          html += '<td class="recon-td-row">' + rowNum + '</td>';
          html += '<td class="recon-source-label recon-source-exp">Exp only</td>';
          allCols.forEach(function (ec) {
            var v = pair.exp ? pair.exp[ec] : undefined;
            html += '<td>' + escape(v != null ? String(v) : '') + '</td>';
          });
          html += '</tr>';

        } else if (!pair.exp) {
          // Row only in generated
          shownCount++;
          html += '<tr class="recon-row-only-gen">';
          html += '<td class="recon-td-row">' + rowNum + '</td>';
          html += '<td class="recon-source-label recon-source-gen">Gen only</td>';
          allCols.forEach(function (ec) {
            var gc = colMap[ec] || ec;
            var v = pair.gen[gc];
            html += '<td>' + escape(v != null ? String(v) : '') + '</td>';
          });
          html += '</tr>';

        } else {
          // Matched pair — find which cells differ
          var diffCols = {};
          allCols.forEach(function (ec) {
            var gc = colMap[ec] || ec;
            if (normalizeReconValue(pair.exp[ec]) !== normalizeReconValue(pair.gen[gc])) {
              diffCols[ec] = true;
            }
          });
          var hasDiff = Object.keys(diffCols).length > 0;
          shownCount++;

          if (!hasDiff) {
            // Perfect match — single row, no cell highlighting
            html += '<tr class="recon-row-match">';
            html += '<td class="recon-td-row">' + rowNum + '</td>';
            html += '<td class="recon-source-label recon-source-ok">✓</td>';
            allCols.forEach(function (ec) {
              var v = pair.exp[ec];
              html += '<td>' + escape(v != null ? String(v) : '') + '</td>';
            });
            html += '</tr>';
          } else {
            // Two sub-rows: Expected on top, Generated below; only diff cells highlighted
            html += '<tr class="recon-row-diff-exp">';
            html += '<td class="recon-td-row" rowspan="2">' + rowNum + '</td>';
            html += '<td class="recon-source-label recon-source-exp">Exp</td>';
            allCols.forEach(function (ec) {
              var v = pair.exp[ec];
              var cls = diffCols[ec] ? ' class="recon-cell-diff recon-cell-exp-val"' : '';
              html += '<td' + cls + '>' + escape(v != null ? String(v) : '') + '</td>';
            });
            html += '</tr>';
            html += '<tr class="recon-row-diff-gen">';
            html += '<td class="recon-source-label recon-source-gen">Gen</td>';
            allCols.forEach(function (ec) {
              var gc = colMap[ec] || ec;
              var v = pair.gen[gc];
              var cls = diffCols[ec] ? ' class="recon-cell-diff recon-cell-gen-val"' : '';
              html += '<td' + cls + '>' + escape(v != null ? String(v) : '') + '</td>';
            });
            html += '</tr>';
          }
        }
      });

      if (pairs.length > cap) {
        html += '<tr><td colspan="' + (allCols.length + 2) + '" class="test-recon-more">… ' + (pairs.length - cap) + ' more rows not shown</td></tr>';
      }
      html += '</tbody></table></div>';
      html += '</div>'; // test-recon-dataset
    });

    container.innerHTML = html || '<p class="test-recon-placeholder">No output datasets to compare.</p>';
  }

  var outputCtaEl = document.getElementById('test-logs-output-cta');
  var showOutputBtn = document.getElementById('btn-show-output');
  var showReconciliationBtnOutput = document.getElementById('btn-show-reconciliation-output');
  function goToReconciliation() {
    switchTestTab('reconciliation');
    if (typeof renderReconciliation === 'function') renderReconciliation();
  }
  if (showOutputBtn) showOutputBtn.addEventListener('click', function () { switchTestTab('output'); });
  if (showReconciliationBtnOutput) showReconciliationBtnOutput.addEventListener('click', goToReconciliation);

  var runDataflowBtn = document.getElementById('btn-run-dataflow');
  if (runDataflowBtn) runDataflowBtn.addEventListener('click', function () {
    if (!currentPath) {
      (window.CodeParser.showMessagePopup || showMessagePopup)('Error', 'Select a configuration first.', 'error');
      return;
    }
    var logsEl = document.getElementById('test-logs');
    var outputTables = document.getElementById('test-output-tables');
    runDataflowBtn.disabled = true;
    runDataflowBtn.textContent = 'Running...';
    if (outputCtaEl) outputCtaEl.classList.add('hidden');
    var reconCtaOutput = document.getElementById('test-output-recon-cta');
    if (reconCtaOutput) reconCtaOutput.classList.add('hidden');
    if (showReconciliationBtnOutput) showReconciliationBtnOutput.classList.add('hidden');
    var logsProgressEl = document.getElementById('test-logs-progress');
    if (logsProgressEl) logsProgressEl.classList.remove('hidden');
    setTestLogsContent(logsEl, 'Dataflow job is running.\n');
    if (outputTables) outputTables.innerHTML = '<p class="test-output-placeholder">Running… Results will appear here when the run completes.</p>';
    switchTestTab('logs');
    API.runDataflowTestStream({
      config_path: currentPath,
      sample_data: lastTestSampleData,
      num_rows: 5
    }).then(function (response) {
      if (!response.ok) throw new Error(response.statusText || 'Request failed');
      if (!response.body) throw new Error('Stream not supported');
      return response.body.getReader();
    }).then(function (reader) {
      var decoder = new TextDecoder();
      var buf = '';
      function processLine(line) {
        if (line.startsWith('LOG: ')) {
          appendTestLogsContent(logsEl, line.slice(5) + '\n');
          if (logsEl) logsEl.scrollTop = logsEl.scrollHeight;
        } else if (line.startsWith('RESULT: ')) {
          try {
            var res = JSON.parse(line.slice(8));
            lastGeneratedOutput = res.outputs || {};
            runDataflowBtn.disabled = false;
            runDataflowBtn.textContent = 'Run dataflow';
            if (logsProgressEl) logsProgressEl.classList.add('hidden');
            if (outputCtaEl) outputCtaEl.classList.remove('hidden');
            if (logsEl) {
              if (res.error) {
                appendTestLogsContent(logsEl, '\nDataflow job failed.\nError: ' + (res.error || 'Unknown error') + '\n');
              } else {
                appendTestLogsContent(logsEl, '\nDataflow completed.\n');
              }
            }
            var hasExpected = currentPath && uploadedTestData[currentPath] && uploadedTestData[currentPath].expected_output && Object.keys(uploadedTestData[currentPath].expected_output).length > 0;
            var reconCtaOutput = document.getElementById('test-output-recon-cta');
            if (hasExpected && !res.error && Object.keys(res.outputs || {}).length > 0) {
              if (reconCtaOutput) reconCtaOutput.classList.remove('hidden');
              if (showReconciliationBtnOutput) showReconciliationBtnOutput.classList.remove('hidden');
            } else {
              if (reconCtaOutput) reconCtaOutput.classList.add('hidden');
              if (showReconciliationBtnOutput) showReconciliationBtnOutput.classList.add('hidden');
            }
            if (outputTables) {
              outputTables.innerHTML = '';
              var outputs = res.outputs || {};
              var outputNames = Object.keys(outputs);
              outputNames.forEach(function (name) {
                var rows = outputs[name] || [];
                var cols = rows[0] ? Object.keys(rows[0]).filter(function (k) { return !k.startsWith('_'); }) : [];
                if (cols.length === 0 && rows.length === 0) return;
                if (cols.length === 0) cols = rows[0] ? Object.keys(rows[0]) : [];
                var html = '<div class="test-table-wrap"><h3>' + (window.CodeParser.escapeHtml || escapeHtml)(name) + '</h3><table class="test-table"><thead><tr>' +
                  cols.map(function (c) { return '<th>' + (window.CodeParser.escapeHtml || escapeHtml)(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
                rows.slice(0, 10).forEach(function (r) {
                  html += '<tr>' + cols.map(function (c) { return '<td>' + (window.CodeParser.escapeHtml || escapeHtml)(String(r[c] != null ? r[c] : '')) + '</td>'; }).join('') + '</tr>';
                });
                html += '</tbody></table></div>';
                outputTables.insertAdjacentHTML('beforeend', html);
              });
              if (outputNames.length === 0 && res.error) {
                outputTables.innerHTML = '<p class="test-error">' + (window.CodeParser.escapeHtml || escapeHtml)(res.error) + '</p>';
              } else if (outputNames.length === 0 && !res.error) {
                outputTables.innerHTML = '<p class="test-output-empty">No output data was returned. The job may have written to a path we could not read.</p>';
              } else if (outputNames.length > 0 && outputTables.innerHTML === '') {
                outputTables.innerHTML = '<p class="test-output-empty">Output datasets are empty.</p>';
              }
            }
          } catch (e) {}
        }
      }

      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            if (buf) processLine(buf);
            return;
          }
          buf += decoder.decode(chunk.value);
          var lines = buf.split('\n');
          buf = lines.pop() || '';
          lines.forEach(processLine);
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      runDataflowBtn.disabled = false;
      runDataflowBtn.textContent = 'Run dataflow';
      var p = document.getElementById('test-logs-progress');
      if (p) p.classList.add('hidden');
      if (outputCtaEl) outputCtaEl.classList.remove('hidden');
      var reconCtaOutput = document.getElementById('test-output-recon-cta');
      if (reconCtaOutput) reconCtaOutput.classList.add('hidden');
      if (showReconciliationBtnOutput) showReconciliationBtnOutput.classList.add('hidden');
      var errMsg = err && (err.message || String(err)) ? (err.message || String(err)) : 'Request failed or stream ended unexpectedly.';
      if (logsEl) appendTestLogsContent(logsEl, '\nDataflow job failed.\nError: ' + errMsg + '\n');
    });
  });

  // Import Datasets tab functionality
  (function() {
    let existingConfigs = [];
    let selectedConfig = null;
    let datasetFiles = {}; // Store files per dataset key

    function formatFileSize(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function renderDatasetUploadItems() {
      const uploadSection = document.getElementById('file-upload-section');
      const startTestingContainer = document.getElementById('start-testing-container');
      
      if (!selectedConfig) {
        uploadSection.innerHTML = '<p style="color: var(--text-secondary); font-size: 12px;">Select a configuration to see dataset upload options</p>';
        startTestingContainer.classList.add('hidden');
        return;
      }

      const inputs = selectedConfig.Inputs || {};
      const outputs = selectedConfig.Outputs || {};
      const allDatasets = { ...inputs, ...outputs };

      if (Object.keys(allDatasets).length === 0) {
        uploadSection.innerHTML = '<p style="color: var(--text-secondary); font-size: 12px;">No datasets found in selected configuration</p>';
        startTestingContainer.classList.add('hidden');
        return;
      }

      uploadSection.innerHTML = Object.entries(allDatasets).map(([datasetKey, dataset]) => {
        const hasFile = datasetFiles[datasetKey] && datasetFiles[datasetKey].file;
        const file = hasFile ? datasetFiles[datasetKey].file : null;
        const datasetType = inputs[datasetKey] ? 'input' : 'output';
        
        return `
          <div class="dataset-upload-item" data-dataset-key="${datasetKey}" data-dataset-type="${datasetType}">
            <div class="dataset-upload-header">
              <div class="dataset-upload-info">
                <div class="dataset-upload-name">
                  ${dataset.name || datasetKey}
                  <span class="dataset-upload-format">${dataset.format || 'unknown'}</span>
                </div>
                <div class="dataset-upload-path">${dataset.path || 'N/A'}</div>
              </div>
              <div class="dataset-upload-actions">
                <button type="button" class="btn-upload-file ${hasFile ? 'has-file' : ''}" 
                        data-dataset-key="${datasetKey}" data-dataset-type="${datasetType}">
                  ${hasFile ? '✓ File Uploaded' : 'Upload File'}
                </button>
                ${hasFile ? `<button type="button" class="btn-remove-file" data-dataset-key="${datasetKey}">Remove</button>` : ''}
              </div>
            </div>
            ${hasFile ? `
              <div class="dataset-file-info">
                <span class="dataset-file-name">${file.name}</span>
                <span class="dataset-file-size">${formatFileSize(file.size)}</span>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      // Add event listeners for upload buttons
      uploadSection.querySelectorAll('.btn-upload-file').forEach(btn => {
        btn.addEventListener('click', function() {
          const datasetKey = this.getAttribute('data-dataset-key');
          const datasetType = this.getAttribute('data-dataset-type');
          
          // Create a hidden file input
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = '.csv,.txt,.json,.parquet';
          fileInput.style.display = 'none';
          
          fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
              datasetFiles[datasetKey] = {
                file: file,
                dataset: selectedConfig.Inputs[datasetKey] || selectedConfig.Outputs[datasetKey],
                type: datasetType
              };
              renderDatasetUploadItems();
            }
            document.body.removeChild(fileInput);
          });
          
          document.body.appendChild(fileInput);
          fileInput.click();
        });
      });

      // Add event listeners for remove buttons
      uploadSection.querySelectorAll('.btn-remove-file').forEach(btn => {
        btn.addEventListener('click', function() {
          const datasetKey = this.getAttribute('data-dataset-key');
          delete datasetFiles[datasetKey];
          renderDatasetUploadItems();
        });
      });

      // Show/hide start testing button based on input files upload status
      const inputDatasets = Object.keys(inputs);
      const allInputsUploaded = inputDatasets.every(key => datasetFiles[key] && datasetFiles[key].file);
      
      if (allInputsUploaded && inputDatasets.length > 0) {
        startTestingContainer.classList.remove('hidden');
      } else {
        startTestingContainer.classList.add('hidden');
      }
    }

    function loadExistingConfigs() {
      API.configs().then(data => {
        existingConfigs = data.configs || [];
        const select = document.getElementById('existing-config-select');
        if (select) {
          select.innerHTML = '<option value="">-- Select existing configuration --</option>' +
            existingConfigs.map(config => 
              `<option value="${config.path}">${config.name}</option>`
            ).join('');
        }
      }).catch(err => {
        console.error('Failed to load configs:', err);
      });
    }

    function renderConfigDetails(config) {
      const inputsContent = document.getElementById('config-inputs-content');
      const outputsContent = document.getElementById('config-outputs-content');
      const configInfo = document.getElementById('selected-config-info');

      if (!config) {
        configInfo.classList.add('hidden');
        renderDatasetUploadItems();
        return;
      }

      // Render inputs
      const inputs = config.Inputs || {};
      inputsContent.innerHTML = Object.keys(inputs).length > 0 ? 
        Object.entries(inputs).map(([key, input]) => `
          <div class="config-mapping-item">
            <div>
              <div class="config-mapping-name">${input.name || key}</div>
              <div class="config-mapping-path">${input.path || 'N/A'}</div>
            </div>
            <span class="config-mapping-format">${input.format || 'unknown'}</span>
          </div>
        `).join('') :
        '<p style="color: var(--text-secondary); font-size: 12px;">No input datasets found</p>';

      // Render outputs
      const outputs = config.Outputs || {};
      outputsContent.innerHTML = Object.keys(outputs).length > 0 ?
        Object.entries(outputs).map(([key, output]) => `
          <div class="config-mapping-item">
            <div>
              <div class="config-mapping-name">${output.name || key}</div>
              <div class="config-mapping-path">${output.path || 'N/A'}</div>
            </div>
            <span class="config-mapping-format">${output.format || 'unknown'}</span>
          </div>
        `).join('') :
        '<p style="color: var(--text-secondary); font-size: 12px;">No output datasets found</p>';

      configInfo.classList.remove('hidden');
      renderDatasetUploadItems();
    }

    // Existing config selection handler
    const configSelect = document.getElementById('existing-config-select');
    if (configSelect) {
      configSelect.addEventListener('change', async function() {
        const selectedPath = this.value;
        if (!selectedPath) {
          renderConfigDetails(null);
          selectedConfig = null;
          datasetFiles = {};
          return;
        }

        try {
          const response = await fetch(`/api/config/${encodeURIComponent(selectedPath)}`);
          if (response.ok) {
            const config = await response.json();
            selectedConfig = config;
            datasetFiles = {}; // Reset files when config changes
            renderConfigDetails(config);
          } else {
            console.error('Failed to load config:', selectedPath);
            renderConfigDetails(null);
            selectedConfig = null;
            datasetFiles = {};
          }
        } catch (error) {
          console.error('Error loading config:', error);
          renderConfigDetails(null);
          selectedConfig = null;
          datasetFiles = {};
        }
      });
    }

    // Start testing button handler
    const startTestingBtn = document.getElementById('btn-start-testing');
    if (startTestingBtn) {
      startTestingBtn.addEventListener('click', function() {
        if (!selectedConfig) {
          const messageEl = document.getElementById('import-json-message');
          messageEl.textContent = 'Please select a configuration first';
          messageEl.style.color = 'var(--error, #c62828)';
          return;
        }

        // Check if input files are uploaded (required for testing)
        const inputs = selectedConfig.Inputs || {};
        const missingInputs = Object.keys(inputs).filter(key => !datasetFiles[key]);
        
        if (missingInputs.length > 0) {
          const messageEl = document.getElementById('import-json-message');
          messageEl.textContent = `Please upload files for all input datasets. Missing: ${missingInputs.join(', ')}`;
          messageEl.style.color = 'var(--error, #c62828)';
          return;
        }

        // Prepare testing data
        const testingData = {
          config: selectedConfig,
          datasetFiles: datasetFiles,
          inputFiles: Object.keys(datasetFiles).filter(key => datasetFiles[key].type === 'input').map(key => datasetFiles[key].file),
          outputFiles: Object.keys(datasetFiles).filter(key => datasetFiles[key].type === 'output').map(key => datasetFiles[key].file)
        };

        // Store for testing and navigate to test page
        sessionStorage.setItem('testingData', JSON.stringify(testingData));
        
        // Navigate to test page
        const testPage = document.getElementById('test-page');
        const importPage = document.getElementById('import-page');
        const mainContent = document.querySelector('.main');
        
        if (testPage && importPage && mainContent) {
          importPage.classList.add('hidden');
          mainContent.classList.add('hidden');
          testPage.classList.remove('hidden');
          
          // Update page title
          document.getElementById('test-page-config-name').textContent = selectedConfig.name || 'Selected Configuration';
          
          // Switch to Input Datasets tab first
          setTimeout(() => {
            if (typeof switchTestTab === 'function') {
              switchTestTab('input');
            }
          }, 100);
        }
      });
    }

    // Initialize
    loadExistingConfigs();
    renderDatasetUploadItems();
  })();

  API.configs().then(data => {
    renderConfigList(data.configs || []);
  }).catch(() => renderConfigList([]));
})();
