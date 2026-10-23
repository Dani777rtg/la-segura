import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import Forgot from '../pages/Forgot';
import Login from '../pages/Login';

afterEach(() => vi.restoreAllMocks());

const show = (ui: React.ReactElement) => {
  vi.spyOn(api, 'me').mockRejectedValue(new ApiError(401, 'unauthorized', 'Sin sesión'));
  return render(<MemoryRouter><AuthProvider>{ui}</AuthProvider></MemoryRouter>);
};

describe('Recuperar contraseña', () => {
  it('el login ofrece el enlace de recuperación', () => {
    show(<Login />);
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute('href', '/recuperar');
  });

  it('pide el celular, luego el código y la contraseña nueva', async () => {
    const forgot = vi.spyOn(api, 'forgotPassword').mockResolvedValue({ phone: '+57 314 ••• 8719', expiresInSec: 600 });
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue({} as never);
    const u = userEvent.setup();
    show(<Forgot />);
    await u.type(screen.getByLabelText('Tu celular'), '3000000001');
    await u.click(screen.getByRole('button', { name: 'Enviarme el código' }));
    await waitFor(() => expect(forgot).toHaveBeenCalledWith('3000000001'));
    await u.type(await screen.findByLabelText('Código'), '123456');
    await u.type(screen.getByLabelText('Contraseña nueva'), 'clave-nueva-123');
    await u.click(screen.getByRole('button', { name: 'Cambiar contraseña y entrar' }));
    await waitFor(() => expect(reset).toHaveBeenCalledWith('3000000001', '123456', 'clave-nueva-123'));
  });

  it('valida el celular antes de pedir el código', async () => {
    const forgot = vi.spyOn(api, 'forgotPassword');
    const u = userEvent.setup();
    show(<Forgot />);
    await u.type(screen.getByLabelText('Tu celular'), '12345');
    await u.click(screen.getByRole('button', { name: 'Enviarme el código' }));
    expect(await screen.findByText(/10 números/)).toBeInTheDocument();
    expect(forgot).not.toHaveBeenCalled();
  });
});
