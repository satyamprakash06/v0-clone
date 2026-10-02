"use client";

import { SignInButton, SignUpButton, UserButton, Show } from "@clerk/nextjs";
import Link from "next/link";
import { Chai0Logo } from "@/components/brand/chai0-logo";

export function GlassNavbar() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav className="pointer-events-auto flex h-12 w-full max-w-3xl items-center justify-between rounded-full border border-border/50 bg-background/70 px-4 shadow-sm backdrop-blur-xl supports-backdrop-filter:bg-background/50">
        <Link href="/" className="flex items-center">
          <Chai0Logo className="gap-2" />
        </Link>

        <div className="flex items-center gap-2">
          <Show when="signed-out">
            <SignInButton>
              <button className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-orange-300/10">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button className="rounded-full bg-orange-700/65 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-orange-500/20">
                Sign up
              </button>
            </SignUpButton>
          </Show>

          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </nav>
    </header>
  );
}
