"""Servicio de llamadas de La Segura (WhatsApp Calling API + Pipecat).

Cloud Run (la API principal) recibe los avisos de Meta, comprueba la firma y reenvía los avisos del campo `calls`
a este servicio con la clave interna. Aquí se contesta la llamada (WebRTC) y se lanza el agente de voz.
La llamada desde la web llega igual: la API principal (con la sesión de la persona) reenvía la oferta WebRTC.
"""

import asyncio
import hmac
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
import re

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.whatsapp.api import WhatsAppWebhookRequest
from pipecat.transports.whatsapp.client import WhatsAppClient

from bot import run_bot

# Variables compartidas con el resto del proyecto (.env de la raíz); en la máquina virtual vienen del entorno.
_parents = Path(__file__).resolve().parents
if len(_parents) > 2:  # en un contenedor no hay .env: las variables llegan por el entorno
    load_dotenv(_parents[2] / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("voice")

INTERNAL_KEY = os.environ.get("VOICE_INTERNAL_KEY", "")
MAX_ACTIVE_CALLS = 6  # tope de llamadas simultáneas (CPU de la VM y costo)
ICE = [IceServer(urls="stun:stun.l.google.com:19302")]
active_calls: set[asyncio.Task] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.session = aiohttp.ClientSession()
    app.state.wa = WhatsAppClient(
        whatsapp_token=os.environ["WHATSAPP_ACCESS_TOKEN"],
        phone_number_id=os.environ["WHATSAPP_PHONE_NUMBER_ID"],
        session=app.state.session,
        whatsapp_secret=os.environ["WHATSAPP_APP_SECRET"],
    )
    yield
    await app.state.wa.terminate_all_calls()
    for task in list(active_calls):
        task.cancel()
    await app.state.session.close()


app = FastAPI(lifespan=lifespan)


async def spawn_bot(connection, call):
    """Se llama cuando WhatsApp conecta una llamada: corre el agente sin bloquear la respuesta al webhook."""
    caller = str(call.from_)
    log.info("Llamada %s desde %s", call.id, caller[:4] + "•••" + caller[-3:])
    _track(asyncio.create_task(run_bot(connection, caller)))


def _authorized(request: Request) -> bool:
    return bool(INTERNAL_KEY) and hmac.compare_digest(request.headers.get("x-internal-key", ""), INTERNAL_KEY)


def _track(task: asyncio.Task) -> None:
    active_calls.add(task)
    task.add_done_callback(active_calls.discard)


@app.post("/web/offer")
async def web_offer(request: Request):
    """Llamada desde la web: recibe la oferta WebRTC del navegador (vía la API principal) y contesta con el agente."""
    if not _authorized(request):
        return Response("No autorizado", status_code=401)
    try:
        data = await request.json()
        sdp, kind, phone = str(data["sdp"]), str(data["type"]), str(data["phone"])
    except Exception:
        return Response("Solicitud inválida", status_code=400)
    if kind != "offer" or len(sdp) > 20_000 or not re.fullmatch(r"573\d{9}", phone):
        return Response("Solicitud inválida", status_code=400)
    if len(active_calls) >= MAX_ACTIVE_CALLS:
        return Response("Muchas llamadas al tiempo", status_code=503)
    connection = SmallWebRTCConnection(ICE)
    await connection.initialize(sdp=sdp, type=kind)
    answer = connection.get_answer()
    if not answer:
        return Response("No se pudo contestar", status_code=500)
    log.info("Llamada web desde %s", phone[:4] + "•••" + phone[-3:])
    _track(asyncio.create_task(run_bot(connection, phone)))
    return JSONResponse({"sdp": answer["sdp"], "type": answer["type"]})


@app.get("/health")
async def health():
    return {"ok": True, "llamadas_activas": len(active_calls)}


@app.post("/whatsapp")
async def whatsapp_webhook(request: Request):
    # Solo la API principal puede llamar aquí (clave compartida, comparación en tiempo constante).
    if not _authorized(request):
        return Response("No autorizado", status_code=401)

    raw_body = await request.body()
    try:
        webhook = WhatsAppWebhookRequest.model_validate_json(raw_body)
        # El cliente vuelve a comprobar la firma de Meta con el App Secret (defensa en profundidad).
        await request.app.state.wa.handle_webhook_request(
            webhook,
            connection_callback=spawn_bot,
            raw_body=raw_body,
            sha256_signature=request.headers.get("x-hub-signature-256"),
        )
    except ValueError as err:  # aviso sin evento de llamada
        log.info("Aviso ignorado: %s", err)
        return Response(status_code=200)
    except Exception as err:  # firma inválida o fallo al contestar
        log.exception("Fallo al procesar el aviso de llamada")
        return Response(str(err)[:200], status_code=500)
    return Response(status_code=200)
