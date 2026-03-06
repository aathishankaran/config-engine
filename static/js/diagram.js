/**
 * Dataflow diagram: build graph from config, init vis-network, crossed-arrow fix.
 * Depends: utils.js, logic-view.js. App must set CodeParser.nodeClickHandler before initNetwork.
 */
(function (global) {
  global.CodeParser = global.CodeParser || {};
  var CP = global.CodeParser;

  CP.nodeDataMap = {};
  CP.network = null;

  function buildGraphFromConfig(config) {
    var nodes = new Map();
    var edges = [];
    CP.nodeDataMap = {};

    var inputs = config.Inputs || config.inputs || {};
    var outputs = config.Outputs || config.outputs || {};
    var trans = config.Transformations || config.transformations || {};
    var steps = trans.steps || [];

    function resolveSourceId(src) {
      if (nodes.has('input:' + src)) return 'input:' + src;
      var idx = steps.findIndex(function (st) { return (st.id && st.id === src) || st.output_alias === src; });
      if (idx >= 0) return 'step:' + (steps[idx].id || idx);
      return null;
    }

    for (var name in inputs) {
      if (!Object.prototype.hasOwnProperty.call(inputs, name)) continue;
      var id = 'input:' + name;
      var data = inputs[name];
      nodes.set(id, {
        id: id,
        label: name + '\n(Input)',
        level: 0,
        color: { background: '#9ae6b4', border: '#68d391' },
        font: { size: 14 },
        margin: 20,
        widthConstraint: { minimum: 140 }
      });
      CP.nodeDataMap[id] = { type: 'input', name: name, data: data || {} };
    }

    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var id = 'step:' + (s.id || i);
      var typeLabel = (s.type || 'step').toUpperCase();
      var sources = s.source_inputs || [];
      var outAlias = s.output_alias || '';
      var shortId = outAlias || (s.id || 'step_' + (i + 1));
      var labelLines = [shortId + ' [' + typeLabel + ']'];
      if (sources.length) labelLines.push('From: ' + sources.join(', '));
      if (outAlias) labelLines.push('To: ' + outAlias);
      var stepLabel = labelLines.join('\n');
      if (!stepLabel || stepLabel.trim() === '') stepLabel = 'Step ' + (i + 1);
      /* Each step gets its own level so they stack vertically one by one (input=0, step0=1, step1=2, ...). */
      var stepLevel = 1 + i;
      nodes.set(id, {
        id: id,
        label: stepLabel,
        level: stepLevel,
        color: { background: '#90cdf4', border: '#63b3ed' },
        font: { size: 13, face: 'sans-serif' },
        margin: 14,
        widthConstraint: { minimum: 180, maximum: 280 }
      });
      CP.nodeDataMap[id] = { type: 'step', index: i, data: s };
      if (sources.length > 0) {
        for (var j = 0; j < sources.length; j++) {
          var srcId = resolveSourceId(sources[j]);
          if (srcId) edges.push({ from: srcId, to: id });
        }
      } else {
        // Step with no source_inputs (e.g. import/exec summary): connect from all inputs so diagram shows flow
        for (var inputName in inputs) {
          if (Object.prototype.hasOwnProperty.call(inputs, inputName)) {
            edges.push({ from: 'input:' + inputName, to: id });
          }
        }
      }
    }

    // Order outputs by source step index to avoid crossed arrows
    var outputOrder = [];
    var seen = {};
    for (var k = 0; k < steps.length; k++) {
      var alias = steps[k].output_alias;
      if (alias && outputs[alias] && !seen[alias]) {
        outputOrder.push(alias);
        seen[alias] = true;
      }
    }
    for (var outName in outputs) {
      if (Object.prototype.hasOwnProperty.call(outputs, outName) && !seen[outName]) outputOrder.push(outName);
    }

    var outputLevel = 1 + steps.length;
    var groupOutputs = outputOrder.length > 4;
    if (groupOutputs) {
      var outGroupId = 'output:__grouped__';
      nodes.set(outGroupId, {
        id: outGroupId,
        label: 'Outputs\n(' + outputOrder.length + ' files)',
        level: outputLevel,
        color: { background: '#fbd38d', border: '#f6ad55' },
        font: { size: 14 },
        margin: 20,
        widthConstraint: { minimum: 140 }
      });
      CP.nodeDataMap[outGroupId] = { type: 'output', name: 'Outputs', data: { outputs: outputOrder } };
      for (var kk = 0; kk < steps.length; kk++) {
        if (steps[kk].output_alias) {
          edges.push({ from: 'step:' + (steps[kk].id || kk), to: outGroupId });
        }
      }
    } else {
      for (var m = 0; m < outputOrder.length; m++) {
        var name = outputOrder[m];
        var id = 'output:' + name;
        nodes.set(id, {
          id: id,
          label: name + '\n(Output)',
          level: outputLevel,
          color: { background: '#fbd38d', border: '#f6ad55' },
          font: { size: 14 },
          margin: 20,
          widthConstraint: { minimum: 140 }
        });
        CP.nodeDataMap[id] = { type: 'output', name: name, data: outputs[name] };
        var stepForOut = steps.find(function (s) { return (s.output_alias || '') === name; });
        if (stepForOut) {
          var stepId = 'step:' + (stepForOut.id || steps.indexOf(stepForOut));
          edges.push({ from: stepId, to: id });
        }
      }
    }

    return { nodes: Array.from(nodes.values()), edges: edges };
  }

  CP.buildGraphFromConfig = buildGraphFromConfig;

  CP.initNetwork = function (container, config, options) {
    var data = buildGraphFromConfig(config);
    var opts = {
      nodes: { shape: 'box', margin: 20, widthConstraint: { minimum: 140, maximum: 220 }, font: { size: 14 } },
      edges: { arrows: 'to' },
      layout: {
        hierarchical: {
          direction: 'UD',
          sortMethod: 'directed',
          levelSeparation: 200,
          nodeSpacing: 280,
          blockShifting: true,
          edgeMinimization: true,
          parentCentralization: true
        }
      },
      physics: false,
      interaction: { dragNodes: true, dragView: true, zoomView: true, hover: true }
    };
    if (CP.network) {
      CP.network.destroy();
      CP.network = null;
    }
    var wrap = $(container).parent();
    var w = (wrap.length && wrap.outerWidth()) || $(container).outerWidth() || 800;
    var h = (wrap.length && wrap.outerHeight()) || $(container).outerHeight() || 500;
    $(container).css('width', w + 'px');
    $(container).css('height', h + 'px');

    CP.network = new vis.Network(container, data, opts);

    var diagramContainer = wrap.length && wrap.parent();

    CP.network.on('click', function (params) {
      if (params.nodes.length === 0) return;
      var nodeId = params.nodes[0];
      var info = CP.nodeDataMap[nodeId];
      if (!info) return;
      if (typeof CP.nodeClickHandler === 'function') CP.nodeClickHandler(nodeId, info);
    });

    var stepHoverPopup = $('#step-hover-popup');
    var stepHoverPopupInner = stepHoverPopup.length && stepHoverPopup.find('.step-hover-popup-inner');
    var lastPointer = { x: 0, y: 0 };

    function positionStepHoverPopup() {
      if (!stepHoverPopup.length || stepHoverPopup.hasClass('hidden')) return;
      var diagramEl = (diagramContainer && diagramContainer.length) ? diagramContainer : $(container).parent();
      var rect = diagramEl.length ? diagramEl[0].getBoundingClientRect() : { left: 0, top: 0, width: 400, height: 300 };
      var x = lastPointer.x - rect.left + 16;
      var y = lastPointer.y - rect.top + 16;
      var maxW = (rect.width || 400) - 40;
      var maxH = (rect.height || 300) - 40;
      if (x + 320 > maxW) x = maxW - 320;
      if (y + 300 > maxH) y = maxH - 300;
      if (x < 8) x = 8;
      if (y < 8) y = 8;
      stepHoverPopup.css('left', x + 'px');
      stepHoverPopup.css('top', y + 'px');
    }

    $(container).on('mousemove', function (e) {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      if (stepHoverPopup.length && !stepHoverPopup.hasClass('hidden')) positionStepHoverPopup();
    });

    CP.network.on('hoverNode', function (params) {
      if (!stepHoverPopup.length || !stepHoverPopupInner || !stepHoverPopupInner.length) return;
      if (CP.hoverPopupsEnabled === false) {
        stepHoverPopup.addClass('hidden');
        stepHoverPopup.attr('aria-hidden', 'true');
        return;
      }
      var nodeId = params.node;
      if (nodeId == null) {
        stepHoverPopup.addClass('hidden');
        stepHoverPopup.attr('aria-hidden', 'true');
        return;
      }
      var info = CP.nodeDataMap[nodeId];
      if (!info) {
        stepHoverPopup.addClass('hidden');
        stepHoverPopup.attr('aria-hidden', 'true');
        return;
      }
      if (info.type === 'step') {
        var s = info.data;
        var logic = s && (s.logic || (s.config && s.config.logic) || s);
        var stepLabel = (s.id || 'step') + ' — ' + (s.type || 'step').toUpperCase();
        var iconClass = CP.getTransformIconClass(s && s.type);
        stepHoverPopupInner.html('<div class="step-hover-popup-step-header"><i class="' + iconClass + '" aria-hidden="true"></i> <span>' + CP.escapeHtml(stepLabel) + '</span></div>' + (CP.buildLogicVisualHtml ? CP.buildLogicVisualHtml(logic, s && s.type) : ''));
      } else if (info.type === 'input' || info.type === 'output') {
        stepHoverPopupInner.html(CP.buildIoSummaryHtml ? CP.buildIoSummaryHtml(info) : '');
      } else {
        stepHoverPopup.addClass('hidden');
        stepHoverPopup.attr('aria-hidden', 'true');
        return;
      }
      stepHoverPopup.removeClass('hidden');
      stepHoverPopup.attr('aria-hidden', 'false');
      positionStepHoverPopup();
    });

    CP.network.on('blurNode', function () {
      if (stepHoverPopup.length) {
        stepHoverPopup.addClass('hidden');
        stepHoverPopup.attr('aria-hidden', 'true');
      }
    });

    $(container).on('mouseleave', function () {
      if (stepHoverPopup.length) {
        stepHoverPopup.addClass('hidden');
        stepHoverPopup.attr('aria-hidden', 'true');
      }
    });

    $(container).on('dragover', function (e) { e.preventDefault(); });

    function fitToContainer() {
      if (!CP.network || !wrap.length) return;
      wrap.css('width', '');
      wrap.css('height', '');
      wrap.css('min-width', '');
      wrap.css('min-height', '');
      var ww = wrap.outerWidth();
      var hh = wrap.outerHeight();
      if (ww && hh) {
        $(container).css('width', ww + 'px');
        $(container).css('height', hh + 'px');
        try {
          CP.network.setSize(ww + 'px', hh + 'px');
          CP.network.fit({ animation: false });
        } catch (e) {}
      }
    }
    CP.fitDiagram = fitToContainer;
    CP.zoomIn = function () {
      if (!CP.network) return;
      try {
        var scale = CP.network.getScale();
        if (scale > 0 && isFinite(scale)) CP.network.moveTo({ scale: Math.min(scale * 1.2, 4), animation: { duration: 200 } });
      } catch (e) {}
    };
    CP.zoomOut = function () {
      if (!CP.network) return;
      try {
        var scale = CP.network.getScale();
        if (scale > 0 && isFinite(scale)) CP.network.moveTo({ scale: Math.max(scale / 1.2, 0.1), animation: { duration: 200 } });
      } catch (e) {}
    };
    CP.setMoveMode = function (enabled) {
      if (!CP.network) return;
      try {
        CP.network.setOptions({ interaction: { dragNodes: !enabled, dragView: true, zoomView: true, hover: true } });
      } catch (e) {}
    };
    setTimeout(fitToContainer, 100);
    setTimeout(fitToContainer, 400);
    $(window).on('resize', function () {
      if (CP.network && $('#network').length) fitToContainer();
    });
  };
})(typeof window !== 'undefined' ? window : this);
