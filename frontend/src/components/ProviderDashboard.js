/**
 * ProviderDashboard – Issue #26
 *
 * Comprehensive provider dashboard with:
 *  - Patient roster
 *  - Appointment calendar
 *  - Revenue analytics
 *  - Performance metrics
 *  - Patient communication tools
 *  - Document management
 *  - Prescription management
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Users, Calendar, DollarSign, Activity, FileText,
  Search, ChevronRight, RefreshCw, AlertCircle,
  CheckCircle, Clock, TrendingUp, Pill, Upload,
} from 'lucide-react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function fmtCurrency(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="bg-white rounded-xl shadow p-5 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${colors[color]}`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    scheduled:  'bg-blue-100 text-blue-700',
    confirmed:  'bg-green-100 text-green-700',
    completed:  'bg-gray-100 text-gray-600',
    cancelled:  'bg-red-100 text-red-600',
    approved:   'bg-green-100 text-green-700',
    paid:       'bg-emerald-100 text-emerald-700',
    pending:    'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProviderDashboard({ user, token }) {
  const providerId = user?.providerId || user?.id;

  const [tab, setTab]                   = useState('overview');
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);

  // Data state
  const [stats, setStats]               = useState({});
  const [recentAppts, setRecentAppts]   = useState([]);
  const [patients, setPatients]         = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [revenue, setRevenue]           = useState({ monthly: [], claimStats: {} });

  // UI state
  const [patientSearch, setPatientSearch] = useState('');
  const [apptFilter, setApptFilter]       = useState('');

  // Prescription form
  const [rxForm, setRxForm] = useState({ patientId: '', medication: '', dosage: '', duration: '', notes: '' });
  const [rxMsg, setRxMsg]   = useState(null);

  // Document form
  const [docForm, setDocForm] = useState({ patientId: '', documentType: '', ipfsHash: '', description: '' });
  const [docMsg, setDocMsg]   = useState(null);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchDashboard = useCallback(async () => {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(
        `${API_BASE}/providers/dashboard/${providerId}`,
        authHeaders(token)
      );
      setStats(data.stats || {});
      setRecentAppts(data.recentAppointments || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [providerId, token]);

  const fetchPatients = useCallback(async () => {
    if (!providerId) return;
    try {
      const { data } = await axios.get(
        `${API_BASE}/providers/${providerId}/patients`,
        { ...authHeaders(token), params: { search: patientSearch, limit: 50 } }
      );
      setPatients(data.patients || []);
    } catch (e) {
      console.error('patients fetch error', e);
    }
  }, [providerId, token, patientSearch]);

  const fetchAppointments = useCallback(async () => {
    if (!providerId) return;
    try {
      const params = apptFilter ? { status: apptFilter } : {};
      const { data } = await axios.get(
        `${API_BASE}/providers/${providerId}/appointments`,
        { ...authHeaders(token), params }
      );
      setAppointments(data.appointments || []);
    } catch (e) {
      console.error('appointments fetch error', e);
    }
  }, [providerId, token, apptFilter]);

  const fetchRevenue = useCallback(async () => {
    if (!providerId) return;
    try {
      const { data } = await axios.get(
        `${API_BASE}/providers/${providerId}/revenue`,
        authHeaders(token)
      );
      setRevenue(data);
    } catch (e) {
      console.error('revenue fetch error', e);
    }
  }, [providerId, token]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);
  useEffect(() => { if (tab === 'patients')      fetchPatients(); },     [tab, fetchPatients]);
  useEffect(() => { if (tab === 'appointments')  fetchAppointments(); }, [tab, fetchAppointments]);
  useEffect(() => { if (tab === 'revenue')       fetchRevenue(); },      [tab, fetchRevenue]);

  // ── Prescription submit ─────────────────────────────────────────────────────

  const submitPrescription = async (e) => {
    e.preventDefault();
    setRxMsg(null);
    try {
      await axios.post(
        `${API_BASE}/providers/${providerId}/prescriptions`,
        rxForm,
        authHeaders(token)
      );
      setRxMsg({ type: 'success', text: 'Prescription created successfully.' });
      setRxForm({ patientId: '', medication: '', dosage: '', duration: '', notes: '' });
    } catch (e) {
      setRxMsg({ type: 'error', text: e.response?.data?.error || 'Failed to create prescription.' });
    }
  };

  // ── Document submit ─────────────────────────────────────────────────────────

  const submitDocument = async (e) => {
    e.preventDefault();
    setDocMsg(null);
    try {
      await axios.post(
        `${API_BASE}/providers/${providerId}/documents`,
        docForm,
        authHeaders(token)
      );
      setDocMsg({ type: 'success', text: 'Document reference stored.' });
      setDocForm({ patientId: '', documentType: '', ipfsHash: '', description: '' });
    } catch (e) {
      setDocMsg({ type: 'error', text: e.response?.data?.error || 'Failed to store document.' });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 p-6">
        <AlertCircle size={20} /> {error}
      </div>
    );
  }

  const tabs = [
    { id: 'overview',      label: 'Overview',      icon: Activity },
    { id: 'patients',      label: 'Patients',       icon: Users },
    { id: 'appointments',  label: 'Appointments',   icon: Calendar },
    { id: 'revenue',       label: 'Revenue',        icon: DollarSign },
    { id: 'prescriptions', label: 'Prescriptions',  icon: Pill },
    { id: 'documents',     label: 'Documents',      icon: Upload },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Provider Dashboard</h1>
        <button
          onClick={fetchDashboard}
          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Users}      label="Total Patients"       value={fmt(stats.total_patients)}        color="blue" />
        <StatCard icon={Calendar}   label="Upcoming Appts"       value={fmt(stats.upcoming_appointments)} color="purple" />
        <StatCard icon={CheckCircle} label="Approved Claims"     value={fmt(stats.approved_claims)}       color="green" />
        <StatCard icon={DollarSign} label="Revenue This Month"   value={fmtCurrency(stats.revenue_this_month)} color="orange" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6 overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Recent Appointments</h2>
          {recentAppts.length === 0 ? (
            <p className="text-gray-400 text-sm">No recent appointments.</p>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Patient</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentAppts.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{a.patient_name}</td>
                      <td className="px-4 py-3 text-gray-500">{new Date(a.appointment_date).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-500">{a.appointment_type}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Patients ── */}
      {tab === 'patients' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search patients…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchPatients()}
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <button
              onClick={fetchPatients}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              Search
            </button>
          </div>
          {patients.length === 0 ? (
            <p className="text-gray-400 text-sm">No patients found.</p>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Phone</th>
                    <th className="px-4 py-3 text-left">Blood Type</th>
                    <th className="px-4 py-3 text-left">Last Visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {patients.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{p.first_name} {p.last_name}</td>
                      <td className="px-4 py-3 text-gray-500">{p.email}</td>
                      <td className="px-4 py-3 text-gray-500">{p.phone}</td>
                      <td className="px-4 py-3">{p.blood_type || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {p.last_visit ? new Date(p.last_visit).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Appointments ── */}
      {tab === 'appointments' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <select
              value={apptFilter}
              onChange={(e) => setApptFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">All statuses</option>
              {['scheduled', 'confirmed', 'completed', 'cancelled'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={fetchAppointments}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              Filter
            </button>
          </div>
          {appointments.length === 0 ? (
            <p className="text-gray-400 text-sm">No appointments found.</p>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Patient</th>
                    <th className="px-4 py-3 text-left">Date & Time</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {appointments.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{a.patient_name}</td>
                      <td className="px-4 py-3 text-gray-500">{new Date(a.appointment_date).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-500">{a.appointment_type}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{a.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Revenue ── */}
      {tab === 'revenue' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard icon={TrendingUp}  label="Total Claims"    value={fmt(revenue.claimStats.total_claims)}    color="blue" />
            <StatCard icon={CheckCircle} label="Approved Claims" value={fmt(revenue.claimStats.approved_claims)} color="green" />
            <StatCard icon={DollarSign}  label="Approved Amount" value={fmtCurrency(revenue.claimStats.total_approved_amount)} color="orange" />
          </div>
          <div className="bg-white rounded-xl shadow p-5">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">Monthly Revenue</h3>
            {revenue.monthly.length === 0 ? (
              <p className="text-gray-400 text-sm">No revenue data available.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-gray-500 uppercase text-xs border-b">
                  <tr>
                    <th className="py-2 text-left">Month</th>
                    <th className="py-2 text-right">Payments</th>
                    <th className="py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {revenue.monthly.map((m) => (
                    <tr key={m.month}>
                      <td className="py-2 font-medium">{m.month}</td>
                      <td className="py-2 text-right text-gray-500">{fmt(m.payment_count)}</td>
                      <td className="py-2 text-right text-green-600 font-medium">{fmtCurrency(m.total_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Prescriptions ── */}
      {tab === 'prescriptions' && (
        <div className="max-w-lg">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">New Prescription</h2>
          {rxMsg && (
            <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
              rxMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {rxMsg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {rxMsg.text}
            </div>
          )}
          <form onSubmit={submitPrescription} className="bg-white rounded-xl shadow p-5 space-y-4">
            {[
              { name: 'patientId',  label: 'Patient ID',  type: 'number', required: true },
              { name: 'medication', label: 'Medication',  type: 'text',   required: true },
              { name: 'dosage',     label: 'Dosage',      type: 'text',   required: true },
              { name: 'duration',   label: 'Duration',    type: 'text',   required: true },
              { name: 'notes',      label: 'Notes',       type: 'text',   required: false },
            ].map(({ name, label, type, required }) => (
              <div key={name}>
                <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
                <input
                  type={type}
                  required={required}
                  value={rxForm[name]}
                  onChange={(e) => setRxForm((f) => ({ ...f, [name]: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            ))}
            <button
              type="submit"
              className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Create Prescription
            </button>
          </form>
        </div>
      )}

      {/* ── Documents ── */}
      {tab === 'documents' && (
        <div className="max-w-lg">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Upload Document Reference</h2>
          {docMsg && (
            <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
              docMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {docMsg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {docMsg.text}
            </div>
          )}
          <form onSubmit={submitDocument} className="bg-white rounded-xl shadow p-5 space-y-4">
            {[
              { name: 'patientId',    label: 'Patient ID',     type: 'number', required: true },
              { name: 'documentType', label: 'Document Type',  type: 'text',   required: true },
              { name: 'ipfsHash',     label: 'IPFS Hash / URL',type: 'text',   required: true },
              { name: 'description',  label: 'Description',    type: 'text',   required: false },
            ].map(({ name, label, type, required }) => (
              <div key={name}>
                <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
                <input
                  type={type}
                  required={required}
                  value={docForm[name]}
                  onChange={(e) => setDocForm((f) => ({ ...f, [name]: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            ))}
            <button
              type="submit"
              className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Store Document
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
