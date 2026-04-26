"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GoogleIcon } from "@/components/icons";
import { Brand } from "@/components/brand";

const SESSION_KEY = "taste-lab-session";

export function LoginExperience() {
  const router = useRouter();

  function login(email: string) {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        email,
        role: "Founder",
      }),
    );
    router.push("/dashboard");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "demo@tastelab.local");
    login(email);
  }

  return (
    <main className="login-shell">
      <section aria-labelledby="login-title" className="login-panel">
        <Brand />
        <h1 id="login-title">Sign in</h1>
        <p className="muted">AI design intelligence to elevate your taste.</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              name="email"
              placeholder="you@company.com"
              required
              type="email"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              name="password"
              placeholder="Enter anything"
              required
              type="password"
            />
          </label>

          <button className="text-button forgot-button" type="button">
            Forgot password?
          </button>

          <button className="primary-action" type="submit">
            <span>Continue</span>
          </button>
          <div className="login-divider">
            <span>or</span>
          </div>
          <button
            className="secondary-action"
            onClick={() => login("google.user@tastelab.local")}
            type="button"
          >
            <GoogleIcon />
            <span>Continue with Google</span>
          </button>
        </form>

        <p className="login-terms">
          By continuing, you agree to our <button type="button">Terms of Service</button> and{" "}
          <button type="button">Privacy Policy</button>.
        </p>
      </section>

      <section aria-label="Taste Lab product preview" className="login-art">
        <div className="preview-window login-preview-window">
          <div className="preview-toolbar">
            <Brand />
            <strong>Welcome back</strong>
          </div>
          <div className="preview-grid">
            <div className="preview-sidebar">
              <b>Overview</b>
              <b>Design critique</b>
              <b>Projects</b>
              <b>Settings</b>
            </div>
            <div className="preview-canvas">
              <div className="preview-score-card">
                <div className="score-ring">
                  <span>87</span>
                </div>
                <div>
                  <strong>Taste Score</strong>
                  <small>Great</small>
                </div>
              </div>
              <div className="mini-line-chart" />
              <div className="preview-card-row">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
        <div className="login-demo-skip">
          <button
            className="text-button"
            onClick={() => login("demo@tastelab.local")}
            type="button"
          >
            Skip to demo dashboard
          </button>
        </div>
      </section>
    </main>
  );
}
