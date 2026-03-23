import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Heart,
  FileText,
  Calendar,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  User,
  Activity,
  DollarSign,
  Shield,
  Phone,
  Mail,
  MapPin,
  Filter,
  Search,
  RefreshCw,
  Bell,
  ChevronRight,
  Download,
  Eye,
  Edit,
  Plus
} from 'lucide-react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const PatientDashboard = ({ user, token }) => {
  const [dashboardData, setDashboardData] = useState(null);
  const [medicalRecords, setMedicalRecords] = useState([]);
  const [claims, setClaims] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [socket, setSocket] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const newSocket = io(API_BASE_URL.replace('/api', ''));
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      if (dashboardData?.id) {
        newSocket.emit('join-patient-room', dashboardData.id);
      }
    });

    newSocket.on('new-medical-record', (data) => {
      setNotifications(prev => [...prev, {
        id: Date.now(),
        type: 'medical_record',
        message: data.message,
        timestamp: new Date()
      }]);
      fetchMedicalRecords();
    });

    newSocket.on('new-claim', (data) => {
      setNotifications(prev => [...prev, {
        id: Date.now(),
        type: 'claim',
        message: data.message,
        timestamp: new Date()
      }]);
      fetchClaims();
    });

    newSocket.on('claim-status-update', (data) => {
      setNotifications(prev => [...prev, {
        id: Date.now(),
        type: 'claim',
        message: data.message,
        timestamp: new Date()
      }]);
      fetchClaims();
    });

    newSocket.on('new-appointment', (data) => {
      setNotifications(prev => [...prev, {
        id: Date.now(),
        type: 'appointment',
        message: data.message,
        timestamp: new Date()
      }]);
      fetchAppointments();
    });

    newSocket.on('appointment-updated', (data) => {
      setNotifications(prev => [...prev, {
        id: Date.now(),
        type: 'appointment',
        message: data.message,
        timestamp: new Date()
      }]);
      fetchAppointments();
    });

    newSocket.on('new-payment', (data) => {
      setNotifications(prev => [...prev, {
        id: Date.now(),
        type: 'payment',
        message: data.message,
        timestamp: new Date()
      }]);
      fetchPayments();
    });

    return () => newSocket.close();
  }, []);

  useEffect(() => {
    if (user?.id) {
      fetchDashboardData();
    }
  }, [user]);

  useEffect(() => {
    if (dashboardData?.id && socket) {
      socket.emit('join-patient-room', dashboardData.id);
    }
  }, [dashboardData?.id, socket]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const config = {
        headers: { Authorization: `Bearer ${token}` }
      };

      const [dashboardRes, recordsRes, claimsRes, appointmentsRes, paymentsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/patients/dashboard/${user.id}`, config),
        axios.get(`${API_BASE_URL}/medical-records/patient/${user.id}`, config),
        axios.get(`${API_BASE_URL}/claims/patient/${user.id}`, config),
        axios.get(`${API_BASE_URL}/appointments/upcoming/${user.id}`, config),
        axios.get(`${API_BASE_URL}/payments/patient/${user.id}`, config)
      ]);

      setDashboardData(dashboardRes.data);
      setMedicalRecords(recordsRes.data.records || []);
      setClaims(claimsRes.data.claims || []);
      setAppointments(appointmentsRes.data || []);
      setPayments(paymentsRes.data.payments || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const fetchMedicalRecords = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/medical-records/patient/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMedicalRecords(response.data.records || []);
    } catch (err) {
      console.error('Error fetching medical records:', err);
    }
  };

  const fetchClaims = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/claims/patient/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClaims(response.data.claims || []);
    } catch (err) {
      console.error('Error fetching claims:', err);
    }
  };

  const fetchAppointments = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/appointments/upcoming/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAppointments(response.data || []);
    } catch (err) {
      console.error('Error fetching appointments:', err);
    }
  };

  const fetchPayments = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/payments/patient/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPayments(response.data.payments || []);
    } catch (err) {
      console.error('Error fetching payments:', err);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      approved: 'text-green-600 bg-green-100',
      pending: 'text-yellow-600 bg-yellow-100',
      denied: 'text-red-600 bg-red-100',
      submitted: 'text-blue-600 bg-blue-100',
      paid: 'text-green-600 bg-green-100',
      completed: 'text-green-600 bg-green-100',
      scheduled: 'text-blue-600 bg-blue-100',
      confirmed: 'text-green-600 bg-green-100',
      cancelled: 'text-red-600 bg-red-100'
    };
    return colors[status] || 'text-gray-600 bg-gray-100';
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="animate-spin h-8 w-8 text-blue-600" />
        <span className="ml-2 text-lg">Loading dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <AlertCircle className="h-8 w-8 text-red-600" />
        <span className="ml-2 text-lg text-red-600">{error}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <Heart className="h-8 w-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">Patient Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Bell className="h-6 w-6 text-gray-600 cursor-pointer" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <User className="h-6 w-6 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">
                  {dashboardData?.first_name} {dashboardData?.last_name}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Medical Records</p>
                <p className="text-2xl font-bold text-gray-900">{dashboardData?.total_medical_records || 0}</p>
              </div>
              <FileText className="h-8 w-8 text-blue-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Insurance Claims</p>
                <p className="text-2xl font-bold text-gray-900">{dashboardData?.total_claims || 0}</p>
                <p className="text-xs text-green-600">
                  {dashboardData?.approved_claims || 0} approved
                </p>
              </div>
              <Shield className="h-8 w-8 text-green-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Premium Payments</p>
                <p className="text-2xl font-bold text-gray-900">{dashboardData?.total_payments || 0}</p>
                <p className="text-xs text-gray-500">
                  {formatCurrency(dashboardData?.total_premiums_paid || 0)} total
                </p>
              </div>
              <CreditCard className="h-8 w-8 text-purple-600" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Upcoming</p>
                <p className="text-2xl font-bold text-gray-900">{dashboardData?.upcoming_appointments || 0}</p>
                <p className="text-xs text-blue-600">appointments</p>
              </div>
              <Calendar className="h-8 w-8 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              {['overview', 'records', 'claims', 'appointments', 'payments'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm capitalize ${
                    activeTab === tab
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Patient Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center space-x-2">
                      <User className="h-5 w-5 text-gray-400" />
                      <span className="text-sm text-gray-600">Name:</span>
                      <span className="text-sm font-medium text-gray-900">
                        {dashboardData?.first_name} {dashboardData?.last_name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Mail className="h-5 w-5 text-gray-400" />
                      <span className="text-sm text-gray-600">Email:</span>
                      <span className="text-sm font-medium text-gray-900">{dashboardData?.email}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Phone className="h-5 w-5 text-gray-400" />
                      <span className="text-sm text-gray-600">Phone:</span>
                      <span className="text-sm font-medium text-gray-900">{dashboardData?.phone}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Shield className="h-5 w-5 text-gray-400" />
                      <span className="text-sm text-gray-600">Insurance:</span>
                      <span className="text-sm font-medium text-gray-900">{dashboardData?.insurance_provider}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h3>
                  <div className="space-y-3">
                    {medicalRecords.slice(0, 3).map((record) => (
                      <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <FileText className="h-5 w-5 text-blue-600" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{record.title}</p>
                            <p className="text-xs text-gray-500">{formatDate(record.date_of_service)}</p>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'records' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Medical Records</h3>
                  <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Plus className="h-4 w-4" />
                    <span>Add Record</span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {medicalRecords.map((record) => (
                        <tr key={record.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(record.date_of_service)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(record.record_type)}`}>
                              {record.record_type}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">{record.title}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.provider_name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex space-x-2">
                              <button className="text-blue-600 hover:text-blue-900">
                                <Eye className="h-4 w-4" />
                              </button>
                              <button className="text-green-600 hover:text-green-900">
                                <Download className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'claims' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Insurance Claims</h3>
                  <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Plus className="h-4 w-4" />
                    <span>New Claim</span>
                  </button>
                </div>
                <div className="space-y-4">
                  {claims.map((claim) => (
                    <div key={claim.id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-medium text-gray-900">Claim #{claim.claim_number}</h4>
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(claim.status)}`}>
                              {claim.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{claim.provider_name}</p>
                          <p className="text-xs text-gray-500 mt-1">Service Date: {formatDate(claim.service_date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-900">{formatCurrency(claim.total_amount)}</p>
                          <p className="text-xs text-gray-500">Insurance: {formatCurrency(claim.insurance_amount)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'appointments' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Upcoming Appointments</h3>
                  <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Plus className="h-4 w-4" />
                    <span>Schedule</span>
                  </button>
                </div>
                <div className="space-y-4">
                  {appointments.map((appointment) => (
                    <div key={appointment.id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-medium text-gray-900">{appointment.appointment_type}</h4>
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(appointment.status)}`}>
                              {appointment.status}
                            </span>
                            {appointment.virtual && (
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">
                                Virtual
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{appointment.provider_name}</p>
                          <p className="text-xs text-gray-500 mt-1">{formatDateTime(appointment.appointment_date)}</p>
                          {appointment.meeting_link && (
                            <a href={appointment.meeting_link} className="text-xs text-blue-600 hover:text-blue-800 mt-1 inline-block">
                              Join Meeting
                            </a>
                          )}
                        </div>
                        <div className="flex space-x-2">
                          <button className="text-blue-600 hover:text-blue-900">
                            <Edit className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'payments' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Premium Payments</h3>
                  <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Plus className="h-4 w-4" />
                    <span>Make Payment</span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(payment.payment_date)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {formatCurrency(payment.payment_amount)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {payment.payment_method}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(payment.payment_status)}`}>
                              {payment.payment_status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {payment.insurance_provider}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default PatientDashboard;
