/*
 * Progressive enhancement only. Every word of content is in the HTML and
 * painted before this deferred file runs. Nothing here is required to read
 * or navigate the site.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------- nav shadow on scroll */
  var nav = document.getElementById('navbar');
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('shadow-sm', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ------------------------------------------------- reading progress bar */
  // Through the CSSOM, not a style attribute: the CSP drops inline styles but
  // does not restrict scripted writes.
  var bar = document.getElementById('scroll-progress');
  if (bar) {
    var barTicking = false;
    var paintBar = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? window.scrollY / max : 0;
      bar.style.transform = 'scaleX(' + (ratio < 0 ? 0 : ratio > 1 ? 1 : ratio) + ')';
      barTicking = false;
    };
    var queueBar = function () {
      if (!barTicking) {
        barTicking = true;
        requestAnimationFrame(paintBar);
      }
    };
    window.addEventListener('scroll', queueBar, { passive: true });
    window.addEventListener('resize', queueBar, { passive: true });
    paintBar();
  }

  /* -------------------------------------------------- primary nav groups */
  // The panels open on hover and on focus in CSS, one at a time, with or
  // without this file. What is added here is the part CSS cannot hold: a click
  // (or a tap on a touch laptop) pins a group open after the pointer leaves,
  // until the next click, until another group is hovered, or until Escape.
  var navGroups = [].slice.call(document.querySelectorAll('.primary-nav .nav-group'));
  if (navGroups.length) {
    var pinnedGroup = null;
    var triggerOf = function (g) {
      return g.querySelector('button');
    };

    // aria-expanded has to follow the panel, not just the pin: a group opened
    // by keyboard focus is as open as one that was clicked.
    var syncExpanded = function (g) {
      var open = g === pinnedGroup || (!g.classList.contains('is-dismissed') && g.contains(document.activeElement));
      triggerOf(g).setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    var pin = function (g) {
      if (pinnedGroup === g) return;
      var was = pinnedGroup;
      pinnedGroup = g;
      if (was) {
        was.classList.remove('is-pinned');
        // A click left focus on that trigger, so unpinning alone would let
        // :focus-within reopen the panel the moment the pointer leaves.
        if (was.contains(document.activeElement)) was.classList.add('is-dismissed');
        syncExpanded(was);
      }
      if (g) {
        g.classList.remove('is-dismissed');
        g.classList.add('is-pinned');
      }
      navGroups.forEach(syncExpanded);
    };

    navGroups.forEach(function (g) {
      triggerOf(g).addEventListener('click', function () {
        var closing = pinnedGroup === g;
        pin(closing ? null : g);
        // Clicking a pinned group shut leaves its own trigger focused, and
        // :focus-within would open it straight back up. Hold it closed until
        // the pointer or the keyboard comes back to it.
        if (closing) g.classList.add('is-dismissed');
        syncExpanded(g);
      });

      // Moving onto any group releases a pin held by another one. The CSS has
      // already hidden it; this keeps the state and aria in step.
      g.addEventListener('pointerenter', function () {
        if (pinnedGroup && pinnedGroup !== g) pin(null);
        g.classList.remove('is-dismissed');
      });

      g.addEventListener('focusin', function () {
        g.classList.remove('is-dismissed');
        syncExpanded(g);
      });
      g.addEventListener('focusout', function () {
        // Deferred: at focusout time the new target is not focused yet.
        setTimeout(function () {
          if (!g.contains(document.activeElement)) syncExpanded(g);
        }, 0);
      });
    });

    document.addEventListener('click', function (e) {
      if (pinnedGroup && !pinnedGroup.contains(e.target)) pin(null);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // Escape closes but keeps focus where it is, which is why the panel needs
      // a class to stay shut: the trigger is still focused underneath it.
      var focused = navGroups.filter(function (g) {
        return g.contains(document.activeElement);
      })[0];
      if (focused) {
        focused.classList.add('is-dismissed');
        triggerOf(focused).focus();
        syncExpanded(focused);
      }
      if (pinnedGroup) pin(null);
    });
  }

  /* ------------------------------------------------------ mobile menu ux */
  // The menu is pure CSS (<details>). This adds click-away and Escape.
  var menu = document.getElementById('mobile-nav');
  if (menu) {
    document.addEventListener('click', function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.open) {
        menu.open = false;
        var s = menu.querySelector('summary');
        if (s) s.focus();
      }
    });
  }

  /* ----------------------------------------------------- reveal on scroll */
  var reveals = document.querySelectorAll('.reveal');

  if (reducedMotion || !('IntersectionObserver' in window)) {
    // No animation: show everything immediately.
    for (var i = 0; i < reveals.length; i++) reveals[i].classList.add('active');
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -50px 0px', threshold: 0.01 }
    );
    for (var j = 0; j < reveals.length; j++) io.observe(reveals[j]);

    // Anything already in view on load should not wait for a scroll event.
    requestAnimationFrame(function () {
      for (var k = 0; k < reveals.length; k++) {
        if (reveals[k].getBoundingClientRect().top < window.innerHeight) {
          reveals[k].classList.add('active');
        }
      }
    });
  }

  /* ------------------------------------------------------- counting stats */
  // The finished value is already in the HTML; this walks up to it. With JS
  // off or reduced motion on, the reader still sees the real figure.
  var figures = document.querySelectorAll('.stat-figure[data-count-to]');
  if (figures.length && !reducedMotion && 'IntersectionObserver' in window) {
    var countUp = function (el) {
      var parts = /^([^\d-]*)(-?[\d.]+)(.*)$/.exec(el.getAttribute('data-count-to') || '');
      if (!parts) return;

      var prefix = parts[1];
      var target = parseFloat(parts[2]);
      var suffix = parts[3];
      var dot = parts[2].indexOf('.');
      var places = dot < 0 ? 0 : parts[2].length - dot - 1;

      var duration = 1400;
      var start = 0;
      var step = function (now) {
        if (!start) start = now;
        var t = Math.min((now - start) / duration, 1);
        // easeOutExpo: reads as a counter landing, not a linear ramp.
        var eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        el.textContent = prefix + (target * eased).toFixed(places) + suffix;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    var statObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            statObserver.unobserve(entry.target);
            countUp(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    for (var f = 0; f < figures.length; f++) statObserver.observe(figures[f]);
  }

  /* --------------------------------------------- prefetch on hover intent */
  // Pages are small and static, so the next one can be cached before the
  // click lands. Gated on Save-Data and 2g to stay off metered connections.
  var conn = navigator.connection;
  var frugal = !!conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''));

  if (!frugal && document.createElement('link').relList.supports('prefetch')) {
    var prefetched = {};
    var prefetch = function (href) {
      var url;
      try {
        url = new URL(href, location.href);
      } catch (e) {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname) return;
      if (prefetched[url.pathname]) return;
      prefetched[url.pathname] = true;

      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url.pathname;
      document.head.appendChild(link);
    };

    var hoverTimer;
    var onIntent = function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      clearTimeout(hoverTimer);
      // A cursor crossing a link on its way somewhere else is not intent.
      hoverTimer = setTimeout(function () {
        prefetch(a.getAttribute('href'));
      }, 120);
    };

    document.addEventListener('mouseover', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent, { passive: true });
    document.addEventListener('mouseout', function () {
      clearTimeout(hoverTimer);
    }, { passive: true });
  }

  /* ------------------------------------------- interactive hero dot matrix */
  function MatrixEffect(canvasId, color) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || reducedMotion) return;

    var ctx = canvas.getContext('2d');
    var dots = [];
    var mouse = { x: -1000, y: -1000, radius: 120 };
    var spacing = 35;
    var frame = null;
    var width = 0;
    var height = 0;

    function init() {
      var parent = canvas.parentElement;
      if (!parent) return;
      width = parent.offsetWidth;
      height = parent.offsetHeight;
      canvas.width = width;
      canvas.height = height;

      dots = [];
      for (var x = spacing / 2; x < width; x += spacing) {
        for (var y = spacing / 2; y < height; y += spacing) {
          dots.push({ baseX: x, baseY: y, x: x, y: y });
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      ctx.beginPath();

      for (var i = 0; i < dots.length; i++) {
        var dot = dots[i];
        var dx = mouse.x - dot.baseX;
        var dy = mouse.y - dot.baseY;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < mouse.radius) {
          var force = (mouse.radius - dist) / mouse.radius;
          var angle = Math.atan2(dy, dx);
          dot.x += (dot.baseX - Math.cos(angle) * force * 15 - dot.x) * 0.1;
          dot.y += (dot.baseY - Math.sin(angle) * force * 15 - dot.y) * 0.1;
        } else if (dot.x !== dot.baseX || dot.y !== dot.baseY) {
          dot.x += (dot.baseX - dot.x) * 0.08;
          dot.y += (dot.baseY - dot.y) * 0.08;
          if (Math.abs(dot.x - dot.baseX) < 0.1) dot.x = dot.baseX;
          if (Math.abs(dot.y - dot.baseY) < 0.1) dot.y = dot.baseY;
        }

        ctx.moveTo(dot.x, dot.y);
        ctx.arc(dot.x, dot.y, 1.2, 0, Math.PI * 2);
      }

      ctx.fill();
      frame = requestAnimationFrame(animate);
    }

    init();

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(init, 150);
    });

    window.addEventListener(
      'mousemove',
      function (e) {
        var rect = canvas.getBoundingClientRect();
        var inside =
          e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        mouse.x = inside ? e.clientX - rect.left : -1000;
        mouse.y = inside ? e.clientY - rect.top : -1000;
      },
      { passive: true }
    );

    window.addEventListener('mouseleave', function () {
      mouse.x = -1000;
      mouse.y = -1000;
    });

    // Only burn frames while the canvas is actually on screen.
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        if (!frame) frame = requestAnimationFrame(animate);
      } else if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    }).observe(canvas);
  }

  MatrixEffect('hero-matrix', 'rgba(255, 255, 255, 0.15)');
})();
