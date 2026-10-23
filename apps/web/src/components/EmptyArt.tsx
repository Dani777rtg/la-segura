/** Ilustración para estados vacíos: un globo de chat con el escudo, en los colores del logo. */
export function EmptyArt({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="56" fill="rgb(var(--brand-soft))" />
      <path d="M30 38a10 10 0 0 1 10-10h40a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10H56l-14 12v-12h-2a10 10 0 0 1-10-10z" fill="#fff" stroke="#1c5d7d" strokeWidth="3" strokeLinejoin="round" />
      <path d="M60 36l14 5v9c0 9-6 14-14 17-8-3-14-8-14-17v-9z" fill="#2cbbcb" />
      <path d="M54 51l4.5 4.5L67 47" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="92" cy="30" r="5" fill="#2cbbcb" opacity=".6" />
      <circle cx="24" cy="84" r="4" fill="#1c5d7d" opacity=".35" />
    </svg>
  );
}
