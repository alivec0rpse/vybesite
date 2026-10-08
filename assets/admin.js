/*
 * The order desk behind /vyb-admin/. The page's HTML (built in build.js)
 * carries every form; this file signs staff in, fills the lists, and talks to
 * /api/*. Nothing here is trusted: the API checks the session and the role on
 * every call, so hiding the Staff tab from a `user` is tidiness, not security.
 *
 * The session is an HttpOnly cookie scoped to /api, so this script never sees
 * it and nothing it renders could leak it. Markup goes in via textContent.
 *
 * material-symbols-outlined: add, delete, content_copy, open_in_new, chat, undo, arrow_back, refresh, logout, key, person_add, close
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { user: null, meta: null, order: null, creating: false };

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
    var s = h('span', 'material-symbols-outlined ' + (cls || 'text-[18px]'), name);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
  function button(label, cls, onClick, iconName) {
    var b = h('button', cls, [iconName ? icon(iconName) : null, label]);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function option(value, label, selected) {
    var o = h('option', '', label);
    o.value = value;
    if (selected) o.selected = true;
    return o;
  }
  var BTN = 'inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-white hover:border-brand hover:text-brand px-4 py-2 text-xs font-bold text-slate-900 transition-colors';
  var BTN_DANGER = 'inline-flex items-center justify-center gap-1.5 rounded-full border border-red-200 bg-white hover:bg-red-50 px-4 py-2 text-xs font-bold text-red-700 transition-colors';

  function show(id) {
    ['view-loading', 'view-login', 'view-password', 'view-app'].forEach(function (v) {
      $(v).hidden = v !== id;
    });
  }

  var toastTimer;
  function toast(text, bad) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full px-5 py-3 text-sm font-bold shadow-xl ' + (bad ? 'bg-red-700 text-white' : 'bg-corporate text-white');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 6000 : 3000);
  }

  var IST = { timeZone: 'Asia/Kolkata' };
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-IN', Object.assign({ day: 'numeric', month: 'short' }, IST)) + ', ' +
      d.toLocaleTimeString('en-IN', Object.assign({ hour: 'numeric', minute: '2-digit' }, IST));
  }

  /* --------------------------------------------------------------- api */

  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch('/api/' + path, opts)
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
      }, function () {
        return { ok: false, status: 0, body: { error: 'Network error. Check your connection.' } };
      })
      .then(function (r) {
        // Session gone (expired, signed out elsewhere, role changed): back to sign-in.
        if (r.status === 401 && path !== 'auth/login') {
          state.user = null;
          show('view-login');
          $('who').hidden = true;
        } else if (r.status === 403 && /new password/i.test(r.body.error || '')) {
          passwordView(true);
        }
        return r;
      });
  }

  /* -------------------------------------------------------------- boot */

  function boot() {
    api('GET', 'auth/me').then(function (r) {
      if (!r.ok) {
        if (r.status !== 401) {
          show('view-login');
          $('login-error').textContent = r.body.error || 'The server could not be reached.';
        }
        return;
      }
      state.user = r.body.user;
      state.meta = r.body.meta;
      $('who').hidden = false;
      $('who-name').textContent = (state.user.name ? state.user.name + ' · ' : '') + state.user.email + ' (' + state.user.role + ')';
      if (state.user.mustChangePassword) return passwordView(true);
      startApp();
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.submitter || $('login-form').querySelector('button');
    btn.disabled = true;
    $('login-error').textContent = '';
    api('POST', 'auth/login', { email: $('login-email').value, password: $('login-password').value }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) {
        $('login-error').textContent = r.body.error || 'Sign-in failed.';
        return;
      }
      $('login-password').value = '';
      boot();
    });
  });

  $('btn-logout').addEventListener('click', function () {
    api('POST', 'auth/logout').then(function () {
      state.user = null;
      $('who').hidden = true;
      show('view-login');
    });
  });

  /* ---------------------------------------------------------- password */

  function passwordView(forced) {
    $('password-form').reset();
    $('password-error').textContent = '';
    $('password-intro').textContent = forced
      ? 'Your password was set by somebody else. Choose your own before you carry on — at least 10 characters.'
      : 'At least 10 characters. Changing it signs you out on every other device.';
    $('password-cancel').hidden = forced;
    show('view-password');
    $('password-current').focus();
  }

  $('btn-password').addEventListener('click', function () { passwordView(false); });
  $('password-cancel').addEventListener('click', function () { show('view-app'); });

  $('password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var next = $('password-next').value;
    if (next !== $('password-confirm').value) {
      $('password-error').textContent = 'The two new passwords do not match.';
      return;
    }
    api('POST', 'auth/password', { current: $('password-current').value, next: next }).then(function (r) {
      if (!r.ok) {
        $('password-error').textContent = r.body.error || 'Could not change the password.';
        return;
      }
      toast('Password changed.');
      boot();
    });
  });

  /* -------------------------------------------------------------- tabs */

  function startApp() {
    show('view-app');
    $('tab-staff').hidden = state.user.role !== 'admin';
    fillSelects();
    tab('orders');
  }

  function tab(name) {
    ['orders', 'staff'].forEach(function (t) {
      $('panel-' + t).hidden = t !== name;
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('tab-' + t).className = 'px-5 py-2.5 rounded-full text-sm font-bold transition-colors ' + (t === name ? 'bg-corporate text-white' : 'text-slate-600 hover:text-brand');
    });
    if (name === 'orders') listView();
    if (name === 'staff') loadUsers();
  }
  $('tab-orders').addEventListener('click', function () { tab('orders'); });
  $('tab-staff').addEventListener('click', function () { tab('staff'); });

  function fillSelects() {
    var modes = state.meta.modes;
    var mode = $('f-deliveryMode');
    mode.replaceChildren();
    Object.keys(modes).forEach(function (k) { mode.appendChild(option(k, modes[k].label)); });
    [$('f-status'), $('status-select')].forEach(function (sel) {
      sel.replaceChildren();
      Object.keys(state.meta.statuses).forEach(function (k) { sel.appendChild(option(k, state.meta.statuses[k].label)); });
    });
  }

  /* ------------------------------------------------------------ orders */

  var searchTimer;
  $('orders-q').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadOrders, 250);
  });
  $('orders-show').addEventListener('change', loadOrders);
  $('orders-refresh').addEventListener('click', loadOrders);
  $('btn-new-order').addEventListener('click', function () { orderView(null); });
  $('order-back').addEventListener('click', listView);

  function listView() {
    state.order = null;
    $('orders-list-view').hidden = false;
    $('order-view').hidden = true;
    loadOrders();
  }

  function statusPill(key) {
    var s = state.meta.statuses[key] || { label: key };
    var tone = key === 'cancelled' ? 'bg-slate-900 text-white'
      : s.exception ? 'bg-amber-100 text-amber-900'
      : key === 'delivered' || key === 'picked_up' ? 'bg-emerald-100 text-emerald-900'
      : 'bg-brand/10 text-brand';
    return h('span', 'inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ' + tone, s.label);
  }

  function loadOrders() {
    var q = encodeURIComponent($('orders-q').value.trim());
    var showWhich = $('orders-show').value;
    $('orders-list').setAttribute('aria-busy', 'true');
    api('GET', 'orders?show=' + showWhich + '&q=' + q).then(function (r) {
      $('orders-list').removeAttribute('aria-busy');
      if (!r.ok) return;
      var box = $('orders-list');
      if (!r.body.orders.length) {
        box.replaceChildren(h('p', 'p-8 text-center text-sm text-slate-500', q ? 'No orders match that search.' : 'No orders here yet.'));
        return;
      }
      var tbody = h('tbody', 'divide-y divide-slate-100');
      r.body.orders.forEach(function (o) {
        var items = o.items.map(function (it) { return it.qty + ' × ' + it.name; }).join(', ');
        var tr = h('tr', 'hover:bg-slate-50 cursor-pointer', [
          h('td', 'px-4 py-3 font-bold text-slate-900 whitespace-nowrap', o.code),
          h('td', 'px-4 py-3', [h('span', 'block font-bold text-slate-900', o.customerName), o.reference ? h('span', 'block text-xs text-slate-500', o.reference) : null]),
          h('td', 'px-4 py-3 text-slate-600 max-w-xs truncate', items),
          h('td', 'px-4 py-3 text-slate-600 whitespace-nowrap', (state.meta.modes[o.deliveryMode] || {}).label || o.deliveryMode),
          h('td', 'px-4 py-3', statusPill(o.status)),
          h('td', 'px-4 py-3 text-xs text-slate-500 whitespace-nowrap', when(o.updatedAt)),
        ]);
        tr.tabIndex = 0;
        tr.addEventListener('click', function () { openOrder(o.code); });
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') openOrder(o.code); });
        tbody.appendChild(tr);
      });
      var head = h('thead', 'bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500', h('tr', '', ['Code', 'Customer', 'Items', 'Delivery', 'Status', 'Updated'].map(function (t) { return h('th', 'px-4 py-3 font-bold', t); })));
      box.replaceChildren(h('div', 'overflow-x-auto', h('table', 'w-full text-sm', [head, tbody])));
    });
  }

  function openOrder(code) {
    api('GET', 'orders/' + encodeURIComponent(code)).then(function (r) {
      if (r.ok) orderView(r.body.order);
      else if (r.status !== 401) toast(r.body.error || 'Could not open that order.', true);
    });
  }

  /* -------------------------------------------------------- order form */

  var FIELDS = ['customerName', 'customerPhone', 'customerEmail', 'address', 'reference', 'deliveryMode', 'partner', 'partnerRef', 'partnerUrl', 'expectedBy', 'publicNote', 'internalNote'];

  function itemRow(it) {
    var name = h('input', 'flex-1 min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30');
    name.placeholder = 'Item';
    name.value = (it && it.name) || '';
    name.required = true;
    name.maxLength = 200;
    name.setAttribute('aria-label', 'Item name');
    name.dataset.role = 'name';
    var qty = h('input', 'w-24 rounded-xl border border-slate-300 px-3 py-2 text-sm text-right focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30');
    qty.type = 'number';
    qty.min = '1';
    qty.step = '1';
    qty.required = true;
    qty.value = (it && it.qty) || 1;
    qty.setAttribute('aria-label', 'Quantity');
    qty.dataset.role = 'qty';
    var row = h('div', 'flex gap-2 items-center', [name, qty]);
    var rm = button('', 'shrink-0 rounded-full p-2 text-slate-400 hover:text-red-700 hover:bg-red-50', function () {
      if ($('items').children.length > 1) row.remove();
    }, 'close');
    rm.setAttribute('aria-label', 'Remove item');
    row.appendChild(rm);
    return row;
  }
  $('add-item').addEventListener('click', function () {
    var row = itemRow(null);
    $('items').appendChild(row);
    row.querySelector('input').focus();
  });

  function collect() {
    var data = {};
    FIELDS.forEach(function (f) { data[f] = $('f-' + f).value; });
    data.items = Array.prototype.map.call($('items').children, function (row) {
      return { name: row.querySelector('[data-role=name]').value, qty: Number(row.querySelector('[data-role=qty]').value) };
    });
    return data;
  }

  function orderView(o) {
    state.order = o;
    state.creating = !o;
    $('orders-list-view').hidden = true;
    $('order-view').hidden = false;
    $('order-form').reset();
    $('order-error').textContent = '';

    FIELDS.forEach(function (f) { $('f-' + f).value = o ? o[f] || '' : ''; });
    if (!o) $('f-deliveryMode').value = 'courier';
    $('items').replaceChildren.apply($('items'), (o ? o.items : [null]).map(itemRow));

    $('order-title').textContent = o ? o.code : 'New order';
    $('order-sub').textContent = o ? 'Created ' + when(o.createdAt) + ' by ' + o.createdBy : 'Create the order once payment is confirmed. The customer can track it as soon as you save.';
    $('order-first').hidden = !!o;
    $('order-live').hidden = !o;
    $('order-save').textContent = o ? 'Save details' : 'Create order';
    $('order-delete').hidden = !o || state.user.role !== 'admin';
    if (!o) {
      $('f-status').value = 'payment_confirmed';
      $('f-customerName').focus();
      return;
    }

    var link = location.origin + '/track/' + o.code;
    $('share-link').value = link;
    $('share-open').href = link;
    var phone = String(o.customerPhone || '').replace(/\D/g, '');
    if (phone.length === 10) phone = '91' + phone;
    var msg = 'Hi ' + (o.customerName.split(' ')[0] || '') + ', thank you for your order with Vybe Technologies. Track it here: ' + link;
    $('share-whatsapp').href = 'https://wa.me/' + (phone.length >= 11 ? phone : '') + '?text=' + encodeURIComponent(msg);

    $('order-status-now').replaceChildren(statusPill(o.status));
    // Suggest the next step on this mode's path; staff can pick anything.
    var flow = (state.meta.modes[o.deliveryMode] || state.meta.modes.other).flow;
    var at = flow.indexOf(o.status);
    $('status-select').value = at >= 0 && at < flow.length - 1 ? flow[at + 1] : o.status;
    $('status-note').value = '';

    var list = h('ol', 'space-y-4');
    o.events.slice().reverse().forEach(function (ev) {
      list.appendChild(h('li', 'flex gap-3 items-start', [
        statusPill(ev.status),
        h('div', 'text-sm', [
          h('p', 'text-xs text-slate-500', when(ev.at) + ' · ' + ev.by),
          ev.note ? h('p', 'mt-1 text-slate-700 whitespace-pre-line', ev.note) : null,
        ]),
      ]));
    });
    $('order-history').replaceChildren(list);
    $('status-undo').hidden = o.events.length < 2;
  }

  $('order-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var data = collect();
    var btn = $('order-save');
    btn.disabled = true;
    $('order-error').textContent = '';
    var req = state.creating
      ? api('POST', 'orders', Object.assign(data, { status: $('f-status').value, note: $('f-note').value }))
      : api('PATCH', 'orders/' + encodeURIComponent(state.order.code), data);
    req.then(function (r) {
      btn.disabled = false;
      if (!r.ok) {
        $('order-error').textContent = r.body.error || 'Could not save.';
        return;
      }
      toast(state.creating ? 'Order created. Share the tracking link with the customer.' : 'Saved.');
      orderView(r.body.order);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  $('status-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('status-submit');
    btn.disabled = true;
    api('POST', 'orders/' + encodeURIComponent(state.order.code) + '/status', { status: $('status-select').value, note: $('status-note').value }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) return toast(r.body.error || 'Could not update.', true);
      toast('Status updated. The customer sees it now.');
      orderView(r.body.order);
    });
  });

  $('status-undo').addEventListener('click', function () {
    var last = state.order.events[state.order.events.length - 1];
    if (!confirm('Undo the latest update (' + (state.meta.statuses[last.status] || {}).label + ')?')) return;
    api('DELETE', 'orders/' + encodeURIComponent(state.order.code) + '/status').then(function (r) {
      if (!r.ok) return toast(r.body.error || 'Could not undo.', true);
      toast('Latest update removed.');
      orderView(r.body.order);
    });
  });

  $('order-delete').addEventListener('click', function () {
    var code = state.order.code;
    if (prompt('This deletes the order and its tracking link for good. Type the code to confirm:\n' + code) !== code) return;
    api('DELETE', 'orders/' + encodeURIComponent(code)).then(function (r) {
      if (!r.ok) return toast(r.body.error || 'Could not delete.', true);
      toast('Order deleted.');
      listView();
    });
  });

  $('share-copy').addEventListener('click', function () {
    var v = $('share-link').value;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(
      function () { toast('Tracking link copied.'); },
      function () { $('share-link').select(); toast('Press Ctrl+C to copy.'); }
    );
  });

  /* ------------------------------------------------------------- staff */

  function tempPassword() {
    var abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var bytes = crypto.getRandomValues(new Uint8Array(14));
    return Array.prototype.map.call(bytes, function (b) { return abc[b % abc.length]; }).join('');
  }

  function revealSecret(email, pass) {
    $('user-secret').hidden = false;
    $('user-secret-text').textContent = email + ' — temporary password: ' + pass;
  }
  $('user-secret-close').addEventListener('click', function () { $('user-secret').hidden = true; });

  $('user-generate').addEventListener('click', function () { $('u-password').value = tempPassword(); });

  $('user-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = { email: $('u-email').value, name: $('u-name').value, role: $('u-role').value, password: $('u-password').value };
    $('user-error').textContent = '';
    api('POST', 'users', body).then(function (r) {
      if (!r.ok) {
        $('user-error').textContent = r.body.error || 'Could not create the account.';
        return;
      }
      revealSecret(r.body.user.email, body.password);
      $('user-form').reset();
      loadUsers();
    });
  });

  function patchUser(email, patch, done) {
    return api('PATCH', 'users?email=' + encodeURIComponent(email), patch).then(function (r) {
      if (!r.ok) {
        toast(r.body.error || 'Could not update the account.', true);
        loadUsers();
        return;
      }
      if (done) done(r.body.user);
      else toast('Saved.');
      loadUsers();
    });
  }

  function loadUsers() {
    api('GET', 'users').then(function (r) {
      if (!r.ok) return;
      var tbody = h('tbody', 'divide-y divide-slate-100');
      r.body.users.forEach(function (u) {
        var self = u.email === state.user.email;
        var locked = u.owner || self;

        var role = h('select', 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold');
        state.meta.roles.forEach(function (k) { role.appendChild(option(k, k, k === u.role)); });
        role.disabled = locked;
        role.setAttribute('aria-label', 'Role for ' + u.email);
        role.addEventListener('change', function () { patchUser(u.email, { role: role.value }); });

        var actions = h('div', 'flex flex-wrap gap-2 justify-end');
        if (!locked) {
          actions.appendChild(button(u.disabled ? 'Enable' : 'Disable', BTN, function () { patchUser(u.email, { disabled: !u.disabled }); }));
        }
        if (!u.owner || self) {
          actions.appendChild(button('Reset password', BTN, function () {
            if (!confirm('Give ' + u.email + ' a new temporary password? They will be signed out everywhere.')) return;
            var pass = tempPassword();
            patchUser(u.email, { password: pass }, function () { revealSecret(u.email, pass); });
          }, 'key'));
        }
        if (!locked) {
          actions.appendChild(button('Delete', BTN_DANGER, function () {
            if (!confirm('Delete the account ' + u.email + '? Their orders stay.')) return;
            api('DELETE', 'users?email=' + encodeURIComponent(u.email)).then(function (r) {
              if (!r.ok) return toast(r.body.error || 'Could not delete.', true);
              toast('Account deleted.');
              loadUsers();
            });
          }, 'delete'));
        }

        var tags = [];
        if (u.owner) tags.push(h('span', 'rounded-full bg-corporate text-white px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider', 'Owner'));
        if (self) tags.push(h('span', 'rounded-full bg-slate-200 text-slate-700 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider', 'You'));
        if (u.disabled) tags.push(h('span', 'rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider', 'Disabled'));
        if (u.mustChangePassword) tags.push(h('span', 'rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider', 'Temp password'));

        tbody.appendChild(h('tr', '', [
          h('td', 'px-4 py-3', [
            h('span', 'block font-bold text-slate-900', u.name || u.email),
            u.name ? h('span', 'block text-xs text-slate-500', u.email) : null,
            tags.length ? h('span', 'mt-1 flex flex-wrap gap-1', tags) : null,
          ]),
          h('td', 'px-4 py-3', role),
          h('td', 'px-4 py-3 text-xs text-slate-500 whitespace-nowrap', u.lastLoginAt ? when(u.lastLoginAt) : 'Never'),
          h('td', 'px-4 py-3', actions),
        ]));
      });
      var head = h('thead', 'bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500', h('tr', '', ['Person', 'Role', 'Last sign-in', ''].map(function (t) { return h('th', 'px-4 py-3 font-bold', t); })));
      $('users-list').replaceChildren(h('div', 'overflow-x-auto', h('table', 'w-full text-sm', [head, tbody])));
    });
  }

  boot();
})();
