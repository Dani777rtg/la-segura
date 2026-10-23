import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { FRAUD_TYPES, type AnalyzeResult, type Level } from '../api/types';
import { RiskCard } from '../components/RiskCard';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ setUser: () => undefined }) }));
afterEach(() => { vi.restoreAllMocks(); });

const res = (level: Level, offerReport = true): AnalyzeResult => ({
  caseId: 7, risk: 'alto', level, fraudType: 'sim_swapping', summary: 'Piden un código por WhatsApp',
  reasons: [], advice: [], sources: [], offerReport, creditsLeft: 3,
});
const show = (r: AnalyzeResult) => render(<MemoryRouter><RiskCard r={r} /></MemoryRouter>);

describe('RiskCard por nivel', () => {
  const labels: [Level, string][] = [
    ['muy_probable', 'Muy probable que sea una estafa'],
    ['probable', 'Probablemente es una estafa'],
    ['posible', 'Podría ser una estafa'],
    ['poco_probable', 'Poco probable, pero no puedo asegurar que sea seguro'],
  ];
  it.each(labels)('%s muestra su etiqueta, sin %% ni "seguro" afirmativo', (level, label) => {
    const { container } = show(res(level));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(label);
    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toMatch(/confianza/i);
    expect(container.textContent!.replace('no puedo asegurar que sea seguro', '')).not.toMatch(/seguro/i);
  });
});

describe('Avisar a mis vecinos', () => {
  const open = async () => {
    show(res('probable'));
    await userEvent.click(screen.getByRole('button', { name: 'Avisar a mis vecinos' }));
  };
  it('no se ofrece si offerReport es false', () => {
    show(res('probable', false));
    expect(screen.queryByRole('button', { name: 'Avisar a mis vecinos' })).toBeNull();
  });
  it('confirma, publica y muestra el texto final', async () => {
    const spy = vi.spyOn(api, 'publishCase').mockResolvedValue({ id: 1, body: 'Texto final', created: true });
    await open();
    expect(screen.getByRole('dialog')).toHaveTextContent('Duplicado o cambio de SIM: Piden un código por WhatsApp');
    await userEvent.click(screen.getByRole('button', { name: 'Sí, publicar' }));
    expect(spy).toHaveBeenCalledWith(7);
    expect(await screen.findByText(/tus vecinos ya ven la alerta/)).toBeInTheDocument();
    expect(screen.getByText('Texto final')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver en Inicio' })).toHaveAttribute('href', '/app');
  });
  it('created:false avisa que ya estaba publicada', async () => {
    vi.spyOn(api, 'publishCase').mockResolvedValue({ created: false });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, publicar' }));
    expect(await screen.findByText('Esa alerta ya estaba publicada')).toBeInTheDocument();
  });
  it('429 muestra el mensaje del servidor', async () => {
    vi.spyOn(api, 'publishCase').mockRejectedValue(new ApiError(429, 'rate', 'Vas muy rápido, espera un poco.'));
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, publicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vas muy rápido');
  });
  it('Escape cierra', async () => {
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('POST sin cuerpo a la ruta correcta', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"created":true}', { status: 201 })); vi.stubGlobal('fetch', f);
    await api.publishCase(7);
    expect(f.mock.calls[0][0]).toBe('/api/cases/7/publish');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', body: undefined });
  });
});

it('sim_swapping tiene etiqueta en español', () => {
  expect(FRAUD_TYPES.sim_swapping).toBe('Duplicado o cambio de SIM');
});
