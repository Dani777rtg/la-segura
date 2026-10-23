import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { ResendButton } from '../components/ResendButton';
import Register from '../pages/Register';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('cliente API', () => {
  it('429 expone retryAfterSec del cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'rate_limited', message: 'Espera', retryAfterSec: 540 }),
      { status: 429, headers: { 'Retry-After': '540' } })));
    const err = await api.resendCode('3001234567').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSec).toBe(540);
  });
  it('usa el header Retry-After si falta en el cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'rate_limited', message: 'x' }), { status: 429, headers: { 'Retry-After': '30' } })));
    const err = await api.me().catch((e) => e);
    expect(err.retryAfterSec).toBe(30);
  });
});

describe('Registro', () => {
  const fill = async (muni: string, pick: string) => {
    const u = userEvent.setup();
    render(<MemoryRouter><Register /></MemoryRouter>);
    await u.type(screen.getByLabelText('Tu nombre'), 'Ana');
    await u.type(screen.getByLabelText('Tu celular'), '3001234567');
    await u.type(screen.getByLabelText('Contraseña'), 'clave12345');
    await u.type(screen.getByRole('combobox'), muni);
    await u.click(await screen.findByRole('option', { name: new RegExp(pick) }));
    return u;
  };

  it('exige localidad solo en Bogotá', async () => {
    vi.spyOn(api, 'municipalities').mockResolvedValue({ items: [{ code: '11001', name: 'Bogotá', dept: 'Bogotá D.C.' }] });
    vi.spyOn(api, 'localities').mockResolvedValue({ items: [{ id: 7, name: 'Bosa' }] });
    const u = await fill('bog', 'Bogotá');
    await u.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Elige tu localidad de Bogotá.')).toBeInTheDocument();
  });

  it('no pide localidad en otro municipio', async () => {
    vi.spyOn(api, 'municipalities').mockResolvedValue({ items: [{ code: '05001', name: 'Medellín', dept: 'Antioquia' }] });
    const reg = vi.spyOn(api, 'register').mockResolvedValue({ phone: '5731•••••567', expiresInSec: 600 });
    const u = await fill('med', 'Medellín');
    expect(screen.queryByLabelText('Localidad de Bogotá')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(reg).toHaveBeenCalled());
  });
});

describe('ResendButton', () => {
  it('bloquea y cuenta regresiva; 429 reinicia con retryAfterSec', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'resendCode').mockRejectedValue(new ApiError(429, 'rate_limited', 'Espera', 90));
    render(<ResendButton phone="3001234567" initialWait={3} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('0:03');
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(btn).toBeEnabled();
    await act(async () => { btn.click(); });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('1:30');
  });
});
