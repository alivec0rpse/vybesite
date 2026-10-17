/*
 * Progressive enhancement only. Every word of content is in the HTML and
 * painted before this deferred file runs. Nothing here is required to read
 * or navigate the site.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // GSAP and ScrollTrigger are vendored under /assets/vendor and loaded with
  // `defer` ahead of this file, so they are parsed by the time this runs — but
  // this file is the one that must keep working if they ever are not, so every
  // use of them is behind this flag and there is a hand-rolled path below for
  // when it is false.
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var useGsap = !reducedMotion && !!gsap && !!ScrollTrigger;

  if (useGsap) {
    gsap.registerPlugin(ScrollTrigger);

    // On a phone the address bar sliding away fires a resize mid-scroll, and a
    // ScrollTrigger refresh recalculates every start/end at exactly the moment
    // the user is scrolling. Same stutter the hero canvas had to be taught to
    // ignore; same answer.
    ScrollTrigger.config({ ignoreMobileResize: true });

    // .reveal carries a CSS transition for the no-GSAP path. Left on, it would
    // ease every inline value GSAP writes per frame, so the reveal would run
    // through two easings and land late.
    document.documentElement.classList.add('gsap-on');
  }

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

  if (useGsap && reveals.length) {
    // ScrollTrigger.batch is the reason this moved off IntersectionObserver.
    // The observer fired one callback per element, so a row of four cards
    // crossing the fold together animated as four independent 800ms fades that
    // happened to start on the same frame. batch collects the elements that
    // enter within the same window and hands them over as a group, which is
    // what makes a stagger possible at all.
    ScrollTrigger.batch(reveals, {
      start: 'top 88%',
      once: true,
      onEnter: function (batch) {
        gsap.set(batch, { willChange: 'transform, opacity' });
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          stagger: 0.08,
          overwrite: 'auto',
          // Only the hint is cleared. Clearing the rest would hand the
          // elements back to .reveal's opacity:0 and blank them again.
          clearProps: 'willChange',
        });
      },
    });
  } else if (reducedMotion || !('IntersectionObserver' in window)) {
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

  /* --------------------------------------------- hero entrance (clean-up) */
  // The entrance itself is CSS — see [data-hero] in the stylesheet. It has to
  // be, because this file is deferred and the hero is painted long before it
  // runs: anything that hid the headline from here would flash it first. All
  // that is left to do is drop the compositor hint once the movement is over,
  // so the hero does not hold a layer per child for the rest of the visit.
  var heroKids = document.querySelectorAll('[data-hero] > *');
  for (var h = 0; h < heroKids.length; h++) {
    (function (el) {
      el.addEventListener(
        'animationend',
        function (e) {
          // Decorative children run their own looping keyframes (floating
          // badges, drifting orbs) and those bubble up to here. Only the
          // element's own entrance means the entrance is done.
          if (e.target !== el || e.animationName.indexOf('hero-rise') < 0) return;
          el.style.willChange = 'auto';
        },
        false
      );
    })(heroKids[h]);
  }

  /* ------------------------------------------------------- hero parallax */
  // Decorative layers only — the bordered circles behind the home hero, the
  // faint grid behind the inner pages. Nothing that carries meaning moves, so
  // there is nothing to lose if this never runs.
  if (useGsap) {
    var heroSection = document.querySelector('[data-hero-section]');

    if (heroSection) {
      // Direct children that are out of flow and decorative. Matching on
      // aria-hidden / pointer-events is what keeps this off real content: a
      // layer the reader cannot reach is a layer that is safe to move.
      var layers = [].slice
        .call(heroSection.children)
        .filter(function (el) {
          if (el.tagName === 'CANVAS') return false; // the dot matrix drives itself
          var cs = getComputedStyle(el);
          if (cs.position !== 'absolute') return false;
          if (el.getAttribute('aria-hidden') !== 'true' && cs.pointerEvents !== 'none') return false;

          // A backdrop pinned to a section that turns out to be the whole page
          // — /audits/ wraps 10,000px of content in the <section> that holds
          // its <h1> — is a layer the compositor would have to keep at full
          // page height in GPU memory for the sake of 60px of drift nobody
          // reads as parallax. Two viewports is the cutoff.
          return el.getBoundingClientRect().height <= window.innerHeight * 2;
        });

      if (layers.length) {
        var TRAVEL = 60;

        // Desktop and a real pointer only. This site already freezes its
        // decorative motion on touch — the blurred orbs, the dot matrix —
        // because re-rasterising a large blurred layer every frame is what
        // costs a phone its scroll budget. Parallax is the same bargain.
        //
        // Everything the effect needs, including the compositor hint and the
        // box it moves inside, is set up in here and torn down on the way out.
        // Done outside, a phone would carry promoted layers and inflated
        // backdrops for an animation it never runs.
        gsap.matchMedia().add('(min-width: 768px) and (hover: hover) and (pointer: fine)', function () {
          layers.forEach(function (el) {
            el.setAttribute('data-parallax', '');

            // A layer pinned to all four edges covers the section exactly, so
            // sliding it 60px would drag a hard edge into view. Growing it by
            // the travel first gives the movement somewhere to go. It is
            // position:absolute, so inflating it shifts nothing in the
            // document and cannot register as a layout shift.
            var cs = getComputedStyle(el);
            if (cs.top === '0px' && cs.bottom === '0px') {
              el.style.top = -TRAVEL + 'px';
              el.style.bottom = -TRAVEL + 'px';
            }
          });

          gsap.to(layers, {
            y: TRAVEL,
            ease: 'none', // linear: a parallax layer tracks the scrollbar, it does not ease
            scrollTrigger: {
              trigger: heroSection,
              start: 'top top',
              // Not 'bottom top'. The <section> holding the <h1> is the hero on
              // most pages but the entire article on some, and spreading 60px
              // of drift over a 10,000px section makes it invisible. One
              // viewport of scrolling is the window in which a hero backdrop
              // is still on screen, whatever its section turns out to contain.
              end: function () {
                return '+=' + Math.min(heroSection.offsetHeight, window.innerHeight);
              },
              scrub: 0.4, // a touch of lag, so a trackpad flick does not snap the layer
              invalidateOnRefresh: true,
            },
          });

          // Ran when the query stops matching — a window dragged narrow, or a
          // 2-in-1 folded into a tablet. GSAP reverts the tween itself; these
          // are the things it does not know about. Without this the backdrop
          // would keep an inflated box and a GPU layer it no longer uses.
          return function () {
            layers.forEach(function (el) {
              el.removeAttribute('data-parallax');
              el.style.top = '';
              el.style.bottom = '';
            });
          };
        });
      }
    }
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

    // The whole effect is driven by cursor proximity, so on a touch device it
    // renders several hundred motionless dots at 60fps and nothing else. That
    // is pure battery and main-thread cost competing with the scroll, which is
    // what made the hero feel janky on phones.
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

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

    /* Only a width change can alter the dot grid. Listening to every resize
       meant the address bar sliding away mid-scroll fired one, and init()
       clears the canvas and rebuilds the whole array — a visible stutter at
       exactly the moment the user was scrolling. */
    var resizeTimer;
    var lastWidth = width;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var parent = canvas.parentElement;
        if (!parent || parent.offsetWidth === lastWidth) return;
        lastWidth = parent.offsetWidth;
        init();
      }, 150);
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
