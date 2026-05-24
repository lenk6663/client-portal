/**
 * api.js — shared API client for all portal pages.
 *
 * Stores JWT access/refresh tokens in localStorage.
 * Falls back to cached data if the backend is unreachable.
 * All pages (except ФормаВхода.html) are protected:
 * unauthenticated visitors are redirected to the login page.
 */
(function (window) {
  'use strict';

  var BASE_URL = 'http://localhost:3000';

  // ── Auth helpers ────────────────────────────────────────────

  var Auth = {
    getAccessToken: function () {
      return localStorage.getItem('tppo_access_token');
    },
    getRefreshToken: function () {
      return localStorage.getItem('tppo_refresh_token');
    },
    setTokens: function (access, refresh) {
      localStorage.setItem('tppo_access_token', access);
      if (refresh) localStorage.setItem('tppo_refresh_token', refresh);
    },
    getUser: function () {
      try {
        return JSON.parse(localStorage.getItem('tppo_user') || 'null');
      } catch (e) {
        return null;
      }
    },
    setUser: function (user) {
      if (!user) return;
      localStorage.setItem('tppo_user', JSON.stringify(user));
    },
    clearAll: function () {
      localStorage.removeItem('tppo_access_token');
      localStorage.removeItem('tppo_refresh_token');
      localStorage.removeItem('tppo_user');
      localStorage.removeItem('tppo_tickets_cache');
    },
    isLoggedIn: function () {
      return !!this.getAccessToken();
    },
    getDisplayName: function () {
      var u = this.getUser();
      if (!u) return 'Пользователь';
      if (u.name && u.name !== u.phone) {
        return u.name.split(' ')[0];
      }
      return u.phone || 'Пользователь';
    },
    getFullName: function () {
      var u = this.getUser();
      return (u && u.name) ? u.name : 'Пользователь';
    },
  };

  // ── HTTP client with automatic token refresh ────────────────

  async function apiFetch(method, path, body) {
    var url = BASE_URL + path;
    var headers = { 'Content-Type': 'application/json' };
    var token = Auth.getAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var init = { method: method, headers: headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    var resp = await fetch(url, init);

    if (resp.status === 401 && !path.startsWith('/api/auth/')) {
      var refreshed = await doRefresh();
      if (refreshed) {
        headers['Authorization'] = 'Bearer ' + Auth.getAccessToken();
        resp = await fetch(url, {
          method: method,
          headers: headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } else {
        Auth.clearAll();
        if (!window.location.href.includes('ФормаВхода')) {
          window.location.replace('ФормаВхода.html');
        }
        throw new Error('Не авторизован');
      }
    }

    if (!resp.ok) {
      var errData;
      try { errData = await resp.json(); } catch (e) { errData = {}; }
      throw new Error(errData.message || errData.error || 'Ошибка ' + resp.status);
    }

    return resp.json();
  }

  async function doRefresh() {
    var rt = Auth.getRefreshToken();
    if (!rt) return false;
    try {
      var resp = await fetch(BASE_URL + '/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!resp.ok) return false;
      var data = await resp.json();
      Auth.setTokens(data.access_token, data.refresh_token);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── Local cache helpers ─────────────────────────────────────

  function cacheGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (e) { return null; }
  }

  function cacheSet(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // ── Ticket status maps ──────────────────────────────────────

  var STATUS_LABELS = {
    'new':            'Новый',
    'in_progress':    'В работе',
    'on_approval':    'На согласовании',
    'pending_eval':   'На оценке',
    'pending_client': 'Ожидание клиента',
    'done':           'Завершено',
    'closed':         'Закрыто',
    'cancelled':      'Отменено',
  };

  var STATUS_CSS = {
    'new':            'new',
    'in_progress':    'progress',
    'on_approval':    'approval',
    'pending_eval':   'eval',
    'pending_client': 'progress',
    'done':           'done',
    'closed':         'done',
    'cancelled':      'cancelled',
  };

  // ── Date formatter ──────────────────────────────────────────

  function formatDate(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return String(d.getDate()).padStart(2, '0') + '.' +
           String(d.getMonth() + 1).padStart(2, '0') + '.' +
           d.getFullYear();
  }

  // ── Map API ticket → UI ticket ──────────────────────────────

  function mapTicket(t) {
    if (!t || !t.id) {
      console.error('[mapTicket] ticket without id from API:', t);
      return { id: null, number: '?', subject: '(битый тикет)', services: [], service: '—',
               status: 'new', statusLabel: 'Новый', statusCss: 'new',
               responsible: '—', hours: 0, cost: 0, createdAt: '—', updatedAt: '—',
               urgency: 'medium', description: '', type: 'ticket',
               files: [], approval: null, review: null, history: [], version: 1 };
    }
    var status = t.status_code || 'new';
    var services = Array.isArray(t.services) ? t.services : [];
    return {
      id:          t.id,
      number:      t.ticket_number_1c || t.id.slice(0, 8).toUpperCase(),
      subject:     t.subject || '',
      service:     services[0] || '—',
      services:    services,
      status:      status,
      statusLabel: STATUS_LABELS[status] || status,
      statusCss:   STATUS_CSS[status]    || 'new',
      responsible: t.assigned_operator || '—',
      hours:       Number(t.hours) || 0,
      cost:        Number(t.cost)  || 0,
      createdAt:   formatDate(t.created_at),
      updatedAt:   formatDate(t.updated_at),
      urgency:     t.urgency || 'medium',
      description: t.description || '',
      type:        t.type || 'ticket',
      files:       [],
      approval:    t.approval || null,
      review:      t.review   || null,
      history:     [],
      version:     t.version  || 1,
    };
  }

  // ── UUID generator ──────────────────────────────────────────

  function genUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ── Public API object ───────────────────────────────────────

  window.TPPO = {
    Auth:         Auth,
    formatDate:   formatDate,
    mapTicket:    mapTicket,
    STATUS_LABELS: STATUS_LABELS,
    STATUS_CSS:   STATUS_CSS,

    // ── Auth ──────────────────────────────────────────────────

    requestOtp: async function (phone, password) {
      return apiFetch('POST', '/api/auth/login', { phone: phone, password: password });
    },

    verifyOtp: async function (phone, code) {
      var data = await apiFetch('POST', '/api/auth/verify', { phone: phone, code: code });
      Auth.setTokens(data.access_token, data.refresh_token);
      Auth.setUser(data.user);
      // Очищаем любой устаревший кэш от прежней сессии
      localStorage.removeItem('tppo_tickets_cache');
      return data;
    },

    logout: async function () {
      var rt = Auth.getRefreshToken();
      try {
        if (rt) await apiFetch('POST', '/api/auth/logout', { refresh_token: rt });
      } catch (e) { /* ignore */ }
      Auth.clearAll();
    },

    // ── Tickets ───────────────────────────────────────────────

    getTickets: async function (params) {
      try {
        var qs = params ? '?' + new URLSearchParams(params).toString() : '';
        var data = await apiFetch('GET', '/api/tickets' + qs);
        var tickets = (data.data || []).map(mapTicket);
        cacheSet('tppo_tickets_cache', tickets);
        return tickets;
      } catch (e) {
        console.warn('[TPPO] getTickets fallback to cache:', e.message);
        return cacheGet('tppo_tickets_cache') || [];
      }
    },

    getTicket: async function (id) {
      try {
        var t = await apiFetch('GET', '/api/tickets/' + id);
        return { mapped: mapTicket(t), raw: t };
      } catch (e) {
        console.warn('[TPPO] getTicket fallback to cache:', e.message);
        var list = cacheGet('tppo_tickets_cache') || [];
        var cached = list.find(function (x) { return x.id === id; });
        return cached ? { mapped: cached, raw: cached } : null;
      }
    },

    createTicket: async function (data) {
      var t = await apiFetch('POST', '/api/tickets', data);
      localStorage.removeItem('tppo_tickets_cache');
      return { mapped: mapTicket(t), raw: t };
    },

    updateTicket: async function (id, data) {
      var t = await apiFetch('PUT', '/api/tickets/' + id, data);
      localStorage.removeItem('tppo_tickets_cache');
      return { mapped: mapTicket(t), raw: t };
    },

    getTicketHistory: async function (id) {
      try {
        return await apiFetch('GET', '/api/tickets/' + id + '/history');
      } catch (e) {
        return [];
      }
    },

    // ── Messages ──────────────────────────────────────────────

    getMessages: async function (ticketId) {
      try {
        return await apiFetch('GET', '/api/tickets/' + ticketId + '/messages');
      } catch (e) {
        return [];
      }
    },

    sendMessage: async function (ticketId, text) {
      return apiFetch('POST', '/api/tickets/' + ticketId + '/messages', {
        text:       text,
        message_id: genUUID(),
      });
    },

    // ── User ──────────────────────────────────────────────────

    getProfile: async function () {
      try {
        var p = await apiFetch('GET', '/api/users/profile');
        Auth.setUser(p);
        return p;
      } catch (e) {
        return Auth.getUser();
      }
    },

    updateProfile: async function (data) {
      var updated = await apiFetch('PUT', '/api/users/profile', data);
      Auth.setUser(updated);
      return updated;
    },

    changePassword: async function (oldPassword, newPassword) {
      var payload = { new_password: newPassword };
      if (oldPassword) payload.old_password = oldPassword;
      return apiFetch('PUT', '/api/users/password', payload);
    },

    getNotifSettings: async function () {
      try {
        return await apiFetch('GET', '/api/users/notification-settings');
      } catch (e) {
        return {};
      }
    },

    updateNotifSettings: async function (data) {
      return apiFetch('PUT', '/api/users/notification-settings', data);
    },

    // ── Dictionaries ──────────────────────────────────────────

    getServices: async function () {
      try {
        return await apiFetch('GET', '/api/dictionaries/services');
      } catch (e) {
        return [];
      }
    },
  };

  // ── Auth guard: redirect to login if not authenticated ──────
  // (runs on every page except the login page itself)
  (function () {
    var href = window.location.href;
    var isLogin = href.includes('%D0%A4%D0%BE%D1%80%D0%BC%D0%B0%D0%92%D1%85%D0%BE%D0%B4%D0%B0') ||
                  href.includes('ФормаВхода');
    if (!isLogin && !Auth.isLoggedIn()) {
      window.location.replace('ФормаВхода.html');
    }
  })();

}(window));
