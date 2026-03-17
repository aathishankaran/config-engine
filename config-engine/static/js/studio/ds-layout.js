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

/* ---- Check for intermediate nodes on a vertical path ---- */
function _hasBlockingNode(fromX, fromY, toX, toY) {
  /* Returns true when any node sits between from and to in the vertical
     band (checking x overlap) — meaning a straight or simple elbow line
     would visually pass through that node. */
  var minY = Math.min(fromY, toY) + C.NODE_H / 2;
  var maxY = Math.max(fromY, toY) - C.NODE_H / 2;
  var bandLeft  = Math.min(fromX, toX) - C.NODE_W / 2;
  var bandRight = Math.max(fromX, toX) + C.NODE_W / 2;
  for (var i = 0; i < S.nodes.length; i++) {
    var n = S.nodes[i];
    var nw = n.width || C.NODE_W;
    var nh = C.NODE_H;
    var ncx = n.x + nw / 2;
    var ncy = n.y + nh / 2;
    if (ncy > minY && ncy < maxY && ncx > bandLeft && ncx < bandRight) {
      return true;
    }
  }
  return false;
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

  /* Same column: straight line for adjacent hops, bypass-right for long jumps
     that skip intermediate rows. */
  if (Math.abs(from.x - to.x) < 4) {
    if (to.y - from.y > C.NODE_H + 40) {
      var bypassX = from.x + Math.round(C.NODE_W / 2) + 20;
      return 'M ' + from.x + ' ' + from.y
           + ' L ' + from.x + ' ' + mid1Y
           + ' L ' + bypassX + ' ' + mid1Y
           + ' L ' + bypassX + ' ' + mid2Y
           + ' L ' + to.x   + ' ' + mid2Y
           + ' L ' + to.x   + ' ' + to.y;
    }
    return 'M ' + from.x + ' ' + from.y + ' L ' + to.x + ' ' + to.y;
  }

  /* Different columns, downward flow: check if a simple elbow would
     pass through an intermediate node.  If so, route via the outside
     (left or right) to avoid overlapping. */
  if (to.y >= from.y) {
    if (_hasBlockingNode(from.x, from.y, to.x, to.y)) {
      /* Route around: drop down a bit, move horizontally outside, then
         drop to target.  Pick the side that moves away from center. */
      var outsideX;
      if (to.x < from.x) {
        outsideX = Math.min(from.x, to.x) - C.NODE_W / 2 - 30;
      } else {
        outsideX = Math.max(from.x, to.x) + C.NODE_W / 2 + 30;
      }
      return 'M ' + from.x   + ' ' + from.y
           + ' L ' + from.x   + ' ' + mid1Y
           + ' L ' + outsideX + ' ' + mid1Y
           + ' L ' + outsideX + ' ' + mid2Y
           + ' L ' + to.x     + ' ' + mid2Y
           + ' L ' + to.x     + ' ' + to.y;
    }
    var midY = to.y - C.ELBOW_GAP;
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
  var outputTypes = { output: true, efs_write: true, oracle_write: true };
  var outputNodes = S.nodes.filter(function(n){ return outputTypes[n.type]; });
  var stepNodes   = S.nodes.filter(function(n){ return n.type !== 'input' && !outputTypes[n.type]; });

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

  /* Compute topological depth for each step node so siblings at the same
     depth are laid out side-by-side instead of stacked vertically. */
  var inEdges = {};
  S.nodes.forEach(function(n) { inEdges[n.id] = []; });
  S.connections.forEach(function(c) {
    if (inEdges[c.to]) inEdges[c.to].push(c.from);
  });

  var depth = {};
  var orderedIds = DS.fn.topoSort();
  orderedIds.forEach(function(id) {
    var parents = inEdges[id] || [];
    depth[id] = parents.length === 0 ? 0
              : Math.max.apply(null, parents.map(function(p) { return (depth[p] || 0) + 1; }));
  });

  /* Group step nodes by depth */
  var depthGroups = {};
  stepNodes.forEach(function(n) {
    var d = depth[n.id] || 0;
    if (!depthGroups[d]) depthGroups[d] = [];
    depthGroups[d].push(n);
  });
  var depthKeys = Object.keys(depthGroups).sort(function(a, b) { return +a - +b; });

  /* Re-compute grid width to account for widest row */
  var widestRow = Math.max(inputNodes.length, outputNodes.length, 1);
  depthKeys.forEach(function(d) { widestRow = Math.max(widestRow, depthGroups[d].length); });
  gridW = widestRow * C.NODE_W + (widestRow - 1) * 40;
  pipelineCenterX = startX + gridW / 2;

  var currentY = startY;
  layoutRow(inputNodes, currentY);
  if (inputNodes.length > 0) currentY += rowGap;

  depthKeys.forEach(function(d) {
    layoutRow(depthGroups[d], currentY);
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
