"use client";

import { FormEvent, useState } from "react";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [salonName, setSalonName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, salonName, inviteCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Не удалось создать кабинет. Попробуйте ещё раз.");
      } else {
        setSuccess(
          "Мы отправили письмо со ссылкой для входа на указанный email. Проверьте почту."
        );
        setEmail("");
        setSalonName("");
        // inviteCode можно не очищать, если он общий
      }
    } catch (err) {
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
        fontFamily:
          "-apple-system, system-ui, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        color: "white",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
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
            Регистрация кабинета
          </h1>
          <p
            style={{
              fontSize: 13,
              opacity: 0.65,
              margin: 0,
            }}
          >
            Введите email, название салона и инвайт-код, чтобы создать тестовый кабинет
            Sound Spa на 10 дней.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
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

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Название салона
            <input
              type="text"
              value={salonName}
              onChange={(e) => setSalonName(e.target.value)}
              placeholder="Например, Дивница"
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

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Инвайт-код
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Введите код, который вы получили от команды Sound Spa"
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

          {success && (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "#34C759",
              }}
            >
              {success}
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
              transition:
                "transform 120ms ease-out, box-shadow 120ms ease-out",
            }}
          >
            {loading ? "Создаём кабинет..." : "Создать тестовый кабинет"}
          </button>
        </form>
      </div>
    </main>
  );
}
