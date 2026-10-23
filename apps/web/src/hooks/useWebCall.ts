import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';

export type CallState = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export const MAX_CALL_SEC = 420; // el servicio de voz corta a los 7 minutos

/** Espera a que el navegador junte sus rutas de red (sin "trickle"): la oferta viaja completa en una sola petición. */
function iceGathered(pc: RTCPeerConnection, ms = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, ms);
  });
}

/** Llamada de voz en vivo con el agente (WebRTC). El audio va directo entre el navegador y el servicio de voz. */
export function useWebCall() {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    if (audio.current) audio.current.srcObject = null;
  }, []);

  const hangup = useCallback(() => { cleanup(); setState((s) => (s === 'error' ? s : 'ended')); }, [cleanup]);

  const start = useCallback(async () => {
    setError('');
    setSeconds(0);
    setState('connecting');
    try {
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setState('error');
      setError('Necesitamos permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones y vuelve a intentar.');
      return;
    }
    try {
      const peer = new RTCPeerConnection({ iceServers: ICE });
      pc.current = peer;
      // El audio va primero: el servicio de voz espera el micrófono en el primer canal.
      peer.addTransceiver(mic.current.getAudioTracks()[0]!, { direction: 'sendrecv', streams: [mic.current] });
      peer.ontrack = (ev) => {
        if (!audio.current) audio.current = new Audio();
        audio.current.autoplay = true;
        audio.current.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
        void audio.current.play().catch(() => undefined);
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setState('live');
        if (peer.connectionState === 'failed') {
          cleanup();
          setState('error');
          setError('Se perdió la conexión. Revisa tu internet o prueba con datos móviles.');
        }
        if (peer.connectionState === 'closed') hangup();
        // "disconnected" puede ser un bache de la red: solo se cuelga si no se recupera en unos segundos (o si La Segura colgó).
        if (peer.connectionState === 'disconnected') setTimeout(() => { if (peer.connectionState !== 'connected') hangup(); }, 4000);
      };
      await peer.setLocalDescription(await peer.createOffer());
      await iceGathered(peer);
      const answer = await api.webCall(peer.localDescription!.sdp);
      await peer.setRemoteDescription(answer);
    } catch (e) {
      cleanup();
      setState('error');
      setError(e instanceof ApiError ? e.message : 'No pudimos conectar la llamada. Intenta de nuevo.');
    }
  }, [cleanup, hangup]);

  // Reloj de la llamada y corte a los 5 minutos.
  useEffect(() => {
    if (state !== 'live') return;
    const t = setInterval(() => setSeconds((s) => {
      if (s + 1 >= MAX_CALL_SEC) hangup();
      return s + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [state, hangup]);

  useEffect(() => cleanup, [cleanup]);

  return { state, error, seconds, start, hangup };
}
