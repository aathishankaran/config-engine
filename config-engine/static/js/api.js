/**
 * API client for Parser Engine backend.
 */
(function (global) {
  global.CodeParser = global.CodeParser || {};

  global.CodeParser.API = {
    configs: () => $.ajax({
      url: '/api/configs',
      dataType: 'json'
    }),
    getConfig: (path) => $.ajax({
      url: '/api/config/' + encodeURIComponent(path),
      dataType: 'json'
    }),
    getConfigTestData: (path) => $.ajax({
      url: '/api/config/' + encodeURIComponent(path) + '/test-data',
      dataType: 'json'
    }),
    saveConfig: (path, data) => $.ajax({
      url: '/api/config/' + encodeURIComponent(path),
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(data),
      dataType: 'json'
    }),
    deleteConfig: (path) => $.ajax({
      url: '/api/config/' + encodeURIComponent(path),
      method: 'DELETE',
      dataType: 'json'
    }),
    renameConfig: (path, newName) => $.ajax({
      url: '/api/config/' + encodeURIComponent(path) + '/rename',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ name: newName }),
      dataType: 'json'
    }),
    search: (q) => $.ajax({
      url: '/api/search?q=' + encodeURIComponent(q),
      dataType: 'json'
    }),
    importZip: (formData) => $.ajax({
      url: '/api/import-zip',
      method: 'POST',
      data: formData,
      processData: false,
      contentType: false,
      dataType: 'json'
    }),
    getSettings: () => $.ajax({
      url: '/api/settings',
      dataType: 'json'
    }),
    saveSettings: (data) => $.ajax({
      url: '/api/settings',
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(data),
      dataType: 'json'
    }),
    generateTestSample: (body) => $.ajax({
      url: '/api/test/generate-sample',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(body),
      dataType: 'json'
    }),
    runDataflowTest: (body) => $.ajax({
      url: '/api/test/run',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(body),
      dataType: 'json'
    }),
    // Keep fetch() — uses response.body.getReader() for ReadableStream
    runDataflowTestStream: (body) => fetch('/api/test/run-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  };
})(typeof window !== 'undefined' ? window : this);
