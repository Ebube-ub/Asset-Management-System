import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Cog,
  DoorOpen,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  Receipt,
  Settings,
  ShoppingCart,
  Tags,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS, type NavKey, type Role } from '@shared/domain';
import { Avatar, cn } from '../ui';

type NavItem = {
  key: NavKey;
  label: string;
  to: string;
  icon: React.ReactNode;
  children?: { label: string; to: string }[];
};

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: <LayoutDashboard className="h-[17px] w-[17px]" /> }],
  },
  {
    title: 'Requests',
    items: [
      { key: 'requests', label: 'Requests', to: '/requests', icon: <ClipboardList className="h-[17px] w-[17px]" /> },
      { key: 'approvals', label: 'Approvals', to: '/approvals', icon: <ClipboardCheck className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    title: 'Procurement',
    items: [
      { key: 'stock', label: 'Stock Management', to: '/stock', icon: <PackageSearch className="h-[17px] w-[17px]" /> },
      { key: 'quotations', label: 'Quotations', to: '/quotations', icon: <FileSpreadsheet className="h-[17px] w-[17px]" /> },
      { key: 'financial-approvals', label: 'Financial Approvals', to: '/financial-approvals', icon: <Wallet className="h-[17px] w-[17px]" /> },
      { key: 'purchases', label: 'Purchases', to: '/purchases', icon: <ShoppingCart className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    title: 'Asset register',
    items: [
      { key: 'assets', label: 'Assets', to: '/assets', icon: <Boxes className="h-[17px] w-[17px]" /> },
      {
        key: 'transfers',
        label: 'Transfers & Returns',
        to: '/transfers',
        icon: <ArrowLeftRight className="h-[17px] w-[17px]" />,
        children: [
          { label: 'Transfers', to: '/transfers' },
          { label: 'Returns', to: '/returns' },
        ],
      },
      { key: 'disposals', label: 'Disposal', to: '/disposals', icon: <Receipt className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { key: 'staff', label: 'Staff Management', to: '/staff', icon: <Users className="h-[17px] w-[17px]" /> },
      { key: 'organisation', label: 'Organisation', to: '/organisation', icon: <Building2 className="h-[17px] w-[17px]" /> },
      { key: 'rooms', label: 'Rooms', to: '/rooms', icon: <DoorOpen className="h-[17px] w-[17px]" /> },
      { key: 'asset-types', label: 'Asset Types', to: '/asset-types', icon: <Tags className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    title: 'Insights',
    items: [
      { key: 'reports', label: 'Reports', to: '/reports', icon: <BarChart3 className="h-[17px] w-[17px]" /> },
      { key: 'settings', label: 'Settings', to: '/settings', icon: <Cog className="h-[17px] w-[17px]" /> },
    ],
  },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, can, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>('transfers');

  if (!user) return null;

  const primaryRole = (['administrator', 'financial_executive', 'stock_manager', 'line_manager', 'team_lead'] as Role[]).find((r) =>
    user.roles.includes(r),
  );

  return (
    <>
      {open ? <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} /> : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-gradient-to-b from-brand-600 via-brand-500 to-brand-600 text-white transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-[15px] font-extrabold tracking-tight ring-1 ring-white/20">
              i4
            </div>
            <div>
              <p className="text-[13px] font-bold leading-tight tracking-tight">I4nnova</p>
              <p className="text-[10px] leading-tight text-white/60">Asset Management</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/70 hover:bg-white/10 lg:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {GROUPS.map((group) => {
            const items = group.items.filter((item) => can(item.key));
            if (!items.length) return null;
            return (
              <div key={group.title} className="mb-4">
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">{group.title}</p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
                    if (item.children) {
                      const childActive = item.children.some((c) => location.pathname.startsWith(c.to));
                      return (
                        <div key={item.key}>
                          <button
                            onClick={() => setExpanded(expanded === item.key ? null : item.key)}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors',
                              childActive ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
                            )}
                          >
                            <span className="opacity-90">{item.icon}</span>
                            <span className="flex-1 text-left">{item.label}</span>
                            <ChevronDown
                              className={cn('h-3.5 w-3.5 transition-transform', expanded === item.key && 'rotate-180')}
                            />
                          </button>
                          {expanded === item.key ? (
                            <div className="mt-0.5 space-y-0.5 pl-10">
                              {item.children.map((child) => (
                                <NavLink
                                  key={child.to}
                                  to={child.to}
                                  onClick={onClose}
                                  className={({ isActive }) =>
                                    cn(
                                      'block rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                                      isActive ? 'bg-white/15 font-semibold text-white' : 'text-white/65 hover:bg-white/10 hover:text-white',
                                    )
                                  }
                                >
                                  {child.label}
                                </NavLink>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    }
                    return (
                      <NavLink
                        key={item.key}
                        to={item.to}
                        onClick={onClose}
                        className={cn(
                          'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors',
                          active ? 'bg-white/15 text-white shadow-inner' : 'text-white/75 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <span className="opacity-90">{item.icon}</span>
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="relative shrink-0 border-t border-white/10 p-3">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-white/10"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
              {user.name
                .split(' ')
                .slice(0, 2)
                .map((p) => p[0])
                .join('')}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-white">{user.name}</span>
              <span className="block truncate text-[10.5px] text-white/60">
                {primaryRole ? ROLE_LABELS[primaryRole] : 'Staff Member'}
              </span>
            </span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-white/50 transition-transform', menuOpen && 'rotate-180')} />
          </button>
          {menuOpen ? (
            <div className="absolute bottom-[68px] left-3 right-3 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setMenuOpen(false);
                  onClose();
                  navigate('/profile');
                }}
              >
                <UserCog className="h-3.5 w-3.5" /> My profile & settings
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
