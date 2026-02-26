/**
 * Logic view: buildLogicVisualHtml, buildIoSummaryHtml, showLogicPopup, renderSchemaTable.
 * Depends: utils.js
 */
(function (global) {
  global.CodeParser = global.CodeParser || {};
  var CP = global.CodeParser;
  var $ = CP.$;

  function transformTagWithIcon(type) {
    if (type == null || type === '') return CP.tag('', 'view-tag-empty');
    var iconClass = CP.getTransformIconClass(type);
    var s = String(type).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<span class="view-tag view-tag-type view-tag-type-icon"><i class="' + iconClass + '" aria-hidden="true"></i> ' + s + '</span>';
  }

  function formatTagWithIcon(format) {
    if (format == null || format === '') return CP.tag('', 'view-tag-empty');
    var iconClass = CP.getFormatIconClass(format);
    var s = String(format).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<span class="view-tag view-tag-format view-tag-format-icon"><i class="' + iconClass + '" aria-hidden="true"></i> ' + s + '</span>';
  }

  CP.buildIoSummaryHtml = function (info) {
    if (!info || !info.data) return '';
    var d = info.data;
    var parts = [];
    if (d.name) parts.push(CP.tag(d.name, 'view-tag-name'));
    if (d.dataset) parts.push(CP.tag(d.dataset, 'view-tag-dataset'));
    if (d.format) parts.push(formatTagWithIcon(d.format));
    if (info.type === 'input' && d.s3_path) parts.push(CP.tag(d.s3_path, 'view-tag-path'));
    if (info.type === 'output' && d.write_mode) parts.push(CP.tag(d.write_mode, 'view-tag-mode'));
    var title = (info.type === 'input' ? 'Input' : 'Output') + ': ' + (info.name || d.name || '');
    var fieldsLine = (d.fields && d.fields.length) ? '<div class="io-hover-fields">' + d.fields.length + ' schema field(s)</div>' : '';
    return '<div class="io-hover-summary">' +
      '<div class="io-hover-title">' + CP.escapeHtml(title) + '</div>' +
      '<div class="io-hover-tags">' + (parts.length ? parts.join(' ') : CP.tag('—', 'view-tag-empty')) + '</div>' +
      fieldsLine + '</div>';
  };

  CP.buildLogicVisualHtml = function (logic, stepType) {
    if (!logic || typeof logic !== 'object') return '<p class="logic-visual-empty">No logic defined.</p>';
    var type = (stepType || '').toLowerCase();
    var arrowV = '<span class="logic-visual-arrow-v" aria-hidden="true">↓</span>';
    var html = '<div class="logic-visual-picture logic-visual-vertical">';
    if (type === 'filter' && logic.conditions) {
      html += '<div class="logic-visual-flow-col"><span class="logic-visual-arrow-in">Input</span>' + arrowV;
      (logic.conditions || []).forEach(function (c, idx) {
        var field = c.field || c.column || '—';
        var op = c.operation || c.op || c.operator || '=';
        var val = c.value != null ? String(c.value) : '—';
        html += '<div class="logic-visual-op-card logic-visual-card-filter"><span class="logic-visual-op-num">' + (idx + 1) + '. <i class="' + CP.getExpressionOpIconClass('where') + '" aria-hidden="true"></i> WHERE</span><div class="logic-visual-op-detail"><span class="logic-visual-op-field">' + CP.escapeHtml(field) + '</span> <span class="logic-visual-op">' + CP.escapeHtml(op) + '</span> <span class="logic-visual-op-value">' + CP.escapeHtml(val) + '</span></div></div>' + arrowV;
      });
      html += '<span class="logic-visual-arrow-out">Output</span></div>';
    } else if (type === 'join' && (logic.on || logic.left)) {
      html += '<div class="logic-visual-join-picture logic-visual-join-vertical"><div class="logic-visual-card logic-visual-card-join"><span class="logic-visual-card-title">' + CP.escapeHtml(logic.left || 'Left') + '</span></div>' + arrowV + '<div class="logic-visual-join-on"><span class="logic-visual-on-label">ON</span>';
      if (logic.on && Array.isArray(logic.on)) {
        (logic.on || []).forEach(function (pair, idx) {
          var leftK = Array.isArray(pair) ? (pair[0] || '—') : String(pair).split('=')[0].trim() || '—';
          var rightK = Array.isArray(pair) ? (pair[1] || '—') : String(pair).split('=')[1].trim() || '—';
          html += '<div class="logic-visual-op-detail logic-visual-join-row">' + (idx + 1) + '. ' + CP.escapeHtml(leftK) + ' <span class="logic-visual-op">=</span> ' + CP.escapeHtml(rightK) + '</div>';
        });
      }
      html += '<span class="logic-visual-how">' + CP.escapeHtml(logic.how || 'inner') + '</span></div>' + arrowV + '<div class="logic-visual-card logic-visual-card-join"><span class="logic-visual-card-title">' + CP.escapeHtml(logic.right || 'Right') + '</span></div></div>';
    } else if (type === 'aggregate') {
      html += '<div class="logic-visual-flow-col"><span class="logic-visual-arrow-in">Input</span>' + arrowV;
      if (logic.group_by && logic.group_by.length) {
        html += '<div class="logic-visual-op-card"><span class="logic-visual-op-num"><i class="' + CP.getExpressionOpIconClass('group by') + '" aria-hidden="true"></i> GROUP BY</span><div class="logic-visual-op-detail">' + (logic.group_by || []).map(function (g) { return CP.escapeHtml(String(g)); }).join(', ') + '</div></div>' + arrowV;
      }
      if (logic.aggregations && logic.aggregations.length) {
        (logic.aggregations || []).forEach(function (a, idx) {
          var fn = (a.function || a.agg || a.operation || a.op || 'agg').toString().toUpperCase();
          var fnLower = fn.toLowerCase();
          var col = a.column || a.field || a.field_name || '*';
          var alias = a.alias ? ' <span class="logic-visual-op-arrow">→</span> ' + CP.escapeHtml(a.alias) : '';
          html += '<div class="logic-visual-op-card"><span class="logic-visual-op-num">' + (idx + 1) + '. <i class="' + CP.getExpressionOpIconClass(fnLower) + '" aria-hidden="true"></i> ' + CP.escapeHtml(fn) + '</span><div class="logic-visual-op-detail">' + CP.escapeHtml(col) + alias + '</div></div>' + arrowV;
        });
      }
      html += '<span class="logic-visual-arrow-out">Output</span></div>';
    } else if (type === 'select' && (logic.columns || logic.column_expressions || logic.expressions)) {
      html += '<div class="logic-visual-flow-col"><span class="logic-visual-arrow-in">Input</span>' + arrowV;
      var exprList = logic.expressions || logic.column_expressions || logic.columns || [];
      exprList.forEach(function (c, idx) {
        var opLabel = '', detail = '', exprOp = '';
        if (typeof c === 'object' && c !== null && (c.operation || c.op)) {
          exprOp = (c.operation || c.op || '').toLowerCase();
          opLabel = (c.operation || c.op || '').toUpperCase();
          var target = c.target || c.alias || c.name || '—';
          var expr = c.expression || c.column || c.field || '—';
          if (String(expr).length > 50) expr = String(expr).slice(0, 47) + '…';
          detail = CP.escapeHtml(expr) + ' <span class="logic-visual-op-arrow">→</span> ' + CP.escapeHtml(target);
        } else {
          var raw = typeof c === 'string' ? c : (c.expression || c.name || c.target || (c.column && c.alias ? c.column + ' as ' + c.alias : null) || JSON.stringify(c));
          if (String(raw).length > 50) raw = String(raw).slice(0, 47) + '…';
          opLabel = 'SELECT';
          detail = CP.escapeHtml(raw);
        }
        html += '<div class="logic-visual-op-card"><span class="logic-visual-op-num">' + (idx + 1) + '. <i class="' + CP.getExpressionOpIconClass(exprOp) + '" aria-hidden="true"></i> ' + CP.escapeHtml(opLabel) + '</span><div class="logic-visual-op-detail">' + detail + '</div></div>' + arrowV;
      });
      html += '<span class="logic-visual-arrow-out">Output</span></div>';
    } else {
      html += '<div class="logic-visual-blocks">';
      var keys = Object.keys(logic);
      keys.forEach(function (k, i) {
        if (i > 0) html += arrowV;
        var v = logic[k];
        var valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (valStr.length > 60) valStr = valStr.slice(0, 57) + '…';
        html += '<div class="logic-visual-block"><span class="logic-visual-label">' + CP.escapeHtml(k) + '</span><div class="logic-visual-row">' + CP.escapeHtml(valStr) + '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  };

  var schemaColumnOrder = ['name', 'type', 'start', 'length', 'precision', 'scale', 'nullable', 'source'];
  var schemaColumnLabels = { name: 'Name', type: 'Type', start: 'Start', length: 'Length', precision: 'Precision', scale: 'Scale', nullable: 'Nullable', source: 'Source' };

  CP.renderSchemaTable = function (fields) {
    var tableWrap = $('logic-view-io-schema-table');
    var emptyEl = $('logic-view-io-schema-empty');
    if (!tableWrap || !emptyEl) return;
    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      tableWrap.innerHTML = '';
      tableWrap.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      return;
    }
    var keys = [];
    var seen = {};
    schemaColumnOrder.forEach(function (k) {
      if (fields.some(function (row) { return row != null && Object.prototype.hasOwnProperty.call(row, k); })) { keys.push(k); seen[k] = true; }
    });
    fields.forEach(function (row) {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach(function (k) {
          if (!seen[k]) { keys.push(k); seen[k] = true; }
        });
      }
    });
    var thead = keys.map(function (k) { return '<th>' + CP.escapeHtml(schemaColumnLabels[k] || k) + '</th>'; }).join('');
    var rows = fields.map(function (row) {
      if (row == null || typeof row !== 'object') return '<tr><td colspan="' + keys.length + '">—</td></tr>';
      var cells = keys.map(function (k) {
        var v = row[k];
        if (v === null || v === undefined) return '<td>—</td>';
        return '<td>' + CP.escapeHtml(String(v)) + '</td>';
      });
      return '<tr>' + cells.join('') + '</tr>';
    });
    tableWrap.innerHTML = '<table><thead><tr>' + thead + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    tableWrap.classList.remove('hidden');
    emptyEl.classList.add('hidden');
  };

  CP.setLogicViewMode = function (mode) {
    var visualBtn = $('logic-toggle-visual');
    var kvBtn = $('logic-toggle-kv');
    var jsonBtn = $('logic-toggle-json');
    var visualWrap = $('logic-view-logic-visual-wrap');
    var kvWrap = $('logic-view-logic-wrap');
    var jsonWrap = $('logic-view-logic-json-wrap');
    [visualBtn, kvBtn, jsonBtn].forEach(function (btn) {
      if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-selected', 'false'); }
    });
    [visualWrap, kvWrap, jsonWrap].forEach(function (el) { if (el) el.classList.add('hidden'); });
    if (mode === 'visual') {
      if (visualBtn) { visualBtn.classList.add('active'); visualBtn.setAttribute('aria-selected', 'true'); }
      if (visualWrap) visualWrap.classList.remove('hidden');
    } else if (mode === 'json') {
      if (jsonBtn) { jsonBtn.classList.add('active'); jsonBtn.setAttribute('aria-selected', 'true'); }
      if (jsonWrap) jsonWrap.classList.remove('hidden');
    } else {
      if (kvBtn) { kvBtn.classList.add('active'); kvBtn.setAttribute('aria-selected', 'true'); }
      if (kvWrap) kvWrap.classList.remove('hidden');
    }
  };

  CP.showLogicPopup = function (nodeId, info) {
    var stepView = $('logic-view-step');
    var ioView = $('logic-view-io');
    var ioBody = $('logic-view-io-body');
    var logicModalTitle = $('logic-modal-title');
    var detailDrawer = $('detail-drawer');
    if (info.type === 'input') {
      logicModalTitle.textContent = 'Input: ' + info.name;
      stepView.style.display = 'none';
      ioView.style.display = 'block';
      var d = info.data;
      var parts = [];
      if (d.name) parts.push(CP.tag(d.name, 'view-tag-name'));
      if (d.dataset) parts.push(CP.tag(d.dataset, 'view-tag-dataset'));
      if (d.format) parts.push(formatTagWithIcon(d.format));
      if (d.s3_path) parts.push(CP.tag(d.s3_path, 'view-tag-path'));
      $('logic-view-io-tags').innerHTML = parts.length ? '<span class="view-tags">' + parts.join(' ') + '</span>' : CP.tag('', 'view-tag-empty');
      CP.renderSchemaTable(d.fields);
      ioBody.textContent = JSON.stringify(d, null, 2);
    } else if (info.type === 'output') {
      logicModalTitle.textContent = 'Output: ' + info.name;
      stepView.style.display = 'none';
      ioView.style.display = 'block';
      var d = info.data;
      var parts = [];
      if (d.name) parts.push(CP.tag(d.name, 'view-tag-name'));
      if (d.dataset) parts.push(CP.tag(d.dataset, 'view-tag-dataset'));
      if (d.format) parts.push(formatTagWithIcon(d.format));
      if (d.write_mode) parts.push(CP.tag(d.write_mode, 'view-tag-mode'));
      $('logic-view-io-tags').innerHTML = parts.length ? '<span class="view-tags">' + parts.join(' ') + '</span>' : CP.tag('', 'view-tag-empty');
      CP.renderSchemaTable(d.fields);
      ioBody.textContent = JSON.stringify(d, null, 2);
    } else {
      var s = info.data;
      logicModalTitle.textContent = (s.id || 'Step') + ' (' + (s.type || '') + ')';
      stepView.style.display = 'block';
      ioView.style.display = 'none';
      $('logic-view-id').innerHTML = '<span class="view-tags">' + CP.tag(s.id, 'view-tag-id') + '</span>';
      $('logic-view-description').innerHTML = '<span class="view-tags">' + (s.description ? CP.tag(s.description, 'view-tag-desc') : CP.tag('—', 'view-tag-empty')) + '</span>';
      $('logic-view-type').innerHTML = '<span class="view-tags">' + transformTagWithIcon(s.type) + '</span>';
      var srcArr = Array.isArray(s.source_inputs) ? s.source_inputs : (s.source_inputs ? [s.source_inputs] : []);
      $('logic-view-source-inputs').innerHTML = srcArr.length ? '<span class="view-tags">' + srcArr.map(function (x) { return CP.tag(x, 'view-tag-source'); }).join(' ') + '</span>' : CP.tag('', 'view-tag-empty');
      $('logic-view-output-alias').innerHTML = '<span class="view-tags">' + CP.tag(s.output_alias, 'view-tag-output') + '</span>';
      var logicEl = $('logic-view-logic');
      var logicJsonEl = $('logic-view-logic-json');
      var logic = s.logic;
      if (logic && typeof logic === 'object' && !Array.isArray(logic)) {
        var html = '';
        Object.keys(logic).forEach(function (k) {
          var v = logic[k];
          var keyTag = CP.tag(k, 'view-tag-logic-key');
          var valHtml;
          if (v === null || v === undefined) valHtml = '<span class="logic-kv-value logic-kv-empty">—</span>';
          else if (Array.isArray(v)) {
            if (v.length === 0) valHtml = '<span class="logic-kv-value">[]</span>';
            else if (typeof v[0] === 'object' && v[0] !== null) valHtml = '<pre class="logic-kv-value logic-kv-pre">' + CP.escapeHtml(JSON.stringify(v, null, 2)) + '</pre>';
            else valHtml = '<span class="view-tags">' + v.map(function (x) { return CP.tag(String(x), 'view-tag-logic-val'); }).join(' ') + '</span>';
          } else if (typeof v === 'object') valHtml = '<pre class="logic-kv-value logic-kv-pre">' + CP.escapeHtml(JSON.stringify(v, null, 2)) + '</pre>';
          else valHtml = '<span class="logic-kv-value">' + CP.escapeHtml(String(v)) + '</span>';
          html += '<div class="logic-kv-row">' + keyTag + valHtml + '</div>';
        });
        logicEl.innerHTML = html || '<span class="logic-kv-empty">—</span>';
      } else if (logic && typeof logic === 'object' && Array.isArray(logic)) {
        logicEl.innerHTML = '<pre class="logic-kv-value logic-kv-pre">' + CP.escapeHtml(JSON.stringify(logic, null, 2)) + '</pre>';
      } else {
        logicEl.innerHTML = logic != null && logic !== '' ? '<span class="logic-kv-value">' + CP.escapeHtml(String(logic)) + '</span>' : '<span class="logic-kv-empty">—</span>';
      }
      if (logicJsonEl) logicJsonEl.textContent = logic != null && typeof logic === 'object' ? JSON.stringify(logic, null, 2) : (logic != null ? String(logic) : '');
      CP.setLogicViewMode('visual');
      var visualEl = $('logic-view-logic-visual');
      if (visualEl) visualEl.innerHTML = CP.buildLogicVisualHtml(s.logic, s.type || '');
    }
    if (detailDrawer) detailDrawer.classList.add('open');
  };
})(typeof window !== 'undefined' ? window : this);
