"use client";

import {
  Bell,
  Home,
  Inbox,
  LayoutDashboard,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type ShellSection = "home" | "tickets" | "overview" | "settings";

const navItems = [
  { href: "/", label: "Home", key: "home" as const, icon: Home },
  { href: "/", label: "Tickets", key: "tickets" as const, icon: Inbox },
  {
    href: "/overview",
    label: "Overview",
    key: "overview" as const,
    icon: LayoutDashboard,
  },
  { href: "/settings", label: "Settings", key: "settings" as const, icon: Settings },
];

export function HelpdeskShell({
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  active: ShellSection;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f7f5f0] text-slate-950">
      <aside className="hidden fixed inset-y-0 left-0 z-30 w-64 border-r border-[#e7dfd2] bg-[#24324a] px-4 py-5 text-white lg:block">
        <Link href="/" className="flex items-center gap-3 rounded-2xl px-2 py-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#8dd6c6] text-[#183047]">
            <Bell className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-bold tracking-tight">
              Alert Triage
            </span>
            <span className="text-[12px] font-medium text-white/60">
              Helpdesk workspace
            </span>
          </span>
        </Link>

        <nav className="mt-8 grid gap-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex h-11 items-center gap-3 rounded-2xl px-3 text-[14px] font-semibold transition ${
                  isActive
                    ? "bg-white text-[#24324a] shadow-sm"
                    : "text-white/72 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-5 left-4 right-4 rounded-3xl bg-white/10 p-4">
          <Sparkles className="h-5 w-5 text-[#f8d68b]" />
          <p className="mt-3 text-[13px] font-semibold">
            Start with what needs a person.
          </p>
          <p className="mt-1 text-[12px] leading-5 text-white/62">
            Move through the day by buckets, not system codes.
          </p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-[#e7dfd2] bg-[#f7f5f0]/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#737064]">
                {subtitle}
              </p>
              <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-[#1f2937] sm:text-3xl">
                {title}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <nav className="flex rounded-2xl border border-[#e4dccf] bg-white p-1 lg:hidden">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.key;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      aria-label={item.label}
                      className={`flex h-9 min-w-9 items-center justify-center rounded-xl px-2 text-[12px] font-semibold ${
                        isActive
                          ? "bg-[#24324a] text-white"
                          : "text-[#6b7280] hover:bg-[#f2eee7]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  );
                })}
              </nav>
              {actions}
            </div>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
