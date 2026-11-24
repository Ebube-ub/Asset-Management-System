import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, ClipboardList, Lock, Mail, ShieldCheck, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';

const DEMO = [
  { role: 'Administrator', email: 'grace.okafor@i4nnova.com', name: 'Grace Okafor' },
  { role: 'Stock Manager', email: 'fatima.bello@i4nnova.com', name: 'Fatima Bello' },
  { role: 'Financial Executive', email: 'ngozi.adeyemi@i4nnova.com', name: 'Ngozi Adeyemi' },
  { role: 'Line Manager', email: 'emeka.nwosu@i4nnova.com', name: 'Emeka Nwosu' },
  { role: 'Team Lead', email: 'ibrahim.musa@i4nnova.com', name: 'Ibrahim Musa' },
  { role: 'Staff Member', email: 'zainab.yusuf@i4nnova.com', name: 'Zainab Yusuf' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('grace.okafor@i4nnova.com');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-brand-700 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-lg font-extrabold ring-1 ring-white/20">
              i4
            </div>
            <div>
              <p className="text-base font-bold tracking-tight">I4nnova</p>
              <p className="text-xs text-white/60">Asset Management System</p>
            </div>
          </div>
          <h1 className="mt-14 max-w-md text-3xl font-bold leading-tight tracking-tight">
            One record for every request, decision and handover.
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70">
            Release 1 brings the request and approval chain into a single system, with a dependable register of every
            asset from the moment someone asks for it until it is disposed of.
          </p>
        </div>

        <div className="relative grid grid-cols-2 gap-3">
          {[
            { icon: <ClipboardList className="h-4 w-4" />, title: 'Reporting-line review', copy: 'Requests climb one reviewer at a time' },
            { icon: <Boxes className="h-4 w-4" />, title: 'Individual tracking', copy: 'Every unit, low value included' },
            { icon: <Wallet className="h-4 w-4" />, title: 'Financial decisions', copy: 'Approve, decline or defer by line' },
            { icon: <ShieldCheck className="h-4 w-4" />, title: 'Full history', copy: 'Who did what, and when' },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">{f.icon}</div>
              <p className="text-[13px] font-semibold">{f.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/60">{f.copy}</p>
            </div>
          ))}
        </div>
        <p className="relative text-[11px] text-white/40">Release 1 · internal use only</p>
      </div>

      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-base font-extrabold text-white">
              i4
            </div>
            <div>
              <p className="text-sm font-bold text-ink">I4nnova Asset Management</p>
              <p className="text-[11px] text-slate-500">Release 1</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your I4nnova work email to continue.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <Field label="Work email" required>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  placeholder="you@i4nnova.com"
                  autoComplete="username"
                  required
                />
              </div>
            </Field>
            <Field label="Password" required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>
            </Field>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700">{error}</div>
            ) : null}

            <Button type="submit" loading={loading} size="lg" className="w-full">
              Sign in to I4nnova
            </Button>
          </form>

          <div className="mt-8">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Demo accounts</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword('Password123!');
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50"
                >
                  <p className="text-[11px] font-semibold text-ink">{d.role}</p>
                  <p className="truncate text-[10px] text-slate-500">{d.name}</p>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              All demo accounts use the password <span className="font-mono font-semibold text-slate-600">Password123!</span>.
              Demo data is seeded once and kept separate from any live records.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
