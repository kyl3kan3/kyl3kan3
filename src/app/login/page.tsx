import { Command, LockKeyhole } from "lucide-react";
import { safeReturnPath } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const manager = params.manager === "1" || next.startsWith("/quality");
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-border bg-white p-8 shadow-sm">
        <div className="mb-10 flex items-center gap-3 text-lg font-semibold">
          <span className="rounded-xl bg-accent p-3 text-white"><Command size={23} /></span>
          Alert Triage
        </div>
        <LockKeyhole size={24} className="mb-4 text-accent" />
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {manager ? "Use your manager credentials to access quality reviews." : "Your tickets, team, and quality reviews—in one place."}
        </p>
        {params.error === "1" && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">The username or password was not recognized. Please try again.</p>}
        <form action="/api/auth/login" method="post" className="mt-7 space-y-5">
          <input type="hidden" name="next" value={next} />
          <label className="block text-sm font-medium">Username
            <input name="username" autoComplete="username" required maxLength={128} defaultValue={manager ? (process.env.MANAGER_DASHBOARD_USERNAME?.trim() || "manager") : undefined} className="mt-2 block w-full rounded-lg border border-border px-3 py-3" />
          </label>
          <label className="block text-sm font-medium">Password
            <input name="password" type="password" autoComplete="current-password" required maxLength={512} className="mt-2 block w-full rounded-lg border border-border px-3 py-3" />
          </label>
          <button type="submit" className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:opacity-90">Sign in</button>
        </form>
        <p className="mt-6 text-xs leading-5 text-ink-muted">Use the workspace credentials provided by your administrator. Sessions expire after 8 hours.</p>
      </section>
    </main>
  );
}
