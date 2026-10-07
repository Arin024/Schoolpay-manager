import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, School, SchoolSettings, UserRole } from '../types/index.js';
import { api } from '../services/api.js';

interface AuthContextType {
  user: User | null;
  roles: UserRole[];
  activeRole: UserRole | null;
  activeSchoolId: string | null;
  activeSchool: School | null;
  activeSettings: SchoolSettings | null;
  isLoading: boolean;
  isSuperAdmin: boolean;
  isSchoolOwner: boolean;
  isBursar: boolean;
  login: (credentials: { email: string; password: string; schoolId?: string }) => Promise<void>;
  registerSchoolSuccess: (data: any) => void;
  logout: () => Promise<void>;
  switchSchool: (schoolId: string) => Promise<void>;
  refreshMe: () => Promise<void>;
  setActiveSchool: React.Dispatch<React.SetStateAction<School | null>>;
  setActiveSettings: React.Dispatch<React.SetStateAction<SchoolSettings | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null);
  const [activeSchool, setActiveSchool] = useState<School | null>(null);
  const [activeSettings, setActiveSettings] = useState<SchoolSettings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const initAuth = async () => {
    const token = localStorage.getItem('schoolpay_session_token');
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      const data = await api.getMe();
      setUser(data.user);
      setRoles(data.roles || []);
      
      const storedSchoolId = localStorage.getItem('schoolpay_active_school');
      const schoolIdToUse = storedSchoolId || data.activeSchoolId || (data.roles[0]?.school_id ?? null);
      
      setActiveSchoolId(schoolIdToUse);
      setActiveSchool(data.activeSchool || null);
      setActiveSettings(data.activeSettings || null);

      if (data.roles && data.roles.length > 0) {
        const matched = data.roles.find((r: UserRole) => r.school_id === schoolIdToUse) || data.roles[0];
        setActiveRole(matched);
      }
    } catch (err) {
      console.warn('Session verification failed, logging out:', err);
      localStorage.removeItem('schoolpay_session_token');
      localStorage.removeItem('schoolpay_active_school');
      setUser(null);
      setRoles([]);
      setActiveRole(null);
      setActiveSchool(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initAuth();
  }, []);

  const login = async (credentials: { email: string; password: string; schoolId?: string }) => {
    const data = await api.login(credentials);
    localStorage.setItem('schoolpay_session_token', data.token);
    
    setUser(data.user);
    setRoles(data.roles || []);
    setActiveRole(data.activeRole || null);
    
    if (data.activeSchoolId) {
      localStorage.setItem('schoolpay_active_school', data.activeSchoolId);
      setActiveSchoolId(data.activeSchoolId);
      // Fetch school details
      try {
        const schoolDetails = await api.getSchoolProfile(data.activeSchoolId);
        setActiveSchool(schoolDetails.school);
        setActiveSettings(schoolDetails.settings);
      } catch (e) {
        console.error('Error fetching initial school profile:', e);
      }
    } else {
      setActiveSchoolId(null);
      setActiveSchool(null);
      setActiveSettings(null);
    }
  };

  const registerSchoolSuccess = (data: any) => {
    localStorage.setItem('schoolpay_session_token', data.token);
    localStorage.setItem('schoolpay_active_school', data.school.id);
    setUser(data.user);
    setActiveSchoolId(data.school.id);
    setActiveSchool(data.school);
    setActiveRole(data.activeRole);
    setRoles([
      {
        id: 'ur_' + data.school.id,
        user_id: data.user.id,
        school_id: data.school.id,
        role_id: 'role_school_owner',
        role_name: 'SCHOOL_OWNER',
        role_display_name: 'School Proprietor / Owner',
        role_scope: 'SCHOOL',
        is_primary: 1,
        school_name: data.school.name,
        school_status: data.school.status,
      },
    ]);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    setRoles([]);
    setActiveRole(null);
    setActiveSchoolId(null);
    setActiveSchool(null);
    setActiveSettings(null);
  };

  const switchSchool = async (schoolId: string) => {
    const matched = roles.find((r) => r.school_id === schoolId);
    if (!matched) return;

    localStorage.setItem('schoolpay_active_school', schoolId);
    setActiveSchoolId(schoolId);
    setActiveRole(matched);

    try {
      const details = await api.getSchoolProfile(schoolId);
      setActiveSchool(details.school);
      setActiveSettings(details.settings);
    } catch (e) {
      console.error('Failed to switch school profile:', e);
    }
  };

  const refreshMe = async () => {
    if (!activeSchoolId) return;
    try {
      const details = await api.getSchoolProfile(activeSchoolId);
      setActiveSchool(details.school);
      setActiveSettings(details.settings);
    } catch (e) {
      console.error('Failed to refresh school profile:', e);
    }
  };

  const isSuperAdmin = Boolean(user && user.is_platform_admin === 1);
  const isSchoolOwner = activeRole?.role_name === 'SCHOOL_OWNER';
  const isBursar = activeRole?.role_name === 'BURSAR';

  return (
    <AuthContext.Provider
      value={{
        user,
        roles,
        activeRole,
        activeSchoolId,
        activeSchool,
        activeSettings,
        isLoading,
        isSuperAdmin,
        isSchoolOwner,
        isBursar,
        login,
        registerSchoolSuccess,
        logout,
        switchSchool,
        refreshMe,
        setActiveSchool,
        setActiveSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
