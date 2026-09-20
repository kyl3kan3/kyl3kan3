"use client";

import {
  Archive,
  ArrowUpRight,
  ChevronRight,
  Command,
  Home,
  Inbox,
  LayoutDashboard,
  SearchCheck,
  Settings,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export type ShellSection =
  | "home"
  | "tickets"
  | "archive"
  | "overview"
  | "quality"
  | "settings";

const navItems = [
  {
    href: "/",
    label: "Command center",
    key: "home" as const,
    icon: Home,
    group: "Workspace",
  },
  {
    href: "/tickets",
    label: "Ticket queue",
    key: "tickets" as const,
    icon: Inbox,
  },
  {
    href: "/archive",
    label: "Archive",
    key: "archive" as const,
    icon: Archive,
  },
  {
    href: "/overview",
    label: "Team overview",
    key: "overview" as const,
    icon: LayoutDashboard,
    group: "Insights",
  },
  {
    href: "/quality",
    label: "Quality review",
    key: "quality" as const,
    icon: SearchCheck,
  },
  {
    href: "/settings",
    label: "Settings",
    key: "settings" as const,
    icon: Settings,
    group: "Manage",
  },
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
    <div className="app-shell">
      <a href="#workspace" className="skip-link">
        Skip to workspace
      </a>
      <aside className="workspace-sidebar">
        <Link href="/" className="brand-lockup" aria-label="Alert Triage home">
          <span className="brand-mark">
            <Command size={21} strokeWidth={2.2} />
          </span>
          <span>
            Alert Triage
            <span className="brand-caption">SERVICE OPERATIONS</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-monogram">AT</span>
          <span>
            Helpdesk workspace<small>Operations console</small>
          </span>
        </div>
        <nav aria-label="Main navigation" className="sidebar-navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            // Document navigation allows the manager authentication challenge.
            const NavigationLink = item.key === "quality" ? "a" : Link;
            return (
              <div key={item.key}>
                {item.group && <p className="nav-group-label">{item.group}</p>}
                <NavigationLink
                  href={item.href}
                  aria-current={active === item.key ? "page" : undefined}
                  className={`nav-link ${active === item.key ? "is-active" : ""}`}
                >
                  <Icon size={18} strokeWidth={1.7} />
                  <span>{item.label}</span>
                  {active === item.key && <span className="nav-active-dot" />}
                </NavigationLink>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <Workflow size={20} className="text-blue-300" />
          <p>Built around your team.</p>
          <span>
            Jev assesses. Your rules route.
            <br />
            People make the decisions.
          </span>
          <a href="/quality" className="sidebar-footer-link">
            Explore quality review <ArrowUpRight size={15} />
          </a>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <div className="workspace-breadcrumb">
            <span className="mobile-brand">
              <Command size={18} />
            </span>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span>{subtitle}</span>
          </div>
          <div className="workspace-toolbar">
            <h1>{title}</h1>
            {actions && <div className="workspace-actions">{actions}</div>}
          </div>
        </header>
        <nav className="mobile-navigation" aria-label="Mobile navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const NavigationLink = item.key === "quality" ? "a" : Link;
            return (
              <NavigationLink
                key={item.key}
                href={item.href}
                aria-label={item.label}
                aria-current={active === item.key ? "page" : undefined}
                className={active === item.key ? "is-active" : ""}
              >
                <Icon size={18} />
                <span>
                  {item.key === "home"
                    ? "Home"
                    : item.key === "tickets"
                      ? "Tickets"
                      : item.key === "overview"
                        ? "Team"
                        : item.key === "quality"
                          ? "Quality"
                          : item.label}
                </span>
              </NavigationLink>
            );
          })}
        </nav>
        <main id="workspace" tabIndex={-1}>
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Alert Triage / Service operations</span>
          <span>Human-led. Evidence-informed.</span>
        </footer>
      </div>
    </div>
  );
}
