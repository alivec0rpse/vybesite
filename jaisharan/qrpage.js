(function () {
  "use strict";
  var URL_ = /^https?:$/.test(location.protocol) ? new URL("./", document.baseURI).href : "https://vybe.net.in/jaisharan/";
  var q = qrcode(0, "H"); q.addData(URL_); q.make();
  var n = q.getModuleCount(), vb = n + 8, out = [];
  var cw = Math.round(n * 0.3); if (cw % 2 === 0) cw++;
  var ch = Math.round(n * 0.17); if (ch % 2 === 0) ch++;
  var c = (n - 1) / 2, r0 = c - (ch - 1) / 2, r1 = c + (ch - 1) / 2, c0 = c - (cw - 1) / 2, c1 = c + (cw - 1) / 2;
  var fin = function (r, k) { return (r < 7 && k < 7) || (r < 7 && k >= n - 7) || (r >= n - 7 && k < 7); };
  out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ' + vb + ' ' + vb + '" shape-rendering="geometricPrecision">');
  out.push('<defs><rect id="m" x=".05" y=".05" width=".9" height=".9" rx=".3"/></defs><g fill="#1a0000">');
  [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (p) {
    out.push('<path d="M' + p[1] + ' ' + p[0] + 'h7v7h-7zM' + (p[1] + 1) + ' ' + (p[0] + 1) + 'v5h5v-5z" fill-rule="evenodd"/><rect x="' + (p[1] + 2) + '" y="' + (p[0] + 2) + '" width="3" height="3" fill="#720000"/>');
  });
  for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) {
    if (!q.isDark(r, k) || fin(r, k) || (r >= r0 && r <= r1 && k >= c0 && k <= c1)) continue;
    out.push('<use href="#m" x="' + k + '" y="' + r + '"/>');
  }
  out.push('</g>');
  var bx = c0 + 0.2, by = r0 + 0.2, bw = cw - 0.4, bh = ch - 0.4, iw = bw * 0.84, ih = iw * 36 / 77;
  out.push('<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" rx="1.4" fill="#fff" stroke="#e2e8f0" stroke-width=".18"/>');
  out.push('<image href="assets/vybe-mark.svg" x="' + (bx + (bw - iw) / 2) + '" y="' + (by + (bh - ih) / 2) + '" width="' + iw + '" height="' + ih + '"/>');
  out.push('</svg>');
  document.getElementById("qr").innerHTML = out.join("");
  function awake() { if ("wakeLock" in navigator && document.visibilityState === "visible") navigator.wakeLock.request("screen").catch(function () {}); }
  document.addEventListener("visibilitychange", awake); awake();
})();
