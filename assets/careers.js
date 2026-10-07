/*
 * The talent-pool form on /careers/. There is no backend: once the form is
 * valid, this opens the visitor's own email app with a message to HR already
 * written, so they only have to press Send. Nothing is stored or sent by the
 * site itself.
 *
 * The send button ships disabled and is enabled here, because without this
 * file the form has nowhere useful to go (see the note in build.js).
 */
(function () {
  'use strict';

  var form = document.getElementById('pool-form');
  if (!form) return;

  var TO = 'hr@vybe.net.in';
  var NOTE_MAX = 500;

  var opened = document.getElementById('pool-opened');
  var mailto = document.getElementById('pool-mailto');
  var copy = document.getElementById('pool-copy');
  var copyLabel = document.getElementById('pool-copy-label');
  var copyStatus = document.getElementById('pool-copy-status');
  var note = document.getElementById('pool-note');
  var count = document.getElementById('pool-note-count');

  document.getElementById('pool-submit').disabled = false;

  var trim = function (s) {
    return String(s || '').replace(/^\s+|\s+$/g, '');
  };

  /** "+91 98450-12345", "098450 12345" and "9845012345" are all one number. */
  function mobile(v) {
    var d = String(v).replace(/[\s\-().]/g, '');
    if (/^\+?91\d{10}$/.test(d)) d = d.slice(-10);
    else if (/^0\d{10}$/.test(d)) d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  }

  /** Accepts "linkedin.com/in/x" as well as a full URL. */
  function link(v) {
    if (!v) return '';
    var u = /^https?:\/\//i.test(v) ? v : 'https://' + v;
    try {
      var p = new URL(u);
      return /\./.test(p.hostname) ? p.href : null;
    } catch (e) {
      return null;
    }
  }

  var CHECKS = {
    'pool-name': function (v) {
      return trim(v).length >= 2 ? '' : 'Please enter your full name.';
    },
    'pool-email': function (v) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trim(v)) ? '' : 'Please enter a valid email address, like name@example.com.';
    },
    'pool-phone': function (v) {
      return mobile(v) ? '' : 'Please enter a 10-digit Indian mobile number, like 98450 12345.';
    },
    'pool-interest': function (v) {
      return v ? '' : 'Please choose an area of interest.';
    },
    'pool-link': function (v) {
      return link(trim(v)) === null ? 'Please enter a full web address, like https://linkedin.com/in/yourname.' : '';
    },
    'pool-note': function (v) {
      return v.length <= NOTE_MAX ? '' : 'Please keep your note to ' + NOTE_MAX + ' characters.';
    },
    'pool-consent': function (v, el) {
      return el.checked ? '' : 'Please tick this box so we can keep your details.';
    },
  };

  function check(id) {
    var el = document.getElementById(id);
    var err = document.getElementById(id + '-error');
    var msg = CHECKS[id](el.value, el);
    if (msg) {
      el.setAttribute('aria-invalid', 'true');
      err.textContent = msg;
      err.hidden = false;
    } else {
      el.removeAttribute('aria-invalid');
      err.textContent = '';
      err.hidden = true;
    }
    return !msg;
  }

  // Validate a field once it has been left, and keep re-checking it after
  // that, so an error clears the moment it is fixed rather than on submit.
  Object.keys(CHECKS).forEach(function (id) {
    var el = document.getElementById(id);
    var touched = false;
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'blur', function () {
      touched = true;
      check(id);
    });
    el.addEventListener('input', function () {
      if (touched) check(id);
    });
  });

  function updateCount() {
    count.textContent = NOTE_MAX - note.value.length + ' of ' + NOTE_MAX + ' characters left.';
  }
  note.addEventListener('input', updateCount);
  updateCount();

  /** The email itself: a subject HR can sort by, and a body in plain lines. */
  function message() {
    // namedItem, not form.elements.name: a control called "name" is
    // shadowed by properties the collection already has.
    var f = function (n) {
      return form.elements.namedItem(n);
    };
    var name = trim(f('name').value);
    var interest = f('interest').value;
    var body = [
      'Hello Vybe team,',
      '',
      'I would like to join the Vybe Technologies talent pool.',
      '',
      'Full name: ' + name,
      'Email: ' + trim(f('email').value),
      'Phone: +91 ' + mobile(f('phone').value),
      'Area of interest: ' + interest,
      'College & year of study: ' + (trim(f('college').value) || '-'),
      'LinkedIn / portfolio: ' + (link(trim(f('link').value)) || '-'),
      '',
      'Note:',
      trim(f('note').value) || '-',
      '',
      'I agree that Vybe Technologies may store my details for up to 12 months to contact me about roles, in line with the Digital Personal Data Protection Act, 2023. I can ask for them to be deleted at any time by writing to support@vybe.net.in.',
      '',
      'Sent from the talent-pool form at vybe.net.in/careers/',
    ].join('\r\n');
    return { subject: 'Talent pool: ' + name + ' (' + interest + ')', body: body };
  }

  var last = null;

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var first = null;
    Object.keys(CHECKS).forEach(function (id) {
      if (!check(id) && !first) first = document.getElementById(id);
    });
    if (first) {
      first.focus();
      return;
    }

    last = message();
    var href = 'mailto:' + TO + '?subject=' + encodeURIComponent(last.subject) + '&body=' + encodeURIComponent(last.body);
    mailto.href = href;
    copyLabel.textContent = 'Copy my details';
    opened.hidden = false;
    window.location.href = href;
    // After the hand-off, so the email app is not raced by the page scrolling.
    setTimeout(function () {
      opened.focus();
    }, 300);
  });

  function copied(ok) {
    copyLabel.textContent = ok ? 'Copied' : 'Copy failed';
    copyStatus.textContent = ok
      ? 'Your details are copied. Paste them into an email to ' + TO + '.'
      : 'Copying did not work. Please select and copy your answers from the form instead.';
  }

  /** Older browsers, plain http, and any browser that refuses the modern API. */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {}
    document.body.removeChild(ta);
    return ok;
  }

  copy.addEventListener('click', function () {
    if (!last) return;
    var text = 'To: ' + TO + '\nSubject: ' + last.subject + '\n\n' + last.body.replace(/\r\n/g, '\n');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () {
          copied(true);
        },
        function () {
          copied(legacyCopy(text));
        }
      );
      return;
    }
    copied(legacyCopy(text));
  });
})();
