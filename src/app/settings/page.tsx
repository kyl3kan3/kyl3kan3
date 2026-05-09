import type { Metadata } from "next";
import { SettingsConsole } from "@/components/settings-console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings · Alert Triage",
};

export default function SettingsPage() {
  return <SettingsConsole />;
}
