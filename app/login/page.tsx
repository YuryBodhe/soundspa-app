"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [consuming, setConsuming] = useState(false);

  // Если в URL есть token – сразу пытаемся его съесть и залогинить пользователя
  useEffect(() => {
    const token = searchParams.get("token");
    if (!token || consuming) return;

    async function consume() {
      setConsuming(true);
      setError("");
      try {
        const res = await fetch("/api/auth/consume-magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();

        if (res.ok) {
          // Редиректим в кабинет конкретного тенанта
          if (data.tenantSlug) {
            router.replace(`/app/${data.tenantSlug}`);
          } else {
            router.replace("/app/ios-player");
          }
        } else {
          setError(data.error || "Ссылка для входа недействительна. Запросите новую.");
        }
      } catch (e) {
        setError("Ошибка при обработке ссылки. Попробуйте ещё раз.");
      } finally {
        setConsuming(false);
      }
    }

    consume();
  }, [searchParams, router, consuming]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/request-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setError("");
        alert(
          data.message ||
            "Если такой email зарегистрирован, мы отправили на него ссылку для входа."
        );
      } else {
        setError(data.error || "Не удалось отправить ссылку для входа");
      }
    } catch (error) {
      setError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#07060a",
        fontFamily: "-apple-system, system-ui, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        color: "white",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(8,8,12,0.9)",
          borderRadius: 16,
          padding: "24px 20px 20px",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow:
            "0 18px 60px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(255,255,255,0.05)",
        }}
      >
        <header
          style={{
            marginBottom: 24,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: "rgba(195,168,108,0.7)",
            }}
          >
            Sound Spa
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: 0.2,
              margin: 0,
            }}
          >
            Вход в кабинет
          </h1>
          <p
            style={{
              fontSize: 13,
              opacity: 0.65,
              margin: 0,
            }}
          >
            Введите email, мы отправим вам ссылку для входа в кабинет.
          </p>
        </header>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                marginTop: 6,
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(6,6,10,0.9)",
                color: "white",
                fontSize: 14,
                outline: "none",
              }}
            />
          </label>


          {error && (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "#ff5e57",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              width: "100%",
              padding: "11px 16px",
              borderRadius: 999,
              border: "none",
              background: loading
                ? "rgba(120,120,140,0.9)"
                : "linear-gradient(135deg, #34C759, #5dd272)",
              color: "black",
              fontWeight: 600,
              fontSize: 15,
              cursor: loading ? "default" : "pointer",
              boxShadow: loading
                ? "none"
                : "0 12px 30px rgba(52,199,89,0.45)",
              transition: "transform 120ms ease-out, box-shadow 120ms ease-out",
            }}
          >
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>

      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
