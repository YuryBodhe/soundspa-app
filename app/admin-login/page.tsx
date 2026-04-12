"use client";

// /admin-login — форма входа в админ-панель по email + пароль

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ADMIN_EMAIL = "108aura@gmail.com";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Неверные учетные данные");
        setLoading(false);
        return;
      }

      // Успех — в админку
      router.replace("/app/admin");
    } catch (err) {
      console.error("🚨 Admin login client error", err);
      setError("Ошибка сети. Попробуйте еще раз.");
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <div className="auth-card">
        <h1 className="auth-title">Sound Spa · Admin</h1>
        <p className="auth-subtitle">Вход в админ-панель</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="form-error" style={{ marginTop: 12 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            disabled={loading}
          >
            {loading ? "Входим…" : "Войти в админку"}
          </button>
        </form>
      </div>
    </main>
  );
}
