(function () {
  var API = window.CodeParser && window.CodeParser.API;
  var escapeHtml = window.CodeParser && window.CodeParser.escapeHtml;
  var showMessagePopup = window.CodeParser && window.CodeParser.showMessagePopup;
  var showErrorPopup = window.CodeParser && window.CodeParser.showErrorPopup;
  var closeMessageModal = window.CodeParser && window.CodeParser.closeMessageModal;
  var closeErrorModal = window.CodeParser && window.CodeParser.closeErrorModal;
  /* Slide-in toast helper — non-blocking success/info notifications.
     Falls back to showMessagePopup if studio is not loaded yet. */
  function toast(msg, type) {
    if (window.studioToast) { window.studioToast(msg, type || 'success'); return; }
    if (showMessagePopup) showMessagePopup(type === 'error' ? 'Error' : 'Info', msg, type || 'info');
  }

  if (!API) { console.error('CodeParser API not loaded'); return; }

  let currentConfig = null;
  let currentPath = null;
  let editMode = false;
  let configViewMode = 'diagram'; // 'diagram' | 'json'
  let jsonEditorDirty = false;
  let jsonEditorView = 'tree'; // always tree
  let canvasDirtySnapshot = null; // JSON snapshot for dirty detection
  window.CodeParser.hoverPopupsEnabled = true;

  /* ── Canvas dirty tracking ── */
  function getCanvasStateJson() {
    if (window.studioGetJson) {
      try { return JSON.stringify(window.studioGetJson()); } catch(e) { return null; }
    }
    return null;
  }
  function isCanvasDirty() {
    if (!canvasDirtySnapshot) return false;
    var current = getCanvasStateJson();
    if (!current) return false;
    return current !== canvasDirtySnapshot;
  }
  function updateCanvasSnapshot() {
    canvasDirtySnapshot = getCanvasStateJson();
  }
  window.updateCanvasSnapshot = updateCanvasSnapshot;
  window._isCanvasDirty = isCanvasDirty;

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
    var $viewerEl = $('#json-viewer');
    if (!$viewerEl.length) return;
    if (!currentConfig) {
      $viewerEl.html('<span class="json-null">null</span>');
      return;
    }
    try {
      $viewerEl.html(buildJsonViewerHtml(currentConfig, 0));
    } catch (e) {
      $viewerEl.html('<span class="json-null">Invalid config</span>');
    }
    $viewerEl.find('.json-fold-toggle').each(function () {
      var $el = $(this);
      $el.on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var $line = $el.closest('.json-line');
        var $block = $line.next();
        if ($block.length && $block.hasClass('json-block')) {
          $block.toggleClass('collapsed');
          if ($line.length) $line.toggleClass('is-collapsed', $block.hasClass('collapsed'));
        }
      });
      $el.on('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $el[0].click(); } });
    });
    // Default: collapse root-level sections (Inputs, Outputs, Transformations) for readable first view
    var $rootBlock = $viewerEl.children('.json-block').first();
    var $rootInner = $rootBlock.children('.json-block-inner').first();
    if ($rootInner.length) {
      $rootInner.children('.json-block').each(function () {
        var $block = $(this);
        $block.addClass('collapsed');
        var $prev = $block.prev();
        if ($prev.length && $prev.hasClass('json-line')) $prev.addClass('is-collapsed');
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
    var $span = $(span);
    var pathStr = $span.attr('data-path');
    var type = $span.attr('data-type') || 'string';
    if (!pathStr || !currentConfig) return;
    var path = JSON.parse(pathStr);
    var current = getByPath(currentConfig, path);
    var displayVal = type === 'string' ? (typeof current === 'string' ? current : '') : String(current);
    var $input = $('<input>');
    $input.attr('type', 'text');
    $input.addClass('json-tree-edit-input');
    $input.val(displayVal);
    $input.attr('data-path', pathStr);
    $input.attr('data-type', type);
    $span.hide();
    $span.parent().append($input);
    $input.focus();
    $input[0].select();
    function finish() {
      var val = parseTreeValue($input.val(), type);
      setByPath(currentConfig, path, val);
      $input.remove();
      $span.show();
      renderJsonTreeView();
      setJsonEditorDirty(true);
      var $applyBtn = $('#json-editor-apply-btn');
      if ($applyBtn.length) $applyBtn.removeClass('hidden');
    }
    $input.on('blur', finish);
    $input.on('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $input[0].blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        $input.val(displayVal);
        $input.remove();
        $span.show();
      }
    });
  }

  function getJsonTreeSearchTerm() {
    var $input = $('#json-editor-search-input');
    return $input.length && $input.val() ? $input.val().trim() : '';
  }
  function renderJsonTreeView() {
    var $treeEl = $('#json-tree-view');
    if (!$treeEl.length) return;
    if (!currentConfig) {
      $treeEl.html('<span class="json-null">null</span>');
      return;
    }
    var searchTerm = getJsonTreeSearchTerm();
    try {
      $treeEl.html(buildJsonTreeHtml(currentConfig, null, 0, [], searchTerm));
    } catch (e) {
      $treeEl.html('<span class="json-null">Invalid config</span>');
    }
    if (jsonTreeFontSize) $treeEl.css('fontSize', jsonTreeFontSize + 'px');
    $treeEl.find('.json-tree-row').each(function () {
      var $row = $(this);
      var $node = $row.closest('.json-tree-node');
      if (!$node.length || !$node.hasClass('json-tree-branch')) return;
      $row.on('click', function (e) {
        if ($(e.target).closest('.json-tree-value').length) return;
        e.preventDefault();
        e.stopPropagation();
        $node.toggleClass('collapsed');
      });
      $row.on('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $row[0].click(); } });
    });
    $treeEl.find('.json-tree-value[data-path]').each(function () {
      var $span = $(this);
      $span.addClass('json-tree-value-editable');
      $span.on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startTreeValueEdit($span[0]);
      });
    });
    var $root = $treeEl.find('.json-tree-node.json-tree-branch').first();
    if ($root.length) {
      $root.children('.json-tree-children').children('.json-tree-node.json-tree-branch').each(function () {
        $(this).addClass('collapsed');
      });
    }
  }

  function setJsonEditorView(view) {
    jsonEditorView = view;
    var $textTab = $('#json-editor-tab-text');
    var $treeTab = $('#json-editor-tab-tree');
    var $textEl = $('#json-editor-text');
    var $treeEl = $('#json-tree-view');
    if ($textTab.length) { $textTab.toggleClass('active', view === 'text'); $textTab.attr('aria-selected', view === 'text'); }
    if ($treeTab.length) { $treeTab.toggleClass('active', view === 'tree'); $treeTab.attr('aria-selected', view === 'tree'); }
    if ($textEl.length) $textEl.toggleClass('hidden', view !== 'text');
    if ($treeEl.length) {
      $treeEl.toggleClass('hidden', view !== 'tree');
      if (view === 'tree') renderJsonTreeView();
    }
  }

  function updateJsonEditorMode() {
    var $treeEl = $('#json-tree-view');
    var $applyBtn = $('#json-editor-apply-btn');
    if ($treeEl.length) {
      $treeEl.removeClass('hidden');
      renderJsonTreeView();
    }
    if ($applyBtn.length) $applyBtn.toggleClass('hidden', !jsonEditorDirty);
  }

  function getConfigJsonString() {
    if (!currentConfig) return '';
    try { return JSON.stringify(currentConfig, null, 2); } catch (e) { return ''; }
  }

  function setJsonEditorDirty(dirty) {
    jsonEditorDirty = dirty;
    var $applyBtn = $('#json-editor-apply-btn');
    if ($applyBtn.length) $applyBtn.toggleClass('hidden', !dirty);
  }

  const $configList = $('#config-list');
  const $searchInput = $('#search-input');
  const $searchResults = $('#search-results');
  const $diagramContainer = $('#diagram-container');
  const $emptyState = $('#empty-state');
  const $currentFileEl = $('#current-file');
  const $detailDrawer = $('#detail-drawer');
  const $logicModalTitle = $('#logic-modal-title');
  const $logicModalClose = $('#logic-modal-close');
  const $detailDrawerBackdrop = $('#detail-drawer-backdrop');
  const $stepEditPanel = $('#step-edit-panel');
  const $stepEditPanelClose = $('#step-edit-panel-close');
  const $stepEditPanelBackdrop = $('#step-edit-panel-backdrop');
  const $editSave = $('#edit-save');
  const $editDelete = $('#edit-delete');
  const $renameModal = $('#rename-modal');
  const $renameInput = $('#rename-input');
  const $renameCancel = $('#rename-cancel');
  const $renameSubmit = $('#rename-submit');
  const $renameModalClose = $('#rename-modal-close');
  const $deleteModal = $('#delete-modal');
  const $deleteMessage = $('#delete-message');
  const $deleteCancel = $('#delete-cancel');
  const $deleteConfirm = $('#delete-confirm');
  const $deleteModalClose = $('#delete-modal-close');
  const $errorModal = $('#error-modal');
  const $errorModalTitle = $('#error-modal-title');
  const $errorModalMessage = $('#error-modal-message');
  const $errorModalDetails = $('#error-modal-details');
  const $messageModal = $('#message-modal');
  const $messageModalTitle = $('#message-modal-title');
  const $messageModalBody = $('#message-modal-body');
  const $messageModalHeader = $('#message-modal-header');
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
    $('#edit-id').val(s.id || '');
    $('#edit-description').val(s.description || '');
    $('#edit-type').val(s.type || 'select');
    $('#edit-logic').val(JSON.stringify(s.logic || {}, null, 2));
    $('#edit-source-inputs').val(Array.isArray(s.source_inputs) ? s.source_inputs.join(', ') : '');
    $('#edit-output-alias').val(s.output_alias || '');
    if ($stepEditPanel.length) {
      $stepEditPanel.attr('data-step-index', String(info.index));
      $stepEditPanel.addClass('open');
    }
  }

  function closeStepEditPanel() {
    if ($stepEditPanel.length) $stepEditPanel.removeClass('open');
  }

  function closeModals() {
    if ($detailDrawer.length) $detailDrawer.removeClass('open');
    closeStepEditPanel();
  }

  if ($logicModalClose.length) $logicModalClose.on('click', closeModals);
  if ($detailDrawerBackdrop.length) $detailDrawerBackdrop.on('click', closeModals);
  if ($stepEditPanelClose.length) $stepEditPanelClose.on('click', closeStepEditPanel);
  if ($stepEditPanelBackdrop.length) $stepEditPanelBackdrop.on('click', closeStepEditPanel);

  var $logicToggleVisual = $('#logic-toggle-visual');
  var $logicToggleKv = $('#logic-toggle-kv');
  var $logicToggleJson = $('#logic-toggle-json');
  if ($logicToggleVisual.length) $logicToggleVisual.on('click', function () { (window.CodeParser.setLogicViewMode)('visual'); });
  if ($logicToggleKv.length) $logicToggleKv.on('click', function () { (window.CodeParser.setLogicViewMode)('kv'); });
  if ($logicToggleJson.length) $logicToggleJson.on('click', function () { (window.CodeParser.setLogicViewMode)('json'); });

  $editSave.on('click', () => {
    const stepIndex = parseInt($stepEditPanel.length && $stepEditPanel.attr('data-step-index'), 10);
    if (isNaN(stepIndex) || !currentConfig) return;
    const steps = (currentConfig.Transformations || currentConfig.transformations || {}).steps || [];
    if (!steps[stepIndex]) return;
    let logic = {};
    try {
      logic = JSON.parse($('#edit-logic').val());
    } catch (e) {
      showMessagePopup('Invalid Logic', 'The Logic field must be valid JSON.', 'error');
      return;
    }
    const srcInput = $('#edit-source-inputs').val() || '';
    const source_inputs = srcInput.split(',').map(x => x.trim()).filter(Boolean);
    steps[stepIndex] = {
      id: $('#edit-id').val() || steps[stepIndex].id,
      description: $('#edit-description').val(),
      type: $('#edit-type').val(),
      source_inputs,
      logic,
      output_alias: $('#edit-output-alias').val()
    };
    currentConfig.Transformations = currentConfig.Transformations || {};
    currentConfig.Transformations.steps = steps;
    closeStepEditPanel();
    initNetwork($('#network')[0], currentConfig);
    if (currentPath) {
      API.saveConfig(currentPath, currentConfig).then(function (res) {
        if (res.error) showMessagePopup('Save failed', res.error, 'error');
        else toast('Interface saved', 'success');
      }).catch(function (err) { showMessagePopup('Save failed', err.message || String(err), 'error'); });
    }
  });

  $editDelete.on('click', () => {
    const stepIndex = parseInt($stepEditPanel.length && $stepEditPanel.attr('data-step-index'), 10);
    if (isNaN(stepIndex) || !currentConfig) return;
    const steps = (currentConfig.Transformations || currentConfig.transformations || {}).steps || [];
    steps.splice(stepIndex, 1);
    currentConfig.Transformations = currentConfig.Transformations || {};
    currentConfig.Transformations.steps = steps;
    closeStepEditPanel();
    initNetwork($('#network')[0], currentConfig);
    if (currentPath) {
      API.saveConfig(currentPath, currentConfig).then(function (res) {
        if (res.error) showMessagePopup('Save failed', res.error, 'error');
        else toast('Interface saved', 'success');
      }).catch(function (err) { showMessagePopup('Save failed', err.message || String(err), 'error'); });
    }
  });

  function applyConfigInView(path, config) {
    if (!config || config.error) return;
    currentConfig = config;
    currentPath = path;
    editMode = false;
    if ($currentFileEl.length) $currentFileEl.text(path || '');
    if ($emptyState.length) $emptyState.addClass('hidden');
    if ($diagramContainer.length) $diagramContainer.addClass('visible');
    var $diagramEditBtn = $('#diagram-edit-btn');
    if ($diagramEditBtn.length) $diagramEditBtn.removeClass('active');
    if (configViewMode === 'json' && typeof syncJsonEditorFromConfig === 'function') syncJsonEditorFromConfig();
    /* Show the full header toolbar (buttons moved from cmb-actions to header) */
    var $hab = $('#header-action-btns');
    if ($hab.length) $hab.css('display', 'flex');
    /* Highlight active config in left panel list */
    $('#config-list li').each(function () {
      var $li = $(this);
      $li.toggleClass('active', $li.attr('data-path') === path);
    });
    var $container = $('#network');
    if ($container.length) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            initNetwork($container[0], config);
          } catch (e) {
            console.error(e);
            (window.CodeParser.showErrorPopup || showErrorPopup)('Diagram error', e.message || String(e), e.stack || '');
          }
          /* Snapshot clean state after canvas is built */
          setTimeout(updateCanvasSnapshot, 150);
        });
      });
    }
  }

  function loadConfig(path) {
    API.getConfig(path).then(config => {
      if (config && config.error) {
        showErrorPopup('Error loading interface', config.error, config.details != null ? String(config.details) : '');
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
  /* Expose so index.html bottom-panel toggle can trigger it */
  window.loadTestSampleData = loadTestSampleData;

  /* Allow the studio inline scripts to fully reset the "current config" state */
  window.studioResetCurrentPath = function () {
    currentPath   = null;
    currentConfig = null;
    /* Hide header toolbar (shown only when a config is loaded) */
    var $hab = $('#header-action-btns');
    if ($hab.length) $hab.hide();
    /* Remove the active highlight from whichever row was selected */
    $('#config-list li').removeClass('active');
    /* Clear header config display */
    var $headerDisplay = $('#header-config-display');
    var $headerName    = $('#header-config-name');
    if ($headerDisplay.length) $headerDisplay.hide();
    if ($headerName.length)    $headerName.text('');
    /* Clear the center-mode title strip */
    var $centerTitle = $('#center-config-title');
    if ($centerTitle.length) $centerTitle.text('');
    /* Clear hidden toolbar input */
    var $cnInput = $('#toolbar-config-name');
    if ($cnInput.length) $cnInput.val('');
  };

  /* ── Expose JSON-tree helpers for Studio overlay ── */
  window.buildJsonTreeHtml = buildJsonTreeHtml;
  window.parseTreeValue    = parseTreeValue;
  window.getByPath         = getByPath;
  window.setByPath         = setByPath;
  window.escapeHtmlForJson = escapeHtmlForJson;

  function renderConfigList(configs) {
    $configList.html('');
    /* Expose configs list globally so the new-config modal can check for duplicates */
    window._currentConfigsList = configs || [];
    (configs || []).forEach(c => {
      const path = c.path || c.name;
      /* Display without .json extension */
      const displayName = path.replace(/\.json$/i, '');
      const $li = $('<li>');
      $li.attr('data-path', path);
      $li[0].className = 'config-list-item';
      /* Highlight if this is the currently loaded config */
      if (currentPath && currentPath === path) $li.addClass('active');
      const $label = $('<span>');
      $label.addClass('config-list-label');
      $label.text(displayName);
      $li.append($label);

      $li.on('click', () => {
        /* Guard: warn about unsaved canvas changes before switching */
        if (currentPath && currentPath !== path && isCanvasDirty()) {
          var _targetPath = path;
          var _$li = $li;
          window.studioConfirm(
            'You have unsaved changes. Do you want to save before switching?',
            function() {
              /* Save current, then switch */
              var saveName = currentPath;
              if (!saveName.toLowerCase().endsWith('.json')) saveName += '.json';
              var cfg = window.studioGetJson ? window.studioGetJson() : null;
              if (cfg && window.CodeParser && window.CodeParser.API) {
                window.CodeParser.API.saveConfig(saveName, cfg).then(function() {
                  updateCanvasSnapshot();
                  $('#config-list li').removeClass('active');
                  _$li.addClass('active');
                  loadConfig(_targetPath);
                }).catch(function() {
                  $('#config-list li').removeClass('active');
                  _$li.addClass('active');
                  loadConfig(_targetPath);
                });
              } else {
                $('#config-list li').removeClass('active');
                _$li.addClass('active');
                loadConfig(_targetPath);
              }
            },
            function() {
              /* Discard and switch */
              canvasDirtySnapshot = null;
              $('#config-list li').removeClass('active');
              _$li.addClass('active');
              loadConfig(_targetPath);
            }
          );
          return;
        }
        $('#config-list li').removeClass('active');
        $li.addClass('active');
        loadConfig(path);
      });

      $configList.append($li);
    });
  }

  function closeRenameModal() {
    $renameModal.addClass("hidden");
    renameDeleteTargetPath = null;
  }
  function closeDeleteModal() {
    $deleteModal.addClass("hidden");
    renameDeleteTargetPath = null;
  }

  if ($renameModalClose.length) $renameModalClose.on('click', closeRenameModal);
  if ($renameCancel.length) $renameCancel.on('click', closeRenameModal);
  if ($renameSubmit.length) $renameSubmit.on('click', () => {
    const path = renameDeleteTargetPath;
    const raw = $renameInput.val().trim();
    if (!raw || !path) { closeRenameModal(); return; }
    const name = raw.replace(/\.json$/i, '') + '.json';
    API.renameConfig(path, name).then(res => {
      if (res.error) showMessagePopup('Rename failed', res.error, 'error');
      else {
        closeRenameModal();
        refreshConfigList();
        if (currentPath === path) {
          currentPath = res.path;
          $currentFileEl.text(res.path);
          loadConfig(res.path);
        }
        toast('Interface renamed to <strong>' + escapeHtml(name) + '</strong>', 'success');
      }
    }).catch(() => showMessagePopup('Rename failed', 'Could not rename interface.', 'error'));
  });
  $renameInput.on('keydown', (e) => {
    if (e.key === 'Enter') $renameSubmit[0].click();
    if (e.key === 'Escape') closeRenameModal();
  });

  if ($deleteModalClose.length) $deleteModalClose.on('click', closeDeleteModal);
  if ($deleteCancel.length) $deleteCancel.on('click', closeDeleteModal);
  if ($deleteConfirm.length) $deleteConfirm.on('click', () => {
    const path = renameDeleteTargetPath;
    if (!path) { closeDeleteModal(); return; }
    API.deleteConfig(path).then(res => {
      if (res.error) showMessagePopup('Delete failed', res.error, 'error');
      else {
        closeDeleteModal();
        if (currentPath === path) {
          currentPath = null;
          currentConfig = null;
          $currentFileEl.text('Select an interface');
          $diagramContainer.removeClass('visible');
          $emptyState.removeClass('hidden');
          /* Hide header toolbar */
          var $hd = $('#header-action-btns');
          if ($hd.length) $hd.hide();
          var $cn = $('#toolbar-config-name');
          if ($cn.length) $cn.val('');
        }
        refreshConfigList();
        toast('Interface <strong>' + escapeHtml(path) + '</strong> has been deleted', 'success');
      }
    }).catch(() => showMessagePopup('Delete failed', 'Could not delete interface.', 'error'));
  });

  $renameModal.on('click', (e) => { if (e.target === $renameModal[0]) closeRenameModal(); });
  $deleteModal.on('click', (e) => { if (e.target === $deleteModal[0]) closeDeleteModal(); });

  if ($errorModal.length) {
    const $errClose = $('#error-modal-close');
    const $errCloseBtn = $('#error-modal-close-btn');
    if ($errClose.length) $errClose.on('click', closeErrorModal);
    if ($errCloseBtn.length) $errCloseBtn.on('click', closeErrorModal);
    $errorModal.on('click', (e) => { if (e.target === $errorModal[0]) closeErrorModal(); });
  }
  if ($messageModal.length) {
    const $msgClose = $('#message-modal-close');
    const $msgCloseBtn = $('#message-modal-close-btn');
    if ($msgClose.length) $msgClose.on('click', closeMessageModal);
    if ($msgCloseBtn.length) $msgCloseBtn.on('click', closeMessageModal);
    $messageModal.on('click', (e) => { if (e.target === $messageModal[0]) closeMessageModal(); });
  }

  (function () {
    var $layout = $('#layout');
    var $toggleBtn = $('#sidebar-toggle');
    var $toggleIcon = $('#sidebar-toggle-icon');
    var collapsedKey = 'config-engine-sidebar-collapsed';
    if ($layout.length && $toggleBtn.length) {
      if (localStorage.getItem(collapsedKey) === '1') $layout.addClass('sidebar-collapsed');
      if ($toggleIcon.length) $toggleIcon[0].className = $layout.hasClass('sidebar-collapsed') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-bars';
      $toggleBtn.on('click', function () {
        $layout.toggleClass('sidebar-collapsed');
        if ($toggleIcon.length) $toggleIcon[0].className = $layout.hasClass('sidebar-collapsed') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-bars';
        localStorage.setItem(collapsedKey, $layout.hasClass('sidebar-collapsed') ? '1' : '0');
      });
    }
  })();

  (function () {
    var $layout = $('#layout');
    var $importPage = $('#import-page');
    var $testPage = $('#test-page');
    var $settingsPage = $('#settings-page');
    var $navConfig = $('#nav-configurations');
    var $navImport = $('#nav-import');
    var $navSettings = $('#nav-settings');
    var pageKey = 'config-engine-page';
    function setNavActive($which) {
      [$navConfig, $navImport, $navSettings].forEach(function ($n) {
        if ($n.length) {
          $n.toggleClass('active', $n[0] === ($which && $which[0]));
          $n.attr('aria-current', $n[0] === ($which && $which[0]) ? 'page' : null);
        }
      });
    }
    function showConfigurations() {
      if ($layout.length) $layout.removeClass('hidden');
      if ($importPage.length) $importPage.addClass('hidden');
      if ($testPage.length) $testPage.addClass('hidden');
      if ($settingsPage.length) $settingsPage.addClass('hidden');
      setNavActive($navConfig);
      localStorage.setItem(pageKey, 'configurations');
    }
    function showTest() {
      if ($importPage.length) $importPage.addClass('hidden');
      if ($settingsPage.length) $settingsPage.addClass('hidden');
      setNavActive(null);
      localStorage.setItem(pageKey, 'test');
      if (typeof loadTestSampleData === 'function') loadTestSampleData();

      /* Open test panel with slide-up animation (half screen).
         Delegate to studio's animated opener if available (set by inline script),
         otherwise fall back to direct DOM manipulation. */
      if (typeof window.__studioOpenTestPanel === 'function') {
        window.__studioOpenTestPanel();
      } else if ($testPage.length) {
        $testPage.removeClass('hidden');
        void $testPage[0].offsetHeight; /* force reflow so CSS transition starts from height:0 */
        var _savedTH = parseInt(localStorage.getItem('studio_bottom_h'), 10);
        var _maxTH   = Math.floor(window.innerHeight * 0.80);
        $testPage.css('height', (_savedTH >= 120 && _savedTH <= _maxTH)
          ? _savedTH + 'px'
          : Math.floor(window.innerHeight * 0.50) + 'px'); /* half screen */
      }

      /* Diagram and panels stay as-is — no collapse, no auto-layout, no fit */
    }
    function showImport() {
      if ($layout.length) $layout.addClass('hidden');
      if ($importPage.length) $importPage.removeClass('hidden');
      if ($testPage.length) $testPage.addClass('hidden');
      if ($settingsPage.length) $settingsPage.addClass('hidden');
      setNavActive($navImport);
      localStorage.setItem(pageKey, 'import');
      updateImportParsingMode();
    }
    function updateImportParsingMode() {
      var $el = $('#import-parsing-mode');
      var api = window.CodeParser && window.CodeParser.API;
      if (!api || !api.getSettings) {
        if ($el.length) $el.text('');
        return;
      }
      api.getSettings().then(function (data) {
        if (data.error) {
          if ($el.length) $el.text('');
          return;
        }
        if ($el.length) {
          $el.text(data.use_llm
            ? 'Config will be generated using the LLM (as set in Settings).'
            : 'Config will be generated using the simple Python parser (as set in Settings).');
        }
      }).catch(function () {
        if ($el.length) $el.text('');
      });
    }
    function showSettings() {
      if ($layout.length) $layout.addClass('hidden');
      if ($importPage.length) $importPage.addClass('hidden');
      if ($testPage.length) $testPage.addClass('hidden');
      if ($settingsPage.length) $settingsPage.removeClass('hidden');
      setNavActive($navSettings);
      localStorage.setItem(pageKey, 'settings');
      loadSettingsIntoForm();
    }
    function updateLlmPanelVisibility() {
      var $useLlm = $('#settings-use-llm');
      var $panel = $('#settings-llm-panel');
      if ($panel.length) $panel.toggleClass('hidden', !($useLlm.length && $useLlm[0].checked));
    }

    /* ---- Holiday table helpers ---- */
    function _makeHolidayRow(active, name, date) {
      var $tr = $('<tr class="settings-hol-row">');
      $tr.append(
        $('<td class="settings-hol-td-active">').append(
          $('<input type="checkbox" class="settings-hol-active">').prop('checked', active !== false)
        ),
        $('<td class="settings-hol-td-name">').append(
          $('<input type="text" class="settings-hol-name settings-input-sm" placeholder="Holiday name">').val(name || '')
        ),
        $('<td class="settings-hol-td-date">').append(
          $('<input type="date" class="settings-hol-date settings-input-sm">').val(date || '')
        ),
        $('<td class="settings-hol-td-del">').append(
          $('<button type="button" class="settings-hol-del" title="Remove">&times;</button>').on('click', function() {
            $tr.remove();
          })
        )
      );
      return $tr;
    }
    function _renderHolidaysTable(holidays) {
      var $tbody = $('#settings-holidays-tbody');
      if (!$tbody.length) return;
      $tbody.empty();
      (holidays || []).forEach(function(h) {
        var active, name, date;
        if (typeof h === 'string') {
          active = true; name = ''; date = h;
        } else {
          active = h.active !== false; name = h.name || ''; date = h.date || '';
        }
        $tbody.append(_makeHolidayRow(active, name, date));
      });
    }
    function _readHolidaysTable() {
      var result = [];
      $('#settings-holidays-tbody .settings-hol-row').each(function() {
        var active = $(this).find('.settings-hol-active').prop('checked');
        var name   = $(this).find('.settings-hol-name').val().trim();
        var date   = $(this).find('.settings-hol-date').val().trim();
        if (date) result.push({ active: active, name: name, date: date });
      });
      return result;
    }

    function loadSettingsIntoForm() {
      var api = window.CodeParser && window.CodeParser.API;
      if (!api || !api.getSettings) return;
      api.getSettings().then(function (data) {
        if (data.error) return;
        var $useLlm = $('#settings-use-llm');
        var $pathPrefix = $('#settings-input-output-path-prefix');
        var $inputPrefix = $('#settings-input-dataset-prefix');
        var $outputPrefix = $('#settings-output-dataset-prefix');
        var $llmBase = $('#settings-llm-base-url');
        var $llmModel = $('#settings-llm-model');
        var $llmTimeout = $('#settings-llm-timeout');
        var $configDir = $('#settings-config-dir');
        var $validationBucketPrefix = $('#settings-validation-bucket-prefix');
        var $errorBucketPrefix = $('#settings-error-bucket-prefix');
        var $rawBucketPrefix = $('#settings-raw-bucket-prefix');
        var $curatedBucketPrefix = $('#settings-curated-bucket-prefix');
        var $efsOutputPrefix = $('#settings-efs-output-prefix');
        if ($useLlm.length) $useLlm[0].checked = !!data.use_llm;
        if ($pathPrefix.length) $pathPrefix.val(data.input_output_path_prefix || '');
        if ($inputPrefix.length) $inputPrefix.val(data.input_dataset_prefix || '');
        if ($outputPrefix.length) $outputPrefix.val(data.output_dataset_prefix || '');
        if ($llmBase.length) $llmBase.val(data.llm_base_url || '');
        if ($llmModel.length) $llmModel.val(data.llm_model || '');
        if ($llmTimeout.length) $llmTimeout.val(data.llm_timeout_seconds != null ? data.llm_timeout_seconds : 600);
        if ($configDir.length) $configDir.val(data.config_dir || '');
        if ($rawBucketPrefix.length) $rawBucketPrefix.val(data.raw_bucket_prefix || '');
        if ($validationBucketPrefix.length) $validationBucketPrefix.val(data.validation_bucket_prefix || '');
        if ($errorBucketPrefix.length) $errorBucketPrefix.val(data.error_bucket_prefix || '');
        if ($curatedBucketPrefix.length) $curatedBucketPrefix.val(data.curated_bucket_prefix || '');
        if ($efsOutputPrefix.length) $efsOutputPrefix.val(data.efs_output_prefix || '');
        /* Holidays table */
        _renderHolidaysTable(data.usa_holidays || []);
        updateLlmPanelVisibility();
      }).catch(function () {});
    }
    function saveSettingsFromForm(e) {
      if (e) e.preventDefault();
      var $useLlm = $('#settings-use-llm');
      var $pathPrefix = $('#settings-input-output-path-prefix');
      var $inputPrefix = $('#settings-input-dataset-prefix');
      var $outputPrefix = $('#settings-output-dataset-prefix');
      var $llmBase = $('#settings-llm-base-url');
      var $llmModel = $('#settings-llm-model');
      var $llmTimeout = $('#settings-llm-timeout');
      var $configDir = $('#settings-config-dir');
      var $validationBucketPrefix = $('#settings-validation-bucket-prefix');
      var $errorBucketPrefix = $('#settings-error-bucket-prefix');
      var $rawBucketPrefix = $('#settings-raw-bucket-prefix');
      var $curatedBucketPrefix = $('#settings-curated-bucket-prefix');
      var $efsOutputPrefix = $('#settings-efs-output-prefix');
      var $msg = $('#settings-message');
      var api = window.CodeParser && window.CodeParser.API;
      if (!api || !api.saveSettings) return;
      var timeoutVal = ($llmTimeout.length && $llmTimeout.val()) ? parseInt($llmTimeout.val(), 10) : 600;
      if (isNaN(timeoutVal) || timeoutVal < 60) timeoutVal = 600;
      if (timeoutVal > 3600) timeoutVal = 3600;
      var payload = {
        use_llm: !!($useLlm.length && $useLlm[0].checked),
        input_output_path_prefix: ($pathPrefix.length && $pathPrefix.val()) ? $pathPrefix.val().trim() : '',
        input_dataset_prefix: ($inputPrefix.length && $inputPrefix.val()) ? $inputPrefix.val().trim() : '',
        output_dataset_prefix: ($outputPrefix.length && $outputPrefix.val()) ? $outputPrefix.val().trim() : '',
        llm_base_url: ($llmBase.length && $llmBase.val()) ? $llmBase.val().trim() : '',
        llm_model: ($llmModel.length && $llmModel.val()) ? $llmModel.val().trim() : '',
        llm_timeout_seconds: timeoutVal,
        config_dir: ($configDir.length && $configDir.val()) ? $configDir.val().trim() : '',
        raw_bucket_prefix: ($rawBucketPrefix.length && $rawBucketPrefix.val()) ? $rawBucketPrefix.val().trim() : '',
        validation_bucket_prefix: ($validationBucketPrefix.length && $validationBucketPrefix.val()) ? $validationBucketPrefix.val().trim() : '',
        error_bucket_prefix: ($errorBucketPrefix.length && $errorBucketPrefix.val()) ? $errorBucketPrefix.val().trim() : '',
        curated_bucket_prefix: ($curatedBucketPrefix.length && $curatedBucketPrefix.val()) ? $curatedBucketPrefix.val().trim() : '',
        efs_output_prefix: ($efsOutputPrefix.length && $efsOutputPrefix.val()) ? $efsOutputPrefix.val().trim() : '',
        usa_holidays: _readHolidaysTable()
      };
      if ($msg.length) { $msg.text('Saving\u2026'); $msg[0].className = 'import-message'; }
      api.saveSettings(payload).then(function (res) {
        if ($msg.length) { $msg.text(''); $msg[0].className = ''; }
        if (res.error) {
          if (typeof window.studioToast === 'function') window.studioToast(res.error, 'error');
          else alert(res.error);
        } else {
          if (typeof window.studioToast === 'function') window.studioToast('Settings saved.', 'success');
          else alert('Settings saved.');
          /* Refresh the studio's in-memory settings so node prop panels
             pre-populate with the newly saved bucket prefixes immediately. */
          if (typeof window.studioReloadSettings === 'function') window.studioReloadSettings();
        }
      }).catch(function () {
        if ($msg.length) { $msg.text(''); $msg[0].className = ''; }
        if (typeof window.studioToast === 'function') window.studioToast('Failed to save settings.', 'error');
        else alert('Failed to save settings.');
      });
    }
    function backToConfigAndSelect() {
      showConfigurations();
      if (currentPath && $configList.length) {
        $configList.find('li').each(function () {
          var $el = $(this);
          $el.toggleClass('active', $el.attr('data-path') === currentPath);
        });
      }
      /* Panels stay as-is — they were not collapsed when Test opened */
    }
    if ($navConfig.length) $navConfig.on('click', function (e) { e.preventDefault(); showConfigurations(); });
    if ($navImport.length) $navImport.on('click', function (e) { e.preventDefault(); showImport(); });
    if ($navSettings.length) $navSettings.on('click', function (e) { e.preventDefault(); showSettings(); });
    /* Expose so the studio can reload settings when the drawer opens */
    window.studioLoadSettings = loadSettingsIntoForm;
    var $settingsForm = $('#settings-form');
    if ($settingsForm.length) $settingsForm.on('submit', saveSettingsFromForm);
    var $useLlmCheck = $('#settings-use-llm');
    if ($useLlmCheck.length) $useLlmCheck.on('change', updateLlmPanelVisibility);
    $(document).on('click', '#settings-holidays-add', function() {
      $('#settings-holidays-tbody').append(_makeHolidayRow(true, '', ''));
    });
    var $importLinkSettings = $('#import-link-settings');
    if ($importLinkSettings.length) $importLinkSettings.on('click', function (e) { e.preventDefault(); showSettings(); });
    var $btnTest = $('#btn-test');
    if ($btnTest.length) $btnTest.on('click', function (e) { e.preventDefault(); showTest(); });
    var $testPageBackBtn = $('#test-page-back-btn');
    if ($testPageBackBtn.length) $testPageBackBtn.on('click', function (e) { e.preventDefault(); backToConfigAndSelect(); });
    showConfigurations();
    window.showConfigurationsView = showConfigurations;
    window.showTestPage = showTest;
    window.backToConfigAndSelect = backToConfigAndSelect;
  })();

  (function () {
    var $tabs = $('.import-tab');
    var $panels = $('.import-panel');
    $tabs.each(function () {
      var $tab = $(this);
      $tab.on('click', function () {
        var id = $tab.attr('data-tab');
        $tabs.each(function () {
          var $t = $(this);
          $t.toggleClass('active', $t.attr('data-tab') === id);
          $t.attr('aria-selected', $t.attr('data-tab') === id ? 'true' : 'false');
        });
        $panels.each(function () {
          var $p = $(this);
          var match = $p.attr('id') === 'import-panel-' + id;
          $p.toggleClass('active', match);
          $p.toggleClass('hidden', !match);
        });
      });
    });
  })();

  function switchTestTab(tabId) {
    var $testTabs = $('#test-page .test-tab');
    var $testPanels = $('#test-page .test-panel');
    $testTabs.each(function () {
      var $t = $(this);
      $t.toggleClass('active', $t.attr('data-tab') === tabId);
      $t.attr('aria-selected', $t.attr('data-tab') === tabId ? 'true' : 'false');
    });
    $testPanels.each(function () {
      var $p = $(this);
      var match = $p.attr('id') === 'test-panel-' + tabId;
      $p.toggleClass('active', match);
      $p.toggleClass('hidden', !match);
    });
    if (tabId === 'reconciliation' && typeof renderReconciliation === 'function') renderReconciliation();
  }

  (function testPageTabs() {
    $('#test-page .test-tab').each(function () {
      var $tab = $(this);
      $tab.on('click', function () {
        switchTestTab($tab.attr('data-tab'));
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

  var $overwriteModal = $('#overwrite-modal');
  var $overwriteMessage = $('#overwrite-message');
  var $overwriteCancelBtn = $('#overwrite-cancel');
  var $overwriteConfirmBtn = $('#overwrite-confirm');
  var $overwriteModalClose = $('#overwrite-modal-close');
  var overwriteCallback = null;

  function showOverwriteConfirm(path, onConfirm) {
    if ($overwriteMessage.length) $overwriteMessage.html('An interface named <strong class="overwrite-filename">' + escapeHtml(path || '') + '</strong> already exists. Overwrite?');
    overwriteCallback = onConfirm;
    if ($overwriteModal.length) $overwriteModal.removeClass("hidden");
  }

  function closeOverwriteModal() {
    overwriteCallback = null;
    if ($overwriteModal.length) $overwriteModal.addClass("hidden");
  }

  if ($overwriteConfirmBtn.length) $overwriteConfirmBtn.on('click', function () {
    if (typeof overwriteCallback === 'function') overwriteCallback();
    closeOverwriteModal();
  });
  if ($overwriteCancelBtn.length) $overwriteCancelBtn.on('click', closeOverwriteModal);
  if ($overwriteModalClose.length) $overwriteModalClose.on('click', closeOverwriteModal);
  if ($overwriteModal.length) $overwriteModal.on('click', function (e) { if (e.target === $overwriteModal[0]) closeOverwriteModal(); });

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
    var $el = $(containerEl);
    $el.removeClass('hidden');
    var html = '';
    if (parseError) html += '<p class="import-validation-parse-error"><strong>Parse error:</strong> ' + escapeHtml(parseError) + '</p>';
    if (errors && errors.length) {
      html += '<p class="import-validation-title"><strong>Dataflow format:</strong></p><ul>';
      errors.forEach(function (e) {
        html += '<li>' + (e.path ? '<code>' + escapeHtml(e.path) + '</code>: ' : '') + escapeHtml(e.message) + '</li>';
      });
      html += '</ul>';
    }
    $el.html(html || '');
  }

  function hideValidationErrors(containerEl) {
    if (containerEl) { var $el = $(containerEl); $el.addClass('hidden'); $el.html(''); }
  }

  $('#import-json-file').on('change', function () {
    var $nameInput = $('#import-json-name');
    if (!$nameInput.length || !this.files || this.files.length === 0) return;
    var name = this.files[0].name.replace(/\.json$/i, '');
    if (name) $nameInput.val(name);
  });

  $('#btn-import-json-file').on('click', function () {
    var $fileInput = $('#import-json-file');
    var $nameInput = $('#import-json-name');
    var $msgEl = $('#import-json-message');
    var $validationEl = $('#import-json-validation');
    if (!$fileInput[0].files || $fileInput[0].files.length === 0) {
      showMessagePopup('Import JSON', 'Please select a JSON file first.', 'error');
      return;
    }
    var path = configNameToPath($nameInput.length ? $nameInput.val() : '');
    if (!path) {
      showMessagePopup('Import JSON', 'Please enter a config name.', 'error');
      return;
    }
    hideValidationErrors($validationEl[0]);
    if ($msgEl.length) { $msgEl.text(''); $msgEl[0].className = 'import-message'; }
    var file = $fileInput[0].files[0];
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var validation = validateDataflowConfig(data);
        if (!validation.valid) {
          showValidationErrors($validationEl[0], validation.errors, null);
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
            var msg = 'Interface <strong>' + escapeHtml(path) + '</strong> imported and saved.';
            if (countHtml) msg += ' ' + countHtml + '.';
            toast(msg, 'success');
            $fileInput.val('');
            if ($nameInput.length) $nameInput.val('');
            if ($msgEl.length) { $msgEl.text(''); $msgEl[0].className = 'import-message'; }
            hideValidationErrors($validationEl[0]);
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
        showValidationErrors($validationEl[0], e.message || 'The file is not valid JSON.');
        showMessagePopup('Invalid JSON', e.message || 'The file is not valid JSON.', 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
  });

  var $pasteTextarea = $('#import-json-paste');
  var $pasteValidationEl = $('#import-paste-validation');
  if ($pasteTextarea.length) $pasteTextarea.on('input', function () {
    $pasteTextarea.removeClass('has-error');
    hideValidationErrors($pasteValidationEl[0]);
  });

  $('#btn-save-paste-json').on('click', function () {
    var $textarea = $('#import-json-paste');
    var $nameInput = $('#import-json-paste-name');
    var $msgEl = $('#import-paste-message');
    var $validationEl = $('#import-paste-validation');
    var raw = $textarea.length && $textarea.val() ? $textarea.val().trim() : '';
    var path = configNameToPath($nameInput.length ? $nameInput.val() : '');
    if (!path) {
      showMessagePopup('Save config', 'Please enter a config name.', 'error');
      return;
    }
    if (!raw) {
      showMessagePopup('Save config', 'Please paste JSON into the text area.', 'error');
      return;
    }
    if ($textarea.length) $textarea.removeClass('has-error');
    hideValidationErrors($validationEl[0]);
    if ($msgEl.length) { $msgEl.text(''); $msgEl[0].className = 'import-message'; }
    var parseError = null;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      parseError = e.message || 'The pasted text is not valid JSON.';
      if (e.message && /line \d+/i.test(e.message)) parseError = e.message;
      showValidationErrors($validationEl[0], [], parseError);
      if ($textarea.length) $textarea.addClass('has-error');
      showMessagePopup('Invalid JSON', parseError, 'error');
      return;
    }
    var validation = validateDataflowConfig(data);
    if (!validation.valid) {
      showValidationErrors($validationEl[0], validation.errors, null);
      if ($textarea.length) $textarea.addClass('has-error');
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
        var msg = 'Interface <strong>' + escapeHtml(path) + '</strong> saved.';
        if (countHtml) msg += ' ' + countHtml + '.';
        toast(msg, 'success');
        $textarea.val('');
        if ($nameInput.length) $nameInput.val('');
        if ($msgEl.length) { $msgEl.text(''); $msgEl[0].className = 'import-message'; }
        if ($textarea.length) $textarea.removeClass('has-error');
        hideValidationErrors($validationEl[0]);
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

  if ($('#btn-rename').length) $('#btn-rename').on('click', () => {
    if (!currentPath) return;
    renameDeleteTargetPath = currentPath;
    $renameInput.val(currentPath.replace(/\.json$/i, ''));
    $renameModal.removeClass("hidden");
    $renameInput.focus();
  });

  if ($('#btn-delete').length) $('#btn-delete').on('click', () => {
    if (!currentPath) return;
    renameDeleteTargetPath = currentPath;
    $deleteMessage.text('Delete "' + currentPath + '"? This cannot be undone.');
    $deleteModal.removeClass("hidden");
  });

  $('#zip-file').on('change', function () {
    var $nameInput = $('#import-config-name');
    if (!$nameInput.length) return;
    var files = this.files;
    if (files && files.length > 0) {
      var name = files[0].name.replace(/\.zip$/i, '');
      if (name) $nameInput.val(name);
    }
  });

  $('#btn-import-zip').on('click', () => {
    const $fileInput = $('#zip-file');
    const $nameInput = $('#import-config-name');
    const $msgEl = $('#import-message');
    if (!$fileInput[0].files || $fileInput[0].files.length === 0) {
      $msgEl.text('Please select a ZIP file.');
      $msgEl[0].className = 'import-message error';
      showMessagePopup('Import', 'Please select a ZIP file first.', 'error');
      return;
    }
    var configName = ($nameInput.length && $nameInput.val() ? $nameInput.val() : 'imported_mainflow').trim() || 'imported_mainflow';
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
      formData.append('file', $fileInput[0].files[0]);
      formData.append('config_name', configName);
      formData.append('save', 'true');
      $msgEl.text('Generating config...');
      $msgEl[0].className = 'import-message';
      var $importPanelZip = $('#import-panel-zip');
      var $importLogsEl = $('#import-logs');
      var $importLogsProgress = $('#import-logs-progress');
      var $importLogsTimer = $('#import-logs-timer');
      if ($importPanelZip.length) $importPanelZip.addClass('has-logs');
      if ($importLogsProgress.length) $importLogsProgress.removeClass('hidden');
      if ($importLogsTimer.length) $importLogsTimer.text('0:00');
      if ($importLogsEl.length) {
        $importLogsEl.text('Generating config...');
        $importLogsEl.attr('data-raw', 'Generating config...');
      }
      var startTime = Date.now();
      var timerInterval = setInterval(function () {
        if ($importLogsTimer.length) $importLogsTimer.text(formatElapsed(Date.now() - startTime));
      }, 1000);
      function stopTimer(success) {
        clearInterval(timerInterval);
        var duration = formatDuration(Date.now() - startTime);
        if ($importLogsProgress.length) $importLogsProgress.addClass('hidden');
        return success ? 'Completed in ' + duration + '.' : 'Failed after ' + duration + '.';
      }
      API.importZip(formData).then(data => {
        if ($importPanelZip.length) $importPanelZip.addClass('has-logs');
        var durationLine = stopTimer(!data.error);
        var logLines = Array.isArray(data.logs) ? data.logs : [];
        logLines.push(durationLine);
        if ($importLogsEl.length) {
          $importLogsEl.text(logLines.length ? logLines.join('\n') : (data.error ? 'Import failed.' : ''));
          $importLogsEl.attr('data-raw', $importLogsEl.text());
        }
        if (data.error) {
          $msgEl.text('Import failed. See error details below.');
          $msgEl[0].className = 'import-message error';
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
        $msgEl.text('Config generated. See message below.');
        $msgEl[0].className = 'import-message success';
        $fileInput.val('');
        $nameInput.val('');
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
        $msgEl.text('Import failed. See error details below.');
        $msgEl[0].className = 'import-message error';
        var $importPanelZip2 = $('#import-panel-zip');
        var $importLogsProgress2 = $('#import-logs-progress');
        var $importLogsEl2 = $('#import-logs');
        var durationLine = stopTimer(false);
        if ($importPanelZip2.length) $importPanelZip2.addClass('has-logs');
        if ($importLogsProgress2.length) $importLogsProgress2.addClass('hidden');
        if ($importLogsEl2.length) {
          var prev = $importLogsEl2.text() || '';
          $importLogsEl2.text(prev + (prev ? '\n' : '') + 'Import failed: ' + msg + '\n' + durationLine);
          $importLogsEl2.attr('data-raw', $importLogsEl2.text());
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
    var $importLogsCopyBtn = $('#import-logs-copy-btn');
    if ($importLogsCopyBtn.length) $importLogsCopyBtn.on('click', function () {
      var $logsEl = $('#import-logs');
      var raw = ($logsEl.length && $logsEl.attr('data-raw')) || ($logsEl.length && $logsEl.text()) || '';
      if (!raw) {
        toast('Import logs are empty.', 'info');
        return;
      }
      navigator.clipboard.writeText(raw).then(function () {
        toast('Import logs copied to clipboard.', 'success');
      }).catch(function () {
        toast('Could not copy to clipboard.', 'error');
      });
    });
  })();

  function toggleEditMode() {
    editMode = !editMode;
    var $diagramEdit = $('#diagram-edit-btn');
    if ($diagramEdit.length) $diagramEdit.toggleClass('active', editMode);
    if (configViewMode === 'json') updateJsonEditorMode();
  }
  var $diagramEditBtn = $('#diagram-edit-btn');
  if ($diagramEditBtn.length) $diagramEditBtn.on('click', toggleEditMode);

  function toggleHoverPopups() {
    window.CodeParser.hoverPopupsEnabled = !window.CodeParser.hoverPopupsEnabled;
    var $diagramHover = $('#diagram-hover-popups-btn');
    var $popup = $('#step-hover-popup');
    if ($diagramHover.length) $diagramHover.toggleClass('active', window.CodeParser.hoverPopupsEnabled);
    if ($popup.length) {
      $popup.addClass('hidden');
      $popup.attr('aria-hidden', 'true');
    }
  }
  var $diagramHoverBtn = $('#diagram-hover-popups-btn');
  if ($diagramHoverBtn.length) $diagramHoverBtn.on('click', toggleHoverPopups);

  var $diagramFitBtn = $('#diagram-fit-btn');
  if ($diagramFitBtn.length) $diagramFitBtn.on('click', function () {
    if (window.CodeParser && window.CodeParser.fitDiagram) window.CodeParser.fitDiagram();
  });

  var $diagramZoomIn = $('#diagram-zoom-in-btn');
  if ($diagramZoomIn.length) $diagramZoomIn.on('click', function () {
    if (window.CodeParser && window.CodeParser.zoomIn) window.CodeParser.zoomIn();
  });
  var $diagramZoomOut = $('#diagram-zoom-out-btn');
  if ($diagramZoomOut.length) $diagramZoomOut.on('click', function () {
    if (window.CodeParser && window.CodeParser.zoomOut) window.CodeParser.zoomOut();
  });

  var moveMode = false;
  var $diagramMoveBtn = $('#diagram-move-btn');
  if ($diagramMoveBtn.length) $diagramMoveBtn.on('click', function () {
    moveMode = !moveMode;
    $diagramMoveBtn.toggleClass('active', moveMode);
    if (window.CodeParser && window.CodeParser.setMoveMode) window.CodeParser.setMoveMode(moveMode);
  });

  function setConfigViewMode(mode) {
    configViewMode = mode;
    var $diagramPanel = $('#diagram-view-panel');
    var $jsonWrap = $('#json-editor-wrap');
    var $tabDiagram = $('#diagram-view-tab-diagram');
    var $tabJson = $('#diagram-view-tab-json');
    if (mode === 'json') {
      if ($diagramPanel.length) $diagramPanel.addClass('hidden');
      if ($jsonWrap.length) {
        $jsonWrap.removeClass('hidden');
        $jsonWrap.attr('aria-hidden', 'false');
      }
      if ($tabDiagram.length) { $tabDiagram.removeClass('active'); $tabDiagram.attr('aria-selected', 'false'); }
      if ($tabJson.length) { $tabJson.addClass('active'); $tabJson.attr('aria-selected', 'true'); }
      syncJsonEditorFromConfig();
      updateJsonEditorMode();
    } else {
      if ($jsonWrap.length) {
        $jsonWrap.addClass('hidden');
        $jsonWrap.attr('aria-hidden', 'true');
      }
      if ($diagramPanel.length) $diagramPanel.removeClass('hidden');
      if ($tabDiagram.length) { $tabDiagram.addClass('active'); $tabDiagram.attr('aria-selected', 'true'); }
      if ($tabJson.length) { $tabJson.removeClass('active'); $tabJson.attr('aria-selected', 'false'); }
    }
  }

  function syncJsonEditorFromConfig() {
    var $statusEl = $('#json-editor-status');
    jsonEditorDirty = false;
    var $applyBtn = $('#json-editor-apply-btn');
    if ($applyBtn.length) $applyBtn.addClass('hidden');
    if (configViewMode === 'json') {
      updateJsonEditorMode();
    }
    if ($statusEl.length) $statusEl.text('');
  }

  var $tabDiagram = $('#diagram-view-tab-diagram');
  var $tabJson = $('#diagram-view-tab-json');
  if ($tabDiagram.length) $tabDiagram.on('click', function () { setConfigViewMode('diagram'); });
  if ($tabJson.length) $tabJson.on('click', function () { setConfigViewMode('json'); });


  var $jsonEditorApply = $('#json-editor-apply-btn');
  var $jsonEditorStatus = $('#json-editor-status');
  if ($jsonEditorApply.length) {
    $jsonEditorApply.on('click', function () {
      if (!currentConfig || !currentPath) return;
      try {
        jsonEditorDirty = false;
        $jsonEditorApply.addClass('hidden');
        if ($jsonEditorStatus.length) $jsonEditorStatus.text('Saving…');
        var $container = $('#network');
        if ($container.length) initNetwork($container[0], currentConfig);
        API.saveConfig(currentPath, currentConfig).then(function (res) {
          if (res.error) {
            if ($jsonEditorStatus.length) $jsonEditorStatus.text('');
            showMessagePopup('Save failed', res.error, 'error');
          } else {
            if ($jsonEditorStatus.length) $jsonEditorStatus.text('Saved.');
            toast('Interface saved', 'success');
            setTimeout(function () { if ($jsonEditorStatus.length) $jsonEditorStatus.text(''); }, 2000);
          }
        }).catch(function (err) {
          if ($jsonEditorStatus.length) $jsonEditorStatus.text('');
          showMessagePopup('Save failed', err.message || String(err), 'error');
        });
      } catch (e) {
        if ($jsonEditorStatus.length) $jsonEditorStatus.text('Error: ' + (e.message || String(e)));
      }
    });
  }

  var $jsonEditorFontIncrease = $('#json-editor-font-increase');
  var $jsonEditorFontDecrease = $('#json-editor-font-decrease');
  if ($jsonEditorFontIncrease.length) $jsonEditorFontIncrease.on('click', function () {
    jsonTreeFontSize = Math.min(24, jsonTreeFontSize + 2);
    if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
  });
  if ($jsonEditorFontDecrease.length) $jsonEditorFontDecrease.on('click', function () {
    jsonTreeFontSize = Math.max(10, jsonTreeFontSize - 2);
    if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
  });

  var $jsonEditorSearchToggle = $('#json-editor-search-toggle');
  var $jsonEditorSearchInput = $('#json-editor-search-input');
  if ($jsonEditorSearchToggle.length && $jsonEditorSearchInput.length) {
    $jsonEditorSearchToggle.on('click', function () {
      $jsonEditorSearchInput.toggleClass('hidden');
      if (!$jsonEditorSearchInput.hasClass('hidden')) $jsonEditorSearchInput.focus();
    });
    $jsonEditorSearchInput.on('input', function () {
      if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
    });
    $jsonEditorSearchInput.on('keydown', function (e) {
      if (e.key === 'Escape') {
        $jsonEditorSearchInput.val('');
        $jsonEditorSearchInput.addClass('hidden');
        if (typeof renderJsonTreeView === 'function') renderJsonTreeView();
      }
    });
  }

  (function diagramToolbarAutoHide() {
    var $container = $('#diagram-container');
    var $layer = $('#diagram-toolbar-layer');
    var $toolbar = $('#diagram-toolbar');
    var hideTimer;
    var HIDE_DELAY_MS = 2500;
    var TOP_ZONE_HEIGHT = 70;
    var wasInZone = false;

    function isInDiagramTopZone(x, y) {
      if (!$container.length) return false;
      var r = $container[0].getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
      return (y - r.top) <= TOP_ZONE_HEIGHT;
    }

    function showAutoHideLayer() {
      if ($layer.length) $layer.addClass('diagram-autohide-visible');
      if ($toolbar.length) $toolbar.addClass('diagram-toolbar-visible');
    }

    function hideAutoHideLayer() {
      if ($layer.length) $layer.removeClass('diagram-autohide-visible');
      if ($toolbar.length) $toolbar.removeClass('diagram-toolbar-visible');
    }

    function onMouseMove(e) {
      if (!$container.length || !$layer.length || !$toolbar.length) return;
      if (!$container.hasClass('visible')) return;
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

    if ($container.length && $layer.length && $toolbar.length) {
      $(document).on('mousemove', onMouseMove);
    }
  })();

  function syncDiagramToolbarState() {
    var $diagramEdit = $('#diagram-edit-btn');
    var $diagramHover = $('#diagram-hover-popups-btn');
    var $diagramMoveBtn = $('#diagram-move-btn');
    if ($diagramEdit.length) $diagramEdit.toggleClass('active', editMode);
    if ($diagramHover.length) $diagramHover.toggleClass('active', window.CodeParser.hoverPopupsEnabled);
    if ($diagramMoveBtn.length) {
      $diagramMoveBtn.toggleClass('active', moveMode);
      if (window.CodeParser && window.CodeParser.setMoveMode) window.CodeParser.setMoveMode(moveMode);
    }
  }

  $searchInput.on('input', () => {
    const q = $searchInput.val().trim();
    console.log('Search input triggered with query:', q);
    if (q.length < 2) {
      console.log('Query too short, hiding results');
      $searchResults.removeClass('visible');
      $searchResults.html('');
      return;
    }
    console.log('Calling API.search with:', q);
    API.search(q).then(data => {
      console.log('API.search response:', data);
      const results = (data.results || []).slice(0, 20);
      console.log('Results to display:', results.length);
      $searchResults.html(results.map(r => {
        const snippet = (r.snippet || '').replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => '<mark>' + m + '</mark>');
        return '<div class="search-result-item" data-file="' + (r.file || '') + '">' +
          '<span class="file">' + (r.file || '') + '</span> <span class="path">' + (r.path || '') + '</span>' +
          '<div class="snippet">' + snippet + '</div></div>';
      }).join(''));
      console.log('Search results HTML set, showing results');
      $searchResults.addClass('visible');
      $searchResults.find('.search-result-item').each(function () {
        var $el = $(this);
        $el.on('click', () => {
          const file = $el.attr('data-file');
          if (file) loadConfig(file);
          $searchResults.removeClass('visible');
          $searchInput.val('');
        });
      });
    }).catch(err => {
      console.error('Search API error:', err);
    });
  });

  $(document).on('click', (e) => {
    if (!$searchResults[0].contains(e.target) && e.target !== $searchInput[0])
      $searchResults.removeClass('visible');
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

    // ── Step 1: Full-line highlights (must run BEFORE token spans) ──────────────
    // Error lines (containing [ERROR], ERROR:, Traceback, or ABORT keywords)
    html = html.replace(/^([^\n]*(?:\[ERROR\]|ERROR:|Traceback|aborted:|Dataflow job failed|Process exited with code)[^\n]*)$/gm,
      '<span class="log-err-line">$1</span>');
    // Warning lines
    html = html.replace(/^([^\n]*\[WARNING\][^\n]*)$/gm,
      '<span class="log-warn-line">$1</span>');
    // ServiceNow / Incident info lines
    html = html.replace(/^([^\n]*\[INCIDENT\][^\n]*)$/gm,
      '<span class="log-incident-line">$1</span>');

    // ── Step 2: File path highlights ────────────────────────────────────────────
    html = html.replace(/(File\s+")([^"]+?)(")/g, '$1<span class="log-path">$2</span>$3');
    html = html.replace(/(["'])(\/[\w./\-]+\.py)(["']?)/g, '$1<span class="log-path">$2</span>$3');
    html = html.replace(/(\s)(\/[\w./\-]+\.[a-z]+)(\s|$)/g, '$1<span class="log-path">$2</span>$3');
    // line N
    html = html.replace(/(,\s*line\s+)(\d+)/g, '$1<span class="log-line-num">$2</span>');

    // ── Step 3: Token-level highlights ──────────────────────────────────────────
    // [INFO], [ERROR], [WARNING], [DEBUG]
    html = html.replace(/\[(INFO)\]/g, '<span class="log-info">[$1]</span>');
    html = html.replace(/\[(WARNING)\]/g, '<span class="log-warn">[$1]</span>');
    html = html.replace(/\[(ERROR)\]/g, '<span class="log-err">[$1]</span>');
    html = html.replace(/\[(DEBUG)\]/g, '<span class="log-debug">[$1]</span>');
    // ServiceNow / Incident token
    html = html.replace(/\[INCIDENT\]/g, '<span class="log-incident">[INCIDENT]</span>');
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
    var $el = $(el);
    testLogsRaw = raw;
    $el.attr('data-raw', raw);
    $el.html(highlightLogText(raw));
  }

  function appendTestLogsContent(el, more) {
    if (!el) return;
    var $el = $(el);
    testLogsRaw += more;
    $el.attr('data-raw', testLogsRaw);
    $el.html(highlightLogText(testLogsRaw));
  }

  var $testLogsCopyBtn = $('#test-logs-copy-btn');
  if ($testLogsCopyBtn.length) $testLogsCopyBtn.on('click', function () {
    var $logsEl = $('#test-logs');
    var raw = ($logsEl.length && $logsEl.attr('data-raw')) || testLogsRaw || '';
    if (!raw) {
      toast('Logs are empty.', 'info');
      return;
    }
    navigator.clipboard.writeText(raw).then(function () {
      toast('Logs copied to clipboard.', 'success');
    }).catch(function () {
      toast('Could not copy to clipboard.', 'error');
    });
  });

  var lastTestConfigPath = null;

  function loadTestSampleData() {
    var $sourceSection = $('#test-source-section');
    var $configNameEl  = $('#test-page-config-name');
    var $logsEl        = $('#test-logs');
    if (!$sourceSection.length) return;
    if (!currentPath || !currentConfig) {
      if ($configNameEl.length) $configNameEl.text('');
      return;
    }
    if (currentPath !== lastTestConfigPath) {
      lastTestConfigPath = currentPath;
      if ($logsEl.length) setTestLogsContent($logsEl[0], '');
    }
    if ($configNameEl.length) $configNameEl.text(currentPath);
    switchTestTab('input');

    /* Always fetch fresh test data from server so node-uploaded files appear immediately */
    API.getConfigTestData(currentPath).then(function (data) {
      uploadedTestData[currentPath] = {
        input_data:      data.input_data      || {},
        expected_output: data.expected_output || {}
      };
      _renderTestInputSection();
    }).catch(function () {
      _renderTestInputSection();
    });
  }

  /* Renders the Input Datasets panel content after fresh data is loaded */
  function _renderTestInputSection() {
    var $sourceTables    = $('#test-source-tables');
    var $dataSection     = $('#test-data-available-section');
    var $noDataSection   = $('#test-no-data-section');
    var $importNodesEl   = $('#test-import-nodes');
    var $reconCtaOutput  = $('#test-output-recon-cta');
    var $inputTitleEl    = $('#test-input-panel-title');
    var esc             = window.CodeParser.escapeHtml || escapeHtml;

    var rawInputData    = uploadedTestData[currentPath] && uploadedTestData[currentPath].input_data || {};
    var hasExpected     = !!(uploadedTestData[currentPath] && Object.keys(uploadedTestData[currentPath].expected_output || {}).length > 0);

    /* ── Filter stored data to only the input nodes defined in the current config.
          This prevents stale/renamed entries from a previous upload from appearing
          alongside the current inputs (the "duplicate inputs" issue).             */
    var configInputKeys = Object.keys((currentConfig && currentConfig.Inputs) || {});
    var inputData = {};
    if (configInputKeys.length > 0) {
      configInputKeys.forEach(function (k) {
        if (rawInputData[k] !== undefined) inputData[k] = rawInputData[k];
      });
    } else {
      inputData = rawInputData; // no config loaded — show everything
    }
    var hasData = Object.keys(inputData).length > 0;

    if ($reconCtaOutput.length) $reconCtaOutput.toggleClass('hidden', !hasExpected);

    if (hasData) {
      /* ── Show data tables ── */
      if ($dataSection.length)   $dataSection.removeClass('hidden');
      if ($noDataSection.length) $noDataSection.addClass('hidden');
      if ($inputTitleEl.length)  $inputTitleEl.text('Input Datasets');
      lastTestSampleData = inputData;
      if ($sourceTables.length) {
        $sourceTables.html('');
        /* Render in config-defined order (not alphabetical / insertion order of stored JSON) */
        var displayKeys = configInputKeys.length > 0
          ? configInputKeys.filter(function (k) { return inputData[k] !== undefined; })
          : Object.keys(inputData);
        displayKeys.forEach(function (name) {
          var rows = inputData[name] || [];
          var cols = rows[0] ? Object.keys(rows[0]).filter(function (k) { return !String(k).startsWith('_'); }) : [];
          var html = '<div class="test-table-wrap"><h3>' + esc(name) + '</h3><table class="test-table"><thead><tr>' +
            cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
          rows.slice(0, 10).forEach(function (r) {
            html += '<tr>' + cols.map(function (c) { return '<td>' + esc(String(r[c] != null ? r[c] : '')) + '</td>'; }).join('') + '</tr>';
          });
          html += '</tbody></table></div>';
          $sourceTables.append(html);
        });
      }
    } else {
      /* ── No test data — show import UI ── */
      if ($dataSection.length)   $dataSection.addClass('hidden');
      if ($noDataSection.length) $noDataSection.removeClass('hidden');
      if ($inputTitleEl.length)  $inputTitleEl.text('Input Datasets');
      _renderTestImportNodes($importNodesEl[0]);
    }

    /* ── Expected Control Files section ── */
    _renderCtrlFileImportNodes($('#test-ctrl-import-nodes')[0]);
  }

  /* Renders expected control file import buttons for validate steps with ctrl_file_create */
  function _renderCtrlFileImportNodes(container) {
    var $section = $('#test-ctrl-files-section');
    if (!container || !$section.length) return;
    var steps = (currentConfig && currentConfig.Transformations && currentConfig.Transformations.steps) || [];
    var ctrlSteps = steps.filter(function(s) {
      return s.type === 'validate' && s.logic && s.logic.ctrl_file_create;
    });
    if (!ctrlSteps.length) {
      $section.hide();
      return;
    }
    $section.show();
    var $container = $(container);
    $container.html('');
    var esc = window.CodeParser.escapeHtml || escapeHtml;
    ctrlSteps.forEach(function(step) {
      var stepId = step.id || step.output_alias || 'validate';
      var storageKey = '__ctrl__' + stepId;
      var $item = $('<div>').addClass('test-import-node-item');

      var $label = $('<div>').addClass('test-import-node-name');
      $label.html('<i class="fa-solid fa-file-lines" style="margin-right:5px;color:#0d9488"></i>' + esc(stepId));

      var $btn = $('<button>').attr('type', 'button').addClass('test-import-node-btn');
      $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Import Expected Control File');

      var $badge = $('<div>').addClass('test-import-file-badge');

      /* Check if already uploaded */
      var existing = uploadedTestData[currentPath] && uploadedTestData[currentPath].expected_output &&
                     uploadedTestData[currentPath].expected_output[storageKey];
      if (existing) {
        $btn[0].className = 'test-import-node-btn has-file';
        $btn.html('<i class="fa-solid fa-check"></i> Expected control file loaded');
        $badge.text('✓ Saved'); $badge.addClass('visible');
      }

      $btn.on('click', function() {
        var $fileInput = $('<input>').attr('type', 'file').attr('accept', '*').hide();
        $(document.body).append($fileInput);
        $fileInput.on('change', function() {
          var file = $fileInput[0].files && $fileInput[0].files[0];
          $fileInput.remove();
          if (!file) return;
          var fd = new FormData();
          fd.append('file', file);
          fd.append('node_name', storageKey);
          fd.append('node_type', 'expected_output');
          fd.append('format', 'CSV');
          fd.append('fields', JSON.stringify([]));
          $btn.prop('disabled', true);
          $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Uploading…');
          fetch('/api/config/' + encodeURIComponent(currentPath) + '/node-test-file', { method: 'POST', body: fd })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              $btn.prop('disabled', false);
              if (res.error) {
                $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Import Expected Control File');
                (window.CodeParser.showMessagePopup || showMessagePopup)('Upload failed', res.error, 'error');
                return;
              }
              $btn[0].className = 'test-import-node-btn has-file';
              $btn.html('<i class="fa-solid fa-check"></i> ' + file.name + ' (' + (res.rows || 0) + ' rows)');
              $badge.text('✓ Saved'); $badge.addClass('visible');
              loadTestSampleData();
            })
            .catch(function(e) {
              $btn.prop('disabled', false);
              $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Import Expected Control File');
              (window.CodeParser.showMessagePopup || showMessagePopup)('Upload failed', e.message || String(e), 'error');
            });
        });
        $fileInput[0].click();
      });

      $item.append($label).append($btn).append($badge);
      $container.append($item);
    });
  }

  /* Renders per-node import buttons inside #test-import-nodes */
  function _renderTestImportNodes(container) {
    if (!container) return;
    var $container = $(container);
    var inputs = (currentConfig && currentConfig.Inputs) || {};
    var inputKeys = Object.keys(inputs);
    if (!inputKeys.length) {
      $container.html('<p style="font-size:12px;color:#94a3b8;text-align:center">No input nodes defined in this interface.</p>');
      return;
    }
    $container.html('');
    inputKeys.forEach(function (key) {
      /* displayName is shown in the UI; key is the canonical ID used for storage.
         Using key (not inputs[key].name) for uploads ensures data is always stored
         under the config-defined key — prevents "ghost" entries from older uploads. */
      var displayName = (inputs[key] && inputs[key].name) || key;
      var $item = $('<div>').addClass('test-import-node-item');

      var $label = $('<div>').addClass('test-import-node-name');
      $label.text(displayName);

      var $btn = $('<button>').attr('type', 'button').addClass('test-import-node-btn');
      $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Import Test Data');

      var $badge = $('<div>').addClass('test-import-file-badge');

      $btn.on('click', function () {
        var $fileInput = $('<input>').attr('type', 'file').attr('accept', '.csv,.txt,.tsv,.dat,.fixed,.del').hide();
        $(document.body).append($fileInput);
        $fileInput.on('change', function () {
          var file = $fileInput[0].files && $fileInput[0].files[0];
          $fileInput.remove();
          if (!file) return;
          var fd = new FormData();
          fd.append('file', file);
          fd.append('node_name', key);   /* always use config key, not display name */
          fd.append('node_type', 'input');
          var nodeCfg = (currentConfig && currentConfig.Inputs && currentConfig.Inputs[key]) || {};
          fd.append('format', (nodeCfg.format || '').toUpperCase());
          fd.append('fields', JSON.stringify(nodeCfg.fields || []));
          $btn.prop('disabled', true);
          $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Uploading…');
          fetch('/api/config/' + encodeURIComponent(currentPath) + '/node-test-file', { method: 'POST', body: fd })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              $btn.prop('disabled', false);
              if (res.error) {
                $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Import Test Data');
                (window.CodeParser.showMessagePopup || showMessagePopup)('Upload failed', res.error, 'error');
                return;
              }
              $btn[0].className = 'test-import-node-btn has-file';
              $btn.html('<i class="fa-solid fa-check"></i> ' + file.name + ' (' + (res.rows || 0) + ' rows)');
              $badge.text('✓ Saved');
              $badge.addClass('visible');
              /* Refresh data panel — server now has the file */
              loadTestSampleData();
            })
            .catch(function (e) {
              $btn.prop('disabled', false);
              $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Import Test Data');
              (window.CodeParser.showMessagePopup || showMessagePopup)('Upload failed', e.message || String(e), 'error');
            });
        });
        $fileInput[0].click();
      });

      $item.append($label).append($btn).append($badge);
      $container.append($item);
    });
  }

  /* Renders per-output-node upload buttons for expected output files in the
     Reconciliation tab.  Control file expected uploads are handled in the
     Input Datasets tab (Expected Control Files section).                     */
  function _renderReconExpectedUpload(container) {
    if (!container) return;
    var $container = $(container);
    var outputs = (currentConfig && currentConfig.Outputs) || {};
    var outputKeys = Object.keys(outputs);

    if (!outputKeys.length) {
      $container.html('<p style="font-size:12px;color:#94a3b8;padding:8px 0">No output nodes defined in this interface.</p>');
      return;
    }
    $container.html('');

    // ── Output dataset upload buttons ─────────────────────────────────────
    outputKeys.forEach(function (key) {
      var nodeCfg  = outputs[key] || {};
      var displayName = nodeCfg.name || key;
      var nodeFmt  = (nodeCfg.format || '').toUpperCase();

      var $item = $('<div>').addClass('test-import-node-item');

      var $label = $('<div>').addClass('test-import-node-name');
      $label.text(displayName);
      if (nodeFmt) {
        var $fmtBadge = $('<span>').css({fontSize:'10px',marginLeft:'8px',color:'#64748b',textTransform:'uppercase',fontWeight:'600'});
        $fmtBadge.text(nodeFmt);
        $label.append($fmtBadge);
      }

      var $btn = $('<button>').attr('type', 'button').addClass('test-import-node-btn');
      var $badge = $('<div>').addClass('test-import-file-badge');

      // Show existing row count if data already uploaded
      var existingData  = uploadedTestData[currentPath] && uploadedTestData[currentPath].expected_output;
      var existingRows  = existingData && existingData[key];
      if (existingRows && existingRows.length > 0) {
        $btn[0].className = 'test-import-node-btn has-file';
        $btn.html('<i class="fa-solid fa-check"></i> ' + key + ' (' + existingRows.length + ' rows) — Re-upload');
      } else {
        $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Upload Expected Output');
      }

      $btn.on('click', function () {
        var $fileInput = $('<input>').attr('type', 'file').attr('accept', '.csv,.txt,.tsv,.dat,.fixed,.del').hide();
        $(document.body).append($fileInput);

        $fileInput.on('change', function () {
          var file = $fileInput[0].files && $fileInput[0].files[0];
          $fileInput.remove();
          if (!file) return;

          var fd = new FormData();
          fd.append('file', file);
          fd.append('node_name', key);
          fd.append('node_type', 'output');
          fd.append('format', (nodeCfg.format || '').toUpperCase());
          fd.append('fields', JSON.stringify(nodeCfg.fields || []));

          $btn.prop('disabled', true);
          $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Uploading…');

          fetch('/api/config/' + encodeURIComponent(currentPath) + '/node-test-file', { method: 'POST', body: fd })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              $btn.prop('disabled', false);
              if (res.error) {
                $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Upload Expected Output');
                (window.CodeParser.showMessagePopup || showMessagePopup)('Upload failed', res.error, 'error');
                return;
              }
              $btn[0].className = 'test-import-node-btn has-file';
              $btn.html('<i class="fa-solid fa-check"></i> ' + file.name + ' (' + (res.rows || 0) + ' rows)');
              $badge.text('✓ Saved');
              $badge.addClass('visible');
              // Refresh expected output data then re-render the comparison
              API.getConfigTestData(currentPath).then(function (data) {
                uploadedTestData[currentPath] = {
                  input_data:      data.input_data      || {},
                  expected_output: data.expected_output || {}
                };
                renderReconciliation();
              }).catch(function () { renderReconciliation(); });
            })
            .catch(function (e) {
              $btn.prop('disabled', false);
              $btn.html('<i class="fa-solid fa-file-arrow-up"></i> Upload Expected Output');
              (window.CodeParser.showMessagePopup || showMessagePopup)('Upload failed', e.message || String(e), 'error');
            });
        });
        $fileInput[0].click();
      });

      $item.append($label).append($btn).append($badge);
      $container.append($item);
    });
  }

  // --- Reconciliation helpers ---

  function normalizeReconValue(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    if (s === '') return '';
    // For pure integers, strip leading zeros but avoid IEEE 754 precision loss for
    // large numbers (bank account/transaction IDs can be 16–19 digits; Number() loses
    // precision beyond 15 significant digits).
    if (/^-?\d+$/.test(s)) {
      var neg = s.charAt(0) === '-';
      var digits = s.replace(/^-?0+/, '') || '0';
      // If > 15 digits the value cannot be safely held in a JS double — compare as string.
      if (digits.length > 15) return (neg ? '-' : '') + digits;
      // Smaller integers: convert to strip leading zeros via Number.
      return String(Number(s));
    }
    // Numeric normalization for decimals/floats: "100.0" == "100" == "100.00"
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
    var $reconContainer = $('#test-reconciliation-content');
    if (!$reconContainer.length) return;
    var expected = (currentPath && uploadedTestData[currentPath] && uploadedTestData[currentPath].expected_output) || {};
    var generated = lastGeneratedOutput || {};
    var escape = window.CodeParser.escapeHtml || escapeHtml;
    var hasExpected  = expected && Object.keys(expected).length > 0;
    var hasGenerated = generated && Object.keys(generated).length > 0;

    // ── Always show the "Expected Output Files" upload section ──────────────
    // This lets users upload or re-upload expected output files (fixed-width,
    // CSV, etc.) directly, without needing a ZIP import.
    var uploadHtml =
      '<details class="recon-upload-section"' + (hasExpected ? '' : ' open') + '>' +
      '<summary class="recon-upload-summary">⬆ Expected Output Files' +
        (hasExpected ? ' <span class="recon-upload-hint">(click to re-upload)</span>' : ' — upload to enable reconciliation') +
      '</summary>' +
      '<div id="recon-expected-upload-nodes" class="recon-upload-nodes"></div>' +
      '</details>';

    if (!hasExpected) {
      $reconContainer.html(uploadHtml +
        '<p class="test-recon-placeholder" style="margin-top:12px">' +
        'Upload expected output files above for each output node, then run the dataflow and return here to compare results.' +
        '</p>');
      _renderReconExpectedUpload($('#recon-expected-upload-nodes')[0]);
      return;
    }
    if (!hasGenerated) {
      $reconContainer.html(uploadHtml +
        '<p class="test-recon-placeholder" style="margin-top:12px">' +
        'Run the dataflow from the <strong>Input Datasets</strong> tab first. After it completes, open this tab to compare generated output with your expected output.' +
        '</p>');
      _renderReconExpectedUpload($('#recon-expected-upload-nodes')[0]);
      return;
    }
    var allNames = {};
    Object.keys(expected).forEach(function (n) { allNames[n] = true; });
    Object.keys(generated).forEach(function (n) { allNames[n] = true; });
    var names = Object.keys(allNames).filter(function (n) {
      return n.indexOf('__ctrl__') !== 0;
    });
    var html = uploadHtml;

    // ── Build per-dataset info first so we can render tab bar with status ──
    var datasetInfos = [];
    names.forEach(function (name, ni) {
      var expRows = expected[name] || [];
      var genRows = generated[name] || [];
      var reconResult = buildReconPairs(expRows, genRows);
      var configOutputsCfg = (currentConfig && currentConfig.Outputs) || {};
      var isCtrlKey  = name.indexOf('__ctrl__') === 0;
      var matchCount = 0, diffCount = 0, onlyExpCount = 0, onlyGenCount = 0;
      var expCols2 = reconResult.expCols.slice();
      var colMap2  = Object.assign({}, reconResult.colMap);
      if (!isCtrlKey && configOutputsCfg[name] && configOutputsCfg[name].fields && configOutputsCfg[name].fields.length) {
        var schemaColSet2 = {};
        configOutputsCfg[name].fields.forEach(function (f) {
          if (f.name) { schemaColSet2[f.name.toUpperCase()] = true; schemaColSet2[f.name.replace(/-/g, '_').toUpperCase()] = true; }
        });
        expCols2 = expCols2.filter(function (ec) { return schemaColSet2[ec.toUpperCase()] || schemaColSet2[ec.replace(/-/g, '_').toUpperCase()]; });
        Object.keys(colMap2).forEach(function (k) { if (!schemaColSet2[k.toUpperCase()] && !schemaColSet2[k.replace(/-/g,'_').toUpperCase()]) delete colMap2[k]; });
      }
      var matchedGenCols2 = {};
      expCols2.forEach(function (ec) { if (colMap2[ec]) matchedGenCols2[colMap2[ec]] = true; });
      var allCols2 = expCols2.slice();
      reconResult.genCols.forEach(function (gc) { if (!matchedGenCols2[gc]) allCols2.push(gc); });
      reconResult.pairs.forEach(function (pair) {
        if (!pair.gen) { onlyExpCount++; return; }
        if (!pair.exp) { onlyGenCount++; return; }
        var hasDiff = allCols2.some(function (ec) { var gc = colMap2[ec]; var gv = (gc != null) ? normalizeReconValue(pair.gen[gc]) : ''; return normalizeReconValue(pair.exp[ec]) !== gv; });
        if (hasDiff) diffCount++; else matchCount++;
      });
      var statusMatch = diffCount === 0 && onlyExpCount === 0 && onlyGenCount === 0;
      datasetInfos.push({ name: name, ni: ni, statusMatch: statusMatch });
    });

    // ── Tab bar ────────────────────────────────────────────────────────────
    if (names.length > 1) {
      html += '<div class="recon-tabs-bar">';
      datasetInfos.forEach(function (info, idx) {
        var tabLabel  = escape(info.name);
        var statusCls = info.statusMatch ? 'recon-tab-dot-match' : 'recon-tab-dot-mismatch';
        html += '<button class="recon-tab' + (idx === 0 ? ' recon-tab-active' : '') + '" data-recon-tab="recon-panel-' + info.ni + '" title="' + tabLabel + '">' +
          '<span class="recon-tab-dot ' + statusCls + '"></span>' + tabLabel + '</button>';
      });
      html += '</div>';
    }

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

      // Filter expected columns against current output schema to remove stale columns
      // from previously uploaded expected files parsed with an older copybook
      var configOutputs = (currentConfig && currentConfig.Outputs) || {};
      var outputCfg = configOutputs[name];
      if (outputCfg && outputCfg.fields && outputCfg.fields.length) {
        var schemaColSet = {};
        outputCfg.fields.forEach(function (f) {
          if (f.name) {
            schemaColSet[f.name.toUpperCase()] = true;
            schemaColSet[f.name.replace(/-/g, '_').toUpperCase()] = true;
          }
        });
        var staleExpCols = expCols.filter(function (ec) {
          return !schemaColSet[ec.toUpperCase()] && !schemaColSet[ec.replace(/-/g, '_').toUpperCase()];
        });
        if (staleExpCols.length > 0) {
          expCols = expCols.filter(function (ec) {
            return schemaColSet[ec.toUpperCase()] || schemaColSet[ec.replace(/-/g, '_').toUpperCase()];
          });
          // Also clean colMap of stale columns
          staleExpCols.forEach(function (sc) { delete colMap[sc]; });
        }
      }

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
          var gc = colMap[ec];  // null when no matching generated column found
          var genVal = (gc != null) ? normalizeReconValue(pair.gen[gc]) : '';
          return normalizeReconValue(pair.exp[ec]) !== genVal;
        });
        if (hasDiff) diffCount++; else matchCount++;
      });

      var statusMatch = diffCount === 0 && onlyExpCount === 0 && onlyGenCount === 0;
      var statusClass = statusMatch ? 'test-recon-match' : 'test-recon-mismatch';
      var statusText = statusMatch ? '✓ Match' : '✗ Mismatch';
      var tableId = 'recon-tbl-' + ni;

      // Check whether this output name exists in the current config's Outputs
      var configOutputs = (currentConfig && currentConfig.Outputs) || {};
      // __ctrl__ keys are validate-step control files — never flag them as stale
      // (they are intentionally absent from configOutputs)
      var isCtrlKey   = name.indexOf('__ctrl__') === 0;
      var isStaleKey  = !isCtrlKey && !configOutputs[name] && Object.keys(expected).indexOf(name) >= 0 && !genRows.length;
      // Display title: "Control File: <stepId>" for ctrl keys, raw name for outputs
      var displayTitle = isCtrlKey
        ? 'Control File: ' + escape(name.slice('__ctrl__'.length))
        : escape(name);

      var panelHidden = names.length > 1 && ni > 0;
      html += '<div class="test-recon-dataset" id="recon-panel-' + ni + '"' + (panelHidden ? ' style="display:none"' : '') + '>';
      // Header row: title + hide-matching toggle
      html += '<div class="recon-dataset-header">';
      html += '<h4 class="test-recon-dataset-title">' + displayTitle + ' <span class="' + statusClass + '">' + statusText + '</span>';
      if (isStaleKey) {
        // Suggest which config output this stale key might correspond to
        var configOutKeys = Object.keys(configOutputs);
        var staleSuggest = configOutKeys.length
          ? ' Did you rename it to: <strong>' + configOutKeys.map(escape).join('</strong>, <strong>') + '</strong>?'
          : '';
        html += ' <span class="recon-stale-badge" title="This key is not in the current config\'s Outputs">⚠ stale key</span>';
        html += '</h4>';
        html += '<div class="recon-stale-note">Expected data stored under <code>' + escape(name) + '</code> does not match any output in the current config.' + staleSuggest + ' Use the <strong>Expected Output Files</strong> section above to upload expected data for the correct output node.</div>';
      } else {
        html += '</h4>';
      }
      if (matchCount > 0) {
        html += '<label class="recon-toggle-match"><input type="checkbox" onchange="$(\'#' + tableId + '\').toggleClass(\'recon-hide-match\',this.checked)"> Hide ' + matchCount + ' matching row' + (matchCount !== 1 ? 's' : '') + '</label>';
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
            var gc = colMap[ec];  // null when no matching generated column
            // For extra gen cols added to allCols by their own name, gc is undefined so
            // fall back to direct key lookup on pair.gen (ec IS the gen column name).
            var v = (gc != null) ? pair.gen[gc] : pair.gen[ec];
            html += '<td>' + escape(v != null ? String(v) : '') + '</td>';
          });
          html += '</tr>';

        } else {
          // Matched pair — find which cells differ
          var diffCols = {};
          allCols.forEach(function (ec) {
            var gc = colMap[ec];  // null when no matching generated column
            var genVal = (gc != null) ? normalizeReconValue(pair.gen[gc]) : '';
            if (normalizeReconValue(pair.exp[ec]) !== genVal) {
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
              var gc = colMap[ec];  // null when no matching generated column
              // For extra gen cols added to allCols by their own name, gc is undefined so
              // fall back to direct key lookup on pair.gen (ec IS the gen column name).
              var v = (gc != null) ? pair.gen[gc] : pair.gen[ec];
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

    $reconContainer.html(html || (uploadHtml + '<p class="test-recon-placeholder">No output datasets to compare.</p>'));
    _renderReconExpectedUpload($('#recon-expected-upload-nodes')[0]);

    // Wire up tab clicks
    $reconContainer.find('.recon-tab').on('click', function () {
      var $btn = $(this);
      var panelId = $btn.attr('data-recon-tab');
      $reconContainer.find('.recon-tab').removeClass('recon-tab-active');
      $btn.addClass('recon-tab-active');
      $reconContainer.find('.test-recon-dataset').hide();
      $reconContainer.find('#' + panelId).show();
    });
  }

  var $outputCtaEl = $('#test-logs-output-cta');
  var $showOutputBtn = $('#btn-show-output');
  var $showReconciliationBtnOutput = $('#btn-show-reconciliation-output');
  function goToReconciliation() {
    switchTestTab('reconciliation');
    if (typeof renderReconciliation === 'function') renderReconciliation();
  }
  if ($showOutputBtn.length) $showOutputBtn.on('click', function () { switchTestTab('output'); });
  if ($showReconciliationBtnOutput.length) $showReconciliationBtnOutput.on('click', goToReconciliation);

  var $runDataflowBtn = $('#btn-run-dataflow');
  if ($runDataflowBtn.length) $runDataflowBtn.on('click', function () {
    if (!currentPath) {
      (window.CodeParser.showMessagePopup || showMessagePopup)('Error', 'Select an interface first.', 'error');
      return;
    }
    var $logsEl = $('#test-logs');
    var $outputTables = $('#test-output-tables');
    $runDataflowBtn.prop('disabled', true);
    $runDataflowBtn.text('Running...');
    if ($outputCtaEl.length) $outputCtaEl.addClass('hidden');
    var $reconCtaOutput = $('#test-output-recon-cta');
    if ($reconCtaOutput.length) $reconCtaOutput.addClass('hidden');
    if ($showReconciliationBtnOutput.length) $showReconciliationBtnOutput.addClass('hidden');
    var $logsProgressEl = $('#test-logs-progress');
    if ($logsProgressEl.length) $logsProgressEl.removeClass('hidden');
    setTestLogsContent($logsEl[0], 'Dataflow job is running.\n');
    if ($outputTables.length) $outputTables.html('<p class="test-output-placeholder">Running… Results will appear here when the run completes.</p>');
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
      /* Track whether job was aborted so we can suppress "View Generated Output" */
      var _jobAborted = false;
      function processLine(line) {
        if (line.startsWith('LOG: ')) {
          var logContent = line.slice(5);
          /* Detect ABORT in the log stream */
          if (logContent.indexOf('[VALIDATE] Dataflow aborted:') >= 0 ||
              logContent.indexOf('[VALIDATE] Job aborted:') >= 0 ||
              logContent.indexOf('Dataflow aborted') >= 0) {
            _jobAborted = true;
          }
          appendTestLogsContent($logsEl[0], logContent + '\n');
          if ($logsEl.length) $logsEl.scrollTop($logsEl[0].scrollHeight);
        } else if (line.startsWith('RESULT: ')) {
          try {
            var res = JSON.parse(line.slice(8));
            // Copy res.outputs so that merging __ctrl__ keys into lastGeneratedOutput
            // does NOT mutate res.outputs (they would otherwise share the same object).
            lastGeneratedOutput = Object.assign({}, res.outputs || {});
            // Merge ctrl file outputs using the same key prefix as expected_output
            // so renderReconciliation() can compare them side-by-side.
            var _ctrlOuts = res.ctrl_outputs || {};
            Object.keys(_ctrlOuts).forEach(function(stepId) {
              lastGeneratedOutput['__ctrl__' + stepId] = _ctrlOuts[stepId];
            });
            $runDataflowBtn.prop('disabled', false);
            $runDataflowBtn.text('Run Dataflow →');
            if ($logsProgressEl.length) $logsProgressEl.addClass('hidden');
            /* Only show "View Generated Output" if job succeeded (not aborted, no error) */
            if ($outputCtaEl.length) {
              if (res.error || _jobAborted) {
                $outputCtaEl.addClass('hidden');
              } else {
                $outputCtaEl.removeClass('hidden');
              }
            }
            if ($logsEl.length) {
              if (_jobAborted) {
                appendTestLogsContent($logsEl[0], '\nDataflow job aborted.\n');
              } else if (res.error) {
                appendTestLogsContent($logsEl[0], '\nDataflow job failed.\nError: ' + (res.error || 'Unknown error') + '\n');
              } else {
                appendTestLogsContent($logsEl[0], '\nDataflow completed successfully.\n');
              }
            }
            // ── Auto-fill missing expected output from generated results ──────
            // After a successful run, populate expected output for nodes that
            // have no expected data yet (e.g. EFS-OUTPUT-02), and replace ctrl
            // entries stored as raw {"value":"..."} with parsed column data.
            // This creates a baseline for future reconciliation runs.
            if (!res.error && !_jobAborted && currentPath) {
              if (!uploadedTestData[currentPath]) uploadedTestData[currentPath] = {};
              if (!uploadedTestData[currentPath].expected_output) uploadedTestData[currentPath].expected_output = {};
              var _eo = uploadedTestData[currentPath].expected_output;
              var _genAll = lastGeneratedOutput || {};
              var _eoChanged = false;
              Object.keys(_genAll).forEach(function (gk) {
                var genRows = _genAll[gk];
                if (!genRows || !genRows.length) return;
                var existingExp = _eo[gk];
                // Fill if no expected data exists
                if (!existingExp || !existingExp.length) {
                  _eo[gk] = genRows;
                  _eoChanged = true;
                  return;
                }
                // For ctrl entries: replace raw {"value":"..."} with parsed columns
                if (gk.indexOf('__ctrl__') === 0) {
                  var expCols = Object.keys(existingExp[0] || {});
                  if (expCols.length === 1 && expCols[0] === 'value') {
                    _eo[gk] = genRows;
                    _eoChanged = true;
                  }
                }
              });
              // Persist back to server if changed
              if (_eoChanged) {
                var _inputData = uploadedTestData[currentPath].input_data || {};
                $.ajax({
                  url: '/api/config/' + encodeURIComponent(currentPath) + '/test-data/save',
                  method: 'PUT',
                  contentType: 'application/json',
                  data: JSON.stringify({ expected_output: _eo, input_data: _inputData }),
                  dataType: 'json'
                });
              }
            }
            var hasExpected = currentPath && uploadedTestData[currentPath] && uploadedTestData[currentPath].expected_output && Object.keys(uploadedTestData[currentPath].expected_output).length > 0;
            var $reconCtaOutput2 = $('#test-output-recon-cta');
            if (hasExpected && !res.error && Object.keys(res.outputs || {}).length > 0) {
              if ($reconCtaOutput2.length) $reconCtaOutput2.removeClass('hidden');
              if ($showReconciliationBtnOutput.length) $showReconciliationBtnOutput.removeClass('hidden');
            } else {
              if ($reconCtaOutput2.length) $reconCtaOutput2.addClass('hidden');
              if ($showReconciliationBtnOutput.length) $showReconciliationBtnOutput.addClass('hidden');
            }
            if ($outputTables.length) {
              var esc2 = window.CodeParser.escapeHtml || escapeHtml;
              var outputs = res.outputs || {};
              var ctrlOuts = res.ctrl_outputs || {};
              var outputNames = Object.keys(outputs).filter(function (n) {
                var rows = outputs[n] || [];
                return rows.length > 0 || true; // include all, filter empties below
              });
              var ctrlNames = Object.keys(ctrlOuts);
              var totalPanels = outputNames.length + ctrlNames.length;

              if (totalPanels === 0 && res.error) {
                $outputTables.html('<p class="test-error">' + esc2(res.error) + '</p>');
              } else if (totalPanels === 0) {
                $outputTables.html('<p class="test-output-empty">No output data was returned. The job may have written to a path we could not read.</p>');
              } else {
                var tabHtml = '';
                // ── Tab bar (only when more than one panel) ──────────────────
                if (totalPanels > 1) {
                  tabHtml += '<div class="recon-tabs-bar output-tabs-bar">';
                  var tabIdx = 0;
                  outputNames.forEach(function (name) {
                    tabHtml += '<button class="recon-tab' + (tabIdx === 0 ? ' recon-tab-active' : '') +
                      '" data-output-tab="out-panel-' + tabIdx + '" title="' + esc2(name) + '">' + esc2(name) + '</button>';
                    tabIdx++;
                  });
                  ctrlNames.forEach(function (stepId) {
                    var ctrlLabel = 'Ctrl: ' + esc2(stepId);
                    tabHtml += '<button class="recon-tab' + (tabIdx === 0 ? ' recon-tab-active' : '') +
                      '" data-output-tab="out-panel-' + tabIdx + '" title="' + ctrlLabel + '">' + ctrlLabel + '</button>';
                    tabIdx++;
                  });
                  tabHtml += '</div>';
                }

                // ── Panels ───────────────────────────────────────────────────
                var panelIdx = 0;
                outputNames.forEach(function (name) {
                  var rows = outputs[name] || [];
                  var cols = rows[0] ? Object.keys(rows[0]).filter(function (k) { return !k.startsWith('_'); }) : [];
                  if (cols.length === 0 && rows[0]) cols = Object.keys(rows[0]);
                  var hidden = totalPanels > 1 && panelIdx > 0;
                  tabHtml += '<div class="test-table-wrap output-panel" id="out-panel-' + panelIdx + '"' +
                    (hidden ? ' style="display:none"' : '') + '>';
                  tabHtml += '<h3>' + esc2(name) + '</h3>';
                  if (cols.length === 0 && rows.length === 0) {
                    tabHtml += '<p class="test-output-empty">Empty dataset.</p>';
                  } else {
                    tabHtml += '<table class="test-table"><thead><tr>' +
                      cols.map(function (c) { return '<th>' + esc2(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
                    rows.slice(0, 200).forEach(function (r) {
                      tabHtml += '<tr>' + cols.map(function (c) { return '<td>' + esc2(String(r[c] != null ? r[c] : '')) + '</td>'; }).join('') + '</tr>';
                    });
                    if (rows.length > 200) {
                      tabHtml += '<tr><td colspan="' + cols.length + '" class="test-recon-more">… ' + (rows.length - 200) + ' more rows not shown</td></tr>';
                    }
                    tabHtml += '</tbody></table>';
                  }
                  tabHtml += '</div>';
                  panelIdx++;
                });

                ctrlNames.forEach(function (stepId) {
                  var rows = ctrlOuts[stepId] || [];
                  var cols = rows[0] ? Object.keys(rows[0]).filter(function (k) { return !k.startsWith('_'); }) : [];
                  if (!cols.length && rows[0]) cols = Object.keys(rows[0]);
                  var hidden = totalPanels > 1 && panelIdx > 0;
                  tabHtml += '<div class="test-table-wrap output-panel" id="out-panel-' + panelIdx + '"' +
                    (hidden ? ' style="display:none"' : '') + '>';
                  tabHtml += '<h3>Control File: ' + esc2(stepId) + '</h3>';
                  if (!rows.length) {
                    tabHtml += '<p class="test-output-empty" style="margin:4px 0 8px">Control file generated (0 data rows).</p>';
                  } else {
                    tabHtml += '<table class="test-table"><thead><tr>' +
                      cols.map(function (c) { return '<th>' + esc2(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
                    rows.forEach(function (r) {
                      tabHtml += '<tr>' + cols.map(function (c) { return '<td>' + esc2(String(r[c] != null ? r[c] : '')) + '</td>'; }).join('') + '</tr>';
                    });
                    tabHtml += '</tbody></table>';
                  }
                  tabHtml += '</div>';
                  panelIdx++;
                });

                $outputTables.html(tabHtml);

                // Wire tab clicks
                $outputTables.find('[data-output-tab]').on('click', function () {
                  var panelId = $(this).attr('data-output-tab');
                  $outputTables.find('[data-output-tab]').removeClass('recon-tab-active');
                  $(this).addClass('recon-tab-active');
                  $outputTables.find('.output-panel').hide();
                  $outputTables.find('#' + panelId).show();
                });
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
      $runDataflowBtn.prop('disabled', false);
      $runDataflowBtn.text('Run Dataflow →');
      var $p = $('#test-logs-progress');
      if ($p.length) $p.addClass('hidden');
      /* Job failed — do not show "View Generated Output" */
      if ($outputCtaEl.length) $outputCtaEl.addClass('hidden');
      var $reconCtaOutput3 = $('#test-output-recon-cta');
      if ($reconCtaOutput3.length) $reconCtaOutput3.addClass('hidden');
      if ($showReconciliationBtnOutput.length) $showReconciliationBtnOutput.addClass('hidden');
      var errMsg = err && (err.message || String(err)) ? (err.message || String(err)) : 'Request failed or stream ended unexpectedly.';
      if ($logsEl.length) appendTestLogsContent($logsEl[0], '\nDataflow job failed.\nError: ' + errMsg + '\n');
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
      const $uploadSection = $('#file-upload-section');
      const $startTestingContainer = $('#start-testing-container');

      if (!selectedConfig) {
        $uploadSection.html('<p style="color: var(--text-secondary); font-size: 12px;">Select an interface to see dataset upload options</p>');
        $startTestingContainer.addClass('hidden');
        return;
      }

      const inputs = selectedConfig.Inputs || {};
      const outputs = selectedConfig.Outputs || {};
      const allDatasets = { ...inputs, ...outputs };

      if (Object.keys(allDatasets).length === 0) {
        $uploadSection.html('<p style="color: var(--text-secondary); font-size: 12px;">No datasets found in selected interface</p>');
        $startTestingContainer.addClass('hidden');
        return;
      }

      $uploadSection.html(Object.entries(allDatasets).map(([datasetKey, dataset]) => {
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
      }).join(''));

      // Add event listeners for upload buttons
      $uploadSection.find('.btn-upload-file').each(function () {
        var $btn = $(this);
        $btn.on('click', function() {
          const datasetKey = $btn.attr('data-dataset-key');
          const datasetType = $btn.attr('data-dataset-type');

          // Create a hidden file input
          const $fileInput = $('<input>').attr('type', 'file').attr('accept', '.csv,.txt,.json,.parquet').hide();

          $fileInput.on('change', (e) => {
            const file = e.target.files[0];
            if (file) {
              datasetFiles[datasetKey] = {
                file: file,
                dataset: selectedConfig.Inputs[datasetKey] || selectedConfig.Outputs[datasetKey],
                type: datasetType
              };
              renderDatasetUploadItems();
            }
            $fileInput.remove();
          });

          $(document.body).append($fileInput);
          $fileInput[0].click();
        });
      });

      // Add event listeners for remove buttons
      $uploadSection.find('.btn-remove-file').each(function () {
        var $btn = $(this);
        $btn.on('click', function() {
          const datasetKey = $btn.attr('data-dataset-key');
          delete datasetFiles[datasetKey];
          renderDatasetUploadItems();
        });
      });

      // Show/hide start testing button based on input files upload status
      const inputDatasets = Object.keys(inputs);
      const allInputsUploaded = inputDatasets.every(key => datasetFiles[key] && datasetFiles[key].file);
      
      if (allInputsUploaded && inputDatasets.length > 0) {
        $startTestingContainer.removeClass('hidden');
      } else {
        $startTestingContainer.addClass('hidden');
      }
    }

    function loadExistingConfigs() {
      API.configs().then(data => {
        existingConfigs = data.configs || [];
        const $select = $('#existing-config-select');
        if ($select.length) {
          $select.html('<option value="">-- Select existing interface --</option>' +
            existingConfigs.map(config =>
              `<option value="${config.path}">${config.name}</option>`
            ).join(''));
        }
      }).catch(err => {
        console.error('Failed to load configs:', err);
      });
    }

    function renderConfigDetails(config) {
      const $inputsContent = $('#config-inputs-content');
      const $outputsContent = $('#config-outputs-content');
      const $configInfo = $('#selected-config-info');

      if (!config) {
        $configInfo.addClass('hidden');
        renderDatasetUploadItems();
        return;
      }

      // Render inputs
      const inputs = config.Inputs || {};
      $inputsContent.html(Object.keys(inputs).length > 0 ?
        Object.entries(inputs).map(([key, input]) => `
          <div class="config-mapping-item">
            <div>
              <div class="config-mapping-name">${input.name || key}</div>
              <div class="config-mapping-path">${input.path || 'N/A'}</div>
            </div>
            <span class="config-mapping-format">${input.format || 'unknown'}</span>
          </div>
        `).join('') :
        '<p style="color: var(--text-secondary); font-size: 12px;">No input datasets found</p>');

      // Render outputs
      const outputs = config.Outputs || {};
      $outputsContent.html(Object.keys(outputs).length > 0 ?
        Object.entries(outputs).map(([key, output]) => `
          <div class="config-mapping-item">
            <div>
              <div class="config-mapping-name">${output.name || key}</div>
              <div class="config-mapping-path">${output.path || 'N/A'}</div>
            </div>
            <span class="config-mapping-format">${output.format || 'unknown'}</span>
          </div>
        `).join('') :
        '<p style="color: var(--text-secondary); font-size: 12px;">No output datasets found</p>');

      $configInfo.removeClass('hidden');
      renderDatasetUploadItems();
    }

    // Existing config selection handler
    const $configSelect = $('#existing-config-select');
    if ($configSelect.length) {
      $configSelect.on('change', async function() {
        const selectedPath = $(this).val();
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
    const $startTestingBtn = $('#btn-start-testing');
    if ($startTestingBtn.length) {
      $startTestingBtn.on('click', function() {
        if (!selectedConfig) {
          const $messageEl = $('#import-json-message');
          $messageEl.text('Please select an interface first');
          $messageEl.css('color', 'var(--error, #c62828)');
          return;
        }

        // Check if input files are uploaded (required for testing)
        const inputs = selectedConfig.Inputs || {};
        const missingInputs = Object.keys(inputs).filter(key => !datasetFiles[key]);
        
        if (missingInputs.length > 0) {
          const $messageEl2 = $('#import-json-message');
          $messageEl2.text(`Please upload files for all input datasets. Missing: ${missingInputs.join(', ')}`);
          $messageEl2.css('color', 'var(--error, #c62828)');
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
        const $testPage = $('#test-page');
        const $importPage = $('#import-page');
        const $mainContent = $('.main');

        if ($testPage.length && $importPage.length && $mainContent.length) {
          $importPage.addClass('hidden');
          $mainContent.addClass('hidden');
          $testPage.removeClass('hidden');

          // Update page title
          $('#test-page-config-name').text(selectedConfig.name || 'Selected Interface');
          
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
