/**
 * NotificationCenter – Issue #25
 *
 * Real-time notification system with:
 *  - WebSocket (socket.io) live updates
 *  - Notification categories (appointment, claim, payment, system, medical_record, premium_adjustment)
 *  - Read/unread status management
 *  - Push / email / SMS preference toggles
 *  - Notification preferences panel
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Bell, BellOff, Check, CheckCheck, Trash2, Filter,
  RefreshCw, AlertCircle, Calendar, CreditCard,
  FileText, Activity, Shield, TrendingUp, Settings,
  X,
} from 'lucide-react';

const API_BASE    = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const SOCKET_URL  = (process.env.REACT_APP_API_URL || 'http://localhost:5000/api').replace('/api', '');

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

const TYPE_META = {
  appointment:         { icon: Calendar,   color: 'text-blue-500',   bg: 'bg-blue-50' },
  claim:               { icon: FileText,   color: 'text-purple-500', bg: 'bg-purple-50' },
  payment:             { icon: CreditCard, color: 'text-green-500',  bg: 'bg-green-50' },
  system:              { icon: Shield,     color: 'text-gray-500',   bg: 'bg-gray-50' },
  medical_record:      { icon: Activity,   color: 'text-red-500',    bg: 'bg-red-50' },
  premium_adjustment:  { icon: TrendingUp, color: 'text-orange-500', bg: 'bg-orange-50' },
};

const PRIORITY_BADGE = {
  low:    'bg-gray-100 text-gray-500',
  medium: 'bg-blue-100 text-blue-600',
  high:   'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── NotificationItem ──────────────────────────────────────────────────────────

function NotificationItem({ notification, onMarkRead, onDelete }) {
  const { icon: Icon, color, bg } = TYPE_META[notification.type] || TYPE_META.system;
  return (
    <div
      className={`flex items-start gap-3 p-4 border-b last:border-0 transition-colors ${
        notification.read ? 'bg-white' : 'bg-blue-50/40'
      }`}
    >
      <div className={`p-2 rounded-lg ${bg} flex-shrink-0`}>
        <Icon size={16} className={color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className={`text-sm font-medium truncate ${notification.read ? 'text-gray-700' : 'text-gray-900'}`}>
            {notification.title}
          </p>
          <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${PRIORITY_BADGE[notification.priority] || PRIORITY_BADGE.medium}`}>
            {notification.priority}
          </span>
        </div>
        <p className="text-xs text-gray-500 line-clamp-2">{notification.message}</p>
        <p className="text-xs text-gray-400 mt-1">{timeAgo(notification.created_at)}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!notification.read && (
          <button
            onClick={() => onMarkRead(notification.id)}
            title="Mark as read"
            className="p-1 text-gray-400 hover:text-blue-600 rounded"
          >
            <Check size={14} />
          </button>
        )}
        <button
          onClick={() => onDelete(notification.id)}
          title="Delete"
          className="p-1 text-gray-400 hover:text-red-500 rounded"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── PreferencesPanel ──────────────────────────────────────────────────────────

function PreferencesPanel({ token, userId, onClose }) {
  const [prefs, setPrefs]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState(null);

  useEffect(() => {
    axios
      .get(`${API_BASE}/notifications/preferences`, authHeaders(token))
      .then(({ data }) => setPrefs(data))
      .catch(() => setMsg({ type: 'error', text: 'Failed to load preferences.' }));
  }, [token]);

  const toggle = (channel) => {
    setPrefs((p) => ({ ...p, [channel]: !p[channel] }));
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await axios.put(`${API_BASE}/notifications/preferences`, prefs, authHeaders(token));
      setMsg({ type: 'success', text: 'Preferences saved.' });
    } catch {
      setMsg({ type: 'error', text: 'Failed to save preferences.' });
    } finally {
      setSaving(false);
    }
  };

  const channels = [
    { key: 'in_app_enabled',  label: 'In-App' },
    { key: 'email_enabled',   label: 'Email' },
    { key: 'sms_enabled',     label: 'SMS' },
    { key: 'push_enabled',    label: 'Push' },
  ];

  return (
    <div className="absolute right-0 top-10 z-50 w-72 bg-white rounded-xl shadow-xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800 text-sm">Notification Preferences</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>
      {!prefs ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        <>
          {channels.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer">
              <span className="text-sm text-gray-700">{label} notifications</span>
              <input
                type="checkbox"
                checked={!!prefs[key]}
                onChange={() => toggle(key)}
                className="w-4 h-4 accent-blue-600"
              />
            </label>
          ))}
          {msg && (
            <p className={`text-xs mt-2 ${msg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {msg.text}
            </p>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="mt-3 w-full py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NotificationCenter({ user, token }) {
  const userId = user?.id;

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [filter, setFilter]               = useState({ type: '', read: '' });
  const [showPrefs, setShowPrefs]         = useState(false);
  const [liveAlert, setLiveAlert]         = useState(null);
  const socketRef = useRef(null);

  // ── Fetch notifications ─────────────────────────────────────────────────────

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (filter.type) params.type = filter.type;
      if (filter.read) params.read = filter.read;
      const { data } = await axios.get(`${API_BASE}/notifications`, {
        ...authHeaders(token),
        params,
      });
      const list = data.notifications || data || [];
      setNotifications(list);
      setUnreadCount(list.filter((n) => !n.read).length);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  // ── WebSocket real-time updates ─────────────────────────────────────────────

  useEffect(() => {
    if (!userId || !token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-user-room', userId);
    });

    // New notification pushed from server
    socket.on('notification:new', (notification) => {
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((c) => c + 1);
      // Show a brief live alert banner
      setLiveAlert(notification);
      setTimeout(() => setLiveAlert(null), 5000);
    });

    // Delivery status update
    socket.on('notification:delivered', ({ notificationId }) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, delivered: true } : n))
      );
    });

    return () => { socket.disconnect(); };
  }, [userId, token]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const markRead = async (id) => {
    try {
      await axios.patch(`${API_BASE}/notifications/${id}/read`, {}, authHeaders(token));
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (e) {
      console.error('markRead error', e);
    }
  };

  const markAllRead = async () => {
    try {
      await axios.patch(`${API_BASE}/notifications/read-all`, {}, authHeaders(token));
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error('markAllRead error', e);
    }
  };

  const deleteNotification = async (id) => {
    try {
      await axios.delete(`${API_BASE}/notifications/${id}`, authHeaders(token));
      setNotifications((prev) => {
        const removed = prev.find((n) => n.id === id);
        if (removed && !removed.read) setUnreadCount((c) => Math.max(0, c - 1));
        return prev.filter((n) => n.id !== id);
      });
    } catch (e) {
      console.error('delete error', e);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const types = ['appointment', 'claim', 'payment', 'system', 'medical_record', 'premium_adjustment'];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Live alert banner */}
      {liveAlert && (
        <div className="fixed top-4 right-4 z-50 bg-white border border-blue-200 shadow-lg rounded-xl p-4 max-w-sm flex items-start gap-3 animate-slide-in">
          <Bell size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800">{liveAlert.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{liveAlert.message}</p>
          </div>
          <button onClick={() => setLiveAlert(null)} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">Notifications</h1>
          {unreadCount > 0 && (
            <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            title="Mark all as read"
            className="p-2 text-gray-500 hover:text-blue-600 disabled:opacity-40 rounded-lg hover:bg-gray-100"
          >
            <CheckCheck size={18} />
          </button>
          <button
            onClick={fetchNotifications}
            title="Refresh"
            className="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw size={18} />
          </button>
          <button
            onClick={() => setShowPrefs((v) => !v)}
            title="Preferences"
            className="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-100"
          >
            <Settings size={18} />
          </button>
          {showPrefs && (
            <PreferencesPanel token={token} userId={userId} onClose={() => setShowPrefs(false)} />
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={filter.type}
          onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>
        <select
          value={filter.read}
          onChange={(e) => setFilter((f) => ({ ...f, read: e.target.value }))}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="">All</option>
          <option value="false">Unread</option>
          <option value="true">Read</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="animate-spin text-blue-400" size={28} />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-500 text-sm py-6">
          <AlertCircle size={18} /> {error}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400">
          <BellOff size={40} className="mb-3" />
          <p className="text-sm">No notifications found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          {notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onMarkRead={markRead}
              onDelete={deleteNotification}
            />
          ))}
        </div>
      )}
    </div>
  );
}
