export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default function FakeCheckoutCompletedPage() {
  return <main style={{ boxSizing: "border-box", maxWidth: 680, margin: "0 auto", padding: "32px 20px", color: "#f7f1dc", fontFamily: "Arial, sans-serif" }}>
    <section style={{ border: "1px solid rgba(212,175,55,.35)", borderRadius: 16, padding: 24, background: "#171613" }}>
      <p style={{ color: "#d4af37", marginTop: 0 }}>SoundSpa · Staging test checkout</p>
      <h1 style={{ fontSize: 24 }}>Payment completed</h1>
      <p role="status">The order has been paid. You may close this page.</p>
      <p style={{ color: "#9d978a", fontSize: 12, marginBottom: 0 }}>This was a staging simulation. No real money was charged.</p>
    </section>
  </main>;
}
