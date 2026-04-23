(function () {
  const DEBUG_CHILLSHARP_ENV = {
    uiUrl: 'http://localhost:6202',
    //apiUrl: 'https://localhost:51147/api'
    apiUrl: 'https://cini-atlas.chillsharp.dev/api'
  };

  function readEnvValue(value, fallback) {
    return value && !/^\$\{[^}]+\}$/.test(value)
      ? value
      : fallback;
  }

  globalThis.CHILLSHARP_UI_URL = readEnvValue('${CHILLSHARP_UI_URL}', DEBUG_CHILLSHARP_ENV.uiUrl);
  globalThis.CHILLSHARP_API_URL = readEnvValue('${CHILLSHARP_API_URL}', DEBUG_CHILLSHARP_ENV.apiUrl);
}());
