"use client";

export default function WorkspaceError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="mx-auto flex min-h-[80vh] max-w-xl items-center px-6">
    <section className="surface-card w-full p-8" role="alert">
      <p className="section-kicker">Workspace unavailable</p>
      <h1 className="mt-2 text-balance text-2xl font-semibold">Your tickets couldn’t be loaded.</h1>
      <p className="mt-3 text-pretty text-sm leading-6 text-ink-muted">The service or database may be temporarily unavailable. We have not substituted sample tickets or changed your data.</p>
      <button type="button" className="btn-primary mt-6 min-h-10 px-5" onClick={() => retry()}>Try again</button>
    </section>
  </main>;
}
