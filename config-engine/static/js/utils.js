/**
 * Utilities: escapeHtml, format/transform icons, modal popups.
 * jQuery is loaded globally — uses $() for DOM access.
 */
(function (global) {
  global.CodeParser = global.CodeParser || {};
  var CP = global.CodeParser;

  CP.escapeHtml = function (str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  CP.tag = function (str, cls) {
    if (str == null || str === '') return '<span class="view-tag view-tag-empty">—</span>';
    var s = String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<span class="view-tag' + (cls ? ' ' + cls : '') + '">' + s + '</span>';
  };

  CP.getFormatSymbol = function (format) {
    if (!format) return '';
    var f = String(format).toLowerCase();
    if (f === 'parquet') return '\u25A3 ';
    if (f === 'csv' || f === 'delimited' || f === 'delim') return '\u25A4 ';
    if (f === 'fixed' || f === 'fixedwidth' || f === 'fixed-width') return '\u25A5 ';
    if (f === 'vsam' || f === 'cobol') return '\u25C6 ';
    return '\u25A2 ';
  };

  CP.getTransformIconClass = function (type) {
    if (!type) return 'fa-solid fa-diagram-project';
    var t = String(type).toLowerCase();
    if (t === 'filter') return 'fa-solid fa-filter';
    if (t === 'join') return 'fa-solid fa-link';
    if (t === 'aggregate') return 'fa-solid fa-chart-simple';
    if (t === 'select') return 'fa-solid fa-table-columns';
    if (t === 'union') return 'fa-solid fa-object-group';
    if (t === 'custom') return 'fa-solid fa-code';
    return 'fa-solid fa-diagram-project';
  };

  CP.getFormatIconClass = function (format) {
    if (!format) return 'fa-solid fa-file';
    var f = String(format).toLowerCase();
    if (f === 'parquet') return 'fa-solid fa-table-cells';
    if (f === 'csv' || f === 'delimited' || f === 'delim') return 'fa-solid fa-file-csv';
    if (f === 'fixed' || f === 'fixedwidth' || f === 'fixed-width') return 'fa-solid fa-file-lines';
    if (f === 'vsam' || f === 'cobol') return 'fa-solid fa-database';
    if (f === 'json') return 'fa-solid fa-file-code';
    return 'fa-solid fa-file';
  };

  CP.getExpressionOpIconClass = function (op) {
    if (!op) return 'fa-solid fa-circle-dot';
    var t = String(op).toLowerCase();
    if (t === 'move') return 'fa-solid fa-right-left';
    if (t === 'add') return 'fa-solid fa-plus';
    if (t === 'subtract') return 'fa-solid fa-minus';
    if (t === 'compute') return 'fa-solid fa-calculator';
    if (t === 'where') return 'fa-solid fa-filter';
    if (t === 'group by') return 'fa-solid fa-layer-group';
    if (t === 'sum') return 'fa-solid fa-plus';
    if (t === 'count') return 'fa-solid fa-hashtag';
    return 'fa-solid fa-circle-dot';
  };

  CP.showMessagePopup = function (title, message, type, useHtml) {
    var $msgModal = $('#message-modal');
    var $msgTitle = $('#message-modal-title');
    var $msgBody = $('#message-modal-body');
    var $msgHeader = $('#message-modal-header');
    type = type || 'success';
    var isError = (type === 'error');
    if ($msgTitle.length) {
      var icon = isError ? 'fa-circle-xmark' : 'fa-circle-check';
      $msgTitle.html('<i class="fa-solid ' + icon + '" style="margin-right:8px"></i>' +
                     (title || (isError ? 'Error' : 'Success')));
    }
    if ($msgBody.length) {
      if (useHtml && message != null && message !== '') $msgBody.html(message);
      else $msgBody.text(message != null ? String(message) : '');
    }
    if ($msgHeader.length) {
      $msgHeader.removeClass('modal-head-success modal-head-danger')
                .addClass(isError ? 'modal-head-danger' : 'modal-head-success');
    }
    $msgModal.removeClass('hidden');
  };

  CP.closeMessageModal = function () {
    $('#message-modal').addClass('hidden');
  };

  CP.showErrorPopup = function (title, message, details) {
    var $errModal = $('#error-modal');
    var $errTitle = $('#error-modal-title');
    var $errMsg = $('#error-modal-message');
    var $errDetails = $('#error-modal-details');
    $errTitle.html('<i class="fa-solid fa-circle-xmark" style="margin-right:8px"></i>' + (title || 'Error'));
    $errMsg.text(message || '');
    if (details != null && details !== '') {
      $errDetails.text(String(details)).show();
    } else {
      $errDetails.text('').hide();
    }
    $errModal.removeClass('hidden');
  };

  CP.closeErrorModal = function () {
    $('#error-modal').addClass('hidden');
  };
})(typeof window !== 'undefined' ? window : this);
