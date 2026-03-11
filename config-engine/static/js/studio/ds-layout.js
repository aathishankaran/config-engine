/**
 * ds-layout.js — Canvas transform, port positions, connection paths, auto-layout, fit-canvas.
 * Depends: ds-namespace.js, ds-constants.js, ds-state.js, ds-utils.js
 */
(function(DS) {
"use strict";

var C = DS.C, S = DS.S;

/* ---- Apply canvas transform ---- */
function applyTransform() {
  var $canvas = $('#canvas');
  $canvas.css('transform', 'translate(' + S.panX + 'px,' + S.panY + 'px) scale(' + S.zoom + ')');
  $canvas.css('transformOrigin', '0 0');
  var $disp = $('#zoom-display');
  if ($disp.length) $disp.text(Math.round(S.zoom * 100) + '%');
}

/* ---- Port centre calculation ---- */
function getPortCenter(nodeId, portType) {
  var n = S.nodes.find(function(node){ return node.id === nodeId; });
  if (!n) return {x:0, y:0};
  var nw = n.width || C.NODE_W;
  var $nodeEl = $('[data-node-id="' + nodeId + '"]');
  var nh = ($nodeEl.length && $nodeEl.outerHeight() > 0) ? $nodeEl.outerHeight() : C.NODE_H;

  if (S.layoutMode === 'horizontal') {
    var cy = n.y + nh / 2;
    if (portType === 'out') return { x: n.x + nw, y: cy };
    return { x: n.x, y: cy };
  }
  var cx = n.x + nw / 2;
  if (portType === 'out') return { x: cx, y: n.y + nh };
  return { x: cx, y: n.y };
}

/* ---- Orthogonal elbow path ---- */
function elbowPath(from, to) {
  if (S.layoutMode === 'horizontal') {
    if (to.x >= from.x) {
      var midX = Math.round((from.x + to.x) / 2);
      return 'M ' + from.x + ' ' + from.y
           + ' L ' + midX   + ' ' + from.y
           + ' L ' + midX   + ' ' + to.y
           + ' L ' + to.x   + ' ' + to.y;
    }
    var sideY = Math.min(from.y, to.y) - 50;
    return 'M ' + from.x          + ' ' + from.y
         + ' L ' + (from.x + 32)  + ' ' + from.y
         + ' L ' + (from.x + 32)  + ' ' + sideY
         + ' L ' + (to.x   - 32)  + ' ' + sideY
         + ' L ' + (to.x   - 32)  + ' ' + to.y
         + ' L ' + to.x           + ' ' + to.y;
  }

  var mid1Y = from.y + C.ELBOW_GAP;
  var mid2Y = to.y   - C.ELBOW_GAP;

  if (Math.abs(from.x - to.x) < 4) {
    return 'M ' + from.x + ' ' + from.y + ' L ' + to.x + ' ' + to.y;
  }

  if (to.y >= from.y) {
    var midY = (from.y + to.y) / 2;
    return 'M ' + from.x + ' ' + from.y
         + ' L ' + from.x + ' ' + midY
         + ' L ' + to.x   + ' ' + midY
         + ' L ' + to.x   + ' ' + to.y;
  }

  var sideX = Math.max(from.x, to.x) + 50;
  return 'M ' + from.x + ' ' + from.y
       + ' L ' + from.x + ' ' + mid1Y
       + ' L ' + sideX  + ' ' + mid1Y
       + ' L ' + sideX  + ' ' + mid2Y
       + ' L ' + to.x   + ' ' + mid2Y
       + ' L ' + to.x   + ' ' + to.y;
}

/* ---- Update layout toggle buttons ---- */
function updateLayoutToggle(mode) {
  var $btnV = $('#tb-auto-layout');
  var $btnH = $('#tb-h-align');
  if (!$btnV.length || !$btnH.length) return;
  if (mode === 'horizontal') {
    $btnV.removeClass('layout-active');
    $btnH.addClass('layout-active');
  } else {
    $btnH.removeClass('layout-active');
    $btnV.addClass('layout-active');
  }
}

/* ---- Auto-layout: VERTICAL top-to-bottom ---- */
function autoLayout() {
  var snap = DS.fn.snap;
  var inputNodes  = S.nodes.filter(function(n){ return n.type === 'input'; });
  var outputNodes = S.nodes.filter(function(n){ return n.type === 'output' || n.type === 'efs_write'; });
  var stepNodes   = S.nodes.filter(function(n){ return n.type !== 'input' && n.type !== 'output' && n.type !== 'efs_write'; });

  var rowGap   = C.NODE_H + 60;
  var startX   = 60;
  var startY   = 60;

  var maxCount = Math.max(inputNodes.length, outputNodes.length, 1);
  var gridW    = maxCount * C.NODE_W + (maxCount - 1) * 40;
  var pipelineCenterX = startX + gridW / 2;

  function layoutRow(arr, rowY) {
    var rowW      = arr.length * C.NODE_W + (arr.length - 1) * 40;
    var rowStartX = Math.round(pipelineCenterX - rowW / 2);
    arr.forEach(function(n, i) {
      n.x = snap(rowStartX + i * (C.NODE_W + 40));
      n.y = snap(rowY);
    });
  }

  var orderedIds  = DS.fn.topoSort();
  var sortedSteps = stepNodes.slice().sort(function(a, b) {
    var ai = orderedIds.indexOf(a.id), bi = orderedIds.indexOf(b.id);
    if (ai < 0) ai = 9999; if (bi < 0) bi = 9999;
    return ai - bi;
  });

  var currentY = startY;
  layoutRow(inputNodes, currentY);
  if (inputNodes.length > 0) currentY += rowGap;

  sortedSteps.forEach(function(n) {
    n.x = snap(pipelineCenterX - C.NODE_W / 2);
    n.y = snap(currentY);
    currentY += rowGap;
  });

  layoutRow(outputNodes, currentY);

  S.nodes.forEach(function(n) {
    var $el = $('[data-node-id="' + n.id + '"]');
    if ($el.length) { $el.css('left', n.x + 'px').css('top', n.y + 'px'); }
  });

  S.layoutMode = 'vertical';
  var $cw = $('.studio-canvas-wrap');
  if ($cw.length) { $cw.removeClass('layout-h').addClass('layout-v'); }
  DS.fn.renderConnections();
  fitCanvas();
  if (S.zoom < 0.65) { S.zoom = 0.65; applyTransform(); }
  updateLayoutToggle('vertical');
}

/* ---- Auto-layout: HORIZONTAL left-to-right ---- */
function autoLayoutHorizontal() {
  if (S.nodes.length === 0) return;
  var snap = DS.fn.snap;

  var inEdgesMap = {};
  S.nodes.forEach(function(n) { inEdgesMap[n.id] = []; });
  S.connections.forEach(function(c) {
    if (inEdgesMap[c.to]) inEdgesMap[c.to].push(c.from);
  });

  var col = {};
  var orderedIds = DS.fn.topoSort();
  orderedIds.forEach(function(id) {
    var parents = inEdgesMap[id] || [];
    col[id] = parents.length === 0 ? 0
            : Math.max.apply(null, parents.map(function(p) { return (col[p] || 0) + 1; }));
  });
  S.nodes.forEach(function(n) { if (col[n.id] === undefined) col[n.id] = 0; });

  var colGroups = {};
  S.nodes.forEach(function(n) {
    var c = col[n.id];
    if (!colGroups[c]) colGroups[c] = [];
    colGroups[c].push(n);
  });

  var colW   = C.NODE_W + 80;
  var rowH   = C.NODE_H + 40;
  var startX = 60;
  var startY = 60;

  var maxRows = 0;
  Object.keys(colGroups).forEach(function(c) {
    maxRows = Math.max(maxRows, colGroups[c].length);
  });
  var totalGridH = maxRows * rowH;

  Object.keys(colGroups).sort(function(a, b) { return +a - +b; }).forEach(function(c) {
    var group = colGroups[c];
    var offsetY = Math.round((totalGridH - group.length * rowH) / 2);
    group.forEach(function(n, rowIdx) {
      n.x = snap(startX + (+c) * colW);
      n.y = snap(startY + offsetY + rowIdx * rowH);
    });
  });

  S.nodes.forEach(function(n) {
    var $el = $('[data-node-id="' + n.id + '"]');
    if ($el.length) { $el.css('left', n.x + 'px').css('top', n.y + 'px'); }
  });

  S.layoutMode = 'horizontal';
  var $cw = $('.studio-canvas-wrap');
  if ($cw.length) { $cw.addClass('layout-h').removeClass('layout-v'); }

  DS.fn.renderConnections();
  fitCanvas();
  if (S.zoom < 0.65) { S.zoom = 0.65; applyTransform(); }
  updateLayoutToggle('horizontal');
}

/* ---- Fit canvas to content ---- */
function fitCanvas() {
  if (S.nodes.length === 0) { S.zoom=1; S.panX=60; S.panY=60; applyTransform(); return; }
  var $wrap = $('#canvas-wrap');
  var ww = $wrap.innerWidth(), wh = $wrap.innerHeight();
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  S.nodes.forEach(function(n){ minX=Math.min(minX,n.x); minY=Math.min(minY,n.y); maxX=Math.max(maxX,n.x+C.NODE_W); maxY=Math.max(maxY,n.y+C.NODE_H); });
  var pad = 60;
  var zx = (ww - pad*2) / (maxX - minX + pad);
  var zy = (wh - pad*2) / (maxY - minY + pad);
  S.zoom = Math.min(C.MAX_ZOOM, Math.max(C.MIN_ZOOM, Math.min(zx, zy)));
  S.panX = (ww - (maxX - minX) * S.zoom) / 2 - minX * S.zoom;
  S.panY = (wh - (maxY - minY) * S.zoom) / 2 - minY * S.zoom;
  applyTransform();
}

/* ---- Export to namespace ---- */
DS.fn.applyTransform         = applyTransform;
DS.fn.getPortCenter          = getPortCenter;
DS.fn.elbowPath              = elbowPath;
DS.fn.updateLayoutToggle     = updateLayoutToggle;
DS.fn.autoLayout             = autoLayout;
DS.fn.autoLayoutHorizontal   = autoLayoutHorizontal;
DS.fn.fitCanvas              = fitCanvas;

})(window.DS);
