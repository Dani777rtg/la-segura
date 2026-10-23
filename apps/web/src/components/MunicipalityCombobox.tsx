import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { api } from '../api/client';
import type { Municipality } from '../api/types';
import { useDebounced } from '../hooks/useDebounced';

interface Props {
  value: Municipality | null;
  onChange: (m: Municipality | null) => void;
  error?: string;
}

/** Combobox accesible (patrón ARIA 1.2 list autocomplete) con debounce de 250 ms. */
export function MunicipalityCombobox({ value, onChange, error }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [text, setText] = useState(value ? `${value.name}, ${value.dept}` : '');
  const [items, setItems] = useState<Municipality[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);
  const q = useDebounced(text.trim(), 250);

  useEffect(() => {
    if (value || q.length < 2) { setItems([]); return; }
    let cancelled = false;
    api.municipalities(q)
      .then((r) => { if (!cancelled) { setItems(r.items); setFailed(false); setActive(-1); } })
      .catch(() => { if (!cancelled) { setItems([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [q, value]);

  const pick = (m: Municipality) => {
    onChange(m);
    setText(`${m.name}, ${m.dept}`);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const showList = open && !value && items.length > 0;
  return (
    <div className="relative">
      <label htmlFor={`${uid}-input`} className="label">Municipio donde vives</label>
      <input
        id={`${uid}-input`}
        className="input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${uid}-opt-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-err` : undefined}
        autoComplete="off"
        placeholder="Escribe al menos 2 letras (ej. Bogotá)"
        value={text}
        onChange={(e) => { setText(e.target.value); onChange(null); setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <ul
        id={listId}
        role="listbox"
        hidden={!showList}
        className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-2xl border-2 border-line bg-card shadow-lg"
      >
        {items.map((m, i) => (
          <li
            key={m.code}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => { e.preventDefault(); pick(m); }}
            className={`flex min-h-[48px] cursor-pointer flex-col justify-center px-4 py-2 ${i === active ? 'bg-brand text-brand-ink' : ''}`}
          >
            <span className="font-bold">{m.name}</span>
            <span className="text-sm opacity-80">{m.dept}</span>
          </li>
        ))}
      </ul>
      {failed && <p className="mt-1 text-sm text-muted">No pudimos buscar municipios ahora. Intenta de nuevo.</p>}
      {error && <p id={`${uid}-err`} role="alert" className="field-error">{error}</p>}
    </div>
  );
}
