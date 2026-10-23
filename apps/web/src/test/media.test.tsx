import { act, renderHook, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { ReportSheet } from '../components/ReportSheet';
import { useRecorder } from '../hooks/useRecorder';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const okJson = () => vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

describe('cliente API binario', () => {
  it('audio: envía bytes crudos con el Content-Type del recorder', async () => {
    const f = okJson(); vi.stubGlobal('fetch', f);
    const blob = new Blob(['abc'], { type: 'audio/mp4' });
    await api.analyzeAudio(blob);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/analyze/audio');
    expect(init.body).toBe(blob);
    expect(init.headers['Content-Type']).toBe('audio/mp4');
    expect(init.credentials).toBe('include');
  });
  it('imagen: envía el blob crudo con su tipo', async () => {
    const f = okJson(); vi.stubGlobal('fetch', f);
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await api.analyzeImage(blob);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/analyze/image');
    expect(init.body).toBe(blob);
    expect(init.headers['Content-Type']).toBe('image/jpeg');
  });
});

describe('ReportSheet', () => {
  it('envía solo lo llenado y muestra el código', async () => {
    const create = vi.spyOn(api, 'createReport').mockResolvedValue({ id: 9, code: 'PS-AAAAA-BBBBB', created: true });
    const onCreated = vi.fn();
    const u = userEvent.setup();
    render(<ReportSheet caseId={4} onClose={() => {}} onCreated={onCreated} />);
    expect(screen.getByText('Costo: 5 créditos')).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('¿Por dónde llegó?'), 'WhatsApp');
    await u.type(screen.getByLabelText(/Monto en pesos/), '150000');
    await u.click(screen.getByRole('button', { name: 'Armar mi reporte' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ caseId: 4, channel: 'WhatsApp', amountCop: 150000 }));
    expect(await screen.findByText(/PS-AAAAA-BBBBB/)).toBeInTheDocument();
    expect(screen.getByText(/No es la denuncia en sí/)).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
  });
  it('valida el monto y no envía', async () => {
    const create = vi.spyOn(api, 'createReport');
    const u = userEvent.setup();
    render(<ReportSheet caseId={4} onClose={() => {}} onCreated={() => {}} />);
    await u.type(screen.getByLabelText(/Monto en pesos/), '12.5');
    await u.click(screen.getByRole('button', { name: 'Armar mi reporte' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('solo con números');
    expect(create).not.toHaveBeenCalled();
  });
  it('402: avisa que no alcanzan los créditos', async () => {
    vi.spyOn(api, 'createReport').mockRejectedValue(new ApiError(402, 'insufficient_credits', 'x'));
    const u = userEvent.setup();
    render(<ReportSheet caseId={4} onClose={() => {}} onCreated={() => {}} />);
    await u.click(screen.getByRole('button', { name: 'Armar mi reporte' }));
    expect(await screen.findByText(/No te alcanzan los créditos/)).toBeInTheDocument();
  });
});

describe('useRecorder', () => {
  it('libera los tracks al detener y entrega el audio', async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    class FakeRec {
      state = 'inactive'; mimeType = 'audio/webm;codecs=opus';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['a']) }); this.onstop?.(); }
    }
    vi.stubGlobal('MediaRecorder', FakeRec);
    const done = vi.fn();
    const { result } = renderHook(() => useRecorder(done));
    await act(() => result.current.start());
    expect(result.current.recording).toBe(true);
    act(() => result.current.stop());
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
    expect(done.mock.calls[0][0].type).toBe('audio/webm;codecs=opus');
  });
  it('permiso denegado: mensaje amable', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.stubGlobal('MediaRecorder', class {});
    const { result } = renderHook(() => useRecorder(vi.fn()));
    await act(() => result.current.start());
    expect(result.current.error).toMatch(/micrófono/);
    expect(result.current.recording).toBe(false);
  });
});
