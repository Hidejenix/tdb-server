"""Ponte TCP: escuta em [::1]:8081 e repassa para 127.0.0.1:8081 (emulador do Firestore, so IPv4)."""
import asyncio

LISTEN = ("::1", 8081)
UPSTREAM = ("127.0.0.1", 8081)


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def handle(client_reader, client_writer):
    try:
        up_reader, up_writer = await asyncio.open_connection(*UPSTREAM)
    except Exception:
        client_writer.close()
        return
    await asyncio.gather(pipe(client_reader, up_writer), pipe(up_reader, client_writer))


async def main():
    server = await asyncio.start_server(handle, LISTEN[0], LISTEN[1], family=0)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
