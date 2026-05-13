"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Sign-in gate. Blocks the app until the shared Supabase user is signed in;
 * once signed in, renders children. No sign-up flow — the shared account is
 * pre-created in the Supabase dashboard (see migration 0003's footer).
 *
 * Session state is persisted by the Supabase client in localStorage and
 * auto-refreshed in the background, so a refresh or tab reopen keeps the user
 * signed in. Sign-out lives in the side nav.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  // undefined = still hydrating from localStorage; null = confirmed signed out
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (session) return <>{children}</>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
    }
    // On success, onAuthStateChange fires and the gate re-renders children.
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <img
            src="/logo.png"
            alt="Dulceria"
            className="w-28 h-28 object-contain mb-6"
          />
          <h1
            className="text-2xl text-foreground"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}
          >
            Dulceria
          </h1>
        </div>
        <div className="space-y-3">
          <input
            type="email"
            autoComplete="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {error && (
          <p className="mt-3 text-xs text-destructive">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-[4px] bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Log in to enter"}
        </button>
      </form>
    </div>
  );
}
