/*
 * The admin panel behind /vyb-admin/: orders, certificates, the blog and
 * staff. The page's HTML (built in build.js) carries every form; this file
 * signs staff in, fills the lists, and talks to
 * /api/*. Nothing here is trusted: the API checks the session and the role on
 * every call, so hiding the Staff tab from a `user` is tidiness, not security.
 *
 * The session is an HttpOnly cookie scoped to /api, so this script never sees
 * it and nothing it renders could leak it. Markup goes in via textContent.
 *
 * material-symbols-outlined: add, delete, content_copy, open_in_new, chat, undo, arrow_back, refresh, logout, key, person_add, close, check_circle, cancel, warning, upload, image, visibility, rocket_launch
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
    ['orders', 'certs', 'blog', 'staff'].forEach(function (t) {
      $('panel-' + t).hidden = t !== name;
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('tab-' + t).className = 'px-5 py-2.5 rounded-full text-sm font-bold transition-colors ' + (t === name ? 'bg-corporate text-white' : 'text-slate-600 hover:text-brand');
    });
    if (name === 'orders') listView();
    if (name === 'staff') loadUsers();
    if (name === 'certs') certListView();
    if (name === 'blog') blogTab('posts');
  }
  $('tab-orders').addEventListener('click', function () { tab('orders'); });
  $('tab-certs').addEventListener('click', function () { tab('certs'); });
  $('tab-blog').addEventListener('click', function () { tab('blog'); });
  $('tab-staff').addEventListener('click', function () { tab('staff'); });

  function fillSelects() {
    var modes = state.meta.modes;
    var mode = $('f-deliveryMode');
    mode.replaceChildren();
    Object.keys(modes).forEach(function (k) { mode.appendChild(option(k, modes[k].label)); });
    var pay = $('f-payment');
    pay.replaceChildren();
    Object.keys(state.meta.payments).forEach(function (k) { pay.appendChild(option(k, state.meta.payments[k].label)); });
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
          h('td', 'px-4 py-3', [
            statusPill(o.status),
            o.payment !== 'prepaid' && !o.paid
              ? h('span', 'block mt-1 text-xs font-bold text-amber-700 whitespace-nowrap', (o.payment === 'cod' ? 'COD' : 'Credit') + (o.amount ? ' ' + rupees(o.amount) : '') + ' unpaid')
              : null,
          ]),
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

  var FIELDS = ['customerName', 'customerPhone', 'customerEmail', 'address', 'reference', 'deliveryMode', 'partner', 'partnerRef', 'partnerUrl', 'expectedBy', 'payment', 'amount', 'dueBy', 'publicNote', 'internalNote'];

  /* Prepaid needs none of the payment fields; credit is the only one with a
     due date. On a new order the starting status follows the payment type
     until staff pick one themselves. */
  var startTouched = false;
  function paymentChanged() {
    var p = $('f-payment').value;
    $('f-amount-wrap').hidden = p === 'prepaid';
    $('f-dueBy-wrap').hidden = p !== 'credit';
    $('f-paid-wrap').hidden = p === 'prepaid';
    if (state.creating && !startTouched) $('f-status').value = p === 'prepaid' ? 'payment_confirmed' : 'order_confirmed';
  }
  $('f-payment').addEventListener('change', paymentChanged);
  $('f-status').addEventListener('change', function () { startTouched = true; });

  function rupees(a) {
    return '₹' + Number(a).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

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
    data.paid = $('f-paid').checked;
    if (data.payment === 'prepaid') {
      data.amount = '';
      data.dueBy = '';
    }
    if (data.payment !== 'credit') data.dueBy = '';
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
    if (!o) {
      $('f-deliveryMode').value = 'courier';
      $('f-payment').value = 'prepaid';
    }
    $('f-paid').checked = !!(o && o.paid && o.payment !== 'prepaid');
    startTouched = false;
    $('items').replaceChildren.apply($('items'), (o ? o.items : [null]).map(itemRow));

    $('order-title').textContent = o ? o.code : 'New order';
    $('order-sub').textContent = o ? 'Created ' + when(o.createdAt) + ' by ' + o.createdBy : 'Create the order once it is paid for, or agreed as cash on delivery or credit. The customer can track it as soon as you save.';
    $('order-first').hidden = !!o;
    $('order-live').hidden = !o;
    $('order-save').textContent = o ? 'Save details' : 'Create order';
    $('order-delete').hidden = !o || state.user.role !== 'admin';
    paymentChanged();
    if (!o) {
      $('f-customerName').focus();
      return;
    }

    var link = location.origin + '/track/' + o.code;
    $('share-link').value = link;
    $('share-open').href = link;
    var phone = String(o.customerPhone || '').replace(/\D/g, '');
    if (phone.length === 10) phone = '91' + phone;
    var msg = 'Hi ' + (o.customerName.split(' ')[0] || '') + ', thank you for your order with Vybe Technologies. Track it here: ' + link;
    if (o.payment === 'cod' && !o.paid && o.amount) msg += '\nPlease keep ' + rupees(o.amount) + ' ready to pay on delivery.';
    if (o.payment === 'credit' && !o.paid && o.amount) msg += '\nAmount due: ' + rupees(o.amount) + (o.dueBy ? ', by ' + o.dueBy : '') + '.';
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

  /* ------------------------------------------------------------ uploads */

  /** Upload a picked file to /api/media and resolve with its URL. */
  function upload(file) {
    if (!file) return Promise.reject(new Error('No file chosen.'));
    if (file.size > 6 * 1024 * 1024) return Promise.reject(new Error('Files can be 6 MB at most.'));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsDataURL(file);
    }).then(function (data) {
      toast('Uploading ' + file.name + '…');
      return api('POST', 'media', { name: file.name, data: data }).then(function (r) {
        if (!r.ok) throw new Error(r.body.error || 'Upload failed.');
        return r.body.url;
      });
    });
  }

  function onFile(input, done) {
    input.addEventListener('change', function () {
      var file = input.files[0];
      input.value = '';
      upload(file).then(done, function (e) { toast(e.message, true); });
    });
  }

  function thumb(url, cls) {
    if (!url) return null;
    var img = h('img', cls || 'max-h-40 rounded-xl border border-slate-200');
    img.src = url;
    img.alt = '';
    return img;
  }

  /* ------------------------------------------------------- certificates */

  var certs = [];

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function certPill(c) {
    var label = c.status === 'withdrawn' ? 'Withdrawn' : c.expires < today() ? 'Expired' : 'Valid';
    var tone = label === 'Valid' ? 'bg-emerald-100 text-emerald-900' : label === 'Expired' ? 'bg-rose-100 text-rose-900' : 'bg-amber-100 text-amber-900';
    var wrap = h('span', 'flex flex-wrap gap-1', [h('span', 'rounded-full px-3 py-1 text-xs font-bold ' + tone, label)]);
    if (c.specimen) wrap.appendChild(h('span', 'rounded-full px-3 py-1 text-xs font-bold bg-slate-200 text-slate-700', 'Specimen'));
    return wrap;
  }

  function certListView() {
    $('certs-list-view').hidden = false;
    $('cert-form').hidden = true;
    api('GET', 'certs').then(function (r) {
      if (!r.ok) return;
      certs = r.body.certificates;
      renderCerts();
    });
  }

  function renderCerts() {
    var q = $('certs-q').value.trim().toLowerCase();
    var rows = certs.filter(function (c) {
      return !q || [c.number, c.holder, c.standard, c.scheme].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) {
      $('certs-list').replaceChildren(h('p', 'p-8 text-center text-sm text-slate-500', q ? 'No certificates match.' : 'The register is empty.'));
      return;
    }
    var tbody = h('tbody', 'divide-y divide-slate-100');
    rows.forEach(function (c) {
      var tr = h('tr', 'hover:bg-slate-50 cursor-pointer', [
        h('td', 'px-4 py-3 font-bold text-slate-900 whitespace-nowrap', c.number),
        h('td', 'px-4 py-3 text-slate-700', c.holder),
        h('td', 'px-4 py-3 text-slate-600 whitespace-nowrap', c.standard),
        h('td', 'px-4 py-3 text-slate-600 whitespace-nowrap', c.expires),
        h('td', 'px-4 py-3', certPill(c)),
      ]);
      tr.tabIndex = 0;
      tr.addEventListener('click', function () { certView(c); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') certView(c); });
      tbody.appendChild(tr);
    });
    var head = h('thead', 'bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500', h('tr', '', ['Number', 'Holder', 'Standard', 'Expires', 'Status'].map(function (t) { return h('th', 'px-4 py-3 font-bold', t); })));
    $('certs-list').replaceChildren(h('div', 'overflow-x-auto', h('table', 'w-full text-sm', [head, tbody])));
  }
  $('certs-q').addEventListener('input', renderCerts);

  var CERT_FIELDS = ['number', 'holder', 'address', 'scheme', 'standard', 'scope', 'initial', 'issued', 'expires', 'status', 'pdf', 'internalNote'];
  var editingCert = null;

  function certView(c) {
    editingCert = c;
    $('certs-list-view').hidden = true;
    $('cert-form').hidden = false;
    $('cert-error').textContent = '';
    CERT_FIELDS.forEach(function (f) { $('c-' + f).value = c ? c[f] || '' : ''; });
    $('c-specimen').checked = !!(c && c.specimen);
    if (!c) {
      $('c-status').value = 'active';
      $('c-issued').value = today();
    }
    $('c-number').readOnly = !!c;
    $('cert-title').textContent = c ? c.number : 'Issue a certificate';
    $('cert-open').hidden = !c;
    if (c) $('cert-open').href = '/verify/?cert=' + encodeURIComponent(c.number);
    $('cert-delete').hidden = !c || state.user.role !== 'admin';
    $(c ? 'c-holder' : 'c-number').focus();
  }

  $('btn-new-cert').addEventListener('click', function () { certView(null); });
  $('cert-back').addEventListener('click', certListView);
  onFile($('c-pdf-file'), function (url) {
    $('c-pdf').value = url;
    toast('PDF uploaded. Save to attach it.');
  });

  $('cert-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    CERT_FIELDS.forEach(function (f) { data[f] = $('c-' + f).value; });
    data.specimen = $('c-specimen').checked;
    $('cert-error').textContent = '';
    var req = editingCert
      ? api('PATCH', 'certs?number=' + encodeURIComponent(editingCert.number), data)
      : api('POST', 'certs', data);
    req.then(function (r) {
      if (!r.ok) {
        $('cert-error').textContent = r.body.error || 'Could not save.';
        return;
      }
      toast(editingCert ? 'Saved. /verify/ shows the change now.' : 'Issued. ' + r.body.certificate.number + ' verifies now.');
      certView(r.body.certificate);
    });
  });

  $('cert-delete').addEventListener('click', function () {
    var n = editingCert.number;
    if (prompt('Deleting removes ' + n + ' from the register for good, and the number will verify as unknown.\nTo revoke it instead, set the status to Withdrawn.\n\nType the number to delete it anyway:') !== n) return;
    api('DELETE', 'certs?number=' + encodeURIComponent(n)).then(function (r) {
      if (!r.ok) return toast(r.body.error || 'Could not delete.', true);
      toast('Deleted.');
      certListView();
    });
  });

  /* --------------------------------------------------------------- blog */

  var authors = [];
  var editingPost = null;

  function blogTab(which) {
    $('posts-list-view').hidden = which !== 'posts';
    $('post-form').hidden = true;
    $('authors-view').hidden = which !== 'authors';
    ['posts', 'authors'].forEach(function (t) {
      $('blog-tab-' + t).classList.toggle('!bg-corporate', t === which);
      $('blog-tab-' + t).classList.toggle('!text-white', t === which);
    });
    loadAuthors().then(function () {
      if (which === 'posts') loadPosts();
      else renderAuthors();
    });
  }
  $('blog-tab-posts').addEventListener('click', function () { blogTab('posts'); });
  $('blog-tab-authors').addEventListener('click', function () { blogTab('authors'); });

  $('blog-deploy').addEventListener('click', function () {
    var btn = $('blog-deploy');
    btn.disabled = true;
    api('POST', 'blog/deploy', {}).then(function (r) {
      btn.disabled = false;
      toast(r.ok ? r.body.message : r.body.error || 'Could not start a rebuild.', !r.ok || !r.body.dispatched);
    });
  });

  function loadAuthors() {
    return api('GET', 'blog/authors').then(function (r) {
      if (r.ok) authors = r.body.authors;
    });
  }
  function authorName(slug) {
    for (var i = 0; i < authors.length; i++) if (authors[i].slug === slug) return authors[i].name;
    return '';
  }

  function postState(p) {
    if (p.status !== 'published') return { label: 'Draft', tone: 'bg-slate-200 text-slate-700' };
    if (Date.parse(p.publishedAt) > Date.now()) return { label: 'Scheduled ' + when(p.publishedAt), tone: 'bg-amber-100 text-amber-900' };
    return { label: 'Published', tone: 'bg-emerald-100 text-emerald-900' };
  }
  function statePill(p) {
    var s = postState(p);
    return h('span', 'inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ' + s.tone, s.label);
  }

  function loadPosts() {
    api('GET', 'blog/posts').then(function (r) {
      if (!r.ok) return;
      if (!r.body.posts.length) {
        $('posts-list').replaceChildren(h('p', 'p-8 text-center text-sm text-slate-500', 'No posts yet. Add an author first, then write the first post.'));
        return;
      }
      var tbody = h('tbody', 'divide-y divide-slate-100');
      r.body.posts.forEach(function (p) {
        var tr = h('tr', 'hover:bg-slate-50 cursor-pointer', [
          h('td', 'px-4 py-3', [h('span', 'block font-bold text-slate-900', p.title || '(untitled)'), h('span', 'block text-xs text-slate-500', '/blogs/' + p.slug + '/')]),
          h('td', 'px-4 py-3', statePill(p)),
          h('td', 'px-4 py-3 text-slate-600 whitespace-nowrap', authorName(p.author) || '—'),
          h('td', 'px-4 py-3 text-slate-600 tabular-nums', String(p.words)),
          h('td', 'px-4 py-3 text-xs text-slate-500 whitespace-nowrap', when(p.editedAt || p.createdAt)),
        ]);
        tr.tabIndex = 0;
        var open = function () { openPost(p.slug); };
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
        tbody.appendChild(tr);
      });
      var head = h('thead', 'bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500', h('tr', '', ['Post', 'Status', 'Author', 'Words', 'Edited'].map(function (t) { return h('th', 'px-4 py-3 font-bold', t); })));
      $('posts-list').replaceChildren(h('div', 'overflow-x-auto', h('table', 'w-full text-sm', [head, tbody])));
    });
  }

  function openPost(slug) {
    api('GET', 'blog/posts/' + encodeURIComponent(slug)).then(function (r) {
      if (r.ok) postView(r.body.post);
      else toast(r.body.error || 'Could not open that post.', true);
    });
  }

  function slugify(s) {
    var out = String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (out.length > 60) out = out.slice(0, 60).replace(/-[^-]*$/, '');
    return out;
  }

  // datetime-local speaks the browser's local time; the API speaks ISO.
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(v) {
    return v ? new Date(v).toISOString() : '';
  }

  var POST_FIELDS = ['title', 'slug', 'seoTitle', 'description', 'author', 'tags', 'cover', 'coverAlt', 'body'];
  var slugTouched = false;

  function postView(p) {
    editingPost = p;
    $('posts-list-view').hidden = true;
    $('authors-view').hidden = true;
    $('post-form').hidden = false;
    $('post-error').textContent = '';

    var sel = $('p-author');
    sel.replaceChildren(option('', 'Choose an author'));
    authors.forEach(function (a) { sel.appendChild(option(a.slug, a.name)); });

    POST_FIELDS.forEach(function (f) {
      var v = p ? p[f] : '';
      $('p-' + f).value = f === 'tags' && p ? p.tags.join(', ') : v || '';
    });
    $('p-publishedAt').value = p ? toLocalInput(p.publishedAt) : '';
    $('p-slug').readOnly = !!p;
    slugTouched = !!p;
    $('p-preview').hidden = true;

    var published = p && p.status === 'published';
    $('post-heading').textContent = p ? p.title || p.slug : 'New post';
    $('post-state').replaceChildren(p ? statePill(p) : statePill({ status: 'draft' }));
    $('post-save').textContent = published ? 'Save changes' : 'Save draft';
    $('post-publish').hidden = published;
    $('post-unpublish').hidden = !published;
    $('post-view').hidden = !published || Date.parse(p.publishedAt) > Date.now();
    if (p) $('post-view').href = '/blogs/' + p.slug + '/';
    $('post-delete').hidden = !p || state.user.role !== 'admin';
    coverPreview();
    seo();
    window.scrollTo({ top: 0 });
    $('p-title').focus();
  }

  $('btn-new-post').addEventListener('click', function () {
    if (!authors.length) toast('Tip: add an author under Authors first. Posts need one to publish.');
    postView(null);
  });
  $('post-back').addEventListener('click', function () { blogTab('posts'); });

  $('p-title').addEventListener('input', function () {
    if (!slugTouched) $('p-slug').value = slugify($('p-title').value);
    seo();
  });
  $('p-slug').addEventListener('input', function () { slugTouched = true; seo(); });
  ['p-seoTitle', 'p-description', 'p-author', 'p-coverAlt', 'p-tags'].forEach(function (id) {
    $(id).addEventListener('input', seo);
  });

  function coverPreview() {
    $('p-cover-preview').replaceChildren(thumb($('p-cover').value) || h('p', 'text-xs text-slate-400', 'No cover image.'));
  }
  onFile($('p-cover-file'), function (url) {
    $('p-cover').value = url;
    coverPreview();
    seo();
    $('p-coverAlt').focus();
    toast('Cover uploaded. Describe it in the alt text, then save.');
  });
  $('p-cover-clear').addEventListener('click', function () {
    $('p-cover').value = '';
    $('p-coverAlt').value = '';
    coverPreview();
    seo();
  });

  onFile($('p-body-image'), function (url) {
    var ta = $('p-body');
    var at = ta.selectionStart;
    var alt = 'describe the image';
    var snippet = '\n\n![' + alt + '](' + url + ')\n\n';
    ta.value = ta.value.slice(0, at) + snippet + ta.value.slice(ta.selectionEnd);
    ta.focus();
    // Select the placeholder so typing replaces it.
    ta.setSelectionRange(at + 4, at + 4 + alt.length);
    bodyChanged();
  });

  /* Live preview: the API renders it with the same code the build uses. */
  var previewTimer;
  function refreshPreview() {
    if ($('p-preview').hidden) return;
    api('POST', 'blog/preview', { body: $('p-body').value }).then(function (r) {
      // Server-rendered from markdown with every character escaped; no raw HTML gets through.
      if (r.ok) $('p-preview').innerHTML = r.body.html || '<p>Nothing to preview yet.</p>';
    });
  }
  function bodyChanged() {
    seo();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 500);
  }
  $('p-body').addEventListener('input', bodyChanged);
  $('p-preview-toggle').addEventListener('click', function () {
    $('p-preview').hidden = !$('p-preview').hidden;
    refreshPreview();
  });

  function words(s) {
    var m = String(s).replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\]\([^)]*\)/g, ' ').match(/[\p{L}\p{N}]+/gu);
    return m ? m.length : 0;
  }

  /** The checklist beside the editor. Red blocks publishing on the server too; amber is advice. */
  function seo() {
    var title = $('p-seoTitle').value.trim() || $('p-title').value.trim();
    var desc = $('p-description').value.trim();
    var body = $('p-body').value;
    var n = words(body);
    var h2 = (body.match(/^#{1,2}\s+\S/gm) || []).length;
    var imgs = body.match(/!\[[^\]]*\]\([^)]+\)/g) || [];
    var noAlt = imgs.filter(function (i) { return /^!\[\s*(describe the image)?\s*\]/.test(i); }).length;
    var internal = /\]\((\/(?!api\/)|https:\/\/vybe\.net\.in)/.test(body);
    var slug = $('p-slug').value;

    $('p-description-count').textContent = '(' + desc.length + '/160)';
    $('p-words').textContent = '(' + n + ' words, ~' + Math.max(1, Math.round(n / 200)) + ' min read)';
    $('serp-slug').textContent = slug;
    $('serp-title').textContent = (title || 'Post title') + (title.length + 22 <= 70 ? ' | Vybe Technologies' : '');
    $('serp-desc').textContent = desc || 'Write a meta description: this is the text people read before deciding to click.';

    var checks = [
      [title.length >= 20 && title.length <= 60 ? 'ok' : title ? 'warn' : 'bad', 'Title of 20–60 characters (now ' + title.length + ')'],
      [desc.length >= 120 && desc.length <= 160 ? 'ok' : desc.length >= 50 ? 'warn' : 'bad', 'Meta description of 120–160 characters'],
      [$('p-author').value ? 'ok' : 'bad', 'Author chosen'],
      [n >= 600 ? 'ok' : n >= 150 ? 'warn' : 'bad', 'Substantial body: 600+ words is ideal, 150 is the minimum'],
      [h2 >= 2 ? 'ok' : 'warn', 'Two or more ## section headings'],
      [!$('p-cover').value ? 'warn' : $('p-coverAlt').value.trim() ? 'ok' : 'bad', 'Cover image, with alt text'],
      [noAlt ? 'bad' : 'ok', 'Every image in the body is described (' + imgs.length + ' image' + (imgs.length === 1 ? '' : 's') + ')'],
      [internal ? 'ok' : 'warn', 'Links to at least one other page on vybe.net.in'],
      [slug && slug.length <= 60 ? 'ok' : 'warn', 'Short, readable URL'],
    ];
    var ICON = { ok: ['check_circle', 'text-emerald-600'], warn: ['warning', 'text-amber-500'], bad: ['cancel', 'text-red-600'] };
    $('seo-checks').replaceChildren.apply(
      $('seo-checks'),
      checks.map(function (c) {
        return h('li', 'flex gap-2 items-start', [icon(ICON[c[0]][0], 'text-[18px] shrink-0 ' + ICON[c[0]][1]), h('span', 'text-slate-700', c[1])]);
      })
    );
  }

  function collectPost() {
    var d = {};
    POST_FIELDS.forEach(function (f) { d[f] = $('p-' + f).value; });
    if (editingPost && editingPost.status === 'published') d.publishedAt = fromLocalInput($('p-publishedAt').value);
    return d;
  }

  function savePost() {
    $('post-error').textContent = '';
    var data = collectPost();
    if (editingPost) delete data.slug; // fixed at creation
    var req = editingPost ? api('PATCH', 'blog/posts/' + encodeURIComponent(editingPost.slug), data) : api('POST', 'blog/posts', data);
    return req.then(function (r) {
      if (!r.ok) {
        $('post-error').textContent = r.body.error || 'Could not save.';
        return null;
      }
      editingPost = r.body.post;
      return r.body.post;
    });
  }

  $('post-form').addEventListener('submit', function (e) {
    e.preventDefault();
    savePost().then(function (p) {
      if (!p) return;
      toast(p.status === 'published' ? 'Saved. Live after the next site build.' : 'Draft saved.');
      postView(p);
    });
  });

  $('post-publish').addEventListener('click', function () {
    var at = fromLocalInput($('p-publishedAt').value);
    savePost().then(function (p) {
      if (!p) return;
      return api('POST', 'blog/posts/' + encodeURIComponent(p.slug) + '/publish', { publishedAt: at }).then(function (r) {
        if (!r.ok) {
          $('post-error').textContent = r.body.error || 'Could not publish.';
          postView(p);
          $('post-error').textContent = r.body.error || 'Could not publish.';
          return;
        }
        var scheduled = Date.parse(r.body.post.publishedAt) > Date.now();
        toast(scheduled ? 'Scheduled for ' + when(r.body.post.publishedAt) + '.' : 'Published. Use “Rebuild site now” to put it live immediately.');
        postView(r.body.post);
      });
    });
  });

  $('post-unpublish').addEventListener('click', function () {
    if (!confirm('Take this post off the site at the next build? It stays here as a draft.')) return;
    api('POST', 'blog/posts/' + encodeURIComponent(editingPost.slug) + '/unpublish', {}).then(function (r) {
      if (!r.ok) return toast(r.body.error || 'Could not unpublish.', true);
      toast('Back to draft. It leaves the site at the next build.');
      postView(r.body.post);
    });
  });

  $('post-delete').addEventListener('click', function () {
    var slug = editingPost.slug;
    if (prompt('Delete this post for good? If it is live, its URL will 404 after the next build.\nType the URL slug to confirm:\n' + slug) !== slug) return;
    api('DELETE', 'blog/posts/' + encodeURIComponent(slug)).then(function (r) {
      if (!r.ok) return toast(r.body.error || 'Could not delete.', true);
      toast('Post deleted.');
      blogTab('posts');
    });
  });

  /* ------------------------------------------------------------ authors */

  var editingAuthor = null;
  var AUTHOR_FIELDS = ['name', 'jobTitle', 'bio', 'photo', 'card'];

  function renderAuthors() {
    if (!authors.length) {
      $('authors-list').replaceChildren(h('p', 'p-8 text-center text-sm text-slate-500', 'No authors yet. Add the first below.'));
    } else {
      var tbody = h('tbody', 'divide-y divide-slate-100');
      authors.forEach(function (a) {
        var actions = h('div', 'flex gap-2 justify-end', [button('Edit', BTN, function () { authorForm(a); })]);
        if (state.user.role === 'admin') {
          actions.appendChild(button('Delete', BTN_DANGER, function () {
            if (!confirm('Delete ' + a.name + '?')) return;
            api('DELETE', 'blog/authors/' + encodeURIComponent(a.slug)).then(function (r) {
              if (!r.ok) return toast(r.body.error || 'Could not delete.', true);
              toast('Author deleted.');
              loadAuthors().then(renderAuthors);
            });
          }, 'delete'));
        }
        tbody.appendChild(h('tr', '', [
          h('td', 'px-4 py-3 w-14', thumb(a.photo, 'w-10 h-10 rounded-full object-cover border border-slate-200')),
          h('td', 'px-4 py-3', [h('span', 'block font-bold text-slate-900', a.name), h('span', 'block text-xs text-slate-500', (a.jobTitle ? a.jobTitle + ' · ' : '') + '/blogs/authors/' + a.slug + '/')]),
          h('td', 'px-4 py-3', actions),
        ]));
      });
      $('authors-list').replaceChildren(h('div', 'overflow-x-auto', h('table', 'w-full text-sm', tbody)));
    }
    authorForm(null);
  }

  function authorForm(a) {
    editingAuthor = a;
    $('author-error').textContent = '';
    AUTHOR_FIELDS.forEach(function (f) { $('a-' + f).value = a ? a[f] || '' : ''; });
    $('a-sameAs').value = a ? a.sameAs.join('\n') : '';
    $('author-heading').textContent = a ? 'Edit ' + a.name : 'Add an author';
    $('a-photo-preview').replaceChildren(thumb($('a-photo').value, 'w-20 h-20 rounded-full object-cover border border-slate-200') || h('p', 'text-xs text-slate-400', 'No photo.'));
    if (a) $('a-name').focus();
  }
  $('author-cancel').addEventListener('click', function () { authorForm(null); });
  onFile($('a-photo-file'), function (url) {
    $('a-photo').value = url;
    $('a-photo-preview').replaceChildren(thumb(url, 'w-20 h-20 rounded-full object-cover border border-slate-200'));
  });

  $('author-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = {};
    AUTHOR_FIELDS.forEach(function (f) { d[f] = $('a-' + f).value; });
    d.sameAs = $('a-sameAs').value.split(/\s+/).filter(Boolean);
    var req = editingAuthor ? api('PATCH', 'blog/authors/' + encodeURIComponent(editingAuthor.slug), d) : api('POST', 'blog/authors', d);
    req.then(function (r) {
      if (!r.ok) {
        $('author-error').textContent = r.body.error || 'Could not save.';
        return;
      }
      toast('Author saved.');
      loadAuthors().then(renderAuthors);
    });
  });

  boot();
})();
