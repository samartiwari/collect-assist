// Session state for the whole app.
//
// On boot we ask the server who is signed in. If the server cannot be reached (no signal,
// weak network) we fall back to the last user saved on this phone so an officer can still
// open their saved list and log outcomes offline. The server stays the source of truth:
// as soon as it answers again, its answer wins.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Lang, MeResponse, SessionUser } from '../../shared/types';
import { api } from './api';
import { refreshClock } from './clock';
import { isUnreachable } from './hooks';

const USER_KEY = 'ca.user';
const LANG_KEY = 'ca.lang';

interface AuthContextValue {
  /** False until the first /auth/me answer (or fallback) is known. */
  ready: boolean;
  user: SessionUser | null;
  /** True when we are running on the cached user because the server could not be reached. */
  offlineSession: boolean;
  lang: Lang;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  setLang: (lang: Lang) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readCachedUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable: session still works for this tab */
  }
}

function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

function writeLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [offlineSession, setOfflineSession] = useState(false);
  const [preLang, setPreLang] = useState<Lang>(readLang);
  // Set when someone picks a language on the sign-in screen, so it survives signing in.
  const langPickedBeforeLogin = useRef(false);

  const setUser = useCallback((u: SessionUser | null) => {
    setUserState(u);
    writeCachedUser(u);
    if (u) {
      writeLang(u.lang);
      setPreLang(u.lang);
    }
  }, []);

  const signOutLocally = useCallback(() => {
    setUser(null);
    setOfflineSession(false);
  }, [setUser]);

  const checkSession = useCallback(async () => {
    try {
      const res = await api.get<MeResponse>('/auth/me');
      setUser(res.user);
      setOfflineSession(false);
    } catch (err) {
      const cached = readCachedUser();
      if (isUnreachable(err)) {
        if (cached) {
          setUserState(cached);
          setOfflineSession(true);
        }
      } else {
        signOutLocally();
      }
    } finally {
      setReady(true);
    }
  }, [setUser, signOutLocally]);

  // Boot: clock first (it is cheap and drives the contact window), then the session.
  useEffect(() => {
    void refreshClock();
    void checkSession();
  }, [checkSession]);

  // Any 401 from the API means the session is gone: drop to the sign-in screen.
  useEffect(() => {
    const onExpired = () => signOutLocally();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [signOutLocally]);

  // Running on a cached session? Re-check with the server as soon as signal returns.
  useEffect(() => {
    if (!offlineSession) return;
    const onOnline = () => {
      void refreshClock();
      void checkSession();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offlineSession, checkSession]);

  const persistLang = useCallback(
    async (lang: Lang, base: SessionUser) => {
      setUser({ ...base, lang });
      try {
        const res = await api.patch<MeResponse>('/auth/me', { lang });
        setUser(res.user);
      } catch {
        /* offline: the choice is kept on this phone and the UI already switched */
      }
    },
    [setUser],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<MeResponse>('/auth/login', { email, password });
      let signedIn = res.user;
      setOfflineSession(false);
      if (langPickedBeforeLogin.current && preLang !== signedIn.lang) {
        signedIn = { ...signedIn, lang: preLang };
        void persistLang(preLang, res.user);
      } else {
        setUser(signedIn);
      }
      langPickedBeforeLogin.current = false;
      void refreshClock();
      return signedIn;
    },
    [preLang, persistLang, setUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* offline: forget the session on this phone anyway */
    }
    signOutLocally();
  }, [signOutLocally]);

  const setLang = useCallback(
    (lang: Lang) => {
      writeLang(lang);
      setPreLang(lang);
      if (user) void persistLang(lang, user);
      else langPickedBeforeLogin.current = true;
    },
    [user, persistLang],
  );

  const lang = user?.lang ?? preLang;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<AuthContextValue>(
    () => ({ ready, user, offlineSession, lang, login, logout, setLang }),
    [ready, user, offlineSession, lang, login, logout, setLang],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where each role lands after signing in. */
export function homePath(role: SessionUser['role']): string {
  return role === 'officer' ? '/today' : '/m';
}
