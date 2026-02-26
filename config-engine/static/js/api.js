/**
 * API client for Parser Engine backend.
 */
(function (global) {
  global.CodeParser = global.CodeParser || {};

  function parseJsonResponse(response) {
    return response.text().then(function (text) {
      var ct = (response.headers.get('Content-Type') || '').toLowerCase();
      var looksLikeJson = (ct.indexOf('application/json') !== -1) || (/^\s*\{/.test(text));
      if (!looksLikeJson) {
        if (/^\s*</.test(text) || /<!doctype/i.test(text)) {
          return Promise.reject(new Error(
            'Server returned an error page instead of JSON. The request may have timed out (e.g. LLM taking too long) or the server encountered an error. ' +
            'Check server logs. If using LLM, try increasing "LLM request timeout" in Settings and ensure the LLM server (e.g. Ollama) is running.'
          ));
        }
        return Promise.reject(new Error('Server returned unexpected response: ' + (text.slice(0, 80) || response.status)));
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        return Promise.reject(new Error('Invalid JSON from server: ' + (e.message || String(e))));
      }
    });
  }

  global.CodeParser.API = {
    configs: () => fetch('/api/configs').then(r => r.json()),
    getConfig: (path) => fetch('/api/config/' + encodeURIComponent(path)).then(r => r.json()),
    getConfigTestData: (path) => fetch('/api/config/' + encodeURIComponent(path) + '/test-data').then(r => r.json()),
    saveConfig: (path, data) => fetch('/api/config/' + encodeURIComponent(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
    deleteConfig: (path) => fetch('/api/config/' + encodeURIComponent(path), { method: 'DELETE' }).then(r => r.json()),
    renameConfig: (path, newName) => fetch('/api/config/' + encodeURIComponent(path) + '/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    }).then(r => r.json()),
    search: (q) => fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json()),
    importZip: (formData) => fetch('/api/import-zip', { method: 'POST', body: formData }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (text) {
          var err;
          try {
            var data = JSON.parse(text);
            err = new Error(data.error || data.message || 'Import failed');
          } catch (_) {
            if (/^\s*</.test(text) || /<!doctype/i.test(text)) {
              err = new Error(
                'Server returned an error page (status ' + r.status + '). The request may have timed out or the server encountered an error. ' +
                'If using LLM, increase "LLM request timeout" in Settings and ensure the LLM server is running. Check server logs for details.'
              );
            } else {
              err = new Error('Import failed: ' + (r.statusText || r.status) + (text ? ' — ' + text.slice(0, 120) : ''));
            }
          }
          return Promise.reject(err);
        });
      }
      return parseJsonResponse(r);
    }),
    getSettings: () => fetch('/api/settings').then(r => r.json()),
    saveSettings: (data) => fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
    generateTestSample: (body) => fetch('/api/test/generate-sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json()),
    runDataflowTest: (body) => fetch('/api/test/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json()),
    runDataflowTestStream: (body) => fetch('/api/test/run-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  };
})(typeof window !== 'undefined' ? window : this);
