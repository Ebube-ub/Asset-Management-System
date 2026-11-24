import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronRight, LogOut, Menu, Search, Settings, User, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { Avatar, Button, cn } from '../ui';
import { ROLE_LABELS, type Role } from '@shared/domain';

const TITLES: { match: RegExp; title: string; parent?: string; parentTo?: string }[] = [
  { match: /^\/dashboard$/, title: 'Dashboard' },
  { match: /^\/requests$/, title: 'Requests' },
  { match: /^\/requests\/new$/, title: 'New Request', parent: 'Requests', parentTo: '/requests' },
  { match: /^\/requests\/[^/]+$/, title: 'Request detail', parent: 'Requests', parentTo: '/requests' },
  { match: /^\/approvals$/, title: 'Approvals' },
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
  { match: /^\/asset-types$/, title: 'Asset Types' },
  { match: /^\/reports$/, title: 'Reports' },
  { match: /^\/settings$/, title: 'Settings' },
  { match: /^\/profile$/, title: 'My profile' },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  const { data } = useQuery({
    queryKey: ['dashboard-badges'],
    queryFn: () => api<any>('/dashboard'),
    enabled: !!user,
    staleTime: 30_000,
  });

  const meta: { title: string; parent?: string; parentTo?: string } =
    TITLES.find((t) => t.match.test(location.pathname)) ?? { title: 'I4nnova' };
  const pending = (data?.outstanding ?? []).filter((o: any) => o.count > 0);

  if (!user) return null;
  const primaryRole = (['administrator', 'financial_executive', 'stock_manager', 'line_manager', 'team_lead'] as Role[]).find((r) =>
    user.roles.includes(r),
  );

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
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
                  className="h-9 w-56 rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-3 text-xs text-ink placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 lg:w-64"
                />
              </div>
            </form>

            <div className="relative">
              <button
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setProfileOpen(false);
                }}
                className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Action centre"
              >
                <Bell className="h-[18px] w-[18px]" />
                {pending.length ? (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {pending.reduce((sum: number, o: any) => sum + o.count, 0)}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <div className="absolute right-0 top-12 w-[min(92vw,320px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-xs font-semibold text-ink">Your outstanding actions</p>
                    <p className="text-[11px] text-slate-500">Live from the register — not a notification feed.</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {pending.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-slate-500">Nothing needs your attention.</p>
                    ) : (
                      pending.map((o: any) => (
                        <button
                          key={o.key}
                          onClick={() => {
                            setNotifOpen(false);
                            navigate(o.href);
                          }}
                          className="flex w-full items-start gap-3 border-b border-slate-50 px-4 py-2.5 text-left last:border-0 hover:bg-slate-50"
                        >
                          <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-[11px] font-bold text-brand-600">
                            {o.count}
                          </span>
                          <span>
                            <span className="block text-xs font-medium text-ink">{o.label}</span>
                            <span className="block text-[11px] text-slate-500">{o.description}</span>
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
                <div className="absolute right-0 top-12 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
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
