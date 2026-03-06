/**
 * ds-state.js — All mutable state for Dataflow Studio.
 * Depends: ds-namespace.js
 */
(function(DS) {
"use strict";

DS.S = {
  /* Graph data */
  nodes: [],
  connections: [],

  /* Selection */
  selectedNodeId: null,
  selectedConnId: null,

  /* Currently open props panel node */
  _currentPropsNode: null,

  /* Interaction mode */
  mode: 'select',

  /* Viewport */
  zoom: 1,
  panX: 0,
  panY: 0,

  /* ID counters */
  _nodeCounter: 1,
  _connCounter: 1,
  _typeCounters: {},
  _inputCounter: 0,
  _inputSeq: 0,
  _outputSeq: 0,
  _validateSeq: 0,

  /* Drag state */
  dragging: null,

  /* Connect state */
  connectFrom: null,
  tempConnMouse: null,

  /* Pan state */
  panning: null,

  /* Per-config node file metadata cache */
  _nodeFileMeta: {},

  /* Global app settings loaded from /api/settings on init */
  _appSettings: {},

  /* Layout orientation */
  layoutMode: 'vertical',

  /* Property panel dirty tracking */
  _propsDirty: false
};

})(window.DS);
