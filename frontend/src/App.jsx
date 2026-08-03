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
  Download // Add Download icon
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
    // Modals / Selection
  
  const [apptPatient, setApptPatient] = useState(null); // NEW: For Appointment Modal
  const [apptData, setApptData] = useState({ date: '', time: '' });

  // Form state
  const [formData, setFormData] = useState({
    regno: '',
    name: '',
    address: '',
    phone: '',
    age: ''
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

  const handleBookAppt = async () => {
    if (!apptPatient || !apptData.date || !apptData.time) {
      setError("Please fill all fields");
      return;
    }

    try {
      setLoading(true);
      const result = await api.createAppointment({
        regno: apptPatient.regno,
        date: apptData.date,
        time: apptData.time
      });

      if (result.success) {
        showSuccess("Appointment booked successfully!");
        setApptPatient(null);
        setApptData({ date: '', time: '' });
        if (currentView === 'appointments') loadAppointments();
        loadDashboardStats();
      } else {
        setError(result.error || "Failed to book appointment");
      }
    } catch (err) {
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
        setFormData({ regno: '', name: '', address: '', phone: '', age: '' });
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
      age: patient.age
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
    if (!window.confirm('Are you sure you want to delete this appointment?')) return;

    try {
      setLoading(true);
      const result = await api.deleteAppointment(id);
      if (result.success) {
        showSuccess('Appointment deleted successfully');
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
  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-64 bg-white text-slate-800 shadow-xl border-r border-slate-200/80 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}>
        <div className="flex items-center justify-start h-16 px-5 bg-white border-b border-slate-200">
          <div className="w-8 h-8 mr-3 flex items-center justify-center">
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
          <div className="flex flex-col">
            <h1 className="text-slate-900 text-base font-bold">Kuzhivelil Dental Care</h1>
          </div>
        </div>

        <nav className="mt-6">
          <div className="px-3 space-y-1.5">
            <button
              onClick={() => {
                setCurrentView('dashboard');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center px-4 py-3 text-left rounded-lg text-sm transition-all ${currentView === 'dashboard'
                ? 'bg-cyan-50 text-cyan-700 font-bold border-l-4 border-cyan-600 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                }`}
            >
              <Home className="w-5 h-5 mr-3 flex-shrink-0" />
              Dashboard
            </button>

            <button
              onClick={() => {
                setCurrentView('new');
                setFormData({ regno: '', name: '', address: '', phone: '', age: '' });
                setError(null);
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center px-4 py-3 text-left rounded-lg text-sm transition-all ${currentView === 'new'
                ? 'bg-cyan-50 text-cyan-700 font-bold border-l-4 border-cyan-600 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                }`}
            >
              <Plus className="w-5 h-5 mr-3 flex-shrink-0" />
              New Registration
            </button>

            <button
              onClick={() => {
                setCurrentView('current');
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center px-4 py-3 text-left rounded-lg text-sm transition-all ${currentView === 'current'
                ? 'bg-cyan-50 text-cyan-700 font-bold border-l-4 border-cyan-600 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                }`}
            >
              <Users className="w-5 h-5 mr-3 flex-shrink-0" />
              Patient Records
            </button>

            <button
              onClick={() => {
                setCurrentView('appointments');
                loadAppointments();
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center px-4 py-3 text-left rounded-lg text-sm transition-all ${currentView === 'appointments'
                ? 'bg-cyan-50 text-cyan-700 font-bold border-l-4 border-cyan-600 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                }`}
            >
              <Calendar className="w-5 h-5 mr-3 flex-shrink-0" />
              Appointments
            </button>

            {/* Export CSV button */}
            <button
              onClick={handleExportCSV}
              disabled={loading}
              className="w-full flex items-center px-4 py-3 text-left rounded-lg text-sm text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5 mr-3 flex-shrink-0" />
              {loading ? 'Exporting...' : 'Export as CSV'}
            </button>
          </div>
        </nav>

        {/* User Profile Section */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200 bg-slate-50/80">
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-cyan-100 flex items-center justify-center rounded-lg text-cyan-700">
              <User className="w-4 h-4" />
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-semibold text-slate-900 truncate">{currentUser?.username}</p>
              <p className="text-xs text-slate-500">Administrator</p>
            </div>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-full flex items-center px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 rounded-md transition-colors"
            >
              <Lock className="w-3.5 h-3.5 mr-2" />
              Change Password
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded-md transition-colors"
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
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50/70 px-6 py-6">
          
          {/* Dashboard View */}
          {currentView === 'dashboard' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard Overview</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white shadow-xs p-6 border border-slate-200/80 rounded-xl hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">Total Patients</p>
                      <p className="text-3xl font-bold text-slate-900 mt-2">{stats.total_patients || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-cyan-50 flex items-center justify-center rounded-xl text-cyan-600">
                      <Users className="w-6 h-6" />
                    </div>
                  </div>
                </div>

                <div className="bg-white shadow-xs p-6 border border-slate-200/80 rounded-xl hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">Today's Registrations</p>
                      <p className="text-3xl font-bold text-slate-900 mt-2">{stats.today_registrations || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-blue-50 flex items-center justify-center rounded-xl text-blue-600">
                      <Calendar className="w-6 h-6" />
                    </div>
                  </div>
                </div>

                <div className="bg-white shadow-xs p-6 border border-slate-200/80 rounded-xl hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">This Month</p>
                      <p className="text-3xl font-bold text-slate-900 mt-2">{stats.month_registrations || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-indigo-50 flex items-center justify-center rounded-xl text-indigo-600">
                      <Activity className="w-6 h-6" />
                    </div>
                  </div>
                </div>

                <div className="bg-white shadow-xs p-6 border border-slate-200/80 rounded-xl cursor-pointer hover:bg-slate-50 transition-all border-l-4 border-l-cyan-600" onClick={() => { setCurrentView('appointments'); loadAppointments(); }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">Today's Appointments</p>
                      <p className="text-3xl font-bold text-cyan-700 mt-2">{stats.today_appointments || 0}</p>
                    </div>
                    <div className="w-12 h-12 bg-cyan-50 flex items-center justify-center rounded-xl text-cyan-600">
                      <Calendar className="w-6 h-6" />
                    </div>
                  </div>
                </div>

                <div className="bg-white shadow-xs p-6 border border-slate-200/80 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">Latest Registration</p>
                      <p className="text-xl font-bold text-slate-900 mt-1">{getLatestRegno()}</p>
                      {getLatestPatient() && (
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          {getLatestPatient().name} - {formatDate(getLatestPatient().date || getLatestPatient().created_at)}
                        </p>
                      )}
                    </div>
                    <div className="w-12 h-12 bg-sky-50 flex items-center justify-center rounded-xl text-sky-600">
                      <Plus className="w-6 h-6" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white shadow-xs border border-slate-200/80 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200/80 bg-white">
                  <h3 className="text-lg font-bold text-slate-900">Recent Patients</h3>
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
                                  onClick={() => setApptPatient(patient)}
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
                      {appointments.length > 0 ? (
                        appointments.map((appt, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-900 font-semibold">
                              {appt.patient_name || 'Unknown'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">{appt.regno}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600 font-medium">{appt.date}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-xs font-bold text-cyan-700">
                              {appt.time}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                              <button
                                onClick={() => handleDeleteAppointment(appt._id)}
                                className="inline-flex items-center p-2 text-rose-600 hover:bg-rose-50 transition-colors rounded-lg"
                                title="Delete Appointment"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
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
            <p className="text-slate-500 text-xs mb-6">Scheduling for: <span className="font-semibold text-cyan-700">{apptPatient.name}</span></p>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase">Select Date</label>
                <input type="date" className="w-full mt-1.5 p-3 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600" value={apptData.date} onChange={e => setApptData({...apptData, date: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase">Select Time</label>
                <input type="time" className="w-full mt-1.5 p-3 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-600" value={apptData.time} onChange={e => setApptData({...apptData, time: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setApptPatient(null)} className="flex-1 py-2.5 font-medium text-slate-600 hover:bg-slate-100 rounded-xl text-sm transition-colors border border-slate-200">Cancel</button>
              <button onClick={handleBookAppt} className="flex-1 py-2.5 font-semibold bg-cyan-600 text-white rounded-xl shadow-md hover:bg-cyan-700 text-sm transition-colors">Confirm</button>
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