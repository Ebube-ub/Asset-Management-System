import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Boxes,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  User,
} from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { Avatar, cn } from '../ui';
import { relativeTime } from '../../lib/format';
import { useTheme, type ThemeMode } from '../../lib/theme';
import { ROLE_LABELS, type Role } from '@shared/domain';

const TITLES: { match: RegExp; title: string; parent?: string; parentTo?: string }[] = [
  { match: /^\/dashboard$/, title: 'Dashboard' },
  { match: /^\/requests$/, title: 'Requests' },
  { match: /^\/requests\/new$/, title: 'New Request', parent: 'Requests', parentTo: '/requests' },
  { match: /^\/requests\/[^/]+\/edit$/, title: 'Edit request', parent: 'Request detail', parentTo: '/requests' },
  { match: /^\/requests\/[^/]+$/, title: 'Request detail', parent: 'Requests', parentTo: '/requests' },
  { match: /^\/approvals$/, title: 'Purchase Request' },
  { match: /^\/stock$/, title: 'Stock Management' },
  { match: /^\/quotations$/, title: 'Quotations' },
  { match: /^\/quotations\/[^/]+$/, title: 'Quotation comparison', parent: 'Quotations', parentTo: '/quotations' },
  { match: /^\/financial-approvals$/, title: 'Financial Approvals' },
  { match: /^\/purchases$/, title: 'Purchases' },
  { match: /^\/assets$/, title: 'Assets' },
  { match: /^\/assets\/[^/]+$/, title: 'Asset detail', parent: 'Assets', parentTo: '/assets' },
  { match: /^\/transfers$/, title: 'Transfers' },
  { match: /^\/returns$/, title: 'Returns' },
  { match: /^\/disposals$/, title: 'Disposal' },
  { match: /^\/staff$/, title: 'Staff Management' },
  { match: /^\/staff\/[^/]+$/, title: 'Staff profile', parent: 'Staff Management', parentTo: '/staff' },
  { match: /^\/organisation$/, title: 'Organisation' },
  { match: /^\/rooms$/, title: 'Rooms' },
  { match: /^\/asset-configuration$/, title: 'Asset Configuration' },
  { match: /^\/reports$/, title: 'Reports' },
  { match: /^\/settings$/, title: 'Settings' },
  { match: /^\/profile$/, title: 'My profile' },
];

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'light', label: 'Light', icon: <Sun className="h-3.5 w-3.5" /> },
  { mode: 'dark', label: 'Dark', icon: <Moon className="h-3.5 w-3.5" /> },
  { mode: 'system', label: 'System', icon: <Monitor className="h-3.5 w-3.5" /> },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { mode, setMode } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  // A rejected confirm sends the person straight to the field that is missing or wrong.
  useEffect(() => {
    const focusFirstInvalid = (scope: ParentNode) => {
      const el = scope.querySelector<HTMLElement>('[aria-invalid="true"], :invalid');
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    };
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      const dialog = button?.closest('[role="dialog"]');
      if (!dialog) return;
      window.setTimeout(() => {
        if (dialog.isConnected) focusFirstInvalid(dialog);
      }, 90);
    };
    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      window.setTimeout(() => {
        if (form.isConnected) focusFirstInvalid(form);
      }, 90);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  const feed = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<any>('/notifications'),
    enabled: !!user,
    staleTime: 20_000,
  });

  const markRead = useMutation({
    mutationFn: () => api<any>('/notifications/read', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const meta: { title: string; parent?: string; parentTo?: string } =
    TITLES.find((t) => t.match.test(location.pathname)) ?? { title: 'I4nnova' };
  const unread = feed.data?.unread ?? 0;
  const digests: any[] = feed.data?.digests ?? [];
  const items: any[] = feed.data?.items ?? [];

  if (!user) return null;
  const primaryRole = (['administrator', 'financial_executive', 'stock_manager', 'line_manager', 'team_lead'] as Role[]).find((r) =>
    user.roles.includes(r),
  );

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-surface/95 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Link to="/dashboard" className="hover:text-brand-500">
                  Home
                </Link>
                {meta.parent ? (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    <Link to={meta.parentTo ?? '#'} className="hover:text-brand-500">
                      {meta.parent}
                    </Link>
                  </>
                ) : null}
                <ChevronRight className="h-3 w-3" />
                <span className="text-slate-500">{meta.title}</span>
              </div>
              <h2 className="truncate text-[15px] font-semibold leading-tight text-ink">{meta.title}</h2>
            </div>

            <form
              className="hidden md:block"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/requests?q=${encodeURIComponent(search)}`);
              }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search requests, assets…"
                  className="h-9 w-56 rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-3 text-xs text-ink placeholder:text-slate-400 focus:border-brand-300 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-100 lg:w-64"
                />
              </div>
            </form>

            <div className="relative">
              <button
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setProfileOpen(false);
                  if (!notifOpen) void feed.refetch();
                }}
                className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Notifications"
              >
                <Bell className="h-[18px] w-[18px]" />
                {unread > 0 ? (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <div
                  role="dialog"
                  aria-label="Notifications"
                  className="absolute right-0 top-12 w-[min(94vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-xl"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-ink">Notifications</p>
                      <p className="text-[11px] text-slate-500">
                        {unread > 0 ? `${unread} unread` : 'All caught up'} · latest 30 events
                      </p>
                    </div>
                    <button
                      onClick={() => markRead.mutate()}
                      disabled={unread === 0 || markRead.isPending}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-40"
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                    </button>
                  </div>

                  <div className="max-h-[70vh] overflow-y-auto">
                    {digests.length ? (
                      <div className="border-b border-slate-100 px-2 py-2">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Needs you
                        </p>
                        {digests.map((d) => (
                          <button
                            key={d.key}
                            onClick={() => {
                              setNotifOpen(false);
                              navigate(d.href);
                            }}
                            className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
                          >
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-[11px] font-bold text-amber-700">
                              {d.count}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-ink">{d.label}</span>
                              <span className="block text-[11px] text-slate-500">{d.description}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {items.length === 0 ? (
                      <p className="px-4 py-8 text-center text-xs text-slate-500">
                        Nothing has happened yet. Events on your requests and assets appear here.
                      </p>
                    ) : (
                      items.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            setNotifOpen(false);
                            navigate(n.href);
                          }}
                          className={cn(
                            'flex w-full items-start gap-3 border-b border-slate-50 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50',
                            !n.read && 'bg-brand-50/40',
                          )}
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                            {n.kind === 'asset' ? <Boxes className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className={cn('truncate text-xs', n.read ? 'text-slate-600' : 'font-semibold text-ink')}>
                                {n.title}
                              </span>
                              {!n.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" /> : null}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                              {n.ref ? `${n.ref} · ` : ''}
                              {n.note ?? 'Recorded in the history'}
                            </span>
                            <span className="mt-0.5 block text-[10.5px] text-slate-400">
                              {n.actor ?? 'System'} · {relativeTime(n.at)}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                onClick={() => {
                  setProfileOpen((v) => !v);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-slate-100"
              >
                <Avatar name={user.name} size="sm" />
                <span className="hidden text-left sm:block">
                  <span className="block text-xs font-semibold leading-tight text-ink">{user.name.split(' ')[0]}</span>
                  <span className="block text-[10px] leading-tight text-slate-500">
                    {primaryRole ? ROLE_LABELS[primaryRole] : 'Staff'}
                  </span>
                </span>
              </button>
              {profileOpen ? (
                <div className="absolute right-0 top-12 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-xl">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-semibold text-ink">{user.name}</p>
                    <p className="truncate text-[11px] text-slate-500">{user.email}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {user.roles.length ? (
                        user.roles.map((r) => (
                          <span key={r} className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-600">
                            {ROLE_LABELS[r]}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Staff Member</span>
                      )}
                    </div>
                  </div>
                  <div className="border-b border-slate-100 px-3 py-2.5">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Appearance</p>
                    <div className="flex rounded-lg bg-slate-100 p-0.5">
                      {THEME_OPTIONS.map((option) => (
                        <button
                          key={option.mode}
                          onClick={() => setMode(option.mode)}
                          title={`${option.label} mode`}
                          className={cn(
                            'flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-semibold transition-colors',
                            mode === option.mode ? 'bg-surface text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700',
                          )}
                        >
                          {option.icon}
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <NavLink to="/profile" className="flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50">
                    <User className="h-3.5 w-3.5" /> My profile
                  </NavLink>
                  {user.roles.includes('administrator') ? (
                    <NavLink to="/settings" className="flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50">
                      <Settings className="h-3.5 w-3.5" /> Settings
                    </NavLink>
                  ) : null}
                  <button
                    onClick={async () => {
                      await logout();
                      navigate('/login');
                    }}
                    className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
