const API_BASE = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/api`
  : 'https://dentalkuzhinewwfinnal.onrender.com/api';

// Token management functions
export const getStoredToken = () => localStorage.getItem('auth_token');
export const setStoredToken = (token) => localStorage.setItem('auth_token', token);
export const removeStoredToken = () => localStorage.removeItem('auth_token');

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

    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers
      });
    } catch (error) {
      throw new Error('Network error: Failed to connect to the server. Please check your connection.');
    }

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
      let response;
      try {
        response = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(credentials)
        });
      } catch (error) {
        throw new Error('Network error: Cannot connect to the server. Please try again later.');
      }

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

  createAppointment: async (appointmentData) => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments`, {
      method: 'POST',
      body: JSON.stringify(appointmentData)
    });
    return await response.json();
  },

  getAppointments: async (search = '') => {
    const params = new URLSearchParams(search ? { search } : {});
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments?${params}`);
    return await response.json();
  },

  updateAppointment: async (id, apptData) => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(apptData)
    });
    return await response.json();
  },

  deleteAppointment: async (id) => {
    const response = await api.makeAuthenticatedRequest(`${API_BASE}/appointments/${id}`, {
      method: 'DELETE'
    });
    return await response.json();
  },

  exportPatients: async () => {
    try {
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

export default api;
