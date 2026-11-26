import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Calendar, 
  Activity, 
  User, 
  LogOut, 
  Menu,
  X,
  Home,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Download, // Add Download icon
  Megaphone,
  Send,
  ChevronDown,
  ChevronRight,
  Bell,
  ArrowRight,
  Clock
} from 'lucide-react';
import clinicLogo from './assets/Logo.png';

// Custom Tooth SVG Icon for dental branding
const ToothIcon = ({ className = "w-6 h-6", ...props }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
    {...props}
  >
    <path d="M12 2C8.5 2 6 4.3 6 7c0 2 1.2 3.5 1.5 5 .4 2-.5 4.5 1.5 7.5.5.8 1.5 1.2 2.5.5.7-.5.8-1.5.5-2.5-.5-1.5.5-2.5 1-3.5.5 1 1.5 2 1 3.5-.3 1-.2 2 .5 2.5 1 .7 2 .3 2.5-.5 2-3 1.1-5.5 1.5-7.5.3-1.5 1.5-3 1.5-5 0-2.7-2.5-5-6-5z" />
  </svg>
);

// API Configuration
const API_BASE = `${import.meta.env.VITE_API_URL}/api`;

// Token management functions
const getStoredToken = () => localStorage.getItem('auth_token');
const setStoredToken = (token) => localStorage.setItem('auth_token', token);
const removeStoredToken = () => localStorage.removeItem('auth_token');

const api = {
  // Helper function to make authenticated requests with auto-refresh
  makeAuthenticatedRequest: async (url, options = {}) => {
    const token = getStoredToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers
    });

    // If unauthorized, try to refresh token
    if (response.status === 401 && token) {
      console.log('Token expired, attempting refresh...');
      
      try {
        const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          credentials: 'include'
        });

        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          if (refreshData.success && refreshData.token) {
            setStoredToken(refreshData.token);
            console.log('Token refreshed successfully');
            
            // Retry original request with new token
            headers['Authorization'] = `Bearer ${refreshData.token}`;
            response = await fetch(url, {
              credentials: 'include',
              ...options,
              headers
            });
          }
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
      }
    }

    // If still unauthorized after refresh attempt, clear token
    if (response.status === 401) {
      removeStoredToken();
      throw new Error('Authentication expired. Please login again.');
    }

    return response;
  },

  // Add token refresh method
  refreshToken: async () => {
    try {
      const token = getStoredToken();
      if (!token) return false;

      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.token) {
          setStoredToken(data.token);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  },

  // Improved auth check with retry logic
  checkAuth: async () => {
    try {
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/auth/check`);
      
      if (!response.ok) {
        if (response.status === 401) {
          removeStoredToken();
          return { success: false, authenticated: false };
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Auth check error:', error);
      
      // If it's an auth error, clear token
      if (error.message?.includes('Authentication expired')) {
        removeStoredToken();
      }
      
      return { success: false, authenticated: false };
    }
  },

  login: async (credentials) => {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(credentials)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Login failed');
      }

      const result = await response.json();
      
      // Store JWT token if provided
      if (result.token) {
        setStoredToken(result.token);
      }
      
      return result;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.makeAuthenticatedRequest(`${API_BASE}/auth/logout`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      removeStoredToken();
    }
  },

  // Patient APIs
  getPatients: async (page = 1, limit = 50, search = '') => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(search && { search })
      });
      
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/patients?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        return result;
      } else {
        throw new Error(result.error || 'Failed to fetch patients');
      }
    } catch (error) {
      console.error('Load patients error:', error);
      throw error;
    }
  },

  getDashboardStats: async () => {
    try {
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/dashboard/stats`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        return result;
      } else {
        throw new Error(result.error || 'Failed to fetch dashboard stats');
      }
    } catch (error) {
      console.error('Load stats error:', error);
      throw error;
    }
  },

  // Other APIs follow the same pattern...
  createPatient: async (patientData) => {
    try {
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/patients`, {
        method: 'POST',
        body: JSON.stringify(patientData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create patient');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  updatePatient: async (regno, patientData) => {
    try {
      // Double URL encode to handle special characters properly
      const encodedRegno = encodeURIComponent(encodeURIComponent(regno));
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/patients/${encodedRegno}`, {
        method: 'PUT',
        body: JSON.stringify(patientData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update patient');
      }

      return await response.json();
    } catch (error) {
      console.error('Update patient error:', error);
      throw error;
    }
  },

  deletePatient: async (regno) => {
    try {
      // Double URL encode to handle special characters properly
      const encodedRegno = encodeURIComponent(encodeURIComponent(regno));
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/patients/${encodedRegno}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete patient');
      }

      return await response.json();
    } catch (error) {
      console.error('Delete patient error:', error);
      throw error;
    }
  },

  changePassword: async (passwordData) => {
    try {
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        body: JSON.stringify(passwordData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to change password');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  // NEW: APPOINTMENT API
  createAppointment: async (appointmentData) => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments`, {
      method: 'POST',
      body: JSON.stringify(appointmentData)
    });
    return await response.json();
  },

  getAppointments: async (search = '') => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments?search=${encodeURIComponent(search)}`);
    return await response.json();
  },

  deleteAppointment: async (id) => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments/${id}`, {
      method: 'DELETE'
    });
    return await response.json();
  },

  updateAppointment: async (id, apptData) => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(apptData)
    });
    return await response.json();
  },

  getAnnouncements: async () => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/announcements`);
    return await response.json();
  },

  createAnnouncement: async (announcementData) => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/announcements`, {
      method: 'POST',
      body: JSON.stringify(announcementData)
    });
    return await response.json();
  },

  // Add CSV export method
  exportPatients: async () => {
    try {
      // Get all patients with a high limit for CSV export
      const response = await api.makeAuthenticatedRequest(`${API_BASE}/patients?limit=10000`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        return result.data || [];
      } else {
        throw new Error(result.error || 'Failed to export patients');
      }
    } catch (error) {
      console.error('Export patients error:', error);
      throw error;
    }
  }
};

// Login Component
function LoginForm({ onLogin, loading, error }) {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin(formData);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200/80 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-cyan-50 rounded-full flex items-center justify-center mx-auto mb-4 p-3 border border-cyan-100 shadow-sm">
            <img 
              src={clinicLogo}
              alt="Kuzhivelil Dental Care Logo" 
              className="w-full h-full object-contain"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <ToothIcon className="w-8 h-8 text-cyan-600 hidden" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Kuzhivelil Dental Care</h1>
          <p className="text-slate-400 mt-1 text-sm">Admin Panel Login</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center text-sm">
            <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white text-slate-900 placeholder-slate-400 transition-all text-sm"
                placeholder="Enter your username"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full pl-10 pr-12 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white text-slate-900 placeholder-slate-400 transition-all text-sm"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cyan-600 text-white py-3 px-4 rounded-lg hover:bg-cyan-700 focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold shadow-md shadow-cyan-600/20"
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                Signing in...
              </div>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// Change Password Modal
function ChangePasswordModal({ isOpen, onClose, onSubmit, loading }) {
  const [formData, setFormData] = useState({
    current_password: '',
    new_password: ''
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false
  });

  useEffect(() => {
    if (!isOpen) {
      setFormData({ current_password: '', new_password: '' });
      setShowPasswords({ current: false, new: false });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Change Password</h3>

        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Current Password</label>
            <div className="relative">
              <input
                type={showPasswords.current ? "text" : "password"}
                value={formData.current_password}
                onChange={(e) => setFormData({ ...formData, current_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white text-slate-900 text-sm"
                required
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400"
              >
                {showPasswords.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">New Password</label>
            <div className="relative">
              <input
                type={showPasswords.new ? "text" : "password"}
                value={formData.new_password}
                onChange={(e) => setFormData({ ...formData, new_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white text-slate-900 text-sm"
                minLength="6"
                required
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400"
              >
                {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">Password must be at least 6 characters</p>
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-cyan-600 text-white font-semibold rounded-lg hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-400 shadow-sm text-sm"
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function App() {
  // State management
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // UI state
  const [currentView, setCurrentView] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Data state
  const [patients, setPatients] = useState([]);
  const [stats, setStats] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientToDelete, setPatientToDelete] = useState(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [appointments, setAppointments] = useState([]); // NEW: For Appointment Tracking
  const [expandedApptDates, setExpandedApptDates] = useState({});
  const [chartMetric, setChartMetric] = useState('total');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
    // Modals / Selection
  
  const [apptPatient, setApptPatient] = useState(null); // NEW: For Appointment Modal
  const [apptData, setApptData] = useState({ date: '', time: '', doctor_name: '' });
  const [apptModalError, setApptModalError] = useState(null);
  const [rescheduleAppt, setRescheduleAppt] = useState(null);
  const [rescheduleData, setRescheduleData] = useState({ date: '', time: '' });

  // Announcements state
  const [announcements, setAnnouncements] = useState([]);
  const [optedInCount, setOptedInCount] = useState(0);
  const [optedInPatients, setOptedInPatients] = useState([]);
  const [announcementSearch, setAnnouncementSearch] = useState('');
  const [announcementForm, setAnnouncementForm] = useState({
    title: 'Clinic Announcement',
    closure_date: '',
    reason: '',
    reopening_date: '',
    target_mode: 'all_opted_in',
    regnos: []
  });

  // Form state
  const [formData, setFormData] = useState({
    regno: '',
    name: '',
    address: '',
    phone: '',
    age: '',
    whatsapp_opt_in: true
  });

  // Auth check on app load
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const token = getStoredToken();
        if (!token) {
          setLoading(false);
          return;
        }

        const result = await api.checkAuth();

        if (result.success && result.authenticated) {
          setIsAuthenticated(true);
          setCurrentUser(result.admin);
        } else {
          // Try one more time with token refresh
          const refreshed = await api.refreshToken();
          if (refreshed) {
            const retryResult = await api.checkAuth();
            if (retryResult.success && retryResult.authenticated) {
              setIsAuthenticated(true);
              setCurrentUser(retryResult.admin);
            } else {
              setIsAuthenticated(false);
              setCurrentUser(null);
            }
          } else {
            setIsAuthenticated(false);
            setCurrentUser(null);
          }
        }
      } catch (err) {
        console.error('Auth check error:', err);
        setIsAuthenticated(false);
        setCurrentUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuthStatus();
  }, []);

  // Load data when authenticated  
  useEffect(() => {
    if (isAuthenticated) {
      loadPatients();
      loadDashboardStats();
    }
  }, [isAuthenticated]);

  // Add this useEffect for periodic token refresh
  useEffect(() => {
    let refreshInterval;
    
    if (isAuthenticated) {
      // Refresh token every 6 hours (before 7-day expiration)
      refreshInterval = setInterval(async () => {
        const refreshed = await api.refreshToken();
        if (!refreshed) {
          console.log('Token refresh failed, logging out...');
          handleLogout();
        }
      }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds
    }

    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [isAuthenticated]);

  // ADD THE HANDLEEXPORTCSV FUNCTION HERE
  const handleExportCSV = async () => {
    try {
      setLoading(true);
      setError(null);

      const patientsData = await api.exportPatients();

      if (patientsData.length === 0) {
        setError('No patients to export');
        return;
      }

      // Create CSV content
      const headers = ['Registration No', 'Name', 'Address', 'Phone', 'Age', 'Date'];
      const csvContent = [
        headers.join(','),
        ...patientsData.map(patient => {
          const formatCSVField = (field) => {
            if (!field) return '""';
            const stringField = String(field);
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
              return `"${stringField.replace(/"/g, '""')}"`;
            }
            return stringField;
          };

          return [
            formatCSVField(patient.regno),
            formatCSVField(patient.name),
            formatCSVField(patient.address || ''),
            formatCSVField(patient.phone || ''),
            formatCSVField(patient.age),
            formatCSVField(formatDate(patient.created_at || patient.date))
          ].join(',');
        })
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      const currentDate = new Date().toISOString().split('T')[0];
      const filename = `kuzhivelil_patients_${currentDate}.csv`;
      
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showSuccess(`Patient data exported successfully! (${patientsData.length} records)`);

    } catch (err) {
      console.error('Export error:', err);
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadPatients = async (page = 1, search = '') => {
    try {
      setLoading(true);
      const result = await api.getPatients(page, 50, search);
      
      if (result && result.data) {
        setPatients(result.data);
        setCurrentPage(result.pagination?.page || 1);
        setTotalPages(result.pagination?.total_pages || 1);
        setTotalCount(result.pagination?.total_count || 0);
        setSearchQuery(search);
      } else {
        setPatients([]);
        setCurrentPage(1);
        setTotalPages(1);
        setTotalCount(0);
      }
      
    } catch (err) {
      console.error('Load patients error:', err);
      setPatients([]);
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardStats = async () => {
    try {
      const response = await api.getDashboardStats();
      setStats(response || {});
    } catch (err) {
      console.error('Load stats error:', err);
      handleApiError(err);
    }
  };

  const loadAppointments = async (search = '') => {
    try {
      setLoading(true);
      const result = await api.getAppointments(search);
      if (result && result.success) {
        setAppointments(result.data || []);
      }
    } catch (err) {
      console.error('Load appointments error:', err);
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleAppointmentDate = (dateStr) => {
    setExpandedApptDates((prev) => ({
      ...prev,
      [dateStr]: !prev[dateStr]
    }));
  };

  const groupedAppointments = React.useMemo(() => {
    const groups = {};
    appointments.forEach((appt) => {
      const key = appt.date || 'Unknown Date';
      if (!groups[key]) groups[key] = [];
      groups[key].push(appt);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [appointments]);

  const formatAppointmentDateWithDay = (dateStr) => {
    if (!dateStr) return 'N/A';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
    if (!match) return dateStr;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const dt = new Date(year, month, day);
    if (Number.isNaN(dt.getTime())) return dateStr;
    const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
    const formatted = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${weekday}, ${formatted}`;
  };

  const formatAppointmentTime12h = (timeStr) => {
    if (!timeStr) return 'N/A';
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr).trim());
    if (!match) return timeStr;
    let h = Number(match[1]);
    const m = match[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  };

  const getGreetingText = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getTodayFullDate = () =>
    new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

  const getInitials = (name) => {
    const parts = String(name || 'P').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'P';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  };

  const handleBookAppt = async () => {
    if (!apptPatient || !apptData.date || !apptData.time) {
      setApptModalError("Please select both date and time");
      return;
    }

    try {
      setLoading(true);
      setApptModalError(null);
      const result = await api.createAppointment({
        regno: apptPatient.regno,
        date: apptData.date,
        time: apptData.time,
        ...(apptData.doctor_name ? { doctor_name: apptData.doctor_name } : {})
      });

      if (result.success) {
        showSuccess("Appointment booked successfully!");
        setApptPatient(null);
        setApptModalError(null);
        setApptData({ date: '', time: '', doctor_name: '' });
        if (currentView === 'appointments') loadAppointments();
        loadDashboardStats();
      } else {
        setApptModalError(result.error || "Failed to book appointment");
      }
    } catch (err) {
      setApptModalError(err.message || "Failed to book appointment");
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  // Search handler
  const handleGlobalSearch = async (query) => {
    const trimmedQuery = query.trim();
    
    if (!trimmedQuery) {
      setSearchMode(false);
      setSearchQuery('');
      loadPatients(1, '');
      return;
    }

    setSearchMode(true);
    setSearchQuery(trimmedQuery);

    try {
      const result = await api.getPatients(1, 100, trimmedQuery);
      setPatients(result.data || []);
      setCurrentPage(1);
      setTotalPages(result.pagination?.total_pages || 1);
      setTotalCount(result.pagination?.total_count || 0);
    } catch (error) {
      console.error('Search error:', error);
      setPatients([]);
      setError('Search failed. Please try again.');
    }
  };

  // Handle search input with debouncing
  const handleSearchInput = (e) => {
    const query = e.target.value;
    setSearchTerm(query);
    
    clearTimeout(window.searchTimeout);
    window.searchTimeout = setTimeout(() => {
      handleGlobalSearch(query);
    }, 500);
  };

  // Pagination handler
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      
      if (searchMode && searchQuery) {
        loadSearchPage(newPage);
      } else {
        loadPatients(newPage, '');
      }
    }
  };

  const loadSearchPage = async (page) => {
    try {
      const result = await api.getPatients(page, 50, searchQuery);
      setPatients(result.data || []);
      setCurrentPage(result.pagination?.page || page);
      setTotalPages(result.pagination?.total_pages || 1);
      setTotalCount(result.pagination?.total_count || 0);
    } catch (error) {
      console.error('Load search page error:', error);
      setError('Failed to load search results');
    }
  };

  const clearSearch = () => {
    setSearchTerm('');
    setSearchMode(false);
    setSearchQuery('');
    loadPatients(1, '');
  };

  // Form handlers
  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleCreatePatient = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await api.createPatient(formData);

      if (result.success) {
        showSuccess('Patient registered successfully!');
        setFormData({ regno: '', name: '', address: '', phone: '', age: '', whatsapp_opt_in: true });
        await loadPatients();
        await loadDashboardStats();
      } else {
        setError(result.error || 'Failed to create patient');
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (patient) => {
    setSelectedPatient(patient);
    setFormData({
      regno: patient.regno,
      name: patient.name,
      address: patient.address || '',
      phone: patient.phone || '',
      age: patient.age,
      whatsapp_opt_in: patient.whatsapp_opt_in !== false
    });
    setCurrentView('edit');
  };

  const handleUpdatePatient = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await api.updatePatient(selectedPatient.regno, formData);

      if (result.success) {
        showSuccess('Patient updated successfully!');
        await loadPatients();
        setSelectedPatient(null);
        setCurrentView('current');
      } else {
        setError(result.error || 'Failed to update patient');
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePatient = async () => {
    if (!patientToDelete) return;

    try {
      setLoading(true);
      setError(null);

      const result = await api.deletePatient(patientToDelete.regno);

      if (result.success) {
        showSuccess('Patient deleted successfully!');
        await loadPatients();
        await loadDashboardStats();
      } else {
        setError(result.error || 'Failed to delete patient');
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
      setShowDeleteModal(false);
      setPatientToDelete(null);
    }
  };

  const handleDeleteAppointment = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this appointment?')) return;

    try {
      setLoading(true);
      const result = await api.deleteAppointment(id);
      if (result.success) {
        showSuccess('Appointment cancelled successfully');
        loadAppointments();
        loadDashboardStats();
      } else {
        setError(result.error);
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRescheduleAppt = async () => {
    if (!rescheduleAppt || !rescheduleData.date || !rescheduleData.time) {
      setError('Please select a new date and time');
      return;
    }

    try {
      setLoading(true);
      const result = await api.updateAppointment(rescheduleAppt._id, {
        date: rescheduleData.date,
        time: rescheduleData.time
      });
      if (result.success) {
        showSuccess('Appointment rescheduled successfully!');
        setRescheduleAppt(null);
        setRescheduleData({ date: '', time: '' });
        loadAppointments();
        loadDashboardStats();
      } else {
        setError(result.error || 'Failed to reschedule appointment');
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      const [annResult, patientsList] = await Promise.all([
        api.getAnnouncements(),
        api.exportPatients()
      ]);
      if (annResult && annResult.success) {
        setAnnouncements(annResult.data || []);
        setOptedInCount(annResult.opted_in_count || 0);
      }
      const eligible = (patientsList || []).filter(
        (p) => p.whatsapp_opt_in !== false && p.phone && String(p.phone).trim()
      );
      setOptedInPatients(eligible);
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAnnouncementPatient = (regno) => {
    setAnnouncementForm((prev) => {
      const exists = prev.regnos.includes(regno);
      return {
        ...prev,
        regnos: exists
          ? prev.regnos.filter((r) => r !== regno)
          : [...prev.regnos, regno]
      };
    });
  };

  const handleSendAnnouncement = async (e) => {
    e.preventDefault();
    if (!announcementForm.closure_date || !announcementForm.reason.trim()) {
      setError('Closure/effective date and announcement reason are required');
      return;
    }
    if (announcementForm.target_mode === 'selected' && announcementForm.regnos.length === 0) {
      setError('Please select at least one opted-in patient');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await api.createAnnouncement({
        ...announcementForm,
        request_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      if (result.success) {
        const b = result.broadcast || {};
        showSuccess(
          `Announcement processed: ${b.sent_count || 0} sent, ${b.failed_count || 0} failed, ${b.skipped_count || 0} skipped.`
        );
        setAnnouncementForm({
          title: 'Clinic Announcement',
          closure_date: '',
          reason: '',
          reopening_date: '',
          target_mode: 'all_opted_in',
          regnos: []
        });
        await loadAnnouncements();
      } else {
        setError(result.error || 'Failed to send announcement');
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (passwordData) => {
    try {
      setLoading(true);
      setError(null);

      const result = await api.changePassword(passwordData);

      if (result.success) {
        showSuccess('Password changed successfully!');
        setShowChangePassword(false);
      } else {
        setError(result.error || 'Failed to change password');
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      setIsAuthenticated(false);
      setCurrentUser(null);
      setCurrentView('dashboard');
      setPatients([]);
      setStats({});
    } catch (err) {
      console.error('Logout error:', err);
      setIsAuthenticated(false);
      setCurrentUser(null);
    }
  };

  const handleLogin = async (credentials) => {
    try {
      setLoading(true);
      setError(null);

      const result = await api.login(credentials);

      if (result.success) {
        setIsAuthenticated(true);
        setCurrentUser(result.admin);
        setCurrentView('dashboard');
      }
    } catch (error) {
      console.error('Login error:', error);
      setError(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApiError = (error) => {
    if (error.message?.includes('Authentication expired')) {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setError('Your session has expired. Please login again.');
    } else {
      setError(error.message || 'An error occurred');
    }
  };

  const showSuccess = (message) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // Get latest registration number
  const getLatestRegno = () => {
    if (patients.length === 0) return 'No registrations yet';
    const sortedByDate = [...patients].sort((a, b) => {
      const dateA = new Date(a.date || a.created_at);
      const dateB = new Date(b.date || b.created_at);
      return dateB - dateA;
    });
    return sortedByDate[0]?.regno || 'No registrations yet';
  };

  const getLatestPatient = () => {
    if (patients.length === 0) return null;
    const sortedByDate = [...patients].sort((a, b) => {
      const dateA = new Date(a.date || a.created_at);
      const dateB = new Date(b.date || b.created_at);
      return dateB - dateA;
    });
    return sortedByDate[0];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    } catch (error) {
      return 'N/A';
    }
  };

  // Show loading screen
  if (loading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-600 mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">Loading clinical workspace...</p>
        </div>
      </div>
    );
  }

  // Show login form
  if (!isAuthenticated) {
    return <LoginForm onLogin={handleLogin} loading={loading} error={error} />;
  }

  // Main app interface
  const last7Days = stats.last_7_days || [];
  const maxChartValue = Math.max(
    1,
    ...last7Days.map((d) => Number(d[chartMetric] || 0))
  );
  const totalChartCount = last7Days.reduce(
    (sum, d) => sum + Number(d[chartMetric] || 0),
    0
  );
  const peakDay = last7Days.reduce(
    (best, d) =>
      Number(d[chartMetric] || 0) >= Number(best[chartMetric] || 0) ? d : best,
    last7Days[0] || { full_day: 'Today', [chartMetric]: 0 }
  );

  return (
    <div className="min-h-screen bg-[#f6f8f7] flex text-slate-900">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-64 bg-white text-slate-800 border-r border-slate-200/80 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0 flex flex-col justify-between`}>
        <div>
          <div className="flex items-center justify-start h-16 px-5 bg-white border-b border-slate-100">
            <div className="w-9 h-9 mr-3 rounded-xl bg-emerald-50 border border-emerald-100 p-1.5 flex items-center justify-center flex-shrink-0">
              <img 
                src={clinicLogo} 
                alt="Kuzhivelil Dental Care Logo" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'block';
                }}
              />
              <ToothIcon className="w-6 h-6 text-emerald-600 hidden" />
            </div>
            <div className="flex flex-col overflow-hidden">
              <h1 className="text-slate-900 text-sm font-bold truncate">Kuzhivelil Dental</h1>
              <span className="text-[11px] text-slate-400 font-medium">Clinic Management</span>
            </div>
          </div>

          <nav className="mt-5 px-3">
            <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Workspace
            </p>
            <div className="space-y-1">
              <button
                onClick={() => {
                  setCurrentView('dashboard');
                  loadDashboardStats();
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left rounded-xl text-sm transition-all ${currentView === 'dashboard'
                  ? 'bg-emerald-100/80 text-emerald-950 font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                  }`}
              >
                <span className="flex items-center">
                  <Home className={`w-4 h-4 mr-3 flex-shrink-0 ${currentView === 'dashboard' ? 'text-emerald-700' : 'text-slate-400'}`} />
                  Dashboard
                </span>
              </button>

              <button
                onClick={() => {
                  setCurrentView('appointments');
                  loadAppointments();
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left rounded-xl text-sm transition-all ${currentView === 'appointments'
                  ? 'bg-emerald-100/80 text-emerald-950 font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                  }`}
              >
                <span className="flex items-center">
                  <Calendar className={`w-4 h-4 mr-3 flex-shrink-0 ${currentView === 'appointments' ? 'text-emerald-700' : 'text-slate-400'}`} />
                  Appointments
                </span>
                {(stats.upcoming_appointments_count || 0) > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                    {stats.upcoming_appointments_count}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setCurrentView('current');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left rounded-xl text-sm transition-all ${currentView === 'current'
                  ? 'bg-emerald-100/80 text-emerald-950 font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                  }`}
              >
                <span className="flex items-center">
                  <Users className={`w-4 h-4 mr-3 flex-shrink-0 ${currentView === 'current' ? 'text-emerald-700' : 'text-slate-400'}`} />
                  Patients
                </span>
                {(stats.total_patients || 0) > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-slate-100 text-slate-600">
                    {stats.total_patients}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setCurrentView('new');
                  setFormData({ regno: '', name: '', address: '', phone: '', age: '', whatsapp_opt_in: true });
                  setError(null);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center px-3.5 py-2.5 text-left rounded-xl text-sm transition-all ${currentView === 'new'
                  ? 'bg-emerald-100/80 text-emerald-950 font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                  }`}
              >
                <Plus className={`w-4 h-4 mr-3 flex-shrink-0 ${currentView === 'new' ? 'text-emerald-700' : 'text-slate-400'}`} />
                New Registration
              </button>

              <button
                onClick={() => {
                  setCurrentView('announcements');
                  loadAnnouncements();
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center px-3.5 py-2.5 text-left rounded-xl text-sm transition-all ${currentView === 'announcements'
                  ? 'bg-emerald-100/80 text-emerald-950 font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                  }`}
              >
                <Megaphone className={`w-4 h-4 mr-3 flex-shrink-0 ${currentView === 'announcements' ? 'text-emerald-700' : 'text-slate-400'}`} />
                Announcements
              </button>

              <button
                onClick={handleExportCSV}
                disabled={loading}
                className="w-full flex items-center px-3.5 py-2.5 text-left rounded-xl text-sm text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4 mr-3 flex-shrink-0 text-slate-400" />
                {loading ? 'Exporting...' : 'Export as CSV'}
              </button>
            </div>
          </nav>
        </div>

        {/* User Profile & Clinic Open Status */}
        <div className="p-4 border-t border-slate-100 bg-white space-y-3">
          <div className="flex items-center px-3 py-2 rounded-xl bg-emerald-50/70 border border-emerald-100">
            <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2.5 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-900">Clinic is open</span>
          </div>
          <div className="flex items-center px-1">
            <div className="w-8 h-8 bg-emerald-100 flex items-center justify-center rounded-lg text-emerald-700">
              <User className="w-4 h-4" />
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-semibold text-slate-900 truncate">{currentUser?.username}</p>
              <p className="text-xs text-slate-400">Administrator</p>
            </div>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-full flex items-center px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg transition-colors"
            >
              <Lock className="w-3.5 h-3.5 mr-2" />
              Change Password
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden backdrop-blur-xs"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="bg-white shadow-xs border-b border-slate-200/80 h-16 flex items-center justify-between px-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100"
            >
              <Menu className="w-6 h-6" />
            </button>
            
            {/* Mobile layout */}
            {!sidebarOpen && (
              <div className="lg:hidden flex flex-col">
                <h1 className="text-base font-bold text-slate-900">Kuzhivelil Dental Care</h1>
                <span className="text-slate-500 text-xs font-medium">
                  Welcome, {currentUser?.username}
                </span>
              </div>
            )}
            
            {/* Desktop */}
            <div className="hidden lg:block">
              <span className="text-slate-700 text-sm font-semibold">
                Welcome back, <span className="text-cyan-700">{currentUser?.username}</span>
              </span>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="px-6 pt-4">
          {successMessage && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg flex items-center mb-2 shadow-xs text-sm">
              <span className="flex-1 font-medium">{successMessage}</span>
              <button onClick={() => setSuccessMessage(null)}>
                <X className="w-4 h-4 text-emerald-600 hover:text-emerald-900" />
              </button>
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-lg flex items-center mb-2 shadow-xs text-sm">
              <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 text-rose-600" />
              <span className="flex-1 font-medium">{error}</span>
              <button onClick={() => setError(null)}>
                <X className="w-4 h-4 text-rose-600 hover:text-rose-900" />
              </button>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-[#f6f8f7] px-6 py-6">
          
          {/* Dashboard View */}
          {currentView === 'dashboard' && (
            <div className="space-y-5 max-w-7xl mx-auto">
              {/* Top Greeting & Quick Actions */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                    {getGreetingText()}, {currentUser?.username || 'Admin'}
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">{getTodayFullDate()}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => { setCurrentView('appointments'); loadAppointments(); }}
                    className="inline-flex items-center px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                    Appointments
                  </button>
                  <button
                    onClick={() => setCurrentView('current')}
                    className="inline-flex items-center px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors"
                  >
                    <Users className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                    Patient Records
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView('new');
                      setFormData({ regno: '', name: '', address: '', phone: '', age: '', whatsapp_opt_in: true });
                      setError(null);
                    }}
                    className="inline-flex items-center px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    New Registration
                  </button>
                </div>
              </div>

              {/* Alert Banner */}
              <div className="bg-amber-50/90 border border-amber-200/80 rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center text-sm text-slate-800">
                  <Bell className="w-4 h-4 text-amber-600 mr-2.5 flex-shrink-0" />
                  <span>
                    {(stats.today_appointments || 0) > 0
                      ? `${stats.today_appointments} appointment(s) scheduled for today — automated 5-hour WhatsApp reminders are active.`
                      : `${stats.upcoming_appointments_count || 0} upcoming appointment(s) scheduled. Send patient updates anytime via Announcements.`}
                  </span>
                </div>
                <button
                  onClick={() => { setCurrentView('announcements'); loadAnnouncements(); }}
                  className="inline-flex items-center justify-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  Send announcement
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </button>
              </div>

              {/* 4 KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div
                  onClick={() => { setCurrentView('appointments'); loadAppointments(); }}
                  className="bg-white p-5 border border-slate-200/80 rounded-2xl shadow-xs hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-500">Today&apos;s Appointments</span>
                    <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                      <Calendar className="w-4 h-4" />
                    </span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{stats.today_appointments || 0}</p>
                  <p className="text-xs text-emerald-700 font-medium mt-1.5">
                    {stats.upcoming_appointments_count || 0} total upcoming
                  </p>
                </div>

                <div className="bg-white p-5 border border-slate-200/80 rounded-2xl shadow-xs hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-500">New Patients Today</span>
                    <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                      <User className="w-4 h-4" />
                    </span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{stats.today_registrations || 0}</p>
                  <p className="text-xs text-slate-500 mt-1.5">First visits today</p>
                </div>

                <div className="bg-white p-5 border border-slate-200/80 rounded-2xl shadow-xs hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-500">This Month</span>
                    <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                      <Activity className="w-4 h-4" />
                    </span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{stats.month_registrations || 0}</p>
                  <p className="text-xs text-slate-500 mt-1.5">Registrations this month</p>
                </div>

                <div
                  onClick={() => setCurrentView('current')}
                  className="bg-white p-5 border border-slate-200/80 rounded-2xl shadow-xs hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-500">Total Patients</span>
                    <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                      <Users className="w-4 h-4" />
                    </span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{stats.total_patients || 0}</p>
                  <p className="text-xs text-slate-500 mt-1.5 truncate">
                    Latest: {getLatestRegno()}
                  </p>
                </div>
              </div>

              {/* Analytics + Next Appointments Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* 7-Day Activity Bar Chart */}
                <div className="lg:col-span-7 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-xs flex flex-col justify-between">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">Activity - last 7 days</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {last7Days.length > 0
                          ? `${last7Days[0].label} – ${last7Days[last7Days.length - 1].label} · ${totalChartCount} total`
                          : 'Last 7 days overview'}
                      </p>
                    </div>
                    <div className="inline-flex bg-slate-100 p-1 rounded-xl self-start">
                      {[
                        { key: 'total', label: 'All' },
                        { key: 'registrations', label: 'Patients' },
                        { key: 'appointments', label: 'Appts' }
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => setChartMetric(tab.key)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                            chartMetric === tab.key
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-48 flex items-end justify-between gap-2 sm:gap-4 pt-4 pb-2 border-b border-slate-100">
                    {last7Days.length > 0 ? (
                      last7Days.map((dayItem, idx) => {
                        const val = Number(dayItem[chartMetric] || 0);
                        const pct = Math.max(8, Math.round((val / maxChartValue) * 100));
                        const isPeakOrToday = idx === last7Days.length - 1 || (val > 0 && val === maxChartValue);
                        return (
                          <div key={dayItem.date} className="flex-1 flex flex-col items-center h-full justify-end group">
                            <span className="text-[11px] font-semibold text-slate-600 mb-1.5">{val}</span>
                            <div className="w-full max-w-[36px] flex items-end h-32 bg-slate-50 rounded-t-lg overflow-hidden">
                              <div
                                style={{ height: `${val === 0 ? 6 : pct}%` }}
                                className={`w-full rounded-t-lg transition-all duration-300 ${
                                  isPeakOrToday ? 'bg-emerald-500' : 'bg-emerald-200/80 group-hover:bg-emerald-300'
                                }`}
                                title={`${dayItem.full_day} (${dayItem.label}): ${val}`}
                              />
                            </div>
                            <span className={`text-xs mt-2 font-medium ${idx === last7Days.length - 1 ? 'text-emerald-700 font-bold' : 'text-slate-500'}`}>
                              {dayItem.day}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="w-full text-center text-sm text-slate-400 self-center">Loading 7-day activity...</div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 text-xs text-slate-500">
                    <span className="flex items-center">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                      {chartMetric === 'total' ? 'Registrations & appointments' : chartMetric === 'registrations' ? 'New patient registrations' : 'Scheduled appointments'}
                    </span>
                    <span className="font-medium text-slate-700">
                      Peak: {peakDay.full_day} ({peakDay[chartMetric] || 0})
                    </span>
                  </div>
                </div>

                {/* Next Upcoming Appointments Card */}
                <div className="lg:col-span-5 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">Next appointments</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {stats.upcoming_appointments_count || 0} upcoming
                        </p>
                      </div>
                      <button
                        onClick={() => { setCurrentView('appointments'); loadAppointments(); }}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center"
                      >
                        View all
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(stats.next_appointments && stats.next_appointments.length > 0) ? (
                        stats.next_appointments.map((appt) => (
                          <div key={appt._id} className="py-3 flex items-center justify-between gap-3">
                            <div className="flex items-center min-w-0">
                              <div className="w-9 h-9 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center flex-shrink-0 mr-3">
                                {getInitials(appt.patient_name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">{appt.patient_name}</p>
                                <p className="text-xs text-slate-500 truncate">
                                  {formatAppointmentDateWithDay(appt.date)}
                                  {appt.doctor_name ? ` · ${appt.doctor_name}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs font-semibold text-slate-700 inline-flex items-center">
                                <Clock className="w-3 h-3 mr-1 text-slate-400" />
                                {formatAppointmentTime12h(appt.time)}
                              </span>
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-700">
                                Scheduled
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-10 text-center text-slate-400 text-sm">
                          No upcoming appointments scheduled.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Patients Table */}
              <div className="bg-white shadow-xs border border-slate-200/80 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">Recent Patients</h3>
                  <button
                    onClick={() => setCurrentView('current')}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center"
                  >
                    See all records
                    <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Reg No</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Phone</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Age</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {(stats.latest_patients && stats.latest_patients.length > 0) ? (
                        stats.latest_patients.map((patient) => (
                          <tr key={patient.regno} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-900 font-semibold">{patient.regno}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-800 font-medium">{patient.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{patient.phone || 'N/A'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{patient.age}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                              {formatDate(patient.created_at || patient.date)}
                            </td>
                          </tr>
                        ))
                      ) : patients.length > 0 ? (
                        patients.slice(0, 5).map((patient) => (
                          <tr key={patient.regno} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-900 font-semibold">{patient.regno}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-800 font-medium">{patient.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{patient.phone || 'N/A'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{patient.age}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                              {formatDate(patient.created_at || patient.date)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="px-6 py-8 text-center text-slate-400 text-sm">
                            No patients registered yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* New Registration Form */}
          {currentView === 'new' && (
            <div className="max-w-4xl mx-auto">
              <div className="bg-white shadow-xs p-8 border border-slate-200/80 rounded-2xl">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">New Patient Registration</h2>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Registration Number *</label>
                      <input
                        type="text"
                        name="regno"
                        value={formData.regno}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm placeholder-slate-400 transition-all"
                        placeholder="e.g., REG001"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Name *</label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm placeholder-slate-400 transition-all"
                        placeholder="Patient name"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Age *</label>
                      <input
                        type="number"
                        name="age"
                        value={formData.age}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm placeholder-slate-400 transition-all"
                        placeholder="Age"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Phone Number</label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm placeholder-slate-400 transition-all"
                        placeholder="10 digit phone number (optional)"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Address</label>
                    <textarea
                      name="address"
                      value={formData.address}
                      onChange={handleInputChange}
                      rows="3"
                      className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm placeholder-slate-400 transition-all"
                      placeholder="Full address (optional)"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      id="new-whatsapp-opt-in"
                      type="checkbox"
                      checked={formData.whatsapp_opt_in !== false}
                      onChange={(e) => setFormData({ ...formData, whatsapp_opt_in: e.target.checked })}
                      className="h-4 w-4 text-cyan-600 border-slate-300 rounded focus:ring-cyan-500"
                    />
                    <label htmlFor="new-whatsapp-opt-in" className="text-sm text-slate-700">
                      Patient opted in for WhatsApp reminders & clinic announcements
                    </label>
                  </div>

                  <div className="flex space-x-4 pt-4">
                    <button
                      onClick={() => setCurrentView('dashboard')}
                      className="px-6 py-3 border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors rounded-lg text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreatePatient}
                      disabled={!formData.name || !formData.age || !formData.regno || loading}
                      className="px-6 py-3 bg-cyan-600 text-white font-semibold hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-all rounded-lg shadow-sm text-sm"
                    >
                      Register Patient
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Patient Records View */}
          {currentView === 'current' && (
            <div className="space-y-6 h-full flex flex-col">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Patient Records</h2>
                  {searchMode && (
                    <p className="text-xs font-semibold text-cyan-600 mt-1">
                      Search results for "{searchQuery}" ({totalCount} found)
                    </p>
                  )}
                </div>
                
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={handleSearchInput}
                    placeholder="Search: name, phone, or reg no..."
                    className="pl-10 pr-12 py-2.5 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 w-full sm:w-80 bg-white rounded-lg text-slate-900 text-sm placeholder-slate-400 transition-all shadow-xs"
                  />
                  {searchTerm && (
                    <button
                      onClick={clearSearch}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Table container */}
              <div className="flex-1 bg-white shadow-xs border border-slate-200/80 rounded-xl flex flex-col max-h-[calc(100vh-200px)] overflow-hidden">
                <div className="flex-1 overflow-auto min-h-[500px]">
                  <table className="w-full">
                    <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Reg No</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Address</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Phone</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Age</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {patients.length > 0 ? (
                        patients.map((patient) => (
                          <tr key={patient.regno} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-900 font-semibold">{patient.regno}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-800 font-medium">{patient.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{patient.address || 'N/A'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{patient.phone || 'N/A'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{patient.age}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">{formatDate(patient.date || patient.created_at)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                              <div className="flex justify-end space-x-1">
                                <button
                                  onClick={() => {
                                    setApptPatient(patient);
                                    setApptModalError(null);
                                  }}
                                  className="inline-flex items-center p-2 text-cyan-600 hover:bg-cyan-50 transition-colors rounded-lg"
                                  title="Book Appointment"
                                >
                                  <Calendar className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleEdit(patient)}
                                  className="inline-flex items-center p-2 text-slate-600 hover:bg-slate-100 transition-colors rounded-lg"
                                  title="Edit Record"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setPatientToDelete(patient);
                                    setShowDeleteModal(true);
                                  }}
                                  className="inline-flex items-center p-2 text-rose-600 hover:bg-rose-50 transition-colors rounded-lg"
                                  title="Delete Record"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="7" className="px-6 py-12 text-center text-slate-400">
                            <div className="flex flex-col items-center">
                              <Users className="w-12 h-12 text-slate-300 mb-3" />
                              <p className="text-base font-semibold text-slate-700">
                                {searchMode ? 'No search results found' : 'No patients found'}
                              </p>
                              <p className="text-sm text-slate-500 mt-1">
                                {searchMode 
                                  ? `No patients match "${searchQuery}"`
                                  : 'No patients registered yet'
                                }
                              </p>
                              {searchMode && (
                                <button
                                  onClick={clearSearch}
                                  className="mt-4 px-4 py-2 bg-cyan-600 text-white font-medium hover:bg-cyan-700 transition-colors rounded-lg shadow-xs text-sm"
                                >
                                  Clear Search
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="border-t border-slate-200 bg-white px-6 py-3.5">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                      <div className="text-xs font-medium text-slate-500">
                        Showing {((currentPage - 1) * 50) + 1} to {Math.min(currentPage * 50, totalCount)} of {totalCount} patients
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => handlePageChange(1)}
                          disabled={currentPage === 1}
                          className="px-2.5 py-1.5 bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
                        >
                          First
                        </button>
                        <button
                          onClick={() => handlePageChange(currentPage - 1)}
                          disabled={currentPage === 1}
                          className="px-3 py-1.5 bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
                        >
                          Previous
                        </button>
                        
                        <div className="flex items-center space-x-1">
                          {(() => {
                            const pages = [];
                            const start = Math.max(1, currentPage - 2);
                            const end = Math.min(totalPages, currentPage + 2);
                            
                            for (let i = start; i <= end; i++) {
                              pages.push(
                                <button
                                  key={i}
                                  onClick={() => handlePageChange(i)}
                                  className={`px-3 py-1.5 text-xs transition-colors rounded-md font-medium ${
                                    i === currentPage
                                      ? 'bg-cyan-600 text-white font-bold'
                                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {i}
                                </button>
                              );
                            }
                            return pages;
                          })()}
                        </div>
                        
                        <button
                          onClick={() => handlePageChange(currentPage + 1)}
                          disabled={currentPage === totalPages}
                          className="px-3 py-1.5 bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
                        >
                          Next
                        </button>
                        <button
                          onClick={() => handlePageChange(totalPages)}
                          disabled={currentPage === totalPages}
                          className="px-2.5 py-1.5 bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-md"
                        >
                          Last
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Appointments View */}
          {currentView === 'appointments' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Appointments</h2>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input
                    type="text"
                    onChange={(e) => loadAppointments(e.target.value)}
                    placeholder="Search appointments..."
                    className="pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 w-full sm:w-64 bg-white text-slate-900 text-sm placeholder-slate-400 transition-all shadow-xs"
                  />
                </div>
              </div>

              <div className="bg-white shadow-xs border border-slate-200/80 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Patient Name</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Reg No</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Time</th>
                        <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {groupedAppointments.length > 0 ? (
                        groupedAppointments.map(([dateKey, dayAppts]) => {
                          const hasMultiple = dayAppts.length > 1;
                          const isExpanded = !hasMultiple || !!expandedApptDates[dateKey];

                          return (
                            <React.Fragment key={dateKey}>
                              {hasMultiple && (
                                <tr
                                  onClick={() => toggleAppointmentDate(dateKey)}
                                  className="bg-emerald-50/60 hover:bg-emerald-50 cursor-pointer transition-colors"
                                >
                                  <td colSpan="5" className="px-6 py-3.5 text-xs">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center space-x-2.5">
                                        {isExpanded ? (
                                          <ChevronDown className="w-4 h-4 text-emerald-700" />
                                        ) : (
                                          <ChevronRight className="w-4 h-4 text-emerald-700" />
                                        )}
                                        <Calendar className="w-4 h-4 text-emerald-600" />
                                        <span className="font-bold text-slate-900 text-sm">{formatAppointmentDateWithDay(dateKey)}</span>
                                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-xs">
                                          {dayAppts.length} Appointments
                                        </span>
                                      </div>
                                      <span className="text-xs font-medium text-emerald-700">
                                        {isExpanded ? 'Click to collapse' : 'Click to view appointments'}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              )}

                              {isExpanded &&
                                dayAppts.map((appt) => (
                                  <tr
                                    key={appt._id || `${appt.regno}-${appt.date}-${appt.time}`}
                                    className={`hover:bg-slate-50/80 transition-colors ${hasMultiple ? 'bg-slate-50/30' : ''}`}
                                  >
                                    <td className={`px-6 py-4 whitespace-nowrap text-xs text-slate-900 font-semibold ${hasMultiple ? 'pl-12' : ''}`}>
                                      {appt.patient_name || 'Unknown'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">{appt.regno}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600 font-medium">{formatAppointmentDateWithDay(appt.date)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs font-bold text-emerald-700">
                                      {formatAppointmentTime12h(appt.time)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                      <div className="flex justify-end space-x-1">
                                        <button
                                          onClick={() => {
                                            setRescheduleAppt(appt);
                                            setRescheduleData({ date: appt.date || '', time: appt.time || '' });
                                          }}
                                          className="inline-flex items-center p-2 text-cyan-600 hover:bg-cyan-50 transition-colors rounded-lg"
                                          title="Reschedule Appointment"
                                        >
                                          <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteAppointment(appt._id)}
                                          className="inline-flex items-center p-2 text-rose-600 hover:bg-rose-50 transition-colors rounded-lg"
                                          title="Cancel Appointment"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                            </React.Fragment>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="5" className="px-6 py-12 text-center text-slate-400 text-sm">
                            No appointments found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Announcements View */}
          {currentView === 'announcements' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Clinic Announcements</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Broadcast WhatsApp template announcements to opted-in patients ({optedInCount} opted-in with valid phone).
                  </p>
                </div>
              </div>

              <div className="bg-white shadow-xs p-6 md:p-8 border border-slate-200/80 rounded-2xl">
                <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center">
                  <Megaphone className="w-5 h-5 mr-2 text-cyan-600" />
                  Send New Announcement
                </h3>
                <form onSubmit={handleSendAnnouncement} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Title</label>
                      <input
                        type="text"
                        value={announcementForm.title}
                        onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600"
                        placeholder="e.g., Holiday Notice"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Closure / Effective Date *</label>
                      <input
                        type="date"
                        value={announcementForm.closure_date}
                        onChange={(e) => setAnnouncementForm({ ...announcementForm, closure_date: e.target.value })}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Reopening Date</label>
                      <input
                        type="date"
                        value={announcementForm.reopening_date}
                        onChange={(e) => setAnnouncementForm({ ...announcementForm, reopening_date: e.target.value })}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Announcement Reason / Message *</label>
                    <textarea
                      rows="3"
                      value={announcementForm.reason}
                      onChange={(e) => setAnnouncementForm({ ...announcementForm, reason: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600"
                      placeholder="e.g., Clinic closed for Onam holiday / updated working hours..."
                      required
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-slate-700">Recipients (Opted-In Patients Only)</label>
                    <div className="flex flex-wrap gap-4">
                      <label className="inline-flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                        <input
                          type="radio"
                          name="target_mode"
                          value="all_opted_in"
                          checked={announcementForm.target_mode === 'all_opted_in'}
                          onChange={() => setAnnouncementForm({ ...announcementForm, target_mode: 'all_opted_in', regnos: [] })}
                          className="text-cyan-600 focus:ring-cyan-500"
                        />
                        <span>All Opted-In Patients ({optedInPatients.length})</span>
                      </label>
                      <label className="inline-flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                        <input
                          type="radio"
                          name="target_mode"
                          value="selected"
                          checked={announcementForm.target_mode === 'selected'}
                          onChange={() => setAnnouncementForm({ ...announcementForm, target_mode: 'selected' })}
                          className="text-cyan-600 focus:ring-cyan-500"
                        />
                        <span>Selected Opted-In Patients ({announcementForm.regnos.length} selected)</span>
                      </label>
                    </div>

                    {announcementForm.target_mode === 'selected' && (
                      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3">
                        <div className="flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
                          <input
                            type="text"
                            value={announcementSearch}
                            onChange={(e) => setAnnouncementSearch(e.target.value)}
                            placeholder="Filter patients by name, regno, or phone..."
                            className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 w-full sm:w-72"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setAnnouncementForm({
                                ...announcementForm,
                                regnos: optedInPatients.map((p) => p.regno)
                              })}
                              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() => setAnnouncementForm({ ...announcementForm, regnos: [] })}
                              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 bg-white rounded-lg border border-slate-200">
                          {optedInPatients
                            .filter((p) => {
                              const q = announcementSearch.trim().toLowerCase();
                              if (!q) return true;
                              return (
                                (p.name || '').toLowerCase().includes(q) ||
                                (p.regno || '').toLowerCase().includes(q) ||
                                (p.phone || '').toLowerCase().includes(q)
                              );
                            })
                            .map((p) => (
                              <label
                                key={p.regno}
                                className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                              >
                                <span className="flex items-center space-x-2.5">
                                  <input
                                    type="checkbox"
                                    checked={announcementForm.regnos.includes(p.regno)}
                                    onChange={() => handleToggleAnnouncementPatient(p.regno)}
                                    className="h-4 w-4 text-cyan-600 border-slate-300 rounded"
                                  />
                                  <span className="font-semibold text-slate-800">{p.name}</span>
                                  <span className="text-slate-500">({p.regno})</span>
                                </span>
                                <span className="text-slate-500">{p.phone}</span>
                              </label>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={loading || !announcementForm.closure_date || !announcementForm.reason.trim()}
                      className="inline-flex items-center px-6 py-2.5 bg-cyan-600 text-white font-semibold rounded-lg hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors text-sm shadow-xs"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      {loading ? 'Sending...' : 'Send Announcement'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white shadow-xs border border-slate-200/80 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-base font-bold text-slate-900">Recent Announcements</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Effective Date</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Reason</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Reopening</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Sent / Total</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {announcements.length > 0 ? (
                        announcements.map((item) => (
                          <tr key={item.broadcast_id || item._id} className="hover:bg-slate-50/80">
                            <td className="px-6 py-3.5 text-xs font-medium text-slate-800 whitespace-nowrap">{item.closure_date}</td>
                            <td className="px-6 py-3.5 text-xs text-slate-700">{item.reason}</td>
                            <td className="px-6 py-3.5 text-xs text-slate-500 whitespace-nowrap">{item.reopening_date}</td>
                            <td className="px-6 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                              {item.sent_count || 0} / {item.total_recipients || 0}
                            </td>
                            <td className="px-6 py-3.5 text-xs whitespace-nowrap">
                              <span className="px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-700 font-medium">
                                {item.failed_count > 0 ? `${item.failed_count} failed` : 'Recorded'}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="px-6 py-10 text-center text-slate-400 text-sm">
                            No announcements sent yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Edit Patient Form */}
          {currentView === 'edit' && selectedPatient && (
            <div className="max-w-4xl mx-auto">
              <div className="bg-white shadow-xs p-8 border border-slate-200/80 rounded-2xl">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">Edit Patient Record - {selectedPatient.regno}</h2>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Registration Number</label>
                      <input
                        type="text"
                        value={formData.regno}
                        className="w-full px-4 py-3 border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed rounded-lg text-sm"
                        disabled
                      />
                      <p className="text-xs text-slate-400 mt-1">Registration number cannot be changed</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Name</label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Age</label>
                      <input
                        type="number"
                        name="age"
                        value={formData.age}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Phone Number</label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Address</label>
                    <textarea
                      name="address"
                      value={formData.address}
                      onChange={handleInputChange}
                      rows="3"
                      className="w-full px-4 py-3 border border-slate-300 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600 bg-white rounded-lg text-slate-900 text-sm transition-all"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      id="edit-whatsapp-opt-in"
                      type="checkbox"
                      checked={formData.whatsapp_opt_in !== false}
                      onChange={(e) => setFormData({ ...formData, whatsapp_opt_in: e.target.checked })}
                      className="h-4 w-4 text-cyan-600 border-slate-300 rounded focus:ring-cyan-500"
                    />
                    <label htmlFor="edit-whatsapp-opt-in" className="text-sm text-slate-700">
                      Patient opted in for WhatsApp reminders & clinic announcements
                    </label>
                  </div>

                  <div className="flex space-x-4 pt-4">
                    <button
                      onClick={() => {
                        setSelectedPatient(null);
                        setCurrentView('current');
                      }}
                      className="px-6 py-3 border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors rounded-lg text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpdatePatient}
                      disabled={loading}
                      className="px-6 py-3 bg-cyan-600 text-white font-semibold hover:bg-cyan-700 disabled:bg-slate-200 transition-all rounded-lg shadow-sm text-sm"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Appointment Modal */}
      {apptPatient && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl border border-slate-200">
            <h3 className="text-xl font-bold text-slate-900 mb-1">Book Appointment</h3>
            <p className="text-slate-500 text-xs mb-4">Scheduling for: <span className="font-semibold text-cyan-700">{apptPatient.name}</span></p>
            {apptModalError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center text-xs">
                <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                <span>{apptModalError}</span>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase">Select Date</label>
                <input type="date" className="w-full mt-1.5 p-3 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600" value={apptData.date} onChange={e => setApptData({...apptData, date: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase">Select Time</label>
                <input type="time" className="w-full mt-1.5 p-3 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600" value={apptData.time} onChange={e => setApptData({...apptData, time: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase">Doctor Name (Optional)</label>
                <input type="text" placeholder="e.g., Dr. Kuzhivelil" className="w-full mt-1.5 p-3 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600" value={apptData.doctor_name} onChange={e => setApptData({...apptData, doctor_name: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => { setApptPatient(null); setApptModalError(null); }} disabled={loading} className="flex-1 py-2.5 font-medium text-slate-600 hover:bg-slate-100 rounded-xl text-sm transition-colors border border-slate-200 disabled:opacity-50">Cancel</button>
              <button onClick={handleBookAppt} disabled={loading} className="flex-1 py-2.5 font-semibold bg-cyan-600 text-white rounded-xl shadow-md hover:bg-cyan-700 text-sm transition-colors disabled:opacity-50">{loading ? 'Booking...' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Appointment Modal */}
      {rescheduleAppt && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl border border-slate-200">
            <h3 className="text-xl font-bold text-slate-900 mb-1">Reschedule Appointment</h3>
            <p className="text-slate-500 text-xs mb-6">Updating for: <span className="font-semibold text-cyan-700">{rescheduleAppt.patient_name || rescheduleAppt.regno}</span></p>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase">New Date</label>
                <input type="date" className="w-full mt-1.5 p-3 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600" value={rescheduleData.date} onChange={e => setRescheduleData({...rescheduleData, date: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase">New Time</label>
                <input type="time" className="w-full mt-1.5 p-3 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600" value={rescheduleData.time} onChange={e => setRescheduleData({...rescheduleData, time: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setRescheduleAppt(null)} className="flex-1 py-2.5 font-medium text-slate-600 hover:bg-slate-100 rounded-xl text-sm transition-colors border border-slate-200">Cancel</button>
              <button onClick={handleRescheduleAppt} className="flex-1 py-2.5 font-semibold bg-cyan-600 text-white rounded-xl shadow-md hover:bg-cyan-700 text-sm transition-colors">Update</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && patientToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-rose-50 flex items-center justify-center mr-4 rounded-xl text-rose-600">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Delete Patient Record</h3>
                <p className="text-xs text-slate-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-slate-600 text-sm mb-6">
              Are you sure you want to delete <strong className="text-slate-900">{patientToDelete.name}</strong> ({patientToDelete.regno})?
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setPatientToDelete(null);
                }}
                disabled={loading}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePatient}
                disabled={loading}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:bg-slate-200 text-sm font-semibold transition-colors shadow-xs"
              >
                {loading ? 'Deleting...' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        onSubmit={handleChangePassword}
        loading={loading}
      />
    </div>
  );
}

export default App;