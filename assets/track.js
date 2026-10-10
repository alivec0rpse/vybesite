/*
 * The order tracker behind /track/. Progressive enhancement: the form is in
 * the HTML and, without this file, submits as a plain GET to /track/?code=…,
 * where <noscript> says how to ask us instead.
 *
 * A tracking link is /track/VYB-XXXXX-XXXXX. staticwebapp.config.json
 * rewrites every /track/* path to this one page, and this script reads the
 * code back off the path (or off ?code= when the form was submitted).
 *
 * Markup is built with DOM calls and textContent, never innerHTML: every
 * string in an order was typed by a person, and some of it by a customer.
 *
 * material-symbols-outlined: payments, check_circle, radio_button_checked, radio_button_unchecked, local_shipping, inventory_2, schedule, open_in_new, refresh, info, pause_circle, cancel, storefront, two_wheeler, person, location_city, error
 */
(function () {
  'use strict';

  var form = document.getElementById('track-form');
  var input = document.getElementById('track-code');
  var out = document.getElementById('track-result');
  if (!form || !input || !out) return;

  var MODE_ICON = {
    hand_delivery: 'person',
    courier: 'local_shipping',
    porter: 'two_wheeler',
    intracity: 'location_city',
    pickup: 'storefront',
    other: 'local_shipping',
  };

  /* --------------------------------------------------------------- dom */

  function h(tag, cls, children) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    [].concat(children == null ? [] : children).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function icon(name, cls) {
    var s = h('span', 'material-symbols-outlined ' + (cls || ''), name);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  /* ------------------------------------------------------------ format */

  var IST = { timeZone: 'Asia/Kolkata' };
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-IN', Object.assign({ day: 'numeric', month: 'short', year: 'numeric' }, IST)) +
      ', ' + d.toLocaleTimeString('en-IN', Object.assign({ hour: 'numeric', minute: '2-digit' }, IST));
  }
  function day(ymd) {
    if (!ymd) return '';
    return new Date(ymd + 'T00:00:00+05:30').toLocaleDateString('en-IN', Object.assign({ weekday: 'short', day: 'numeric', month: 'short' }, IST));
  }

  /* Codes arrive retyped from a WhatsApp message or read out over the phone,
     so match on letters and digits alone, the way the API does. */
  function clean(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function pretty(s) {
    var c = clean(s);
    if (c.indexOf('VYB') === 0 && c.length === 13) c = c.slice(3);
    return c.length === 10 ? 'VYB-' + c.slice(0, 5) + '-' + c.slice(5) : String(s || '').trim();
  }

  /* ------------------------------------------------------------ render */

  function tone(o) {
    if (o.status.key === 'cancelled') return 'bg-slate-900 text-white';
    if (o.status.exception) return 'bg-amber-100 text-amber-900';
    if (o.status.key === 'delivered' || o.status.key === 'picked_up') return 'bg-emerald-100 text-emerald-900';
    return 'bg-brand text-white';
  }

  function stepper(o) {
    var list = h('ol', 'relative mt-2');
    o.steps.forEach(function (s, i) {
      var last = i === o.steps.length - 1;
      var mark = s.done
        ? icon(s.current ? 'radio_button_checked' : 'check_circle', 'text-[24px] ' + (s.current ? 'text-brand' : 'text-emerald-600'))
        : icon('radio_button_unchecked', 'text-[24px] text-slate-300');
      var rail = last ? null : h('span', 'absolute left-[11px] top-7 bottom-0 w-0.5 ' + (o.steps[i + 1].done ? 'bg-emerald-500' : 'bg-slate-200'));
      if (rail) rail.setAttribute('aria-hidden', 'true');
      var li = h('li', 'relative flex gap-4 ' + (last ? '' : 'pb-6'), [
        rail,
        h('span', 'relative z-10 bg-white rounded-full leading-none', mark),
        h('div', 'pt-0.5', [
          h('p', 'text-sm font-bold ' + (s.done ? 'text-slate-900' : 'text-slate-400'), s.label),
          s.at ? h('p', 'text-xs text-slate-500 mt-0.5', when(s.at)) : null,
        ]),
      ]);
      if (s.current) li.setAttribute('aria-current', 'step');
      list.appendChild(li);
    });
    return list;
  }

  function fact(label, value, extra) {
    if (!value) return null;
    return h('div', '', [
      h('dt', 'text-xs font-bold uppercase tracking-[0.15em] text-slate-400', label),
      h('dd', 'mt-1 text-sm font-bold text-slate-900 break-words', [value, extra || null]),
    ]);
  }

  function card(o) {
    var statusIcon = o.status.key === 'cancelled' ? 'cancel' : o.status.key === 'on_hold' ? 'pause_circle' : MODE_ICON[o.deliveryMode.key] || 'local_shipping';

    var head = h('div', 'p-6 md:p-8 border-b border-slate-100', [
      h('div', 'flex flex-wrap items-start justify-between gap-4', [
        h('div', '', [
          h('p', 'text-xs font-bold uppercase tracking-[0.15em] text-slate-400', 'Tracking code'),
          h('p', 'mt-1 text-lg font-black font-display tracking-tight text-slate-900', o.code),
          o.customerName ? h('p', 'mt-1 text-sm font-bold text-slate-700', 'For ' + o.customerName) : null,
          o.reference ? h('p', 'mt-1 text-xs text-slate-500', 'Reference ' + o.reference) : null,
        ]),
        h('span', 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ' + tone(o), [icon(statusIcon, 'text-[18px]'), o.status.label]),
      ]),
      h('p', 'mt-5 text-base text-slate-700 leading-relaxed', o.status.hint),
      o.updatedAt ? h('p', 'mt-1 text-xs text-slate-500', 'Last updated ' + when(o.updatedAt)) : null,
    ]);

    var partnerLink = o.partnerUrl
      ? (function () {
          var a = h('a', 'inline-flex items-center gap-1 text-brand hover:underline ml-2 font-bold', ['Track with ' + (o.partner || 'partner'), icon('open_in_new', 'text-[16px]')]);
          a.href = o.partnerUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          return a;
        })()
      : null;

    var facts = h('dl', 'grid grid-cols-2 gap-5', [
      fact('Delivery', o.deliveryMode.label),
      fact('Expected by', day(o.expectedBy)),
      fact(o.deliveryMode.key === 'courier' ? 'Courier' : 'Delivery partner', o.partner),
      fact(o.deliveryMode.key === 'courier' ? 'AWB / consignment no.' : 'Partner reference', o.partnerRef),
      fact('Payment', paymentText(o)),
      fact('Order placed', when(o.placedAt)),
    ]);
    if (partnerLink) facts.appendChild(h('div', 'col-span-2', partnerLink));

    var table = h('table', 'w-full text-sm');
    table.appendChild(
      h('thead', '', h('tr', 'text-left text-xs uppercase tracking-[0.15em] text-slate-400', [h('th', 'pb-2 font-bold', 'Item'), h('th', 'pb-2 font-bold text-right', 'Qty')]))
    );
    var tbody = h('tbody', 'divide-y divide-slate-100');
    o.items.forEach(function (it) {
      tbody.appendChild(h('tr', '', [h('td', 'py-2 pr-4 text-slate-800', it.name), h('td', 'py-2 text-right font-bold text-slate-900 tabular-nums', String(it.qty))]));
    });
    table.appendChild(tbody);

    var due = paymentDue(o);
    var dueBox = due
      ? h('div', 'mx-6 md:mx-8 mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 flex gap-3 text-sm text-amber-900 leading-relaxed', [
          icon('payments', 'text-amber-700 text-[20px] shrink-0'),
          h('p', 'font-bold', due),
        ])
      : null;

    var note = o.publicNote
      ? h('div', 'mx-6 md:mx-8 mt-6 rounded-xl border border-brand/30 bg-brand/5 p-4 flex gap-3 text-sm text-slate-700 leading-relaxed', [
          icon('info', 'text-brand text-[20px] shrink-0'),
          h('p', 'whitespace-pre-line', o.publicNote),
        ])
      : null;

    var history = h('ol', 'space-y-4');
    o.history.forEach(function (ev) {
      history.appendChild(
        h('li', 'flex gap-3', [
          icon('schedule', 'text-slate-400 text-[18px] mt-0.5 shrink-0'),
          h('div', '', [
            h('p', 'text-sm font-bold text-slate-900', ev.label),
            h('p', 'text-xs text-slate-500', when(ev.at)),
            ev.note ? h('p', 'mt-1 text-sm text-slate-600 whitespace-pre-line', ev.note) : null,
          ]),
        ])
      );
    });

    var refresh = h('button', 'inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white hover:border-brand hover:text-brand px-5 py-2.5 text-sm font-bold text-slate-900 transition-colors', [
      icon('refresh', 'text-[18px]'),
      'Refresh',
    ]);
    refresh.type = 'button';
    refresh.addEventListener('click', function () {
      lookup(o.code, true);
    });

    return h('article', 'rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden', [
      head,
      dueBox,
      note,
      h('div', 'grid md:grid-cols-2 gap-8 p-6 md:p-8', [
        h('section', '', [h('h2', 'text-base font-bold font-display tracking-tight text-slate-900 mb-4', 'Progress'), stepper(o)]),
        h('div', 'space-y-8', [
          h('section', '', [h('h2', 'text-base font-bold font-display tracking-tight text-slate-900 mb-4', 'Delivery'), facts]),
          h('section', '', [h('h2', 'text-base font-bold font-display tracking-tight text-slate-900 mb-3', 'Items'), table]),
        ]),
      ]),
      h('section', 'border-t border-slate-100 p-6 md:p-8', [
        h('div', 'flex items-center justify-between gap-4 mb-5', [h('h2', 'text-base font-bold font-display tracking-tight text-slate-900', 'All updates'), refresh]),
        history,
      ]),
    ]);
  }

  function rupees(a) {
    return '\u20b9' + Number(a).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  /* Payment, in the delivery facts. Prepaid just says so; cash on delivery and
     credit say whether the money is still owed. */
  function paymentText(o) {
    var p = o.payment;
    if (!p || p.key === 'prepaid') return 'Prepaid';
    if (p.paid) return p.label + ' \u00b7 paid' + (p.paidAt ? ' ' + day(p.paidAt.slice(0, 10)) : '');
    return p.label + (p.amount ? ' \u00b7 ' + rupees(p.amount) + ' due' : '');
  }

  /** The one sentence a customer who still owes money needs to read, or null. */
  function paymentDue(o) {
    var p = o.payment;
    if (!p || p.paid || p.key === 'prepaid' || o.status.key === 'cancelled') return null;
    var amt = p.amount ? rupees(p.amount) : 'the order amount';
    if (p.key === 'cod') return o.deliveryMode.key === 'pickup' ? 'Please pay ' + amt + ' when you collect your order.' : 'Cash on delivery: please keep ' + amt + ' ready when your order arrives.';
    return 'Payment of ' + amt + ' is due' + (p.dueBy ? ' by ' + day(p.dueBy) : '') + '.';
  }

  function message(kind, title, text) {
    return h('div', 'rounded-2xl border p-6 flex gap-4 ' + (kind === 'error' ? 'border-brand/30 bg-brand/5' : 'border-slate-200 bg-white'), [
      icon(kind === 'error' ? 'error' : 'info', 'text-brand text-[24px] shrink-0'),
      h('div', '', [h('p', 'text-base font-bold text-slate-900', title), text ? h('p', 'mt-1 text-sm text-slate-600 leading-relaxed', text) : null]),
    ]);
  }

  function show(node) {
    out.replaceChildren(node);
  }

  /* ------------------------------------------------------------ lookup */

  var busy = false;
  function lookup(raw, quiet) {
    var code = clean(raw);
    if (!code) {
      show(message('error', 'Enter your tracking code', 'It starts with VYB and is in the message we sent you when your payment was confirmed.'));
      input.focus();
      return;
    }
    if (busy) return;
    busy = true;
    if (!quiet) show(message('info', 'Looking up ' + pretty(raw) + '…'));
    out.setAttribute('aria-busy', 'true');

    fetch('/api/track/' + encodeURIComponent(code), { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
      })
      .then(function (r) {
        if (r.ok) {
          show(card(r.body));
          input.value = r.body.code;
          // Leave the address bar holding the shareable link to this order.
          if (location.pathname !== '/track/' + r.body.code) history.replaceState(null, '', '/track/' + r.body.code);
        } else if (r.status === 404) {
          show(message('error', 'No order with that code', 'Check it character by character against the message from us. Spaces and dashes do not matter. Still stuck? Call or WhatsApp us with your name and we will look it up.'));
        } else {
          show(message('error', 'We could not check right now', (r.body && r.body.error) || 'Try again in a minute.'));
        }
      })
      .catch(function () {
        show(message('error', 'You appear to be offline', 'Check your connection and try again.'));
      })
      .then(function () {
        busy = false;
        out.removeAttribute('aria-busy');
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    lookup(input.value);
  });

  // /track/VYB-XXXXX-XXXXX, or /track/?code=… from the no-JS form.
  var fromPath = decodeURIComponent(location.pathname.replace(/^\/track\/?/, '').replace(/\/$/, ''));
  if (fromPath === 'index.html') fromPath = '';
  var fromQuery = new URLSearchParams(location.search).get('code');
  var initial = fromPath || fromQuery;
  if (initial) {
    input.value = pretty(initial);
    lookup(initial);
  }
})();
