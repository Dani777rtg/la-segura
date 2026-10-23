import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import type { Lookup as LookupResult, Post } from '../api/types';
import { PostCard } from '../components/PostCard';
import { PostForm } from '../components/PostForm';
import { PriceBreakdown } from '../pages/Credits';
import Lookup from '../pages/Lookup';

afterEach(() => { vi.restoreAllMocks(); });

const ok = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status }));

describe('cliente API (feed, consulta, territorio, créditos)', () => {
  it('pide cada ruta con credentials include y el método correcto', async () => {
    const f = ok({}); vi.stubGlobal('fetch', f);
    await api.posts('2_7'); await api.lookup('3001234567'); await api.territory(); await api.credits(); await api.checkout();
    const calls = f.mock.calls.map(([u, i]) => [u, i.method, i.credentials]);
    expect(calls).toEqual([
      ['/api/posts?before=2_7', 'GET', 'include'],
      ['/api/lookup?q=3001234567', 'GET', 'include'],
      ['/api/territory', 'GET', 'include'],
      ['/api/credits', 'GET', 'include'],
      ['/api/credits/checkout', 'POST', 'include'],
    ]);
  });
  it('confirm y borrar usan POST/DELETE y aceptan 204', async () => {
    const f = ok(null, 204); vi.stubGlobal('fetch', f);
    await api.confirmPost(3); await api.unconfirmPost(3); await api.deletePost(3);
    expect(f.mock.calls.map(([u, i]) => `${i.method} ${u}`)).toEqual(['POST /api/posts/3/confirm', 'DELETE /api/posts/3/confirm', 'DELETE /api/posts/3']);
  });
  it('402 y 404 llegan como ApiError', async () => {
    vi.stubGlobal('fetch', ok({ error: 'insufficient_credits', message: 'Sin créditos' }, 402));
    const e = await api.credits().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.code]).toEqual([402, 'insufficient_credits']);
  });
});

describe('Publicar en Comunidad', () => {
  it('valida longitud mínima sin llamar a la API', async () => {
    const spy = vi.spyOn(api, 'createPost');
    render(<PostForm onDone={() => undefined} onCancel={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Cuenta lo que te pasó'), 'corto');
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('mínimo 10');
    expect(spy).not.toHaveBeenCalled();
  });
  it('muestra el rechazo 422 del moderador', async () => {
    vi.spyOn(api, 'createPost').mockRejectedValue(new ApiError(422, 'post_rejected', 'Mejor cuéntalo sin insultos, parcero.'));
    render(<PostForm onDone={() => undefined} onCancel={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Cuenta lo que te pasó'), 'Esto es un texto suficientemente largo');
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mejor cuéntalo sin insultos, parcero.');
  });
});

describe('A mí también', () => {
  const post: Post = { id: 1, kind: 'estafaron', body: 'Me llamaron del banco', fraudType: 'suplantacion_entidad', createdAt: '2026-01-02T10:00:00Z', author: 'Ana', place: 'Bosa, Bogotá', confirms: 4, confirmedByMe: false, mine: false, demo: true };
  it('suma y resta del contador y marca Ejemplo', async () => {
    vi.spyOn(api, 'confirmPost').mockResolvedValue(undefined);
    vi.spyOn(api, 'unconfirmPost').mockResolvedValue(undefined);
    render(<PostCard post={post} onDeleted={() => undefined} />);
    expect(screen.getByText('Ejemplo')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /A mí también/ });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent('· 5'));
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent('· 4'));
  });
});

describe('Consulta antes de pagar', () => {
  const base: LookupResult = { kind: 'phone', display: '300 123 4567', reporters: 0, firstReportedAt: null, lastReportedAt: null, level: 'sin_reportes', notes: [], disclaimer: 'Solo son reportes de personas, no una garantía.' };
  for (const level of ['sin_reportes', 'alerta', 'peligro'] as const) {
    it(`nivel ${level}: sin "seguro", sin verde y con disclaimer`, async () => {
      vi.spyOn(api, 'lookup').mockResolvedValue({ ...base, level, reporters: level === 'sin_reportes' ? 0 : 5 });
      const { container } = render(<MemoryRouter><Lookup /></MemoryRouter>);
      await userEvent.type(screen.getByLabelText('Celular o enlace'), '3001234567');
      await userEvent.click(screen.getByRole('button', { name: 'Consultar' }));
      expect(await screen.findByText(base.disclaimer)).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/seguro/i);
      expect(container.innerHTML).not.toMatch(/\b(ok|green)\b/);
    });
  }
});

describe('Créditos', () => {
  it('muestra el desglose $49.000 + IVA ($9.310) = $58.310', () => {
    render(<PriceBreakdown pack={{ credits: 1000, baseCop: 49000, ivaCop: 9310, totalCop: 58310 }} />);
    const t = document.body.textContent!;
    expect(t).toContain('$49.000');
    expect(t).toContain('IVA 19% ($9.310)');
    expect(t).toContain('$58.310 COP');
  });
});
