(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var body = document.body, root = document.documentElement;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isAndroid = /Android/i.test(navigator.userAgent);
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var buzz = function (ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 9); } catch (e) {} };
  var OUT = "cubic-bezier(.16,1,.3,1)", IN = "cubic-bezier(.55,0,.75,.2)";
  body.classList.remove("boot");

  /* ---------------- identity (assembled here, not written in the HTML) ---------------- */
  var P = ["+91", "99641", "77877"], E = ["harsha", "vybe.net.in"]; var RE = ["coo", "vybe.net.in"];   // role mailbox, shown above the personal one
  var PHONE = P.join(""), PHONE_SHOW = P.join(" "), PHONE_WA = PHONE.slice(1), EMAIL = E.join("@"), ROLE_EMAIL = RE.join("@");
  var CARD_URL = /^https?:$/.test(location.protocol) ? new URL("./", document.baseURI).href : "https://vybe.net.in/harsha/";
  $("#aCall").href = "tel:" + PHONE;
  $("#aWa").href = "https://wa.me/" + PHONE_WA + "?text=" + encodeURIComponent("Dear Mr. Harsha, I received your digital visiting card and would like to connect with you regarding Vybe Technologies.");
  $("#aRole").href = "mailto:" + ROLE_EMAIL + "?subject=" + encodeURIComponent("Enquiry regarding Vybe Technologies");
  $("#aMail").href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Enquiry regarding Vybe Technologies");
  $("#vPhone").textContent = PHONE_SHOW;
  $("#vRole").textContent = ROLE_EMAIL;
  $("#vMail").textContent = EMAIL;

  var tT;
  function toast(msg, ms) { var t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tT); tT = setTimeout(function () { t.classList.remove("show"); }, ms || 3200); }

  /* ---------------- press feedback: rows fill with an angled maroon wipe, buttons ripple ---------------- */
  document.addEventListener("pointerdown", function (e) {
    if (!e.target.closest) return;
    var row = e.target.closest(".row");
    if (row) { row.classList.add("hit"); buzz(); setTimeout(function () { row.classList.remove("hit"); }, 520); return; }
    if (e.target.closest(".tile, .share-ic, .share-line")) { buzz(); return; }
    var b = e.target.closest(".btn, .opt");
    if (!b) return;
    var r = b.getBoundingClientRect();
    b.style.setProperty("--rx", (e.clientX - r.left) + "px"); b.style.setProperty("--ry", (e.clientY - r.top) + "px");
    b.classList.remove("rip"); void b.offsetWidth; b.classList.add("rip"); buzz();
  }, { passive: true });
  document.addEventListener("animationend", function (e) { if (e.animationName === "rip") e.target.classList.remove("rip"); }, true);

  /* ---------------- intro: logo fills, slab sweeps in, name slides, ribbon arrives ---------------- */
  var lockWrap = $("#lockWrap"), slab = $("#slab"), nameEl = $("#name"), ribbon = $("#ribbon"), dock = $("#dock");
  var timers = [], introDone = false, revealing = false;
  var at = function (ms, fn) { timers.push(setTimeout(fn, ms)); };
  var on = function (el) { if (el) el.classList.add("on"); };
  var io = null;
  function startReveals() {
    if (revealing) return; revealing = true;
    $$(".sec, .foot").forEach(function (sec) { $$(".wipe", sec).forEach(function (el, i) { el.style.setProperty("--i", Math.min(i, 6)); }); });
    if ("IntersectionObserver" in window && !reduce) {
      io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }); }, { threshold: 0, rootMargin: "0px 0px -6% 0px" });
      $$(".wipe").forEach(function (el) { io.observe(el); });
    } else $$(".wipe").forEach(function (el) { el.classList.add("in"); });
  }
  function settle() { introDone = true; body.classList.remove("lock"); ribbon.classList.add("run"); }
  function runIntro() {
    body.classList.add("lock");
    at(120, function () { lockWrap.classList.add("lit"); });
    at(300, function () { on(slab); });
    at(700, function () { on(nameEl); });
    at(900, function () { lockWrap.classList.add("brand-on"); });
    at(1000, function () { on($(".role")); });
    at(1120, function () { on($(".org")); on($("#shareTop")); });
    at(1250, function () { on(ribbon); slab.classList.add("shine"); });
    at(1500, function () { startReveals(); on(dock); settle(); });
  }
  function skipIntro() {
    if (introDone) return;
    timers.forEach(clearTimeout); timers = [];
    lockWrap.classList.add("lit", "brand-on"); on(slab); on(nameEl); on($(".role")); on($(".org")); on($("#shareTop")); on(ribbon); on(dock);
    startReveals(); settle();
  }
  document.addEventListener("pointerdown", function (e) { if (!introDone && body.classList.contains("lock")) { e.preventDefault(); skipIntro(); } }, { capture: true });
  document.addEventListener("keydown", function () { if (!introDone) skipIntro(); });

  /* ---------------- scroll: the name drifts, the ribbon levels out ---------------- */
  var slabIn = $("#slabIn"), ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY || 0;
    slabIn.style.transform = "translate3d(0," + (y * 0.18).toFixed(1) + "px,0)";
    ribbon.style.setProperty("--rr", (-3.2 + clamp(y / 320, 0, 1) * 2.4).toFixed(2) + "deg");
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { if (introDone || reduce) ribbon.classList.toggle("run", en[0].isIntersecting && !reduce); }).observe(ribbon);

  var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fonts, new Promise(function (r) { setTimeout(r, 1200); })]).then(function () {
    if (reduce) { skipIntro(); return; }
    requestAnimationFrame(runIntro);
  });

  /* ---------------- save to Photos: logo, name, tagline and a QR that reopens this card ---------------- */
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var photoBtn = $("#photoBtn"), cardFile = null, drawing = null;
  var PERSON = $("#name").textContent.replace(/\s+/g, " ").trim();
  function loadImg(src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; }); }
  function spaced(g, text, cx, y, track) {           // letter-spaced text drawn by hand (works in every Safari)
    var w = 0, i, widths = [];
    for (i = 0; i < text.length; i++) { widths.push(g.measureText(text[i]).width); w += widths[i] + (i < text.length - 1 ? track : 0); }
    var x = cx - w / 2; g.textAlign = "left";
    for (i = 0; i < text.length; i++) { g.fillText(text[i], x, y); x += widths[i] + track; }
    g.textAlign = "center"; return w;
  }
  function drawCard() {
    if (drawing) return drawing;
    var W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
    var g = c.getContext("2d");
    var fontsReady = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('800 120px "Jakarta"'), document.fonts.load('800 30px "Jakarta"')]).catch(function () {}) : Promise.resolve();
    drawing = Promise.all([fontsReady, loadImg("assets/vybe-lockup.png")]).then(function (r) {
      var logo = r[1], cx = W / 2;
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
      // the real Vybe lockup, on white as it belongs
      var lw = 780, lh = lw * logo.height / logo.width; g.drawImage(logo, cx - lw / 2, 250, lw, lh);
      // the angled maroon band carrying the name
      g.save(); g.beginPath(); g.moveTo(0, 540); g.lineTo(W, 470); g.lineTo(W, 950); g.lineTo(0, 1020); g.closePath(); g.clip();
      var lg = g.createLinearGradient(0, 470, W, 1020); lg.addColorStop(0, "#8f0d0d"); lg.addColorStop(0.45, "#720000"); lg.addColorStop(1, "#4a0000");
      g.fillStyle = lg; g.fillRect(0, 440, W, 620);
      var rg = g.createRadialGradient(W, 470, 20, W, 470, 700); rg.addColorStop(0, "rgba(227,24,55,0.55)"); rg.addColorStop(1, "rgba(227,24,55,0)");
      g.fillStyle = rg; g.fillRect(0, 440, W, 620);
      g.strokeStyle = "rgba(255,255,255,0.04)"; g.lineWidth = 2;
      for (var x = -700; x < W + 700; x += 11) { g.beginPath(); g.moveTo(x, 1060); g.lineTo(x + 380, 440); g.stroke(); }
      g.restore();
      g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "alphabetic";
      var fs = 132; g.font = '800 ' + fs + 'px "Jakarta", sans-serif';
      while (g.measureText(PERSON).width > 920 && fs > 60) { fs -= 4; g.font = '800 ' + fs + 'px "Jakarta", sans-serif'; }
      g.fillText(PERSON, cx, 790);
      // the tagline ribbon, angled like on the card
      g.save(); g.translate(cx, 1008); g.rotate(-3.2 * Math.PI / 180);
      var rb = g.createLinearGradient(-700, 0, 700, 0); rb.addColorStop(0, "#720000"); rb.addColorStop(0.55, "#e31837"); rb.addColorStop(1, "#720000");
      g.fillStyle = rb; g.fillRect(-720, -46, 1440, 92);
      g.fillStyle = "#ffffff"; g.font = '800 30px "Jakarta", sans-serif';
      var words = ["SMART.", "SIMPLE.", "AFFORDABLE."], gap = 64, tw = [], total = 0;
      words.forEach(function (w) { var m = 0; for (var i = 0; i < w.length; i++) m += g.measureText(w[i]).width + (i < w.length - 1 ? 7 : 0); tw.push(m); total += m; });
      total += gap * (words.length - 1);
      var xx = -total / 2;
      words.forEach(function (w, i) {
        spaced(g, w, xx + tw[i] / 2, 11, 7); xx += tw[i];
        if (i < words.length - 1) { g.save(); g.translate(xx + gap / 2, 0); g.rotate(Math.PI / 4); g.fillStyle = "rgba(255,255,255,0.75)"; g.fillRect(-6, -6, 12, 12); g.restore(); xx += gap; }
      });
      g.restore();
      // QR that reopens the live card
      var q = qrcode(0, "M"); q.addData(CARD_URL); q.make();
      var n = q.getModuleCount(), tile = 520, pad = 40, ms = (tile - pad * 2) / n, tx = cx - tile / 2, ty = 1230;
      g.save(); g.shadowColor = "rgba(114,0,0,0.22)"; g.shadowBlur = 50; g.shadowOffsetY = 18; g.fillStyle = "#ffffff"; roundRect(g, tx, ty, tile, tile, 30); g.fill(); g.restore();
      g.strokeStyle = "#e2e8f0"; g.lineWidth = 2; roundRect(g, tx, ty, tile, tile, 30); g.stroke();
      g.fillStyle = "#0f172a";
      for (var rr = 0; rr < n; rr++) for (var cc = 0; cc < n; cc++) if (q.isDark(rr, cc)) g.fillRect(tx + pad + cc * ms, ty + pad + rr * ms, ms + 0.6, ms + 0.6);
      return new Promise(function (res) { c.toBlob(function (b) { res(b); }, "image/png"); });
    }).then(function (blob) {
      cardFile = new File([blob], PERSON.replace(/\s+/g, "-") + "-Vybe-Technologies.png", { type: "image/png" });
      return cardFile;
    });
    drawing.catch(function () { drawing = null; });
    return drawing;
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function doneSaving() { photoBtn.classList.add("ok"); setTimeout(function () { photoBtn.classList.remove("ok"); }, 2600); }
  function download(file) {
    var url = URL.createObjectURL(file), a = document.createElement("a");
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    doneSaving(); toast(isAndroid ? "Saved to your phone. Find it in Gallery under Downloads." : "Card image downloaded.", 4200);
  }
  photoBtn.addEventListener("click", function () {
    // iPhone: the share sheet has "Save Image", which puts it straight into Photos
    if (isIOS && cardFile && navigator.canShare && navigator.canShare({ files: [cardFile] })) {
      navigator.share({ files: [cardFile], title: PERSON + ", Vybe Technologies" }).then(doneSaving).catch(function () {});
      return;
    }
    if (cardFile) { download(cardFile); return; }
    drawCard().then(function (f) {
      if (isIOS && navigator.canShare && navigator.canShare({ files: [f] })) toast("Card ready. Tap Save to Photos again, then choose Save Image.", 4200);
      else download(f);
    }).catch(function () { toast("Could not prepare the image. Please try again."); });
  });
  // prepared in the background so the first tap is instant (iPhone needs it ready inside the tap)
  window.addEventListener("load", function () { setTimeout(function () { drawCard().catch(function () {}); }, 2500); });
  try {
    if (!localStorage.getItem("vybe-hint")) {
      setTimeout(function () { if (!document.hidden) { toast("Tip: tap Save to Photos to keep this card in your gallery.", 4800); try { localStorage.setItem("vybe-hint", "1"); } catch (e) {} } }, 6500);
    }
  } catch (e) {}

  /* ---------------- share ---------------- */
  function share() {
    var data = { title: "Harsha R | Vybe Technologies", text: "Digital visiting card of Harsha R, Chief Operational Officer, Vybe Technologies.", url: CARD_URL };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    var done = function (ok) { toast(ok ? "Link copied to clipboard." : CARD_URL); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(CARD_URL).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }
  $("#shareBtn").addEventListener("click", share);
  $("#shareTop").addEventListener("click", share);

  /* ---------------- meeting request sheet (grows out of the button) ---------------- */
  var app = $("#app"), sheet = $("#sheet"), inner = $("#shInner"), scrim = $("#scrim"), dock = $("#dock"), bookBtn = $("#bookBtn");
  var isOpen = false, lastFocus = null, anim = null, innerAnim = null, pendingSlide = false;
  function insetFor(sr, br, rad) { return "inset(" + Math.max(0, br.top - sr.top) + "px " + Math.max(0, sr.right - br.right) + "px " + Math.max(0, sr.bottom - br.bottom) + "px " + Math.max(0, br.left - sr.left) + "px round " + rad + "px)"; }
  function stopAnims() { if (anim) { anim.cancel(); anim = null; } if (innerAnim) { innerAnim.cancel(); innerAnim = null; } }
  function openSheet() {
    if (isOpen) return; isOpen = true;
    if ($("#done").classList.contains("on")) resetBooking();
    lastFocus = document.activeElement;
    var br = bookBtn.getBoundingClientRect();
    try { history.pushState({ sheet: 1 }, ""); } catch (e) {}
    app.style.setProperty("--oy", ((window.scrollY || 0) + window.innerHeight / 2) + "px");
    stopAnims(); sheet.style.transform = "";
    body.classList.add("sheet-open"); scrim.classList.add("on"); sheet.classList.add("on"); root.style.overflow = "hidden";
    var sr = sheet.getBoundingClientRect();
    if (!reduce && sheet.animate) {
      anim = sheet.animate([{ clipPath: insetFor(sr, br, 18) }, { clipPath: "inset(0px 0px 0px 0px round 30px)" }], { duration: 680, easing: OUT });
      innerAnim = inner.animate([{ opacity: 0, transform: "translateY(22px)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: 170, easing: OUT, fill: "backwards" });
    }
    setTimeout(function () { $("#closeBtn").focus({ preventScroll: true }); }, 200);
  }
  function finishClose() { sheet.classList.remove("on"); sheet.style.transform = ""; stopAnims(); if ($("#done").classList.contains("on")) resetBooking(); }
  function requestClose(slide) { if (!isOpen) return; pendingSlide = !!slide; if (history.state && history.state.sheet) history.back(); else closeSheet(); }
  function closeSheet() {
    if (!isOpen) return; isOpen = false;
    var slide = pendingSlide; pendingSlide = false;
    var sr = sheet.getBoundingClientRect();
    body.classList.remove("sheet-open"); scrim.classList.remove("on"); root.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    if (reduce || !sheet.animate) { finishClose(); return; }
    var from = sheet.style.transform || "translateY(0px)"; stopAnims();
    if (slide) { sheet.style.transform = ""; anim = sheet.animate([{ transform: from }, { transform: "translateY(105%)" }], { duration: 320, easing: IN, fill: "forwards" }); }
    else {
      var br = bookBtn.getBoundingClientRect(), ty = 0;
      try { ty = new DOMMatrixReadOnly(getComputedStyle(dock).transform).m42; } catch (e) {}
      br = { top: br.top - ty, bottom: br.bottom - ty, left: br.left, right: br.right };
      anim = sheet.animate([{ clipPath: "inset(0px 0px 0px 0px round 30px)", opacity: 1 }, { clipPath: insetFor(sr, br, 18), opacity: 0.5 }], { duration: 440, easing: IN, fill: "forwards" });
      innerAnim = inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170, fill: "forwards" });
    }
    anim.onfinish = finishClose;
  }
  window.addEventListener("popstate", function () { if (isOpen) closeSheet(); });
  bookBtn.addEventListener("click", openSheet);
  $("#closeBtn").addEventListener("click", function () { requestClose(); });
  scrim.addEventListener("click", function () { requestClose(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen) requestClose(); });
  (function dragToClose() {
    var head = $("#shHead"), y0 = null, dy = 0, t0 = 0;
    head.addEventListener("pointerdown", function (e) { if (e.target.closest("button") || window.innerWidth >= 720) return; y0 = e.clientY; dy = 0; t0 = performance.now(); sheet.classList.add("drag"); head.setPointerCapture(e.pointerId); });
    head.addEventListener("pointermove", function (e) { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = "translateY(" + dy + "px)"; });
    function end() { if (y0 === null) return; sheet.classList.remove("drag"); var v = dy / Math.max(1, performance.now() - t0); y0 = null; if (dy > 110 || v > 0.6) requestClose(true); else sheet.style.transform = ""; }
    head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
  })();

  var S = { step: 1, topic: null, phrase: null, mode: "Google Meet", date: null, hour: null, inst: null };
  var TITLES = ["Purpose of the meeting", "Preferred date and time", "Your details"];
  var WDS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var WDL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var HOURS = [10, 11, 12, 14, 15, 16, 17, 18];
  var fmtH = function (h) { return (h % 12 || 12) + ":00 " + (h < 12 ? "AM" : "PM"); };
  var istNow = function () { var d = new Date(); return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000); };
  function go(step, rev) {
    S.step = step;
    $$(".step").forEach(function (el) { var o = +el.getAttribute("data-step") === step; el.classList.toggle("on", o); el.classList.toggle("rev", o && !!rev); });
    $$("#bar i").forEach(function (b, i) { b.classList.toggle("fill", i < step); });
    $("#shTitle").textContent = TITLES[step - 1]; $("#shSub").textContent = "Step " + step + " of 3";
    $("#backBtn").classList.toggle("ghost", step === 1);
    $("#shFoot").style.display = step === 3 ? "" : "none";
    if (step === 2) { buildDays(); buildTimes(); }
    if (step === 3) { buildSummary(); refreshLinks(); }
    $("#shBody").scrollTop = 0;
  }
  $("#backBtn").addEventListener("click", function () { if (S.step > 1) go(S.step - 1, true); });
  function pickIn(sel, btn) { $$(sel + " [role=radio]").forEach(function (x) { x.setAttribute("aria-checked", String(x === btn)); }); }
  $$("#topics .opt").forEach(function (b) { b.addEventListener("click", function () { pickIn("#topics", b); S.topic = b.getAttribute("data-v"); S.phrase = b.getAttribute("data-p"); setTimeout(function () { go(2); }, reduce ? 0 : 260); }); });
  $$("#modes button").forEach(function (b, i) { b.addEventListener("click", function () { buzz(); pickIn("#modes", b); S.mode = b.getAttribute("data-v"); $("#thumb").style.transform = "translateX(" + i * 100 + "%)"; }); });
  $$("#insts .pill").forEach(function (b) { b.addEventListener("click", function () { buzz(); if (b.getAttribute("aria-checked") === "true") { b.setAttribute("aria-checked", "false"); S.inst = null; } else { pickIn("#insts", b); S.inst = b.getAttribute("data-v"); } refreshLinks(); }); });
  function buildDays() {
    var wrap = $("#days"); wrap.innerHTML = "";
    var now = istNow(), cut = now.getHours() + (now.getMinutes() > 0 ? 1 : 0);
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate()), count = 0, i = 0;
    while (count < 14 && i < 30) {
      var today = i === 0; i++;
      var open = !today || HOURS.some(function (h) { return h > cut; });
      if (d.getDay() !== 0 && open) {
        (function (dd, isToday) {
          var key = dd.getFullYear() + "-" + dd.getMonth() + "-" + dd.getDate(), b = document.createElement("button");
          b.type = "button"; b.className = "day"; b.setAttribute("role", "radio");
          b.setAttribute("aria-checked", String(!!(S.date && S.date.key === key)));
          b.setAttribute("aria-label", WDL[dd.getDay()] + ", " + dd.getDate() + " " + MO[dd.getMonth()]);
          var w = document.createElement("span"); w.className = "dw"; w.textContent = isToday ? "Today" : WDS[dd.getDay()];
          var n = document.createElement("span"); n.className = "dn"; n.textContent = dd.getDate();
          b.appendChild(w); b.appendChild(n);
          b.addEventListener("click", function () { buzz(); pickIn("#days", b); S.date = { key: key, y: dd.getFullYear(), m: dd.getMonth(), d: dd.getDate(), wd: dd.getDay(), today: isToday }; S.hour = null; $("#monLbl").textContent = MO[dd.getMonth()] + " " + dd.getFullYear(); buildTimes(); });
          wrap.appendChild(b);
        })(new Date(d), today);
        count++;
      }
      d.setDate(d.getDate() + 1);
    }
    $("#monLbl").textContent = S.date ? MO[S.date.m] + " " + S.date.y : MO[now.getMonth()] + " " + now.getFullYear();
  }
  function buildTimes() {
    var wrap = $("#times"); wrap.innerHTML = "";
    $("#timesNote").style.display = S.date ? "none" : "";
    if (!S.date) return;
    var now = istNow(), cut = now.getHours() + (now.getMinutes() > 0 ? 1 : 0);
    HOURS.forEach(function (h) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "time"; b.setAttribute("role", "radio"); b.textContent = fmtH(h);
      b.setAttribute("aria-checked", String(S.hour === h));
      if (S.date.today && h <= cut) b.disabled = true;
      b.addEventListener("click", function () { buzz(); pickIn("#times", b); S.hour = h; setTimeout(function () { go(3); }, reduce ? 0 : 280); });
      wrap.appendChild(b);
    });
  }
  var longDate = function () { return WDL[S.date.wd] + ", " + S.date.d + " " + MO[S.date.m] + " " + S.date.y; };
  function buildSummary() {
    var box = $("#sum"); box.innerHTML = "";
    [["Purpose", S.topic], ["Date", longDate()], ["Time", fmtH(S.hour) + " IST"], ["Mode", S.mode]].forEach(function (r) {
      var row = document.createElement("div"), a = document.createElement("span"), b = document.createElement("span");
      a.textContent = r[0]; b.textContent = r[1]; row.appendChild(a); row.appendChild(b); box.appendChild(row);
    });
  }
  var val = function (id) { return $(id).value.trim(); };
  function message() {
    var name = val("#iName"), L = [];
    L.push("Dear Mr. Harsha,", "");
    L.push("I would like to request a meeting with you regarding " + S.phrase + ".", "");
    L.push("Preferred date: " + longDate());
    L.push("Preferred time: " + fmtH(S.hour) + " (IST)");
    L.push("Mode of meeting: " + S.mode, "");
    L.push("Name: " + name);
    if (val("#iDesig")) L.push("Designation: " + val("#iDesig"));
    if (val("#iOrg")) L.push("Organisation: " + val("#iOrg") + (S.inst ? " (" + S.inst + ")" : ""));
    else if (S.inst) L.push("Organisation type: " + S.inst);
    L.push("Contact: " + val("#iContact"));
    if (val("#iNote")) L.push("", "Additional notes: " + val("#iNote"));
    L.push("", "I look forward to your confirmation.", "", "Regards,", name);
    return L.join("\n");
  }
  function refreshLinks() {
    if (S.step !== 3 || !S.date) return;
    var msg = message();
    $("#sendWa").href = "https://wa.me/" + PHONE_WA + "?text=" + encodeURIComponent(msg);
    $("#sendMail").href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Meeting request: " + S.topic + ", " + longDate()) + "&body=" + encodeURIComponent(msg);
  }
  ["#iName", "#iDesig", "#iOrg", "#iContact", "#iNote"].forEach(function (id, i, arr) {
    var el = $(id);
    el.addEventListener("input", function () { var f = el.closest(".fld"); if (f) f.classList.remove("bad"); refreshLinks(); });
    if (id !== "#iNote") el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $(arr[i + 1]).focus(); } });
  });
  function valid() {
    var ok = true, first = null;
    [["#fName", "#iName"], ["#fContact", "#iContact"]].forEach(function (p) { var bad = !val(p[1]), f = $(p[0]); f.classList.remove("bad"); if (bad) { void f.offsetWidth; f.classList.add("bad"); ok = false; if (!first) first = $(p[1]); } });
    if (first) { first.focus(); first.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); }
    return ok;
  }
  function sent(via) {
    buzz(18);
    setTimeout(function () {
      $("#shBody").style.display = "none"; $("#shFoot").style.display = "none";
      $("#bar").style.visibility = "hidden"; $("#backBtn").classList.add("ghost");
      $("#shTitle").style.display = "none"; $("#shSub").style.display = "none";
      $("#doneText").textContent = via === "wa" ? "Please tap Send in WhatsApp to deliver your request. I will confirm the meeting with you shortly." : "Please tap Send in your email application to deliver your request. I will confirm the meeting by reply.";
      $("#done").classList.add("on");
    }, 420);
  }
  $("#sendWa").addEventListener("click", function (e) { if (!valid()) { e.preventDefault(); return; } refreshLinks(); sent("wa"); });
  $("#sendMail").addEventListener("click", function (e) { if (!valid()) { e.preventDefault(); return; } refreshLinks(); sent("mail"); });
  function resetBooking() { $("#done").classList.remove("on"); $("#shBody").style.display = ""; $("#bar").style.visibility = ""; $("#shTitle").style.display = ""; $("#shSub").style.display = ""; go(1); }
  $("#doneBtn").addEventListener("click", function () { requestClose(); });
  go(1);

  if ("serviceWorker" in navigator && location.protocol === "https:") window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
})();
