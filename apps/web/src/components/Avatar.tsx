// Avatar con iniciales: la red no guarda fotos de nadie. El color sale del nombre, siempre el mismo para la misma persona.
const TONES = [
  'bg-[#dbeafe] text-[#1e40af]', 'bg-[#dcfce7] text-[#166534]', 'bg-[#fef3c7] text-[#92400e]',
  'bg-[#fce7f3] text-[#9d174d]', 'bg-[#ede9fe] text-[#5b21b6]', 'bg-[#ffedd5] text-[#9a3412]',
];

export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const tone = TONES[[...name].reduce((h, ch) => h + ch.charCodeAt(0), 0) % TONES.length];
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${tone}`}>
      {initials}
    </span>
  );
}
