import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, HttpError } from './api';
import type { NavKey, Role } from '@shared/domain';
import { canAccess } from '@shared/domain';

export type User = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  managerId: string | null;
  managerName: string | null;
  roles: Role[];
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (key: NavKey) => boolean;
  hasRole: (role: Role) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: User | null }>('/auth/me');
      setUser(res.user);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) {
        console.error(error);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      refresh,
      can: (key: NavKey) => (user ? canAccess(user.roles, key) : false),
      hasRole: (role: Role) => !!user?.roles.includes(role),
    }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
