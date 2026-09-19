/* =========================================================================
 * Vybe Technologies — progressive enhancement only.
 *
 * Every word of content is already in the HTML and painted before this file
 * runs (it is deferred). Nothing here is required to read or navigate the
 * site; it only adds the scroll reveal, the nav shadow and the hero canvas.
 * ========================================================================= */
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

  /* ------------------------------------------------------ mobile menu ux */
  // The menu itself is pure CSS (<details>). This only adds the dismissals
  // people expect: click-away and Escape.
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
