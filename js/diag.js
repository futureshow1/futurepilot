// FuturePilot — rozpoznanie środowiska i test zgodności urządzenia.
// Nic nie wysyła samo: raport widzi użytkownik i sam decyduje, czy go przesłać.
// Funkcje przyjmują opcjonalny `ua`, żeby dało się je testować w Node bez przeglądarki.

const UA = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';

export function browserInfo(ua = UA()) {
  const m = (re) => (ua.match(re) || [])[1] || '';
  let name = 'przeglądarka',
    ver = '';
  if (/MiuiBrowser/i.test(ua)) {
    name = 'Mi Browser';
    ver = m(/MiuiBrowser\/([\d.]+)/i);
  } else if (/SamsungBrowser/.test(ua)) {
    name = 'Samsung Internet';
    ver = m(/SamsungBrowser\/([\d.]+)/);
  } else if (/EdgA\/|EdgiOS\/|Edg\//.test(ua)) {
    name = 'Edge';
    ver = m(/Edg(?:A|iOS)?\/([\d.]+)/);
  } else if (/OPR\/|OPiOS\//.test(ua)) {
    name = 'Opera';
    ver = m(/OP(?:R|iOS)\/([\d.]+)/);
  } else if (/Firefox\/|FxiOS\//.test(ua)) {
    name = 'Firefox';
    ver = m(/(?:Firefox|FxiOS)\/([\d.]+)/);
  } else if (/CriOS\//.test(ua)) {
    name = 'Chrome (iOS)';
    ver = m(/CriOS\/([\d.]+)/);
  } else if (/Chrome\//.test(ua)) {
    name = /; wv\)/.test(ua) ? 'WebView (Chrome)' : 'Chrome';
    ver = m(/Chrome\/([\d.]+)/);
  } else if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    name = 'Safari';
    ver = m(/Version\/([\d.]+)/);
  } else if (/AppleWebKit/.test(ua)) {
    name = 'WebKit (aplikacja)';
  }
  let os = 'inny system';
  if (/Android/.test(ua)) os = `Android ${m(/Android ([\d.]+)/)}`.trim();
  else if (/iPhone|iPad|iPod/.test(ua)) os = `iOS ${m(/OS (\d+[_\d]*)/).replace(/_/g, '.')}`.trim();
  else if (/Macintosh/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  const major = parseInt(ver, 10) || 0;
  return { name, ver, major, os, ua };
}

// Przeglądarka wbudowana w aplikację (komunikator, portal społecznościowy): często bez pełnego ekranu
// i bez obracania ekranu — dokładnie to, co blokowało testerom lot w poziomie.
export function inAppBrowser(ua = UA()) {
  if (/FB_IAB|FBAN|FBAV|Orca-Android|MessengerForiOS|MessengerLite/i.test(ua)) return 'Facebook lub Messenger';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Line\//i.test(ua)) return 'LINE';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return 'TikTok';
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn';
  if (/Twitter|X_App/i.test(ua)) return 'X (Twitter)';
  if (/GSA\//.test(ua)) return 'aplikacja Google';
  if (/; wv\)/.test(ua)) return 'aplikacja (WebView Android)';
  if (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'aplikacja (WebView iOS)';
  return '';
}

export function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  } catch (e) {
    return false;
  }
}

// adres „otwórz w Chrome" dla Androida (intent://); z przeglądarek wbudowanych zwykle działa
export function chromeIntentUrl(href = typeof location !== 'undefined' ? location.href : '') {
  const u = href.replace(/^https?:\/\//, '').split('#')[0];
  return `intent://${u}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href.split('#')[0])};end`;
}

// dane wysokiej entropii (model telefonu, wersja systemu) — tylko Chromium; wynik trafia do raportu, który widzi użytkownik
let extra = null;
export async function loadHighEntropy() {
  if (extra) return extra;
  extra = {};
  try {
    const d = navigator.userAgentData;
    if (d && d.getHighEntropyValues) {
      const v = await d.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList']);
      extra = { model: v.model || '', platformVersion: v.platformVersion || '', platform: d.platform || '' };
    }
  } catch (e) {}
  return extra;
}
export const highEntropy = () => extra || {};

function webglInfo(renderer) {
  try {
    const gl = renderer ? renderer.getContext() : document.createElement('canvas').getContext('webgl');
    if (!gl) return { ok: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return { ok: true, renderer: String(r || '').slice(0, 90), webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext };
  } catch (e) {
    return { ok: false, renderer: '' };
  }
}

// migawka środowiska — synchroniczna, tania; `renderer` = renderer three.js (opcjonalnie)
export function envSnapshot({ renderer = null, coarse = false, fps = null } = {}) {
  const b = browserInfo();
  const he = highEntropy();
  let storage = true;
  try {
    localStorage.setItem('futurepilot.__t', '1');
    localStorage.removeItem('futurepilot.__t');
  } catch (e) {
    storage = false;
  }
  const gl = webglInfo(renderer);
  return {
    version: '',
    browser: `${b.name} ${b.ver}`.trim(),
    browserMajor: b.major,
    os: he.platformVersion && /Android/.test(b.os) ? `Android ${he.platformVersion.split('.')[0]}` : b.os,
    model: he.model || '',
    inApp: inAppBrowser(),
    standalone: isStandalone(),
    coarse,
    touchPoints: (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0,
    screen: `${window.innerWidth}×${window.innerHeight}`,
    portrait: window.innerHeight > window.innerWidth,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    pointerEvents: 'PointerEvent' in window,
    fullscreen: !!(document.fullscreenEnabled || document.webkitFullscreenEnabled),
    orientationLock: !!(screen.orientation && screen.orientation.lock),
    vibrate: 'vibrate' in navigator,
    wakeLock: 'wakeLock' in navigator,
    gamepad: 'getGamepads' in navigator,
    serviceWorker: 'serviceWorker' in navigator,
    storage,
    webgl: gl.ok,
    webgl2: !!gl.webgl2,
    gpu: gl.renderer,
    memory: navigator.deviceMemory || null,
    cores: navigator.hardwareConcurrency || null,
    reducedMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    fps,
    ua: b.ua,
  };
}

const yn = (v) => (v ? 'tak' : 'nie');

export function formatReport(e, { version = '' } = {}) {
  const lines = [
    `FuturePilot ${version} — test zgodności`,
    `Przeglądarka: ${e.browser}${e.inApp ? ` (wewnątrz: ${e.inApp})` : ''}${e.standalone ? ' (zainstalowana na ekranie głównym)' : ''}`,
    `System: ${e.os}${e.model ? ` · model ${e.model}` : ''}`,
    `Ekran: ${e.screen} (${e.portrait ? 'pion' : 'poziom'}), gęstość ${e.dpr}, punkty dotyku: ${e.touchPoints}, dotyk: ${yn(e.coarse)}`,
    `Grafika 3D (WebGL): ${yn(e.webgl)}${e.webgl2 ? ' (WebGL 2)' : ''}${e.gpu ? ` · ${e.gpu}` : ''}`,
    `Płynność: ${e.fps === null ? 'nie zmierzono' : e.fps.unreliable ? 'nie udało się zmierzyć (strona w tle)' : `${e.fps.fps} kl./s, długie klatki: ${e.fps.long}`}`,
    `Pełny ekran: ${yn(e.fullscreen)} · blokada orientacji: ${yn(e.orientationLock)} · wibracje: ${yn(e.vibrate)} · Wake Lock: ${yn(e.wakeLock)}`,
    `Zdarzenia wskaźnika: ${yn(e.pointerEvents)} · gamepad: ${yn(e.gamepad)} · offline (service worker): ${yn(e.serviceWorker)} · pamięć lokalna: ${yn(e.storage)}`,
    `Pamięć RAM: ${e.memory ? e.memory + ' GB' : '—'} · rdzenie: ${e.cores || '—'} · ograniczony ruch: ${yn(e.reducedMotion)}`,
    `UA: ${e.ua}`,
  ];
  return lines.join('\n');
}

// ocena po polsku: lista ostrzeżeń z radą; pusta lista = wszystko w porządku
export function verdicts(e) {
  const out = [];
  if (e.inApp) out.push({ level: 'warn', text: `Gra działa wewnątrz aplikacji (${e.inApp}). Taka przeglądarka często nie ma pełnego ekranu i nie obraca ekranu. Otwórz grę w Chrome albo Safari.` });
  if (!e.webgl) out.push({ level: 'bad', text: 'Przeglądarka nie udostępnia grafiki 3D (WebGL). Gra nie wyświetli obrazu — spróbuj innej przeglądarki.' });
  if (!e.pointerEvents) out.push({ level: 'bad', text: 'Bardzo stara przeglądarka (brak zdarzeń wskaźnika). Zaktualizuj ją.' });
  if (e.coarse && e.touchPoints < 2) out.push({ level: 'bad', text: 'Ekran zgłasza tylko jeden punkt dotyku — dwa drążki naraz nie zadziałają.' });
  if (!e.storage) out.push({ level: 'warn', text: 'Brak dostępu do pamięci lokalnej (tryb prywatny?). Postępy nie zapiszą się.' });
  if (e.fps && !e.fps.unreliable && e.fps.fps < 40) out.push({ level: 'warn', text: `Płynność ${e.fps.fps} kl./s. W Ustawieniach obniż jakość grafiki.` });
  if (e.coarse && !e.fullscreen && !e.standalone) out.push({ level: 'info', text: 'Brak trybu pełnoekranowego. Gra działa, ale z paskiem przeglądarki; na iPhonie dodaj ją do ekranu głównego.' });
  if (e.coarse && e.portrait) out.push({ level: 'info', text: 'Telefon w pionie. Gra działa, ale w poziomie jest wygodniej. Jeśli obraz się nie obraca, włącz autoobracanie ekranu.' });
  if (/Chrome/.test(e.browser) && e.browserMajor && e.browserMajor < 90) out.push({ level: 'warn', text: `Stara wersja Chrome (${e.browserMajor}). Zaktualizuj przeglądarkę.` });
  return out;
}
