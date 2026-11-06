"""Terminador TLS local: escuta em 127.0.0.1:443 com o certificado da CA local e repassa
os bytes ja descriptografados para o emulador do Firestore em 127.0.0.1:8081 (HTTP/2 sem TLS).

Uso: python tls_front.py
"""
from __future__ import annotations

import asyncio
import ssl
from pathlib import Path

DIR = Path(__file__).resolve().parent
LISTEN = ("127.0.0.1", 443)
UPSTREAM = ("127.0.0.1", 8081)


RPC_NAMES = (b"/google.firestore.v1.Firestore/Listen", b"/google.firestore.v1.Firestore/Write",
             b"/google.firestore.v1.Firestore/BatchGet", b"/google.firestore.v1.Firestore/RunQuery",
             b"/google.firestore.v1.Firestore/Commit", b"/google.firestore.v1.Firestore/Rollback")


CAPTURE_DIR = DIR / "capturas"
CAPTURE_DIR.mkdir(exist_ok=True)
_conn_seq = 0


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, tag: str, stats: dict,
               capture=None) -> None:
    total = 0
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            total += len(data)
            if tag == "c>u":
                for name in RPC_NAMES:
                    if name in data:
                        print(f"RPC do cliente: {name.decode()}", flush=True)
                if capture is not None and total <= 256 * 1024:
                    capture.write(data)
                    capture.flush()
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        stats[tag] = total
        try:
            writer.close()
        except Exception:
            pass


async def handle(client_r: asyncio.StreamReader, client_w: asyncio.StreamWriter) -> None:
    peer = client_w.get_extra_info("peername")
    print(f"conexao de {peer}", flush=True)
    try:
        up_r, up_w = await asyncio.open_connection(*UPSTREAM)
    except OSError as e:
        print(f"emulador indisponivel: {e}", flush=True)
        client_w.close()
        return
    global _conn_seq
    _conn_seq += 1
    stats: dict = {}
    with (CAPTURE_DIR / f"cliente_{_conn_seq:03d}.bin").open("wb") as cap:
        await asyncio.gather(pipe(client_r, up_w, "c>u", stats, cap), pipe(up_r, client_w, "u>c", stats))
    print(f"fim {peer} bytes cliente->emulador={stats.get('c>u', 0)} emulador->cliente={stats.get('u>c', 0)}", flush=True)


async def main() -> None:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(DIR / "firestore.pem"), keyfile=str(DIR / "firestore.key"))
    ctx.set_alpn_protocols(["h2"])
    servers = [
        await asyncio.start_server(handle, "127.0.0.1", 443, ssl=ctx),
        await asyncio.start_server(handle, "::1", 443, ssl=ctx),
    ]
    print(f"tls_front ouvindo em 127.0.0.1:443 e [::1]:443 -> {UPSTREAM[0]}:{UPSTREAM[1]}", flush=True)
    await asyncio.gather(*(s.serve_forever() for s in servers))


if __name__ == "__main__":
    asyncio.run(main())
