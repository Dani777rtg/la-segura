import { Icon } from './Icon';
import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { FormError } from './ui';

export const REPORT_TYPES: Record<string, string> = {
  suplantacion_entidad: 'Suplantación de banco o entidad',
  robo_cuenta: 'Robo de cuenta de WhatsApp o redes',
  compra_prestamo_falso: 'Compra, pago o préstamo falso',
  generico: 'Posible fraude digital',
};

/** Descargar PDF + verificar certificado. */
export function ReportActions({ id, code }: { id: number; code: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const url = URL.createObjectURL(await api.reportPdf(id));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos descargar el PDF.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <button type="button" className="btn-primary" onClick={download} disabled={busy}>
        {busy ? 'Preparando…' : <><Icon name="file" />Descargar PDF</>}
      </button>
      <a href={`/certificado/${code}`} target="_blank" rel="noopener noreferrer"
        className="flex min-h-[52px] items-center justify-center font-bold text-brand underline">
        Verificar certificado
      </a>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
